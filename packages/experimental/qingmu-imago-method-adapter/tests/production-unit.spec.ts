import { createHash, createHmac } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import {
  PRODUCTION_UNIT_REQUEST, productionUnitDefinition, productionUnitsFeed, productionUnitSha,
} from '../../qingmu-yimeng-read-adapter/tests/production-unit-fixture.ts'
import { apply, createImagoMethodHandler, inject } from '../src/index.ts'
import {
  attestProductionUnitMethod, buildProductionUnitSnapshot, parseProductionUnitMethodRequest, readProductionUnitRules,
} from '../src/production-unit.ts'
import type {
  ImagoProductionUnitMethodDefinition, ImagoProductionUnitMethodProjection,
  ImagoProductionUnitMethodResponse, ImagoProductionUnitMethodSnapshot,
} from '../src/types.ts'
import { WORKSET_RULE_PATHS } from '../src/workset.ts'

const KEY = 'unit-method-test-key-'.repeat(3)
const REQUEST = { ...PRODUCTION_UNIT_REQUEST, groupId: 'group-three' }
const PATHS = [...WORKSET_RULE_PATHS, 'scripts/compile_qingmu_element_method.py', 'scripts/compile_qingmu_production_unit_method.py']
const roots: string[] = []
const signal = () => new AbortController().signal

/** Synthetic current-rule files for boundary tests; only the final CLI case uses real Core. */
async function localRules() {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-unit-method-'))
  roots.push(root)
  const globalIds = ['A0', 'A1', 'A2', 'B1', 'B2aC', 'B2aS', 'B2aP', 'B2b', 'B2bL', 'C', 'C5', 'C5P', 'C5F', 'AR', 'ARF', 'B2aVP', 'B2aQC']
  const prototype = productionUnitDefinition()
  const contracts = [...globalIds.map(id => ({ stageId: id, roleId: id, scope: 'global' })),
    ...prototype.stages.map(stage => ({ ...stage, scope: 'per_lsu' }))].map((stage) => {
    const content = { stage_id: stage.stageId, owner_role: stage.roleId, scope: stage.scope,
      required_source_stage_bindings: [], required_lock_bindings: [], produces_lock: null }
    return { ...content, contract_sha256: productionUnitSha(content) }
  })
  const definition: ImagoProductionUnitMethodDefinition = { ...prototype, stages: contracts.filter(stage => stage.scope === 'per_lsu')
    .map(stage => ({ stageId: stage.stage_id, roleId: stage.owner_role, contractSha256: stage.contract_sha256 })) }
  const resolution = { internal_runtime_channel: 'V6_PRODUCTION_BETA', internal_contract_id: definition.version,
    controller: 'scripts/imago_v6_beta_ctl.py', workflow_spec: WORKSET_RULE_PATHS[3] }
  const json: Record<string, unknown> = {
    [WORKSET_RULE_PATHS[0]]: { schema: 'IMAGO-CurrentRuntimePointer-v1', status: 'ACTIVE', public_system_name: 'IMAGO OS', resolution },
    [WORKSET_RULE_PATHS[1]]: { schema: 'IMAGO-WorkflowChannelRegistry-v2', public_runtime_pointer: WORKSET_RULE_PATHS[0],
      system_scope: 'V6_ONLY', default_new_project_channel: 'V6_PRODUCTION_BETA', pre_v6_import_allowed: false,
      pre_v6_fallback_allowed: false, cross_version_lock_or_status_inheritance_allowed: false,
      channels: [{ channel_id: 'V6_PRODUCTION_BETA', workflow_family: 'V6', workflow_version: definition.version,
        fallback: false, pre_v6_project_import_allowed: false,
        controller: resolution.controller, workflow_spec: resolution.workflow_spec }] },
    [WORKSET_RULE_PATHS[2]]: { schema_version: '1.0.0-draft', workflow_version: definition.version, contracts },
    [WORKSET_RULE_PATHS[3]]: { active: true, status: 'PRODUCTION_BETA', workflow_version: definition.version,
      stages: contracts.map(stage => ({ id: stage.stage_id, owner_role: stage.owner_role, scope: stage.scope,
        depends_on: stage.required_source_stage_bindings, requires_locks: stage.required_lock_bindings,
        produces_lock: stage.produces_lock })),
      lsu_loop: { unit_id_pattern: 'LSU[0-9]{2,}', entry_stage: 'B2aVPROD', terminal_stage: 'LSUQC',
        stage_order: definition.stages.map(stage => stage.stageId), parallel_units_allowed: true,
        cross_lsu_continuity_required: true, rework_must_route_to_earliest_defect_owner: true,
        postproduction_owner: 'EXTERNAL_HUMAN_EDITOR', editing_compositing_mixing_mastering_are_out_of_scope: true } },
  }
  const hashes: Record<string, string> = {}
  for (const path of PATHS) {
    const raw = Object.hasOwn(json, path) ? JSON.stringify(json[path]) : `# synthetic source: ${path}\n`
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), raw)
    hashes[path] = createHash('sha256').update(raw).digest('hex')
  }
  return { root, hashes, definition, json }
}

