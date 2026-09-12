/**
 * Keyless native director session using the shipped Qingmu preset and real agent loop.
 *
 * Run from the Harness root (no Provider, network, or Writer DB):
 *   node --import tsx packages/experimental/qingmu-director-context-bridge/examples/model-tools-keyless.ts
 */

import { readStoryDraft } from '../src/story-draft.ts'
import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as Persona from '@deepseek-ai/dsh-persona'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as SkillResources from '../src/skill-resources.ts'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ModelTools from '../src/model-tools.ts'
import { draftContext, draftPrompt, draftMethod, firstDraftBootstrap } from './native-draft-fixture.ts'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import { readNativeDirectorReadiness } from '../src/native-readiness.ts'
import { importedScript, importedRelations } from './imported-dialogue-fixture.ts'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const scope = { projectId: 'example-project', episodeId: 'example-episode', sceneId: 'example-scene', shotId: 'example-shot' }
const contextSnapshotSha256 = 'a'.repeat(64)
const fourthReference = [
  '第四参考：粗剪到终版反馈闭环。',
  '逐镜比对锁定意图、表演、空间关系、声画线索和连续性。',
  '证据不足时保留未知，回到人工创作决定。',
].join('\n')

/** Deterministic external model stand-in; every request still comes from the native loop. */
class ExampleModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(readonly draftMode: boolean | 'first' | 'dialogue' | 'skills' | 'story' | 'assets' | 'scene' = false) { super() }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.requests.length
    this.requests.push(options)
    if (this.draftMode === 'story' || this.draftMode === 'assets' || this.draftMode === 'scene') {
      const calls = this.draftMode === 'scene' ? [
        { name: 'skill', args: { name: 'cinematic-director' } },
        { name: 'skill', args: { name: 'open-film-camera' } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'open-film-camera', path: 'references/cinematography-design-engine.md', lineCount: 500 } },
      ] : this.draftMode === 'assets' ? ['cinematic-director', 'character-asset', 'scene-asset', 'prop-asset'].map(name => ({ name: 'skill', args: { name } })) : [{ name: 'skill', args: { name: 'cinematic-director' } },
        { name: 'skill', args: { name: 'open-film-writer' } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'open-film-writer', path: 'references/screenplay-writing-core.md', lineCount: 500 } }]
      const call = calls[step]
      const block = call ? { type: 'tool-call' as const, id: CallId(`story-${step}`), name: call.name, arguments: JSON.stringify(call.args) }
        : { type: 'text' as const, text: this.draftMode === 'scene' ? '整场导演设计\n```txt\n' + JSON.stringify({ sourceScriptSha256: 'a'.repeat(64), sceneIndex: 1, shots: [{ title: '邀请进门', narrative: '允许来客接近', visual: '门内望向来客', action: '主人让出通道', durationSec: 6, dialogueLineIds: ['line1'], directorPlan: { cameraMovement: '跟随后停在听者肩后', performance: '观察后轻声邀请', soundPlan: { ambience: '对白中雨声持续' }, continuity: { start: '来客在门外持伞', end: '来客进门仍持伞' }, dialoguePlan: [{ sourceLineId: 'line1', character: '主人', line: '请进。', delivery: '迟疑后低声' }] } }] }) + '\n```' : this.draftMode === 'assets' ? '素材设计\n```txt\n{"assets":[{"kind":"prop","name":"桌扇","visualIdentity":"36厘米高的浅绿桌扇，电源线从后壳底部引出。","imagePrompt":"生成背面视角，85厘米高的工作台提供尺度对照。"}],"director":{"visualStyle":"写实","tone":"平实","lightingRules":"傍晚窗光","colorPalette":["灰蓝","浅绿"],"cameraGrammar":"随行动推进","performanceRules":"自然反应","characterContinuityRules":"服装和尺度保持一致"}}\n```' : '完整剧本\n```txt\n场景一：修理店·傍晚\n动作：父亲收起工具，女儿扶住门。\n老周：下班了。\n```' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: call ? 'tool-calls' : 'stop' } }
      return
    }
    if (this.draftMode === 'skills') {
      const calls = [
        { name: 'skill', args: { name: 'cinematic-director' } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'cinematic-director', path: 'references/sound-and-dialogue.md', lineCount: 500 } },
        { name: 'skill', args: { name: 'ai-visual-director' } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'ai-visual-director', path: 'engines/dialogue-engine.md', lineCount: 500 } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'ai-visual-director', path: 'sub-skills/create/SKILL.md', lineCount: 500 } },
        { name: 'skill', args: { name: 'open-film-writer' } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'open-film-writer', path: 'references/screenplay-writing-core.md', lineCount: 500 } },
        { name: 'skill', args: { name: 'open-film-camera' } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'open-film-camera', path: 'references/cinematography-design-engine.md', lineCount: 500 } },
        { name: 'qingmu_read_skill_resource', args: { skill: 'open-film-camera', path: 'references/production-contract.md', lineCount: 500 } },
      ]
      const call = calls[step]
      if (call !== undefined) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`skill-${step}`), name: call.name, arguments: JSON.stringify(call.args) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        const text = '创作方法已读取；剧本和导演决定多人对话、语气与运镜。此示例未保存设计或生成媒体。'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      return
    }
    if (step < 2) {
      const name = this.draftMode === 'dialogue' ? (step === 0 ? 'qingmu_read_dialogue' : 'qingmu_preview_dialogue_edit')
        : this.draftMode === 'first' ? (step === 0 ? 'qingmu_read_first_draft' : 'qingmu_propose_first_draft')
          : this.draftMode ? (step === 0 ? 'qingmu_read_prompt_draft' : 'qingmu_propose_prompt_edit')
            : step === 0 ? 'qingmu_read_bound_context' : 'qingmu_get_imago_method'
      const receiptId = JSON.stringify(options.messages).match(/receiptId\\?":\\?"([a-f0-9]{64})/u)?.[1]
      const args = this.draftMode === 'dialogue' ? (step === 0 ? {} : { receiptId, lineId: 'line_000003', before: '有人吗？', after: '请问，还有人在吗？' })
        : this.draftMode === 'first' ? (step === 0 ? {} : { receiptId, reason: '先交代空间，再推进动作与铃声。', ...draftPrompt.subject.editableProjection })
          : this.draftMode ? (step === 0 ? {} : { receiptId, field: 'imageGenPrompt',
            replacement: '她停在门口，门在画面左侧；背面中景，不要求正脸。', reason: '先明确门与人物位置，保留铃响后的停顿。' })
            : step === 0 ? {} : { capability: 'shot_design', resourceId: 'rough_final_feedback' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`read-${step}`), name, arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.draftMode === 'dialogue' ? '已按原台词编号预览修改，影响镜1；口型时序仍待核验。尚未保存或生成。'
        : '建议保留门口的停顿，先听见铃声，再看她的反应。尚未保存或生成。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

/**
 * Run an isolated, memory-only native session and return its model-visible evidence.
 * @returns the actual composed persona, tools, logged calls/results and next-request method check.
 * @throws if the shipped preset fails to load or the session cannot complete.
 */
export async function runNativeDirectorExample(draftMode: boolean | 'first' | 'dialogue' | 'skills' | 'story' | 'assets' | 'scene' = false) {
  const ctx = new Context()
  try {
    const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))
    ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.group = Group
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
        if (specifier === '@deepseek-ai/dsh-persona') return Persona
        if (specifier === '@deepseek-ai/dsh-compaction-basic') return BasicCompactionEngine
        if (specifier === '@deepseek-ai/dsh-skill-filesystem') return SkillFilesystem
        if (specifier === '@deepseek-ai/dsh-tool-skill') return ToolSkill
        if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/skill-resources') return SkillResources
        throw new Error(`unexpected example plugin: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Skills)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
    const model = new ExampleModel(draftMode)
    ctx.llm.registerAdapter(['keyless'], model)
    ctx.provide('qingmuYimengCommand', async (endpoint, payload) => {
      if (endpoint !== 'readDirectorContext' || JSON.stringify(payload) !== JSON.stringify(scope)) {
        throw new Error('example accepts only its session-bound context read')
      }
      if (draftMode) return { ok: true, value: draftContext }
      return { ok: true, value: {
        schema: 'jason.qingmu-director-context-snapshot.v1', ...scope, contextSnapshotSha256,
        shot: { id: scope.shotId, narrative: '门铃响起，她停在门口。' }, sourceScene: {}, selectedReferences: [],
        providerCalls: 0, costAmountCny: '0', businessStateChanged: false,
        humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false,
      } }
    })
    ctx.provide('qingmuImagoMethod', async (endpoint, payload) => {
      if (draftMode) {
        if (endpoint !== 'directorInstructions') throw new Error('No method write allowed')
        return { ok: true, value: draftMethod((payload as { resourceId?: 'rough_final_feedback' }).resourceId ?? null) }
      }
      if (endpoint !== 'directorInstructions' || JSON.stringify(payload) !== JSON.stringify({ capability: 'shot_design', resourceId: 'rough_final_feedback' })) {
        throw new Error('example accepts only the fixed C5 fourth-reference page')
      }
      return { ok: true, value: {
        schema: 'qingmu.imago-director-instructions.v1', capability: 'shot_design',
        requestedResourceId: 'rough_final_feedback', sourceBindings: [{ resourceId: 'rough_final_feedback', sha256: 'b'.repeat(64) }],
        sources: [{ resourceId: 'rough_final_feedback', content: fourthReference }],
      } }
    })
    if (draftMode) ctx.provide('qingmuYimengRead', async (endpoint) => {
      if (draftMode === 'dialogue' && endpoint === 'script') return { ok: true, value: importedScript }
      if (draftMode === 'dialogue' && endpoint === 'workflow') return { ok: true, value: {
        projectId: scope.projectId, episodeId: scope.episodeId, director: { shotRelations: importedRelations },
      } }
      if (endpoint === 'promptIrBootstrap') return { ok: true, value: firstDraftBootstrap }
      if (endpoint !== 'promptIr') throw new Error('No business write allowed')
      return { ok: true, value: draftPrompt }
    })
    const handle = await ctx.agents.create({
      sessionId: SessionId('keyless-model-tools-example'), agentOptions: { provider: 'keyless', model: 'fixture' },
      meta: { agentPreset: 'qingmu-director' },
      setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director'),
    })
    if (draftMode !== 'story' && draftMode !== 'assets' && draftMode !== 'scene') handle.agent.session.append('qingmu-director-context/state', {
      version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter',
    })
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === handle.agent && status === 'idle') { dispose(); resolve() }
      })
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: draftMode === 'scene' ? '当前为整场分镜设计，尚未绑定镜头。全剧关系从试探到信任；场景1门口，主人请来客进入，原对白line1：主人：请进。读导演与摄影方法后返回完整导演设计 JSON，来源SHA为' + 'a'.repeat(64) : draftMode === 'assets' ? '为当前修理店剧本设计定妆、场景和道具，返回 txt 块中的素材设计 JSON。' : draftMode === 'story' ? '写一场修理店关门的短剧，以 txt 代码块返回完整稿。' : draftMode === 'dialogue'
      ? '预览把“有人吗？”改成“请问，还有人在吗？”，暂不保存。' : '看看当前镜头，参考导演方法给我建议。' }], source: { kind: 'user' } }))
    await idle
    const ordinary = await ctx.agents.create({ sessionId: SessionId('ordinary-example'),
      agentOptions: { provider: 'keyless', model: 'fixture' } })
    const ordinaryReadiness = readNativeDirectorReadiness(ctx, ordinary.agent.session)
    await ordinary.dispose()
    const result = {
      readiness: readNativeDirectorReadiness(ctx, handle.agent.session), ordinaryReadiness,
      ...(draftMode && draftMode !== 'dialogue' && draftMode !== 'skills' && draftMode !== 'story' && draftMode !== 'assets' && draftMode !== 'scene' ? { draftProposal: await createDirectorContextRpcHandler(ctx.sessions, {
        readDirectorContext: async () => ({ ok: true, context: draftContext as DirectorContextSnapshot }),
      }, { prompt: ctx.qingmuYimengRead, method: ctx.qingmuImagoMethod })(draftMode === 'first' ? 'readNativeFirstDraftProposal' : 'readNativeDraftProposal', {
        sessionId: handle.agent.session.id, scope,
      }, new AbortController().signal) } : {}),
      ...(draftMode === 'scene' ? { sceneDraft: readStoryDraft(handle.agent.session.events.map(event => ({ event })), -1), cameraInRequest: JSON.stringify(model.requests[3]?.messages).includes('起点、中途和终点') } : {}),
      ...(draftMode === 'assets' ? { assetDraft: readStoryDraft(handle.agent.session.events.map(event => ({ event })), -1),
        sceneDesignInRequest: JSON.stringify(model.requests[4]?.messages).includes('### 1.1 叙事美术与场景丰富度') } : {}),
      ...(draftMode === 'story' ? { storyDraft: readStoryDraft(handle.agent.session.events.map(event => ({ event })), -1),
        writingInRequest: JSON.stringify(model.requests[3]?.messages).includes('screenplay-writing-core.md') } : {}),
      preset: ctx.agentPresets.composedPreset(handle.agent.ctx),
      system: model.requests[0]?.system,
      tools: model.requests[0]?.tools?.map(tool => tool.name).sort(),
      calls: handle.agent.session.events.filter(event => event.type === 'tool/call').map(event => event.data.name),
      results: handle.agent.session.events.filter(event => event.type === 'tool/result').map(event =>
        event.data.message.content.flatMap(part => part.content).filter(block => block.type === 'text').map(block => block.text).join('')),
      methodInNextRequest: JSON.stringify(model.requests[2]?.messages).includes('逐镜比对锁定意图'),
      ...(draftMode === 'skills' ? { creativeMethodsInNextRequest: {
        catalog: JSON.stringify(model.requests[0]?.messages).includes('cinematic-director'),
        director: JSON.stringify(model.requests[1]?.messages).includes('青木适用范围'),
        primaryMethod: JSON.stringify(model.requests[1]?.messages).includes('六部门共同完成一份设计'),
        assetDesign: JSON.stringify(model.requests[1]?.messages).includes('实际尺寸及相对于手'),
        dialogue: JSON.stringify(model.requests[2]?.messages).includes('Multiple speakers may share a frame'),
        visual: JSON.stringify(model.requests[3]?.messages).includes('AI Visual Director'),
        engine: JSON.stringify(model.requests[4]?.messages).includes('engines/dialogue-engine.md'),
        orchestration: JSON.stringify(model.requests[5]?.messages).includes('sub-skills/create/SKILL.md'),
        writing: JSON.stringify(model.requests[7]?.messages).includes('screenplay-writing-core.md'),
        camera: JSON.stringify(model.requests[9]?.messages).includes('起点、中途和终点'),
        promptReconstruction: JSON.stringify(model.requests[10]?.messages).includes('反向还原摄影机'),
      } } : {}),
      rootTools: ctx.tools.schemas().map(tool => tool.name),
    }
    await handle.dispose()
    return { ...result, inactiveReadiness: readNativeDirectorReadiness(ctx, handle.agent.session) }
  } finally {
    await ctx.fiber.dispose()
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runNativeDirectorExample(process.argv.includes('--scene') ? 'scene' : process.argv.includes('--assets') ? 'assets' : process.argv.includes('--story') ? 'story' : process.argv.includes('--dialogue') ? 'dialogue' : false), null, 2))
}
