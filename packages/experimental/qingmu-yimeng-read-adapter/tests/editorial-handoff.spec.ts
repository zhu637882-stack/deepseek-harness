import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { normalizeEditorialHandoff } from '../src/editorial-handoff.ts'

const request = { projectId: 'project-handoff', episodeId: 'episode-handoff' } as const

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}
const sha = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')

function projection() {
  const takeSubject = {
    schema: 'jason.qingmu-take-comment-subject.v1', ...request, frameId: 'frame-1', frameNo: 1,
    storyboardRevision: 1, frameContentSha256: '3'.repeat(64), takeId: 'asset-1',
    versionOrdinal: 1, outputSha256: '5'.repeat(64), durationMillis: 5000,
  }
  const versions = [{ takeSubject, takeSubjectSha256: sha(takeSubject) }]
  const comments = {
    schema: 'jason.qingmu-take-comment-feed.v1', ...request, frameId: 'frame-1', versions,
    capabilities: { canComment: true }, comments: [],
  }
  const review = {
    schema: 'jason.qingmu-take-review-authority-feed.v1', ...request, frameId: 'frame-1', versions,
    capabilities: { canReview: true, canDecide: true }, recommendations: [], decisions: [],
    currentDecision: null, boundaries: {
      reviewerRecommendationIsApproval: false, decisionMutatesTakeState: false,
      roleOrSessionSwitchCanBypassNaturalPersonSeparation: false,
    },
  }
  const source = {
    schema: 'jason.qingmu-editorial-handoff-source.v1', ...request,
    evidenceSourceSnapshotSha256: '1'.repeat(64), verificationInputsSha256: '2'.repeat(64),
    shots: [{
      frameId: 'frame-1', frameNo: 1, sceneId: 'scene-1', title: '镜头一',
      frameContentSha256: '3'.repeat(64), stackSnapshotSha256: '4'.repeat(64),
      selectedTake: {
        assetId: 'asset-1', assetRevision: 1, sha256: '5'.repeat(64),
        recordedOutputSha256: '5'.repeat(64), outputBindingStatus: 'verified', mimeType: 'video/mp4',
        durationSec: 5, fps: 24, width: 720, height: 1280, aspectRatio: '720:1280',
        selectionStatus: 'Selected', qualityStatus: 'passed', lineageComplete: true,
      },
      audio: { status: 'not_authoritatively_bound', asset: null },
      comments, review, qc: null, approval: null,
      blockers: ['editorial_handoff_approval_record_missing', 'editorial_handoff_qc_record_missing'],
    }],
    audioPolicy: 'only_authoritatively_bound_assets',
  }
  const unresolved = [
    { frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
    { frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
    { frameId: null, code: 'editorial_handoff_otio_dependency_unavailable' },
  ]
  const blockers = [
    { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
    { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
    { scope: 'export', frameId: null, code: 'editorial_handoff_otio_dependency_unavailable' },
  ]
  const body = {
    schema: 'jason.qingmu-editorial-handoff-draft.v1', ...request, source,
    sourceSnapshotSha256: sha(source),
    summary: { shotCount: 1, selectedTakeCount: 1, authoritativeAudioCount: 0,
      totalDurationSec: 5, unresolvedCount: 3 },
    unresolved, blockers,
    download: { available: false, format: 'otio-zip', blockerCode: 'editorial_handoff_otio_dependency_unavailable' },
    aokiVideoProductionHandoffReady: false, yimengEpisodeReleaseReady: false,
    readOnly: true, providerCalls: 0, businessMutations: 0,
  }
  return { ...body, projectionSha256: sha(body) }
}

describe('editorial handoff read adapter', () => {
  it('normalizes the server-authored order and routes one GET', async () => {
    const value = projection()
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)
    const fetch = vi.fn(async () => new Response(JSON.stringify(value), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const handler = createYimengReadHandler({ baseUrl: 'http://127.0.0.1:18815' }, {
      fetch, readToken: () => 'host-token',
    })
    const result = await handler('editorialHandoff', request, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: {
      download: { available: false }, aokiVideoProductionHandoffReady: false,
      yimengEpisodeReleaseReady: false,
    } })
    expect(fetch).toHaveBeenCalledTimes(1)
    const calls = fetch.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>
    expect(calls[0]?.[0]).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-handoff/episodes/episode-handoff/editorial-handoff',
    )
    expect(calls[0]?.[1]).toMatchObject({ method: 'GET' })
  })

  it.each(['readiness', 'path leak', 'projection hash'] as const)('fails closed on forged %s', (kind) => {
    const value = projection() as Record<string, unknown>
    if (kind === 'readiness') value.aokiVideoProductionHandoffReady = true
    if (kind === 'path leak') {
      const source = value.source as Record<string, unknown>
      const shot = (source.shots as Array<Record<string, unknown>>)[0]
      if (shot === undefined) throw new Error('fixture shot is required')
      shot.comments = { localPath: '/Users/a1234/private.mp4' }
    }
    if (kind === 'projection hash') value.projectionSha256 = 'f'.repeat(64)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow()
  })

  it('rejects duplicate or extra blockers even with recomputed hashes', () => {
    const value = projection()
    value.unresolved.push({ frameId: null, code: 'forged_blocker' })
    value.blockers.push({ scope: 'export', frameId: null, code: 'forged_blocker' })
    value.summary.unresolvedCount += 1
    value.projectionSha256 = sha(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'projectionSha256'),
    ))
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'blockers do not match the authoritative shots',
    )
  })

  it('rejects a forged shot blocker even when both hashes and root lists are self-consistent', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot === undefined) throw new Error('fixture shot is required')
    shot.blockers.push('forged_shot_blocker')
    shot.blockers.sort()
    value.unresolved.splice(2, 0, { frameId: 'frame-1', code: 'forged_shot_blocker' })
    value.blockers.splice(2, 0, { scope: 'shot', frameId: 'frame-1', code: 'forged_shot_blocker' })
    value.summary.unresolvedCount += 1
    value.sourceSnapshotSha256 = sha(value.source)
    value.projectionSha256 = sha(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'projectionSha256'),
    ))
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'shot blockers do not match normalized source facts',
    )
  })

  it('rejects incomplete lineage without its canonical blocker after self-consistent rehash', () => {
    const value = projection()
    const selected = value.source.shots[0]?.selectedTake
    if (selected === null || selected === undefined) throw new Error('fixture selected Take is required')
    selected.lineageComplete = false
    value.sourceSnapshotSha256 = sha(value.source)
    value.projectionSha256 = sha(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'projectionSha256'),
    ))
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'shot blockers do not match normalized source facts',
    )
  })

  it('maps a source-drift response to a stable recoverable Host error', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      detail: { code: 'editorial_handoff_source_drift' },
    }), { status: 409, headers: { 'content-type': 'application/json' } }))
    const handler = createYimengReadHandler({ baseUrl: 'http://127.0.0.1:18815' }, {
      fetch, readToken: () => 'host-token',
    })
    await expect(handler('editorialHandoff', request, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'SOURCE_DRIFT', details: {} },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
