import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImagoMethodHandler,
  type ImagoMethodAdapterDependencies,
} from '../src/index.ts'
import type {
  ImagoReferenceAssetMethodProjection,
  ImagoReferenceAssetMethodResponse,
  ImagoReferenceAssetMethodSnapshot,
} from '../src/types.ts'

const signal = () => new AbortController().signal
const INTEGRATION_CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const TEST_ATTESTATION_KEY = '  qingmu-reference-asset-attestation-key-原样  '

const REQUEST = {
  projectId: 'project-1',
  elementKind: 'prop',
  elementId: 'prop-1',
  profileRevision: 3,
  snapshotSha256: 'a'.repeat(64),
  assetId: 'asset-1',
  assetSha256: 'b'.repeat(64),
  operation: 'selectReferenceAsset',
} as const

const COMMON_SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
] as const
const SOURCE_KINDS = [
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'role_agent',
  'role_method',
  'method_reference',
] as const
const PROFILES = {
  actor: {
    methodId: 'imago-v6-b2ac-actor-reference-asset',
    sourcePaths: [
      ...COMMON_SOURCE_PATHS,
      'agents/b2a-art-director/character-designer/AGENTS.md',
      'skill-package/imago-b2ac-character-design/SKILL.md',
      'skill-package/imago-b2ac-character-design/references/character-costume-makeup-design-method.md',
    ],
    resource: 'actor_profile_snapshot',
  },
  scene: {
    methodId: 'imago-v6-b2as-scene-reference-asset',
    sourcePaths: [
      ...COMMON_SOURCE_PATHS,
      'agents/b2a-art-director/scene-designer/AGENTS.md',
      'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
      'skill-package/imago-b2as-scene-prop-fx-design/references/production-design-prop-research-method.md',
    ],
    resource: 'scene_profile_snapshot',
  },
  prop: {
    methodId: 'imago-v6-b2as-prop-reference-asset',
    sourcePaths: [
      ...COMMON_SOURCE_PATHS,
      'agents/b2a-art-director/scene-designer/AGENTS.md',
      'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
      'skill-package/imago-b2as-scene-prop-fx-design/references/production-design-prop-research-method.md',
    ],
    resource: 'prop_profile_snapshot',
  },
} as const
const FORBIDDEN_WORK = [
  'provider_dispatch',
  'asset_generation',
  'worker_start',
  'machine_suggestion_as_selection',
  'human_approval',
  'human_signoff',
  'comment_as_decision',
  'review_note_as_decision',
  'project_state_write',
] as const

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

function projection(snapshot: ImagoReferenceAssetMethodSnapshot): ImagoReferenceAssetMethodProjection {
  const profile = PROFILES[snapshot.target.elementKind]
  const operation = snapshot.target.operation
  return {
    schema: 'qingmu.imago-reference-asset-method-projection.v1',
    input_snapshot_sha256: canonicalSha256(snapshot),
    target: snapshot.target,
    method_definition: {
      id: profile.methodId,
      version: 1,
      sha256: 'c'.repeat(64),
      stage_contract_sha256: 'd'.repeat(64),
      role_capability_sha256: 'e'.repeat(64),
      agent_path: profile.sourcePaths[4],
      skill_path: profile.sourcePaths[5],
    },
    source_bindings: profile.sourcePaths.map((path, index) => ({
      kind: SOURCE_KINDS[index],
      path,
      sha256: 'f'.repeat(64),
    })),
    field_hints: [{ hint_id: 'selection-boundary', field: 'operation', title: '人工选择边界', guidance: '不得代选' }],
    checklist: [{ check_id: 'human-selection-required', label: '选择仍需认证人工明确操作', required: true }],
    work_order_projection: {
      target: snapshot.target,
      operation,
      allowed_mutations: [operation],
      required_read_set: [
        {
          source: 'yimeng',
          resource: profile.resource,
          id: snapshot.target.elementId,
          revision: snapshot.target.profileRevision,
          sha256: snapshot.target.snapshotSha256,
        },
        {
          source: 'yimeng',
          resource: 'reference_asset_candidate',
          id: snapshot.target.assetId,
          sha256: snapshot.target.assetSha256,
        },
      ],
      before_write: ['重新读取易梦权威资料'],
      after_write: ['停止在任何 Provider 调用之前'],
      providerCalls: 0,
      workerStarted: false,
    },
    review_card: {
      title: '参考资产操作审核',
      summary: '核对精确资料版本和人工选择边界。',
      review_dimensions: ['资料版本与快照 SHA'],
      hard_vetoes: ['不得把机器建议直接写成人工选择'],
      decision_boundary: '选择不是批准或签收。',
      comment_boundary: '评论不能承载正式决定。',
    },
    legal_work_set: {
      reads: [`yimeng_${snapshot.target.elementKind}_profile_snapshot`, 'yimeng_reference_asset_candidate'],
      writes: [operation === 'selectReferenceAsset'
        ? 'propose_reference_asset_selection_via_yimeng_changeset'
        : 'propose_reference_regeneration_via_yimeng_changeset'],
      invalidates: [],
      forbidden: FORBIDDEN_WORK,
    },
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    providerCalls: 0,
    workerStarted: false,
    human_approval_inferred: false,
    human_signoff_inferred: false,
    selection_executed: false,
  }
}

function dependencies(
  runReferenceAssetCompiler: NonNullable<ImagoMethodAdapterDependencies['runReferenceAssetCompiler']>,
): ImagoMethodAdapterDependencies {
  return { runCompiler: vi.fn(), runReferenceAssetCompiler }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_ATTESTATION_KEY) })
afterEach(() => { vi.unstubAllEnvs() })

