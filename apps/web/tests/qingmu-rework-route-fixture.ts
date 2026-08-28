// Controlled HTTP double for one bounded rework-route browser scenario. All
// records live only in this process; no Provider, worker, task, approval,
// Finding closure, rework execution, or persistent business database exists.
import assert from 'node:assert/strict'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  YimengReworkRouteSourceResponse,
  YimengReworkRouteSubject,
  YimengShotFindingResult,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  YimengImagoReworkRouteMethodAttestation,
  YimengImagoReworkRouteMethodProjection,
  YimengRecordReworkRouteRequest,
  YimengReworkRouteAuthorityProbe,
  YimengReworkRouteRecovery,
  YimengReworkRouteResult,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const FALSE_AUTHORITY_FIELDS = [
  'findingClosureAllowed', 'taskCreationAllowed', 'selectionChangeAllowed',
  'stageDecisionChangeAllowed', 'lockInvalidationAllowed', 'reworkExecutionAllowed',
  'paidGenerationAuthorized', 'automaticRetry', 'providerChangeAuthorized',
  'unboundedRedoAuthorized', 'completionReleaseAllowed',
] as const
const ROUTE_PATH = new RegExp(
  '^/api/qingmu/projects/([^/]+)/episodes/([^/]+)/shots/([^/]+)'
    + '/findings/([^/]+)/rework-route/(source|routes|authority-probe|route-command-receipt)$',
  'u',
)

function object(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected route fixture object')
  if (fields !== undefined) assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), 'unexpected route fixture fields')
  return value as Record<string, unknown>
}

function identifier(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 256, 'invalid route fixture identifier')
  assert(value.trim() === value && !/[\r\n\0]/u.test(value), 'non-canonical route fixture identifier')
  return value
}

function sha(value: unknown): string {
  assert(typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value), 'invalid route fixture SHA')
  return value
}

function safeInteger(value: unknown): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid route fixture revision')
  return value
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
  response.end(JSON.stringify(value))
}

/** One deterministic current Shot -> LSU -> sealed-plan -> C5F-lock chain. */
function routeSubject(
  findingResult: YimengShotFindingResult,
  planRulesSha256: string,
  lockRulesSha256: string,
  digest: (value: unknown) => string,
): YimengReworkRouteSubject {
  const selectedVideo = findingResult.finding.subject
  const unitSuffix = String(selectedVideo.frameNo).padStart(2, '0')
  const source = {
    schema: 'jason.qingmu-production-unit-source.v1' as const,
    projectId: selectedVideo.projectId,
    episodeId: selectedVideo.episodeId,
    groupId: `group-${selectedVideo.frameNo}`,
    groupNo: selectedVideo.frameNo,
    title: `第${selectedVideo.frameNo}执行组`,
    groupExecutionPromptSha256: digest({ frameId: selectedVideo.frameId, purpose: 'bounded-route-browser-source' }),
    storyboardRevision: selectedVideo.storyboardRevision,
    shots: [{
      frameId: selectedVideo.frameId,
      frameNo: selectedVideo.frameNo,
      frameContentSha256: selectedVideo.frameContentSha256,
    }],
  }
  const unitId = `LSU${unitSuffix}`
  const bindingRevision = 1
  const sourceSnapshotSha256 = digest(source)
  const bindingSha256 = digest({ unitId, bindingRevision, sourceSnapshotSha256 })
  const planSubject = {
    schema: 'jason.qingmu-lsu-plan-subject.v1' as const,
    projectId: selectedVideo.projectId,
    episodeId: selectedVideo.episodeId,
    productionUnits: [{
      unitId,
      groupId: source.groupId,
      bindingRevision,
      bindingSha256,
      sourceSnapshotSha256,
    }],
    productionBlueprintLock: {
      lockId: 'PRODUCTION_BLUEPRINT_LOCK' as const,
      stageId: 'C5F' as const,
      scopeInstance: 'GLOBAL' as const,
      artifactRecordRevision: 1,
      artifactRecordSha256: digest({ unitId, artifact: 'production-blueprint' }),
      decisionId: `decision-c5f-${selectedVideo.frameId}`,
      eventSha256: digest({ unitId, event: 'production-blueprint-lock' }),
    },
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-subject.v1',
    projectId: selectedVideo.projectId,
    episodeId: selectedVideo.episodeId,
    selectedVideo,
    finding: {
      id: findingResult.finding.id,
      eventId: findingResult.finding.eventId,
      subjectSnapshotSha256: findingResult.finding.subjectSnapshotSha256,
      timecode: findingResult.finding.timecode,
      observation: findingResult.finding.observation,
      evidenceRefs: findingResult.finding.evidenceRefs,
      earliestOwner: findingResult.finding.earliestOwner,
      ownerReason: findingResult.finding.ownerReason,
      severity: findingResult.finding.severity,
      suggestion: findingResult.finding.suggestion,
      reworkScope: findingResult.finding.reworkScope,
      status: 'OPEN',
      methodProjectionSha256: findingResult.finding.methodProjectionSha256,
      rulesSha256: findingResult.finding.rulesSha256,
    },
    productionUnit: { unitId, bindingRevision, bindingSha256, sourceSnapshotSha256, source },
    sealedPlan: {
      revision: 1,
      sealSha256: digest({ subject: planSubject, action: 'sealed' }),
      subjectSnapshotSha256: digest(planSubject),
      methodProjectionSha256: digest({ subject: planSubject, method: 'lsu-plan-browser-fixture' }),
      rulesSha256: planRulesSha256,
      lockRulesSha256,
      subject: planSubject,
    },
  }
}

