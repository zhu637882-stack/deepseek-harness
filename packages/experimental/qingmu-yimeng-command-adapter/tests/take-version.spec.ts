import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import type {
  YimengSelectTakeVersionRequest,
  YimengTakeSelectionStackSubject,
  YimengTakeVersionSelectionRecovery,
  YimengTakeVersionSelectionResult,
} from '../src/types.ts'

const TOKEN = 'take-version-host-session-token'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('fixture must be JSON')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function request(): YimengSelectTakeVersionRequest {
  return {
    projectId: 'project-take', episodeId: 'episode-take', frameId: 'frame-take',
    expectedStackSha256: 'a'.repeat(64), expectedSelectedTakeId: 'asset-take-1',
    candidateTakeId: 'asset-take-2', candidateVersionOrdinal: 2,
    candidateOutputSha256: '4'.repeat(64), idempotencyKey: 'select-take-command-0001',
  }
}

function authoritativeStack(input = request()): YimengTakeSelectionStackSubject {
  return {
    schema: 'jason.qingmu-take-version-stack-subject.v1',
    projectId: input.projectId, episodeId: input.episodeId, frameId: input.frameId,
    frameNo: 7, storyboardRevision: 3, frameContentSha256: '1'.repeat(64),
    selectionRevision: 1, selectedTakeId: input.candidateTakeId,
    versions: [
      {
        takeId: 'asset-take-1', versionOrdinal: 1, source: 'initial', role: 'b6_video',
        createdAt: '2026-08-28T10:00:00+00:00', updatedAt: '2026-08-28T10:00:01+00:00',
        durationSec: 5.25, estimatedCny: 0.000001, selectionStatus: 'Stale', isSelected: false,
        qualityStatus: 'passed', qualityPassed: true, qualityCheckCount: 1, blockers: [],
        recordedOutputSha256: '2'.repeat(64), outputSha256: '2'.repeat(64),
        outputBindingStatus: 'verified', taskId: 'generation-task-1', provider: 'dashscope',
        model: 'wan2.1-i2v-plus', providerTaskId: 'provider-task-1', routeKey: 'b6.video_generation',
        inputHash: '3'.repeat(64), lineageComplete: true, canAttemptSelection: false,
      },
      {
        takeId: input.candidateTakeId, versionOrdinal: 2, source: 'regenerate', role: 'b6_video_regenerate',
        createdAt: '2026-08-28T10:01:00+00:00', updatedAt: '2026-08-28T10:01:01+00:00',
        durationSec: 5.5, estimatedCny: null, selectionStatus: 'Selected', isSelected: true,
        qualityStatus: 'failed', qualityPassed: false, qualityCheckCount: 2,
        blockers: ['identity_continuity'], recordedOutputSha256: input.candidateOutputSha256,
        outputSha256: input.candidateOutputSha256, outputBindingStatus: 'verified',
        taskId: 'generation-task-2', provider: 'dashscope', model: 'wan2.1-i2v-plus',
        providerTaskId: 'provider-task-2', routeKey: 'b6.video_generation.regenerate',
        inputHash: '5'.repeat(64), lineageComplete: true, canAttemptSelection: false,
      },
    ],
  }
}

function result(input = request(), token = TOKEN): YimengTakeVersionSelectionResult {
  const stack = authoritativeStack(input)
  return {
    schema: 'jason.qingmu-take-selection-result.v1',
    changeSetId: 'changeset-take-selection', commandReceiptId: 'receipt-take-selection',
    eventId: 'event-take-selection', eventType: 'TakeVersionSelected',
    projectId: input.projectId, episodeId: input.episodeId, frameId: input.frameId,
    selectedTake: {
      takeId: input.candidateTakeId, versionOrdinal: input.candidateVersionOrdinal,
      outputSha256: input.candidateOutputSha256,
    },
    selectionIdentity: {
      actorUserId: 'project-owner', actorNaturalPersonId: 'verified-owner-person',
      actorRole: 'project_owner_selector',
      authSessionId: createHash('sha256').update(token, 'utf8').digest('hex'),
    },
    baseStackSnapshotSha256: input.expectedStackSha256,
    authoritativeStack: stack,
    authoritativeStackSnapshotSha256: sha(stack),
    provenanceTaskId: 'local-selection-provenance-task',
    taskMutation: {
      created: true, kind: 'local_selection_provenance', taskId: 'local-selection-provenance-task',
    },
    idempotencyKey: input.idempotencyKey, deduplicated: false,
    committedAt: '2026-08-28T10:02:00.123456+00:00',
    selectionChanged: true, providerCalls: 0, paidProviderAuthority: 'not_granted',
    budgetMutation: false, humanApprovalInferred: false, formalApprovalChanged: false,
  }
}

