// Controlled HTTP double for Finding browser scenarios. Records exist only in this
// process Map; this is neither a Yimeng database nor a production approval service.
// The Host checks actual Core source bytes; this double checks named rule bindings,
// canonical digests and the real Host-generated HMAC without importing its validators.
import assert from 'node:assert/strict'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  YimengShotFindingFeedResponse,
  YimengShotFindingPayload,
  YimengShotFindingRecovery,
  YimengShotFindingResult,
  YimengShotVideoSubject,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

const FINDING_FIELDS = [
  'timecode', 'observation', 'evidenceRefs', 'earliestOwner',
  'ownerReason', 'severity', 'suggestion', 'reworkScope',
] as const
const RULE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
  'pipeline/workflow-spec.v6.production-beta.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'agents/c5-execution-director/AGENTS.md',
  'skill-package/imago-c5-execution-storyboard/SKILL.md',
  'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md',
  'agents/lsu-dailies-qc/AGENTS.md',
  'skill-package/imago-lsu-dailies-qc/SKILL.md',
  'skill-package/imago-lsu-dailies-qc/references/lsu-dailies-standard.md',
  'scripts/compile_qingmu_continuity_method.py',
  'scripts/compile_qingmu_element_method.py',
  'skill-package/imago-lsu-dailies-qc/scripts/validate_lsu_qc.py',
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_shot_finding_method.py',
] as const
const SEVERITIES = ['BLOCKER', 'MAJOR', 'MINOR'] as const
const ACTOR_ID = 'reviewer-fixture'

type FindingMode = 'available' | 'unavailable' | 'no-permission'
type FixtureFrameId = 'frame-z' | 'frame-1'

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected fixture object')
  if (keys !== undefined) assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpected fixture fields')
  return value as Record<string, unknown>
}

function text(value: unknown, maximum = 8000, identifier = false): string {
  assert(typeof value === 'string' && Array.from(value).length <= maximum, 'invalid fixture text')
  assert(!value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value), 'invalid Unicode fixture text')
  const stripped = value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
  assert(stripped.length > 0, 'blank fixture text')
  if (identifier) assert(stripped === value && !/[\r\n]/u.test(value), 'invalid fixture identifier')
  return value
}

function sha(value: unknown): string {
  assert(typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/u.test(value), 'invalid fixture SHA')
  return value
}

function key(value: unknown): string {
  const result = text(value, 200, true)
  assert(Array.from(result).length >= 8, 'short fixture idempotency key')
  return result
}

function subject(frameId: FixtureFrameId, revision: number): YimengShotVideoSubject {
  assert(Number.isSafeInteger(revision) && revision >= 0, 'invalid fixture revision')
  return {
    schema: 'jason.qingmu-shot-video-subject.v1', projectId: 'project-1', episodeId: 'episode-1', frameId,
    frameNo: frameId === 'frame-z' ? 7 : 12, storyboardRevision: revision,
    frameContentSha256: 'b'.repeat(64), assetId: `video-${frameId}`, assetVersion: 2, assetSha256: 'a'.repeat(64),
  }
}

