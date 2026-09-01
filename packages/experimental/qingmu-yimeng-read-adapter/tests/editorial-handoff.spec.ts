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
    scenes: [{ sceneId: 'scene-1', projectId: request.projectId, seriesId: 'series-1', name: '场景一' }],
    shots: [{
      frameId: 'frame-1', frameNo: 1, sceneId: 'scene-1', title: '镜头一',
      frameContentSha256: '3'.repeat(64), stackSnapshotSha256: '4'.repeat(64),
      selectedTake: {
        assetId: 'asset-1', assetRevision: 1, sha256: '5'.repeat(64) as string | null,
        recordedOutputSha256: '5'.repeat(64) as string | null, materializationStatus: 'available',
        outputBindingStatus: 'verified', mimeType: 'video/mp4',
        containerTypeStatus: 'verified',
        size: 1024 as number | null, packagePath: `media/${'5'.repeat(64)}.mp4` as string | null,
        durationSec: 5 as number | null, fps: 24 as number | null,
        width: 720 as number | null, height: 1280 as number | null,
        aspectRatio: '720:1280' as string | null,
        selectionStatus: 'Selected', qualityStatus: 'passed', lineageComplete: true,
      },
      audio: { status: 'unavailable', scopeStatus: 'valid', candidateCount: 0, asset: null },
      comments, review,
      qc: null as null | { schema: string; records: Array<Record<string, unknown>>; currentBinding: string },
      approval: null as null | { schema: string; records: Array<Record<string, unknown>>; currentBinding: string },
      blockers: [
        'editorial_handoff_approval_record_missing',
        'editorial_handoff_qc_record_missing',
        'editorial_handoff_selected_audio_missing',
      ],
    }],
    audioPolicy: 'only_authoritatively_bound_assets',
  }
  const unresolved = [
    { frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
    { frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
    { frameId: 'frame-1', code: 'editorial_handoff_selected_audio_missing' },
  ]
  const blockers = [
    { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
    { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
    { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_selected_audio_missing' },
  ]
  const body = {
    schema: 'jason.qingmu-editorial-handoff-draft.v1', authenticatedUserId: 'writer-user',
    ...request, source,
    sourceSnapshotSha256: sha(source),
    summary: { shotCount: 1, selectedTakeCount: 1, authoritativeAudioCount: 0,
      totalDurationSec: 5, unresolvedCount: 3 },
    unresolved, blockers,
    download: {
      available: false, format: 'otio-zip', blockerCode: 'editorial_handoff_approval_record_missing',
      packageSchema: 'jason.qingmu-editorial-otio-package.v1',
      otio: { distribution: 'OpenTimelineIO', version: '0.18.1', adapter: 'otio_json', schemaFamily: 'OTIO_CORE', schemaLabel: '0.18.1' },
      rangePolicy: 'full-selected-asset-v1', audioEditorialRatePolicy: 'episode-canonical-video-fps-v1',
    },
    aokiVideoProductionHandoffReady: false, yimengEpisodeReleaseReady: false,
    readOnly: true, providerCalls: 0, businessMutations: 0,
  }
  return { ...body, projectionSha256: sha(body) }
}

function rehash(value: ReturnType<typeof projection>): void {
  value.sourceSnapshotSha256 = sha(value.source)
  value.projectionSha256 = sha(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'projectionSha256'),
  ))
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
    expect(JSON.stringify(result)).not.toContain('authenticatedUserId')
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
    ;(value.unresolved as Array<{ frameId: string | null; code: string }>).push(
      { frameId: null, code: 'forged_blocker' },
    )
    ;(value.blockers as Array<{ scope: string; frameId: string | null; code: string }>).push(
      { scope: 'export', frameId: null, code: 'forged_blocker' },
    )
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

  it('accepts a readable unavailable selected Take and independently enforces its blockers', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot?.selectedTake === null || shot?.selectedTake === undefined) throw new Error('fixture selected Take is required')
    shot.selectedTake.sha256 = null
    shot.selectedTake.size = null
    shot.selectedTake.packagePath = null
    shot.selectedTake.materializationStatus = 'unavailable'
    shot.selectedTake.containerTypeStatus = 'unavailable'
    shot.selectedTake.outputBindingStatus = 'materialized_file_missing'
    shot.selectedTake.durationSec = null
    shot.selectedTake.fps = null
    shot.selectedTake.width = null
    shot.selectedTake.height = null
    shot.selectedTake.aspectRatio = null
    shot.selectedTake.lineageComplete = false
    shot.comments.versions = []
    shot.review.versions = []
    shot.blockers.push('editorial_handoff_selected_take_lineage_incomplete')
    shot.blockers.push('editorial_handoff_selected_media_metadata_missing')
    shot.blockers.push('editorial_handoff_selected_media_missing')
    shot.blockers.sort()
    value.unresolved = shot.blockers.map(code => ({ frameId: shot.frameId, code }))
    value.blockers = shot.blockers.map(code => ({ scope: 'shot' as const, frameId: shot.frameId, code }))
    value.summary.totalDurationSec = 0
    value.summary.unresolvedCount += 3
    rehash(value)
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)

    shot.blockers = shot.blockers.filter(code => code !== 'editorial_handoff_selected_media_missing')
    value.unresolved = value.unresolved.filter(entry => entry.code !== 'editorial_handoff_selected_media_missing')
    value.blockers = value.blockers.filter(entry => entry.code !== 'editorial_handoff_selected_media_missing')
    value.summary.unresolvedCount -= 1
    rehash(value)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'shot blockers do not match normalized source facts',
    )
  })

  it('accepts a canonical container mismatch only with its exact blocker', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot?.selectedTake === null || shot?.selectedTake === undefined) {
      throw new Error('fixture selected Take is required')
    }
    shot.selectedTake.containerTypeStatus = 'mismatch'
    shot.blockers.push('editorial_handoff_selected_media_type_mismatch')
    shot.blockers.sort()
    value.unresolved = shot.blockers.map(code => ({ frameId: shot.frameId, code }))
    value.blockers = shot.blockers.map(code => ({
      scope: 'shot' as const, frameId: shot.frameId, code,
    }))
    value.summary.unresolvedCount += 1
    rehash(value)
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)

    shot.blockers = shot.blockers.filter(code => code !== 'editorial_handoff_selected_media_type_mismatch')
    value.unresolved = value.unresolved.filter(entry => entry.code !== 'editorial_handoff_selected_media_type_mismatch')
    value.blockers = value.blockers.filter(entry => entry.code !== 'editorial_handoff_selected_media_type_mismatch')
    value.summary.unresolvedCount -= 1
    rehash(value)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'shot blockers do not match normalized source facts',
    )
  })

  it('accepts Writer metadata-only incompleteness without requiring a canonical Take subject', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot?.selectedTake === null || shot?.selectedTake === undefined) throw new Error('fixture selected Take is required')
    shot.selectedTake.durationSec = null
    shot.comments.versions = []
    shot.review.versions = []
    shot.blockers.push('editorial_handoff_selected_media_metadata_missing')
    shot.blockers.sort()
    value.unresolved = shot.blockers.map(code => ({ frameId: shot.frameId, code }))
    value.blockers = shot.blockers.map(code => ({ scope: 'shot' as const, frameId: shot.frameId, code }))
    value.summary.totalDurationSec = 0
    value.summary.unresolvedCount += 1
    rehash(value)
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)
  })

  it('accepts Writer media plus recorded-SHA absence as a blocked projection', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot?.selectedTake === null || shot?.selectedTake === undefined) throw new Error('fixture selected Take is required')
    shot.selectedTake.sha256 = null
    shot.selectedTake.recordedOutputSha256 = null
    shot.selectedTake.size = null
    shot.selectedTake.packagePath = null
    shot.selectedTake.materializationStatus = 'unavailable'
    shot.selectedTake.containerTypeStatus = 'unavailable'
    shot.selectedTake.outputBindingStatus = 'recorded_sha_missing'
    shot.selectedTake.lineageComplete = false
    shot.comments.versions = []
    shot.review.versions = []
    shot.blockers.push(
      'editorial_handoff_selected_media_missing',
      'editorial_handoff_selected_media_metadata_missing',
      'editorial_handoff_selected_media_sha_missing',
      'editorial_handoff_selected_take_lineage_incomplete',
    )
    shot.blockers.sort()
    value.unresolved = [
      ...shot.blockers.map(code => ({ frameId: shot.frameId, code })),
    ]
    value.blockers = [
      ...shot.blockers.map(code => ({ scope: 'shot' as const, frameId: shot.frameId, code })),
    ]
    value.summary.unresolvedCount = value.unresolved.length
    rehash(value)
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)
  })

  it('rejects a self-consistently rehashed non-video media type', () => {
    const value = projection()
    const selected = value.source.shots[0]?.selectedTake
    if (selected === null || selected === undefined) throw new Error('fixture selected Take is required')
    selected.mimeType = 'image/png'
    rehash(value)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'source.shots[].selectedTake binding is invalid',
    )
  })

  it('rejects dangling or cross-project scenes and non-audio dialogue media', () => {
    const dangling = projection()
    dangling.source.shots[0]!.sceneId = 'scene-missing'
    rehash(dangling)
    expect(() => normalizeEditorialHandoff(dangling, request, entry => sha(entry))).toThrow(
      'shot scene binding is invalid',
    )

    const cross = projection()
    Reflect.set(cross.source.scenes[0]!, 'projectId', 'project-other')
    rehash(cross)
    expect(() => normalizeEditorialHandoff(cross, request, entry => sha(entry))).toThrow(
      'scene scope is invalid',
    )

    const audio = projection()
    const shot = audio.source.shots[0]!
    Reflect.set(shot, 'audio', {
      status: 'unavailable', scopeStatus: 'valid', candidateCount: 1,
      asset: {
        assetId: 'audio-1', sha256: '6'.repeat(64), recordedSha256: '6'.repeat(64), size: 14,
        mimeType: 'video/webm', containerTypeStatus: 'verified', durationSec: 5,
        packagePath: `media/${'6'.repeat(64)}.webm`, role: 'b6_dialogue_audio',
        selectionStatus: 'Selected', qualityStatus: 'passed', materializationStatus: 'available',
        qualityEvidenceValid: true, lineageComplete: true, formalizationComplete: true,
        sourceComplete: true, source: {
          taskId: 'task-audio', provider: 'fixture', model: 'fixture-voice',
          providerTaskId: 'provider-audio', routeKey: 'sound.dialogue_tts',
          inputHash: '7'.repeat(64), ownershipIntentSha256: '8'.repeat(64),
        },
      },
    })
    rehash(audio)
    expect(() => normalizeEditorialHandoff(audio, request, entry => sha(entry))).toThrow(
      'source.shots[].audio.asset binding is invalid',
    )
  })

  it.each([0, -1, 1.5])('rejects non-positive-integer asset revision %s after self-consistent rehash', (revision) => {
    const value = projection()
    const selected = value.source.shots[0]?.selectedTake
    if (selected === null || selected === undefined) throw new Error('fixture selected Take is required')
    selected.assetRevision = revision
    rehash(value)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'source.shots[].selectedTake.assetRevision is invalid',
    )
  })

  it('rejects an unknown quality status with self-consistent hashes', () => {
    const value = projection()
    const selected = value.source.shots[0]?.selectedTake
    if (selected === null || selected === undefined) throw new Error('fixture selected Take is required')
    selected.qualityStatus = 'ready'
    rehash(value)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'source.shots[].selectedTake binding is invalid',
    )
  })

  it('does not treat a passed asset quality flag as deep QC or lifecycle approval', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot?.selectedTake === null || shot?.selectedTake === undefined) throw new Error('fixture selected Take is required')
    expect(shot.selectedTake.qualityStatus).toBe('passed')
    expect(shot.qc).toBeNull()
    expect(shot.approval).toBeNull()
    expect(shot.blockers).toEqual([
      'editorial_handoff_approval_record_missing',
      'editorial_handoff_qc_record_missing',
      'editorial_handoff_selected_audio_missing',
    ])
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)
  })

  it('keeps a cross-scope selected audio binding readable but export-blocked', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot === undefined) throw new Error('fixture shot is required')
    shot.audio.scopeStatus = 'cross_scope'
    shot.audio.candidateCount = 1
    shot.blockers = shot.blockers.map(code => code === 'editorial_handoff_selected_audio_missing'
      ? 'editorial_handoff_selected_audio_scope_invalid' : code).sort()
    value.unresolved = shot.blockers.map(code => ({ frameId: shot.frameId, code }))
    value.blockers = shot.blockers.map(code => ({ scope: 'shot' as const, frameId: shot.frameId, code }))
    ;(value.download as { blockerCode: string | null }).blockerCode = shot.blockers[0] ?? null
    rehash(value)
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)

    shot.audio.scopeStatus = 'valid'
    rehash(value)
    expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow(
      'audio candidate count is invalid',
    )
  })

  it('accepts a tampered audio projection whose archive path remains bound to the recorded SHA', () => {
    const value = projection()
    const shot = value.source.shots[0]
    if (shot === undefined) throw new Error('fixture shot is required')
    Reflect.set(shot, 'audio', {
      status: 'unavailable', scopeStatus: 'valid', candidateCount: 1,
      asset: {
        assetId: 'audio-1', sha256: '6'.repeat(64), recordedSha256: '5'.repeat(64), size: 14,
        mimeType: 'audio/wav', containerTypeStatus: 'verified', durationSec: 5,
        packagePath: `media/${'5'.repeat(64)}.wav`,
        role: 'b6_dialogue_audio', selectionStatus: 'Selected', qualityStatus: 'passed',
        materializationStatus: 'available', qualityEvidenceValid: true, lineageComplete: true,
        formalizationComplete: true, sourceComplete: true,
        source: {
          taskId: 'task-audio', provider: 'fixture', model: 'fixture-voice',
          providerTaskId: 'provider-audio', routeKey: 'sound.dialogue_tts',
          inputHash: '7'.repeat(64), ownershipIntentSha256: '8'.repeat(64),
        },
      },
    })
    shot.blockers = shot.blockers.map(code => code === 'editorial_handoff_selected_audio_missing'
      ? 'editorial_handoff_selected_audio_media_drift' : code).sort()
    value.unresolved = shot.blockers.map(code => ({ frameId: shot.frameId, code }))
    value.blockers = shot.blockers.map(code => ({ scope: 'shot' as const, frameId: shot.frameId, code }))
    ;(value.download as { blockerCode: string | null }).blockerCode = shot.blockers[0] ?? null
    rehash(value)
    expect(normalizeEditorialHandoff(value, request, entry => sha(entry))).toEqual(value)
  })

  it('rejects a forged total duration and shallow QC/lifecycle records after rehash', () => {
    const duration = projection()
    duration.summary.totalDurationSec = 99
    rehash(duration)
    expect(() => normalizeEditorialHandoff(duration, request, entry => sha(entry))).toThrow('summary mismatch')

    for (const kind of ['qc', 'approval'] as const) {
      const value = projection()
      const shot = value.source.shots[0]
      if (shot === undefined) throw new Error('fixture shot is required')
      if (kind === 'qc') {
        shot.qc = { schema: 'jason.qingmu-take-qc-records.v1', records: [{}], currentBinding: 'unknown_without_probe' }
        shot.blockers = ['editorial_handoff_approval_record_missing', 'editorial_handoff_qc_binding_unverified']
      } else {
        shot.approval = { schema: 'jason.qingmu-take-approval-lifecycle-records.v1', records: [{}], currentBinding: 'unknown_without_probe' }
        shot.blockers = ['editorial_handoff_approval_binding_unverified', 'editorial_handoff_qc_record_missing']
      }
      value.unresolved = [
        ...shot.blockers.map(code => ({ frameId: shot.frameId, code })),
      ]
      value.blockers = [
        ...shot.blockers.map(code => ({ scope: 'shot' as const, frameId: shot.frameId, code })),
      ]
      rehash(value)
      expect(() => normalizeEditorialHandoff(value, request, entry => sha(entry))).toThrow()
    }
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
