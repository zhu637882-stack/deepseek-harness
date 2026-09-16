/** Whole-state relay ledger; recording an intent neither flushes storage nor permits an external effect. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  QueueReferenceVideoRequest, ReferenceVideoParameters, ReferenceVideoRun,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { DirectorObjectScope } from './types.ts'

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/u)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const timestamp = z.iso.datetime({ offset: true })
const positiveInteger = z.number().int().positive()
const decimalCny = z.string().regex(/^\d+(?:\.\d{1,6})?$/u).refine(value => /[1-9]/u.test(value), 'Amount must be positive')
const scopeSchema = z.strictObject({ projectId: id, episodeId: id, sceneId: id, shotId: id }) satisfies z.ZodType<DirectorObjectScope>
// These are the read adapter's parseReferenceVideoRequest controls, not Provider defaults.
const parametersSchema = z.strictObject({
  duration: z.number().int().min(2).max(30),
  resolution: z.enum(['480P', '720P', '1080P']),
  ratio: z.enum(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']),
  audio: z.boolean(), prompt_extend: z.boolean(), seed: z.number().int().min(-1).max(2147483647).exactOptional(),
}) satisfies z.ZodType<ReferenceVideoParameters>
const shotSchema = z.strictObject({ scope: scopeSchema, label: z.string().max(256), parameters: parametersSchema, retake: z.boolean() })

/** Explicit batch scope and payment limits; readiness evidence never supplies authorization. */
export const relayStartSchema = z.strictObject({
  batchId: id, projectId: id, episodeId: id, instruction: z.string().min(1).max(16000),
  director: z.strictObject({ provider: z.string().min(1), model: z.string().min(1) }),
  observer: z.strictObject({ provider: z.string().min(1), model: z.string().min(1) }).exactOptional(),
  shots: z.array(shotSchema).min(1).max(100),
  authorization: z.strictObject({
    authorizationId: id, paidConfirmed: z.literal(true), maxCostCny: decimalCny,
    maxCandidates: positiveInteger.max(100), expiresAt: timestamp,
  }),
}).superRefine((value, ctx) => {
  const shots = new Set<string>()
  for (const [index, shot] of value.shots.entries()) {
    if (shot.scope.projectId !== value.projectId || shot.scope.episodeId !== value.episodeId) {
      ctx.addIssue({ code: 'custom', path: ['shots', index, 'scope'], message: 'Shot project and episode must match the batch' })
    }
    if (shots.has(shot.scope.shotId)) {
      ctx.addIssue({ code: 'custom', path: ['shots', index, 'scope', 'shotId'], message: 'Duplicate shot ID' })
    }
    shots.add(shot.scope.shotId)
  }
  if (value.shots.length > value.authorization.maxCandidates) {
    ctx.addIssue({ code: 'custom', path: ['authorization', 'maxCandidates'], message: 'Candidate limit is smaller than the shot count' })
  }
})

/** Validated external batch input, without generated identities or implicit payment consent. */
export type RelayStart = z.infer<typeof relayStartSchema>

