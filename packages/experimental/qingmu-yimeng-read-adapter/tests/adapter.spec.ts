import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  apply,
  createYimengReadHandler,
  normalizeReferenceRightsRecord,
  type YimengReadAdapterDependencies,
  type YimengWorkflowProjection,
} from '../src/index.ts'

const signal = () => new AbortController().signal

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
  Response.json(value, init)

const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const SCRIPT_FIXTURE = {
  durationScale: 0.000001,
  retained: { nested: true },
  scenes: [{ title: '雨夜' }],
}
const SCRIPT_CANONICAL_JSON = '{"durationScale":1e-06,"retained":{"nested":true},"scenes":[{"title":"雨夜"}]}'
const SCRIPT_SHA256 = '7891c24af9ab8e848d8d053acaddd6f516623cfb5ee73b21d781bd3925a09d68'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

const PROMPT_IR_SUBJECT = {
  schema: 'jason.qingmu-prompt-ir-subject.v1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  targetType: 'prompt_ir',
  targetId: 'storyboard-1:frame-1',
  storyboardRevisionId: 'storyboard-1',
  frameId: 'frame-1',
  promptIrId: 'prompt-ir-1',
  promptIrVersion: 4,
  promptIrContentSha256: 'a'.repeat(64),
  status: 'Ready',
  editableProjection: {
    imageGenPrompt: '雨夜码头首帧',
    lastFrameImagePrompt: '人物离开画面',
    videoGenPrompt: '人物沿码头前行',
    motionPrompt: '缓慢跟拍',
    negativePrompt: '无额外人物',
  },
} as const
const PROMPT_IR_SNAPSHOT_SHA256 = createHash('sha256')
  .update(canonicalJson(PROMPT_IR_SUBJECT), 'utf8')
  .digest('hex')

const REFERENCE_CANDIDATE = {
  assetId: 'asset-prop-1',
  sha256: 'a'.repeat(64),
  materializedSha256: 'a'.repeat(64),
  bindingValid: true,
  projectId: 'project-1',
  sourceEpisodeId: 'episode-1',
  ownerType: 'prop',
  ownerId: 'prop-1',
  role: 'prop_reference',
  localPath: 'storage/props/prop-1.png',
  qualityStatus: 'passed',
  selectionStatus: 'Unselected',
  isSelected: false,
  generationJobId: 'job-1',
  sourceRevisionId: 'revision-1',
  formalConsistencyCheckId: 'check-1',
  formalConsistencyPassed: true,
  qualityProjectionSha256: 'b'.repeat(64),
  decisionKind: 'none',
  decisionIdentity: '',
} as const

const REFERENCE_CANDIDATES_FIXTURE = {
  schema: 'jason.qingmu-reference-asset-candidates.v1',
  projectId: 'project-1',
  targetType: 'element_profile',
  targetId: 'prop-1',
  elementKind: 'prop',
  profileRevision: 4,
  elementSnapshotSha256: 'c'.repeat(64),
  candidates: [REFERENCE_CANDIDATE],
  humanApprovalInferred: false,
} as const

const REVIEW_SUBJECT_SHA = 'd'.repeat(64)
const REVIEW_COMMENT = {
  id: 'comment-1',
  subjectType: 'element_profile',
  subjectId: 'prop-1',
  subjectRevision: 4,
  subjectSha256: REVIEW_SUBJECT_SHA,
  body: '保留表盘刻度，材质反光需要降低。',
  actorId: 'reviewer-1',
  actorRole: 'commenter',
  authSessionId: 'auth-session-comment-1',
  createdAt: '2026-08-27T08:00:00Z',
} as const
const REVIEW_DECISION = {
  id: 'decision-1',
  subjectType: 'element_profile',
  subjectId: 'prop-1',
  subjectRevision: 4,
  subjectSha256: REVIEW_SUBJECT_SHA,
  decision: 'approve',
  reason: '造型、刻度与剧情设定一致。',
  actorId: 'approver-1',
  actorRole: 'approver',
  authSessionId: 'auth-session-decision-1',
  decidedAt: '2026-08-27T08:01:00Z',
} as const
const REVIEW_FEED_FIXTURE = {
  schema: 'jason.qingmu-element-review-feed.v1',
  projectId: 'project-1',
  elementKind: 'prop',
  targetId: 'prop-1',
  subject: {
    type: 'element_profile',
    id: 'prop-1',
    revision: 4,
    sha256: REVIEW_SUBJECT_SHA,
  },
  capabilities: { canComment: true, canDecide: false },
  comments: [REVIEW_COMMENT],
  decisions: [REVIEW_DECISION],
  currentDecision: REVIEW_DECISION,
} as const

