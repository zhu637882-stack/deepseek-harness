import { createHash, createHmac } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateSource, sourceCanonical, sourceSha } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import {
  STAGE_ARTIFACT_IDS, stageArtifact, stageArtifactSha,
} from '../../qingmu-yimeng-command-adapter/tests/stage-artifact-fixture.ts'
import { createImagoMethodHandler, inject } from '../src/index.ts'
import {
  attestStageArtifactMethod,
  buildStageArtifactSnapshot,
  parseStageArtifactMethodRequest,
  readStageArtifactRules,
  STAGE_ARTIFACT_RULE_PATHS,
  stageArtifactCanonicalJson,
} from '../src/stage-artifact.ts'
import type {
  ImagoStageArtifactMethodProjection,
  ImagoStageArtifactMethodResponse,
  ImagoStageArtifactMethodSnapshot,
} from '../src/types.ts'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT
const KEY = 'stage-artifact-method-test-key-'.repeat(2)
const roots: string[] = []
const signal = () => new AbortController().signal
const request = () => ({ ...STAGE_ARTIFACT_IDS, artifact: stageArtifact() })

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Stage artifact method input boundary', () => {
  it.each([
    null,
    {},
    { ...request(), approval: true },
    { ...request(), stageId: 'A1' },
    { ...request(), scopeInstance: 'LSU01' },
    { ...request(), artifact: { ...stageArtifact(), schema_version: 'other' } },
    { ...request(), artifact: { ...stageArtifact(), stage_id: 'A1' } },
    { ...request(), artifact: { ...stageArtifact(), open_issues: null } },
    ...[' x', 'x\u0085', '\u001cx', '\ud800', 'x\0y', 'x\ny', '🎬'.repeat(257)]
      .map(projectId => ({ ...request(), projectId })),
  ])('rejects invented authority or malformed envelope %# before compiling', async (payload) => {
    const compiler = vi.fn()
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), runStageArtifactCompiler: compiler,
    })
    expect(await handler('stageArtifactMethod', payload, signal())).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(compiler).not.toHaveBeenCalled()
  })

  it('binds exact canonical artifact bytes while retaining Stage-specific content fields', () => {
    const artifact = { ...stageArtifact(), extension_evidence: { checked: true } }
    const parsed = parseStageArtifactMethodRequest({ ...STAGE_ARTIFACT_IDS, artifact })
    const snapshot = buildStageArtifactSnapshot(parsed, stageArtifactCanonicalJson)
    expect(snapshot).toEqual({
      schema: 'qingmu.stage-artifact-method-snapshot.v1',
      subject: {
        schema: 'jason.qingmu-imago-stage-artifact.v1',
        ...STAGE_ARTIFACT_IDS,
        artifactRevision: artifact.artifact_revision,
        artifactSha256: stageArtifactSha(artifact),
      },
      subjectSnapshotSha256: sourceSha({
        schema: 'jason.qingmu-imago-stage-artifact.v1',
        ...STAGE_ARTIFACT_IDS,
        artifactRevision: artifact.artifact_revision,
        artifactSha256: stageArtifactSha(artifact),
      }),
      artifact,
    })
  })

  it('rejects a snapshot larger than the Core one-megabyte input ceiling', () => {
    const artifact = { ...stageArtifact(), extension_evidence: 'x'.repeat(1024 * 1024) }
    const parsed = parseStageArtifactMethodRequest({ ...STAGE_ARTIFACT_IDS, artifact })
    expect(() => buildStageArtifactSnapshot(parsed, stageArtifactCanonicalJson)).toThrow('exceeds Core input limit')
  })
})

