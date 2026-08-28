import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { normalizeTakeVersionStack } from '../src/take-versions.ts'
import {
  TAKE_VERSION_REQUEST as request,
  takeVersionSha,
  takeVersionStackFixture,
} from './take-version-fixture.ts'

type MutableObject = Record<string, unknown>
const signal = () => new AbortController().signal
const normalize = (value: unknown) => normalizeTakeVersionStack(value, request, takeVersionSha)

function mutable(value: unknown): MutableObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('fixture object missing')
  return value as MutableObject
}

describe('Take/version read-only stack', () => {
  it('accepts the Yimeng asset projection, including fractional JCS fields, without media URLs', () => {
    const feed = takeVersionStackFixture()
    expect(normalize(feed)).toEqual(feed)
    expect(feed.subject.versions.map(version => version.versionOrdinal)).toEqual([1, 2])
    expect(feed.subject.versions[1]).toMatchObject({
      takeId: 'asset-take-2', source: 'regenerate', canAttemptSelection: true,
      qualityPassed: false, lineageComplete: true,
    })
    expect(JSON.stringify(feed)).not.toMatch(/(?:url|localPath|mediaPath)/iu)
  })

  it('keeps an incomplete-lineage candidate visible but rejects a selectable projection', () => {
    const feed = structuredClone(takeVersionStackFixture()) as unknown as MutableObject
    const subject = mutable(feed.subject)
    const versions = subject.versions as MutableObject[]
    versions[1]!.providerTaskId = null
    versions[1]!.lineageComplete = false
    versions[1]!.canAttemptSelection = false
    feed.stackSnapshotSha256 = takeVersionSha(subject)

    const normalized = normalize(feed)
    expect(normalized.subject.versions[1]).toMatchObject({
      lineageComplete: false,
      canAttemptSelection: false,
    })

    versions[1]!.canAttemptSelection = true
    feed.stackSnapshotSha256 = takeVersionSha(subject)
    expect(() => normalize(feed)).toThrow('take versions: derived state is inconsistent')
  })

  it.each(['forged hash', 'extra media URL', 'derived flag', 'ambiguous selection', 'ordinal drift'] as const)(
    'fails closed on %s', (kind) => {
      const feed = structuredClone(takeVersionStackFixture()) as unknown as MutableObject
      const subject = mutable(feed.subject)
      const versions = subject.versions as MutableObject[]
      if (kind === 'forged hash') feed.stackSnapshotSha256 = 'f'.repeat(64)
      if (kind === 'extra media URL') versions[0]!.videoUrl = 'https://not-allowed.invalid/video.mp4'
      if (kind === 'derived flag') versions[1]!.lineageComplete = false
      if (kind === 'ambiguous selection') versions[1]!.isSelected = true
      if (kind === 'ordinal drift') versions[1]!.versionOrdinal = 3
      if (kind !== 'forged hash') feed.stackSnapshotSha256 = takeVersionSha(subject)
      expect(() => normalize(feed)).toThrow()
    },
  )

  it('uses one authenticated encoded GET and rejects browser authority fields before transport', async () => {
    const encodedRequest = { ...request, frameId: 'frame/one?two#three' }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(takeVersionStackFixture(encodedRequest)))
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' },
      { fetch, readToken: () => 'take-version-host-token' },
    )
    expect(await handler('takeVersions', encodedRequest, signal())).toMatchObject({ ok: true })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-take/episodes/episode-take/frames/frame%2Fone%3Ftwo%23three/take-versions',
    )
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer take-version-host-token')
    expect(init?.body).toBeUndefined()

    fetch.mockClear()
    expect(await handler('takeVersions', { ...request, canSelect: true }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not call upstream without the Host token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(takeVersionStackFixture()))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => '' })
    expect(await handler('takeVersions', request, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
})