const textBlock = z.strictObject({ type: z.literal('text'), text: z.string() })
const messageSchema: z.ZodType<UserMessage> = z.strictObject({
  id: id.transform(value => MessageId(value)), role: z.literal('user'),
  source: z.strictObject({ kind: z.literal('user') }), content: z.tuple([textBlock, textBlock]),
})
const markerSchema = z.strictObject({
  schema: z.literal('qingmu.native-director-request.v1'), sessionId: z.string().min(1), ownerId: z.string().min(1),
  scope: scopeSchema, contextSnapshotSha256: sha256,
})
const submissionSchema: z.ZodType<QueueReferenceVideoRequest> = z.strictObject({
  projectId: id, frameId: id, requestId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u), expectedRevision: positiveInteger,
  expectedRequestSha256: sha256, quoteSha256: sha256, authorizationCapCny: decimalCny, paidConfirmed: z.literal(true),
})
const runStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'quarantined']) satisfies z.ZodType<ReferenceVideoRun['publicStatus']>
const itemSchema = z.strictObject({
  ...shotSchema.shape,
  phase: z.enum(['pending', 'preparing', 'prepared', 'submitting', 'queued', 'running', 'succeeded', 'failed', 'unknown', 'collected', 'blocked', 'abandoned']),
  admissions: z.array(z.strictObject({ message: messageSchema, contextSnapshotSha256: sha256, admittedAt: timestamp })),
  handoff: z.strictObject({
    messageId: id, turn: z.number().int().nonnegative(), endSeq: z.number().int().nonnegative(), revision: positiveInteger,
    requestSha256: sha256, frameSha256: sha256, directorSourceSha256: sha256, contextSnapshotSha256: sha256,
  }).nullable(),
  materialRequests: z.array(z.strictObject({ assetId: id, requestId: id })),
  submission: submissionSchema.nullable(),
  run: z.strictObject({ runId: id, taskId: id, publicStatus: runStatus }).nullable(),
  preparedAt: timestamp.nullable(), submittedAt: timestamp.nullable(), settledAt: timestamp.nullable(), collectedAt: timestamp.nullable(),
  reason: z.string().nullable(),
}).superRefine((item, ctx) => {
  const fail = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  for (const admission of item.admissions) {
    const block = admission.message.content[0]
    let marker: unknown
    try { marker = JSON.parse(block?.type === 'text' ? block.text : '') }
    catch { fail('Invalid admission marker JSON'); return }
    const parsed = markerSchema.safeParse(marker)
    // Session identity is checked by the controller that owns the admission, not by this ledger.
    if (!parsed.success || !isDeepStrictEqual(parsed.data.scope, item.scope)
      || parsed.data.contextSnapshotSha256 !== admission.contextSnapshotSha256) fail('Admission marker does not match the item')
  }
  const admission = item.admissions.at(-1)
  if (item.phase === 'preparing' && !admission) fail('Preparing requires admission')
  const needsHandoff = ['prepared', 'submitting', 'unknown', 'queued', 'running', 'succeeded', 'failed', 'collected'].includes(item.phase)
  const needsSubmission = ['submitting', 'unknown', 'queued', 'running', 'succeeded', 'failed', 'collected'].includes(item.phase)
  const needsRun = ['queued', 'running', 'succeeded', 'failed', 'collected'].includes(item.phase)
  if (needsHandoff && !item.handoff) fail('Phase requires handoff evidence')
  if (needsSubmission && !item.submission) fail('Phase requires submission evidence')
  if (needsRun && !item.run) fail('Phase requires run evidence')
  // Same-turn plan/dialogue edits may advance context after admission; the message identity stays fixed.
  if (item.handoff && (!admission || item.handoff.messageId !== admission.message.id)) fail('Handoff must match the latest admission')
  if (item.submission && (!item.handoff || !matchesHandoff(item, item.submission))) fail('Submission must match item scope and handoff revision/request SHA')
  if (item.run && (!item.submission || item.run.runId !== `refvideo_${item.submission.requestId}`)) fail('Run must match the exact submission request ID')
  if (item.phase === 'collected' && item.run?.publicStatus !== 'succeeded') fail('Collected requires a succeeded run')
  if (item.phase === 'abandoned' && (item.submission || item.run)) fail('Abandoned work cannot have a submission or run')
})

/** One ordered shot and its durable preparation, submission and run evidence; blocked may retain partial evidence. */
export type RelayItem = z.infer<typeof itemSchema>

const stateSchema = z.strictObject({
  version: z.literal(1), revision: positiveInteger, start: relayStartSchema,
  mode: z.enum(['running', 'paused', 'completed', 'closed']), reason: z.string().nullable(),
  createdAt: timestamp, updatedAt: timestamp, items: z.array(itemSchema),
}).superRefine((state, ctx) => {
  if (state.items.length !== state.start.shots.length) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Items must match the ordered start shots' })
  }
  const requestIds = new Set<string>()
  const admissionIds = new Set<string>()
  let cost = 0n
  let count = 0
  let active = 0
  for (const [index, item] of state.items.entries()) {
    const shot = { scope: item.scope, label: item.label, parameters: item.parameters, retake: item.retake }
    if (!isDeepStrictEqual(shot, state.start.shots[index])) {
      ctx.addIssue({ code: 'custom', path: ['items', index], message: 'Item must match its ordered start shot' })
    }
    if (state.mode === 'completed' && !isSettled(item)) {
      ctx.addIssue({ code: 'custom', path: ['items', index], message: 'Completed relay requires every item to have authoritative terminal evidence' })
    }
    if (state.mode === 'closed' && !isSettled(item) && item.phase !== 'abandoned') {
      ctx.addIssue({ code: 'custom', path: ['items', index], message: 'Closed relay requires settled or abandoned items' })
    }
    for (const admission of item.admissions) {
      if (admissionIds.has(admission.message.id)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'admissions'], message: 'Duplicate admission message ID' })
      }
      admissionIds.add(admission.message.id)
    }
    if (item.submission) {
      if (requestIds.has(item.submission.requestId)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'submission'], message: 'Duplicate submission request ID' })
      }
      requestIds.add(item.submission.requestId)
      cost += microCny(item.submission.authorizationCapCny)
      count++
      if (!isSettled(item)) active++
    }
  }
  if (cost > microCny(state.start.authorization.maxCostCny)) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Relay cost budget exceeded' })
  }
  if (count > state.start.authorization.maxCandidates) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Relay candidate limit exceeded' })
  }
  if (active > 1) ctx.addIssue({ code: 'custom', path: ['items'], message: 'More than one relay submission is active' })
})