const RIGHTS_EXCEPTION_SCOPE = {
  kind: 'reference_rights',
  referenceAssetId: 'asset-prop-1',
  referenceAssetSha256: 'a'.repeat(64),
  rightsRecordSha256: 'b'.repeat(64),
  rightsFields: ['sourceType', 'rightsHolder'],
} as const
const RIGHTS_EXCEPTION_RELEASE = {
  id: 'rights-exception-release-1',
  decision: 'exception_release',
  subjectType: 'element_profile',
  subjectId: 'prop-1',
  subjectRevision: 4,
  subjectSha256: REVIEW_SUBJECT_SHA,
  scope: RIGHTS_EXCEPTION_SCOPE,
  actorId: 'approver-1',
  actorRole: 'approver',
  actorNaturalPersonId: 'person-approver-1',
  producerActorId: 'producer-1',
  producerNaturalPersonId: 'person-producer-1',
  assetProducerActorId: 'asset-producer-1',
  assetProducerNaturalPersonId: 'person-asset-producer-1',
  assetProducerTaskId: 'task-1',
  assetProducerTaskRequestSha256: 'c'.repeat(64),
  authSessionId: 'auth-session-release-1',
  reason: '权利人已书面确认当前参考资产的本次用途。',
  releasedAt: '2026-08-27T08:02:00Z',
  stale: false,
  staleReasonCodes: [],
} as const
const STALE_RIGHTS_EXCEPTION_RELEASE = {
  ...RIGHTS_EXCEPTION_RELEASE,
  id: 'rights-exception-release-0',
  subjectRevision: 3,
  subjectSha256: 'e'.repeat(64),
  stale: true,
  staleReasonCodes: ['subject_revision_changed'],
} as const
const RIGHTS_EXCEPTION_FEED_FIXTURE = {
  schema: 'jason.qingmu-reference-rights-exception-release-feed.v1',
  projectId: 'project-1',
  elementKind: 'prop',
  targetId: 'prop-1',
  subject: {
    type: 'element_profile',
    id: 'prop-1',
    revision: 4,
    sha256: REVIEW_SUBJECT_SHA,
  },
  capabilities: {
    canRelease: true,
    blockedReasonCode: null,
    blockedReason: null,
    requiresRecentAuthentication: true,
  },
  releases: [STALE_RIGHTS_EXCEPTION_RELEASE, RIGHTS_EXCEPTION_RELEASE],
  currentReleases: [RIGHTS_EXCEPTION_RELEASE],
} as const

type ElementKind = 'actor' | 'scene' | 'prop'

function unknownRightsRecord(): Record<string, unknown> {
  const scalar = { state: 'unknown', value: null }
  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: scalar,
    rightsHolder: scalar,
    authorizationScope: { state: 'unknown', values: [] },
    territory: { state: 'unknown', values: [] },
    term: { state: 'unknown', startsAt: null, endsAt: null, perpetual: null },
    restrictions: { state: 'unknown', values: [] },
    contains: {
      realPersonLikeness: 'unknown',
      trademark: 'unknown',
      music: 'unknown',
      font: 'unknown',
      thirdPartyCharacter: 'unknown',
    },
    providerTerms: { state: 'unknown', terms: null, reviewedAt: null },
    modelLicenses: { code: scalar, weights: scalar, outputUse: scalar },
    humanDeclaration: { state: 'unknown', text: null },
    contentCredentials: scalar,
  }
}

function elementSubjectFixture(elementKind: ElementKind): Record<string, unknown> {
  const common = {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: 'project-1',
    targetType: 'element_profile',
    elementKind,
    profileRevision: 4,
    name: elementKind === 'actor' ? '林默' : elementKind === 'scene' ? '雨夜码头' : '青铜罗盘',
    officialReferenceImageUrl: null,
    references: [{
      assetId: `asset-${elementKind}-1`,
      sha256: 'd'.repeat(64),
      selectionStatus: 'Unselected',
      isSelected: false,
      rightsRecorded: false,
      rights: unknownRightsRecord(),
      ...(elementKind === 'prop' ? {} : { role: elementKind === 'actor' ? 'primary' : 'environment' }),
    }],
  }
  if (elementKind === 'actor') {
    return { ...common, actorId: 'actor-1', visualIdentity: '清瘦青年，左眉尾有浅疤' }
  }
  if (elementKind === 'scene') {
    return { ...common, sceneId: 'scene-1', sceneType: 'exterior', visualPrompt: '雨夜码头，冷色逆光' }
  }
  return { ...common, propId: 'prop-1', visualPrompt: '旧铜表面，刻度清晰' }
}

function dependencies(fetch: typeof globalThis.fetch, token?: string): YimengReadAdapterDependencies {
  return { fetch, readToken: () => token }
}

function workflowFixture(schema = 'jason.episode-workflow-projection.v1'): Record<string, unknown> {
  return {
    schema,
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceRevision: { script: 2, retained: { source: 'test' } },
    inputFingerprint: 'fingerprint',
    activeTaskId: null,
    status: 'ready',
    hasData: true,
    isStale: false,
    qualityPassed: true,
    selected: true,
    canProceed: true,
    stages: {
      assets: {
        status: 'ready',
        hasData: true,
        isStale: false,
        qualityPassed: true,
        selected: true,
        canProceed: true,
        retained: { nested: true },
      },
    },
    stageHandoff: {},
    assets: { items: [], retained: { nested: true } },
    director: {},
    shots: {},
    video: {},
    audio: {},
    timeline: {},
    budget: { valid: true, retained: { nested: true } },
    release: { releaseReady: true },
    blockers: [],
    legacy: {},
    retainedTopLevel: { nested: true },
  }
}

