import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, createImagoMethodHandler, inject } from '../src/index.ts'
import type { ImagoWorksetMethodSnapshot } from '../src/types.ts'
import {
  buildWorksetSnapshot,
  normalizeWorksetProjection,
  parseWorksetMethodRequest,
  readWorksetRuleHashes,
  WORKSET_RULE_PATHS,
} from '../src/workset.ts'

const REQUEST = { projectId: 'project-1', episodeId: 'episode-1' }
const temporaryRoots: string[] = []

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new Error('test fixture is not JSON')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function workflow(): Record<string, unknown> {
  return {
    schema: 'jason.episode-workflow-projection.v1',
    ...REQUEST,
    sourceRevision: { script: 7, storyboard: 12, production: 'revision-1' },
    inputFingerprint: 'legacy-fingerprint',
    stages: { script: { status: 'complete', isStale: false, sourceRunId: 'run-1' } },
    blockers: [],
    budget: { valid: true, remaining: 0.125 },
    release: { releaseReady: true },
  }
}

async function rules(): Promise<{ root: string; bindings: Record<string, string> }> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-workset-rules-'))
  temporaryRoots.push(root)
  for (const path of WORKSET_RULE_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), `rule:${path}\n`)
  }
  return { root, bindings: await readWorksetRuleHashes(root) }
}

function projection(snapshot: ImagoWorksetMethodSnapshot, bindings: Record<string, string>): Record<string, unknown> {
  return {
    schema: 'qingmu.imago-workset.v2',
    subject: snapshot.subject,
    source_projection_sha256: snapshot.source_projection_sha256,
    input_snapshot_sha256: sha(snapshot),
    rule_bindings: bindings,
    rules_sha256: sha(bindings),
    stage_definitions: [{
      stage_id: 'A0', stage_name: 'Source intake', scope: 'global', owner_role: 'A0',
      source_stage_ids: [], required_lock_ids: [], produces_lock_id: 'source_lock',
      contract_order: 0, contract_sha256: 'a'.repeat(64),
    }],
    work_items: [], legal_work_items: [], recommended_order: [], recommended_item: null,
    availability: {
      status: 'unavailable', authority_snapshot: 'unavailable',
      global_scope: 'unavailable', per_lsu_scope: 'unavailable',
      reason: 'authoritative_stage_evidence_unavailable',
    },
    blockers: [{ code: 'AUTHORITATIVE_STAGE_EVIDENCE_UNAVAILABLE', stage_id: null, scope_instance: null, lock_id: null }],
    shadow_comparison: {
      status: 'unavailable', reason: 'authoritative_stage_evidence_unavailable',
      comparison_scope: 'dependency_and_lock_readiness_only',
      activation_allowed: false, execution_equivalence_claimed: false, comparisons: [],
    },
    project_state_persisted: false, paid_provider_authority: 'not_granted',
    human_approval_inferred: false, authority_snapshot_attestation: 'not_verified_by_compiler',
    formal_activation_allowed: false,
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workset Host snapshot', () => {
  it('accepts only project and episode identity', () => {
    expect(parseWorksetMethodRequest({ projectId: ' project-1 ', episodeId: ' episode-1 ' })).toEqual(REQUEST)
    for (const input of [
      null, [], {}, { projectId: 'project-1' },
      { ...REQUEST, workflow: workflow() },
      { ...REQUEST, authority_snapshot: { status: 'approved' } },
      { ...REQUEST, coreRoot: '/other' },
      { ...REQUEST, execute: true },
      { ...REQUEST, episodeId: '' },
      { ...REQUEST, projectId: 'x\ny' },
    ]) expect(() => parseWorksetMethodRequest(input)).toThrow()
  })

  it('hashes complete normalized workflow and revision facts independently of the legacy fingerprint', () => {
    const source = workflow()
    const original = structuredClone(source)
    const snapshot = buildWorksetSnapshot(REQUEST, source, canonicalJson)
    expect(snapshot.source_projection_sha256).toBe(sha(source))
    expect(snapshot.subject.source_revision_sha256).toBe(sha(source.sourceRevision))
    expect(snapshot.subject.input_fingerprint).toBe('legacy-fingerprint')
    expect(source).toEqual(original)
    for (const changed of [
      { ...source, stages: { script: { status: 'blocked', isStale: true, sourceRunId: 'run-1' } } },
      { ...source, blockers: [{ reason: 'needs_review' }] },
      { ...source, sourceRevision: { script: 8, storyboard: 12, production: 'revision-1' } },
      { ...source, budget: { valid: false, remaining: 0.125 } },
      { ...source, release: { releaseReady: false } },
    ]) {
      const next = buildWorksetSnapshot(REQUEST, changed, canonicalJson)
      expect(next.subject.input_fingerprint).toBe(snapshot.subject.input_fingerprint)
      expect(next.source_projection_sha256).not.toBe(snapshot.source_projection_sha256)
    }
  })

  it('never converts legacy success or unknown approval fields to Stage or LSU authority', () => {
    const source = {
      ...workflow(),
      selected: true,
      qualityPassed: true,
      humanAuthorityReady: true,
      imago: { stage_evidence: { A0: { human_review: 'approved' } } },
      authority_snapshot: { status: 'available', stages: ['A0'], lsu_id: 'fake-lsu' },
    }
    const snapshot = buildWorksetSnapshot(REQUEST, source, canonicalJson)
    expect(snapshot.authority_snapshot).toEqual({
      status: 'unavailable', reason: 'authoritative_stage_evidence_unavailable',
    })
    expect(Object.keys(snapshot).sort()).toEqual(['authority_snapshot', 'schema', 'source_projection_sha256', 'subject'])
    expect(JSON.stringify(snapshot)).not.toContain('approved')
    expect(JSON.stringify(snapshot)).not.toContain('fake-lsu')
  })

  it('rejects source scope or schema mismatches before compilation', () => {
    for (const source of [
      null,
      { ...workflow(), projectId: 'other-project' },
      { ...workflow(), episodeId: 'other-episode' },
      { ...workflow(), schema: 'legacy' },
      { ...workflow(), sourceRevision: null },
      { ...workflow(), inputFingerprint: '' },
    ]) expect(() => buildWorksetSnapshot(REQUEST, source, canonicalJson)).toThrow(/workflow source/)
  })

  it('keeps canonical object ordering stable without discarding finite fractional values', () => {
    const source = workflow()
    const reordered = Object.fromEntries(Object.entries(source).reverse())
    expect(buildWorksetSnapshot(REQUEST, reordered, canonicalJson)).toEqual(
      buildWorksetSnapshot(REQUEST, source, canonicalJson),
    )
    const changed = { ...source, budget: { valid: true, remaining: 0.126 } }
    expect(buildWorksetSnapshot(REQUEST, changed, canonicalJson).source_projection_sha256)
      .not.toBe(buildWorksetSnapshot(REQUEST, source, canonicalJson).source_projection_sha256)
  })

  it('reads all seven trusted local files and rejects a missing rule source', async () => {
    const { root, bindings } = await rules()
    expect(Object.keys(bindings)).toEqual([...WORKSET_RULE_PATHS])
    for (const path of WORKSET_RULE_PATHS) {
      expect(bindings[path]).toBe(createHash('sha256').update(`rule:${path}\n`).digest('hex'))
    }
    await rm(join(root, WORKSET_RULE_PATHS[6]))
    await expect(readWorksetRuleHashes(root)).rejects.toThrow()
  })
})

