/**
 * Keyless local snapshot for the two session-bound Qingmu model tools.
 *
 * Run from the Harness root (no Provider, network, Writer DB, or preset file):
 *   node --import tsx packages/experimental/qingmu-director-context-bridge/examples/model-tools-keyless.ts
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ModelTools from '../src/model-tools.ts'

const scope = { projectId: 'example-project', episodeId: 'example-episode', sceneId: 'example-scene', shotId: 'example-shot' }
const contextSnapshotSha256 = 'a'.repeat(64)
const fourthReference = [
  '第四参考：粗剪到终版反馈闭环。',
  '逐镜比对锁定意图、表演、空间关系、声画线索和连续性。',
  '证据不足时保留未知，回到人工创作决定。',
].join('\n')

async function main(): Promise<void> {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('qingmuYimengCommand', async (endpoint, payload) => {
      if (endpoint !== 'readDirectorContext' || JSON.stringify(payload) !== JSON.stringify(scope)) {
        throw new Error('example accepts only its session-bound context read')
      }
      return { ok: true, value: {
        schema: 'jason.qingmu-director-context-snapshot.v1', ...scope, contextSnapshotSha256,
        shot: { id: scope.shotId, narrative: '门铃响起，她停在门口。' }, sourceScene: {}, selectedReferences: [],
        providerCalls: 0, costAmountCny: '0', businessStateChanged: false,
        humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false,
      } }
    })
    ctx.provide('qingmuImagoMethod', async (endpoint, payload) => {
      if (endpoint !== 'directorInstructions' || JSON.stringify(payload) !== JSON.stringify({ capability: 'shot_design', resourceId: 'rough_final_feedback' })) {
        throw new Error('example accepts only the fixed C5 fourth-reference page')
      }
      return { ok: true, value: {
        schema: 'qingmu.imago-director-instructions.v1', capability: 'shot_design',
        requestedResourceId: 'rough_final_feedback', sourceBindings: [{ resourceId: 'rough_final_feedback', sha256: 'b'.repeat(64) }],
        sources: [{ resourceId: 'rough_final_feedback', content: fourthReference }],
      } }
    })
    const session = Session.create(SessionId('keyless-model-tools-example'))
    session.append('qingmu-director-context/state', {
      version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter',
    })
    const agent = { id: session.id, session } as Agent
    const scoped = createScope(ctx, agent)
    await scoped.ctx.plugin(ModelTools)

    const result = await ctx.tools.execute({
      callId: CallId('keyless-c5-reference'), name: 'qingmu_get_imago_method',
      arguments: { capability: 'shot_design', resourceId: 'rough_final_feedback' }, agent,
      signal: new AbortController().signal,
    })
    if (result.isError) throw new Error(result.error.message)
    console.log(JSON.stringify(result.value, null, 2))
    await scoped.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
}

await main()
