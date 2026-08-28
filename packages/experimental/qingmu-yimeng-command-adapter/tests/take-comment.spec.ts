import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import {
  takeCommentRecovery,
  takeCommentRequest,
  takeCommentResult,
  type TakeCommentAnchor,
  type TakeCommentRecovery,
  type TakeCommentResult,
} from '../../qingmu-yimeng-read-adapter/tests/take-comment-fixture.ts'

const TOKEN = 'take-comment-host-session-token'
const signal = () => new AbortController().signal

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function handler(fetch: typeof globalThis.fetch, readToken = () => TOKEN) {
  return createYimengCommandHandler({}, { fetch, readToken })
}

describe('Take comment command transport', () => {
  it.each([
    { kind: 'timecode', timecodeMillis: 1_250 },
    { kind: 'frame', frameNumber: 36 },
  ] satisfies TakeCommentAnchor[])('POSTs the exact five fields for a $kind anchor', async (anchor) => {
    const input = takeCommentRequest(anchor)
    const expected = takeCommentResult(input)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(expected, 201))

    expect(await handler(fetch)('createTakeComment', input, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      'http://127.0.0.1:8115/api/qingmu/projects/project-take/episodes/episode-take/frames/frame-take/take-comments',
    )
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('Idempotency-Key')).toBe(input.idempotencyKey)
    const serializedBody = init?.body
    if (typeof serializedBody !== 'string') throw new Error('Take comment body must be serialized JSON')
    const body = JSON.parse(serializedBody) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      'anchor', 'body', 'expectedTakeSubjectSha256', 'idempotencyKey', 'takeId',
    ])
    expect(body).toEqual({
      expectedTakeSubjectSha256: input.expectedTakeSubjectSha256,
      takeId: input.takeId,
      anchor,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
    })
    expect(serializedBody).not.toMatch(
      /projectId|episodeId|frameId|selected|technical|pass|approv|verif|signoff|provider/iu,
    )
  })

  it.each([
    { name: 'both coordinate fields', anchor: { kind: 'timecode', timecodeMillis: 1_250, frameNumber: 36 } },
    { name: 'wrong coordinate field', anchor: { kind: 'frame', timecodeMillis: 1_250 } },
    { name: 'missing coordinate field', anchor: { kind: 'timecode' } },
    { name: 'unknown kind', anchor: { kind: 'shot', frameNumber: 36 } },
    { name: 'frame zero', anchor: { kind: 'frame', frameNumber: 0 } },
    { name: 'frame below one', anchor: { kind: 'frame', frameNumber: -1 } },
  ])('rejects an anchor that is not exact-one-of: $name', async ({ anchor }) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(takeCommentResult()))
    const input = { ...takeCommentRequest(), anchor }
    expect(await handler(fetch)('createTakeComment', input, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    'actorId', 'actorRole', 'authSessionId', 'currentBinding', 'selectedTakeId', 'selectionRevision',
    'technicalPass', 'formalApproval', 'episodeVerification', 'humanSignoff', 'providerCalls',
    'findings', 'decisions', 'approvals',
  ])('rejects browser authority or adjacent-channel field %s before transport', async (field) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(takeCommentResult()))
    expect(await handler(fetch)('createTakeComment', { ...takeCommentRequest(), [field]: true }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['comment Take', (value: MutableDeep<TakeCommentResult>) => {
      value.comment = { ...value.comment, takeId: 'asset-take-2' }
    }],
    ['comment subject', (value: MutableDeep<TakeCommentResult>) => {
      value.comment = { ...value.comment, takeSubjectSha256: '0'.repeat(64) }
    }],
    ['comment anchor', (value: MutableDeep<TakeCommentResult>) => {
      value.comment = { ...value.comment, anchor: { kind: 'frame', frameNumber: 4 } }
    }],
    ['comment body', (value: MutableDeep<TakeCommentResult>) => {
      value.comment = { ...value.comment, body: '另一条评论' }
    }],
    ['comment actor role', (value: MutableDeep<TakeCommentResult>) => {
      value.comment = { ...value.comment, actorRole: 'approver' as never }
    }],
    ['generic mutation impact', (value: MutableDeep<TakeCommentResult>) => {
      value.changed = true as never
    }],
    ['selection impact', (value: MutableDeep<TakeCommentResult>) => {
      value.selectionChanged = true as never
    }],
    ['technical PASS impact', (value: MutableDeep<TakeCommentResult>) => {
      value.technicalPassChanged = true as never
    }],
    ['formal approval impact', (value: MutableDeep<TakeCommentResult>) => {
      value.formalApprovalChanged = true as never
    }],
    ['episode verification impact', (value: MutableDeep<TakeCommentResult>) => {
      value.episodeVerificationChanged = true as never
    }],
    ['human signoff inference', (value: MutableDeep<TakeCommentResult>) => {
      value.humanSignoffInferred = true as never
    }],
    ['Provider call', (value: MutableDeep<TakeCommentResult>) => {
      value.providerCalls = 1 as never
    }],
    ['budget mutation', (value: MutableDeep<TakeCommentResult>) => {
      value.budgetMutation = true as never
    }],
    ['approval field', (value: MutableDeep<TakeCommentResult>) => {
      Object.assign(value, { approved: true })
    }],
  ] as const)('rejects a forged %s in the create receipt', async (_name, mutate) => {
    const value = structuredClone(takeCommentResult()) as MutableDeep<TakeCommentResult>
    mutate(value)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(value, 201))
    expect(await handler(fetch)('createTakeComment', takeCommentRequest(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([true, false])('recovers by GET only and verifies the exact envelope; committed=%s', async (committed) => {
    const input = takeCommentRequest({ kind: 'frame', frameNumber: 36 })
    const expected = takeCommentRecovery(input, committed)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(expected))

    expect(await handler(fetch, () => 'replacement-host-token')('recoverTakeComment', input, signal()))
      .toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      `http://127.0.0.1:8115/api/qingmu/projects/project-take/episodes/episode-take/frames/frame-take/take-comments/command-receipt?expectedTakeSubjectSha256=${input.expectedTakeSubjectSha256}&takeId=asset-take-1`,
    )
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer replacement-host-token')
    expect(headers.get('Idempotency-Key')).toBe(input.idempotencyKey)
  })

  it.each([
    ['envelope Take', (value: MutableDeep<TakeCommentRecovery>) => { value.takeId = 'asset-take-2' }],
    ['envelope subject', (value: MutableDeep<TakeCommentRecovery>) => {
      value.expectedTakeSubjectSha256 = '0'.repeat(64)
    }],
    ['envelope idempotency key', (value: MutableDeep<TakeCommentRecovery>) => {
      value.idempotencyKey = 'another-command-key'
    }],
    ['committed null receipt', (value: MutableDeep<TakeCommentRecovery>) => { value.result = null }],
    ['receipt body', (value: MutableDeep<TakeCommentRecovery>) => {
      if (value.result === null) throw new Error('fixture result missing')
      value.result.comment = { ...value.result.comment, body: '另一条评论' }
    }],
    ['receipt anchor', (value: MutableDeep<TakeCommentRecovery>) => {
      if (value.result === null) throw new Error('fixture result missing')
      value.result.comment = { ...value.result.comment, anchor: { kind: 'timecode', timecodeMillis: 1 } }
    }],
  ] as const)('rejects recovered receipt drift: %s', async (_name, mutate) => {
    const input = takeCommentRequest({ kind: 'frame', frameNumber: 36 })
    const value = structuredClone(takeCommentRecovery(input, true)) as MutableDeep<TakeCommentRecovery>
    mutate(value)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(value))
    expect(await handler(fetch)('recoverTakeComment', input, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects a Host credential reflected by a successful create receipt', async () => {
    const value = structuredClone(takeCommentResult()) as MutableDeep<TakeCommentResult>
    value.comment = { ...value.comment, actorId: TOKEN }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(value, 201))

    const result = await handler(fetch)('createTakeComment', takeCommentRequest(), signal())

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects a Host credential reflected by a committed recovery receipt', async () => {
    const input = takeCommentRequest({ kind: 'frame', frameNumber: 36 })
    const value = structuredClone(takeCommentRecovery(input, true)) as MutableDeep<TakeCommentRecovery>
    if (value.result === null) throw new Error('fixture result missing')
    value.result.comment = { ...value.result.comment, actorId: TOKEN }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(value))

    const result = await handler(fetch)('recoverTakeComment', input, signal())

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([401, 403, 409, 422, 500, 503])('never retries a rejected POST with HTTP %s', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ detail: { code: 'rejected' } }, status))
    expect(await handler(fetch)('createTakeComment', takeCommentRequest(), signal())).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('never resubmits after an uncertain transport failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    const value = await handler(fetch)('createTakeComment', takeCommentRequest(), signal())
    expect(value).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(value)).not.toContain(TOKEN)
    expect(fetch).toHaveBeenCalledOnce()
  })
})

type MutableDeep<T> = T extends object ? { -readonly [K in keyof T]: MutableDeep<T[K]> } : T
