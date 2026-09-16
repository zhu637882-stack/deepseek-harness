/** Real preset + loop composition for the session-bound Qingmu native tools. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as SkillResources from '../src/skill-resources.ts'
import * as Persona from '@deepseek-ai/dsh-persona'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import SpillLocal from '@deepseek-ai/dsh-spill-local'
import { findNativeDialogueInput } from '../src/native-dialogue.ts'
import { MockAdapter as BaseMockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

class MockAdapter extends BaseMockAdapter {
  override async resolveModel(provider: string, model: string) {
    return { ...await super.resolveModel(provider, model), context: { contextWindow: 1048576 } }
  }
}
import * as ModelTools from '../src/model-tools.ts'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { draftMethod } from '../examples/native-draft-fixture.ts'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { createYimengCommandHandler } from '../../qingmu-yimeng-command-adapter/src/index.ts'
import { canonical } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { digest } from '../src/native-draft.ts'
import { claimHostDirectorBinding, createDirectorContextBridge } from '../src/bridge.ts'
import { appendRelayState, createRelayState } from '../src/relay-state.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const scope = { projectId: 'project-a', episodeId: 'episode-a', sceneId: 'scene-a', shotId: 'shot-a' }
const sha = 'a'.repeat(64)
const roughFinalFeedback = [
  '第四参考：粗剪到终版反馈闭环。',
  '逐镜比对锁定的意图、表演、空间关系、声画线索和连续性；每条反馈必须定位到可编辑的镜头状态。',
  '若证据不足，保留未知并回到人工创作决定；不得把技术检查写成内容签收或生成授权。',
].join('\n')

function snapshot(contextSnapshotSha256 = sha) {
  return {
    schema: 'jason.qingmu-director-context-snapshot.v1', ...scope, contextSnapshotSha256,
    script: { revision: 1, sha256: '0'.repeat(64) }, sceneSource: {}, sourceTime: '2026-09-07T00:00:00Z',
    storyboard: { id: 'revision-1', version: 1, status: 'Ready' as const, sourceHash: 'b'.repeat(64) },
    shot: { id: scope.shotId, title: '门口', narrative: '铃声先响，她停在门口。', visual: '门口中景。',
      action: '她停顿。', durationSec: 4, dialogueLineIds: [] },
    sourceScene: { dialogue: '谁在那里？' }, creativeContract: null, selectedReferences: [],
    providerCalls: 0, costAmountCny: '0', businessStateChanged: false,
    humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false,
  } satisfies DirectorContextSnapshot
}

function bind(agent: Agent, contextSnapshotSha256 = sha): void {
  agent.session.append('qingmu-director-context/state', {
    version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter',
  })
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function resultText(events: readonly SessionEvent[], name: string): string {
  const call = events.find(item => item.type === 'tool/call' && item.data.name === name)
  if (call === undefined || call.type !== 'tool/call') throw new Error(`tool call missing: ${name}`)
  const event = events.find(item => item.type === 'tool/result' && item.data.message.source.callId === call.data.callId)
  if (event === undefined || event.type !== 'tool/result') throw new Error(`tool result missing: ${name}`)
  return event.data.message.content.flatMap(part => part.content)
    .filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Find an exact body even when the model request nests it inside tool-result JSON text. */
function includesExactString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    if (value === expected) return true
    try { return includesExactString(JSON.parse(value), expected) } catch { return false }
  }
  if (Array.isArray(value)) return value.some(item => includesExactString(item, expected))
  return value !== null && typeof value === 'object'
    && Object.values(value).some(item => includesExactString(item, expected))
}