describe('workset compiler boundary', () => {
  it('accepts only exact input and independent local rule hashes', async () => {
    const { bindings } = await rules()
    const snapshot = buildWorksetSnapshot(REQUEST, workflow(), canonicalJson)
    const valid = projection(snapshot, bindings)
    expect(normalizeWorksetProjection(valid, snapshot, bindings, canonicalJson)).toEqual(valid)
    for (const changed of [
      { ...valid, schema: 'qingmu.imago-workset.v1' },
      { ...valid, subject: { ...snapshot.subject, episode_id: 'other' } },
      { ...valid, source_projection_sha256: 'b'.repeat(64) },
      { ...valid, input_snapshot_sha256: 'b'.repeat(64) },
      { ...valid, rules_sha256: 'b'.repeat(64) },
      { ...valid, rule_bindings: { ...bindings, [WORKSET_RULE_PATHS[0]]: 'b'.repeat(64) } },
      { ...valid, rule_bindings: { ...bindings, '../other': 'b'.repeat(64) } },
      { ...valid, command: 'activate' },
    ]) expect(() => normalizeWorksetProjection(changed, snapshot, bindings, canonicalJson)).toThrow()
  })

  it('rejects inferred availability, stage instances, executable claims, and malformed definitions', async () => {
    const { bindings } = await rules()
    const snapshot = buildWorksetSnapshot(REQUEST, workflow(), canonicalJson)
    const valid = projection(snapshot, bindings)
    for (const changed of [
      { ...valid, work_items: [{ stage_id: 'A0', status: 'blocked' }] },
      { ...valid, legal_work_items: [{ stage_id: 'A0', status: 'ready' }] },
      { ...valid, recommended_order: [{ stage_id: 'A0', scope_instance: 'global' }] },
      { ...valid, recommended_item: { stage_id: 'A0', scope_instance: 'global', allowed_action: 'prepare_work_order' } },
      { ...valid, availability: { status: 'available' } },
      { ...valid, blockers: [] },
      { ...valid, shadow_comparison: { status: 'compared', activation_allowed: true } },
      { ...valid, project_state_persisted: true },
      { ...valid, human_approval_inferred: true },
      { ...valid, paid_provider_authority: 'granted' },
      { ...valid, formal_activation_allowed: true },
      { ...valid, authority_snapshot_attestation: 'verified' },
      { ...valid, stage_definitions: [] },
      { ...valid, stage_definitions: [{ stage_id: 'A0' }] },
      { ...valid, stage_definitions: [null] },
    ]) expect(() => normalizeWorksetProjection(changed, snapshot, bindings, canonicalJson)).toThrow()
  })

  it('freshly reads only the requested subject and works without an HMAC key', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const { root, bindings } = await rules()
    const source = workflow()
    const readWorkflow = vi.fn(async () => ({ ok: true as const, value: source }))
    const runCompiler = vi.fn()
    const runWorksetCompiler = vi.fn(async (snapshot: ImagoWorksetMethodSnapshot) => projection(snapshot, bindings))
    const handler = createImagoMethodHandler({ coreRoot: root }, { runCompiler, runWorksetCompiler, readWorkflow })
    const signal = new AbortController().signal
    const result = await handler('worksetMethod', REQUEST, signal)
    expect(result).toEqual({
      ok: true,
      value: { schema: 'qingmu.imago-workset-method-adapter-result.v1', projection: projection(
        buildWorksetSnapshot(REQUEST, source, canonicalJson), bindings,
      ) },
    })
    expect(readWorkflow).toHaveBeenCalledExactlyOnceWith(REQUEST, signal)
    expect(runCompiler).not.toHaveBeenCalled()
    const previousHash = runWorksetCompiler.mock.calls[0]?.[0].source_projection_sha256
    source.blockers = [{ reason: 'changed-with-same-legacy-fingerprint' }]
    expect((await handler('worksetMethod', REQUEST, signal)).ok).toBe(true)
    expect(readWorkflow).toHaveBeenCalledTimes(2)
    expect(runWorksetCompiler.mock.calls[1]?.[0].source_projection_sha256).not.toBe(previousHash)
    expect((await handler('elementMethod', {}, signal)).ok).toBe(false)
  })

  it('does not compile invalid, failed, mismatched, or cancelled upstream reads', async () => {
    const { root, bindings } = await rules()
    const readWorkflow = vi.fn(async () => ({ ok: true as const, value: workflow() }))
    const runWorksetCompiler = vi.fn(async (snapshot: ImagoWorksetMethodSnapshot) => projection(snapshot, bindings))
    const handler = createImagoMethodHandler({ coreRoot: root }, { runCompiler: vi.fn(), readWorkflow, runWorksetCompiler })
    expect((await handler('worksetMethod', { ...REQUEST, approved: true }, new AbortController().signal)).ok).toBe(false)
    const aborted = new AbortController()
    aborted.abort()
    expect(await handler('worksetMethod', REQUEST, aborted.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(readWorkflow).not.toHaveBeenCalled()
    readWorkflow.mockResolvedValueOnce({ ok: true, value: { ...workflow(), episodeId: 'other-episode' } })
    expect((await handler('worksetMethod', REQUEST, new AbortController().signal)).ok).toBe(false)
    const cancelledDuringRead = new AbortController()
    readWorkflow.mockImplementationOnce(async () => {
      cancelledDuringRead.abort()
      return { ok: true, value: workflow() }
    })
    expect(await handler('worksetMethod', REQUEST, cancelledDuringRead.signal))
      .toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(runWorksetCompiler).not.toHaveBeenCalled()
    const failure = { ok: false as const, error: { code: 'bad-request' as const, message: 'read failed', details: { issues: [] } } }
    const failHandler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), runWorksetCompiler, readWorkflow: async () => failure,
    })
    expect(await failHandler('worksetMethod', REQUEST, new AbortController().signal)).toEqual(failure)
    expect(runWorksetCompiler).not.toHaveBeenCalled()
  })

  it('fails closed when rule sources change while compilation is in flight', async () => {
    const { root, bindings } = await rules()
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readWorkflow: async () => ({ ok: true, value: workflow() }),
      runWorksetCompiler: async (snapshot) => {
        await writeFile(join(root, WORKSET_RULE_PATHS[0]), 'changed-local-rule')
        return projection(snapshot, bindings)
      },
    })
    const result = await handler('worksetMethod', REQUEST, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    if (result.ok) throw new Error('changed local rules unexpectedly passed')
    expect(result.error.message).toContain('rule binding')
  })

  it('keeps other methods registered when the optional reader unloads, and reconnects on reload', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'k'.repeat(32))
    const ctx = new Context()
    const handle = vi.fn((_channel: string, _handler: ConnectionRpcHandler, _options: ConnectionRpcHandlerOptions) => async () => {})
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    const methodFiber = ctx.plugin({ inject: [...inject], apply }, { coreRoot: '/not-used-for-rejected-read' })
    await methodFiber
    const handler = handle.mock.calls[0]?.[1]
    if (handler === undefined) throw new Error('method handler was not registered')
    const signal = new AbortController().signal
    const unavailable = { ok: false, error: { code: 'internal', message: 'Yimeng read capability is unavailable', details: {} } }
    const readResult = { ok: false as const, error: { code: 'bad-request' as const, message: 'configured read reached', details: { issues: [] } } }
    const read = vi.fn<ConnectionRpcHandler>(async () => readResult)
    const plugin = { apply: (scope: Context) => { scope.provide('qingmuYimengRead', read) } }
    let readerFiber = ctx.plugin(plugin)
    try {
      await readerFiber
      expect(await handler('worksetMethod', REQUEST, signal)).toEqual(readResult)
      await readerFiber.dispose()
      expect(await handler('worksetMethod', REQUEST, signal)).toEqual(unavailable)
      expect(await handler('elementMethod', {}, signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(handle).toHaveBeenCalledOnce()
      readerFiber = ctx.plugin(plugin)
      await readerFiber
      expect(await handler('worksetMethod', REQUEST, signal)).toEqual(readResult)
      expect(read).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenLastCalledWith('workflow', REQUEST, signal)
      expect(handle).toHaveBeenCalledOnce()
    } finally {
      await readerFiber.dispose()
      await methodFiber.dispose()
    }
  })
})

