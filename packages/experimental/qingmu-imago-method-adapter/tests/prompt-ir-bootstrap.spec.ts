import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImagoMethodHandler } from '../src/index.ts'
import type { ImagoPromptIrBootstrapMethodSnapshot } from '../src/types.ts'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const sha = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const CONTEXT = { schema: 'jason.qingmu-prompt-ir-bootstrap-context.v1', projectId: 'project-1', episodeId: 'episode-1',
  storyboard: { id: 'storyboard-1', version: 1, sourceHash: '1'.repeat(64) },
  frame: { id: 'frame-1' }, requiredReferences: [] }
const SOURCE_PATHS = ['pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json', 'pipeline/role-capability-spec.v6.json',
  'pipeline/v6-video-generation-routing-policy.json', 'agents/e-image-to-video/AGENTS.md',
  'skill-package/imago-e-kling-lsu-compiler/SKILL.md'] as const
const SOURCE_KINDS = ['runtime_pointer', 'runtime_channel_registry', 'stage_contracts', 'role_capability_spec',
  'prompt_ir_policy', 'role_agent', 'role_method'] as const

afterEach(() => { vi.unstubAllEnvs() })

describe('first PromptIR method Host adapter', () => {
  it('attests one exact zero-execution Draft projection and rejects context drift', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'prompt-ir-bootstrap-test-key-at-least-32-bytes')
    const compiler = vi.fn(async (snapshot: ImagoPromptIrBootstrapMethodSnapshot) => {
      const candidate = { editableProjection: { imageGenPrompt: '开场', lastFrameImagePrompt: '',
        videoGenPrompt: '缓慢前推', motionPrompt: '轻微运动', negativePrompt: '不新增元素' },
      subjectArray: [], advisoryOnly: true, status: 'Draft' }
      return { schema: 'qingmu.imago-prompt-ir-bootstrap-method-projection.v1',
        input_snapshot_sha256: sha(snapshot), context: snapshot.context,
        context_snapshot_sha256: snapshot.contextSnapshotSha256, candidate, candidate_sha256: sha(candidate),
        method_definition: { id: 'imago-v6-e-first-prompt-ir-bootstrap-method', version: 1,
          sha256: '2'.repeat(64), stage_contract_sha256: '3'.repeat(64), role_capability_sha256: '4'.repeat(64),
          prompt_ir_schema: 'IMAGO-V6-VideoPromptIR-v1', agent_path: SOURCE_PATHS[5], skill_path: SOURCE_PATHS[6] },
        source_bindings: SOURCE_PATHS.map((path, index) => ({ kind: SOURCE_KINDS[index], path, sha256: '5'.repeat(64) })),
        work_order_projection: { operation: 'compileFirstPromptIrDraft', allowed_mutations: [], required_read_set: [],
          providerCalls: 0, workerStarted: false }, project_state_persisted: false, providerCalls: 0,
        workerStarted: false, selection_executed: false, human_approval_inferred: false, human_signoff_inferred: false }
    })
    const handler = createImagoMethodHandler({ coreRoot: '/opt/imago-os-core' }, {
      runCompiler: vi.fn(), runPromptIrBootstrapCompiler: compiler,
    })
    const request = { context: CONTEXT, contextSnapshotSha256: sha(CONTEXT) }
    const result = await handler('promptIrBootstrapMethod', request, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { projection: { candidate: { status: 'Draft', advisoryOnly: true },
      providerCalls: 0, selection_executed: false }, methodAttestation: { contextSnapshotSha256: sha(CONTEXT) } } })
    expect(compiler).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error('expected method result')
    const value = result.value as {
      readonly projectionSha256: string
      readonly projection: { readonly candidate_sha256: string }
    }
    const unsignedChallenge = {
      schema: 'jason.qingmu-prompt-ir-bootstrap-selection-challenge.v1', actorId: 'owner',
      projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'storyboard-1', frameId: 'frame-1',
      draftPromptIrId: 'prompt-ir-1', draftVersion: 1, draftContentSha256: '6'.repeat(64),
      contextSnapshotSha256: sha(CONTEXT), methodProjectionSha256: value.projectionSha256,
      methodSha256: '2'.repeat(64), candidateSha256: value.projection.candidate_sha256,
      nonce: '7'.repeat(64), issuedAtUnix: Math.floor(Date.now() / 1000),
      expiresAtUnix: Math.floor(Date.now() / 1000) + 300,
    }
    const selectionChallenge = {
      ...unsignedChallenge,
      signature: createHmac('sha256', 'prompt-ir-bootstrap-test-key-at-least-32-bytes')
        .update('qingmu.prompt-ir-bootstrap.selection-challenge.v1\0')
        .update(canonical(unsignedChallenge)).digest('hex'),
    }
    const fresh = await handler('promptIrBootstrapMethod', { ...request, selectionChallenge }, new AbortController().signal)
    expect(fresh).toMatchObject({ ok: true, value: { selectionFreshnessAttestation: {
      schema: 'qingmu.imago-prompt-ir-bootstrap-selection-freshness-attestation.v1',
      challengeSha256: sha(selectionChallenge), projectionSha256: value.projectionSha256,
      contextSnapshotSha256: sha(CONTEXT), methodSha256: '2'.repeat(64),
      candidateSha256: value.projection.candidate_sha256,
    } } })
    expect(compiler).toHaveBeenCalledTimes(2)
    expect(await handler('promptIrBootstrapMethod', {
      ...request, selectionChallenge: { ...selectionChallenge, signature: '0'.repeat(64) },
    }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(compiler).toHaveBeenCalledTimes(2)
    expect(await handler('promptIrBootstrapMethod', { ...request, contextSnapshotSha256: '0'.repeat(64) },
      new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(compiler).toHaveBeenCalledTimes(2)
  })
})
