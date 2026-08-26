import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  createImagoMethodHandler,
  type ImagoMethodAdapterDependencies,
} from '../src/index.ts'
import type {
  ImagoElementMethodProjection,
  ImagoElementMethodResponse,
  ImagoElementMethodSnapshot,
} from '../src/types.ts'

const signal = () => new AbortController().signal
const INTEGRATION_CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const TEST_ATTESTATION_KEY = '  qingmu-imago-test-attestation-key-原样  '

const REQUEST = {
  projectId: 'project-1',
  targetType: 'element_profile',
  targetId: 'prop-1',
  elementKind: 'prop',
  scopeType: 'project',
  scopeId: 'project-1',
  baseRevision: 3,
  baseSnapshotSha256: 'a'.repeat(64),
} as const

const COMMON_SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
] as const
const METHOD_PROFILES = {
  actor: {
    methodId: 'imago-v6-b2ac-actor-profile',
    sourcePaths: [
      ...COMMON_SOURCE_PATHS,
      'agents/b2a-art-director/character-designer/AGENTS.md',
      'skill-package/imago-b2ac-character-design/SKILL.md',
      'skill-package/imago-b2ac-character-design/references/character-costume-makeup-design-method.md',
    ],
    operation: 'replaceVisualIdentity',
    reads: ['yimeng_actor_profile_snapshot'],
    writes: ['replace_visual_identity_via_changeset'],
    invalidates: ['official_actor_reference_projection'],
  },
  scene: {
    methodId: 'imago-v6-b2as-scene-profile',
    sourcePaths: [
      ...COMMON_SOURCE_PATHS,
      'agents/b2a-art-director/scene-designer/AGENTS.md',
      'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
      'skill-package/imago-b2as-scene-prop-fx-design/references/production-design-prop-research-method.md',
    ],
    operation: 'replaceVisualPrompt',
    reads: ['yimeng_scene_profile_snapshot'],
    writes: ['replace_visual_prompt_via_changeset'],
    invalidates: ['official_scene_reference_projection'],
  },
  prop: {
    methodId: 'imago-v6-b2as-prop-profile',
    sourcePaths: [
      ...COMMON_SOURCE_PATHS,
      'agents/b2a-art-director/scene-designer/AGENTS.md',
      'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
      'skill-package/imago-b2as-scene-prop-fx-design/references/production-design-prop-research-method.md',
    ],
    operation: 'replaceVisualPrompt',
    reads: ['yimeng_prop_profile_snapshot'],
    writes: ['replace_visual_prompt_via_changeset'],
    invalidates: ['official_prop_reference_projection'],
  },
} as const
const FORBIDDEN_WORK = ['provider_dispatch', 'asset_generation', 'asset_selection', 'human_decision', 'project_state_write'] as const

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort(compareUnicodeCodePoints).map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function projection(snapshot: ImagoElementMethodSnapshot): ImagoElementMethodProjection {
  const profile = METHOD_PROFILES[snapshot.subject.element_kind]
  return {
    schema: 'qingmu.imago-element-method-projection.v1',
    input_snapshot_sha256: canonicalSha256(snapshot),
    subject: snapshot.subject,
    method_definition: {
      id: profile.methodId,
      version: 1,
      sha256: 'c'.repeat(64),
      stage_contract_sha256: 'd'.repeat(64),
      role_capability_sha256: 'e'.repeat(64),
      agent_path: profile.sourcePaths[4],
      skill_path: profile.sourcePaths[5],
    },
    source_bindings: profile.sourcePaths.map((path, index) => ({ kind: `source-${String(index)}`, path, sha256: 'f'.repeat(64) })),
    field_hints: [{
      hint_id: 'story-function',
      field: snapshot.subject.element_kind === 'actor' ? 'visualIdentity' : 'visualPrompt',
      title: '叙事功能',
      guidance: '写清功能',
    }],
    checklist: [{ check_id: 'story-purpose-explicit', label: '功能明确', required: true }],
    work_order_projection: {
      target: {
        projectId: snapshot.subject.project_id,
        targetType: snapshot.subject.target_type,
        targetId: snapshot.subject.target_id,
        elementKind: snapshot.subject.element_kind,
        scopeType: snapshot.subject.scope_type,
        scopeId: snapshot.subject.scope_id,
      },
      operation: profile.operation,
      allowed_mutations: [profile.operation],
      required_read_set: [],
      before_write: [],
      after_write: [],
    },
    review_card: { title: '元素资料变更审核', hard_vetoes: ['不得占位'] },
    legal_work_set: {
      reads: profile.reads,
      writes: profile.writes,
      invalidates: profile.invalidates,
      forbidden: FORBIDDEN_WORK,
    },
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    paid_provider_authority: 'not_granted',
    human_approval_inferred: false,
    selection_authority: 'not_granted',
  }
}

