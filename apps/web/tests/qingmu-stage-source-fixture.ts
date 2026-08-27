// Isolated HTTP fixture only. Script bytes belong to the existing script double;
// this Map records source receipts, never stage artifacts or workflow approvals.
// Actual Core compilation and Host signing are exercised outside this fixture.
import assert from 'node:assert/strict'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  YimengStageSource, YimengStageSourceDefinition, YimengStageSourceResult, YimengStageSourcesResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

export const STAGE_SOURCE_BROWSER_RULE_PATHS = [
  'pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json', 'pipeline/workflow-spec.v6.production-beta.json',
  'scripts/compile_qingmu_imago_workset.py', 'scripts/compile_qingmu_imago_workset_v2.py',
  'scripts/imago_v6_draft_ctl.py', 'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_stage_source_method.py',
] as const

const IDS = { projectId: 'project-1', episodeId: 'episode-1', stageId: 'A1S' } as const
const FLAGS = { stageArtifactCreated: false, stageApprovalGranted: false, lockActivated: false,
  planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const
type Mode = 'available' | 'unavailable' | 'drifted'
interface SavedScriptCoordinates { readonly revision: number; readonly contentSha256: string }

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'source fixture object required')
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpected source fixture fields')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  assert(typeof value === 'string' && value.isWellFormed() && value.length > 0 && value.length <= 256)
  assert.equal(value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, ''), value)
  assert(!/[\0\r\n]/u.test(value))
  return value
}
function sha(value: unknown): string {
  assert(typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/u.test(value))
  return value
}
function definition(value: unknown): YimengStageSourceDefinition {
  const constants = { id: 'IMAGO-V6-A1S-SOURCE', stageId: 'A1S', roleId: 'A1S', scope: 'global',
    artifactKind: 'SCREENPLAY_PACKAGE', canonicalOutput: 'inputs/screenplay-package.json',
    sourceType: 'episode_script', sourceUsage: 'source_reference_only', operation: 'bind_existing_episode_script_source',
    stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 } as const
  const raw = object(value, [...Object.keys(constants), 'version', 'contractSha256'])
  for (const [key, expected] of Object.entries(constants)) assert.equal(raw[key], expected)
  return { ...constants, version: text(raw.version), contractSha256: sha(raw.contractSha256) }
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
  response.end(JSON.stringify(value))
}

/** Create source-only routes for the existing browser scaffold, without external I/O.
 * @param options - Isolated credentials and canonical encoders from the scaffold.
 * @returns Route handling, controlled source availability, and receipt observations.
 */
