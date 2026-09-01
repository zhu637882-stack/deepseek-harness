/** Session-backed Qingmu project context and deterministic IMAGO director replay. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { ImagoDirectorReplayMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengWorkflowProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { SessionId, type Session, type SessionStore } from '@deepseek-ai/dsh-session'
import { foldProjectContext } from './fold.ts'
import type {
  QingmuDirectorDifference,
  QingmuDirectorProposal,
  QingmuDirectorSuggestionType,
  QingmuProjectContextBinding,
  QingmuProjectContextState,
  QingmuZeroAuthority,
} from './types.ts'
import { assertProjectContextBinding, sha256 } from './validation.ts'

export { foldProjectContext } from './fold.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Private loopback handler for session-bound Qingmu context and replay suggestions. */
    qingmuProjectContext: ConnectionRpcHandler
  }
}

const CHANNEL = '/qingmu-project-context'
const SHA256 = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ZERO_AUTHORITY: QingmuZeroAuthority = {
  advisoryOnly: true,
  proposedChangeSetOnly: true,
  providerCalls: 0,
  maximumCostCny: '0',
  businessWrites: 0,
  budgetWrites: 0,
  approvalWrites: 0,
  humanSignoff: false,
  autoSave: false,
  autoApprove: false,
  submitGeneration: false,
}

class RequestError extends Error {}

class WorkflowDriftError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message)
  }
}

type UpstreamHandler = ConnectionRpcHandler

/** Injectable capabilities keep tests and embedding runtimes free of network and Provider dependencies. */
export interface QingmuProjectContextDependencies {
  readonly sessions: Pick<SessionStore, 'get' | 'flush'>
  readonly readYimeng?: UpstreamHandler | undefined
  readonly runImagoMethod?: UpstreamHandler | undefined
}

const internal = (message: string): RpcResult<never> => ({ ok: false, error: { code: 'internal', message, details: {} } })
const badRequest = (message: string): RpcResult<never> => ({
  ok: false,
  error: { code: 'bad-request', message, details: { issues: [] } },
})

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(`${field} must be an object`)
  return value as Record<string, unknown>
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new RequestError(`${field} is invalid`)
  return value
}

function sessionFor(dependencies: QingmuProjectContextDependencies, value: unknown): Session {
  const id = SessionId(requireIdentifier(value, 'sessionId'))
  const session = dependencies.sessions.get(id)
  if (session === undefined) throw new RequestError(`session "${id}" is not live`)
  return session
}

function bindingFromWorkflow(
  workflow: YimengWorkflowProjection,
  expected: { projectId: string; episodeId: string; sceneId: string; shotId: string },
): QingmuProjectContextBinding {
  if (workflow.projectId !== expected.projectId || workflow.episodeId !== expected.episodeId) {
    throw new WorkflowDriftError('workflow_subject_changed', 'Yimeng workflow subject does not match the requested project and episode')
  }
  const relations = workflow.director.shotRelations
  const scene = relations.scenes.find(item => item.sceneId === expected.sceneId)
  if (scene === undefined) throw new WorkflowDriftError('scene_missing', `scene "${expected.sceneId}" is not current`)
  const shot = relations.shots.find(item => item.shotId === expected.shotId)
  if (shot === undefined) throw new WorkflowDriftError('shot_missing', `shot "${expected.shotId}" is not current`)
  if (shot.sceneId !== scene.sceneId) {
    throw new WorkflowDriftError('shot_scene_changed', `shot "${expected.shotId}" moved outside the selected scene`)
  }
  const heroShot = workflow.director.heroFrameStoryboards.shots.find(item => item.shotId === shot.shotId)
  if (heroShot === undefined || !SHA256.test(heroShot.shotSnapshotSha256)) {
    throw new WorkflowDriftError('shot_snapshot_missing_or_invalid', `shot "${expected.shotId}" has no current snapshot identity`)
  }
  const body = {
    schema: 'qingmu.project-context-binding.v1' as const,
    projectId: expected.projectId,
    episodeId: expected.episodeId,
    sceneId: expected.sceneId,
    shotId: expected.shotId,
    revision: {
      episodeRevision: relations.storyboardRevision.episodeRevision,
      storyboardRevisionId: relations.storyboardRevision.revisionId,
      storyboardRevisionVersion: relations.storyboardRevision.revisionVersion,
      sceneProfileRevision: scene.profileRevision,
    },
    sha256: {
      storyboardSource: relations.storyboardRevision.sourceSha256,
      sceneSnapshot: scene.snapshotSha256,
      shotSnapshot: heroShot.shotSnapshotSha256,
    },
  }
  const binding = { ...body, sha256: { ...body.sha256, contextSnapshot: sha256(body) } }
  assertProjectContextBinding(binding)
  return binding
}