/** Latest full ledger snapshot. Revisions count session ledger events, including completed-batch replacement. */
export type RelayState = z.infer<typeof stateSchema>

/** Whether the batch still reserves the director session for Host relay work.
 * @param state Full ledger snapshot to classify.
 * @returns false only for the terminal `completed` and `closed` modes, which return the session to browser ownership.
 */
export function relayBatchIsOpen(state: RelayState): boolean {
  return state.mode !== 'completed' && state.mode !== 'closed'
}

function isSettled(item: RelayItem): boolean {
  return (item.phase === 'collected' && item.run?.publicStatus === 'succeeded')
    || (item.phase === 'failed' && item.run?.publicStatus === 'failed')
}

function matchesHandoff(item: RelayItem, command: QueueReferenceVideoRequest): boolean {
  return command.projectId === item.scope.projectId && command.frameId === item.scope.shotId
    && command.expectedRevision === item.handoff?.revision && command.expectedRequestSha256 === item.handoff.requestSha256
}

function requireUnexpired(start: RelayStart, now: string): void {
  timestamp.parse(now)
  if (Date.parse(now) >= Date.parse(start.authorization.expiresAt)) throw new Error('Relay authorization expired')
}

function microCny(value: string): bigint {
  const decimal = value.indexOf('.')
  return decimal < 0 ? BigInt(value) * 1_000_000n
    : BigInt(value.slice(0, decimal)) * 1_000_000n + BigInt(value.slice(decimal + 1).padEnd(6, '0'))
}

/** Validate explicit input and unexpired authorization, without appending or performing effects.
 * @param input Untrusted batch input.
 * @param now ISO timestamp used for creation and expiry validation.
 * @returns Detached running revision-one state with pending shots and no evidence.
 */
export function createRelayState(input: unknown, now: string): RelayState {
  const start = relayStartSchema.parse(input)
  requireUnexpired(start, now)
  return stateSchema.parse({
    version: 1, revision: 1, start, mode: 'running', reason: null, createdAt: now, updatedAt: now,
    items: start.shots.map(shot => ({
      ...shot, phase: 'pending', admissions: [], handoff: null, materialRequests: [], submission: null, run: null,
      preparedAt: null, submittedAt: null, settledAt: null, collectedAt: null, reason: null,
    })),
  })
}

/** Parse the newest ledger event; malformed data fails rather than revealing an older snapshot.
 * @param session Durable session event stream.
 * @returns Validated detached state, or null when no relay event exists.
 */
export function readRelayState(session: Pick<Session, 'events'>): RelayState | null {
  const event = session.events.findLast(event => event.type === 'qingmu-director-relay/state')
  return event ? stateSchema.parse(event.data) : null
}

/** Append one required whole-state event under an optimistic revision check; never flush or authorize effects.
 * Persisted evidence is immutable; new submissions require an unexpired reservation against the previous prepared state.
 * @param session Session that owns the ledger.
 * @param next Complete successor snapshot; batch input and creation time stay fixed, and terminal outcomes cannot regress.
 * @param expectedRevision Observed ledger revision, or zero before its first event.
 * @returns Validated snapshot accepted by the session. Before effects, the caller must require sessions.flush to return true.
 */