/** A real Loader preset: host capabilities stay root-owned; native tools mount only below the agent. */
async function harness(adapter: MockAdapter, sessionRoot?: string, dialogue = false, sourceNotes = '', commandCalls: string[] = [],
  upstream?: ReturnType<typeof dialogueWriter>): Promise<Context> {
  const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
      if (specifier === '@deepseek-ai/dsh-skill-filesystem') return SkillFilesystem
      if (specifier === '@deepseek-ai/dsh-tool-skill') return ToolSkill
      if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/skill-resources') return SkillResources
      if (specifier === '@deepseek-ai/dsh-persona') return Persona
      if (specifier === '@deepseek-ai/dsh-compaction-basic') return BasicCompactionEngine
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Skills)
  const spillRoot = await mkdtemp(join(tmpdir(), 'qingmu-dialogue-spill-')); roots.push(spillRoot)
  await ctx.plugin(SpillLocal, { root: spillRoot })
  await ctx.plugin(SpillPolicy, { maxInlineBytes: 50000 })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (sessionRoot !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot, compression: 'none' })
  await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
  ctx.llm.registerAdapter(['mock'], adapter)
  let committed = false
  ctx.provide('qingmuYimengCommand', async (endpoint, payload, signal) => {
    commandCalls.push(endpoint)
    if (upstream) return upstream.command(endpoint, payload, signal)
    if (dialogue && endpoint === 'readDialogueEditCapability') return { ok: true, value: {} }
    if (dialogue && endpoint === 'proposeScript') {
      expect(payload).toMatchObject({ script: { sourceNotes, scenes: [{ dialogues: [{ line: '有人在吗？' }] }] } })
      return { ok: true, value: { changeSet: { id: 'change-6', payloadSha256: 'c'.repeat(64) } } }
    }
    if (dialogue && endpoint === 'previewScript') return { ok: true, value: {
      canCommit: true, revisionConflict: false, payloadSha256: 'c'.repeat(64) } }
    const receipt = { changeSetId: 'change-6', commandReceiptId: 'saved-6', changed: true,
      authoritativeRevision: 2, authoritativeSnapshotSha256: 'd'.repeat(64) }
    if (dialogue && endpoint === 'recoverScriptCommit') return committed ? { ok: true, value: { receipt } }
      : { ok: false, error: { code: 'internal', message: 'Yimeng rejected command (HTTP 404: command_receipt_not_found)' } }
    if (dialogue && endpoint === 'commitScript') { committed = true; return { ok: true, value: receipt } }
    if (endpoint !== 'readDirectorContext') throw new Error(`unexpected command ${endpoint}`)
    if (JSON.stringify(payload) !== JSON.stringify(scope)) throw new Error('model supplied an out-of-session scope')
    return { ok: true, value: snapshot() }
  })
  ctx.provide('qingmuImagoMethod', async (endpoint, payload) => {
    if (endpoint !== 'directorInstructions') throw new Error(`unexpected method ${endpoint}`)
    if (dialogue) return { ok: true, value: draftMethod((payload as { resourceId?: 'rough_final_feedback' }).resourceId ?? null) }
    if (JSON.stringify(payload) === JSON.stringify({ capability: 'shot_design', resourceId: 'rough_final_feedback' })) {
      return { ok: true, value: {
        capability: 'shot_design', requestedResourceId: 'rough_final_feedback', sourceSha256: 'c'.repeat(64),
        sources: [{ resourceId: 'rough_final_feedback', content: roughFinalFeedback }],
      } }
    }
    if (JSON.stringify(payload) !== JSON.stringify({ capability: 'director_development' })) throw new Error('unexpected method input')
    return { ok: true, value: {
      capability: 'director_development', sourceSha256: 'b'.repeat(64),
      sources: [{ content: '先确认人物意图与场景阻力，再安排机位和声画。' }],
    } }
  })
  if (dialogue) ctx.provide('qingmuYimengRead', async (endpoint, payload, signal) => {
    if (upstream) return upstream.read(endpoint, payload, signal)
    if (endpoint === 'script') return { ok: true, value: { found: true, projectId: scope.projectId, episodeId: scope.episodeId,
      revision: 1, scriptSha256: '0'.repeat(64), script: { sourceNotes, scenes: [{ title: '公路',
        dialogues: [{ lineId: 'line-6', speakerId: 'lina', line: '有人吗？', verbatimText: '有人吗？' }] }] } } }
    if (endpoint !== 'workflow') throw new Error(`unexpected read ${endpoint}`)
    return { ok: true, value: { projectId: scope.projectId, episodeId: scope.episodeId, director: { shotRelations: {
      projectId: scope.projectId, episodeId: scope.episodeId, valid: true, blockers: [],
      storyboardRevision: { revisionId: 'revision-1' }, shots: [
        { shotId: scope.shotId, sceneId: scope.sceneId, frameNo: 6, title: '呼喊', dialogueRhythm: {
          cues: [{ lineId: 'line-6', verbatimText: '有人吗？' }] } },
        { shotId: 'shot-7', sceneId: scope.sceneId, frameNo: 7, title: '反应', dialogueRhythm: { cues: [] } },
      ],
    } } } }
  })
  return ctx
}