describe('workset local subprocess safety', () => {
  async function processHandler(script: string, timeoutMs = 2_000) {
    const { root } = await rules()
    await writeFile(join(root, 'scripts/compile_qingmu_imago_workset_v2.py'), script)
    return {
      root,
      handler: createImagoMethodHandler({ coreRoot: root, timeoutMs }, {
        runCompiler: vi.fn(),
        readWorkflow: async () => ({ ok: true, value: workflow() }),
      }),
    }
  }

  it('sends exact input bytes through the fixed script and scrubs all credential-name environment variables', async () => {
    for (const [key, value] of [
      ['QINGMU_IMAGO_ATTESTATION_KEY', 'k'.repeat(32)],
      ['WORKSET_TEST_API_KEY', 'fake-key'],
      ['WORKSET_TEST_TOKEN', 'fake-token'],
      ['WORKSET_TEST_SECRET', 'fake-secret'],
      ['workset_test_password', 'fake-password'],
      ['elapsed_workset_test', 'retained-non-secret'],
    ] as const) vi.stubEnv(key, value)
    const script = [
      'import hashlib, json, os, re, sys',
      'from pathlib import Path',
      'wire = sys.stdin.buffer.read()',
      'snapshot = json.loads(wire)',
      'result = json.loads(Path("projection-template.json").read_text())',
      `paths = ${JSON.stringify(WORKSET_RULE_PATHS)}`,
      'bindings = {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in paths}',
      'result.update(subject=snapshot["subject"], source_projection_sha256=snapshot["source_projection_sha256"], input_snapshot_sha256=hashlib.sha256(wire).hexdigest(), rule_bindings=bindings, rules_sha256=hashlib.sha256(json.dumps(bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest())',
      'Path("process-receipt.json").write_text(json.dumps({"argv":sys.argv[1:], "cwd":os.getcwd(), "credential_names":[key for key in os.environ if re.search("key|token|secret|password", key, re.I)], "ordinary":os.environ.get("elapsed_workset_test"), "wire":wire.decode()}))',
      'print(json.dumps(result))',
    ].join('\n')
    const { root, handler } = await processHandler(script)
    const snapshot = buildWorksetSnapshot(REQUEST, workflow(), canonicalJson)
    const bindings = await readWorksetRuleHashes(root)
    await writeFile(join(root, 'projection-template.json'), JSON.stringify(projection(snapshot, bindings)))
    const result = await handler('worksetMethod', REQUEST, new AbortController().signal)
    expect(result).toEqual({
      ok: true,
      value: { schema: 'qingmu.imago-workset-method-adapter-result.v1', projection: projection(snapshot, bindings) },
    })
    expect(JSON.parse(await readFile(join(root, 'process-receipt.json'), 'utf8'))).toEqual({
      argv: ['-'], cwd: await realpath(root), credential_names: [], ordinary: 'retained-non-secret', wire: canonicalJson(snapshot),
    })
  })

  it('rejects malformed output, nonzero exits, and either output stream exceeding the cap without leaking stderr', async () => {
    for (const script of [
      'print("not-json")',
      'import sys\nprint("fake-secret-from-child", file=sys.stderr)\nsys.exit(2)',
      'print("x" * (5 * 1024 * 1024 + 1))',
      'import sys\nprint("x" * (5 * 1024 * 1024 + 1), file=sys.stderr)',
    ]) {
      const { handler } = await processHandler(script)
      const result = await handler('worksetMethod', REQUEST, new AbortController().signal)
      expect(result).toEqual({ ok: false, error: { code: 'internal', message: 'IMAGO method compiler failed', details: {} } })
      expect(JSON.stringify(result)).not.toContain('fake-secret-from-child')
    }
  })

  it('kills and closes the workset child before returning timeout or cancellation', async () => {
    const script = 'import os, time\nfrom pathlib import Path\nPath("child-pid.txt").write_text(str(os.getpid()))\ntime.sleep(10)'
    const timeout = await processHandler(script, 500)
    expect(await timeout.handler('worksetMethod', REQUEST, new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    const timeoutPid = Number(await readFile(join(timeout.root, 'child-pid.txt'), 'utf8'))
    expect(Number.isSafeInteger(timeoutPid) && timeoutPid > 1).toBe(true)
    expect(() => process.kill(timeoutPid, 0)).toThrow()

    const cancelled = await processHandler(script)
    const controller = new AbortController()
    const pending = cancelled.handler('worksetMethod', REQUEST, controller.signal)
    let childPid = 0
    await vi.waitFor(async () => {
      childPid = Number(await readFile(join(cancelled.root, 'child-pid.txt'), 'utf8'))
      expect(Number.isSafeInteger(childPid) && childPid > 1).toBe(true)
    }, { timeout: 1_000, interval: 10 })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(() => process.kill(childPid, 0)).toThrow()
  })

  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT)('runs the actual Core compiler without fabricated Stage/LSU authority', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const root = process.env.IMAGO_OS_CORE_ROOT
    if (root === undefined) throw new Error('IMAGO_OS_CORE_ROOT is required for the integration test')
    const source = { ...workflow(), inputFingerprint: '易梦-剧集-🪵' }
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readWorkflow: async () => ({ ok: true, value: source }),
    })
    const result = await handler('worksetMethod', REQUEST, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const wrapper = result.value as { schema: string; projection: ReturnType<typeof normalizeWorksetProjection> }
    const snapshot = buildWorksetSnapshot(REQUEST, source, canonicalJson)
    expect(wrapper.schema).toBe('qingmu.imago-workset-method-adapter-result.v1')
    expect(wrapper.projection.stage_definitions).toHaveLength(23)
    expect(wrapper.projection.stage_definitions.filter(stage => stage.scope === 'global')).toHaveLength(17)
    expect(wrapper.projection.stage_definitions.filter(stage => stage.scope === 'per_lsu')).toHaveLength(6)
    expect(wrapper.projection.input_snapshot_sha256).toBe(sha(snapshot))
    expect(wrapper.projection.source_projection_sha256).toBe(sha(source))
    expect(wrapper.projection.subject).toEqual(snapshot.subject)
    expect(wrapper.projection.rule_bindings).toEqual(await readWorksetRuleHashes(root))
    expect(wrapper.projection.availability.status).toBe('unavailable')
    expect(wrapper.projection.work_items).toEqual([])
    expect(wrapper.projection.legal_work_items).toEqual([])
    expect(wrapper.projection.recommended_item).toBeNull()
    expect(wrapper.projection.formal_activation_allowed).toBe(false)
  })
})
