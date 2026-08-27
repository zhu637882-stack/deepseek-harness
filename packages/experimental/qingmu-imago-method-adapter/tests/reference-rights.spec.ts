import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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
const TEST_ATTESTATION_KEY = 'qingmu-reference-rights-attestation-key-原样'
const REQUEST = {
  projectId: 'project-1',
  elementKind: 'prop',
  elementId: 'prop-1',
  profileRevision: 3,
  snapshotSha256: 'a'.repeat(64),
  operation: 'replaceReferenceRights',
} as const
const EXCEPTION_RELEASE_REQUEST = {
  ...REQUEST,
  operation: 'recordReferenceRightsExceptionRelease',
} as const
const SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
  'agents/b2a-art-director/scene-designer/AGENTS.md',
  'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
  'skill-package/imago-b2as-scene-prop-fx-design/references/production-design-prop-research-method.md',
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
const FORBIDDEN = [
  'provider_dispatch',
  'asset_generation',
  'asset_selection',
  'human_decision',
  'project_state_write',
] as const
const EXCEPTION_RELEASE_FORBIDDEN = [
  'provider_dispatch',
  'asset_generation',
  'asset_selection',
  'rights_record_write',
  'subject_revision_write',
  'ordinary_human_decision_inference',
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

function projection(snapshot: ImagoElementMethodSnapshot): ImagoElementMethodProjection {
  const target = {
    projectId: snapshot.subject.project_id,
    targetType: snapshot.subject.target_type,
    targetId: snapshot.subject.target_id,
    elementKind: snapshot.subject.element_kind,
    scopeType: snapshot.subject.scope_type,
    scopeId: snapshot.subject.scope_id,
  }
  return {
    schema: 'qingmu.imago-element-method-projection.v1',
    input_snapshot_sha256: canonicalSha256(snapshot),
    subject: snapshot.subject,
    method_definition: {
      id: 'imago-v6-reference-rights-record',
      version: 1,
      sha256: 'c'.repeat(64),
      stage_contract_sha256: 'd'.repeat(64),
      role_capability_sha256: 'e'.repeat(64),
      agent_path: SOURCE_PATHS[4],
      skill_path: SOURCE_PATHS[5],
    },
    source_bindings: SOURCE_PATHS.map((path, index) => ({
      kind: SOURCE_KINDS[index],
      path,
      sha256: 'f'.repeat(64),
    })),
    field_hints: [{
      hint_id: 'rights-source-holder',
      field: 'rights',
      title: '来源与权利人',
      guidance: 'unknown 必须原样保留。',
    }],
    checklist: [{ check_id: 'rights-record-complete', label: '完整权利记录', required: true }],
    work_order_projection: {
      target,
      operation: 'replaceReferenceRights',
      allowed_mutations: ['replaceReferenceRights'],
      required_read_set: [{
        source: 'yimeng',
        resource: 'element_reference_rights_snapshot',
        revision: snapshot.subject.base_revision,
        sha256: snapshot.subject.base_snapshot_sha256,
      }],
      before_write: ['重新读取易梦权威资料'],
      after_write: ['仅通过易梦 Change Set 写路径替换权利记录'],
    },
    review_card: {
      title: '参考资产权利字段审核',
      summary: '核对完整记录和显式未知项。',
      review_dimensions: ['来源与授权依据'],
      hard_vetoes: ['不得把 unknown 写成已清权'],
      decision_boundary: '机器不产生权利批准、签收或异常放行结论。',
    },
    legal_work_set: {
      reads: ['yimeng_element_reference_rights_snapshot'],
      writes: ['replace_reference_rights_via_changeset'],
      invalidates: ['reference_rights_dependent_projection'],
      forbidden: FORBIDDEN,
    },
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    paid_provider_authority: 'not_granted',
    human_approval_inferred: false,
    selection_authority: 'not_granted',
  }
}

function exceptionReleaseProjection(snapshot: ImagoElementMethodSnapshot): ImagoElementMethodProjection {
  const base = projection(snapshot)
  return {
    ...base,
    method_definition: {
      ...base.method_definition,
      id: 'imago-v6-reference-rights-exception-release',
    },
    field_hints: [{
      hint_id: 'exception-exact-subject',
      field: 'rightsExceptionRelease',
      title: '精确对象绑定',
      guidance: 'IMAGO 只提供方法，不创建放行事实。',
    }],
    checklist: [{ check_id: 'exception-subject-binding-current', label: '复核精确绑定', required: true }],
    work_order_projection: {
      ...base.work_order_projection,
      operation: 'recordReferenceRightsExceptionRelease',
      allowed_mutations: ['recordReferenceRightsExceptionRelease'],
      before_write: ['重新读取易梦当前对象'],
      after_write: ['只通过易梦独立人类命令记录事实'],
    },
    review_card: {
      title: '参考资产权利异常放行复核',
      summary: '复核精确绑定与人工权限。',
      review_dimensions: ['对象与权利谱系'],
      hard_vetoes: ['不得由 IMAGO 产生放行事实'],
      decision_boundary: '只有易梦近期认证的独立人类命令可以记录异常放行。',
    },
    legal_work_set: {
      reads: ['yimeng_element_reference_rights_snapshot'],
      writes: ['record_reference_rights_exception_release_via_human_command'],
      invalidates: ['reference_rights_exception_release_projection'],
      forbidden: EXCEPTION_RELEASE_FORBIDDEN,
    },
  }
}

function dependencies(
  runReferenceRightsCompiler: NonNullable<ImagoMethodAdapterDependencies['runReferenceRightsCompiler']>,
): ImagoMethodAdapterDependencies {
  return { runCompiler: vi.fn(), runReferenceRightsCompiler }
}

function exceptionReleaseDependencies(
  runReferenceRightsExceptionReleaseCompiler:
  NonNullable<ImagoMethodAdapterDependencies['runReferenceRightsExceptionReleaseCompiler']>,
): ImagoMethodAdapterDependencies {
  return { runCompiler: vi.fn(), runReferenceRightsExceptionReleaseCompiler }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_ATTESTATION_KEY) })
