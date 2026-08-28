import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  normalizeEpisodeEvidenceLedger,
  normalizeEpisodeVerification,
} from '../src/episode-evidence.ts'

const request = { projectId: 'project-evidence', episodeId: 'episode-evidence' } as const
const signal = () => new AbortController().signal

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value)
    if (result === undefined) throw new Error('fixture must be JSON')
    return result
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}

const sha = (value: unknown) => createHash('sha256').update(canonical(value), 'utf8').digest('hex')

function ledger() {
  const coordinate = { ...request, frameId: 'frame-evidence' }
  const subject = {
    schema: 'jason.qingmu-take-version-stack-subject.v1', ...coordinate,
    frameNo: 1, storyboardRevision: 1, frameContentSha256: '1'.repeat(64),
    selectionRevision: 0, selectedTakeId: null, versions: [],
  }
  const stack = {
    schema: 'jason.qingmu-take-version-stack.v1', subject, stackSnapshotSha256: sha(subject),
    capabilities: { canCompare: true, canSelect: false },
    boundaries: {
      takeIdAuthority: 'yimeng.assets.id', versionOrdinalPersistence: false,
      versionOrdinalRule: 'created_at_then_asset_id_ascending', selectedIsApproval: false,
      formalApprovalChanged: false, providerAuthority: 'not_granted',
    },
  }
  const comments = {
    schema: 'jason.qingmu-take-comment-feed.v1', ...coordinate, versions: [],
    capabilities: { canComment: false }, comments: [],
  }
  const review = {
    schema: 'jason.qingmu-take-review-authority-feed.v1', ...coordinate,
    capabilities: { canReview: false, canDecide: false }, versions: [], recommendations: [], decisions: [],
    currentDecision: null,
    boundaries: {
      reviewerRecommendationIsApproval: false, decisionMutatesTakeState: false,
      roleOrSessionSwitchCanBypassNaturalPersonSeparation: false,
    },
  }
  const frame = {
    frameId: coordinate.frameId, frameNo: 1, stack, comments, review, acceptance: null, qc: null, lifecycle: null,
    verificationInput: { dialogue: {}, visualAtoms: {}, directorPlan: {} },
  }
  const source = {
    schema: 'jason.qingmu-episode-evidence-source.v1', ...request, frames: [frame],
    verificationInputsSha256: 'a'.repeat(64),
  }
  return {
    schema: 'jason.qingmu-episode-evidence-ledger.v1', ...request, source,
    sourceSnapshotSha256: sha(source),
  }
}

function verification(sourceSnapshotSha256: string) {
  const report = {
    project_id: request.projectId, episode_id: request.episodeId, ok: false,
    errors: ['missing selected video'], warnings: [], technical_errors: ['missing selected video'], creative_errors: [],
    technical_ok: false, creative_ok: true, frame_count: 1, video_asset_count: 0, raw_video_asset_count: 0,
    unverified_video_asset_count: 0, duplicate_video_asset_count: 0, video_frame_coverage_count: 0,
    missing_video_frame_nos: [1], dialogue_asr_required_count: 0, dialogue_asr_verified_count: 0,
    final_delivery_profile: null, final_count: 0,
  }
  return {
    schema: 'jason.qingmu-episode-verification.v1', ...request, sourceSnapshotSha256,
    verification: report, verificationSha256: sha(report), verifiedAt: '2026-08-29T12:00:00Z',
  }
}