export function appendRelayState(session: Session, next: RelayState, expectedRevision: number): RelayState {
  const current = readRelayState(session)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (current?.revision ?? 0) !== expectedRevision) {
    throw new Error('Stale relay revision')
  }
  const parsed = stateSchema.parse(next)
  if (parsed.revision !== expectedRevision + 1) throw new Error('Relay revision must advance by one')
  if (current) {
    if (current.start.batchId === parsed.start.batchId) {
      if (!isDeepStrictEqual(current.start, parsed.start)) throw new Error('Relay start is immutable within a batch')
      if (current.createdAt !== parsed.createdAt) throw new Error('Relay createdAt is immutable within a batch')
      if (current.mode === 'completed' && parsed.mode !== 'completed') throw new Error('Completed relay batch cannot reopen')
      if (current.mode === 'closed' && parsed.mode !== 'closed') throw new Error('Closed relay batch cannot reopen')
      let reservation = current
      for (const [index, item] of current.items.entries()) {
        const successor = parsed.items[index] as RelayItem
        if (item.admissions.some((admission, offset) => !isDeepStrictEqual(admission, successor.admissions[offset]))) {
          throw new Error('Persisted relay admissions are immutable')
        }
        if (successor.admissions.length > item.admissions.length) {
          if (successor.admissions.length !== item.admissions.length + 1
            || parsed.mode !== 'running' || successor.phase !== 'preparing'
            || (item.admissions.length > 0 ? current.mode !== 'paused' : current.mode !== 'running' && current.mode !== 'paused')
            || item.handoff || successor.handoff || item.submission || successor.submission) {
            throw new Error('Relay admission retry requires explicit resume before handoff or submission')
          }
          requireUnexpired(parsed.start, parsed.updatedAt)
        }
        if (item.handoff && !isDeepStrictEqual(item.handoff, successor.handoff)) {
          throw new Error('Persisted relay handoff is immutable')
        }
        if (item.submission && !isDeepStrictEqual(item.submission, successor.submission)) {
          throw new Error('Persisted relay submission command is immutable')
        }
        if (item.run) {
          if (!successor.run || item.run.runId !== successor.run.runId || item.run.taskId !== successor.run.taskId) {
            throw new Error('Persisted relay run identity is immutable')
          }
          if ((item.run.publicStatus === 'succeeded' || item.run.publicStatus === 'failed')
            && item.run.publicStatus !== successor.run.publicStatus) throw new Error('Terminal relay run status is immutable')
        }
        if ((isSettled(item) || item.phase === 'abandoned') && item.phase !== successor.phase) throw new Error('Terminal relay item cannot regress')
        if (item.materialRequests.some((request, offset) => !isDeepStrictEqual(request, successor.materialRequests[offset]))) {
          throw new Error('Persisted relay material requests are immutable')
        }
        if (!item.submission && successor.submission) {
          reservation = reserveRelaySubmission(reservation, index, successor.submission, parsed.updatedAt)
        }
      }
    } else if (current.mode !== 'completed' && current.mode !== 'closed') throw new Error('Another relay batch cannot replace an unfinished batch')
  }
  if (current?.start.batchId !== parsed.start.batchId && parsed.items.some(item => item.submission)) {
    throw new Error('Relay submission requires a previously prepared item in the same batch')
  }
  return session.append('qingmu-director-relay/state', parsed).data
}

/** Reserve one exact submission intent; failed attempts still consume their full caps, and unknown runs stay active.
 * @param state Current full ledger snapshot; never mutated.
 * @param index Ordered shot index, already prepared by its admitted director request.
 * @param command Exact confirmed queue command; this function never generates request IDs or retries.
 * @param now ISO timestamp for expiry validation and the new intent.
 * @returns Detached revision-plus-one state, or the unchanged validated state for an identical persisted command.
 */
export function reserveRelaySubmission(state: RelayState, index: number, command: QueueReferenceVideoRequest, now: string): RelayState {
  const parsed = stateSchema.parse(state)
  if (parsed.mode !== 'running') throw new Error('Relay must be running to reserve a submission')
  requireUnexpired(parsed.start, now)
  if (!Number.isSafeInteger(index) || index < 0 || index >= parsed.items.length) throw new Error('Invalid relay item index')
  const item = parsed.items[index] as RelayItem
  const intent = submissionSchema.parse(command)
  if (item.submission) {
    if (!isDeepStrictEqual(item.submission, intent)) throw new Error('Persisted relay submission command is immutable')
    return parsed
  }
  if (item.phase !== 'prepared') throw new Error('Relay item must be prepared before submission')
  if (!matchesHandoff(item, intent)) throw new Error('Submission must match item scope and handoff revision/request SHA')
  let cost = 0n
  let count = 0
  for (const other of parsed.items) {
    if (!other.submission) continue
    if (other.submission.requestId === intent.requestId) throw new Error('Submission request ID is already reserved')
    if (!isSettled(other)) throw new Error('Another relay submission is active')
    cost += microCny(other.submission.authorizationCapCny)
    count++
  }
  if (count + 1 > parsed.start.authorization.maxCandidates) throw new Error('Relay candidate limit exceeded')
  if (cost + microCny(intent.authorizationCapCny) > microCny(parsed.start.authorization.maxCostCny)) throw new Error('Relay cost budget exceeded')
  return stateSchema.parse({
    ...parsed, revision: parsed.revision + 1, updatedAt: now,
    items: parsed.items.map((other, offset) => offset === index
      ? { ...other, phase: 'submitting', submission: intent, submittedAt: now }
      : other),
  })
}