function projection(
  snapshot: ImagoProductionUnitMethodSnapshot, rules: Awaited<ReturnType<typeof localRules>>,
): ImagoProductionUnitMethodProjection {
  return { schema: 'qingmu.imago-production-unit-method.v1', subject: snapshot.subject,
    subjectSnapshotSha256: snapshot.snapshotSha256, definition: rules.definition,
    ruleBindings: rules.hashes, rulesSha256: productionUnitSha(rules.hashes) }
}

function changedSource(patch: Record<string, unknown>) {
  const feed = productionUnitsFeed()
  const group = feed.groups[0]
  if (group?.subject === null || group === undefined) throw new Error('fixture group required')
  const subject = { ...group.subject, ...patch }
  return { ...feed, groups: [{ ...group, subject, snapshotSha256: productionUnitSha(subject) }] }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('production-unit method Host boundary', () => {
  it.each([
    null, {}, [], { ...REQUEST, unitId: 'LSU17' }, { ...REQUEST, subject: {} }, { ...REQUEST, snapshotSha256: 'a'.repeat(64) },
    { ...REQUEST, ruleBindings: {} }, { ...REQUEST, groupId: '' }, { ...REQUEST, groupId: ' group-three' },
    { ...REQUEST, groupId: '\u0085group-three' }, { ...REQUEST, episodeId: 'episode-unit\u001c' },
    { ...REQUEST, projectId: 'project\nunit' }, { ...REQUEST, groupId: '\ud800' }, { ...REQUEST, groupId: '🎬'.repeat(257) },
  ])('rejects browser-authored sources or noncanonical coordinates %# before a read', async (payload) => {
    const read = vi.fn()
    const compiler = vi.fn()
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), readProductionUnits: read, runProductionUnitCompiler: compiler,
    })
    expect(await handler('productionUnitMethod', payload, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(read).not.toHaveBeenCalled()
    expect(compiler).not.toHaveBeenCalled()
  })

  it('preserves FEFF, astral code-point limits, multiline original titles, and sparse frame numbers', () => {
    const request = { ...REQUEST, groupId: '\ufeff', episodeId: '🎬'.repeat(256) }
    expect(parseProductionUnitMethodRequest(request)).toEqual(request)
    const feed = changedSource({ ...request, title: '\ufeff', storyboardRevision: 0 })
    const source = { ...feed, projectId: request.projectId, episodeId: request.episodeId,
      groups: feed.groups.map(group => ({ ...group, groupId: request.groupId })) }
    const snapshot = buildProductionUnitSnapshot(request, source, continuityJson)
    expect(snapshot.subject).toEqual(source.groups[0]?.subject)
    expect(snapshot.subject.shots.map(shot => shot.frameNo)).toEqual([7, 12])
    expect(buildProductionUnitSnapshot(REQUEST, changedSource({ title: '🎬'.repeat(8000) }), continuityJson).subject.title)
      .toBe('🎬'.repeat(8000))
    const original = productionUnitsFeed()
    expect(buildProductionUnitSnapshot(REQUEST, original, continuityJson).subject.title).toBe(original.groups[0]?.subject?.title)
  })

  it.each([
    ['schema', 'legacy'], ['projectId', 'other'], ['episodeId', 'other'], ['groupId', 'other'],
    ['groupNo', 0], ['groupNo', true], ['storyboardRevision', -1], ['storyboardRevision', 0.5],
    ['storyboardRevision', Number.MAX_SAFE_INTEGER + 1], ['groupExecutionPromptSha256', 'bad'],
    ['title', '\u0085'], ['title', '\u001c'], ['title', 'a\u0000b'], ['title', '\ud800'], ['title', '🎬'.repeat(8001)],
    ['shots', []], ['shots', [{ frameId: 'frame-z', frameNo: 0, frameContentSha256: 'a'.repeat(64) }]],
    ['shots', [{ frameId: '\u001cframe-z', frameNo: 1, frameContentSha256: 'a'.repeat(64) }]],
  ])('rejects invalid selected-group source %s without accepting its rehashed digest', (field, value) => {
    expect(() => buildProductionUnitSnapshot(REQUEST, changedSource({ [field]: value }), continuityJson)).toThrow()
  })

  it('rejects duplicate or unordered member Shots, duplicate groups, and stale source hashes', () => {
    const feed = productionUnitsFeed()
    const group = feed.groups[0]
    if (group?.subject === null || group === undefined) throw new Error('fixture group required')
    const shots = group.subject.shots
    for (const members of [[shots[0], shots[0]], [...shots].reverse(), [shots[0], { ...shots[1], frameNo: 7 }]]) {
      expect(() => buildProductionUnitSnapshot(REQUEST, changedSource({ shots: members }), continuityJson)).toThrow()
    }
    for (const source of [
      { ...feed, groups: [group, group] }, { ...feed, groups: [] },
      { ...feed, groups: [{ ...group, snapshotSha256: 'f'.repeat(64) }] },
      { ...feed, groups: [{ ...group, subject: { ...group.subject, approved: true } }] },
      { ...feed, groups: [{ ...group, availability: { status: 'unavailable', reason: 'needs_repartition' }, subject: null, snapshotSha256: null }] },
    ]) expect(() => buildProductionUnitSnapshot(REQUEST, source, continuityJson)).toThrow()
  })

  it.each(['planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted'])('rejects an expanded feed boundary: %s', (field) => {
    const feed = productionUnitsFeed()
    expect(() => buildProductionUnitSnapshot(REQUEST, { ...feed, [field]: field === 'providerCalls' ? 1 : true }, continuityJson)).toThrow()
  })

  it('compiles only the fresh requested group and attests nine independently read rule files', async () => {
    const rules = await localRules()
    const feed = productionUnitsFeed()
    const read = vi.fn(async () => ({ ok: true as const, value: feed }))
    const compiler = vi.fn(async (snapshot: ImagoProductionUnitMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, {
      runCompiler: vi.fn(), readProductionUnits: read, runProductionUnitCompiler: compiler,
    })
    const requestSignal = signal()
    const result = await handler('productionUnitMethod', REQUEST, requestSignal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoProductionUnitMethodResponse
    expect(value.schema).toBe('qingmu.imago-production-unit-method-adapter-result.v1')
    expect(value.projection.subject).toEqual(feed.groups[0]?.subject)
    expect(Object.keys(value.projection.ruleBindings).sort()).toEqual([...PATHS].sort())
    expect(value.projection.definition).toEqual(rules.definition)
    expect(value.projectionSha256).toBe(productionUnitSha(value.projection))
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', KEY).update(continuityJson(unsigned), 'utf8').digest('hex'))
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenNthCalledWith(1, PRODUCTION_UNIT_REQUEST, requestSignal)
    expect(read).toHaveBeenNthCalledWith(2, PRODUCTION_UNIT_REQUEST, requestSignal)
    expect(compiler).toHaveBeenCalledExactlyOnceWith({ schema: 'qingmu.production-unit-method-snapshot.v1',
      subject: feed.groups[0]?.subject, snapshotSha256: feed.groups[0]?.snapshotSha256 }, expect.any(Object), requestSignal)
    expect(JSON.stringify(value)).not.toContain(KEY)
    expect(JSON.stringify(value)).not.toContain('LSU17')
  })

  it('ignores unrelated unavailable groups and changed history while preserving the selected-group source', async () => {
    const rules = await localRules()
    const feed = productionUnitsFeed()
    const read = vi.fn().mockResolvedValueOnce({ ok: true, value: feed }).mockResolvedValueOnce({ ok: true,
      value: { ...feed, capabilities: { canBindUnit: false }, bindings: [], groups: [...feed.groups,
        { groupId: 'other-group', subject: null, snapshotSha256: null, availability: { status: 'unavailable', reason: 'empty' } }] } })
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, { runCompiler: vi.fn(), readProductionUnits: read,
      runProductionUnitCompiler: async snapshot => projection(snapshot, rules) })
    expect(await handler('productionUnitMethod', REQUEST, signal())).toMatchObject({ ok: true })
  })

  it.each(['revision', 'members', 'prompt', 'unavailable'])('rejects selected-group %s drift after compiling', async (kind) => {
    const rules = await localRules()
    const changed = kind === 'revision' ? changedSource({ storyboardRevision: 4 })
      : kind === 'prompt' ? changedSource({ groupExecutionPromptSha256: 'e'.repeat(64) })
        : kind === 'members' ? changedSource({ shots: [{ frameId: 'frame-other', frameNo: 45, frameContentSha256: 'd'.repeat(64) }] })
          : { ...productionUnitsFeed(), groups: [] }
    const read = vi.fn().mockResolvedValueOnce({ ok: true, value: productionUnitsFeed() })
      .mockResolvedValueOnce({ ok: true, value: changed })
    const compiler = vi.fn(async (snapshot: ImagoProductionUnitMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, {
      runCompiler: vi.fn(), readProductionUnits: read, runProductionUnitCompiler: compiler,
    })
    expect(await handler('productionUnitMethod', REQUEST, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(compiler).toHaveBeenCalledOnce()
  })

  it('rejects rule drift even if the compiler returns the newly changed hashes', async () => {
    const rules = await localRules()
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, {
      runCompiler: vi.fn(), readProductionUnits: async () => ({ ok: true, value: productionUnitsFeed() }),
      runProductionUnitCompiler: async (snapshot) => {
        await writeFile(join(rules.root, 'scripts/compile_qingmu_production_unit_method.py'), '# changed during compilation\n')
        const current = await readProductionUnitRules(rules.root, continuityJson)
        return projection(snapshot, { ...rules, ...current })
      },
    })
    const result = await handler('productionUnitMethod', REQUEST, signal())
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    if (result.ok) throw new Error('changed rules must not be attested')
    expect(result.error.message).toContain('rules changed')
  })

  it.each(['subject', 'snapshot', 'version', 'owner', 'scope', 'contract', 'order', 'pattern', 'seal', 'approval', 'provider', 'path', 'sha', 'extra'])(
    'rejects forged compiler %s', async (kind) => {
      const rules = await localRules()
      const snapshot = buildProductionUnitSnapshot(REQUEST, productionUnitsFeed(), continuityJson)
      const raw = projection(snapshot, rules)
      const definition = { ...raw.definition,
        ...(kind === 'version' ? { version: 'legacy' } : {}), ...(kind === 'scope' ? { scope: 'global' } : {}),
        ...(kind === 'owner' ? { stages: raw.definition.stages.map(stage => ({ ...stage, roleId: 'other' })) } : {}),
        ...(kind === 'contract' ? { stages: raw.definition.stages.map(stage => ({ ...stage, contractSha256: '0'.repeat(64) })) } : {}),
        ...(kind === 'order' ? { stages: [...raw.definition.stages].reverse() } : {}),
        ...(kind === 'pattern' ? { unitIdPattern: '.*' } : {}), ...(kind === 'seal' ? { planSealingAllowed: true } : {}),
        ...(kind === 'approval' ? { stageApprovalAllowed: true } : {}), ...(kind === 'provider' ? { providerCalls: 1 } : {}),
      }
      const changed = { ...raw, definition,
        ...(kind === 'subject' ? { subject: { ...raw.subject, groupId: 'other' } } : {}),
        ...(kind === 'snapshot' ? { subjectSnapshotSha256: '0'.repeat(64) } : {}),
        ...(kind === 'path' ? { ruleBindings: { ...raw.ruleBindings, '/tmp/untrusted': '0'.repeat(64) } } : {}),
        ...(kind === 'sha' ? { rulesSha256: '0'.repeat(64) } : {}), ...(kind === 'extra' ? { unitId: 'LSU17' } : {}),
      }
      expect(() => attestProductionUnitMethod(changed, snapshot, rules, continuityJson, KEY)).toThrow()
    },
  )

  it.each(['inactive', 'fallback', 'contractSha', 'roleMismatch', 'loopOrder', 'loopPattern'])(
    'independently refuses invalid current rule sources: %s', async (kind) => {
      const rules = await localRules()
      const path = kind === 'fallback' ? WORKSET_RULE_PATHS[1] : kind === 'contractSha' ? WORKSET_RULE_PATHS[2] : WORKSET_RULE_PATHS[3]
      const value = rules.json[path] as Record<string, unknown>
      if (kind === 'inactive') value.active = false
      if (kind === 'fallback') value.pre_v6_fallback_allowed = true
      if (kind === 'contractSha') {
        const contract = (value.contracts as Record<string, unknown>[])[0]
        if (contract === undefined) throw new Error('fixture contract required')
        contract.contract_sha256 = '0'.repeat(64)
      }
      if (kind === 'roleMismatch') {
        const stage = (value.stages as Record<string, unknown>[])[17]
        if (stage === undefined) throw new Error('fixture stage required')
        stage.owner_role = 'other'
      }
      if (kind === 'loopOrder') (value.lsu_loop as Record<string, unknown>).stage_order = [...rules.definition.stages].reverse().map(stage => stage.stageId)
      if (kind === 'loopPattern') (value.lsu_loop as Record<string, unknown>).unit_id_pattern = '.*'
      await writeFile(join(rules.root, path), JSON.stringify(value))
      await expect(readProductionUnitRules(rules.root, continuityJson)).rejects.toThrow()
    },
  )

  it('fails closed without a reader or a valid key and preserves a source read error without retry', async () => {
    const compiler = vi.fn()
    const read = vi.fn(async () => ({ ok: false as const, error: { code: 'internal' as const, message: 'source refused', details: {} } }))
    const dependencies = { runCompiler: vi.fn(), runProductionUnitCompiler: compiler }
    expect(await createImagoMethodHandler({ coreRoot: '/not-read' }, dependencies)('productionUnitMethod', REQUEST, signal()))
      .toMatchObject({ ok: false })
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, { ...dependencies, readProductionUnits: read })
    expect(await handler('productionUnitMethod', REQUEST, signal())).toMatchObject({ ok: false, error: { message: 'source refused' } })
    expect(read).toHaveBeenCalledOnce()
    read.mockClear()
    for (const value of ['', 'short']) {
      vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', value)
      expect(await handler('productionUnitMethod', REQUEST, signal())).toMatchObject({ ok: false })
    }
    expect(read).not.toHaveBeenCalled()
    expect(compiler).not.toHaveBeenCalled()
  })

  it.each(['before', 'read', 'compiler', 'recheck'])('discards cancellation at the %s boundary, including late responses', async (when) => {
    const rules = await localRules()
    const controller = new AbortController()
    let reads = 0
    const read = vi.fn(async () => {
      reads += 1
      if (when === 'read' || (when === 'recheck' && reads === 2)) controller.abort()
      return { ok: true as const, value: productionUnitsFeed() }
    })
    const compiler = vi.fn(async (snapshot: ImagoProductionUnitMethodSnapshot) => {
      if (when === 'compiler') controller.abort()
      return projection(snapshot, rules)
    })
    if (when === 'before') controller.abort()
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, {
      runCompiler: vi.fn(), readProductionUnits: read, runProductionUnitCompiler: compiler,
    })
    expect(await handler('productionUnitMethod', REQUEST, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(read).toHaveBeenCalledTimes(when === 'before' ? 0 : when === 'recheck' ? 2 : 1)
    expect(compiler).toHaveBeenCalledTimes(when === 'before' || when === 'read' ? 0 : 1)
  })

  it('resolves the same optional read handler after unplug/reload and registers only loopback', async () => {
    const ctx = new Context()
    const handle = vi.fn((_channel: string, _handler: ConnectionRpcHandler, _options: ConnectionRpcHandlerOptions) => async () => {})
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    const method = ctx.plugin({ inject: [...inject], apply }, { coreRoot: '/not-read' })
    await method
    const handler = handle.mock.calls[0]?.[1]
    if (handler === undefined) throw new Error('handler required')
    const failure = { ok: false as const, error: { code: 'internal' as const, message: 'configured read reached', details: {} } }
    const read = vi.fn<ConnectionRpcHandler>(async () => failure)
    const plugin = { apply: (scope: Context) => { scope.provide('qingmuYimengRead', read) } }
    let reader = ctx.plugin(plugin)
    try {
      await reader
      expect(await handler('productionUnitMethod', REQUEST, signal())).toEqual(failure)
      await reader.dispose()
      expect(await handler('productionUnitMethod', REQUEST, signal())).toMatchObject({ ok: false })
      expect(await handler('elementMethod', {}, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
      reader = ctx.plugin(plugin)
      await reader
      expect(await handler('productionUnitMethod', REQUEST, signal())).toEqual(failure)
      expect(read).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenLastCalledWith('productionUnits', PRODUCTION_UNIT_REQUEST, expect.any(AbortSignal))
      expect(handle).toHaveBeenCalledExactlyOnceWith('/qingmu-imago-method', expect.any(Function), { authority: 'loopback' })
    } finally {
      await reader.dispose()
      await method.dispose()
    }
  })

  it('uses bounded stdin and a scrubbed environment on the existing subprocess runner', async () => {
    const rules = await localRules()
    const snapshot = buildProductionUnitSnapshot(REQUEST, productionUnitsFeed(), continuityJson)
    vi.stubEnv('PRODUCTION_UNIT_TEST_TOKEN', 'fake-test-token')
    vi.stubEnv('production_unit_test_password', 'fake-test-password')
    vi.stubEnv('production_unit_plain', 'ordinary-value')
    const script = [
      'import hashlib, json, os, re, sys', 'from pathlib import Path',
      'wire = sys.stdin.buffer.read()', 'snapshot = json.loads(wire)',
      'result = json.loads(Path("projection-template.json").read_text())',
      `paths = ${JSON.stringify(PATHS)}`,
      'bindings = {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in paths}',
      'result.update(subject=snapshot["subject"], subjectSnapshotSha256=snapshot["snapshotSha256"], ruleBindings=bindings, rulesSha256=hashlib.sha256(json.dumps(bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest())',
      'Path("process-receipt.json").write_text(json.dumps({"argv":sys.argv[1:], "cwd":os.getcwd(), "credential_names":[name for name in os.environ if re.search("key|token|secret|password", name, re.I)], "ordinary":os.environ.get("production_unit_plain"), "wire":wire.decode()}))',
      'print(json.dumps(result))',
    ].join('\n')
    await writeFile(join(rules.root, 'scripts/compile_qingmu_production_unit_method.py'), script)
    await writeFile(join(rules.root, 'projection-template.json'), JSON.stringify(projection(snapshot, rules)))
    const handler = createImagoMethodHandler({ coreRoot: rules.root }, { runCompiler: vi.fn(),
      readProductionUnits: async () => ({ ok: true, value: productionUnitsFeed() }) })
    expect(await handler('productionUnitMethod', REQUEST, signal())).toMatchObject({ ok: true })
    expect(JSON.parse(await readFile(join(rules.root, 'process-receipt.json'), 'utf8'))).toEqual({
      argv: ['-'], cwd: await realpath(rules.root), credential_names: [], ordinary: 'ordinary-value', wire: continuityJson(snapshot),
    })
  })

  it('rejects invalid output, nonzero exits, and either stream exceeding the cap without leaking stderr', async () => {
    for (const script of ['print("not-json")', 'import sys\nprint("fake-secret-from-child", file=sys.stderr)\nsys.exit(2)',
      'print("x" * (5 * 1024 * 1024 + 1))', 'import sys\nprint("x" * (5 * 1024 * 1024 + 1), file=sys.stderr)']) {
      const { root } = await localRules()
      await writeFile(join(root, 'scripts/compile_qingmu_production_unit_method.py'), script)
      const handler = createImagoMethodHandler({ coreRoot: root }, { runCompiler: vi.fn(),
        readProductionUnits: async () => ({ ok: true, value: productionUnitsFeed() }) })
      const result = await handler('productionUnitMethod', REQUEST, signal())
      expect(result).toMatchObject({ ok: false, error: { code: 'internal', message: 'IMAGO method compiler failed' } })
      expect(JSON.stringify(result)).not.toContain('fake-secret-from-child')
    }
  })

  it('kills and closes the production-unit child before timeout or cancellation returns', async () => {
    const script = 'import os, time\nfrom pathlib import Path\nPath("child-pid.txt").write_text(str(os.getpid()))\ntime.sleep(10)'
    for (const mode of ['timeout', 'cancel']) {
      const { root } = await localRules()
      await writeFile(join(root, 'scripts/compile_qingmu_production_unit_method.py'), script)
      const handler = createImagoMethodHandler({ coreRoot: root, timeoutMs: mode === 'timeout' ? 500 : 2000 }, { runCompiler: vi.fn(),
        readProductionUnits: async () => ({ ok: true, value: productionUnitsFeed() }) })
      const controller = new AbortController()
      const pending = handler('productionUnitMethod', REQUEST, controller.signal)
      if (mode === 'cancel') {
        await vi.waitFor(async () => { expect(Number(await readFile(join(root, 'child-pid.txt'), 'utf8'))).toBeGreaterThan(1) }, { timeout: 1000, interval: 10 })
        controller.abort()
      }
      expect(await pending).toMatchObject({ ok: false, error: { code: mode === 'timeout' ? 'internal' : 'cancelled' } })
      const pid = Number(await readFile(join(root, 'child-pid.txt'), 'utf8'))
      expect(Number.isSafeInteger(pid) && pid > 1).toBe(true)
      expect(() => process.kill(pid, 0)).toThrow()
    }
  })

  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT)('uses the actual current Core CLI without project state or Provider calls', async () => {
    const coreRoot = process.env.IMAGO_OS_CORE_ROOT
    if (coreRoot === undefined) throw new Error('Core root required')
    const feed = productionUnitsFeed()
    const read = vi.fn(async () => ({ ok: true as const, value: feed }))
    const handler = createImagoMethodHandler({ coreRoot }, { runCompiler: vi.fn(), readProductionUnits: read })
    const result = await handler('productionUnitMethod', REQUEST, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoProductionUnitMethodResponse
    expect(value.projection.subject).toEqual(feed.groups[0]?.subject)
    expect(value.projection.definition.stages).toHaveLength(6)
    expect(value.projection.definition).toMatchObject({ operation: 'bind_existing_shot_group',
      unitIdPattern: 'LSU[0-9]{2,}', planSealingAllowed: false, stageApprovalAllowed: false, providerCalls: 0 })
    expect(Object.keys(value.projection.ruleBindings).sort()).toEqual([...PATHS].sort())
    expect(value.projection.rulesSha256).toBe(productionUnitSha(value.projection.ruleBindings))
    expect(read).toHaveBeenCalledTimes(2)
  })
})
