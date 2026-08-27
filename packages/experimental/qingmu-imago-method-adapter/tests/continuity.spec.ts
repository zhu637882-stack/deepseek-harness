import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { continuityFixture, continuityJson, continuityRelations, rebindContinuity } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import { apply, createImagoMethodHandler, inject } from '../src/index.ts'
import type { ImagoContinuityMethodResponse, ImagoContinuityMethodSnapshot } from '../src/types.ts'
import {
  buildContinuitySnapshot, CONTINUITY_RULE_PATHS, normalizeContinuityProjection,
  parseContinuityMethodRequest, readContinuityRules, type ContinuityRules,
} from '../src/continuity.ts'

const REQUEST = { projectId: 'project-e55', episodeId: 'episode-e55', selectedShotId: 'frame-a' }
const roots: string[] = []
const sha = (value: unknown) => createHash('sha256').update(continuityJson(value), 'utf8').digest('hex')
const signal = () => new AbortController().signal

function workflow() {
  return {
    schema: 'jason.episode-workflow-projection.v1', projectId: REQUEST.projectId, episodeId: REQUEST.episodeId,
    sourceRevision: { storyboard: 4, assets: 12 }, inputFingerprint: 'same-legacy-fingerprint',
    budget: { remaining: 0.125 }, stages: { script: { status: 'complete', canProceed: true } },
    director: { shotRelations: continuityRelations(), continuityDelta: continuityFixture() },
  }
}

async function localRules() {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-continuity-rules-'))
  roots.push(root)
  for (const path of CONTINUITY_RULE_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), path === 'pipeline/workflow-spec.v6.production-beta.json'
      ? JSON.stringify({ locks: [{ id: 'SCRIPT_LOCK', producer_stage: 'A1S' }], rework_propagation: [{ changed_lock: 'SCRIPT_LOCK', invalidates_from: 'B1', scope: 'all_downstream' }] })
      : `fixture-rule:${path}\n`)
  }
  return { root, rules: await readContinuityRules(root) }
}