/** Writer wire fixtures are normalized by the actual read/command adapters; no tools are replaced. */
function dialogueWriter(linkedSecondShot: boolean) {
  const timestamp = '2026-09-16T00:00:00Z'
  const makeScript = (line: string) => ({ scenes: [{ title: '门口', dialogues: [{ lineId: 'line-6', speakerId: 'lina', line, verbatimText: line }] }] })
  let script = makeScript('有人吗？'), revision = 1
  let proposal: { script: typeof script; references: { affectedShotIds: string[] }[]; harnessSessionId: string } | undefined
  let receipt: Record<string, unknown> | undefined
  function currentContext(): DirectorContextSnapshot {
    const { contextSnapshotSha256: _old, ...body } = snapshot()
    const current = { ...body, script: { revision, sha256: digest(script) },
      storyboard: { ...body.storyboard, id: `revision-${revision}`, version: revision }, sourceScene: script.scenes[0]! }
    return { ...current, contextSnapshotSha256: digest(current) }
  }
  function relations() {
    const context = currentContext()
    const cue = { schemaVersion: 'dialogue-cue-v2', lineId: 'line-6', speakerId: 'lina',
      verbatimText: script.scenes[0]!.dialogues[0]!.line, plannedStartSec: 1, plannedEndSec: 3, timingVerified: true, legacy: false }
    return { schema: 'jason.scene-shot-beat-element-relations.v1', projectId: scope.projectId, episodeId: scope.episodeId,
      storyboardRevision: {
        episodeRevision: revision, revisionId: context.storyboard.id,
        revisionVersion: revision, sourceSha256: context.storyboard.sourceHash,
      },
      scenes: [{ sceneId: scope.sceneId, name: '门口', profileRevision: 1, snapshotSha256: sha }],
      shots: [scope.shotId, 'shot-7'].map((shotId, index) => {
        const cues = index === 0 || linkedSecondShot ? [cue] : []
        return { shotId, sceneId: scope.sceneId, frameNo: index + 6, title: index === 0 ? '呼喊' : '反应', durationSec: 4,
          dialogueRhythm: { cueCount: cues.length, timedCueCount: cues.length, cues }, beats: [],
          elements: [{ elementKind: 'scene', elementId: scope.sceneId, name: '门口', profileRevision: 1,
            snapshotSha256: sha, currentReferenceAvailability: 'missing', currentReference: null }] }
      }), valid: true, blockers: [] }
  }
  function workflow() {
    const shotRelations = relations()
    const { episodeRevision, ...storyboardRevision } = shotRelations.storyboardRevision
    const shots = shotRelations.shots.map(shot => ({
      shotId: shot.shotId, shotSnapshotSha256: digest(shot), heroFrame: null, canvas: null, blockers: [],
    }))
    return { schema: 'jason.episode-workflow-projection.v1', projectId: scope.projectId, episodeId: scope.episodeId,
      sourceRevision: { script: revision }, inputFingerprint: digest(shotRelations), activeTaskId: null, status: 'ready',
      hasData: true, isStale: false, qualityPassed: false, selected: false, canProceed: false, stages: {},
      stageHandoff: {}, assets: {}, shots: {}, video: {}, audio: {}, timeline: {}, budget: {}, release: {}, blockers: [], legacy: {},
      director: { shotRelations, heroFrameStoryboards: { schema: 'jason.qingmu-hero-frame-storyboards.v1',
        projectId: scope.projectId, episodeId: scope.episodeId, episodeRevision, storyboardRevision,
        shotRelationsSha256: digest(shotRelations), shots, shotsSha256: digest(shots), valid: true, blockers: [] } } }
  }
  function changeSet() {
    if (!proposal) throw new Error('Writer fixture has no proposed script')
    return { schema: 'jason.qingmu-change-set.v1', id: 'change-6', workspaceId: null,
      projectId: scope.projectId, episodeId: scope.episodeId, targetType: 'episode_script', targetId: scope.episodeId,
      baseRevision: 1, baseSnapshotSha256: digest(makeScript('有人吗？')), payloadSha256: digest(proposal.script),
      originKind: 'human', actorUserId: 'owner-test', harnessSessionId: proposal.harnessSessionId, status: 'draft',
      authoritativeRevision: null, authoritativeSnapshotSha256: null, committedByUserId: null,
      committedEventId: null, committedAt: null, createdAt: timestamp, updatedAt: timestamp }
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const path = url.pathname
    if (path.endsWith('/director-inference/context')) return Response.json(currentContext())
    if (path === '/api/episodes/episode-a/script') return Response.json({
      found: true, projectId: scope.projectId, episodeId: scope.episodeId,
      script, scriptCanonicalJson: canonical(script), scriptSha256: digest(script),
      revision, editedByUser: revision > 1, updatedAt: timestamp,
    })
    if (path === '/api/episodes/episode-a/workflow-projection') return Response.json(workflow())
    if (path === '/api/qingmu/dialogue-edit/capability') return Response.json({ schema: 'qingmu.dialogue-transaction-capability.v1',
      referenceSchema: 'qingmu.dialogue-edit-reference.v1', atomicScriptAndFrames: true })
    if (path === '/api/qingmu/episodes/episode-a/script/change-sets' && init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Expected a script proposal body')
      proposal = JSON.parse(init.body) as NonNullable<typeof proposal>
      return Response.json({ schema: 'jason.qingmu-change-set-proposal.v1', changeSet: changeSet(), nextAction: 'preview' }, { status: 201 })
    }
    if (path === '/api/qingmu/change-sets/change-6:preview' && init?.method === 'POST' && proposal) {
      return Response.json({ schema: 'jason.qingmu-change-set-preview.v1', changeSet: changeSet(), baseScript: script,
        proposedScript: proposal.script, authoritativeCurrentScript: script, changeSetId: 'change-6', payloadSha256: digest(proposal.script),
        baseRevision: 1, authoritativeRevision: revision, changed: true, changedPaths: ['$.scenes[0].dialogues[0]'],
        authoritativeChangedPaths: [], revisionConflict: false, baseSnapshotConflict: false, canCommit: true,
        invalidatedStages: [], preflight: { status: 'pass' }, references: proposal.references, previewSha256: digest(proposal) })
    }
    if (path.endsWith('/change-sets/change-6/command-receipt')) return receipt
      ? Response.json({ schema: 'jason.qingmu-command-receipt-recovery.v1', recovered: true, receiptSha256: digest(receipt), receipt })
      : Response.json({ detail: { code: 'command_receipt_not_found' } }, { status: 404 })
    if (path === '/api/qingmu/change-sets/change-6:commit' && init?.method === 'POST' && proposal) {
      if (typeof init.body !== 'string') throw new Error('Expected a script commit body')
      const command = JSON.parse(init.body) as { idempotencyKey: string; expectedPayloadSha256: string; baseRevision: number }
      if (command.baseRevision !== revision || command.expectedPayloadSha256 !== digest(proposal.script)) {
        return Response.json({ detail: { code: 'script_revision_conflict' } }, { status: 409 })
      }
      script = structuredClone(proposal.script)
      revision++
      receipt = { schema: 'jason.qingmu-episode-script-commit-result.v1', changeSetId: 'change-6', commandReceiptId: 'saved-6', eventId: 'saved-event-6',
        projectId: scope.projectId, episodeId: scope.episodeId, baseRevision: 1, authoritativeRevision: revision,
        authoritativeSnapshotSha256: digest(script), payloadSha256: command.expectedPayloadSha256, idempotencyKey: command.idempotencyKey,
        changed: true, invalidatedStages: [], deduplicated: false, committedAt: timestamp }
      return Response.json(receipt)
    }
    throw new Error(`Unexpected Writer fixture request: ${init?.method} ${path}`)
  })
  const read = createYimengReadHandler({}, { fetch, readToken: () => 'fixture-token' })
  const command = createYimengCommandHandler({}, { fetch, readToken: () => 'fixture-token', readYimeng: read })
  return {
    read, command, fetch, context: currentContext, relations,
    script: () => script, proposal: () => proposal, revision: () => revision,
  }
}