function details(value: unknown): YimengShotFindingPayload {
  const raw = object(value, FINDING_FIELDS)
  const severity = raw.severity
  assert(severity === 'BLOCKER' || severity === 'MAJOR' || severity === 'MINOR', 'invalid Finding severity')
  assert(Array.isArray(raw.evidenceRefs) && raw.evidenceRefs.length > 0 && raw.evidenceRefs.length <= 32, 'missing Finding evidence')
  return {
    timecode: text(raw.timecode, 128), observation: text(raw.observation),
    evidenceRefs: raw.evidenceRefs.map(value => text(value, 1024)),
    earliestOwner: text(raw.earliestOwner, 256, true), ownerReason: text(raw.ownerReason), severity,
    suggestion: text(raw.suggestion), reworkScope: text(raw.reworkScope),
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
  response.end(JSON.stringify(value))
}

/** Create an isolated, initially unavailable Finding HTTP double for two canonical Shots.
 * @param options - Test-only bearer token, Host HMAC key, and independent canonical encoders.
 * @returns Synchronous HTTP handling and in-memory scenario controls; no I/O starts here.
 */
export function createShotFindingDouble(options: {
  readonly token: string
  readonly attestationKey: string
  readonly canonicalSha256: (value: unknown) => string
  readonly canonicalJson: (value: unknown) => string
}) {
  assert(options.token.length > 0, 'fixture token is required')
  assert(Buffer.byteLength(options.attestationKey, 'utf8') >= 32, 'fixture HMAC key must have at least 32 bytes')
  let mode: FindingMode = 'unavailable'
  let loseResponse = false
  let recoveryVisible = true
  const recorded = new Map<string, { readonly payloadSha256: string; readonly result: YimengShotFindingResult }>()

  function parseRecord(body: unknown, frameId: FixtureFrameId) {
    const raw = object(body, [
      'expectedSubjectSha256', 'idempotencyKey', 'finding', 'methodProjection', 'methodProjectionSha256', 'methodAttestation',
    ])
    const expectedSubjectSha256 = sha(raw.expectedSubjectSha256)
    const idempotencyKey = key(raw.idempotencyKey)
    const finding = details(raw.finding)
    const method = object(raw.methodProjection, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
    assert.equal(method.schema, 'qingmu.imago-shot-finding-method.v1')
    const rawSubject = object(method.subject)
    assert(typeof rawSubject.storyboardRevision === 'number', 'subject revision is required')
    const boundSubject = subject(frameId, rawSubject.storyboardRevision)
    assert.deepEqual(rawSubject, boundSubject, 'method subject must name the exact fixture video and Shot')
    assert.equal(options.canonicalSha256(boundSubject), expectedSubjectSha256, 'subject SHA mismatch')
    assert.equal(method.subjectSnapshotSha256, expectedSubjectSha256)
    const methodProjectionSha256 = sha(raw.methodProjectionSha256)
    assert.equal(options.canonicalSha256(method), methodProjectionSha256, 'method SHA mismatch')
    const unsigned = {
      schema: 'qingmu.imago-shot-finding-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: expectedSubjectSha256, methodProjectionSha256,
    }
    const proof = object(raw.methodAttestation, [...Object.keys(unsigned), 'signature'])
    for (const [name, value] of Object.entries(unsigned)) assert.equal(proof[name], value, `attestation ${name} mismatch`)
    const signature = Buffer.from(sha(proof.signature), 'hex')
    const expected = createHmac('sha256', options.attestationKey).update(options.canonicalJson(unsigned), 'utf8').digest()
    assert(timingSafeEqual(signature, expected), 'Host attestation mismatch')
    const rules = object(method.ruleBindings, RULE_PATHS)
    for (const value of Object.values(rules)) sha(value)
    const rulesSha256 = sha(method.rulesSha256)
    assert.equal(options.canonicalSha256(rules), rulesSha256, 'rules SHA mismatch')
    const definition = object(method.definition, [
      'requiredFields', 'severities', 'ownerOptions', 'statusOnRecord', 'approvalAuthority', 'reworkExecutionAllowed',
    ])
    assert.deepEqual(definition.requiredFields, FINDING_FIELDS)
    assert.deepEqual(definition.severities, SEVERITIES)
    assert.equal(definition.statusOnRecord, 'OPEN')
    assert.equal(definition.approvalAuthority, 'not_granted')
    assert.equal(definition.reworkExecutionAllowed, false)
    assert(Array.isArray(definition.ownerOptions) && definition.ownerOptions.length > 0, 'missing method owner options')
    const owners = new Set<string>()
    for (const value of definition.ownerOptions) {
      const owner = object(value, ['stageId', 'roleId', 'scope'])
      const stageId = text(owner.stageId, 256, true)
      text(owner.roleId, 256, true)
      assert(owner.scope === 'global' || owner.scope === 'per_lsu', 'invalid method owner scope')
      assert(!owners.has(stageId), 'duplicate method owner')
      owners.add(stageId)
    }
    assert(owners.has(finding.earliestOwner), 'Finding owner was not offered by the signed method')
    return { expectedSubjectSha256, idempotencyKey, finding, boundSubject, methodProjectionSha256, rulesSha256 }
  }

  return {
    handle(request: IncomingMessage, response: ServerResponse, url: URL, body: unknown, episodeRevision: number): boolean {
      const match = /^\/api\/qingmu\/projects\/project-1\/episodes\/episode-1\/frames\/(frame-z|frame-1)\/findings(\/command-receipt)?$/u
        .exec(url.pathname)
      const frameId = match?.[1]
      if (frameId !== 'frame-z' && frameId !== 'frame-1') return false
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        json(response, 401, { detail: { code: 'fixture_authentication_required' } })
        return true
      }
      try {
        if (match?.[2] !== undefined) {
          if (request.method !== 'GET') {
            json(response, 405, { detail: { code: 'fixture_recovery_is_read_only' } })
            return true
          }
          assert(body === undefined, 'receipt GET must have no body')
          assert.deepEqual([...url.searchParams.keys()], ['expectedSubjectSha256'])
          const expectedSubjectSha256 = sha(url.searchParams.get('expectedSubjectSha256'))
          const idempotencyKey = key(request.headers['idempotency-key'])
          const stored = recoveryVisible ? recorded.get(idempotencyKey) : undefined
          if (stored !== undefined && (stored.result.finding.subject.frameId !== frameId
            || stored.result.finding.subjectSnapshotSha256 !== expectedSubjectSha256)) {
            json(response, 404, { detail: { code: 'command_receipt_not_found' } })
            return true
          }
          const result: YimengShotFindingRecovery = {
            schema: 'jason.qingmu-shot-finding-recovery.v1', projectId: 'project-1', episodeId: 'episode-1', frameId,
            expectedSubjectSha256, idempotencyKey, status: stored === undefined ? 'not_found' : 'committed',
            result: stored?.result ?? null,
          }
          json(response, 200, result)
          return true
        }
        assert.equal(url.search, '', 'Finding feed and POST must have no query')
        const currentSubject = mode === 'unavailable' ? null : subject(frameId, episodeRevision)
        const currentSha = currentSubject === null ? null : options.canonicalSha256(currentSubject)
        if (request.method === 'GET') {
          assert(body === undefined, 'Finding feed GET must have no body')
          const feed: YimengShotFindingFeedResponse = {
            schema: 'jason.qingmu-shot-finding-feed.v1', projectId: 'project-1', episodeId: 'episode-1', frameId,
            subject: currentSubject, snapshotSha256: currentSha,
            availability: { status: currentSubject === null ? 'unavailable' : 'available', reason: currentSubject === null ? 'selected_video_unavailable' : null },
            capabilities: { canRecordFinding: mode !== 'no-permission' },
            items: [...recorded.values()].filter(item => item.result.finding.subject.frameId === frameId)
              .map(({ result }) => ({ ...result.finding, currentBinding: currentSha === result.finding.subjectSnapshotSha256 })),
          }
          json(response, 200, feed)
          return true
        }
        if (request.method !== 'POST') {
          json(response, 405, { detail: { code: 'fixture_method_not_allowed' } })
          return true
        }
        if (mode === 'no-permission') {
          json(response, 403, { detail: { code: 'qingmu_finding_forbidden' } })
          return true
        }
        const parsed = parseRecord(body, frameId)
        const payloadSha256 = options.canonicalSha256(body)
        const previous = recorded.get(parsed.idempotencyKey)
        if (previous !== undefined && previous.payloadSha256 !== payloadSha256) {
          json(response, 409, { detail: { code: 'idempotency_key_payload_mismatch' } })
          return true
        }
        // Exact replay precedes current-subject checks, matching historical recovery semantics.
        if (previous === undefined && currentSubject === null) {
          json(response, 409, { detail: { code: 'shot_finding_subject_unavailable' } })
          return true
        }
        if (previous === undefined && currentSha !== parsed.expectedSubjectSha256) {
          json(response, 409, { detail: { code: 'shot_finding_subject_conflict' } })
          return true
        }
        const recordId = options.canonicalSha256({
          actorId: ACTOR_ID, idempotencyKey: parsed.idempotencyKey, commandType: 'qingmu.shot_video.finding.v1',
        })
        const result: YimengShotFindingResult = previous?.result ?? {
          schema: 'jason.qingmu-shot-finding-result.v1',
          finding: {
            id: `fixture-finding-${recordId}`, eventId: `fixture-event-${recordId}`,
            subject: parsed.boundSubject, subjectSnapshotSha256: parsed.expectedSubjectSha256, ...parsed.finding,
            status: 'OPEN', actorId: ACTOR_ID, actorRole: 'reviewer',
            authSessionId: createHash('sha256').update(options.token, 'utf8').digest('hex'),
            createdAt: '2026-08-27T13:00:00+00:00',
            methodProjectionSha256: parsed.methodProjectionSha256, rulesSha256: parsed.rulesSha256,
          },
          changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false,
        }
        recorded.set(parsed.idempotencyKey, { payloadSha256, result: structuredClone(result) })
        if (loseResponse) {
          loseResponse = false
          response.destroy()
        } else json(response, previous === undefined ? 201 : 200, result)
        return true
      } catch {
        json(response, 422, { detail: { code: 'fixture_finding_contract_mismatch' } })
        return true
      }
    },
    setMode(value: FindingMode): void { mode = value },
    loseNextRecordResponse(): void { loseResponse = true },
    setRecoveryVisible(value: boolean): void { recoveryVisible = value },
    getRecordedResults(): readonly YimengShotFindingResult[] {
      return structuredClone([...recorded.values()].map(item => item.result))
    },
  }
}