function projection(snapshot: ImagoContinuityMethodSnapshot, rules: ContinuityRules): ImagoContinuityMethodResponse['projection'] {
  const selected = snapshot.shots.find(shot => shot.shotId === snapshot.subject.selectedShotId)
  if (selected === undefined) throw new Error('fixture selected Shot is absent')
  return {
    schema: 'qingmu.imago-continuity-method-projection.v1', subject: snapshot.subject, selected_shot: selected,
    source_projection_sha256: snapshot.source_projection_sha256, source_revision_sha256: snapshot.source_revision_sha256,
    input_snapshot_sha256: sha(snapshot), continuity_snapshot_sha256: snapshot.continuity?.snapshotSha256 ?? null,
    rule_bindings: rules.hashes, rules_sha256: sha(rules.hashes),
    availability: snapshot.continuity === null ? { status: 'unavailable', reason: 'continuity_evidence_unavailable' }
      : { status: snapshot.continuity.availability, reason: snapshot.continuity.reason },
    adjacent_pairs: {
      incoming: snapshot.continuity?.pairs.find(pair => pair.toShotId === selected.shotId) ?? null,
      outgoing: snapshot.continuity?.pairs.find(pair => pair.fromShotId === selected.shotId) ?? null,
    },
    candidate_findings: [], lock_definitions: rules.locks, rework_propagation: rules.rework,
    lock_authority: { status: 'unavailable', reason: 'authoritative_lock_instances_unavailable', instances: [] },
    field_help: [{ field: 'currentBinding', label: '当前绑定', help: '核对现有证据', source_paths: [CONTINUITY_RULE_PATHS[0]] }],
    checklist: [{ id: 'exact_binding', label: '检查当前与历史来源', source_paths: [CONTINUITY_RULE_PATHS[0]] }],
    work_order: {
      mode: 'read_only', allowed_actions: ['inspect_current_binding', 'inspect_historical_audit', 'review_candidate_findings', 'inspect_lock_definitions'],
      allowed_mutations: [], requires_human_attribution: true, provider_calls: 0,
      task_mutation: false, budget_mutation: false, human_signoff_inferred: false,
    },
    read_only: true, provider_calls: 0, task_mutation: false, budget_mutation: false, human_signoff_inferred: false,
    project_state_persisted: false, formal_activation_allowed: false,
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('continuity identity and fresh business source', () => {
  it('accepts exactly three identifiers and no command, rule, or approval payload', () => {
    expect(parseContinuityMethodRequest(REQUEST)).toEqual(REQUEST)
    for (const value of [null, [], {}, { ...REQUEST, execute: true }, { ...REQUEST, workflow: workflow() },
      { ...REQUEST, approved: true }, { ...REQUEST, coreRoot: '/other' }, { ...REQUEST, selectedShotId: '' },
      { ...REQUEST, selectedShotId: ' frame-a ' }, { ...REQUEST, projectId: '\ud800' }]) {
      expect(() => parseContinuityMethodRequest(value)).toThrow()
    }
  })

  it('binds the whole source and revision without trusting the legacy fingerprint', () => {
    const source = workflow()
    const before = structuredClone(source)
    const result = buildContinuitySnapshot(REQUEST, source, continuityJson)
    expect(result.shots).toEqual([{ shotId: 'frame-z', frameNo: 7 }, { shotId: 'frame-a', frameNo: 12 }])
    expect(result.source_projection_sha256).toBe(sha(source))
    expect(result.source_revision_sha256).toBe(sha(source.sourceRevision))
    expect(source).toEqual(before)
    const changed = buildContinuitySnapshot(REQUEST, { ...source, budget: { remaining: 0.126 } }, continuityJson)
    expect(changed.source_projection_sha256).not.toBe(result.source_projection_sha256)
  })

  it('allows legacy upstream omission as explicitly unavailable, never as approved', () => {
    const source = workflow()
    const legacy = { ...source, director: { shotRelations: source.director.shotRelations }, approved: true, locks: ['SCRIPT_LOCK'] }
    const result = buildContinuitySnapshot(REQUEST, legacy, continuityJson)
    expect(result.continuity).toBeNull()
    expect(JSON.stringify(result)).not.toContain('approved')
    expect(JSON.stringify(result)).not.toContain('SCRIPT_LOCK')
  })

  it('rejects mismatched subject, canonical identity, ordering, and evidence digests', () => {
    const source = workflow()
    for (const value of [
      { ...source, episodeId: 'other' }, { ...source, sourceRevision: null },
      { ...source, director: { ...source.director, shotRelations: { ...source.director.shotRelations, valid: false } } },
      { ...source, director: { ...source.director, shotRelations: { ...source.director.shotRelations, shots: [] } } },
      { ...source, director: { ...source.director, shotRelations: {
        ...source.director.shotRelations, shots: source.director.shotRelations.shots.map(shot => ({ ...shot, frameNo: 7 })),
      } } },
      { ...source, director: { ...source.director, continuityDelta: { ...source.director.continuityDelta, snapshotSha256: '0'.repeat(64) } } },
    ]) expect(() => buildContinuitySnapshot(REQUEST, value, continuityJson)).toThrow()
  })
})

describe('continuity Host verification and plugin boundary', () => {
  it('reads the configured business source and returns a verified read-only result without an attestation key', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const { root, rules } = await localRules()
    const source = workflow()
    const read = vi.fn(async () => ({ ok: true as const, value: source }))
    const compiler = vi.fn(async (snapshot: ImagoContinuityMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readWorkflow: read, runContinuityCompiler: compiler,
    })
    const requestSignal = signal()
    const response = await handler('continuityMethod', REQUEST, requestSignal)
    expect(response).toEqual({ ok: true, value: { schema: 'qingmu.imago-continuity-method-adapter-result.v1', projection: projection(buildContinuitySnapshot(REQUEST, source, continuityJson), rules) } })
    expect(read).toHaveBeenCalledExactlyOnceWith({ projectId: REQUEST.projectId, episodeId: REQUEST.episodeId }, requestSignal)
    expect(compiler).toHaveBeenCalledOnce()
  })

  it('rejects a browser command before any read or compile', async () => {
    const read = vi.fn()
    const compiler = vi.fn()
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, { runCompiler: vi.fn(), readWorkflow: read, runContinuityCompiler: compiler })
    expect(await handler('continuityMethod', { ...REQUEST, execute: true }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(read).not.toHaveBeenCalled()
    expect(compiler).not.toHaveBeenCalled()
  })

  it.each(['subject', 'source', 'rule', 'pair', 'finding', 'lock', 'approval', 'guidance', 'mutation'] as const)(
    'rejects fabricated %s output', async (kind) => {
      const { rules } = await localRules()
      const snapshot = buildContinuitySnapshot(REQUEST, workflow(), continuityJson)
      const original = projection(snapshot, rules)
      const forged = {
        ...original,
        ...(kind === 'subject' ? { subject: { ...original.subject, selectedShotId: 'display-12' } } : {}),
        ...(kind === 'source' ? { source_projection_sha256: '0'.repeat(64) } : {}),
        ...(kind === 'rule' ? { rule_bindings: { ...rules.hashes, '/tmp/untrusted': '1'.repeat(64) } } : {}),
        ...(kind === 'pair' ? { adjacent_pairs: { incoming: null, outgoing: null } } : {}),
        ...(kind === 'finding' ? { candidate_findings: [{ severity: 'high', earliest_owner: 'F' }] } : {}),
        ...(kind === 'lock' ? { lock_definitions: [...rules.locks, { id: 'FAKE_LOCK', producer_stage: 'A0' }] } : {}),
        ...(kind === 'approval' ? { lock_authority: { status: 'approved', instances: ['SCRIPT_LOCK'] } } : {}),
        ...(kind === 'guidance' ? { field_help: [{ field: 'x', label: 'x', help: 'x', source_paths: ['unbound.md'] }] } : {}),
        ...(kind === 'mutation' ? { work_order: { ...original.work_order, allowed_mutations: ['create_finding'] } } : {}),
      }
      expect(() => normalizeContinuityProjection(forged, snapshot, rules, continuityJson)).toThrow()
    },
  )

  it('re-reads fixed rule bytes after compilation and rejects a source changed during execution', async () => {
    const { root, rules } = await localRules()
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readWorkflow: async () => ({ ok: true, value: workflow() }),
      runContinuityCompiler: async (snapshot) => {
        await writeFile(join(root, CONTINUITY_RULE_PATHS[0]), 'changed rule')
        return projection(snapshot, rules)
      },
    })
    expect(await handler('continuityMethod', REQUEST, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('cancels after the fresh read before starting a compiler', async () => {
    const controller = new AbortController()
    const compiler = vi.fn()
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), runContinuityCompiler: compiler,
      readWorkflow: async () => { controller.abort(); return { ok: true, value: workflow() } },
    })
    expect(await handler('continuityMethod', REQUEST, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(compiler).not.toHaveBeenCalled()
  })

  it('fails closed when the optional reader unloads, and reconnects without reinstalling methods', async () => {
    const ctx = new Context()
    const handle = vi.fn((_channel: string, _handler: ConnectionRpcHandler, _options: ConnectionRpcHandlerOptions) => async () => {})
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    const method = ctx.plugin({ inject: [...inject], apply }, { coreRoot: '/not-read' })
    await method
    const handler = handle.mock.calls[0]?.[1]
    if (handler === undefined) throw new Error('method handler missing')
    const result = { ok: false as const, error: { code: 'bad-request' as const, message: 'configured read', details: { issues: [] } } }
    const read = vi.fn<ConnectionRpcHandler>(async () => result)
    const plugin = { apply: (scope: Context) => { scope.provide('qingmuYimengRead', read) } }
    let reader = ctx.plugin(plugin)
    try {
      await reader
      expect(await handler('continuityMethod', REQUEST, signal())).toEqual(result)
      await reader.dispose()
      expect(await handler('continuityMethod', REQUEST, signal())).toMatchObject({ ok: false, error: { code: 'internal', message: 'Yimeng read capability is unavailable' } })
      reader = ctx.plugin(plugin)
      await reader
      expect(await handler('continuityMethod', REQUEST, signal())).toEqual(result)
      expect(handle).toHaveBeenCalledOnce()
      expect(read.mock.calls.map(call => call[1])).toEqual([
        { projectId: REQUEST.projectId, episodeId: REQUEST.episodeId },
        { projectId: REQUEST.projectId, episodeId: REQUEST.episodeId },
      ])
    } finally { await reader.dispose(); await method.dispose() }
  })
})

describe('continuity actual local compiler', () => {
  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT).each(['current', 'historical-failed', 'legacy-missing'] as const)(
    'runs current Core with %s evidence and no authority mutation', async (kind) => {
      const root = process.env.IMAGO_OS_CORE_ROOT
      if (root === undefined) throw new Error('IMAGO_OS_CORE_ROOT is required')
      const source = workflow()
      const delta = source.director.continuityDelta
      const changed = kind === 'historical-failed' ? rebindContinuity({ ...delta, pairs: delta.pairs.map(pair => ({
        ...pair, legacyStatus: 'blocked', legacyEvidenceReady: false, currentEvidenceReady: false, bindingStatus: 'different',
        currentBinding: { ...pair.currentBinding, tailAssetId: 'another-tail', tailSha256: 'f'.repeat(64) },
        audit: { ...pair.audit, passed: false, dimensions: pair.audit.dimensions.map(item => item.dimension === 'prop' ? { ...item, result: false, reason: '道具移位' } : item) },
      })) }) : delta
      const finalSource = { ...source, director: { shotRelations: source.director.shotRelations, ...(kind === 'legacy-missing' ? {} : { continuityDelta: changed }) } }
      const handler = createImagoMethodHandler({ coreRoot: root }, {
        runCompiler: vi.fn(), readWorkflow: async () => ({ ok: true, value: finalSource }),
      })
      const response = await handler('continuityMethod', REQUEST, signal())
      expect(response.ok).toBe(true)
      if (!response.ok) throw new Error(response.error.message)
      const value = response.value as ImagoContinuityMethodResponse
      expect(value.projection.source_projection_sha256).toBe(sha(finalSource))
      expect(value.projection.input_snapshot_sha256).toBe(sha(buildContinuitySnapshot(REQUEST, finalSource, continuityJson)))
      expect(value.projection.lock_definitions).toHaveLength(6)
      expect(value.projection.rework_propagation).toHaveLength(5)
      expect(Object.keys(value.projection.rule_bindings)).toHaveLength(14)
      expect(value.projection.lock_authority.instances).toEqual([])
      expect(value.projection.provider_calls).toBe(0)
      if (kind === 'historical-failed') expect(value.projection.candidate_findings).toEqual([{
        from_shot_id: 'frame-z', to_shot_id: 'frame-a', dimension: 'prop', reason: '道具移位', check_id: 'check-e55',
        evidence_ref: 'test-evidence:e55', evidence_scope: 'historical', severity: null, earliest_owner: null, timecode: null, attribution: 'pending', formal_finding: false,
      }])
      if (kind === 'legacy-missing') expect(value.projection.availability).toEqual({ status: 'unavailable', reason: 'continuity_evidence_unavailable' })
    },
  )

  it('kills and closes an active continuity child before acknowledging cancellation', async () => {
    const { root } = await localRules()
    await writeFile(join(root, 'scripts/compile_qingmu_continuity_method.py'), 'import os, time\nfrom pathlib import Path\nPath("pid.txt").write_text(str(os.getpid()))\ntime.sleep(10)')
    const controller = new AbortController()
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readWorkflow: async () => ({ ok: true, value: workflow() }),
    })
    const pending = handler('continuityMethod', REQUEST, controller.signal)
    let pid = 0
    await vi.waitFor(async () => { pid = Number(await readFile(join(root, 'pid.txt'), 'utf8')); expect(pid).toBeGreaterThan(1) }, { timeout: 1_000, interval: 10 })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(() => process.kill(pid, 0)).toThrow()
  })
})