function parseMethod(
  rawProjection: unknown,
  rawProjectionSha256: unknown,
  rawAttestation: unknown,
  expectedSubject: YimengReworkRouteSubject,
  options: {
    readonly attestationKey: string
    readonly canonicalJson: (value: unknown) => string
    readonly canonicalSha256: (value: unknown) => string
  },
): {
  readonly projection: YimengImagoReworkRouteMethodProjection
  readonly projectionSha256: string
  readonly methodAttestation: YimengImagoReworkRouteMethodAttestation
} {
  const projection = object(rawProjection, [
    'schema', 'subject', 'subjectSnapshotSha256', 'definition', 'routeInstruction',
    'ruleBindings', 'rulesSha256', 'lockRuleBindings', 'lockRulesSha256',
  ])
  assert.equal(projection.schema, 'qingmu.imago-bounded-rework-route-method.v1')
  assert.deepEqual(projection.subject, expectedSubject, 'route Method subject must be the exact current chain')
  assert.equal(projection.subjectSnapshotSha256, options.canonicalSha256(expectedSubject))
  const projectionSha256 = sha(rawProjectionSha256)
  assert.equal(options.canonicalSha256(projection), projectionSha256, 'route Method projection SHA mismatch')
  const ruleBindings = object(projection.ruleBindings)
  const lockRuleBindings = object(projection.lockRuleBindings)
  assert(Object.keys(ruleBindings).length > 0 && Object.values(ruleBindings).every(value => /^[0-9a-f]{64}$/u.test(String(value))))
  assert(Object.keys(lockRuleBindings).length > 0 && Object.values(lockRuleBindings).every(value => /^[0-9a-f]{64}$/u.test(String(value))))
  assert.equal(options.canonicalSha256(ruleBindings), sha(projection.rulesSha256))
  assert.equal(options.canonicalSha256(lockRuleBindings), sha(projection.lockRulesSha256))
  const definition = object(projection.definition)
  assert.equal(definition.id, 'IMAGO-V6-BOUNDED-REWORK-ROUTE')
  assert.equal(definition.operation, 'record_bounded_rework_route')
  assert.equal(definition.providerCalls, 0)
  for (const field of FALSE_AUTHORITY_FIELDS) assert.equal(definition[field], false, `route Method granted ${field}`)
  const instruction = object(projection.routeInstruction)
  assert.equal(instruction.state, 'BOUNDED_REWORK_ROUTED')
  assert.equal(instruction.findingId, expectedSubject.finding.id)
  assert.equal(instruction.unitId, expectedSubject.productionUnit.unitId)
  assert.equal(instruction.scopeExpansionForbidden, true)
  const unsigned = {
    schema: 'qingmu.imago-bounded-rework-route-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: projection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  const attestation = object(rawAttestation, [...Object.keys(unsigned), 'signature'])
  for (const [field, value] of Object.entries(unsigned)) assert.equal(attestation[field], value, `route attestation ${field} mismatch`)
  const signature = Buffer.from(sha(attestation.signature), 'hex')
  const expectedSignature = createHmac('sha256', options.attestationKey)
    .update(options.canonicalJson(unsigned), 'utf8').digest()
  assert(timingSafeEqual(signature, expectedSignature), 'route Host attestation mismatch')
  return {
    projection: projection as unknown as YimengImagoReworkRouteMethodProjection,
    projectionSha256,
    methodAttestation: attestation as unknown as YimengImagoReworkRouteMethodAttestation,
  }
}

function makeRouteResult(
  request: YimengRecordReworkRouteRequest,
  method: ReturnType<typeof parseMethod>,
  token: string,
  digest: (value: unknown) => string,
): YimengReworkRouteResult {
  const lineage = digest({ findingId: request.findingId, idempotencyKey: request.idempotencyKey })
  const route = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    findingId: request.findingId,
    revision: request.expectedRouteRevision + 1,
    subject: method.projection.subject,
    subjectSnapshotSha256: method.projection.subjectSnapshotSha256,
    definition: method.projection.definition,
    routeInstruction: method.projection.routeInstruction,
    methodProjectionSha256: method.projectionSha256,
    rulesSha256: method.projection.rulesSha256,
    lockRulesSha256: method.projection.lockRulesSha256,
    actorId: 'route-reviewer-fixture',
    actorNaturalPersonId: 'natural-route-reviewer-fixture',
    authSessionId: createHash('sha256').update(token, 'utf8').digest('hex'),
    eventId: `event-route-${lineage}`,
    changeSetId: `changeset-route-${lineage}`,
    routedAt: '2026-08-28T01:00:00Z',
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-result.v1',
    route,
    routeSha256: digest(route),
    receiptId: `receipt-route-${lineage}`,
    outboxEventId: route.eventId,
    routeRecorded: true,
    findingClosed: false,
    selectionChanged: false,
    stageDecisionChanged: false,
    lockInvalidated: false,
    taskCreated: false,
    providerCalls: 0,
    reworkExecuted: false,
    humanSignoffInferred: false,
  }
}