describe('qingmu Yimeng read adapter', () => {
  it('registers one loopback-only Host Connection channel', () => {
    const handle = vi.fn((
      _channel: string,
      _handler: ConnectionRpcHandler,
      _options: ConnectionRpcHandlerOptions,
    ) => async () => {})
    const ctx = { connection: { rpc: { handle } } } as unknown as Context

    apply(ctx)

    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0]?.[0]).toBe('/qingmu-yimeng')
    expect(handle.mock.calls[0]?.[2]).toEqual({ authority: 'loopback' })
  })

  it('rejects protected reads without a token before fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const handler = createYimengReadHandler({}, dependencies(fetch))

    for (const [endpoint, payload] of [
      ['projects', {}],
      ['episodes', { projectId: 'project-1' }],
      ['script', { projectId: 'project-1', episodeId: 'episode-1' }],
      ['promptIr', {
        projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'storyboard-1', frameId: 'frame-1',
      }],
      ['workflow', { projectId: 'project-1', episodeId: 'episode-1' }],
      ['elementProfile', { projectId: 'project-1', elementKind: 'prop', targetId: 'prop-1' }],
      ['referenceCandidates', { projectId: 'project-1', elementKind: 'prop', targetId: 'prop-1' }],
      ['reviewEvents', { projectId: 'project-1', elementKind: 'prop', targetId: 'prop-1' }],
      ['referenceRightsExceptionReleases', {
        projectId: 'project-1', elementKind: 'prop', targetId: 'prop-1',
      }],
    ] as const) {
      const result = await handler(endpoint, payload, signal())
      expect(result).toEqual({
        ok: false,
        error: { code: 'internal', message: 'YIMENG_API_TOKEN is not configured', details: {} },
      })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the exact current Ready PromptIR and verifies its canonical subject hash', async () => {
    let capturedUrl = ''
    const handler = createYimengReadHandler({}, dependencies(async (input) => {
      capturedUrl = requestUrl(input)
      return jsonResponse({
        schema: 'jason.qingmu-prompt-ir-subject-read.v1',
        subject: PROMPT_IR_SUBJECT,
        baseRevision: 4,
        baseSnapshotSha256: PROMPT_IR_SNAPSHOT_SHA256,
      })
    }, 'test-token'))

    const result = await handler('promptIr', {
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboardRevisionId: 'storyboard-1',
      frameId: 'frame-1',
    }, signal())

    expect(result).toEqual({
      ok: true,
      value: {
        schema: 'jason.qingmu-prompt-ir-subject-read.v1',
        subject: PROMPT_IR_SUBJECT,
        baseRevision: 4,
        baseSnapshotSha256: PROMPT_IR_SNAPSHOT_SHA256,
      },
    })
    expect(capturedUrl).toBe(
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/storyboard-1/frames/frame-1/prompt-ir',
    )
  })

  it('fails PromptIR reads closed on target, status, revision, or snapshot drift', async () => {
    for (const value of [
      { subject: { ...PROMPT_IR_SUBJECT, frameId: 'frame-2' }, baseRevision: 4, baseSnapshotSha256: PROMPT_IR_SNAPSHOT_SHA256 },
      { subject: { ...PROMPT_IR_SUBJECT, status: 'Draft' }, baseRevision: 4, baseSnapshotSha256: PROMPT_IR_SNAPSHOT_SHA256 },
      { subject: PROMPT_IR_SUBJECT, baseRevision: 3, baseSnapshotSha256: PROMPT_IR_SNAPSHOT_SHA256 },
      { subject: PROMPT_IR_SUBJECT, baseRevision: 4, baseSnapshotSha256: 'b'.repeat(64) },
    ]) {
      const handler = createYimengReadHandler({}, dependencies(
        async () => jsonResponse({ schema: 'jason.qingmu-prompt-ir-subject-read.v1', ...value }),
        'test-token',
      ))
      const result = await handler('promptIr', {
        projectId: 'project-1',
        episodeId: 'episode-1',
        storyboardRevisionId: 'storyboard-1',
        frameId: 'frame-1',
      }, signal())
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
  })

  it('reads a version-bound review feed with independent comment and decision capabilities', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const handler = createYimengReadHandler({}, dependencies(async (input, init) => {
      capturedUrl = requestUrl(input)
      capturedInit = init
      return jsonResponse(REVIEW_FEED_FIXTURE)
    }, 'test-token'))

    const result = await handler('reviewEvents', {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
    }, signal())

    expect(result).toEqual({
      ok: true,
      value: {
        ...REVIEW_FEED_FIXTURE,
        decisions: [{ ...REVIEW_DECISION, stale: false }],
        currentDecision: { ...REVIEW_DECISION, stale: false },
      },
    })
    expect(capturedUrl).toBe(
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/review-events',
    )
    const headers = new Headers(capturedInit?.headers)
    expect(capturedInit?.method).toBe('GET')
    expect(capturedInit?.cache).toBe('no-store')
    expect(headers.get('authorization')).toBe('Bearer test-token')
    expect(headers.has('cookie')).toBe(false)
  })

  it('fails review feeds closed on subject drift or a stale current decision', async () => {
    for (const value of [
      { ...REVIEW_FEED_FIXTURE, subject: { ...REVIEW_FEED_FIXTURE.subject, id: 'prop-2' } },
      {
        ...REVIEW_FEED_FIXTURE,
        currentDecision: { ...REVIEW_DECISION, subjectRevision: 3, subjectSha256: 'e'.repeat(64) },
      },
      {
        ...REVIEW_FEED_FIXTURE,
        comments: [{ ...REVIEW_COMMENT, subjectId: 'prop-2' }],
      },
      {
        ...REVIEW_FEED_FIXTURE,
        comments: [{ ...REVIEW_COMMENT, actorRole: 'approver' }],
      },
      {
        ...REVIEW_FEED_FIXTURE,
        decisions: [{ ...REVIEW_DECISION, actorRole: 'commenter' }],
        currentDecision: { ...REVIEW_DECISION, actorRole: 'commenter' },
      },
    ]) {
      const handler = createYimengReadHandler({}, dependencies(async () => jsonResponse(value), 'test-token'))
      const result = await handler('reviewEvents', {
        projectId: 'project-1',
        elementKind: 'prop',
        targetId: 'prop-1',
      }, signal())
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
  })

  it('reads the independent exception-release feed with current and stale history', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const handler = createYimengReadHandler({}, dependencies(async (input, init) => {
      capturedUrl = requestUrl(input)
      capturedInit = init
      return jsonResponse(RIGHTS_EXCEPTION_FEED_FIXTURE)
    }, 'test-token'))

    const result = await handler('referenceRightsExceptionReleases', {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
    }, signal())

    expect(result).toEqual({ ok: true, value: RIGHTS_EXCEPTION_FEED_FIXTURE })
    expect(capturedUrl).toBe(
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases',
    )
    const headers = new Headers(capturedInit?.headers)
    expect(capturedInit?.method).toBe('GET')
    expect(capturedInit?.cache).toBe('no-store')
    expect(headers.get('authorization')).toBe('Bearer test-token')
    expect(headers.has('cookie')).toBe(false)
  })

  it('fails exception-release feeds closed on forged authority, scope, or current projection', async () => {
    const invalid = [
      { ...RIGHTS_EXCEPTION_FEED_FIXTURE, extraAuthority: true },
      {
        ...RIGHTS_EXCEPTION_FEED_FIXTURE,
        capabilities: { ...RIGHTS_EXCEPTION_FEED_FIXTURE.capabilities, requiresRecentAuthentication: false },
      },
      {
        ...RIGHTS_EXCEPTION_FEED_FIXTURE,
        releases: [{
          ...RIGHTS_EXCEPTION_RELEASE,
          actorNaturalPersonId: RIGHTS_EXCEPTION_RELEASE.producerNaturalPersonId,
        }],
        currentReleases: [],
      },
      {
        ...RIGHTS_EXCEPTION_FEED_FIXTURE,
        releases: [{
          ...RIGHTS_EXCEPTION_RELEASE,
          scope: { ...RIGHTS_EXCEPTION_SCOPE, rightsFields: ['rightsHolder', 'sourceType'] },
        }],
        currentReleases: [],
      },
      {
        ...RIGHTS_EXCEPTION_FEED_FIXTURE,
        currentReleases: [{ ...RIGHTS_EXCEPTION_RELEASE, stale: true, staleReasonCodes: ['rights_record_changed'] }],
      },
      {
        ...RIGHTS_EXCEPTION_FEED_FIXTURE,
        currentReleases: [],
      },
      {
        ...RIGHTS_EXCEPTION_FEED_FIXTURE,
        capabilities: {
          canRelease: false,
          blockedReasonCode: null,
          blockedReason: null,
          requiresRecentAuthentication: true,
        },
      },
    ]
    for (const response of invalid) {
      const handler = createYimengReadHandler({}, dependencies(
        async () => jsonResponse(response),
        'test-token',
      ))
      const result = await handler('referenceRightsExceptionReleases', {
        projectId: 'project-1',
        elementKind: 'prop',
        targetId: 'prop-1',
      }, signal())
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
  })

  it('reads exact reference candidates with Host-only credentials and no-store fetches', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const readToken = ['test', 'token'].join('-')
    const handler = createYimengReadHandler({}, dependencies(async (input, init) => {
      capturedUrl = requestUrl(input)
      capturedInit = init
      return jsonResponse({
        ...REFERENCE_CANDIDATES_FIXTURE,
        ignoredTopLevel: true,
        candidates: [{ ...REFERENCE_CANDIDATE, ignoredCandidateField: true }],
      })
    }, readToken))

    const result = await handler('referenceCandidates', {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
    }, signal())

    expect(result).toEqual({ ok: true, value: REFERENCE_CANDIDATES_FIXTURE })
    expect(capturedUrl).toBe(
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/reference-candidates',
    )
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${readToken}`)
    expect(headers.has('cookie')).toBe(false)
    expect(capturedInit?.method).toBe('GET')
    expect(capturedInit?.cache).toBe('no-store')
    expect(capturedInit?.redirect).toBe('error')
  })

  it('fails reference-candidate reads closed on invalid fields and forged request bindings', async () => {
    const invalidResponses: Array<{ expected: string; value: Record<string, unknown> }> = [
      {
        expected: 'referenceCandidates.schema mismatch',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, schema: 'jason.qingmu-reference-asset-candidates.v0' },
      },
      {
        expected: 'referenceCandidates project or element subject mismatch',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, projectId: 'project-2' },
      },
      {
        expected: 'referenceCandidates project or element subject mismatch',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, targetId: 'prop-2' },
      },
      {
        expected: 'referenceCandidates.elementSnapshotSha256 must be a lowercase SHA-256',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, elementSnapshotSha256: 'not-a-sha' },
      },
      {
        expected: 'referenceCandidates.humanApprovalInferred must be false',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, humanApprovalInferred: true },
      },
      {
        expected: 'referenceCandidates.candidates[0] project or element subject mismatch',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, projectId: 'project-2' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0] project or element subject mismatch',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, ownerType: 'actor' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0] project or element subject mismatch',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, ownerId: 'prop-2' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].selectionStatus must be Unselected, Selected, Rejected, or Stale',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, selectionStatus: 'Archived' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].qualityStatus must be pending, passed, or failed',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, qualityStatus: 'ready' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].decisionKind must be none, referenceSelection, or humanReview',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, decisionKind: 'approval' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].sha256 must be a lowercase SHA-256',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, sha256: 'A'.repeat(64) }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].materializedSha256 must be empty or a lowercase SHA-256',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, materializedSha256: 'broken' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].qualityProjectionSha256 must be a lowercase SHA-256',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, qualityProjectionSha256: '' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].assetId must be between 1 and 256 characters',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, assetId: '' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].sourceEpisodeId must be a string',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, sourceEpisodeId: 3 }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].bindingValid must be a boolean',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, bindingValid: 1 }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].isSelected must be a boolean',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, isSelected: 'false' }] },
      },
      {
        expected: 'referenceCandidates.candidates[0].formalConsistencyPassed must be a boolean',
        value: { ...REFERENCE_CANDIDATES_FIXTURE, candidates: [{ ...REFERENCE_CANDIDATE, formalConsistencyPassed: null }] },
      },
    ]

    for (const invalid of invalidResponses) {
      const handler = createYimengReadHandler({}, dependencies(
        async () => jsonResponse(invalid.value),
        'test-token',
      ))
      const result = await handler('referenceCandidates', {
        projectId: 'project-1',
        elementKind: 'prop',
        targetId: 'prop-1',
      }, signal())

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'internal',
          message: `Yimeng response contract failed: ${invalid.expected}`,
          details: {},
        },
      })
    }
  })

  it('verifies canonical actor, scene, and prop element-profile evidence and keeps canonical bytes Host-only', async () => {
    for (const elementKind of ['actor', 'scene', 'prop'] as const) {
      const subject = elementSubjectFixture(elementKind)
      const targetId = `${elementKind}-1`
      const canonicalSnapshot = JSON.stringify(subject)
      const snapshotSha256 = createHash('sha256').update(canonicalSnapshot, 'utf8').digest('hex')
      let capturedUrl = ''
      const handler = createYimengReadHandler({}, dependencies(async (input) => {
        capturedUrl = requestUrl(input)
        return jsonResponse({
          schema: 'jason.qingmu-element-profile-subject-read.v2',
          subject,
          canonicalSnapshot,
          snapshotSha256,
        })
      }, 'test-token'))

      const result = await handler('elementProfile', {
        projectId: 'project-1',
        elementKind,
        targetId,
      }, signal())

      expect(result).toEqual({
        ok: true,
        value: {
          schema: 'jason.qingmu-element-profile-subject-read.v2',
          subject,
          snapshotSha256,
        },
      })
      expect(capturedUrl).toBe(`http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/${elementKind}/${targetId}`)
      expect(JSON.stringify(result)).not.toContain('canonicalSnapshot')
    }
  })

  it('fails element-profile reads closed on invalid kind, forged IDs or fields, and forged canonical evidence', async () => {
    const subject = elementSubjectFixture('prop')
    const canonicalSnapshot = JSON.stringify(subject)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({
      schema: 'jason.qingmu-element-profile-subject-read.v2',
      subject,
      canonicalSnapshot,
      snapshotSha256: 'f'.repeat(64),
    }))
    const readToken = vi.fn(() => 'test-token')
    const handler = createYimengReadHandler({}, { fetch, readToken })

    const unsupported = await handler('elementProfile', {
      projectId: 'project-1',
      elementKind: 'character',
      targetId: 'character-1',
    }, signal())
    expect(unsupported).toEqual({
      ok: false,
      error: { code: 'bad-request', message: 'elementKind must be actor, scene, or prop', details: { issues: [] } },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()

    const forged = await handler('elementProfile', {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
    }, signal())
    expect(forged).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: elementProfile canonical snapshot sha256 mismatch',
        details: {},
      },
    })

    const forgedCases = [
      {
        requestKind: 'actor' as const,
        subject: { ...elementSubjectFixture('actor'), actorId: 'actor-2' },
        expectedMessage: 'elementProfile subject mismatch',
      },
      {
        requestKind: 'actor' as const,
        subject: elementSubjectFixture('scene'),
        expectedMessage: 'elementProfile subject mismatch',
      },
      {
        requestKind: 'actor' as const,
        subject: (() => {
          const actor = elementSubjectFixture('actor')
          const { actorId: _actorId, visualIdentity: _visualIdentity, ...common } = actor
          return { ...common, propId: 'actor-1', visualPrompt: '冒充人物字段' }
        })(),
        expectedMessage: 'elementProfile.subject fields mismatch',
      },
    ]
    for (const item of forgedCases) {
      const itemCanonical = JSON.stringify(item.subject)
      const itemHandler = createYimengReadHandler({}, dependencies(async () => jsonResponse({
        schema: 'jason.qingmu-element-profile-subject-read.v2',
        subject: item.subject,
        canonicalSnapshot: itemCanonical,
        snapshotSha256: createHash('sha256').update(itemCanonical, 'utf8').digest('hex'),
      }), 'test-token'))
      const result = await itemHandler('elementProfile', {
        projectId: 'project-1',
        elementKind: item.requestKind,
        targetId: 'actor-1',
      }, signal())
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'internal',
          message: `Yimeng response contract failed: ${item.expectedMessage}`,
          details: {},
        },
      })
    }
  })

  it('normalizes the complete rights record and rejects non-canonical or unknown fields', () => {
    const rights = unknownRightsRecord()
    const normalized = normalizeReferenceRightsRecord({
      ...rights,
      sourceType: { state: 'known', value: '  commissioned  ' },
      rightsHolder: { state: 'known', value: '  青木工作室  ' },
      authorizationScope: { state: 'known', values: ['短剧', '宣传'] },
      territory: { state: 'known', values: ['中国大陆'] },
      term: {
        state: 'known',
        startsAt: '2026-08-27T00:00:00.1Z',
        endsAt: '2027-08-27T00:00:00Z',
        perpetual: false,
      },
      restrictions: { state: 'known', values: [] },
      providerTerms: {
        state: 'known',
        terms: '  仅限当前项目  ',
        reviewedAt: '2026-08-27T01:02:03.12Z',
      },
      humanDeclaration: { state: 'provided', text: '  已核对授权文件  ' },
    })

    expect(normalized).toMatchObject({
      sourceType: { state: 'known', value: 'commissioned' },
      rightsHolder: { state: 'known', value: '青木工作室' },
      term: {
        state: 'known',
        startsAt: '2026-08-27T00:00:00.100000Z',
        endsAt: '2027-08-27T00:00:00Z',
        perpetual: false,
      },
      providerTerms: {
        state: 'known',
        terms: '仅限当前项目',
        reviewedAt: '2026-08-27T01:02:03.120000Z',
      },
      humanDeclaration: { state: 'provided', text: '已核对授权文件' },
    })
    expect(() => normalizeReferenceRightsRecord({ ...rights, unexpected: true })).toThrow('rights fields mismatch')
    expect(() => normalizeReferenceRightsRecord({
      ...rights,
      territory: { state: 'known', values: ['中国大陆', '中国大陆'] },
    })).toThrow('rights.territory.values are invalid')
    expect(() => normalizeReferenceRightsRecord({
      ...rights,
      providerTerms: { state: 'known', terms: '条款', reviewedAt: '2026-02-30T00:00:00Z' },
    })).toThrow('rights.providerTerms.reviewedAt must be a valid UTC Z timestamp')
  })

  it('fails old v1 and unknown v2 subject/reference fields closed with matching canonical evidence', async () => {
    const base = elementSubjectFixture('prop')
    const reference = (base.references as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    const cases = [
      { ...base, schema: 'jason.qingmu-element-profile-subject.v1' },
      { ...base, unexpected: true },
      { ...base, references: [{ ...reference, unexpected: true }] },
      { ...base, references: [{ ...reference, rights: { ...(reference.rights as object), unexpected: true } }] },
    ]
    for (const subject of cases) {
      const canonicalSnapshot = JSON.stringify(subject)
      const handler = createYimengReadHandler({}, dependencies(async () => jsonResponse({
        schema: 'jason.qingmu-element-profile-subject-read.v2',
        subject,
        canonicalSnapshot,
        snapshotSha256: createHash('sha256').update(canonicalSnapshot, 'utf8').digest('hex'),
      }), 'test-token'))
      const result = await handler('elementProfile', {
        projectId: 'project-1',
        elementKind: 'prop',
        targetId: 'prop-1',
      }, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('strict v2 subject should fail closed')
      expect(result.error.message).toContain('Yimeng response contract failed')
    }
  })

  it('rejects invalid input before token resolution or fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const readToken = vi.fn(() => 'test-token')
    const handler = createYimengReadHandler({}, { fetch, readToken })

    const result = await handler('projects', { page: 0, page_size: 20 }, signal())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('invalid input should fail')
    expect(result.error.code).toBe('bad-request')
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()
  })

  it('uses Bearer authentication without Cookie and normalizes project pagination', async () => {
    let capturedHeaders: Headers | undefined
    let capturedUrl = ''
    const fetch: typeof globalThis.fetch = async (input, init) => {
      capturedUrl = requestUrl(input)
      capturedHeaders = new Headers(init?.headers)
      return jsonResponse({ items: [{ id: 'project-1', retained: true }], total: 1, page: 2, page_size: 10, pages: 1 })
    }
    const handler = createYimengReadHandler({}, dependencies(fetch, 'test-token'))

    const result = await handler('projects', { page: 2, pageSize: 10, search: '  forest  ' }, signal())

    expect(result).toEqual({
      ok: true,
      value: {
        items: [{ id: 'project-1', retained: true }],
        pagination: { total: 1, page: 2, pageSize: 10, pages: 1 },
      },
    })
    expect(capturedUrl).toBe('http://127.0.0.1:8115/api/projects?page=2&page_size=10&search=forest')
    expect(capturedHeaders?.get('authorization')).toBe('Bearer test-token')
    expect(capturedHeaders?.has('cookie')).toBe(false)
  })

  it('maps authentication and network failures without exposing upstream details', async () => {
    const unauthorized = createYimengReadHandler({}, dependencies(
      async () => new Response('upstream secret', { status: 401 }),
      'test-token',
    ))
    const unavailable = createYimengReadHandler({}, dependencies(
      async () => { throw new Error('network secret') },
      'test-token',
    ))

    const unauthorizedResult = await unauthorized('projects', {}, signal())
    const unavailableResult = await unavailable('projects', {}, signal())

    expect(unauthorizedResult).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng authentication failed', details: {} },
    })
    expect(unavailableResult).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng service is unavailable', details: {} },
    })
    expect(JSON.stringify([unauthorizedResult, unavailableResult])).not.toContain('secret')
  })

  it('fails closed when the workflow schema does not match', async () => {
    const handler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse(workflowFixture('jason.episode-workflow-projection.v0')),
      'test-token',
    ))

    const result = await handler('workflow', { projectId: 'project-1', episodeId: 'episode-1' }, signal())

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: workflow.schema mismatch',
        details: {},
      },
    })
  })

  it('fails closed on subject or canonical-evidence mismatch and accepts an exact not-found contract', async () => {
    const scriptHandler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({
        found: true,
        projectId: 'project-2',
        episodeId: 'episode-2',
        script: { scenes: [] },
        scriptCanonicalJson: '{"scenes":[]}',
        scriptSha256: '25f53890f6712f0a8798c58a1ecd2e0011c5bb7fd893a118a19969f57c80fc8d',
        revision: 3,
        editedByUser: true,
        updatedAt: '2026-08-26T00:00:00+00:00',
      }),
      'test-token',
    ))
    const workflowHandler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({ ...workflowFixture(), projectId: 'project-2', episodeId: 'episode-2' }),
      'test-token',
    ))
    const episodesHandler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({ items: [{ id: 'episode-1', project_id: 'project-2' }] }),
      'test-token',
    ))
    const forgedHashHandler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({
        found: true,
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: { scenes: [] },
        scriptCanonicalJson: '{"scenes":[]}',
        scriptSha256: 'f'.repeat(64),
        revision: 3,
        editedByUser: true,
        updatedAt: '2026-08-26T00:00:00+00:00',
      }),
      'test-token',
    ))
    const forgedContentHandler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({
        found: true,
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: { scenes: [] },
        scriptCanonicalJson: '{"scenes":[{"title":"different"}]}',
        scriptSha256: 'c8b8865de49ea2e45eafd9d4f5916505059e01879fd79ef65e34da82b8300701',
        revision: 3,
        editedByUser: true,
        updatedAt: '2026-08-26T00:00:00+00:00',
      }),
      'test-token',
    ))
    const notFoundHandler = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({
        found: false,
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: null,
        scriptCanonicalJson: null,
        scriptSha256: null,
        revision: 0,
        editedByUser: false,
        updatedAt: '2026-08-26T00:00:00+00:00',
      }),
      'test-token',
    ))

    const script = await scriptHandler('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())
    const workflow = await workflowHandler('workflow', { projectId: 'project-1', episodeId: 'episode-1' }, signal())
    const episodes = await episodesHandler('episodes', { projectId: 'project-1' }, signal())
    const forgedHash = await forgedHashHandler('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())
    const forgedContent = await forgedContentHandler('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())
    const notFound = await notFoundHandler('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())

    expect(script).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: script project or episode subject mismatch',
        details: {},
      },
    })
    expect(workflow).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: workflow project or episode subject mismatch',
        details: {},
      },
    })
    expect(episodes).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: episodes project subject mismatch',
        details: {},
      },
    })
    expect(forgedHash).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: script canonical JSON sha256 mismatch',
        details: {},
      },
    })
    expect(forgedContent).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: script canonical JSON content mismatch',
        details: {},
      },
    })
    expect(notFound).toEqual({
      ok: true,
      value: {
        found: false,
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: null,
        scriptSha256: null,
        revision: 0,
        editedByUser: false,
        updatedAt: '2026-08-26T00:00:00+00:00',
      },
    })
  })

  it('rejects canonical script evidence containing an unsafe integer after JSON parsing', async () => {
    const canonicalJson = '{"unsafeInteger":9007199254740993}'
    const responseJson = `{"found":true,"projectId":"project-1","episodeId":"episode-1","script":{"unsafeInteger":9007199254740993},"scriptCanonicalJson":${JSON.stringify(canonicalJson)},"scriptSha256":"90f60e8301e3f45108c856f2c32a232243cd480172c2912474862fc882925c88","revision":3,"editedByUser":true,"updatedAt":"2026-08-26T00:00:00+00:00"}`
    const handler = createYimengReadHandler({}, dependencies(
      async () => new Response(responseJson, { headers: { 'content-type': 'application/json' } }),
      'test-token',
    ))

    const result = await handler('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response contract failed: script.script contains a non-finite number or unsafe integer',
        details: {},
      },
    })
  })

  it('allows bounded script evidence above the ordinary response limit and still rejects above 20 MiB', async () => {
    const largeScript = { productionNote: 'x'.repeat(3 * 1024 * 1024) }
    const canonicalJson = JSON.stringify(largeScript)
    const scriptSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
    const correspondingCommandBody = JSON.stringify({
      projectId: 'project-1',
      script: largeScript,
      baseRevision: 3,
    })
    const largeResponse = JSON.stringify({
      found: true,
      projectId: 'project-1',
      episodeId: 'episode-1',
      script: largeScript,
      scriptCanonicalJson: canonicalJson,
      scriptSha256,
      revision: 3,
      editedByUser: true,
      updatedAt: '2026-08-26T00:00:00+00:00',
    })
    expect(new TextEncoder().encode(correspondingCommandBody).byteLength).toBeLessThan(5 * 1024 * 1024)
    expect(new TextEncoder().encode(largeResponse).byteLength).toBeGreaterThan(5 * 1024 * 1024)
    expect(new TextEncoder().encode(largeResponse).byteLength).toBeLessThan(20 * 1024 * 1024)
    const withinScriptLimit = createYimengReadHandler({}, dependencies(
      async () => new Response(largeResponse, { headers: { 'content-type': 'application/json' } }),
      'test-token',
    ))
    const aboveScriptLimit = createYimengReadHandler({}, dependencies(
      async () => new Response('{}', { headers: { 'content-length': String(20 * 1024 * 1024 + 1) } }),
      'test-token',
    ))

    const accepted = await withinScriptLimit('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())
    const rejected = await aboveScriptLimit('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())

    expect(accepted).toEqual({
      ok: true,
      value: {
        found: true,
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: largeScript,
        scriptSha256,
        revision: 3,
        editedByUser: true,
        updatedAt: '2026-08-26T00:00:00+00:00',
      },
    })
    expect(rejected).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng response exceeded size limit',
        details: {},
      },
    })
  })

  it('bounds response bytes and removes reflected credentials before browser exposure', async () => {
    const oversized = createYimengReadHandler({}, dependencies(
      async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } }),
      'test-token',
    ))
    const reflected = createYimengReadHandler({}, dependencies(
      async () => jsonResponse({
        items: [{
          id: 'project-1',
          authorization: 'Bearer test-token',
          nested: { access_token: 'test-token', note: 'prefix-test-token-suffix', 'test-token': 'reflected-key' },
        }],
        total: 1,
        page: 1,
        page_size: 20,
        pages: 1,
      }),
      'test-token',
    ))
    let healthHeaders: Headers | undefined
    const reflectedHealth = createYimengReadHandler({}, dependencies(
      async (_input, init) => {
        healthHeaders = new Headers(init?.headers)
        return jsonResponse({
          status: 'ok',
          build: { note: 'prefix-test-token-suffix' },
          hints: { access_token: 'test-token', authorization: 'Bearer test-token' },
        })
      },
      'test-token',
    ))

    const oversizedResult = await oversized('projects', {}, signal())
    const reflectedResult = await reflected('projects', {}, signal())
    const reflectedHealthResult = await reflectedHealth('health', {}, signal())

    expect(oversizedResult).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng response exceeded size limit', details: {} },
    })
    expect(reflectedResult).toEqual({
      ok: true,
      value: {
        items: [{ id: 'project-1', nested: { note: 'prefix-[REDACTED]-suffix' } }],
        pagination: { total: 1, page: 1, pageSize: 20, pages: 1 },
      },
    })
    expect(JSON.stringify(reflectedResult)).not.toContain('test-token')
    expect(reflectedHealthResult).toEqual({
      ok: true,
      value: {
        status: 'ok',
        liveness: true,
        runtime: {
          commit: null,
          dirty: null,
          identitySource: 'unavailable',
          matchesReleaseManifest: null,
        },
        build: { note: 'prefix-[REDACTED]-suffix' },
        hints: {},
      },
    })
    expect(JSON.stringify(reflectedHealthResult)).not.toContain('test-token')
    expect(healthHeaders?.has('authorization')).toBe(false)
  })

  it('allows only pathless loopback http(s) base URLs', () => {
    for (const baseUrl of [
      'https://example.com',
      'file:///tmp/yimeng',
      'http://127.0.0.1:8115/api',
      'http://user:password@127.0.0.1:8115',
      'http://127.0.0.1.evil.example:8115',
    ]) {
      expect(() => createYimengReadHandler({ baseUrl })).toThrow(/baseUrl/)
    }
    expect(() => createYimengReadHandler({ baseUrl: 'https://[::1]:8115' })).not.toThrow()
    expect(() => createYimengReadHandler({ baseUrl: 'http://127.12.34.56:8115' })).not.toThrow()
  })

  it('normalizes all successful reads and retains unknown workflow fields', async () => {
    const requests: Array<{ url: string; headers: Headers; redirect: RequestRedirect | undefined }> = []
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = requestUrl(input)
      requests.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect })
      if (url.endsWith('/api/health')) {
        return jsonResponse({
          status: 'ok',
          runtime: {
            commit: 'abc123',
            dirty: false,
            identitySource: 'build-manifest',
            matchesReleaseManifest: true,
          },
          build: { title: 'Yimeng' },
          hints: { note: 'liveness only' },
        })
      }
      if (url.includes('/api/projects/project-1/episodes')) {
        return jsonResponse({ items: [{ id: 'episode-1', project_id: 'project-1', retained: { nested: true } }] })
      }
      if (url.endsWith('/api/episodes/episode-1/script')) {
        return jsonResponse({
          found: true,
          projectId: 'project-1',
          episodeId: 'episode-1',
          script: SCRIPT_FIXTURE,
          scriptCanonicalJson: SCRIPT_CANONICAL_JSON,
          scriptSha256: SCRIPT_SHA256,
          revision: 3,
          editedByUser: true,
          updatedAt: '2026-08-26T00:00:00+00:00',
        })
      }
      if (url.includes('/workflow-projection')) return jsonResponse(workflowFixture())
      throw new Error(`unexpected test URL: ${url}`)
    }
    const handler = createYimengReadHandler({}, dependencies(fetch, 'test-token'))

    const health = await handler('health', {}, signal())
    const episodes = await handler('episodes', { projectId: 'project-1', seriesId: 'series-1' }, signal())
    const script = await handler('script', { projectId: 'project-1', episodeId: 'episode-1' }, signal())
    const workflow = await handler('workflow', { projectId: 'project-1', episodeId: 'episode-1' }, signal())

    expect(health).toEqual({
      ok: true,
      value: {
        status: 'ok',
        liveness: true,
        runtime: {
          commit: 'abc123',
          dirty: false,
          identitySource: 'build-manifest',
          matchesReleaseManifest: true,
        },
        build: { title: 'Yimeng' },
        hints: { note: 'liveness only' },
      },
    })
    expect(episodes).toEqual({
      ok: true,
      value: { items: [{ id: 'episode-1', project_id: 'project-1', projectId: 'project-1', retained: { nested: true } }] },
    })
    expect(script).toEqual({
      ok: true,
      value: {
        found: true,
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: SCRIPT_FIXTURE,
        scriptSha256: SCRIPT_SHA256,
        revision: 3,
        editedByUser: true,
        updatedAt: '2026-08-26T00:00:00+00:00',
      },
    })
    expect(SCRIPT_CANONICAL_JSON).toContain('1e-06')
    expect(JSON.stringify(script)).not.toContain('scriptCanonicalJson')
    expect(workflow.ok).toBe(true)
    if (!workflow.ok) throw new Error('workflow fixture should pass')
    const projection = workflow.value as YimengWorkflowProjection
    expect(projection.retainedTopLevel).toEqual({ nested: true })
    expect(projection.assets.retained).toEqual({ nested: true })
    expect(projection.budget).toEqual({ valid: true, retained: { nested: true } })
    expect(projection.interpretation).toEqual({
      providerAuthorization: 'not-exposed',
      humanSignoff: 'not-inferred',
      productionReadiness: 'not-inferred',
      statusFacts: ['budget.valid', 'release.releaseReady', 'qualityPassed'],
    })
    expect(requests[0]?.headers.has('authorization')).toBe(false)
    expect(requests.slice(1).every(({ headers }) => headers.get('authorization') === 'Bearer test-token')).toBe(true)
    expect(requests.every(({ headers }) => !headers.has('cookie'))).toBe(true)
    expect(requests.every(({ redirect }) => redirect === 'error')).toBe(true)
    expect(requests[1]?.url).toBe('http://127.0.0.1:8115/api/projects/project-1/episodes?series_id=series-1')
    expect(requests[2]?.url).toBe('http://127.0.0.1:8115/api/episodes/episode-1/script')
  })
})