async function createQingmuAgent(ctx: Context, id: string): Promise<{ agent: Agent; dispose(): Promise<void> }> {
  return await ctx.agents.create({
    sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' },
    meta: { agentPreset: 'qingmu-director' },
    setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director'),
  })
}

describe('relay current-shot dialogue through the real preset and Writer adapters', () => {
  it.each([
    { mode: 'relay single-shot commit and continuation', relay: true, linkedSecondShot: false },
    { mode: 'relay linked second-shot stage without commit', relay: true, linkedSecondShot: true },
    { mode: 'ordinary linked second-shot commit', relay: false, linkedSecondShot: true },
  ])('should enforce $mode from actual Writer relations', async ({ relay, linkedSecondShot }) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No live network allowed in dialogue fixtures'))
    const upstream = dialogueWriter(linkedSecondShot)
    const before = upstream.context()
    const oldRelations = upstream.relations()
    // eslint-disable-next-line prefer-const -- adapter closures capture agent before harness creates it
    let agent: Agent
    const adapter = new MockAdapter([
      toolCallResponse('dialogue-read', 'qingmu_read_dialogue', {}),
      () => toolCallResponse('dialogue-stage', 'qingmu_stage_dialogue_edit', {
        receiptId: JSON.parse(resultText(agent.session.events, 'qingmu_read_dialogue')).receiptId,
        lineId: 'line-6', before: '有人吗？', after: '有人在吗？',
      }),
      () => toolCallResponse('dialogue-commit', 'qingmu_commit_dialogue_edit', {
        receiptId: JSON.parse(resultText(agent.session.events, 'qingmu_stage_dialogue_edit')).receiptId,
      }),
      toolCallResponse('dialogue-continue', 'qingmu_read_bound_context', {}), textResponse('Dialogue review finished; no media generated.'),
    ])
    const sessionRoot = await mkdtemp(join(tmpdir(), 'qingmu-relay-dialogue-')); roots.push(sessionRoot)
    const ctx = await harness(adapter, sessionRoot, true, '', [], upstream)
    const handle = await createQingmuAgent(ctx, `dialogue-${relay ? 'relay' : 'ordinary'}-${linkedSecondShot ? 'linked' : 'single'}`)
    agent = handle.agent
    const ownerId = relay ? 'relay-dialogue-batch' : 'browser-dialogue-test'
    const readPort = { async readDirectorContext(target: typeof scope, signal?: AbortSignal) {
      const response = await upstream.command('readDirectorContext', target, signal ?? new AbortController().signal)
      if (!response.ok) throw new Error(response.error.message)
      return { ok: true as const, context: response.value as DirectorContextSnapshot }
    } }
    const message = createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: JSON.stringify({ schema: 'qingmu.native-director-request.v1', sessionId: agent.session.id,
        ownerId, scope, contextSnapshotSha256: before.contextSnapshotSha256 }) },
      { type: 'text', text: '把当前镜头的有人吗？改成有人在吗？，继续核对本镜。' },
    ] })
    if (relay) {
      const now = new Date().toISOString()
      const initial = appendRelayState(agent.session, createRelayState({
        batchId: ownerId, projectId: scope.projectId, episodeId: scope.episodeId, instruction: '只准备当前镜头。',
        director: { provider: 'mock', model: 'mock' },
        shots: [{ scope, label: '当前镜头', retake: false,
          parameters: { duration: 4, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false } }],
        authorization: { authorizationId: 'relay-dialogue-authorization', paidConfirmed: true, maxCostCny: '1', maxCandidates: 1,
          expiresAt: new Date(Date.now() + 3600000).toISOString() },
      }, now), 0)
      const lease = claimHostDirectorBinding(agent.session, ownerId, readPort)
      ctx.effect(() => lease.release, 'dialogue-test-host-lease')
      expect(await lease.enter(scope)).toMatchObject({ status: 'current' })
      appendRelayState(agent.session, { ...initial, revision: 2,
        items: initial.items.map(item => ({ ...item, phase: 'preparing', admissions: [{
          message, contextSnapshotSha256: before.contextSnapshotSha256, admittedAt: now,
        }] })) }, initial.revision)
    } else {
      expect(await createDirectorContextBridge(readPort).enter(agent.session, scope, undefined, ownerId)).toMatchObject({ status: 'current' })
    }
    expect(await ctx.sessions.flush(agent.session)).toBe(true)
    agent.followup(message)
    await agent.whenIdle()
    function toolResult(callId: string) {
      const event = agent.session.events.find(event => event.type === 'tool/result' && event.data.message.source.callId === callId)
      if (event?.type !== 'tool/result') throw new Error(`Missing ${callId}: ${JSON.stringify(agent.session.events.at(-1))}`)
      return { error: event.data.message.content.some(part => part.isError),
        text: event.data.message.content.flatMap(part => part.content).filter(block => block.type === 'text').map(block => block.text).join('') }
    }
    const input = toolResult('dialogue-read'), staged = toolResult('dialogue-stage')
    expect(input.error, input.text).toBe(false)
    expect(staged.error, staged.text).toBe(false)
    const affectedShotIds = linkedSecondShot ? [scope.shotId, 'shot-7'] : [scope.shotId]
    const stage = JSON.parse(staged.text)
    expect(stage).toMatchObject({ proposalStored: true, businessStateChanged: false,
      preview: { affectedShots: affectedShotIds.map(shotId => ({ shotId })) } })
    expect(upstream.proposal()).toMatchObject({ references: [{ affectedShotIds }],
      script: { scenes: [{ dialogues: [{ line: '有人在吗？' }] }] } })
    const posts = upstream.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([input]) => new URL(input instanceof Request ? input.url : input).pathname)
    expect(posts.filter(path => path.endsWith('/script/change-sets'))).toHaveLength(1)
    expect(posts.filter(path => path.endsWith(':preview'))).toHaveLength(1)
    const saved = toolResult('dialogue-commit')
    const denied = relay && linkedSecondShot
    if (denied) {
      expect.soft(saved).toMatchObject({ error: true, text: expect.stringMatching(/relay/i) })
      expect.soft(posts.filter(path => path.endsWith(':commit')), 'Linked second shot must not be formally committed').toEqual([])
      expect.soft(upstream.revision()).toBe(1)
      expect.soft(upstream.relations()).toEqual(oldRelations)
      expect.soft(upstream.script().scenes[0]!.dialogues[0]!.line).toBe('有人吗？')
      expect.soft(agent.session.events.filter(event => event.type === 'qingmu-director-dialogue/state' && event.data.status === 'saved')).toEqual([])
    } else {
      expect(saved.error, saved.text).toBe(false)
      expect(JSON.parse(saved.text)).toMatchObject({ businessStateChanged: true, providerCalls: 0, mediaGenerated: false,
        continuation: { before: before.contextSnapshotSha256, after: upstream.context().contextSnapshotSha256 } })
      expect(posts.filter(path => path.endsWith(':commit'))).toEqual(['/api/qingmu/change-sets/change-6:commit'])
      expect(upstream.revision()).toBe(2)
      expect(upstream.script().scenes[0]!.dialogues[0]!.line).toBe('有人在吗？')
    }
    const continued = toolResult('dialogue-continue')
    expect(continued.error, continued.text).toBe(false)
    expect.soft(JSON.parse(continued.text)).toMatchObject({ contextSnapshot: { script: { revision: denied ? 1 : 2 } } })
    expect(adapter.requests).toHaveLength(5)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'completed' } } })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(await ctx.sessions.flush(agent.session)).toBe(true)
    const stored = await ctx.sessionPersistence.load(agent.session.id)
    expect(stored.events.filter(event => event.type === 'tool/result')).toEqual(agent.session.events.filter(event => event.type === 'tool/result'))
    await handle.dispose()
  })
})