async function readWorkflow(
  readYimeng: UpstreamHandler | undefined,
  coordinates: { projectId: string; episodeId: string },
  signal: AbortSignal,
): Promise<RpcResult<YimengWorkflowProjection>> {
  if (readYimeng === undefined) return internal('Yimeng read capability is unavailable')
  const result = await readYimeng('workflow', { projectId: coordinates.projectId, episodeId: coordinates.episodeId }, signal)
  if (!result.ok) return result
  return { ok: true, value: result.value as YimengWorkflowProjection }
}

function driftReasons(previous: QingmuProjectContextBinding, current: QingmuProjectContextBinding): string[] {
  const checks: readonly [string, unknown, unknown][] = [
    ['episode_revision_changed', previous.revision.episodeRevision, current.revision.episodeRevision],
    ['storyboard_revision_changed', previous.revision.storyboardRevisionId, current.revision.storyboardRevisionId],
    ['storyboard_revision_version_changed', previous.revision.storyboardRevisionVersion, current.revision.storyboardRevisionVersion],
    ['scene_profile_revision_changed', previous.revision.sceneProfileRevision, current.revision.sceneProfileRevision],
    ['storyboard_source_changed', previous.sha256.storyboardSource, current.sha256.storyboardSource],
    ['scene_snapshot_changed', previous.sha256.sceneSnapshot, current.sha256.sceneSnapshot],
    ['shot_snapshot_changed', previous.sha256.shotSnapshot, current.sha256.shotSnapshot],
  ]
  return checks.filter(([, left, right]) => left !== right).map(([reason]) => reason)
}

function validateMethod(value: unknown, suggestionType: QingmuDirectorSuggestionType): ImagoDirectorReplayMethodResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('IMAGO director replay method is not an object')
  }
  const method = value as Record<string, unknown>
  const authority = method.authority !== null && typeof method.authority === 'object' && !Array.isArray(method.authority)
    ? method.authority as Record<string, unknown>
    : {}
  const suggestionTypes = method.suggestionTypes !== null && typeof method.suggestionTypes === 'object'
    && !Array.isArray(method.suggestionTypes)
    ? method.suggestionTypes as Record<string, unknown>
    : {}
  const suggestion = suggestionTypes[suggestionType] !== null && typeof suggestionTypes[suggestionType] === 'object'
    && !Array.isArray(suggestionTypes[suggestionType])
    ? suggestionTypes[suggestionType] as Record<string, unknown>
    : {}
  const limits = suggestion.limits !== null && typeof suggestion.limits === 'object' && !Array.isArray(suggestion.limits)
    ? suggestion.limits as Record<string, unknown>
    : {}
  const sourceBindings = Array.isArray(method.sourceBindings) ? method.sourceBindings : []
  const source = sourceBindings[0] !== null && typeof sourceBindings[0] === 'object' && !Array.isArray(sourceBindings[0])
    ? sourceBindings[0] as Record<string, unknown>
    : {}
  const expected = suggestionType === 'text_director_proposal'
    ? { capability: 'director.text.proposal', outputSchema: 'qingmu.director-proposal.v1' }
    : { capability: 'director.visual.finding', outputSchema: 'qingmu.visual-review-proposal.v1' }
  if (method.schema !== 'qingmu.imago-director-replay-method-package.v1'
    || method.version !== 'qingmu.director-replay.v1'
    || authority.replayOnly !== true
    || authority.providerCalls !== 0
    || authority.maximumCostCny !== '0'
    || authority.humanDecisionInferred !== false
    || authority.formalQcInferred !== false
    || authority.selectionGranted !== false
    || authority.readyGranted !== false
    || suggestion.capability !== expected.capability
    || suggestion.outputSchema !== expected.outputSchema
    || limits.advisoryOnly !== true
    || typeof method.methodPackageSha256 !== 'string'
    || !SHA256.test(method.methodPackageSha256)
    || typeof source.sha256 !== 'string'
    || !SHA256.test(source.sha256)) {
    throw new Error('IMAGO director replay method does not preserve zero-authority replay')
  }
  return value as ImagoDirectorReplayMethodResponse
}

