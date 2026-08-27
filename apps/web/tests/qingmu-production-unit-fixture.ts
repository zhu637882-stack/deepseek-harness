// Isolated HTTP data for the production-unit browser scenario. The only persisted
// state is this process Map; it is not a Yimeng database or an approval service.
// Real Core compilation and Host signing stay outside this double.
import assert from 'node:assert/strict'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  YimengProductionUnitDefinition, YimengProductionUnitSource, YimengProductionUnitsResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  YimengProductionUnitRecovery, YimengProductionUnitResult,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export const PRODUCTION_UNIT_BROWSER_GROUP_ID = 'group-three'
export const PRODUCTION_UNIT_BROWSER_UNIT_ID = 'LSU17'
export const PRODUCTION_UNIT_BROWSER_RULE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/workflow-spec.v6.production-beta.json',
  'scripts/compile_qingmu_imago_workset.py',
  'scripts/compile_qingmu_imago_workset_v2.py',
  'scripts/imago_v6_draft_ctl.py',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_production_unit_method.py',
] as const

const IDS = { projectId: 'project-1', episodeId: 'episode-1', groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID }
const FLAGS = { planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const
type Mode = 'disabled' | 'available' | 'unavailable' | 'drifted'

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'fixture object required')
  if (keys !== undefined) assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpected unit fixture fields')
  return value as Record<string, unknown>
}

function text(value: unknown, maximum = 256): string {
  assert(typeof value === 'string' && Array.from(value).length <= maximum, 'invalid unit fixture text')
  const stripped = value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
  assert(stripped.length > 0 && stripped === value && !/[\r\n\0\uD800-\uDFFF]/u.test(value), 'invalid unit fixture ID')
  return value
}

function sha(value: unknown): string {
  assert(typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/u.test(value), 'invalid unit fixture SHA')
  return value
}

function source(revision: number, drifted: boolean): YimengProductionUnitSource {
  assert(Number.isSafeInteger(revision) && revision >= 0, 'invalid fixture episode revision')
  return {
    schema: 'jason.qingmu-production-unit-source.v1', ...IDS, groupNo: 3,
    title: '雨夜怀表 · 两镜衔接',
    groupExecutionPromptSha256: createHash('sha256').update('保持怀表位置与动作连续。', 'utf8').digest('hex'),
    storyboardRevision: revision,
    shots: [
      { frameId: 'frame-z', frameNo: 7, frameContentSha256: 'b'.repeat(64) },
      { frameId: 'frame-1', frameNo: 12, frameContentSha256: (drifted ? 'c' : 'b').repeat(64) },
    ],
  }
}

