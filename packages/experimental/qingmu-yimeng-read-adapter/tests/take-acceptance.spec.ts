import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { normalizeTakeAcceptance } from '../src/take-acceptance.ts'
import {
  TAKE_ACCEPTANCE_REQUEST as request,
  takeAcceptanceFixture,
} from './take-acceptance-fixture.ts'
import { takeVersionSha } from './take-version-fixture.ts'

type MutableObject = Record<string, unknown>
const signal = () => new AbortController().signal
const normalize = (value: unknown) => normalizeTakeAcceptance(value, request, takeVersionSha)

function mutable(value: unknown): MutableObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('fixture object missing')
  return value as MutableObject
}

describe('selected Take acceptance evidence', () => {
  it('accepts strict decode and current macro/micro QC without granting production approval', () => {
    const feed = takeAcceptanceFixture()
    expect(normalize(feed)).toEqual(feed)
    expect(feed.evidence.technicalReceipt).toMatchObject({
      status: 'PASS', fullVideoDecode: { status: 'PASS', returncode: 0 },
    })
    expect(feed.evidence.candidateQuality.status).toBe('PASS')
    expect(feed.evidence.providerReceipt.status).toBe('bounded_local')
    expect(feed.productionStatus).toBe('UNVERIFIED_FOR_PAID_PRODUCTION')
    expect(feed.boundaries).toMatchObject({ selectedIsApproval: false, gateBCompleted: false })
    expect(JSON.stringify(feed)).not.toMatch(/(?:url|localPath|mediaPath|responseJson)/iu)
  })

  it.each(['evidence hash', 'media hash', 'frame rate', 'provider status', 'QC freshness', 'extra URL'] as const)(
    'fails closed on forged %s', (kind) => {
      const feed = structuredClone(takeAcceptanceFixture()) as unknown as MutableObject
      const evidence = mutable(feed.evidence)
      const subject = mutable(evidence.subject)
      const technical = mutable(evidence.technicalReceipt)
      const video = mutable(technical.video)
      const provider = mutable(evidence.providerReceipt)
      const quality = mutable(evidence.candidateQuality)
      const checks = quality.checks as MutableObject[]
      if (kind === 'evidence hash') feed.evidenceSnapshotSha256 = 'f'.repeat(64)
      if (kind === 'media hash') mutable(technical.media).sha256 = 'e'.repeat(64)
      if (kind === 'frame rate') video.actualAverageFrameRate = 30
      if (kind === 'provider status') provider.actualProviderReceiptVerified = true
      if (kind === 'QC freshness') checks[0]!.current = false
      if (kind === 'extra URL') subject.mediaUrl = 'https://not-allowed.invalid/take.mp4'
      if (kind !== 'evidence hash') feed.evidenceSnapshotSha256 = takeVersionSha(evidence)
      expect(() => normalize(feed)).toThrow()
    },
  )

  it('accepts a fully verified historical Provider outbox but keeps Gate B closed', () => {
    const feed = structuredClone(takeAcceptanceFixture()) as unknown as MutableObject
    const evidence = mutable(feed.evidence)
    const provider = mutable(evidence.providerReceipt)
    provider.status = 'verified'
    provider.evidenceMode = 'provider_receipt'
    provider.actualProviderReceiptVerified = true
    provider.requestDryRun = false
    provider.outboxState = 'acknowledged'
    provider.dispatchEpoch = 1
    provider.dispatchDigest = '4'.repeat(64)
    provider.responseSha256 = '5'.repeat(64)
    provider.blockers = []
    feed.evidenceSnapshotSha256 = takeVersionSha(evidence)

    expect(normalize(feed)).toMatchObject({
      evidence: { providerReceipt: { status: 'verified', actualProviderReceiptVerified: true } },
      productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
      boundaries: { gateBCompleted: false },
    })
  })

  it('uses one authenticated encoded GET and rejects browser authority fields before transport', async () => {
    const encodedRequest = { ...request, frameId: 'frame/one?two#three' }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(takeAcceptanceFixture(encodedRequest)))
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' },
      { fetch, readToken: () => 'take-acceptance-host-token' },
    )
    expect(await handler('takeAcceptance', encodedRequest, signal())).toMatchObject({ ok: true })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-take/episodes/episode-take/frames/frame%2Fone%3Ftwo%23three/take-versions/acceptance',
    )
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer take-acceptance-host-token')
    expect(init?.body).toBeUndefined()

    fetch.mockClear()
    expect(await handler('takeAcceptance', { ...request, approved: true }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not call upstream without the Host token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(takeAcceptanceFixture()))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => '' })
    expect(await handler('takeAcceptance', request, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
})