function differencesFor(
  type: QingmuDirectorSuggestionType,
  workflow: YimengWorkflowProjection,
  binding: QingmuProjectContextBinding,
): readonly QingmuDirectorDifference[] {
  const shot = workflow.director.shotRelations.shots.find(item => item.shotId === binding.shotId)
  if (shot === undefined) throw new Error('bound Shot disappeared during proposal construction')
  if (type === 'visual_finding') {
    return [{
      field: 'visualReviewFocus',
      before: null,
      proposed: ['reference_integrity', 'scene_continuity', 'subject_staging'],
      rationale: 'Apply the replay method as an advisory review draft for the bound Shot only.',
    }]
  }
  return [{
    field: 'directorReviewFocus',
    before: {
      title: shot.title,
      durationSec: shot.durationSec,
      dialogueCueCount: shot.dialogueRhythm.cues.length,
      beatCount: shot.beats.length,
      elementCount: shot.elements.length,
    },
    proposed: ['performance_rhythm', 'shot_intent_clarity', 'reference_integrity'],
    rationale: 'Review current Shot facts against the immutable IMAGO replay method before drafting any business change.',
  }]
}

function proposalFor(
  type: QingmuDirectorSuggestionType,
  workflow: YimengWorkflowProjection,
  binding: QingmuProjectContextBinding,
  method: ImagoDirectorReplayMethodResponse,
): QingmuDirectorProposal {
  const body = {
    schema: type === 'text_director_proposal' ? 'qingmu.director-proposal.v1' as const : 'qingmu.visual-review-proposal.v1' as const,
    suggestionType: type,
    currentObject: {
      projectId: binding.projectId,
      episodeId: binding.episodeId,
      sceneId: binding.sceneId,
      shotId: binding.shotId,
    },
    basis: {
      contextSnapshotSha256: binding.sha256.contextSnapshot,
      methodPackageSha256: method.methodPackageSha256,
      methodSourceSha256: method.sourceBindings[0].sha256,
    },
    differences: differencesFor(type, workflow, binding),
    impactScope: ['bound_shot_draft_only'] as const,
    authority: ZERO_AUTHORITY,
  }
  return { ...body, proposalSha256: sha256(body) } as QingmuDirectorProposal
}

async function markStale(
  dependencies: QingmuProjectContextDependencies,
  session: Session,
  binding: QingmuProjectContextBinding,
  reasons: readonly string[],
): Promise<QingmuProjectContextState> {
  const stale: QingmuProjectContextState = { status: 'stale', binding, staleReasons: [...new Set(reasons)] }
  session.append('qingmu/project-context', { version: 1, state: stale })
  await dependencies.sessions.flush(session)
  return stale
}

/**
 * Create the private handler without registering routes.
 * Bind and stale transitions append to the existing session log and await its configured flush listeners.
 * @param dependencies - existing session store and optional read-only Yimeng and IMAGO handlers.
 * @returns a loopback RPC handler with no Provider or business-write capability.
 */