describe('Qingmu model tools through a real preset and agent loop', () => {
  it('calculates a camera change in an unbound planning session and logs the result for the next director step', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('geometry', 'qingmu_check_camera_geometry', { layout: {
        coordinateFrame: 'x 向窗墙，y 向后墙；中心为原点，使用相对单位。',
        basis: '当前导演排练布局，位置是设计值，未从图片测量。',
        camera: { position: [4, 0], lookAt: [0, 0], horizontalFovDeg: 60 },
        landmarks: [
          { id: 'chair', label: '坐面朝窗墙的座椅', position: [0, 0], frontDirection: [1, 0] },
          { id: 'bench', label: '侧向座椅', position: [0, 0], frontDirection: [0, 1] },
        ],
      } }), textResponse('新机位看到座椅正面，保留布局。尚未保存或生成。'),
    ])
    const ctx = await harness(adapter)
    const handle = await createQingmuAgent(ctx, 'geometry-planning')
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '核对新机位。' }] }))
    await waitForIdle(ctx, handle.agent)
    const result = JSON.parse(resultText(handle.agent.session.events, 'qingmu_check_camera_geometry'))
    expect(result.relations[0]).toMatchObject({ facing: 'front_toward_camera', lateral: 0, depth: 4 })
    expect(result.relations[1]).toMatchObject({ facing: 'edge_on', frontDot: 0 })
    expect(result).toMatchObject({ providerCalls: 0, businessStateChanged: false })
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('front_toward_camera')
    expect(result).toMatchSnapshot('camera geometry through shipped preset')
    expect(ctx.tools.schemas()).toEqual([])
    await handle.dispose()
    const registry = ctx.tools
    await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
    expect(registry.get('qingmu_check_camera_geometry', handle.agent)).toBeUndefined()
  })
  it('projects saved 3D image cameras through the shipped tool and durable model result', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('image-camera', 'qingmu_check_camera_geometry', { layout: {
        coordinateFrame: 'metres; x/y ground, z up', basis: 'Authored layout; not image measurements', aspectRatio: '16:9',
        imageCamera: { position: [0, 0, 1], target: [0, 2, 1], verticalFov: 44 },
        landmarks: [{ id: 'head', label: 'Head', position: [0, 2, 1.6] }, { id: 'behind', label: 'Behind camera', position: [0, -1, 1] }],
      } }), textResponse('The second point is behind the camera; keep source positions and revise framing.'),
    ])
    const ctx = await harness(adapter), handle = await createQingmuAgent(ctx, 'image-camera-planning')
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Check this saved image camera.' }] }))
    await waitForIdle(ctx, handle.agent)
    const result = JSON.parse(resultText(handle.agent.session.events, 'qingmu_check_camera_geometry'))
    expect(result.relations[0].framing).toBe('inside_frame')
    expect(result.relations[1].horizontalPosition).toBe('behind_or_level_with_camera')
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('imagePosition')
    expect(result).toMatchSnapshot('saved image camera through shipped preset')
    await handle.dispose()
  })
  it('loads a full dialogue receipt through real persistence after a cold restart', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'qingmu-dialogue-cold-')); roots.push(sessionRoot)
    const notes = '大剧本正文'.repeat(30000)
    const initial = await harness(new MockAdapter([
      toolCallResponse('cold-read', 'qingmu_read_dialogue', {}), textResponse('已读取，尚未修改。'),
    ]), sessionRoot, true, notes)
    const handle = await createQingmuAgent(initial, 'dialogue-cold')
    bind(handle.agent)
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '读取这句台词。' }] }))
    await waitForIdle(initial, handle.agent)
    const view = JSON.parse(resultText(handle.agent.session.events, 'qingmu_read_dialogue'))
    await initial.sessions.flush(handle.agent.session)
    await initial.fiber.dispose(); contexts.splice(contexts.indexOf(initial), 1)
    const calls: string[] = []
    const resumed = await harness(new MockAdapter([
      toolCallResponse('cold-preview', 'qingmu_preview_dialogue_edit', {
        receiptId: view.receiptId, lineId: 'line-6', before: '有人吗？', after: '有人在吗？' }),
      textResponse('恢复原输入并核对影响，尚未修改。'),
    ]), sessionRoot, true, notes, calls)
    const restored = await resumed.agents.resume({ resumeSessionId: SessionId('dialogue-cold'),
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async agentCtx => void await resumed.agentPresets.mount(agentCtx, 'qingmu-director') })
    expect(findNativeDialogueInput(restored.agent.session, view.receiptId).source.script).toMatchObject({ sourceNotes: notes })
    restored.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '继续核对原台词。' }] }))
    await waitForIdle(resumed, restored.agent)
    expect(JSON.parse(resultText(restored.agent.session.events, 'qingmu_preview_dialogue_edit'))).toMatchObject({
      affectedShots: [{ frameNo: 6 }], unchangedDialogueShots: [{ frameNo: 7 }] })
    expect(calls).not.toContain('proposeScript'); expect(calls).not.toContain('commitScript')
    await restored.dispose()
  })
  it('stages a large script and recovers the successful Change Set without a second commit', async () => {
    const edit = { lineId: 'line-6', before: '有人吗？', after: '有人在吗？' }
    const adapter = new MockAdapter([
      toolCallResponse('read-large', 'qingmu_read_dialogue', {}),
      () => toolCallResponse('preview-large', 'qingmu_preview_dialogue_edit', {
        receiptId: JSON.parse(resultText(agent.session.events, 'qingmu_read_dialogue')).receiptId, ...edit }),
      () => toolCallResponse('stage-large', 'qingmu_stage_dialogue_edit', {
        receiptId: JSON.parse(resultText(agent.session.events, 'qingmu_read_dialogue')).receiptId, ...edit }),
      () => toolCallResponse('save-large', 'qingmu_commit_dialogue_edit', {
        receiptId: JSON.parse(resultText(agent.session.events, 'qingmu_stage_dialogue_edit')).receiptId }),
      () => toolCallResponse('recover-large', 'qingmu_commit_dialogue_edit', {
        receiptId: JSON.parse(resultText(agent.session.events, 'qingmu_stage_dialogue_edit')).receiptId }),
      textResponse('台词已保存，未提交视频。'),
    ])
    const calls: string[] = []
    const ctx = await harness(adapter, undefined, true, 'x'.repeat(350000), calls)
    const handle = await createQingmuAgent(ctx, 'large-script-commit'); const agent = handle.agent
    bind(agent)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '把有人吗？改成有人在吗？' }] }))
    await waitForIdle(ctx, agent)
    expect(calls.filter(name => name === 'commitScript')).toHaveLength(1)
    expect(calls.filter(name => name === 'proposeScript')).toHaveLength(1)
    const staged = JSON.parse(resultText(agent.session.events, 'qingmu_stage_dialogue_edit'))
    expect(staged.preview).not.toHaveProperty('proposedScript')
    expect(staged.preview).toMatchObject({ after: '有人在吗？', affectedShots: [{ frameNo: 6 }] })
    expect(agent.session.events.filter(e => e.type === 'tool/result').every(e => !e.data.message.content.some(p => p.isError))).toBe(true)
    await handle.dispose()
  })
  it.each([350000, 1100000])('bounds full-episode dialogue reads without truncation (%i bytes)', async (bytes) => {
    const adapter = new MockAdapter([toolCallResponse('read-dialogue', 'qingmu_read_dialogue', {}), textResponse('只读完成。')])
    const notes = 'x'.repeat(bytes)
    const ctx = await harness(adapter, undefined, true, notes)
    const handle = await createQingmuAgent(ctx, `large-dialogue-${bytes}`)
    bind(handle.agent)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '读取当前台词。' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, handle.agent)
    const result = resultText(handle.agent.session.events, 'qingmu_read_dialogue')
    if (bytes < 1048576) {
      const view = JSON.parse(result)
      expect(view).toMatchObject({ source: { fullScriptRetainedByHost: true } })
      expect(findNativeDialogueInput(handle.agent.session, view.receiptId).source.script).toMatchObject({ sourceNotes: notes })
      expect(Buffer.byteLength(result)).toBeLessThan(48000)
      expect(includesExactString(adapter.requests[1]?.messages, notes)).toBe(false)
    } else {
      expect(result).toContain('exceeds maxOutputBytes; no content was truncated')
      expect(includesExactString(adapter.requests[1]?.messages, notes)).toBe(false)
    }
    expect(handle.agent.session.events.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['qingmu_read_dialogue'])
    await handle.dispose()
  })
  it('reads actual dialogue tool results and delivers the impact to the next native model request', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('read-dialogue', 'qingmu_read_dialogue', {}),
      () => {
        const input = JSON.parse(resultText(agent.session.events, 'qingmu_read_dialogue')) as { receiptId: string }
        return toolCallResponse('preview-dialogue', 'qingmu_preview_dialogue_edit', {
          receiptId: input.receiptId, lineId: 'line-6', before: '有人吗？', after: '有人在吗？',
        })
      },
      textResponse('直接修改镜6，镜7台词不变；还需判断声音和反应的影响。尚未保存或生成。'),
    ])
    const ctx = await harness(adapter, undefined, true, 'x'.repeat(350000))
    const handle = await createQingmuAgent(ctx, 'dialogue-preset')
    const agent = handle.agent
    bind(agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '把镜6的“有人吗？”改成“有人在吗？”。' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const preview = JSON.parse(resultText(agent.session.events, 'qingmu_preview_dialogue_edit'))
    expect(preview).toMatchObject({ affectedShots: [{ frameNo: 6 }], unchangedDialogueShots: [{ frameNo: 7 }],
      businessStateChanged: false })
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('有人在吗？')
    expect(includesExactString(adapter.requests[1]?.messages, draftMethod().sources[0]!.content)).toBe(true)
    expect(ctx.tools.schemas()).toEqual([])
    await handle.dispose()
  })
  it('logs model tool calls/results and presents both real bounded bodies to the next model request', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('read-context', 'qingmu_read_bound_context', {}),
      toolCallResponse('read-method', 'qingmu_get_imago_method', { capability: 'director_development' }),
      toolCallResponse('read-c5-feedback', 'qingmu_get_imago_method', { capability: 'shot_design', resourceId: 'rough_final_feedback' }),
      textResponse('已基于当前分镜上下文和导演方法给出建议。'),
    ])
    const ctx = await harness(adapter)
    const handle = await createQingmuAgent(ctx, 'qingmu-loop')
    bind(handle.agent)

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '读取当前上下文和导演方法。' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, handle.agent)

    const events = handle.agent.session.events
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['qingmu_read_bound_context', 'qingmu_get_imago_method', 'qingmu_get_imago_method'])
    expect(resultText(events, 'qingmu_read_bound_context')).toContain('铃声先响，她停在门口。')
    expect(resultText(events, 'qingmu_get_imago_method')).toContain('先确认人物意图与场景阻力')
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('铃声先响，她停在门口。')
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('先确认人物意图与场景阻力')
    const c5Call = events.filter(event => event.type === 'tool/call').at(-1)
    expect(c5Call?.type === 'tool/call' && JSON.parse(c5Call.data.arguments)).toEqual({ capability: 'shot_design', resourceId: 'rough_final_feedback' })
    const c5Result = events.filter(event => event.type === 'tool/result').at(-1)
    const c5Text = c5Result?.type === 'tool/result'
      ? c5Result.data.message.content.flatMap(part => part.content)
        .filter(block => block.type === 'text').map(block => block.text).join('')
      : ''
    expect(JSON.parse(c5Text)).toMatchObject({ method: { sources: [{ resourceId: 'rough_final_feedback', content: roughFinalFeedback }] } })
    // The exact complete fourth reference, not a summary or title, reaches the following model request.
    expect(includesExactString(adapter.requests[3]?.messages, roughFinalFeedback)).toBe(true)
    expect(ctx.tools.schemas()).toEqual([])
    expect(adapter.requests[0]?.system).toContain('你是青木的导演助手')
    expect(adapter.requests[0]?.system).toMatchSnapshot('shipped director persona')
    await handle.dispose()
  })

  it('keeps root and ordinary agents blind, while two Qingmu sessions stay independent and disposal unwinds one scope', async () => {
    const ctx = await harness(new MockAdapter([]))
    const first = await createQingmuAgent(ctx, 'qingmu-one')
    const second = await createQingmuAgent(ctx, 'qingmu-two')
    const ordinary = await ctx.agents.create({ sessionId: SessionId('ordinary'), agentOptions: { provider: 'mock', model: 'mock' } })
    bind(first.agent, '1'.repeat(64))
    bind(second.agent, '2'.repeat(64))

    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.schemas(ordinary.agent)).toEqual([])
    expect(ctx.tools.schemas(first.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_check_camera_geometry', 'qingmu_get_imago_method', 'qingmu_read_bound_context', 'qingmu_read_skill_resource', 'skill'])
    expect(ctx.tools.schemas(second.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_check_camera_geometry', 'qingmu_get_imago_method', 'qingmu_read_bound_context', 'qingmu_read_skill_resource', 'skill'])
    expect(first.agent.session.events.at(-1)?.data).toMatchObject({ binding: { contextSnapshotSha256: '1'.repeat(64) } })
    expect(second.agent.session.events.at(-1)?.data).toMatchObject({ binding: { contextSnapshotSha256: '2'.repeat(64) } })

    await first.dispose()
    expect(ctx.tools.schemas(second.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_check_camera_geometry', 'qingmu_get_imago_method', 'qingmu_read_bound_context', 'qingmu_read_skill_resource', 'skill'])
    expect(ctx.tools.schemas()).toEqual([])
    await second.dispose()
    await ordinary.dispose()
  })

  it('replays the persisted binding and preset, then executes the native read tool after a cold resume', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'qingmu-director-model-tools-session-'))
    roots.push(sessionRoot)
    const first = await harness(new MockAdapter([textResponse('seed')]), sessionRoot)
    const initial = await createQingmuAgent(first, 'qingmu-cold')
    bind(initial.agent)
    initial.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'seed log' }], source: { kind: 'user' } }))
    await waitForIdle(first, initial.agent)
    await first.sessions.flush(initial.agent.session)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const adapter = new MockAdapter([
      toolCallResponse('recovered-read', 'qingmu_read_bound_context', {}),
      textResponse('恢复后已读到当前分镜。'),
    ])
    const resumed = await harness(adapter, sessionRoot)
    const handle = await resumed.agents.resume({
      resumeSessionId: SessionId('qingmu-cold'), agentOptions: { provider: 'mock', model: 'mock' },
      setup: async agentCtx => void await resumed.agentPresets.mount(agentCtx, 'qingmu-director'),
    })
    expect(resumed.tools.schemas(handle.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_check_camera_geometry', 'qingmu_get_imago_method', 'qingmu_read_bound_context', 'qingmu_read_skill_resource', 'skill'])

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '恢复后读取。' }], source: { kind: 'user' } }))
    await waitForIdle(resumed, handle.agent)
    expect(resultText(handle.agent.session.events, 'qingmu_read_bound_context')).toContain('铃声先响，她停在门口。')
    await handle.dispose()
  })
})