function dependencies(
  runCompiler: ImagoMethodAdapterDependencies['runCompiler'],
): ImagoMethodAdapterDependencies {
  return { runCompiler }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_ATTESTATION_KEY) })
afterEach(() => { vi.unstubAllEnvs() })

describe('qingmu IMAGO method adapter', () => {
  it('registers one loopback-only Host Connection channel', () => {
    const handle = vi.fn((
      _channel: string,
      _handler: ConnectionRpcHandler,
      _options: ConnectionRpcHandlerOptions,
    ) => async () => {})
    const ctx = { connection: { rpc: { handle } } } as unknown as Context

    apply(ctx, { coreRoot: '/opt/imago-os-core' })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0]?.[0]).toBe('/qingmu-imago-method')
    expect(handle.mock.calls[0]?.[2]).toEqual({ authority: 'loopback' })
  })

  it('constructs the authority snapshot in the Host and returns a deterministic signed wrapper', async () => {
    const runCompiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => projection(snapshot))
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runCompiler),
    )

    const first = await handler('elementMethod', REQUEST, signal())
    const second = await handler('elementMethod', REQUEST, signal())

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    if (!first.ok) throw new Error('method projection should pass')
    const firstValue = first.value as ImagoElementMethodResponse
    expect(firstValue.schema).toBe('qingmu.imago-element-method-adapter-result.v1')
    expect(firstValue.projectionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(firstValue.methodAttestation).toEqual(expect.objectContaining({
      schema: 'qingmu.imago-element-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: firstValue.projectionSha256,
      inputSnapshotSha256: firstValue.projection.input_snapshot_sha256,
    }))
    const { signature, ...unsigned } = firstValue.methodAttestation
    expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
    expect(signature).not.toBe(createHmac('sha256', TEST_ATTESTATION_KEY.trim())
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
    expect(runCompiler).toHaveBeenCalledWith({
      schema: 'qingmu.element-method-snapshot.v1',
      subject: {
        project_id: 'project-1',
        target_type: 'element_profile',
        target_id: 'prop-1',
        element_kind: 'prop',
        scope_type: 'project',
        scope_id: 'project-1',
        base_revision: 3,
        base_snapshot_sha256: 'a'.repeat(64),
      },
      authority: {
        business_truth: 'yimeng',
        method_source: 'imago_os_current',
        human_approval: 'not_granted',
        paid_provider_authority: 'not_granted',
      },
    }, expect.objectContaining({ coreRoot: '/opt/imago-os-core' }), expect.any(AbortSignal))
  })

  it('binds actor, scene, and prop to their exact method IDs, sources, operations, and legal work sets', async () => {
    for (const elementKind of ['actor', 'scene', 'prop'] as const) {
      const profile = METHOD_PROFILES[elementKind]
      const targetId = `${elementKind}-1`
      const runCompiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => projection(snapshot))
      const handler = createImagoMethodHandler(
        { coreRoot: '/opt/imago-os-core' },
        dependencies(runCompiler),
      )
      const request = {
        ...REQUEST,
        targetId,
        elementKind,
      }

      const result = await handler('elementMethod', request, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(`${elementKind} method projection should pass`)
      const value = result.value as ImagoElementMethodResponse
      expect(value.projection.subject).toMatchObject({ target_id: targetId, element_kind: elementKind })
      expect(value.projection.method_definition).toMatchObject({
        id: profile.methodId,
        agent_path: profile.sourcePaths[4],
        skill_path: profile.sourcePaths[5],
      })
      expect(value.projection.source_bindings.map(binding => binding.path)).toEqual(profile.sourcePaths)
      expect(value.projection.work_order_projection).toMatchObject({
        operation: profile.operation,
        allowed_mutations: [profile.operation],
      })
      expect(value.projection.legal_work_set).toEqual({
        reads: profile.reads,
        writes: profile.writes,
        invalidates: profile.invalidates,
        forbidden: FORBIDDEN_WORK,
      })
      const compiledSnapshot = runCompiler.mock.calls[0]?.[0]
      expect(compiledSnapshot?.subject.element_kind).toBe(elementKind)
      expect(compiledSnapshot?.subject.target_id).toBe(targetId)
    }
  })

  it('uses canonical Unicode JSON for the Chinese input snapshot hash', async () => {
    const chineseRequest = {
      ...REQUEST,
      projectId: '青木项目',
      targetId: '银色怀表',
      scopeId: '青木项目',
    }
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async snapshot => projection(snapshot)),
    )

    const result = await handler('elementMethod', chineseRequest, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Chinese snapshot should pass')
    expect((result.value as ImagoElementMethodResponse).methodAttestation.inputSnapshotSha256)
      .toBe('e2d56b5424748e3bf86873701f93adc052777a0fe8496743dd21753f886dace4')
  })

  it('fails closed before compilation when the raw attestation key is missing, empty, or shorter than 32 UTF-8 bytes', async () => {
    for (const key of [undefined, '', '短密钥', ' '.repeat(31)]) {
      if (key === undefined) vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', undefined)
      else vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', key)
      const runCompiler = vi.fn()
      const handler = createImagoMethodHandler(
        { coreRoot: '/opt/imago-os-core' },
        dependencies(runCompiler),
      )

      const result = await handler('elementMethod', REQUEST, signal())

      expect(result).toEqual({
        ok: false,
        error: { code: 'internal', message: 'IMAGO method attestation is unavailable', details: {} },
      })
      if (key !== undefined && key !== '') expect(JSON.stringify(result)).not.toContain(key)
      else expect(JSON.stringify(result)).not.toContain('QINGMU_IMAGO_ATTESTATION_KEY')
      expect(runCompiler).not.toHaveBeenCalled()
    }
  })

  it('binds signature changes to projection, input snapshot, and subject hashes', async () => {
    const compile = async (snapshot: ImagoElementMethodSnapshot) => projection(snapshot)
    const handler = createImagoMethodHandler({ coreRoot: '/opt/imago-os-core' }, dependencies(compile))
    const projectionChangedHandler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async snapshot => ({
        ...projection(snapshot),
        field_hints: [{ hint_id: 'story-function', title: '叙事功能', guidance: '另一条合规提示' }],
      })),
    )
    const first = await handler('elementMethod', REQUEST, signal())
    const changedSubject = await handler('elementMethod', { ...REQUEST, targetId: 'prop-2' }, signal())
    const changedProjection = await projectionChangedHandler('elementMethod', REQUEST, signal())
    expect(first.ok && changedSubject.ok && changedProjection.ok).toBe(true)
    if (!first.ok || !changedSubject.ok || !changedProjection.ok) throw new Error('binding fixtures should pass')
    const base = (first.value as ImagoElementMethodResponse).methodAttestation
    const subject = (changedSubject.value as ImagoElementMethodResponse).methodAttestation
    const projected = (changedProjection.value as ImagoElementMethodResponse).methodAttestation
    expect(subject.inputSnapshotSha256).not.toBe(base.inputSnapshotSha256)
    expect(subject.subjectSha256).not.toBe(base.subjectSha256)
    expect(subject.signature).not.toBe(base.signature)
    expect(projected.projectionSha256).not.toBe(base.projectionSha256)
    expect(projected.inputSnapshotSha256).toBe(base.inputSnapshotSha256)
    expect(projected.subjectSha256).toBe(base.subjectSha256)
    expect(projected.signature).not.toBe(base.signature)
  })

  it('prefers a non-blank explicit Core root and falls back to the environment for blank config', async () => {
    vi.stubEnv('IMAGO_OS_CORE_ROOT', ' /srv/imago-env ')
    const explicitRunCompiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => projection(snapshot))
    const explicitHandler = createImagoMethodHandler(
      { coreRoot: ' /srv/imago-explicit ' },
      dependencies(explicitRunCompiler),
    )
    const explicitResult = await explicitHandler('elementMethod', REQUEST, signal())

    expect(explicitResult.ok).toBe(true)
    expect(explicitRunCompiler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ coreRoot: '/srv/imago-explicit' }),
      expect.any(AbortSignal),
    )

    const fallbackRunCompiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => projection(snapshot))
    const fallbackHandler = createImagoMethodHandler(
      { coreRoot: '   ' },
      dependencies(fallbackRunCompiler),
    )
    const fallbackResult = await fallbackHandler('elementMethod', REQUEST, signal())

    expect(fallbackResult.ok).toBe(true)
    expect(fallbackRunCompiler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ coreRoot: '/srv/imago-env' }),
      expect.any(AbortSignal),
    )
  })

  it('fails closed when the Core root is missing or an explicit non-blank value is invalid', () => {
    vi.stubEnv('IMAGO_OS_CORE_ROOT', '')
    expect(() => createImagoMethodHandler({})).toThrow('coreRoot must be an absolute path')

    vi.stubEnv('IMAGO_OS_CORE_ROOT', '/srv/imago-env')
    expect(() => createImagoMethodHandler({ coreRoot: 'relative/core' }))
      .toThrow('coreRoot must be an absolute path')
  })

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'sends a canonical UTF-8 Chinese snapshot to the reviewed current IMAGO compiler',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_element_method.py`)).toBe(true)
      const handler = createImagoMethodHandler({})
      const chineseRequest = {
        ...REQUEST,
        projectId: '青木项目',
        targetId: '银色怀表',
        scopeId: '青木项目',
      }
      const expectedSnapshot: ImagoElementMethodSnapshot = {
        schema: 'qingmu.element-method-snapshot.v1',
        subject: {
          project_id: '青木项目',
          target_type: 'element_profile',
          target_id: '银色怀表',
          element_kind: 'prop',
          scope_type: 'project',
          scope_id: '青木项目',
          base_revision: 3,
          base_snapshot_sha256: 'a'.repeat(64),
        },
        authority: {
          business_truth: 'yimeng',
          method_source: 'imago_os_current',
          human_approval: 'not_granted',
          paid_provider_authority: 'not_granted',
        },
      }
      const canonicalInputSha256 = createHash('sha256')
        .update(Buffer.from(canonicalJson(expectedSnapshot), 'utf8'))
        .digest('hex')
      const expectedInputSha256 = 'e2d56b5424748e3bf86873701f93adc052777a0fe8496743dd21753f886dace4'
      expect(canonicalInputSha256).toBe(expectedInputSha256)

      const result = await handler('elementMethod', chineseRequest, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoElementMethodResponse
      expect(value.projection.subject).toEqual(expectedSnapshot.subject)
      expect(value.projection.input_snapshot_sha256).toBe(expectedInputSha256)
      expect(value.methodAttestation.inputSnapshotSha256).toBe(expectedInputSha256)
      expect(value.projection.method_definition).toEqual(expect.objectContaining({
        id: 'imago-v6-b2as-prop-profile',
        version: 1,
      }))
      expect(value.projection.project_state_persisted).toBe(false)
      expect(value.projection.paid_provider_authority).toBe('not_granted')
      expect(value.projection.selection_authority).toBe('not_granted')
    },
  )

  it('rejects unknown fields, fake scope, unsafe revisions, and malformed SHA before execution', async () => {
    const runCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runCompiler),
    )

    for (const payload of [
      { ...REQUEST, humanApproval: 'approved' },
      { ...REQUEST, scopeId: 'project-2' },
      { ...REQUEST, elementKind: 'character' },
      { ...REQUEST, baseRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...REQUEST, baseSnapshotSha256: 'ABC' },
    ]) {
      const result = await handler('elementMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('invalid input should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(runCompiler).not.toHaveBeenCalled()
  })

  it('fails closed when compiler output changes subject or grants authority', async () => {
    const variants = [
      (value: Record<string, unknown>): void => {
        value.subject = { ...(value.subject as Record<string, unknown>), target_id: 'prop-2' }
      },
      (value: Record<string, unknown>): void => {
        value.method_definition = {
          ...(value.method_definition as Record<string, unknown>),
          id: METHOD_PROFILES.actor.methodId,
        }
      },
      (value: Record<string, unknown>): void => {
        value.source_bindings = METHOD_PROFILES.actor.sourcePaths
          .map((path, index) => ({ kind: `source-${String(index)}`, path, sha256: 'f'.repeat(64) }))
      },
      (value: Record<string, unknown>): void => {
        value.work_order_projection = {
          ...(value.work_order_projection as Record<string, unknown>),
          operation: 'replaceVisualIdentity',
          allowed_mutations: ['replaceVisualIdentity'],
        }
      },
      (value: Record<string, unknown>): void => { value.paid_provider_authority = 'granted' },
      (value: Record<string, unknown>): void => { value.selection_authority = 'granted' },
      (value: Record<string, unknown>): void => { value.human_approval_inferred = true },
      (value: Record<string, unknown>): void => { value.legal_work_set = { writes: ['direct_database_write'] } },
    ]

    for (const mutate of variants) {
      const handler = createImagoMethodHandler(
        { coreRoot: '/opt/imago-os-core' },
        dependencies(async (snapshot) => {
          const value = structuredClone(projection(snapshot))
          mutate(value)
          return value
        }),
      )
      const result = await handler('elementMethod', REQUEST, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forged projection should fail')
      expect(result.error.message).toContain('projection contract failed')
    }
  })

  it('maps cancellation and compiler failure without exposing execution details', async () => {
    const cancelledController = new AbortController()
    cancelledController.abort()
    const cancelledHandler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async () => { throw new Error('secret cancellation detail') }),
    )
    const failedHandler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async () => { throw new Error('secret compiler detail') }),
    )

    const cancelled = await cancelledHandler('elementMethod', REQUEST, cancelledController.signal)
    const failed = await failedHandler('elementMethod', REQUEST, signal())

    expect(cancelled).toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'IMAGO method request was cancelled', details: {} },
    })
    expect(failed).toEqual({
      ok: false,
      error: { code: 'internal', message: 'IMAGO method compiler failed', details: {} },
    })
    expect(JSON.stringify([cancelled, failed])).not.toContain('secret')
  })
})
