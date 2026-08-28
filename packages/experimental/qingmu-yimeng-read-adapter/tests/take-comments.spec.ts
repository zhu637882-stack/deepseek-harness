import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  TAKE_COMMENT_SCOPE,
  takeCommentFeed,
  takeCommentSha,
  takeCommentSubject,
} from './take-comment-fixture.ts'

const signal = () => new AbortController().signal

describe('Take comment read projection', () => {
  it('uses one authenticated encoded GET under the authoritative Take stack', async () => {
    const request = { ...TAKE_COMMENT_SCOPE, frameId: 'frame/one?two#three' }
    const expected = takeCommentFeed(request)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' },
      { fetch, readToken: () => 'take-comment-host-token' },
    )

    expect(await handler('takeComments', request, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-take/episodes/episode-take/frames/frame%2Fone%3Ftwo%23three/take-comments',
    )
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer take-comment-host-token')
    expect(init?.body).toBeUndefined()
  })

  it('binds every current version to the RFC8785 digest of the exact selection-free Take subject', async () => {
    const expected = takeCommentFeed()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'take-comment-host-token' })

    const answer = await handler('takeComments', TAKE_COMMENT_SCOPE, signal())
    expect(answer).toEqual({ ok: true, value: expected })
    for (const version of expected.versions) {
      expect(Object.keys(version.takeSubject).sort()).toEqual([
        'durationMillis', 'episodeId', 'frameContentSha256', 'frameId', 'frameNo', 'outputSha256',
        'projectId', 'schema', 'storyboardRevision', 'takeId', 'versionOrdinal',
      ])
      expect(version.takeSubjectSha256).toBe(takeCommentSha(version.takeSubject))
      expect(version.takeSubject).not.toHaveProperty('selectedTakeId')
      expect(version.takeSubject).not.toHaveProperty('selectionRevision')
      expect(version.takeSubject).not.toHaveProperty('selectionStatus')
    }
  })

  it.each([
    ['forged subject digest', (feed: ReturnType<typeof takeCommentFeed>) => {
      const versions = feed.versions as Array<(typeof feed.versions)[number]>
      versions[0] = { ...versions[0]!, takeSubjectSha256: '0'.repeat(64) }
    }],
    ['selection smuggled into subject', (feed: ReturnType<typeof takeCommentFeed>) => {
      const versions = feed.versions as Array<(typeof feed.versions)[number]>
      versions[0] = {
        ...versions[0]!,
        takeSubject: { ...versions[0]!.takeSubject, selectedTakeId: 'asset-take-1' },
      } as never
    }],
    ['forged current binding', (feed: ReturnType<typeof takeCommentFeed>) => {
      const comments = feed.comments as Array<(typeof feed.comments)[number]>
      comments[1] = { ...comments[1]!, currentBinding: true }
    }],
    ['approval field', (feed: ReturnType<typeof takeCommentFeed>) => {
      const comments = feed.comments as Array<(typeof feed.comments)[number]>
      comments[0] = { ...comments[0]!, approved: true } as never
    }],
    ['non-commenter actor role', (feed: ReturnType<typeof takeCommentFeed>) => {
      const comments = feed.comments as Array<(typeof feed.comments)[number]>
      comments[0] = { ...comments[0]!, actorRole: 'approver' } as never
    }],
    ['findings channel', (feed: ReturnType<typeof takeCommentFeed>) => {
      Object.assign(feed, { findings: [] })
    }],
    ['decisions channel', (feed: ReturnType<typeof takeCommentFeed>) => {
      Object.assign(feed, { decisions: [] })
    }],
  ] as const)('fails closed on %s', async (_name, mutate) => {
    const value = structuredClone(takeCommentFeed())
    mutate(value)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'take-comment-host-token' })

    expect(await handler('takeComments', TAKE_COMMENT_SCOPE, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['selectedTakeId', 'selectionRevision', 'technicalPass', 'formalApproval', 'humanSignoff'])(
    'rejects browser authority field %s before transport', async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(takeCommentFeed()))
      const handler = createYimengReadHandler({}, { fetch, readToken: () => 'take-comment-host-token' })
      expect(await handler('takeComments', { ...TAKE_COMMENT_SCOPE, [field]: true }, signal()))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('does not call upstream without the Host token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(takeCommentFeed()))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => '' })
    expect(await handler('takeComments', TAKE_COMMENT_SCOPE, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps a valid historical comment visible without rebinding it to a current Take', () => {
    const feed = takeCommentFeed()
    const historical = feed.comments.find(comment => !comment.currentBinding)
    expect(historical).toMatchObject({
      id: 'take-comment-historical',
      currentBinding: false,
      anchor: { kind: 'frame', frameNumber: 36 },
    })
    expect(feed.versions.map(version => version.takeSubjectSha256)).not.toContain(historical?.takeSubjectSha256)
    expect(takeCommentSha(takeCommentSubject())).toBe(feed.versions[0]?.takeSubjectSha256)
  })
})