function sameCurrentRoute(result: YimengReworkRouteResult, method: ReturnType<typeof parseMethod>): boolean {
  return result.route.subjectSnapshotSha256 === method.projection.subjectSnapshotSha256
    && result.route.methodProjectionSha256 === method.projectionSha256
    && result.route.rulesSha256 === method.projection.rulesSha256
    && result.route.lockRulesSha256 === method.projection.lockRulesSha256
}

/** Create an isolated bounded-route double bound to the recorded Finding feed. */
export function createReworkRouteDouble(options: {
  readonly token: string
  readonly attestationKey: string
  readonly canonicalJson: (value: unknown) => string
  readonly canonicalSha256: (value: unknown) => string
  readonly getRecordedFindings: () => readonly YimengShotFindingResult[]
}) {
  assert(options.token.length > 0, 'route fixture token is required')
  assert(Buffer.byteLength(options.attestationKey, 'utf8') >= 32, 'route fixture HMAC key must have at least 32 bytes')
  let loseRecordResponse = false
  const receipts = new Map<string, {
    readonly request: YimengRecordReworkRouteRequest
    readonly payloadSha256: string
    readonly result: YimengReworkRouteResult
  }>()
  const routes = new Map<string, YimengReworkRouteResult>()

  function finding(findingId: string, frameId: string): YimengShotFindingResult {
    const result = options.getRecordedFindings().find(item => item.finding.id === findingId)
    assert(result !== undefined && result.finding.subject.frameId === frameId, 'route Finding is not in the recorded feed')
    assert.equal(result.finding.status, 'OPEN', 'route Finding must remain OPEN')
    return result
  }

  function sourceSubject(findingId: string, frameId: string, planRules: string, lockRules: string) {
    return routeSubject(finding(findingId, frameId), planRules, lockRules, options.canonicalSha256)
  }

  return {
    handle(request: IncomingMessage, response: ServerResponse, url: URL, body: unknown): boolean {
      const match = ROUTE_PATH.exec(url.pathname)
      if (match === null) return false
      const [, encodedProjectId, encodedEpisodeId, encodedFrameId, encodedFindingId, operation] = match
      const projectId = identifier(decodeURIComponent(encodedProjectId ?? ''))
      const episodeId = identifier(decodeURIComponent(encodedEpisodeId ?? ''))
      const frameId = identifier(decodeURIComponent(encodedFrameId ?? ''))
      const findingId = identifier(decodeURIComponent(encodedFindingId ?? ''))
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        json(response, 401, { detail: { code: 'fixture_authentication_required' } })
        return true
      }
      try {
        assert.equal(projectId, 'project-1')
        assert.equal(episodeId, 'episode-1')
        if (operation === 'source') {
          assert.equal(request.method, 'GET')
          assert.equal(body, undefined)
          assert.deepEqual([...url.searchParams.keys()].sort(), ['lockRulesSha256', 'planRulesSha256', 'routeRulesSha256'])
          const routeRulesSha256 = sha(url.searchParams.get('routeRulesSha256'))
          const planRulesSha256 = sha(url.searchParams.get('planRulesSha256'))
          const lockRulesSha256 = sha(url.searchParams.get('lockRulesSha256'))
          const subject = sourceSubject(findingId, frameId, planRulesSha256, lockRulesSha256)
          const latestRoute = routes.get(findingId) ?? null
          const latestRouteSourceCurrent = latestRoute !== null
            && latestRoute.route.subjectSnapshotSha256 === options.canonicalSha256(subject)
            && latestRoute.route.rulesSha256 === routeRulesSha256
            && latestRoute.route.lockRulesSha256 === lockRulesSha256
          const feed: YimengReworkRouteSourceResponse = {
            schema: 'jason.qingmu-bounded-rework-route-feed.v1',
            projectId,
            episodeId,
            frameId,
            findingId,
            capabilities: { canRecordRoute: true },
            subject,
            subjectSnapshotSha256: options.canonicalSha256(subject),
            availability: { status: 'available', reason: null },
            latestRoute: latestRoute as unknown as YimengReworkRouteSourceResponse['latestRoute'],
            latestRouteSourceCurrent,
            currentRouteRulesSha256: routeRulesSha256,
            currentPlanRulesSha256: planRulesSha256,
            currentLockRulesSha256: lockRulesSha256,
            findingClosed: false,
            selectionChanged: false,
            stageDecisionChanged: false,
            lockInvalidated: false,
            taskCreated: false,
            providerCalls: 0,
            reworkExecuted: false,
            humanSignoffInferred: false,
          }
          json(response, 200, feed)
          return true
        }
        if (operation === 'route-command-receipt') {
          assert.equal(request.method, 'GET')
          assert.equal(body, undefined)
          const expectedKeys = ['expectedRouteRevision', 'expectedSubjectSha256']
          if (url.searchParams.has('expectedRouteSha256')) expectedKeys.push('expectedRouteSha256')
          assert.deepEqual([...url.searchParams.keys()].sort(), expectedKeys.sort())
          const expectedSubjectSha256 = sha(url.searchParams.get('expectedSubjectSha256'))
          const expectedRouteRevision = safeInteger(Number(url.searchParams.get('expectedRouteRevision')))
          const expectedRouteSha256 = url.searchParams.has('expectedRouteSha256')
            ? sha(url.searchParams.get('expectedRouteSha256')) : null
          const idempotencyKey = identifier(request.headers['idempotency-key'])
          const stored = receipts.get(idempotencyKey)
          const found = stored !== undefined
            && stored.request.projectId === projectId && stored.request.episodeId === episodeId
            && stored.request.frameId === frameId && stored.request.findingId === findingId
            && stored.request.expectedSubjectSha256 === expectedSubjectSha256
            && stored.request.expectedRouteRevision === expectedRouteRevision
            && stored.request.expectedRouteSha256 === expectedRouteSha256
          const recovery: YimengReworkRouteRecovery = {
            schema: 'jason.qingmu-bounded-rework-route-recovery.v1',
            projectId,
            episodeId,
            findingId,
            expectedSubjectSha256,
            expectedRouteRevision,
            expectedRouteSha256,
            idempotencyKey,
            found,
            result: found ? stored.result : null,
          }
          json(response, 200, recovery)
          return true
        }
        const raw = object(body, operation === 'routes'
          ? ['expectedSubjectSha256', 'expectedRouteRevision', 'expectedRouteSha256', 'methodProjection', 'methodProjectionSha256', 'methodAttestation', 'idempotencyKey']
          : ['methodProjection', 'methodProjectionSha256', 'methodAttestation'])
        assert.equal(request.method, 'POST')
        assert.equal(url.search, '')
        const rawProjection = object(raw.methodProjection)
        const rawSubject = object(rawProjection.subject)
        const rawSealedPlan = object(rawSubject.sealedPlan)
        const currentSubject = sourceSubject(
          findingId,
          frameId,
          sha(rawSealedPlan.rulesSha256),
          sha(rawProjection.lockRulesSha256),
        )
        const method = parseMethod(
          raw.methodProjection,
          raw.methodProjectionSha256,
          raw.methodAttestation,
          currentSubject,
          options,
        )
        if (operation === 'authority-probe') {
          const candidate = routes.get(findingId) ?? null
          const latestRoute = candidate !== null && sameCurrentRoute(candidate, method) ? candidate : null
          const currentRouteRecorded = latestRoute !== null
          const probe: YimengReworkRouteAuthorityProbe = {
            schema: 'jason.qingmu-bounded-rework-route-authority-probe.v1',
            projectId,
            episodeId,
            findingId,
            subjectSnapshotSha256: method.projection.subjectSnapshotSha256,
            methodProjectionSha256: method.projectionSha256,
            rulesSha256: method.projection.rulesSha256,
            lockRulesSha256: method.projection.lockRulesSha256,
            latestRoute,
            currentRouteRecorded,
            routeRecorded: currentRouteRecorded,
            findingClosed: false,
            selectionChanged: false,
            stageDecisionChanged: false,
            lockInvalidated: false,
            taskCreated: false,
            providerCalls: 0,
            reworkExecuted: false,
            humanSignoffInferred: false,
          }
          json(response, 200, probe)
          return true
        }
        const intent: YimengRecordReworkRouteRequest = {
          projectId,
          episodeId,
          frameId,
          findingId,
          expectedSubjectSha256: sha(raw.expectedSubjectSha256),
          expectedRouteRevision: safeInteger(raw.expectedRouteRevision),
          expectedRouteSha256: raw.expectedRouteSha256 === null ? null : sha(raw.expectedRouteSha256),
          idempotencyKey: identifier(raw.idempotencyKey),
        }
        assert.equal(intent.expectedSubjectSha256, method.projection.subjectSnapshotSha256)
        const payloadSha256 = options.canonicalSha256(body)
        const replay = receipts.get(intent.idempotencyKey)
        if (replay !== undefined) {
          assert.equal(replay.payloadSha256, payloadSha256, 'route idempotency payload mismatch')
          json(response, 200, replay.result)
          return true
        }
        const head = routes.get(findingId)
        assert.equal(intent.expectedRouteRevision, head?.route.revision ?? 0, 'route head revision conflict')
        assert.equal(intent.expectedRouteSha256, head?.routeSha256 ?? null, 'route head SHA conflict')
        const result = makeRouteResult(intent, method, options.token, options.canonicalSha256)
        receipts.set(intent.idempotencyKey, { request: intent, payloadSha256, result: structuredClone(result) })
        routes.set(findingId, structuredClone(result))
        if (loseRecordResponse) {
          loseRecordResponse = false
          response.destroy()
        } else json(response, 201, result)
        return true
      } catch {
        if (!response.destroyed && !response.writableEnded) {
          json(response, 422, { detail: { code: 'fixture_rework_route_contract_mismatch' } })
        }
        return true
      }
    },
    loseNextRecordResponse(): void { loseRecordResponse = true },
    getRecordedResults(): readonly YimengReworkRouteResult[] {
      return structuredClone([...routes.values()])
    },
  }
}