describe.skipIf(!CORE_ROOT)('current Core Stage artifact compiler and Host attestation', () => {
  it('runs the real compiler, verifies every fixed rule SHA, and grants no downstream authority', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT })
    const reply = await handler('stageArtifactMethod', request(), signal())
    if (!reply.ok) throw new Error(reply.error.message)
    const value = reply.value as ImagoStageArtifactMethodResponse
    expect(Object.keys(value.projection.ruleBindings).sort()).toEqual([...STAGE_ARTIFACT_RULE_PATHS].sort())
    for (const path of STAGE_ARTIFACT_RULE_PATHS) {
      expect(value.projection.ruleBindings[path]).toBe(
        createHash('sha256').update(await readFile(join(CORE_ROOT, path))).digest('hex'),
      )
    }
    expect(value.projection.machineValidation).toMatchObject({ status: 'PASS' })
    expect(value.projection.definition).toMatchObject({
      stageArtifactRegistrationAllowed: true,
      dependencyAuthorityRequiredForApproval: true,
      dependencyAuthorityVerified: false,
      stageApprovalAllowed: false,
      lockActivationAllowed: false,
      lsuPlanSealingAllowed: false,
      reworkExecutionAllowed: false,
      providerCalls: 0,
    })
    expect(value.projectionSha256).toBe(sourceSha(value.projection))
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', KEY).update(sourceCanonical(unsigned)).digest('hex'))
    expect(JSON.stringify(value)).not.toContain(KEY)
    expect(inject).toEqual(['connection'])
  })

  it('keeps fractional, exponent-boundary, and negative-zero artifact SHA bytes aligned with real Core', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const artifact = stageArtifact()
    const numbers = { durationSeconds: 1.5, exponent: 1e-7, exponentBoundary: 1e-6, negativeZero: -0 }
    mutateSource(artifact, 'content.source_ledger.data', numbers)
    const canonical = stageArtifactCanonicalJson(artifact, 'artifact')
    expect(canonical).toContain('"exponent":1e-07')
    expect(canonical).toContain('"exponentBoundary":1e-06')
    expect(canonical).toContain('"negativeZero":-0.0')

    const reply = await createImagoMethodHandler({ coreRoot: CORE_ROOT })(
      'stageArtifactMethod', { ...STAGE_ARTIFACT_IDS, artifact }, signal(),
    )
    if (!reply.ok) throw new Error(reply.error.message)
    const value = reply.value as ImagoStageArtifactMethodResponse
    expect(value.projection.subject.artifactSha256).toBe(stageArtifactSha(artifact))
    expect(value.projection.machineValidation.status).toBe('PASS')
  })

  it.each([
    ['schema', 'other'],
    ['subject.artifactSha256', 'f'.repeat(64)],
    ['machineValidation.status', 'FAIL'],
    ['definition.stageApprovalAllowed', true],
    ['definition.roleId', 'A1'],
    ['ruleBindings', {}],
    ['rulesSha256', 'f'.repeat(64)],
    ['extra', true],
  ] as const)('does not attest forged compiler field %s', async (path, replacement) => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const real = await createImagoMethodHandler({ coreRoot: CORE_ROOT })('stageArtifactMethod', request(), signal())
    if (!real.ok) throw new Error(real.error.message)
    const raw = structuredClone((real.value as ImagoStageArtifactMethodResponse).projection) as Record<string, unknown>
    const parts = path.split('.')
    let target = raw
    for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>
    target[parts.at(-1) ?? ''] = replacement
    const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
      runCompiler: vi.fn(),
      runStageArtifactCompiler: vi.fn(async () => raw),
    })
    expect(await handler('stageArtifactMethod', request(), signal())).toMatchObject({ ok: false })
  })

  it('fails closed when one current Core rule changes during compilation', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const root = await mkdtemp(join(tmpdir(), 'qingmu-stage-artifact-rules-'))
    roots.push(root)
    for (const path of STAGE_ARTIFACT_RULE_PATHS) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await copyFile(join(CORE_ROOT, path), join(root, path))
    }
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      runStageArtifactCompiler: async (snapshot: ImagoStageArtifactMethodSnapshot) => {
        const rules = await readStageArtifactRules(
          root, snapshot.subject.stageId, snapshot.subject.scopeInstance, stageArtifactCanonicalJson,
        )
        const projection: ImagoStageArtifactMethodProjection = {
          schema: 'qingmu.imago-stage-artifact-method.v1',
          subject: snapshot.subject,
          subjectSnapshotSha256: snapshot.subjectSnapshotSha256,
          machineValidation: {
            status: 'PASS',
            validator: 'scripts/validate_v6_stage_contracts.py',
            validatedArtifactSha256: snapshot.subject.artifactSha256,
            contractSha256: rules.definition.contractSha256,
          },
          definition: rules.definition,
          ruleBindings: rules.hashes,
          rulesSha256: sourceSha(rules.hashes),
        }
        await writeFile(join(root, 'scripts/compile_qingmu_stage_artifact_method.py'), '# changed during compile\n')
        return projection
      },
    })
    expect(await handler('stageArtifactMethod', request(), signal())).toMatchObject({ ok: false })
  })

  it('honors cancellation before signing and fails closed without the method key', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const abort = new AbortController()
    const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
      runCompiler: vi.fn(),
      runStageArtifactCompiler: async () => { abort.abort(); return {} },
    })
    expect(await handler('stageArtifactMethod', request(), abort.signal)).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    expect(await createImagoMethodHandler({ coreRoot: CORE_ROOT })('stageArtifactMethod', request(), signal()))
      .toMatchObject({ ok: false })
  })

  it('independently rejects a forged current projection passed directly to the signer', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const snapshot = buildStageArtifactSnapshot(
      parseStageArtifactMethodRequest(request()), stageArtifactCanonicalJson,
    )
    const rules = await readStageArtifactRules(CORE_ROOT, 'A0', 'GLOBAL', stageArtifactCanonicalJson)
    expect(() => attestStageArtifactMethod({}, snapshot, rules, stageArtifactCanonicalJson, KEY)).toThrow()
  })
})