export function createStageSourceDouble(options: {
  readonly token: string
  readonly attestationKey: string
  readonly canonicalJson: (value: unknown) => string
  readonly canonicalSha256: (value: unknown) => string
}) {
  let mode: Mode = 'unavailable'
  let loseResponse = false
  let latest: YimengStageSourceResult | null = null
  const receipts = new Map<string, { readonly payloadSha256: string; readonly result: YimengStageSourceResult }>()
  const contractErrors: string[] = []

  function source(saved: SavedScriptCoordinates): YimengStageSource | null {
    assert(Number.isSafeInteger(saved.revision) && saved.revision >= 0)
    if (mode === 'unavailable') return null
    return { schema: 'jason.qingmu-stage-source.v1', projectId: IDS.projectId, episodeId: IDS.episodeId,
      sourceType: 'episode_script', sourceId: IDS.episodeId, revision: saved.revision,
      contentSha256: mode === 'drifted' ? 'c'.repeat(64) : sha(saved.contentSha256) }
  }
  function feed(saved: SavedScriptCoordinates): YimengStageSourcesResponse {
    const current = source(saved)
    const subjectSnapshotSha256 = current === null ? null : options.canonicalSha256(current)
    return { schema: 'jason.qingmu-stage-source-feed.v1', ...IDS, canBind: true,
      source: current, subjectSnapshotSha256, unavailableReason: current === null ? 'episode_script_unavailable' : null,
      bindingRevision: latest?.binding.bindingRevision ?? 0, bindingSha256: latest?.bindingSha256 ?? null,
      latestBinding: latest, currentBinding: subjectSnapshotSha256 !== null
        && latest?.binding.subjectSnapshotSha256 === subjectSnapshotSha256 ? latest : null }
  }

  return {
    handle(request: IncomingMessage, response: ServerResponse, url: URL, body: unknown, saved: SavedScriptCoordinates): boolean {
      const base = '/api/qingmu/projects/project-1/episodes/episode-1/stage-sources'
      const bindingPath = `${base}/A1S/binding`
      if (url.pathname !== base && url.pathname !== bindingPath && url.pathname !== `${bindingPath}/command-receipt`) return false
      try {
        assert.equal(request.headers.authorization, `Bearer ${options.token}`)
        if (request.method === 'GET' && url.pathname === base) {
          assert.equal(url.search, '')
          json(response, 200, feed(saved))
          return true
        }
        if (request.method === 'GET' && url.pathname === `${bindingPath}/command-receipt`) {
          assert.deepEqual([...url.searchParams.keys()], ['expectedSubjectSha256'])
          const expectedSubjectSha256 = sha(url.searchParams.get('expectedSubjectSha256'))
          const idempotencyKey = text(request.headers['idempotency-key'])
          assert.match(idempotencyKey, /^[\x21-\x7e]{8,200}$/u)
          const original = receipts.get(idempotencyKey)
          if (original?.result.binding.subjectSnapshotSha256 !== expectedSubjectSha256) {
            json(response, 404, { detail: { code: 'command_receipt_not_found' } })
          } else {
            json(response, 200, { schema: 'jason.qingmu-stage-source-recovery.v1', receipt: original.result })
          }
          return true
        }
        assert.equal(request.method, 'POST')
        assert.equal(url.pathname, bindingPath)
        assert.equal(url.search, '')
        const raw = object(body, ['expectedSubjectSha256', 'expectedBindingRevision', 'expectedBindingSha256',
          'methodProjection', 'methodProjectionSha256', 'methodAttestation', 'idempotencyKey'])
        const expectedSubjectSha256 = sha(raw.expectedSubjectSha256)
        const idempotencyKey = text(raw.idempotencyKey)
        assert.match(idempotencyKey, /^[\x21-\x7e]{8,200}$/u)
        const method = object(raw.methodProjection,
          ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
        assert.equal(method.schema, 'qingmu.imago-stage-source-method.v1')
        assert.equal(method.subjectSnapshotSha256, expectedSubjectSha256)
        const methodProjectionSha256 = sha(raw.methodProjectionSha256)
        assert.equal(options.canonicalSha256(method), methodProjectionSha256)
        const methodDefinition = definition(method.definition)
        const rules = object(method.ruleBindings, STAGE_SOURCE_BROWSER_RULE_PATHS)
        for (const value of Object.values(rules)) sha(value)
        const rulesSha256 = sha(method.rulesSha256)
        assert.equal(options.canonicalSha256(rules), rulesSha256)
        const signed = { schema: 'qingmu.imago-stage-source-method-attestation.v1', algorithm: 'hmac-sha256',
          subjectSnapshotSha256: expectedSubjectSha256, methodProjectionSha256 }
        const proof = object(raw.methodAttestation, [...Object.keys(signed), 'signature'])
        for (const [key, value] of Object.entries(signed)) assert.equal(proof[key], value)
        const expectedSignature = createHmac('sha256', options.attestationKey).update(options.canonicalJson(signed), 'utf8').digest()
        assert(timingSafeEqual(Buffer.from(sha(proof.signature), 'hex'), expectedSignature), 'source Host attestation mismatch')
        const payloadSha256 = options.canonicalSha256(raw)
        const original = receipts.get(idempotencyKey)
        if (original !== undefined) {
          assert.equal(original.payloadSha256, payloadSha256, 'source idempotency conflict')
          json(response, 200, original.result)
          return true
        }
        const current = source(saved)
        assert(current !== null, 'saved script unavailable')
        assert.deepEqual(method.subject, current, 'source must match full saved script, not editor draft')
        assert.equal(expectedSubjectSha256, options.canonicalSha256(current))
        assert.equal(raw.expectedBindingRevision, latest?.binding.bindingRevision ?? 0, 'source revision CAS mismatch')
        assert.equal(raw.expectedBindingSha256, latest?.bindingSha256 ?? null, 'source SHA CAS mismatch')
        const binding: YimengStageSourceResult['binding'] = {
          schema: 'jason.qingmu-stage-source-binding.v1', ...IDS, source: current,
          subjectSnapshotSha256: expectedSubjectSha256, definition: methodDefinition, methodProjectionSha256, rulesSha256,
          bindingRevision: (latest?.binding.bindingRevision ?? 0) + 1,
          changeSetId: `fixture-source-changeset-${payloadSha256}`, actorId: 'owner-fixture',
          authSessionId: createHash('sha256').update(options.token, 'utf8').digest('hex'), createdAt: '2026-08-28T01:30:00+08:00',
          ...FLAGS,
        }
        latest = { schema: 'jason.qingmu-stage-source-result.v1', binding, bindingSha256: options.canonicalSha256(binding),
          receiptId: `fixture-source-receipt-${payloadSha256}`, outboxEventId: `fixture-source-event-${payloadSha256}` }
        receipts.set(idempotencyKey, { payloadSha256, result: structuredClone(latest) })
        if (loseResponse) { loseResponse = false; response.destroy() }
        else json(response, 201, latest)
        return true
      } catch {
        contractErrors.push('stage_source_fixture_contract_mismatch')
        json(response, 422, { detail: { code: 'stage_source_fixture_contract_mismatch' } })
        return true
      }
    },
    setMode(value: Mode): void { mode = value },
    loseNextBindingResponse(): void { loseResponse = true },
    getLatest(): YimengStageSourceResult | null { return structuredClone(latest) },
    getContractErrors(): readonly string[] { return [...contractErrors] },
  }
}