export function createQingmuProjectContextHandler(dependencies: QingmuProjectContextDependencies): ConnectionRpcHandler {
  return async (endpoint, payload, signal) => {
    try {
      const request = requireRecord(payload, 'request')
      const session = sessionFor(dependencies, request.sessionId)
      if (endpoint === 'current') {
        return { ok: true, value: { state: foldProjectContext(session.events), authority: ZERO_AUTHORITY } }
      }
      if (endpoint === 'bind') {
        const coordinates = {
          projectId: requireIdentifier(request.projectId, 'projectId'),
          episodeId: requireIdentifier(request.episodeId, 'episodeId'),
          sceneId: requireIdentifier(request.sceneId, 'sceneId'),
          shotId: requireIdentifier(request.shotId, 'shotId'),
        }
        const workflow = await readWorkflow(dependencies.readYimeng, coordinates, signal)
        if (!workflow.ok) return workflow
        let binding: QingmuProjectContextBinding
        try {
          binding = bindingFromWorkflow(workflow.value, coordinates)
        } catch (error) {
          if (error instanceof WorkflowDriftError) return badRequest(error.message)
          return internal(error instanceof Error ? error.message : 'Yimeng workflow is invalid')
        }
        const state: QingmuProjectContextState = { status: 'current', binding, staleReasons: [] }
        session.append('qingmu/project-context', { version: 1, state })
        await dependencies.sessions.flush(session)
        return { ok: true, value: { state, authority: ZERO_AUTHORITY } }
      }
      if (endpoint !== 'suggest') return badRequest(`unknown Qingmu project-context endpoint: ${endpoint}`)
      const type = request.suggestionType
      if (type !== 'text_director_proposal' && type !== 'visual_finding') {
        return badRequest('suggestionType is invalid')
      }
      const state = foldProjectContext(session.events)
      if (state === null) return { ok: true, value: { status: 'binding_required', proposal: null, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      if (state.status === 'stale') {
        return { ok: true, value: { status: 'refresh_required', proposal: null, staleReasons: state.staleReasons, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      }
      const fresh = await readWorkflow(dependencies.readYimeng, state.binding, signal)
      if (!fresh.ok) {
        if (fresh.error.code === 'cancelled') return fresh
        return { ok: true, value: { status: 'source_unavailable', proposal: null, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      }
      let freshBinding: QingmuProjectContextBinding
      try {
        freshBinding = bindingFromWorkflow(fresh.value, state.binding)
      } catch (error) {
        const reason = error instanceof WorkflowDriftError ? error.reason : 'source_projection_invalid'
        const stale = await markStale(dependencies, session, state.binding, [reason])
        return { ok: true, value: { status: 'refresh_required', proposal: null, staleReasons: stale.staleReasons, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      }
      const reasons = driftReasons(state.binding, freshBinding)
      if (reasons.length > 0) {
        const stale = await markStale(dependencies, session, state.binding, reasons)
        return { ok: true, value: { status: 'refresh_required', proposal: null, staleReasons: stale.staleReasons, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      }
      if (dependencies.runImagoMethod === undefined) {
        return { ok: true, value: { status: 'method_unavailable', proposal: null, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      }
      const methodResult = await dependencies.runImagoMethod(
        'directorReplayMethod',
        { purpose: 'bounded_director_suggestion' },
        signal,
      )
      if (!methodResult.ok) {
        if (methodResult.error.code === 'cancelled') return methodResult
        return { ok: true, value: { status: 'method_unavailable', proposal: null, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
      }
      const method = validateMethod(methodResult.value, type)
      const latestState = foldProjectContext(session.events)
      if (latestState === null
        || latestState.status === 'stale'
        || latestState.binding.sha256.contextSnapshot !== state.binding.sha256.contextSnapshot) {
        const staleReasons = latestState?.status === 'stale'
          ? latestState.staleReasons
          : ['binding_changed_during_suggestion']
        return { ok: true, value: {
          status: 'refresh_required', proposal: null, staleReasons, manualWorkBlocked: false, authority: ZERO_AUTHORITY,
        } }
      }
      const proposal = proposalFor(type, fresh.value, state.binding, method)
      session.append('qingmu/director-proposal-receipt', {
        schema: 'qingmu.director-proposal-receipt.v1',
        ...proposal.currentObject,
        suggestionType: type,
        bindingSha256: state.binding.sha256.contextSnapshot,
        methodPackageSha256: method.methodPackageSha256,
        proposalSha256: proposal.proposalSha256,
        authority: ZERO_AUTHORITY,
      })
      await dependencies.sessions.flush(session)
      return { ok: true, value: { status: 'proposed', proposal, manualWorkBlocked: false, authority: ZERO_AUTHORITY } }
    } catch (error) {
      if (error instanceof RequestError) return badRequest(error.message)
      return internal(error instanceof Error ? error.message : 'Qingmu project-context request failed')
    }
  }
}

export const name = 'experimental-qingmu-project-context'
export const inject = ['sessions', 'connection']

/** Register one loopback-only channel; optional upstream capabilities are resolved at call time. */
export function apply(ctx: Context): void {
  const handler = createQingmuProjectContextHandler({
    sessions: ctx.sessions,
    get readYimeng() { return ctx.get('qingmuYimengRead', false) as UpstreamHandler | undefined },
    get runImagoMethod() { return ctx.get('qingmuImagoMethod', false) as UpstreamHandler | undefined },
  })
  ctx.provide('qingmuProjectContext', handler)
  ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'loopback' })
}
