/** Qingmu OS production cockpit registration. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { QingmuCockpit } from './QingmuCockpit.tsx'
import type {
  ImagoStageSourceMethodResponse, YimengStageSourcesResponse, YimengStageSourceResult, YimengStageSourceRecovery,
  ImagoProductionUnitMethodResponse, YimengProductionUnitsResponse, YimengProductionUnitResult, YimengProductionUnitRecovery,
  ImagoContinuityMethodResponse,
  ImagoShotFindingMethodResponse, YimengShotFindingFeedResponse, YimengShotFindingResult, YimengShotFindingRecovery,
  ImagoElementMethodResponse, ImagoHeroFrameStoryboardMethodResponse, ImagoPromptIrMethodResponse,
  ImagoReferenceAssetMethodResponse, ImagoShotRelationMethodResponse, ImagoWorksetMethodResponse, QingmuYimengPort,
  YimengCommitElementProfileResponse, YimengCommitPromptIrEditResponse, YimengCommitScriptResponse,
  YimengCommitStoryboardCanvasResponse,
  YimengElementProfileResponse, YimengEpisodesResponse, YimengHealth, YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrResponse, YimengPreviewScriptResponse, YimengPreviewStoryboardCanvasResponse,
  YimengCreateCommentResponse, YimengCreateHumanDecisionResponse, YimengElementReviewFeedResponse,
  YimengCreateReferenceRightsExceptionReleaseResponse, YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengProjectsResponse, YimengProposeElementProfileResponse, YimengProposeReferenceAssetResponse,
  YimengProposePromptIrResponse, YimengProposeScriptResponse, YimengProposeStoryboardCanvasResponse,
  YimengPromptIrResponse,
  YimengReferenceCandidatesResponse, YimengRecoverElementProfileCommitResponse,
  YimengRecoverPromptIrEditCommitResponse, YimengRecoverPromptIrSelectionResponse,
  YimengRecoverScriptCommitResponse, YimengRecoverStoryboardCanvasCommitResponse,
  YimengScriptResponse, YimengSelectPromptIrResponse,
  YimengSelectedVideoReviewResponse,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
  YimengWorkflowProjection,
} from './contracts.ts'
import { unwrapRpc } from './contracts.ts'
import type { QingmuCockpitFace } from './slots.ts'
import { en, NS, zh } from './locales.ts'

export type { QingmuCockpitFace } from './slots.ts'
export type {
  ImagoStageSourceMethodResponse, YimengStageSourcesResponse, YimengStageSourceResult, YimengStageSourceRecovery,
  ImagoProductionUnitMethodResponse, YimengProductionUnitsResponse, YimengProductionUnitResult, YimengProductionUnitRecovery,
  ImagoContinuityMethodResponse,
  ImagoShotFindingMethodResponse, YimengShotFindingFeedResponse, YimengShotFindingResult, YimengShotFindingRecovery,
  ImagoElementMethodResponse, ImagoHeroFrameStoryboardMethodResponse, ImagoPromptIrMethodResponse,
  ImagoReferenceAssetMethodResponse, ImagoShotRelationMethodResponse, ImagoWorksetMethodResponse,
  QingmuImagoMethodPort, QingmuYimengCommandPort,
  QingmuYimengPort, QingmuYimengReadPort,
  YimengCommitElementProfileResponse, YimengCommitPromptIrEditResponse, YimengCommitScriptResponse,
  YimengCommitStoryboardCanvasResponse,
  YimengElementProfileResponse, YimengEpisodesResponse, YimengHealth, YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrResponse, YimengPreviewScriptResponse, YimengPreviewStoryboardCanvasResponse,
  YimengCreateCommentResponse, YimengCreateHumanDecisionResponse, YimengElementReviewFeedResponse,
  YimengCreateReferenceRightsExceptionReleaseResponse, YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengProjectsResponse, YimengProposeElementProfileResponse, YimengProposeReferenceAssetResponse,
  YimengProposePromptIrResponse, YimengProposeScriptResponse, YimengProposeStoryboardCanvasResponse,
  YimengPromptIrResponse,
  YimengReferenceCandidatesResponse, YimengRecoverElementProfileCommitResponse,
  YimengRecoverPromptIrEditCommitResponse, YimengRecoverPromptIrSelectionResponse,
  YimengRecoverScriptCommitResponse, YimengRecoverStoryboardCanvasCommitResponse,
  YimengScriptResponse, YimengSelectPromptIrResponse,
  YimengSelectedVideoReviewResponse,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
  YimengWorkflowProjection,
} from './contracts.ts'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  const buildProfile = process.env.DSH_CLIENT_BUILD_PROFILE
  if (buildProfile !== 'qingmu') {
    throw new Error(`Qingmu cockpit requires a qingmu client artifact; got ${JSON.stringify(buildProfile)}`)
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qingmu-cockpit: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('Qingmu cockpit requires an active Client Connection')
  const read = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> =>
    unwrapRpc(await connection.rpc.call('/qingmu-yimeng', endpoint, payload, signal)) as T
  const command = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> =>
    unwrapRpc(await connection.rpc.call('/qingmu-yimeng-command', endpoint, payload, signal)) as T
  const method = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> =>
    unwrapRpc(await connection.rpc.call('/qingmu-imago-method', endpoint, payload, signal)) as T

  const port: QingmuYimengPort = {
    stageSources: (request, signal) => read<YimengStageSourcesResponse>('stageSources', request, signal),
    stageSourceMethod: (request, signal) => method<ImagoStageSourceMethodResponse>('stageSourceMethod', request, signal),
    bindStageSource: (request, signal) => command<YimengStageSourceResult>('bindStageSource', request, signal),
    recoverStageSourceBinding: (request, signal) => command<YimengStageSourceRecovery>('recoverStageSourceBinding', request, signal),
    productionUnits: (request, signal) => read<YimengProductionUnitsResponse>('productionUnits', request, signal),
    productionUnitMethod: (request, signal) => method<ImagoProductionUnitMethodResponse>('productionUnitMethod', request, signal),
    bindProductionUnit: (request, signal) => command<YimengProductionUnitResult>('bindProductionUnit', request, signal),
    recoverProductionUnitBinding: (request, signal) => command<YimengProductionUnitRecovery>('recoverProductionUnitBinding', request, signal),
    health: signal => read<YimengHealth>('health', {}, signal),
    projects: (request, signal) => read<YimengProjectsResponse>('projects', request, signal),
    episodes: (request, signal) => read<YimengEpisodesResponse>('episodes', request, signal),
    elementProfile: (request, signal) => read<YimengElementProfileResponse>('elementProfile', request, signal),
    referenceCandidates: (request, signal) =>
      read<YimengReferenceCandidatesResponse>('referenceCandidates', request, signal),
    reviewEvents: (request, signal) => read<YimengElementReviewFeedResponse>('reviewEvents', request, signal),
    referenceRightsExceptionReleases: (request, signal) =>
      read<YimengReferenceRightsExceptionReleaseFeedResponse>('referenceRightsExceptionReleases', request, signal),
    script: (request, signal) => read<YimengScriptResponse>('script', request, signal),
    promptIr: (request, signal) => read<YimengPromptIrResponse>('promptIr', request, signal),
    selectedVideoReview: (request, signal) => read<YimengSelectedVideoReviewResponse>('selectedVideoReview', request, signal),
    shotFindings: (request, signal) => read<YimengShotFindingFeedResponse>('shotFindings', request, signal),
    shotFindingMethod: (request, signal) => method<ImagoShotFindingMethodResponse>('shotFindingMethod', request, signal),
    recordShotFinding: (request, signal) => command<YimengShotFindingResult>('recordShotFinding', request, signal),
    recoverShotFinding: (request, signal) => command<YimengShotFindingRecovery>('recoverShotFinding', request, signal),
    workflow: (request, signal) => read<YimengWorkflowProjection>('workflow', request, signal),
    worksetMethod: (request, signal) => method<ImagoWorksetMethodResponse>('worksetMethod', request, signal),
    continuityMethod: (request, signal) => method<ImagoContinuityMethodResponse>('continuityMethod', request, signal),
    elementMethod: (request, signal) => method<ImagoElementMethodResponse>('elementMethod', request, signal),
    referenceAssetMethod: (request, signal) =>
      method<ImagoReferenceAssetMethodResponse>('referenceAssetMethod', request, signal),
    promptIrMethod: (request, signal) => method<ImagoPromptIrMethodResponse>('promptIrMethod', request, signal),
    shotRelationMethod: (request, signal) =>
      method<ImagoShotRelationMethodResponse>('shotRelationMethod', request, signal),
    heroFrameStoryboardMethod: (request, signal) =>
      method<ImagoHeroFrameStoryboardMethodResponse>('heroFrameStoryboardMethod', request, signal),
    proposeElementProfile: (request, signal) =>
      command<YimengProposeElementProfileResponse>('proposeElementProfile', request, signal),
    proposeReferenceAsset: (request, signal) =>
      command<YimengProposeReferenceAssetResponse>('proposeReferenceAsset', request, signal),
    previewElementProfile: (request, signal) =>
      command<YimengPreviewElementProfileResponse>('previewElementProfile', request, signal),
    commitElementProfile: (request, signal) =>
      command<YimengCommitElementProfileResponse>('commitElementProfile', request, signal),
    recoverElementProfileCommit: (request, signal) =>
      command<YimengRecoverElementProfileCommitResponse>('recoverElementProfileCommit', request, signal),
    createComment: (request, signal) => command<YimengCreateCommentResponse>('createComment', request, signal),
    createHumanDecision: (request, signal) =>
      command<YimengCreateHumanDecisionResponse>('createHumanDecision', request, signal),
    createReferenceRightsExceptionRelease: (request, signal) =>
      command<YimengCreateReferenceRightsExceptionReleaseResponse>(
        'createReferenceRightsExceptionRelease',
        request,
        signal,
      ),
    recoverReferenceRightsExceptionRelease: (request, signal) =>
      command<YimengRecoverReferenceRightsExceptionReleaseResponse>(
        'recoverReferenceRightsExceptionRelease',
        request,
        signal,
      ),
    proposeScript: (request, signal) => command<YimengProposeScriptResponse>('proposeScript', request, signal),
    previewScript: (request, signal) => command<YimengPreviewScriptResponse>('previewScript', request, signal),
    commitScript: (request, signal) => command<YimengCommitScriptResponse>('commitScript', request, signal),
    recoverScriptCommit: (request, signal) => command<YimengRecoverScriptCommitResponse>('recoverScriptCommit', request, signal),
    proposePromptIr: (request, signal) => command<YimengProposePromptIrResponse>('proposePromptIr', request, signal),
    previewPromptIr: (request, signal) => command<YimengPreviewPromptIrResponse>('previewPromptIr', request, signal),
    commitPromptIrEdit: (request, signal) =>
      command<YimengCommitPromptIrEditResponse>('commitPromptIrEdit', request, signal),
    recoverPromptIrEditCommit: (request, signal) =>
      command<YimengRecoverPromptIrEditCommitResponse>('recoverPromptIrEditCommit', request, signal),
    selectPromptIr: (request, signal) => command<YimengSelectPromptIrResponse>('selectPromptIr', request, signal),
    recoverPromptIrSelection: (request, signal) =>
      command<YimengRecoverPromptIrSelectionResponse>('recoverPromptIrSelection', request, signal),
    proposeStoryboardCanvas: (request, signal) =>
      command<YimengProposeStoryboardCanvasResponse>('proposeStoryboardCanvas', request, signal),
    previewStoryboardCanvas: (request, signal) =>
      command<YimengPreviewStoryboardCanvasResponse>('previewStoryboardCanvas', request, signal),
    commitStoryboardCanvas: (request, signal) =>
      command<YimengCommitStoryboardCanvasResponse>('commitStoryboardCanvas', request, signal),
    recoverStoryboardCanvasCommit: (request, signal) =>
      command<YimengRecoverStoryboardCanvasCommitResponse>('recoverStoryboardCanvasCommit', request, signal),
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'qingmu-cockpit',
    locale: NS,
    inject: (): QingmuCockpitFace => ({ port }),
  }, QingmuCockpit))
}
