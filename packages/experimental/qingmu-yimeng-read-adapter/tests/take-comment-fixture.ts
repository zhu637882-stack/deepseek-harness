import { createHash } from 'node:crypto'

export interface TakeCommentScope {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}

export type TakeCommentAnchor =
  | { readonly kind: 'timecode'; readonly timecodeMillis: number }
  | { readonly kind: 'frame'; readonly frameNumber: number }

export interface TakeCommentSubject extends TakeCommentScope {
  readonly schema: 'jason.qingmu-take-comment-subject.v1'
  readonly frameNo: number
  readonly storyboardRevision: number
  readonly frameContentSha256: string
  readonly takeId: string
  readonly versionOrdinal: number
  readonly outputSha256: string
  readonly durationMillis: number
}

export interface TakeCommentRequest extends TakeCommentScope {
  readonly expectedTakeSubjectSha256: string
  readonly takeId: string
  readonly anchor: TakeCommentAnchor
  readonly body: string
  readonly idempotencyKey: string
}

export interface TakeComment {
  readonly id: string
  readonly takeId: string
  readonly versionOrdinalAtComment: number
  readonly outputSha256: string
  readonly frameBinding: {
    readonly frameId: string
    readonly frameNo: number
    readonly storyboardRevision: number
    readonly frameContentSha256: string
  }
  readonly takeSubjectSha256: string
  readonly anchor: TakeCommentAnchor
  readonly body: string
  readonly actorId: string
  readonly actorRole: 'commenter'
  readonly authSessionId: string
  readonly createdAt: string
  readonly eventId: string
}

export interface TakeCommentFeed {
  readonly schema: 'jason.qingmu-take-comment-feed.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly versions: readonly {
    readonly takeSubject: TakeCommentSubject
    readonly takeSubjectSha256: string
  }[]
  readonly capabilities: { readonly canComment: boolean }
  readonly comments: readonly (TakeComment & { readonly currentBinding: boolean })[]
}

export interface TakeCommentResult {
  readonly schema: 'jason.qingmu-take-comment-result.v1'
  readonly comment: TakeComment
  readonly changed: false
  readonly selectionChanged: false
  readonly technicalPassChanged: false
  readonly formalApprovalChanged: false
  readonly episodeVerificationChanged: false
  readonly humanSignoffInferred: false
  readonly providerCalls: 0
  readonly budgetMutation: false
}

export interface TakeCommentRecovery extends TakeCommentScope {
  readonly schema: 'jason.qingmu-take-comment-recovery.v1'
  readonly takeId: string
  readonly expectedTakeSubjectSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: TakeCommentResult | null
}

export const TAKE_COMMENT_SCOPE: TakeCommentScope = {
  projectId: 'project-take',
  episodeId: 'episode-take',
  frameId: 'frame-take',
}

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

export function takeCommentSha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

export function takeCommentSubject(
  scope: TakeCommentScope = TAKE_COMMENT_SCOPE,
  takeId = 'asset-take-1',
): TakeCommentSubject {
  return {
    schema: 'jason.qingmu-take-comment-subject.v1',
    ...scope,
    frameNo: 7,
    storyboardRevision: 3,
    frameContentSha256: '1'.repeat(64),
    takeId,
    versionOrdinal: takeId === 'asset-take-1' ? 1 : 2,
    outputSha256: takeId === 'asset-take-1' ? '2'.repeat(64) : '4'.repeat(64),
    durationMillis: takeId === 'asset-take-1' ? 5_250 : 5_500,
  }
}

export function takeCommentRequest(
  anchor: TakeCommentAnchor = { kind: 'timecode', timecodeMillis: 1_250 },
  takeId = 'asset-take-1',
  scope: TakeCommentScope = TAKE_COMMENT_SCOPE,
): TakeCommentRequest {
  return {
    ...scope,
    expectedTakeSubjectSha256: takeCommentSha(takeCommentSubject(scope, takeId)),
    takeId,
    anchor,
    body: '眼神应在这一拍落到左侧角色。',
    idempotencyKey: 'take-comment-command-0001',
  }
}

export function takeCommentRecord(
  input: TakeCommentRequest = takeCommentRequest(),
  overrides: Partial<TakeComment> = {},
): TakeComment {
  const subject = takeCommentSubject(input, input.takeId)
  return {
    id: 'take-comment-0001',
    takeId: input.takeId,
    versionOrdinalAtComment: subject.versionOrdinal,
    outputSha256: subject.outputSha256,
    frameBinding: {
      frameId: input.frameId,
      frameNo: subject.frameNo,
      storyboardRevision: subject.storyboardRevision,
      frameContentSha256: subject.frameContentSha256,
    },
    takeSubjectSha256: input.expectedTakeSubjectSha256,
    anchor: input.anchor,
    body: input.body,
    actorId: 'reviewer-user-1',
    actorRole: 'commenter',
    authSessionId: '8'.repeat(64),
    createdAt: '2026-08-28T10:03:00.123456+00:00',
    eventId: 'take-comment-event-0001',
    ...overrides,
  }
}

export function takeCommentFeed(scope: TakeCommentScope = TAKE_COMMENT_SCOPE): TakeCommentFeed {
  const first = takeCommentSubject(scope, 'asset-take-1')
  const second = takeCommentSubject(scope, 'asset-take-2')
  const currentInput = takeCommentRequest({ kind: 'timecode', timecodeMillis: 1_250 }, first.takeId, scope)
  const historicalInput = {
    ...takeCommentRequest({ kind: 'frame', frameNumber: 36 }, second.takeId, scope),
    expectedTakeSubjectSha256: '9'.repeat(64),
  }
  return {
    schema: 'jason.qingmu-take-comment-feed.v1',
    ...scope,
    versions: [
      { takeSubject: first, takeSubjectSha256: takeCommentSha(first) },
      { takeSubject: second, takeSubjectSha256: takeCommentSha(second) },
    ],
    capabilities: { canComment: true },
    comments: [
      { ...takeCommentRecord(currentInput), currentBinding: true },
      {
        ...takeCommentRecord(historicalInput, {
          id: 'take-comment-historical',
          versionOrdinalAtComment: 1,
          outputSha256: '3'.repeat(64),
          body: '上一版第 36 帧构图需要调整。',
          createdAt: '2026-08-28T09:03:00.123456+00:00',
          eventId: 'take-comment-event-historical',
        }),
        currentBinding: false,
      },
    ],
  }
}

export function takeCommentResult(input: TakeCommentRequest = takeCommentRequest()): TakeCommentResult {
  return {
    schema: 'jason.qingmu-take-comment-result.v1',
    comment: takeCommentRecord(input),
    changed: false,
    selectionChanged: false,
    technicalPassChanged: false,
    formalApprovalChanged: false,
    episodeVerificationChanged: false,
    humanSignoffInferred: false,
    providerCalls: 0,
    budgetMutation: false,
  }
}

export function takeCommentRecovery(
  input: TakeCommentRequest = takeCommentRequest(),
  committed = true,
): TakeCommentRecovery {
  return {
    schema: 'jason.qingmu-take-comment-recovery.v1',
    projectId: input.projectId,
    episodeId: input.episodeId,
    frameId: input.frameId,
    takeId: input.takeId,
    expectedTakeSubjectSha256: input.expectedTakeSubjectSha256,
    idempotencyKey: input.idempotencyKey,
    status: committed ? 'committed' : 'not_found',
    result: committed ? takeCommentResult(input) : null,
  }
}