describe('qingmu IMAGO reference-asset method adapter', () => {
  it('constructs the exact Yimeng authority snapshot and returns a dedicated target-bound attestation', async () => {
    const runReferenceAssetCompiler = vi.fn(async (snapshot: ImagoReferenceAssetMethodSnapshot) => projection(snapshot))
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runReferenceAssetCompiler),
    )

    const result = await handler('referenceAssetMethod', REQUEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('reference-asset method projection should pass')
    const value = result.value as ImagoReferenceAssetMethodResponse
    expect(value.schema).toBe('qingmu.imago-reference-asset-method-adapter-result.v1')
    expect(runReferenceAssetCompiler).toHaveBeenCalledWith({
      schema: 'qingmu.reference-asset-method-snapshot.v1',
      target: REQUEST,
      authority: {
        business_truth: 'yimeng',
        method_source: 'imago_os_current',
        human_approval: 'not_granted',
        paid_provider_authority: 'not_granted',
      },
    }, expect.objectContaining({ coreRoot: '/opt/imago-os-core' }), expect.any(AbortSignal))
    expect(value.methodAttestation).toEqual(expect.objectContaining({
      schema: 'qingmu.imago-reference-asset-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: value.projectionSha256,
      inputSnapshotSha256: value.projection.input_snapshot_sha256,
      targetSha256: canonicalSha256(REQUEST),
    }))
    expect(value.methodAttestation).not.toHaveProperty('subjectSha256')
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
  })

  it('binds all element kinds and both operations without executing selection or generation', async () => {
    for (const elementKind of ['actor', 'scene', 'prop'] as const) {
      for (const operation of ['selectReferenceAsset', 'requestReferenceRegeneration'] as const) {
        const handler = createImagoMethodHandler(
          { coreRoot: '/opt/imago-os-core' },
          dependencies(async snapshot => projection(snapshot)),
        )
        const result = await handler('referenceAssetMethod', {
          ...REQUEST,
          elementKind,
          elementId: `${elementKind}-1`,
          operation,
        }, signal())

        expect(result.ok).toBe(true)
        if (!result.ok) throw new Error(`${elementKind}/${operation} should pass`)
        const value = result.value as ImagoReferenceAssetMethodResponse
        expect(value.projection.method_definition).toMatchObject({ id: PROFILES[elementKind].methodId })
        expect(value.projection.source_bindings.map(binding => binding.path)).toEqual(PROFILES[elementKind].sourcePaths)
        expect(value.projection.work_order_projection).toMatchObject({
          target: value.projection.target,
          operation,
          allowed_mutations: [operation],
          providerCalls: 0,
          workerStarted: false,
        })
        expect(value.projection).toMatchObject({
          providerCalls: 0,
          workerStarted: false,
          selection_executed: false,
        })
      }
    }
  })

  it('rejects unknown input fields, invalid authority identifiers, unsafe revisions, and malformed hashes before Core', async () => {
    const runReferenceAssetCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runReferenceAssetCompiler),
    )
    const invalidPayloads = [
      { ...REQUEST, approval: 'approved' },
      { ...REQUEST, elementKind: 'character' },
      { ...REQUEST, elementId: ' ' },
      { ...REQUEST, profileRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...REQUEST, snapshotSha256: 'ABC' },
      { ...REQUEST, assetSha256: 'ABC' },
      { ...REQUEST, operation: 'generateReferenceAsset' },
    ]

    for (const payload of invalidPayloads) {
      const result = await handler('referenceAssetMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('invalid reference-asset input should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(runReferenceAssetCompiler).not.toHaveBeenCalled()
  })

  it('fails closed when Core changes target, source bindings, operation, authority, or zero-execution receipts', async () => {
    const variants = [
      (value: Record<string, unknown>): void => { value.unexpected = true },
      (value: Record<string, unknown>): void => {
        value.target = { ...(value.target as Record<string, unknown>), assetId: 'asset-2' }
      },
      (value: Record<string, unknown>): void => {
        value.source_bindings = PROFILES.actor.sourcePaths.map((path, index) => ({
          kind: SOURCE_KINDS[index],
          path,
          sha256: 'f'.repeat(64),
        }))
      },
      (value: Record<string, unknown>): void => {
        value.work_order_projection = {
          ...(value.work_order_projection as Record<string, unknown>),
          operation: 'requestReferenceRegeneration',
          allowed_mutations: ['requestReferenceRegeneration'],
        }
      },
      (value: Record<string, unknown>): void => { value.providerCalls = 1 },
      (value: Record<string, unknown>): void => { value.workerStarted = true },
      (value: Record<string, unknown>): void => { value.selection_executed = true },
      (value: Record<string, unknown>): void => { value.human_approval_inferred = true },
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
      const result = await handler('referenceAssetMethod', REQUEST, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forged reference-asset projection should fail')
      expect(result.error.message).toContain('projection contract failed')
    }
  })

  it('requires the same server-only attestation key and never runs Core when it is unavailable', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'short')
    const runReferenceAssetCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runReferenceAssetCompiler),
    )

    const result = await handler('referenceAssetMethod', REQUEST, signal())

    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'IMAGO method attestation is unavailable', details: {} },
    })
    expect(runReferenceAssetCompiler).not.toHaveBeenCalled()
  })

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current reference-asset compiler with no execution authority',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_reference_asset_method.py`)).toBe(true)
      const handler = createImagoMethodHandler({})

      const result = await handler('referenceAssetMethod', {
        ...REQUEST,
        projectId: '青木项目',
        elementId: '银色怀表',
        assetId: '怀表候选一',
      }, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoReferenceAssetMethodResponse
      expect(value.projection.method_definition).toEqual(expect.objectContaining({
        id: 'imago-v6-b2as-prop-reference-asset',
        version: 1,
      }))
      expect(value.projection).toMatchObject({
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      })
    },
  )
})