afterEach(() => { vi.unstubAllEnvs() })

describe('qingmu IMAGO reference rights method adapter', () => {
  it('compiles exception-release guidance from subject lineage only through the existing method endpoint', async () => {
    const compiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => exceptionReleaseProjection(snapshot))
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      exceptionReleaseDependencies(compiler),
    )

    const result = await handler('referenceAssetMethod', EXCEPTION_RELEASE_REQUEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoElementMethodResponse
    expect(compiler).toHaveBeenCalledOnce()
    expect(compiler.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      schema: 'qingmu.element-method-snapshot.v1',
      subject: expect.objectContaining({
        project_id: 'project-1',
        target_id: 'prop-1',
        base_revision: 3,
        base_snapshot_sha256: 'a'.repeat(64),
      }),
    }))
    expect(value.projection.method_definition.id).toBe('imago-v6-reference-rights-exception-release')
    expect(value.projection.work_order_projection).toEqual(expect.objectContaining({
      operation: 'recordReferenceRightsExceptionRelease',
      allowed_mutations: ['recordReferenceRightsExceptionRelease'],
    }))
    expect(value.projection.legal_work_set).toEqual({
      reads: ['yimeng_element_reference_rights_snapshot'],
      writes: ['record_reference_rights_exception_release_via_human_command'],
      invalidates: ['reference_rights_exception_release_projection'],
      forbidden: EXCEPTION_RELEASE_FORBIDDEN,
    })
    const compiledInput = JSON.stringify(compiler.mock.calls[0]?.[0])
    for (const forbidden of [
      'reason',
      'rightsFields',
      'referenceAssetId',
      'referenceAssetSha256',
      'rightsRecordSha256',
      'assetId',
      'assetSha256',
      'actorId',
      'authSessionId',
    ]) {
      expect(compiledInput).not.toContain(forbidden)
    }
  })

  it('rejects exception-release decision fields before Core and forged method output after Core', async () => {
    const compiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => exceptionReleaseProjection(snapshot))
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      exceptionReleaseDependencies(compiler),
    )
    for (const payload of [
      { ...EXCEPTION_RELEASE_REQUEST, reason: 'browser reason' },
      { ...EXCEPTION_RELEASE_REQUEST, scope: {} },
      { ...EXCEPTION_RELEASE_REQUEST, rights: {} },
      { ...EXCEPTION_RELEASE_REQUEST, actorId: 'browser-actor' },
    ]) {
      const result = await handler('referenceAssetMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forbidden exception-release input should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(compiler).not.toHaveBeenCalled()

    const forged = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      exceptionReleaseDependencies(async snapshot => projection(snapshot)),
    )
    const forgedResult = await forged('referenceAssetMethod', EXCEPTION_RELEASE_REQUEST, signal())
    expect(forgedResult.ok).toBe(false)
    if (forgedResult.ok) throw new Error('forged exception-release method should fail')
    expect(forgedResult.error.message).toContain('projection contract failed')
  })

  it('strips asset transport lineage and returns the element-method attestation', async () => {
    const runReferenceRightsCompiler = vi.fn(async (snapshot: ImagoElementMethodSnapshot) => projection(snapshot))
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runReferenceRightsCompiler),
    )

    const result = await handler('referenceAssetMethod', REQUEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoElementMethodResponse
    expect(runReferenceRightsCompiler).toHaveBeenCalledWith({
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
    expect(JSON.stringify(runReferenceRightsCompiler.mock.calls[0]?.[0])).not.toContain('assetId')
    expect(JSON.stringify(value.projection)).not.toContain('assetId')
    expect(value.methodAttestation).toEqual(expect.objectContaining({
      schema: 'qingmu.imago-element-method-attestation.v1',
      inputSnapshotSha256: value.projection.input_snapshot_sha256,
      subjectSha256: canonicalSha256(value.projection.subject),
    }))
    expect(value.methodAttestation).not.toHaveProperty('targetSha256')
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
  })

  it('rejects rights drafts or authority fields before Core', async () => {
    const runReferenceRightsCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runReferenceRightsCompiler),
    )
    for (const payload of [
      { ...REQUEST, rights: {} },
      { ...REQUEST, humanApproval: true },
      { ...REQUEST, assetId: 'asset-1' },
      { ...REQUEST, assetSha256: 'b'.repeat(64) },
    ]) {
      const result = await handler('referenceAssetMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forbidden browser authority should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(runReferenceRightsCompiler).not.toHaveBeenCalled()
  })

  it('fails closed on forged assets, rights drafts, authority, or execution fields in the projection', async () => {
    const variants = [
      (value: Record<string, unknown>): void => { value.referenceAssetId = 'asset-1' },
      (value: Record<string, unknown>): void => { value.rights = {} },
      (value: Record<string, unknown>): void => { value.providerCalls = 1 },
      (value: Record<string, unknown>): void => { value.selection_authority = 'granted' },
      (value: Record<string, unknown>): void => {
        value.work_order_projection = {
          ...(value.work_order_projection as Record<string, unknown>),
          required_read_set: [],
        }
      },
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
      if (result.ok) throw new Error('forged rights projection should fail')
      expect(result.error.message).toContain('projection contract failed')
    }
  })

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current rights compiler through the existing endpoint',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_reference_rights_method.py`)).toBe(true)
      const result = await createImagoMethodHandler({})('referenceAssetMethod', REQUEST, signal())
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoElementMethodResponse
      expect(value.projection.method_definition).toMatchObject({
        id: 'imago-v6-reference-rights-record',
        version: 1,
      })
      expect(value.projection.legal_work_set).toEqual({
        reads: ['yimeng_element_reference_rights_snapshot'],
        writes: ['replace_reference_rights_via_changeset'],
        invalidates: ['reference_rights_dependent_projection'],
        forbidden: FORBIDDEN,
      })
    },
  )

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current exception-release compiler through the existing endpoint',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_reference_rights_exception_release_method.py`)).toBe(true)
      const result = await createImagoMethodHandler({})(
        'referenceAssetMethod',
        EXCEPTION_RELEASE_REQUEST,
        signal(),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoElementMethodResponse
      expect(value.projection.method_definition).toMatchObject({
        id: 'imago-v6-reference-rights-exception-release',
        version: 1,
      })
      expect(value.projection.work_order_projection).toEqual(expect.objectContaining({
        operation: 'recordReferenceRightsExceptionRelease',
        allowed_mutations: ['recordReferenceRightsExceptionRelease'],
      }))
      expect(value.projection.legal_work_set).toEqual({
        reads: ['yimeng_element_reference_rights_snapshot'],
        writes: ['record_reference_rights_exception_release_via_human_command'],
        invalidates: ['reference_rights_exception_release_projection'],
        forbidden: EXCEPTION_RELEASE_FORBIDDEN,
      })
    },
  )
})