function recovery(input = request(), committed = true): YimengTakeVersionSelectionRecovery {
  return {
    schema: 'jason.qingmu-take-selection-recovery.v1', ...input,
    status: committed ? 'committed' : 'not_found', result: committed ? result(input) : null,
  }
}

function handler(fetch: typeof globalThis.fetch, readToken = () => TOKEN) {
  return createYimengCommandHandler({}, { fetch, readToken })
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

const signal = () => new AbortController().signal

describe('Take version selection command transport', () => {
  it.each([201, 200])('sends one exact selection POST on HTTP %s and verifies the natural-person receipt', async (status) => {
    const input = request()
    const expected = { ...result(input), deduplicated: status === 200 }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(expected, status))
    expect(await handler(fetch)('selectTakeVersion', input, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/project-take/episodes/episode-take/frames/frame-take/take-versions/selection')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('Idempotency-Key')).toBe(input.idempotencyKey)
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedStackSha256: input.expectedStackSha256,
      expectedSelectedTakeId: input.expectedSelectedTakeId,
      candidateTakeId: input.candidateTakeId,
      candidateVersionOrdinal: input.candidateVersionOrdinal,
      candidateOutputSha256: input.candidateOutputSha256,
      idempotencyKey: input.idempotencyKey,
    })
    expect(String(init?.body)).not.toContain('actorUserId')
    expect(String(init?.body)).not.toContain('authSessionId')
  })

  it.each([true, false])('recovers by GET only; committed=%s does not bind to the current token', async (committed) => {
    const input = request()
    const expected = recovery(input, committed)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(expected))
    expect(await handler(fetch, () => 'replacement-host-token')(
      'recoverTakeVersionSelection', input, signal(),
    )).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      `http://127.0.0.1:8115/api/qingmu/projects/project-take/episodes/episode-take/frames/frame-take/take-versions/selection-command-receipt?expectedStackSha256=${input.expectedStackSha256}&candidateTakeId=asset-take-2&candidateVersionOrdinal=2&candidateOutputSha256=${input.candidateOutputSha256}&expectedSelectedTakeId=asset-take-1`,
    )
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(input.idempotencyKey)
  })

  it('omits a null previous selection from the GET query while retaining null in the receipt contract', async () => {
    const input = { ...request(), expectedSelectedTakeId: null }
    const expected = recovery(input, false)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(expected))
    expect(await handler(fetch)('recoverTakeVersionSelection', input, signal())).toEqual({ ok: true, value: expected })
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain('expectedSelectedTakeId')
  })

  it.each(['actorUserId', 'actorNaturalPersonId', 'authSessionId', 'approved', 'providerCall'])(
    'rejects browser-supplied %s before transport', async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response(result()))
      expect(await handler(fetch)('selectTakeVersion', { ...request(), [field]: true }, signal()))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['stack hash', 'session identity', 'approval flag', 'selected candidate', 'task mutation'] as const)(
    'rejects a forged %s in the upstream receipt', async (kind) => {
      const value = structuredClone(result()) as unknown as Record<string, unknown>
      if (kind === 'stack hash') value.authoritativeStackSnapshotSha256 = '0'.repeat(64)
      if (kind === 'session identity') {
        (value.selectionIdentity as Record<string, unknown>).authSessionId = '0'.repeat(64)
      }
      if (kind === 'approval flag') value.approved = true
      if (kind === 'selected candidate') {
        (value.selectedTake as Record<string, unknown>).takeId = 'another-take'
      }
      if (kind === 'task mutation') {
        (value.taskMutation as Record<string, unknown>).kind = 'provider_generation'
      }
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response(value, 201))
      expect(await handler(fetch)('selectTakeVersion', request(), signal()))
        .toMatchObject({ ok: false, error: { code: 'internal' } })
      expect(fetch).toHaveBeenCalledOnce()
    },
  )

  it.each([401, 403, 409, 422, 500, 503])('never retries a rejected POST with HTTP %s', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ detail: { code: 'rejected' } }, status))
    expect(await handler(fetch)('selectTakeVersion', request(), signal())).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('never resubmits after an uncertain transport failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    const value = await handler(fetch)('selectTakeVersion', request(), signal())
    expect(value).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(value)).not.toContain(TOKEN)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