describe('episode evidence read adapter', () => {
  it('accepts an empty episode without manufacturing a successful verification', () => {
    const value = ledger()
    value.source.frames = []
    value.sourceSnapshotSha256 = sha(value.source)
    expect(normalizeEpisodeEvidenceLedger(value, request, entry => sha(entry))).toEqual(value)
    const verified = verification(value.sourceSnapshotSha256)
    verified.verification.frame_count = 0
    verified.verification.errors = ['missing_storyboard_frames']
    verified.verification.technical_errors = ['missing_storyboard_frames']
    verified.verification.missing_video_frame_nos = []
    verified.verificationSha256 = sha(verified.verification)
    expect(normalizeEpisodeVerification(verified, { ...request, sourceSnapshotSha256: value.sourceSnapshotSha256 }, entry => sha(entry)))
      .toEqual(verified)
  })

  it('validates a source-pinned no-probe ledger and preserves an unsuccessful canonical report', () => {
    const value = ledger()
    const normalized = normalizeEpisodeEvidenceLedger(value, request, entry => sha(entry))
    expect(normalized).toEqual(value)
    const verified = verification(value.sourceSnapshotSha256)
    expect(normalizeEpisodeVerification(verified, { ...request, sourceSnapshotSha256: value.sourceSnapshotSha256 }, entry => sha(entry)))
      .toEqual(verified)
    expect(verified.verification.ok).toBe(false)
  })

  it.each(['source digest', 'verification digest', 'frame identity', 'frame number'] as const)('fails closed on forged %s', (kind) => {
    const value = structuredClone(ledger()) as Record<string, unknown>
    if (kind === 'source digest') value.sourceSnapshotSha256 = '0'.repeat(64)
    if (kind === 'frame number') {
      const source = value.source as Record<string, unknown>
      const frame = (source.frames as Record<string, unknown>[])[0]!
      frame.frameNo = 2
      value.sourceSnapshotSha256 = sha(source)
    }
    if (kind === 'frame identity') {
      const source = value.source as Record<string, unknown>
      const frame = (source.frames as Record<string, unknown>[])[0]!
      frame.frameId = 'foreign-frame'
    }
    if (kind === 'verification digest') {
      const result = verification(value.sourceSnapshotSha256 as string) as Record<string, unknown>
      result.verificationSha256 = '0'.repeat(64)
      expect(() => normalizeEpisodeVerification(
        result,
        { ...request, sourceSnapshotSha256: value.sourceSnapshotSha256 as string },
        entry => sha(entry),
      )).toThrow()
      return
    }
    expect(() => normalizeEpisodeEvidenceLedger(value, request, entry => sha(entry))).toThrow()
  })

  it('uses authenticated GET for Ledger and strict source-pinned POST for verification', async () => {
    const value = ledger()
    const result = verification(value.sourceSnapshotSha256)
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      return Response.json(init?.method === 'POST' ? result : value)
    })
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815', verificationTimeoutMs: 55_000 },
      { fetch, readToken: () => 'host-token' },
    )
    expect(await handler('evidenceLedger', request, signal())).toEqual({ ok: true, value })
    expect(await handler('verifyEpisode', { ...request, sourceSnapshotSha256: value.sourceSnapshotSha256 }, signal()))
      .toEqual({ ok: true, value: result })
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:18815/api/qingmu/projects/project-evidence/episodes/episode-evidence/evidence-ledger')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(fetch.mock.calls[1]?.[0]).toBe('http://127.0.0.1:18815/api/qingmu/projects/project-evidence/episodes/episode-evidence/verify-episode')
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ sourceSnapshotSha256: value.sourceSnapshotSha256 }) })
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer host-token')
    expect(await handler('verifyEpisode', { ...request, sourceSnapshotSha256: 'F'.repeat(64) }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects a duplicate verification immediately without queuing another upstream request', async () => {
    const value = ledger()
    let release: (() => void) | undefined
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>((resolve) => {
      release = () => { resolve(Response.json(verification(value.sourceSnapshotSha256))) }
    }))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'host-token' })
    const first = handler('verifyEpisode', { ...request, sourceSnapshotSha256: value.sourceSnapshotSha256 }, signal())
    await Promise.resolve()
    await expect(handler('verifyEpisode', { ...request, sourceSnapshotSha256: value.sourceSnapshotSha256 }, signal()))
      .resolves.toMatchObject({ ok: false, error: { message: 'VERIFY_BUSY' } })
    expect(fetch).toHaveBeenCalledOnce()
    release?.()
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('forwards only an allowlisted verification failure code', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(
      { detail: { code: 'evidence_ledger_source_drift', path: '/private/storage' } },
      { status: 409 },
    ))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'host-token' })
    await expect(handler('verifyEpisode', { ...request, sourceSnapshotSha256: 'a'.repeat(64) }, signal()))
      .resolves.toEqual({ ok: false, error: { code: 'internal', message: 'SOURCE_DRIFT', details: {} } })
  })
})
