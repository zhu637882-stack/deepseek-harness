import { createHash, createHmac } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STAGE_SOURCE_IDS, mutateSource, sourceCanonical, sourceObject, sourceSha, stageSource, stageSourceDefinition, stageSourcesFeed } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import { createImagoMethodHandler, inject } from '../src/index.ts'
import { attestStageSourceMethod, buildStageSourceSnapshot, parseStageSourceMethodRequest, readStageSourceRules, STAGE_SOURCE_RULE_PATHS } from '../src/stage-source.ts'
import type { ImagoStageSourceMethodProjection, ImagoStageSourceMethodResponse, ImagoStageSourceMethodSnapshot } from '../src/types.ts'

const KEY = 'stage-source-method-test-key-'.repeat(2)
const REQUEST = { ...STAGE_SOURCE_IDS, stageId: 'A1S' as const }
const CORE = process.env.IMAGO_OS_CORE_ROOT
const roots: string[] = []
const signal = () => new AbortController().signal

/** Synthetic current-rule files; only the explicitly named real CLI case uses actual Core. */
async function localRules() {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-stage-source-'))
  roots.push(root)
  const expected = { scope: 'global', owner_role: 'A1S', artifact_kind: 'SCREENPLAY_PACKAGE', canonical_output: 'inputs/screenplay-package.json',
    evidence_mode: 'HUMAN_TEXT_PLUS_MACHINE_PACKAGE', required_source_stage_bindings: ['A1'], required_lock_bindings: ['ACCEPTANCE_LOCK'],
    produces_lock: 'SCRIPT_LOCK', permissions: ['write_screenplay', 'revise_dialogue'],
    required_content_sections: ['canon_snapshot', 'complete_screenplay', 'scene_causality', 'character_arcs', 'dialogue_and_subtext',
      'duration_evidence', 'rewrite_ledger', 'h1_h2_h3_decisions', 'source_fact_graph'] }
  const contracts = ['A0', 'A1', 'A1S', ...Array.from({ length: 20 }, (_, index) => `fixture-${String(index)}`)].map((id) => {
    const content = { stage_id: id, owner_role: id, scope: 'global', required_source_stage_bindings: [] as string[],
      required_lock_bindings: [] as string[], produces_lock: null as string | null, ...(id === 'A1S' ? expected : {}) }
    return { ...content, contract_sha256: sourceSha(content) }
  })
  const a1s = contracts.find(item => item.stage_id === 'A1S')
  if (a1s === undefined) throw new Error('fixture A1S required')
  const definition = { ...stageSourceDefinition(), contractSha256: a1s.contract_sha256 }
  const resolution = { internal_runtime_channel: 'V6_PRODUCTION_BETA', internal_contract_id: definition.version,
    controller: 'scripts/imago_v6_beta_ctl.py', workflow_spec: 'pipeline/workflow-spec.v6.production-beta.json' }
  const json: Record<string, unknown> = {
    'pipeline/imago-os-current.json': { schema: 'IMAGO-CurrentRuntimePointer-v1', status: 'ACTIVE', public_system_name: 'IMAGO OS', resolution },
    'pipeline/workflow-channel-registry.json': { schema: 'IMAGO-WorkflowChannelRegistry-v2', public_runtime_pointer: 'pipeline/imago-os-current.json',
      system_scope: 'V6_ONLY', default_new_project_channel: 'V6_PRODUCTION_BETA', pre_v6_import_allowed: false, pre_v6_fallback_allowed: false,
      cross_version_lock_or_status_inheritance_allowed: false, channels: [{ channel_id: 'V6_PRODUCTION_BETA', workflow_family: 'V6',
        workflow_version: definition.version, fallback: false, pre_v6_project_import_allowed: false,
        controller: resolution.controller, workflow_spec: resolution.workflow_spec }] },
    'pipeline/v6-stage-contracts.json': { schema_version: '1.0.0-draft', workflow_version: definition.version, contracts },
    'pipeline/workflow-spec.v6.production-beta.json': { active: true, status: 'PRODUCTION_BETA', workflow_version: definition.version,
      stages: contracts.map(stage => ({ id: stage.stage_id, owner_role: stage.owner_role, scope: stage.scope,
        depends_on: stage.required_source_stage_bindings,
        requires_locks: stage.required_lock_bindings, produces_lock: stage.produces_lock })) },
  }
  const hashes: Record<string, string> = {}
  for (const path of STAGE_SOURCE_RULE_PATHS) {
    const raw = Object.hasOwn(json, path) ? JSON.stringify(json[path]) : `# synthetic rule ${path}\n`
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), raw)
    hashes[path] = createHash('sha256').update(raw).digest('hex')
  }
  return { root, json, hashes, definition }
}
function projection(
  snapshot: ImagoStageSourceMethodSnapshot, rules: Awaited<ReturnType<typeof localRules>>,
): ImagoStageSourceMethodProjection {
  return { schema: 'qingmu.imago-stage-source-method.v1', subject: snapshot.subject, subjectSnapshotSha256: snapshot.snapshotSha256,
    definition: rules.definition, ruleBindings: rules.hashes, rulesSha256: sourceSha(rules.hashes) }
}
beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs(); vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('source method input and current evidence', () => {
  it.each([null, {}, { ...REQUEST, stageId: 'A1' }, { ...REQUEST, source: {} }, { ...REQUEST, subject: {} },
    { ...REQUEST, snapshotSha256: 'a'.repeat(64) }, { ...REQUEST, methodProjection: {} }, { ...REQUEST, rulesSha256: 'a'.repeat(64) },
    ...[' x', 'x\u0085', '\u001cx', '\ud800', 'x\0y', 'x\ny', '🎬'.repeat(257)].map(episodeId => ({ ...REQUEST, episodeId })),
  ])('rejects invented inputs %# before reading or compiling', async (payload) => {
    const read = vi.fn(), compiler = vi.fn()
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, { runCompiler: vi.fn(), readStageSources: read, runStageSourceCompiler: compiler })
    expect(await handler('stageSourceMethod', payload, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(read).not.toHaveBeenCalled(); expect(compiler).not.toHaveBeenCalled()
  })
  it('preserves FEFF and code-point-boundary IDs, accepting zero and maximum safe source revisions', () => {
    for (const revision of [0, Number.MAX_SAFE_INTEGER]) {
      const request = { projectId: '\ufeff', episodeId: '🎬'.repeat(256), stageId: 'A1S' as const }
      const subject = { ...stageSource(), projectId: request.projectId, episodeId: request.episodeId,
        sourceId: request.episodeId, revision }
      expect(parseStageSourceMethodRequest(request)).toEqual(request)
      expect(buildStageSourceSnapshot(request, stageSourcesFeed(subject), sourceCanonical).subject).toEqual(subject)
    }
  })
  it.each([['sourceType', 'artifact'], ['sourceId', 'other'], ['projectId', 'other'], ['episodeId', 'other'], ['revision', true],
    ['revision', -1], ['revision', 0.1], ['revision', Number.MAX_SAFE_INTEGER + 1], ['contentSha256', 'a'.repeat(64) + '\n'], ['extra', true],
  ] as const)('rejects a rehashed invalid source %s', (field, value) => {
    const feed = stageSourcesFeed()
    mutateSource(feed, `source.${field}`, value)
    mutateSource(feed, 'subjectSnapshotSha256', sourceSha(feed.source))
    expect(() => buildStageSourceSnapshot(REQUEST, feed, sourceCanonical)).toThrow()
  })
  it('does not use old bindings when the current source is missing', () => {
    expect(() => buildStageSourceSnapshot(REQUEST, stageSourcesFeed(null), sourceCanonical)).toThrow()
    expect(() => buildStageSourceSnapshot(REQUEST, { ...stageSourcesFeed(), subjectSnapshotSha256: 'f'.repeat(64) }, sourceCanonical)).toThrow()
  })
  it('uses only four exact snapshot fields and signs independently checked current rules', async () => {
    const rules = await localRules()
    const read = vi.fn(async () => ({ ok: true as const, value: stageSourcesFeed() }))
    const compiler = vi.fn(async (snapshot: ImagoStageSourceMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, {
      runCompiler: vi.fn(), readStageSources: read, runStageSourceCompiler: compiler,
    })
    const result = await handler('stageSourceMethod', REQUEST, signal())
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoStageSourceMethodResponse
    expect(value.projection.subject).toEqual(stageSource())
    expect(value.projection.definition).toEqual(rules.definition)
    expect(value.projection.ruleBindings).toEqual(rules.hashes)
    expect(value.projectionSha256).toBe(sourceSha(value.projection))
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', KEY).update(sourceCanonical(unsigned)).digest('hex'))
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenNthCalledWith(1, STAGE_SOURCE_IDS, expect.any(AbortSignal))
    expect(read).toHaveBeenNthCalledWith(2, STAGE_SOURCE_IDS, expect.any(AbortSignal))
    expect(compiler.mock.calls[0]?.[0]).toEqual({ schema: 'qingmu.stage-source-method-snapshot.v1', stageId: 'A1S',
      subject: stageSource(), snapshotSha256: sourceSha(stageSource()) })
    expect(JSON.stringify(value)).not.toContain(KEY)
    expect(inject).toEqual(['connection'])
  })
  it.each(['revision', 'content', 'missing'])('rejects source %s drift during compilation', async (kind) => {
    const rules = await localRules()
    const changed = kind === 'missing' ? null : { ...stageSource(), ...(kind === 'revision' ? { revision: 4 } : { contentSha256: 'f'.repeat(64) }) }
    const read = vi.fn().mockResolvedValueOnce({ ok: true, value: stageSourcesFeed() })
      .mockResolvedValueOnce({ ok: true, value: stageSourcesFeed(changed) })
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, { runCompiler: vi.fn(), readStageSources: read,
      runStageSourceCompiler: async snapshot => projection(snapshot, rules) })
    expect(await handler('stageSourceMethod', REQUEST, signal())).toMatchObject({ ok: false })
  })
  it('does not require write capability to describe a readable source', async () => {
    const rules = await localRules()
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, { runCompiler: vi.fn(),
      readStageSources: async () => ({ ok: true, value: { ...stageSourcesFeed(), canBind: false } }),
      runStageSourceCompiler: async snapshot => projection(snapshot, rules) })
    expect(await handler('stageSourceMethod', REQUEST, signal())).toMatchObject({ ok: true })
  })
  it('rejects newly changed rule bytes even if the compiler returns their new hashes', async () => {
    const rules = await localRules()
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, { runCompiler: vi.fn(),
      readStageSources: async () => ({ ok: true, value: stageSourcesFeed() }), runStageSourceCompiler: async (snapshot) => {
        await writeFile(join(rules.root, 'scripts/compile_qingmu_stage_source_method.py'), '# changed\n')
        return projection(snapshot, { ...rules, ...await readStageSourceRules(rules.root, sourceCanonical) })
      } })
    const result = await handler('stageSourceMethod', REQUEST, signal())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('changed rules must not be attested')
    expect(result.error.message).toContain('rules changed')
  })
  it.each(['read', 'compiler'])('ignores cancellation during %s before signing', async (phase) => {
    const rules = await localRules(), abort = new AbortController()
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, { runCompiler: vi.fn(), readStageSources: async () => {
      if (phase === 'read') abort.abort()
      return { ok: true, value: stageSourcesFeed() }
    }, runStageSourceCompiler: async (snapshot) => { abort.abort(); return projection(snapshot, rules) } })
    expect(await handler('stageSourceMethod', REQUEST, abort.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
  it('fails closed when the read plugin or method key is unavailable', async () => {
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, { runCompiler: vi.fn() })
    expect(await handler('stageSourceMethod', REQUEST, signal())).toMatchObject({ ok: false })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    expect(await handler('stageSourceMethod', REQUEST, signal())).toMatchObject({ ok: false })
  })
})

describe('source method rule and output integrity', () => {
  it.each(['permissions', 'required_content_sections', 'evidence_mode', 'artifact_kind', 'canonical_output'])('requires full current A1S %s semantics even after rehash', async (field) => {
    const rules = await localRules()
    const document = sourceObject(rules.json['pipeline/v6-stage-contracts.json'])
    const contracts = document.contracts as Array<Record<string, unknown>>
    const a1s = contracts.find(item => item.stage_id === 'A1S')
    if (a1s === undefined) throw new Error('A1S required')
    a1s[field] = field === 'permissions' || field === 'required_content_sections' ? [] : 'other'
    const { contract_sha256: _old, ...content } = a1s
    a1s.contract_sha256 = sourceSha(content)
    await writeFile(join(rules.root, 'pipeline/v6-stage-contracts.json'), JSON.stringify(document))
    await expect(readStageSourceRules(rules.root, sourceCanonical)).rejects.toThrow('A1S')
  })
  it.each([['schema', 'other'], ['subject.revision', 4], ['subjectSnapshotSha256', 'f'.repeat(64)], ['definition.stageId', 'A1'],
    ['definition.contractSha256', 'f'.repeat(64)], ['definition.stageApprovalAllowed', true], ['definition.stageArtifactCreationAllowed', true],
    ['definition.providerCalls', 1], ['definition.scope', 'per_lsu'], ['ruleBindings', {}], ['rulesSha256', 'f'.repeat(64)], ['extra', true],
  ] as const)('does not attest forged compiler %s', async (path, value) => {
    const rules = await localRules()
    const snapshot = buildStageSourceSnapshot(REQUEST, stageSourcesFeed(), sourceCanonical)
    const raw = structuredClone(projection(snapshot, rules))
    mutateSource(raw, path, value)
    expect(() => attestStageSourceMethod(raw, snapshot, rules, sourceCanonical, KEY)).toThrow()
  })
  it.skipIf(!CORE)('runs the actual current Core CLI and verifies all nine raw file SHAs', async () => {
    if (CORE === undefined || CORE === '') throw new Error('Core root required')
    const handler = createImagoMethodHandler({ coreRoot: CORE }, {
      runCompiler: vi.fn(), readStageSources: async () => ({ ok: true, value: stageSourcesFeed() }),
    })
    const result = await handler('stageSourceMethod', REQUEST, signal())
    if (!result.ok) throw new Error(result.error.message)
    const reply = result.value as ImagoStageSourceMethodResponse
    for (const path of STAGE_SOURCE_RULE_PATHS) expect(reply.projection.ruleBindings[path]).toBe(createHash('sha256').update(await readFile(join(CORE, path))).digest('hex'))
    expect(reply.projection.rulesSha256).toBe(sourceSha(reply.projection.ruleBindings))
    expect(reply.projection.definition.sourceUsage).toBe('source_reference_only')
    expect(reply.projection.definition.stageArtifactCreationAllowed).toBe(false)
  })
})