function definition(value: unknown): YimengProductionUnitDefinition {
  const raw = object(value, [
    'id', 'version', 'unitIdPattern', 'scope', 'stages', 'operation',
    'planSealingAllowed', 'stageApprovalAllowed', 'providerCalls',
  ])
  assert.equal(raw.id, 'IMAGO-V6-LSU')
  assert.equal(raw.unitIdPattern, 'LSU[0-9]{2,}')
  assert.equal(raw.scope, 'per_lsu')
  assert.equal(raw.operation, 'bind_existing_shot_group')
  assert.equal(raw.planSealingAllowed, false)
  assert.equal(raw.stageApprovalAllowed, false)
  assert.equal(raw.providerCalls, 0)
  assert(Array.isArray(raw.stages) && raw.stages.length > 0, 'unit method definitions missing')
  const stages = raw.stages.map((value: unknown) => {
    const stage = object(value, ['stageId', 'roleId', 'contractSha256'])
    return { stageId: text(stage.stageId), roleId: text(stage.roleId), contractSha256: sha(stage.contractSha256) }
  })
  assert.equal(new Set(stages.map(stage => stage.stageId)).size, stages.length, 'duplicate method definition')
  return {
    id: 'IMAGO-V6-LSU', version: text(raw.version), unitIdPattern: 'LSU[0-9]{2,}', scope: 'per_lsu', stages,
    operation: 'bind_existing_shot_group', planSealingAllowed: false, stageApprovalAllowed: false, providerCalls: 0,
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
  response.end(JSON.stringify(value))
}

/** Create a test-only unit feed, single binding command, and historical receipt route.
 * @param options - Isolated credentials and independent canonical encoders from the scaffold.
 * @returns HTTP handling plus controls; no server or external I/O starts here.
 */
export function createProductionUnitDouble(options: {
  readonly token: string
  readonly attestationKey: string
  readonly canonicalJson: (value: unknown) => string
  readonly canonicalSha256: (value: unknown) => string
}) {
  let mode: Mode = 'disabled'
  let loseResponse = false
  let latest: YimengProductionUnitResult | undefined
  const receipts = new Map<string, { readonly payloadSha256: string; readonly result: YimengProductionUnitResult }>()
  const contractErrors: string[] = []

  function feed(revision: number): YimengProductionUnitsResponse {
    const currentSource = mode === 'available' || mode === 'drifted' ? source(revision, mode === 'drifted') : null
    const snapshotSha256 = currentSource === null ? null : options.canonicalSha256(currentSource)
    return {
      schema: 'jason.qingmu-production-unit-feed.v1', projectId: IDS.projectId, episodeId: IDS.episodeId,
      capabilities: { canBindUnit: true },
      groups: mode === 'disabled' ? [] : [{
        groupId: IDS.groupId, subject: currentSource, snapshotSha256,
        availability: { status: currentSource === null ? 'unavailable' : 'available',
          reason: currentSource === null ? 'shot_group_needs_repartition' : null },
      }],
      bindings: latest === undefined || mode === 'disabled' ? [] : [{
        binding: latest.binding, bindingSha256: latest.bindingSha256,
        currentBinding: snapshotSha256 !== null && snapshotSha256 === latest.binding.sourceSnapshotSha256,
      }],
      ...FLAGS,
    }
  }

  return {
    handle(request: IncomingMessage, response: ServerResponse, url: URL, body: unknown, revision: number): boolean {
      const base = '/api/qingmu/projects/project-1/episodes/episode-1/production-units'
      if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return false
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        json(response, 401, { detail: { code: 'fixture_authentication_required' } })
        return true
      }
      try {
        if (request.method === 'GET' && url.pathname === base) {
          assert.equal(url.search, '')
          assert.equal(body, undefined)
          json(response, 200, feed(revision))
          return true
        }
        const match = /^\/([^/]+)\/binding(\/command-receipt)?$/u.exec(url.pathname.slice(base.length))
        assert(match !== null, 'unknown fixture unit route')
        const unitId = text(decodeURIComponent(match[1] ?? ''))
        assert(/^LSU[0-9]{2,}$/u.test(unitId), 'unit ID must be explicit')
        if (match[2] !== undefined) {
          assert.equal(request.method, 'GET', 'unit recovery must be read-only')
          assert.equal(body, undefined)
          assert.deepEqual([...url.searchParams.keys()].sort(), ['expectedSubjectSha256', 'groupId'])
          assert.equal(url.searchParams.get('groupId'), IDS.groupId)
          const expectedSubjectSha256 = sha(url.searchParams.get('expectedSubjectSha256'))
          const idempotencyKey = text(request.headers['idempotency-key'], 200)
          const stored = receipts.get(idempotencyKey)
          if (stored !== undefined) {
            assert.equal(stored.result.binding.unitId, unitId)
            assert.equal(stored.result.binding.sourceSnapshotSha256, expectedSubjectSha256)
          }
          const recovery: YimengProductionUnitRecovery = {
            schema: 'jason.qingmu-production-unit-recovery.v1', ...IDS, unitId,
            expectedSubjectSha256, idempotencyKey, found: stored !== undefined, result: stored?.result ?? null,
          }
          json(response, 200, recovery)
          return true
        }
        assert.equal(request.method, 'POST')
        assert.equal(url.search, '')
        const raw = object(body, ['groupId', 'expectedSubjectSha256', 'expectedBindingRevision',
          'expectedBindingSha256', 'methodProjection', 'methodProjectionSha256', 'methodAttestation', 'idempotencyKey'])
        assert.equal(raw.groupId, IDS.groupId)
        const expectedSubjectSha256 = sha(raw.expectedSubjectSha256)
        const idempotencyKey = text(raw.idempotencyKey, 200)
        assert(Array.from(idempotencyKey).length >= 8)
        const method = object(raw.methodProjection,
          ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
        assert.equal(method.schema, 'qingmu.imago-production-unit-method.v1')
        assert.equal(method.subjectSnapshotSha256, expectedSubjectSha256)
        const methodProjectionSha256 = sha(raw.methodProjectionSha256)
        assert.equal(options.canonicalSha256(method), methodProjectionSha256)
        const methodDefinition = definition(method.definition)
        const rules = object(method.ruleBindings, PRODUCTION_UNIT_BROWSER_RULE_PATHS)
        for (const digest of Object.values(rules)) sha(digest)
        const rulesSha256 = sha(method.rulesSha256)
        assert.equal(options.canonicalSha256(rules), rulesSha256)
        const unsigned = { schema: 'qingmu.imago-production-unit-method-attestation.v1', algorithm: 'hmac-sha256',
          subjectSnapshotSha256: expectedSubjectSha256, methodProjectionSha256 }
        const proof = object(raw.methodAttestation, [...Object.keys(unsigned), 'signature'])
        for (const [name, value] of Object.entries(unsigned)) assert.equal(proof[name], value)
        const signature = Buffer.from(sha(proof.signature), 'hex')
        const expected = createHmac('sha256', options.attestationKey).update(options.canonicalJson(unsigned), 'utf8').digest()
        assert(timingSafeEqual(signature, expected), 'unit Host attestation mismatch')
        const payloadSha256 = options.canonicalSha256(raw)
        const previous = receipts.get(idempotencyKey)
        if (previous !== undefined) {
          assert.equal(previous.payloadSha256, payloadSha256, 'idempotency conflict')
          json(response, 200, previous.result)
          return true
        }
        const boundSource = source(revision, mode === 'drifted')
        assert(mode === 'available' || mode === 'drifted', 'unit source unavailable')
        assert.deepEqual(method.subject, boundSource, 'unit source must match the current fixture')
        assert.equal(expectedSubjectSha256, options.canonicalSha256(boundSource))
        assert.equal(raw.expectedBindingRevision, latest?.binding.revision ?? 0, 'unit revision CAS mismatch')
        assert.equal(raw.expectedBindingSha256, latest?.bindingSha256 ?? null, 'unit SHA CAS mismatch')
        if (latest !== undefined) assert.equal(latest.binding.unitId, unitId, 'unit identity is frozen')
        const binding = {
          ...IDS, unitId, revision: (latest?.binding.revision ?? 0) + 1, source: boundSource,
          sourceSnapshotSha256: expectedSubjectSha256, methodProjectionSha256, rulesSha256, definition: methodDefinition,
          actorId: 'owner-fixture', authSessionId: createHash('sha256').update(options.token, 'utf8').digest('hex'),
          eventId: `fixture-unit-event-${payloadSha256}`, changeSetId: `fixture-unit-changeset-${payloadSha256}`,
          createdAt: '2026-08-28T00:10:00+08:00',
        }
        latest = { schema: 'jason.qingmu-production-unit-result.v1', binding,
          bindingSha256: options.canonicalSha256(binding), ...FLAGS }
        receipts.set(idempotencyKey, { payloadSha256, result: structuredClone(latest) })
        if (loseResponse) { loseResponse = false; response.destroy() }
        else json(response, 201, latest)
        return true
      } catch {
        contractErrors.push('production_unit_fixture_contract_mismatch')
        json(response, 422, { detail: { code: 'production_unit_fixture_contract_mismatch' } })
        return true
      }
    },
    setMode(value: Mode): void { mode = value },
    loseNextBindingResponse(): void { loseResponse = true },
    getFeed(revision: number): YimengProductionUnitsResponse { return structuredClone(feed(revision)) },
    getContractErrors(): readonly string[] { return [...contractErrors] },
  }
}
