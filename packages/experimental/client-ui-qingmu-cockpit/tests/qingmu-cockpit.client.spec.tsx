// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  YimengHealth,
  YimengGateAControlEvidenceResponse,
  YimengHeroFrameStoryboardsProjection,
  YimengShotRelationsProjection,
  YimengWorkflowProjection,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { QingmuCockpit, type QingmuCockpitProps } from '../src/client/QingmuCockpit.tsx'
import { buildHeroFrameRelationRequest, buildShotRelationMethodRequest } from '../src/client/ShotRelationMethodView.tsx'
import { ShotRelationsView } from '../src/client/ShotRelationsView.tsx'
import type { QingmuYimengPort } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import { unavailableWorksetResponse } from './fixtures/workset-method.client.ts'
import { continuityResponse } from './fixtures/continuity-method.client.ts'
import {
  createScriptCommitRecoveryMarker,
  readScriptCommitRecoveryMarker,
  writeScriptCommitRecoveryMarker,
} from '../src/client/script-commit-recovery.ts'

const t = ((key: keyof typeof zh) => zh[key]) as QingmuCockpitProps['t']
const neverHook = (() => { throw new Error('cockpit must not read global hooks') }) as never

const HEALTH: YimengHealth = {
  status: 'ok',
  liveness: true,
  runtime: {
    commit: 'runtime-commit',
    dirty: false,
    identitySource: 'release-manifest',
    matchesReleaseManifest: true,
  },
  build: { commit: 'build-commit' },
  hints: null,
}

const GATE_A_CONTROL_EVIDENCE: YimengGateAControlEvidenceResponse = {
  schema: 'jason.qingmu-provider-gate-a-control-evidence.v1',
  productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
  gateAStatus: 'PASSED_CONTROL_LOGIC_ONLY',
  mode: 'offline_fault_injection',
  snapshotPolicy: 'rfc8785-jcs-sha256-v1',
  environment: {
    database: 'temporary_sqlite',
    networkEgressAllowed: false,
    provider: 'scripted_fake',
    productionCredentialsLoaded: false,
    temporaryDatabaseWrites: true,
  },
  scenarios: [
    { id: 'unauthorized_request_blocked', outcome: 'passed', providerSubmitAttempts: 0, budgetReserved: false },
    {
      id: 'duplicate_ack_replay', outcome: 'passed', providerSubmitAttempts: 1,
      duplicateAckReplays: 1, duplicatePaidSubmissions: 0,
    },
    { id: 'payload_sha_conflict', outcome: 'passed', providerSubmitAttempts: 1, conflictingSubmitAttempts: 0 },
    {
      id: 'submission_unknown_quarantine', outcome: 'passed', providerSubmitAttempts: 1,
      automaticResubmits: 0, workerOutcomes: ['dispatch_state_unknown'],
    },
    {
      id: 'simulated_reconciliation', outcome: 'passed', providerCalls: 0,
      deduplicated: true, simulatedOperatorDecision: true, humanSignoffInferred: false,
    },
    {
      id: 'poll_recovery', outcome: 'passed', providerSubmitAttempts: 1, providerPollAttempts: 2,
      automaticResubmits: 0, workerOutcomes: ['dispatched', 'error', 'ingested', 'technical_quality_passed'],
    },
    {
      id: 'download_timeout_recovery', outcome: 'passed', providerSubmitAttempts: 1,
      providerPollAttempts: 1, downloadAttempts: 2, automaticResubmits: 0,
      workerOutcomes: ['dispatched', 'download_timeout_retry', 'ingested', 'technical_quality_passed'],
    },
    {
      id: 'truncated_download_rejected', outcome: 'passed', providerSubmitAttempts: 1,
      providerPollAttempts: 1, downloadAttempts: 1, truncatedDownloadsAccepted: 0,
    },
  ],
  assertions: {
    externalProviderCalls: 0,
    productionDatabaseWrites: 0,
    formalBudgetLedgerWrites: 0,
    duplicatePaidSubmissions: 0,
    unknownAutomaticResubmits: 0,
    maximumAutomaticSubmitAttemptsPerDispatch: 1,
    networkEgressAttempts: 0,
    truncatedDownloadsAccepted: 0,
    reconciliationProviderCalls: 0,
    pollRecoveryResubmits: 0,
    downloadRecoveryResubmits: 0,
  },
  sourceBindings: [{ path: 'scripts/qingmu_gate_a_evidence.py', sha256: 'a'.repeat(64) }],
  externalProviderCalls: 0,
  productionDatabaseWrites: 0,
  formalBudgetLedgerWrites: 0,
  simulatedProviderSubmitAttempts: 6,
  paidGenerationAuthorized: false,
  humanSignoffInferred: false,
  evidenceSnapshotSha256: 'b'.repeat(64),
}

const SHOT_RELATIONS = {
  schema: 'jason.scene-shot-beat-element-relations.v1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevision: {
    episodeRevision: 3,
    revisionId: 'storyboard-revision-1',
    revisionVersion: 1,
    sourceSha256: '1'.repeat(64),
  },
  scenes: [
    { sceneId: 'scene-1', name: '雨夜巷口', profileRevision: 2, snapshotSha256: '2'.repeat(64) },
    { sceneId: 'scene-2', name: '旧走廊', profileRevision: 4, snapshotSha256: '3'.repeat(64) },
  ],
  shots: [
    {
      shotId: 'frame-1',
      frameNo: 1,
      sceneId: 'scene-1',
      title: '雨夜相遇',
      durationSec: 2.5,
      dialogueRhythm: {
        cueCount: 1,
        timedCueCount: 1,
        cues: [{
          schemaVersion: 'dialogue-cue-v2',
          lineId: 'line-1',
          speakerId: 'character-1',
          verbatimText: '你终于来了。',
          plannedStartSec: 0.5,
          plannedEndSec: 1.5,
          timingVerified: true,
          legacy: false,
        }],
      },
      beats: [{
        beatId: 'beat-1',
        order: 0,
        type: 'action',
        startSec: 0,
        endSec: 2.5,
        actorIds: ['character-1'],
        propIds: ['prop-1'],
        visualResponsibility: '林青进入巷口并看向伞下的人。',
      }],
      elements: [
        {
          elementKind: 'actor', elementId: 'character-1', name: '林青', profileRevision: 2,
          snapshotSha256: '4'.repeat(64), currentReferenceAvailability: 'available',
          currentReference: {
            assetId: 'asset-character-1', sha256: 'a'.repeat(64),
            lineage: {
              projectId: 'project-1', sourceEpisodeId: 'episode-1', ownerType: 'actor', ownerId: 'character-1',
              role: 'identity_board', generationJobId: 'job-character-1', sourceRevisionId: 'revision-character-1',
              formalConsistencyCheckId: 'check-character-1',
            },
          },
        },
        {
          elementKind: 'scene', elementId: 'scene-1', name: '雨夜巷口', profileRevision: 2,
          snapshotSha256: '2'.repeat(64), currentReferenceAvailability: 'missing', currentReference: null,
        },
        {
          elementKind: 'prop', elementId: 'prop-1', name: '黑伞', profileRevision: 1,
          snapshotSha256: '5'.repeat(64), currentReferenceAvailability: 'missing', currentReference: null,
        },
      ],
    },
    {
      shotId: 'frame-2',
      frameNo: 2,
      sceneId: 'scene-2',
      title: '走廊回望',
      durationSec: 1.5,
      dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] },
      beats: [{
        beatId: 'beat-2',
        order: 0,
        type: 'reaction',
        startSec: 0,
        endSec: 1.5,
        actorIds: ['character-1'],
        propIds: [],
        visualResponsibility: '林青停步回望。',
      }],
      elements: [
        {
          elementKind: 'actor', elementId: 'character-1', name: '林青', profileRevision: 2,
          snapshotSha256: '4'.repeat(64), currentReferenceAvailability: 'available',
          currentReference: {
            assetId: 'asset-character-1', sha256: 'a'.repeat(64),
            lineage: {
              projectId: 'project-1', sourceEpisodeId: 'episode-1', ownerType: 'actor', ownerId: 'character-1',
              role: 'identity_board', generationJobId: 'job-character-1', sourceRevisionId: 'revision-character-1',
              formalConsistencyCheckId: 'check-character-1',
            },
          },
        },
        {
          elementKind: 'scene', elementId: 'scene-2', name: '旧走廊', profileRevision: 4,
          snapshotSha256: '3'.repeat(64), currentReferenceAvailability: 'missing', currentReference: null,
        },
      ],
    },
  ],
  valid: true,
  blockers: [],
} as const

function heroFrameStoryboardsFor(
  relations: YimengShotRelationsProjection,
): YimengHeroFrameStoryboardsProjection {
  return {
    schema: 'jason.qingmu-hero-frame-storyboards.v1',
    projectId: relations.projectId,
    episodeId: relations.episodeId,
    episodeRevision: relations.storyboardRevision.episodeRevision,
    storyboardRevision: {
      revisionId: relations.storyboardRevision.revisionId,
      revisionVersion: relations.storyboardRevision.revisionVersion,
      sourceSha256: relations.storyboardRevision.sourceSha256,
    },
    shotRelationsSha256: '8'.repeat(64),
    shots: relations.shots.map(shot => ({
      shotId: shot.shotId,
      shotSnapshotSha256: '7'.repeat(64),
      heroFrame: null,
      canvas: null,
      blockers: [],
    })),
    shotsSha256: '9'.repeat(64),
    valid: true,
    blockers: [],
  }
}

const HERO_FRAME_STORYBOARDS = heroFrameStoryboardsFor(SHOT_RELATIONS)

const WORKFLOW: YimengWorkflowProjection = {
  schema: 'jason.episode-workflow-projection.v1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  sourceRevision: { revision: 'source-1' },
  inputFingerprint: 'fingerprint-1',
  activeTaskId: null,
  status: 'active',
  hasData: true,
  isStale: false,
  qualityPassed: true,
  selected: true,
  canProceed: true,
  stages: {
    script: {
      label: '剧本',
      status: 'approved',
      hasData: true,
      isStale: false,
      qualityPassed: true,
      selected: true,
      canProceed: true,
    },
  },
  stageHandoff: {},
  assets: {
    semanticItems: [{
      assetId: 'character-1',
      type: 'character',
      name: '林青',
      provenance: { reviewAccepted: false, reviewStatus: 'AwaitingHumanReview' },
    }],
  },
  director: { shotRelations: SHOT_RELATIONS, heroFrameStoryboards: HERO_FRAME_STORYBOARDS },
  shots: {
    count: 2,
    shotGroupCount: 2,
    segmentCount: 2,
    unresolvedAssetRefCount: 0,
    items: [
      { shotId: 'shot-1', name: '雨夜相遇' },
      { shotId: 'shot-2', name: '走廊回望' },
    ],
  },
  video: { candidates: [{ id: 'video-1' }], selected: [], completedCount: 1, qualityPassed: true },
  audio: { candidates: [], selected: [], dialogueLineCount: 2, qualityPassed: false },
  timeline: { hasData: true, selected: false, finalOutputs: [], qualityPassed: false },
  budget: {
    valid: true,
    window_id: 'budget-window-1',
    effective_cap_cny: 100,
    window_spent_cny: 10,
    window_remaining_cny: 90,
  },
  release: { releaseReady: true },
  blockers: [],
  legacy: {},
  interpretation: {
    providerAuthorization: 'not-exposed',
    humanSignoff: 'not-inferred',
    productionReadiness: 'not-inferred',
    statusFacts: ['budget.valid', 'release.releaseReady', 'qualityPassed'],
  },
}

const PROMPT_IR_WORKFLOW: YimengWorkflowProjection = {
  ...WORKFLOW,
  shots: {
    ...WORKFLOW.shots,
    items: SHOT_RELATIONS.shots.map((shot, index) => ({
      shotId: `public-shot-${index + 1}`,
      name: shot.title,
      frameId: shot.shotId,
      promptLineage: {
        storyboardRevisionId: SHOT_RELATIONS.storyboardRevision.revisionId,
        id: `prompt-ready-${index + 1}`,
        version: 1,
        contentSha256: String(index + 6).repeat(64),
        status: 'Ready',
      },
    })),
  },
}

function promptIrRead(frameId: string) {
  const index = frameId === 'frame-2' ? 2 : 1
  return {
    draft: null,
    schema: 'jason.qingmu-prompt-ir-subject-read.v1',
    subject: {
      schema: 'jason.qingmu-prompt-ir-subject.v1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'prompt_ir',
      targetId: `${SHOT_RELATIONS.storyboardRevision.revisionId}:${frameId}`,
      storyboardRevisionId: SHOT_RELATIONS.storyboardRevision.revisionId,
      frameId,
      promptIrId: `prompt-ready-${index}`,
      promptIrVersion: 1,
      promptIrContentSha256: String(index + 5).repeat(64),
      status: 'Ready',
      editableProjection: {
        imageGenPrompt: `镜头 ${frameId}`,
        lastFrameImagePrompt: '末帧',
        videoGenPrompt: '视频',
        motionPrompt: '动作',
        negativePrompt: '水印',
      },
    },
    baseRevision: 1,
    baseSnapshotSha256: 'f'.repeat(64),
  } as const
}

function workflowFor(projectId: string, episodeId: string, shotId: string, title: string): YimengWorkflowProjection {
  const scene = SHOT_RELATIONS.scenes[0]
  const shot = SHOT_RELATIONS.shots[0]
  const shotRelations: YimengShotRelationsProjection = {
    ...SHOT_RELATIONS,
    projectId,
    episodeId,
    storyboardRevision: {
      ...SHOT_RELATIONS.storyboardRevision,
      revisionId: `${episodeId}-storyboard-revision`,
    },
    scenes: [scene],
    shots: [{ ...shot, shotId, title }],
  }
  return {
    ...WORKFLOW,
    projectId,
    episodeId,
    director: {
      shotRelations,
      heroFrameStoryboards: heroFrameStoryboardsFor(shotRelations),
    },
    shots: {
      ...WORKFLOW.shots,
      count: 1,
      shotGroupCount: 1,
      segmentCount: 1,
      items: [{ shotId: `public-${shotId}`, name: title }],
    },
  }
}

const SCRIPT = {
  found: true,
  projectId: 'project-1',
  episodeId: 'episode-1',
  script: {
    scenes: [{ sceneIndex: 1, title: '旧走廊', actionDescription: '林青走进走廊。', dialogues: [] }],
  },
  scriptSha256: '0f9a610878bfed02b8475b394df23c38d13f3b02d134da72932b60e644f1b8ea',
  revision: 3,
  editedByUser: true,
  updatedAt: '2026-08-26T08:00:00+00:00',
} as const

const PROPOSED_SCRIPT = {
  durationScale: 0.000001,
  scenes: [{ sceneIndex: 1, title: '体育馆走廊', actionDescription: '林青走进走廊。', dialogues: [] }],
} as const

const CHANGE_SET = {
  schema: 'jason.qingmu-change-set.v1',
  id: 'changeset-1',
  workspaceId: null,
  projectId: 'project-1',
  episodeId: 'episode-1',
  targetType: 'episode_script',
  targetId: 'episode-1',
  baseRevision: 3,
  baseSnapshotSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64),
  originKind: 'human',
  actorUserId: 'user-1',
  harnessSessionId: null,
  status: 'proposed',
  authoritativeRevision: null,
  authoritativeSnapshotSha256: null,
  committedByUserId: null,
  committedEventId: null,
  committedAt: null,
  createdAt: '2026-08-26T08:01:00+00:00',
  updatedAt: '2026-08-26T08:01:00+00:00',
} as const

const AUTHORITATIVE_SCRIPT = {
  ...PROPOSED_SCRIPT,
  editMetadata: {
    editedByUser: true,
    editedAt: '2026-08-26T08:02:00+00:00',
    source: 'qingmu_change_set',
    changeSetId: CHANGE_SET.id,
    actorUserId: CHANGE_SET.actorUserId,
  },
} as const
const AUTHORITATIVE_SCRIPT_SHA256 = '03ac515dab97399dacf1d2413c096553698e100b38cc17affe68b1fff9c2bab2'

const PREVIEW = {
  schema: 'jason.qingmu-change-set-preview.v1',
  changeSet: CHANGE_SET,
  baseScript: SCRIPT.script,
  proposedScript: PROPOSED_SCRIPT,
  authoritativeCurrentScript: SCRIPT.script,
  changeSetId: CHANGE_SET.id,
  payloadSha256: CHANGE_SET.payloadSha256,
  baseRevision: 3,
  authoritativeRevision: 3,
  changed: true,
  changedPaths: ['$.scenes[0].title'],
  authoritativeChangedPaths: [],
  revisionConflict: false,
  baseSnapshotConflict: false,
  canCommit: true,
  invalidatedStages: ['assets', 'director', 'shots', 'video', 'audio', 'timeline'],
  preflight: { valid: true },
  references: [],
  previewSha256: 'c'.repeat(64),
} as const

const COMMIT = {
  schema: 'jason.qingmu-episode-script-commit-result.v1',
  changeSetId: CHANGE_SET.id,
  commandReceiptId: 'receipt-1',
  eventId: 'event-1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  baseRevision: 3,
  authoritativeRevision: 4,
  authoritativeSnapshotSha256: AUTHORITATIVE_SCRIPT_SHA256,
  payloadSha256: CHANGE_SET.payloadSha256,
  idempotencyKey: `qingmu:${CHANGE_SET.id}:${CHANGE_SET.payloadSha256}`,
  changed: true,
  invalidatedStages: PREVIEW.invalidatedStages,
  deduplicated: false,
  committedAt: '2026-08-26T08:02:00+00:00',
} as const

const RECOVERY = {
  schema: 'jason.qingmu-command-receipt-recovery.v1',
  recovered: true,
  receiptSha256: 'e'.repeat(64),
  receipt: COMMIT,
} as const

const ACTOR_PROFILE = {
  schema: 'jason.qingmu-element-profile-subject-read.v2',
  subject: {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: 'project-1',
    targetType: 'element_profile',
    elementKind: 'actor',
    actorId: 'character-1',
    profileRevision: 2,
    name: '林青',
    visualIdentity: '二十八岁女刑警，利落短发，深蓝防水外套。',
    officialReferenceImageUrl: null,
    references: [],
  },
  snapshotSha256: '8'.repeat(64),
} as const

function actorMethod(request: {
  readonly projectId: string
  readonly targetId: string
  readonly elementKind: 'actor' | 'scene' | 'prop'
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}) {
  return {
    schema: 'qingmu.imago-element-method-adapter-result.v1',
    projectionSha256: '9'.repeat(64),
    projection: {
      schema: 'qingmu.imago-element-method-projection.v1',
      input_snapshot_sha256: 'a'.repeat(64),
      subject: {
        project_id: request.projectId,
        target_type: 'element_profile',
        target_id: request.targetId,
        element_kind: request.elementKind,
        scope_type: 'project',
        scope_id: request.projectId,
        base_revision: request.baseRevision,
        base_snapshot_sha256: request.baseSnapshotSha256,
      },
      method_definition: {},
      source_bindings: [],
      field_hints: [],
      checklist: [],
      work_order_projection: {},
      review_card: { title: '人物资料审核', hard_vetoes: [] },
      legal_work_set: {},
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      paid_provider_authority: 'not_granted',
      human_approval_inferred: false,
      selection_authority: 'not_granted',
    },
    methodAttestation: {
      schema: 'qingmu.imago-element-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: '9'.repeat(64),
      inputSnapshotSha256: 'a'.repeat(64),
      subjectSha256: 'b'.repeat(64),
      signature: 'c'.repeat(64),
    },
  } as const
}

function shotRelationMethod(request: Parameters<QingmuYimengPort['shotRelationMethod']>[0]) {
  const selectedShot = request.shots.find(shot => shot.shotId === request.selectedShotId)
  if (selectedShot === undefined) throw new Error('fixture selected Shot is missing')
  const projectionSha256 = 'c'.repeat(64)
  const inputSnapshotSha256 = 'd'.repeat(64)
  const relationSnapshotSha256 = 'e'.repeat(64)
  return {
    schema: 'qingmu.imago-shot-relation-method-adapter-result.v1',
    projectionSha256,
    projection: {
      schema: 'qingmu.imago-shot-relation-method-projection.v1',
      input_snapshot_sha256: inputSnapshotSha256,
      target: {
        projectId: request.projectId,
        episodeId: request.episodeId,
        episodeRevision: request.episodeRevision,
        storyboardRevisionId: request.storyboardRevisionId,
        storyboardRevisionVersion: request.storyboardRevisionVersion,
        storyboardSourceSha256: request.storyboardSourceSha256,
        relationSnapshotSha256,
        selectedShotId: request.selectedShotId,
      },
      relationship_projection: {
        canonicalShotIdSource: 'yimeng_storyboard_frame_id',
        beatIdScope: 'shot_local',
        scenes: request.scenes,
        shots: request.shots,
        elements: request.elements,
        selectedShot,
      },
      method_definition: { sha256: 'f'.repeat(64), agent_paths: ['hidden-agent'], skill_paths: ['hidden-skill'] },
      source_bindings: [],
      field_hints: [{ hint_id: 'same-shot', title: '同一镜头身份', guidance: '只使用易梦 Shot ID。' }],
      checklist: [{ check_id: 'zero-execution', label: '没有写入或执行', required: true }],
      work_order_projection: {
        operation: 'inspectCanonicalShotRelations',
        operations: ['inspectCanonicalShotRelations', 'inspectShotRiverRhythmAndReferences'],
        allowed_mutations: [],
        providerCalls: 0,
        workerStarted: false,
      },
      review_card: {
        title: 'Scene / Shot / Beat / Element 关系检查',
        decision_boundary: '结构通过只代表关系可读，不产生创意批准、资产选择或人工签收。',
      },
      legal_work_set: { reads: ['yimeng'], writes: [] },
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      providerCalls: 0,
      workerStarted: false,
      selection_executed: false,
      human_approval_inferred: false,
      human_signoff_inferred: false,
    },
    methodAttestation: {
      schema: 'qingmu.imago-shot-relation-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256,
      inputSnapshotSha256,
      targetSha256: '1'.repeat(64),
      relationSnapshotSha256,
      selectedShotSha256: '2'.repeat(64),
      signature: '3'.repeat(64),
    },
  } as const
}

function makePort(overrides: Partial<QingmuYimengPort> = {}): QingmuYimengPort {
  return {
    readScenePlanning: vi.fn(async request => ({ schema: 'jason.qingmu-scene-planning-state.v1' as const, ...request,
      scriptRevision: 0, scriptSha256: null, scenes: [], storyboard: null, planning: null })),
    saveScenePlanning: vi.fn(async () => { throw new Error('Planning uses a separate fixture') }),
    recoverScenePlanning: vi.fn(async () => { throw new Error('Planning uses a separate fixture') }),
    initializeProject: vi.fn(async () => { throw new Error('Creation uses a separate fixture') }),
    recoverProjectInitialization: vi.fn(async () => { throw new Error('Creation uses a separate fixture') }),
    readTextImport: vi.fn(async request => ({ schema: 'jason.qingmu-text-import-state.v1' as const, ...request, scriptRevision: 0, script: null, draft: null })),
    createTextImport: vi.fn(async () => { throw new Error('Creation uses a separate fixture') }),
    correctTextImport: vi.fn(async () => { throw new Error('Creation uses a separate fixture') }),
    confirmTextImport: vi.fn(async () => { throw new Error('Creation uses a separate fixture') }),
    takePreview: vi.fn(async () => { throw new Error('Preview requires the real media fixture') }),
    capabilityCatalog: vi.fn(async () => ({
      schema: 'jason.provider-capability-catalog.v1',
      productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
      snapshotPolicy: 'rfc8785-jcs-sha256-v1',
      activeProfile: 'quality',
      catalogSnapshotSha256: 'a'.repeat(64),
      requestSnapshotSha256: 'b'.repeat(64),
      preflightSnapshotSha256: 'c'.repeat(64),
      request: { modelId: null, capability: null, requestedControls: [], dryRun: true },
      items: [], providerCalls: 0, databaseWrites: 0, paidGenerationAuthorized: false,
    } as const)),
    costRehearsal: vi.fn(async () => { throw new Error('Cost rehearsal is not part of this fixture') }),
    gateAControlEvidence: vi.fn(async () => GATE_A_CONTROL_EVIDENCE),
    health: vi.fn(async () => HEALTH),
    projects: vi.fn(async () => ({
      items: [{ id: 'project-1', name: '青木样片' }],
      pagination: { page: 1, pageSize: 100, pages: 1, total: 1 },
    })),
    episodes: vi.fn(async () => ({
      items: [{ id: 'episode-1', projectId: 'project-1', episodeNumber: 1, name: '雨夜' }],
    })),
    elementProfile: vi.fn(async () => ACTOR_PROFILE),
    referenceCandidates: vi.fn(async (request: Parameters<QingmuYimengPort['referenceCandidates']>[0]) => ({
      schema: 'jason.qingmu-reference-asset-candidates.v1',
      projectId: request.projectId,
      targetType: 'element_profile',
      targetId: request.targetId,
      elementKind: request.elementKind,
      profileRevision: 2,
      elementSnapshotSha256: ACTOR_PROFILE.snapshotSha256,
      candidates: [],
      humanApprovalInferred: false,
    } as const)),
    reviewEvents: vi.fn(async (request: Parameters<QingmuYimengPort['reviewEvents']>[0]) => ({
      schema: 'jason.qingmu-element-review-feed.v1',
      projectId: request.projectId,
      elementKind: request.elementKind,
      targetId: request.targetId,
      subject: {
        type: 'element_profile',
        id: request.targetId,
        revision: 2,
        sha256: ACTOR_PROFILE.snapshotSha256,
      },
      capabilities: { canComment: true, canDecide: true },
      comments: [],
      decisions: [],
      currentDecision: null,
    } as const)),
    referenceRightsExceptionReleases: vi.fn(async (
      request: Parameters<QingmuYimengPort['referenceRightsExceptionReleases']>[0],
    ) => ({
      schema: 'jason.qingmu-reference-rights-exception-release-feed.v1',
      projectId: request.projectId,
      elementKind: request.elementKind,
      targetId: request.targetId,
      subject: {
        type: 'element_profile',
        id: request.targetId,
        revision: 2,
        sha256: ACTOR_PROFILE.snapshotSha256,
      },
      capabilities: {
        canRelease: false,
        blockedReasonCode: 'reference_rights_unavailable',
        blockedReason: '当前没有可绑定的参考资产权利记录',
        requiresRecentAuthentication: true,
      },
      releases: [],
      currentReleases: [],
    } as const)),
    elementMethod: vi.fn(async (request: Parameters<QingmuYimengPort['elementMethod']>[0]) => actorMethod(request)),
    referenceAssetMethod: vi.fn(async () => { throw new Error('reference method is not part of this fixture') }),
    script: vi.fn(async () => SCRIPT),
    stageSources: vi.fn(async (request: Parameters<QingmuYimengPort['stageSources']>[0]) => ({
      schema: 'jason.qingmu-stage-source-feed.v1', ...request, stageId: 'A1S', canBind: false,
      source: null, subjectSnapshotSha256: null, unavailableReason: 'episode_script_missing',
      bindingRevision: 0, bindingSha256: null, latestBinding: null, currentBinding: null,
    } as const)),
    stageSourceMethod: vi.fn(async () => { throw new Error('Stage-source method is not part of this fixture') }),
    bindStageSource: vi.fn(async () => { throw new Error('Stage-source binding is not part of this fixture') }),
    recoverStageSourceBinding: vi.fn(async () => { throw new Error('Stage-source recovery is not part of this fixture') }),
    promptIr: vi.fn(async () => { throw new Error('PromptIR read is not part of this fixture') }),
    promptIrMethod: vi.fn(async () => { throw new Error('PromptIR method is not part of this fixture') }),
    shotRelationMethod: vi.fn(async (request: Parameters<QingmuYimengPort['shotRelationMethod']>[0]) => (
      shotRelationMethod(request)
    )),
    heroFrameStoryboardMethod: vi.fn(async () => { throw new Error('Hero Frame storyboard method is not part of this fixture') }),
    workflow: vi.fn(async () => WORKFLOW),
    worksetMethod: vi.fn(async (request: Parameters<QingmuYimengPort['worksetMethod']>[0]) => (
      unavailableWorksetResponse(request.projectId, request.episodeId)
    )),
    continuityMethod: vi.fn(async (request: Parameters<QingmuYimengPort['continuityMethod']>[0]) => (
      continuityResponse(WORKFLOW, request.selectedShotId)
    )),
    selectedVideoReview: vi.fn(async (request: Parameters<QingmuYimengPort['selectedVideoReview']>[0]) => ({
      schema: 'qingmu.yimeng-selected-video-review.v1', ...request, selectedAssetId: null, selected: null,
      readOnly: true, providerCalls: 0, taskMutation: false, budgetMutation: false, humanSignoffInferred: false,
    } as const)),
    takeVersions: vi.fn(async () => { throw new Error('Take versions are not part of this fixture') }),
    evidenceLedger: vi.fn(async () => { throw new Error('Episode evidence is not part of this fixture') }),
    verifyEpisode: vi.fn(async () => { throw new Error('Episode verification is not part of this fixture') }),
    takeComments: vi.fn(async () => { throw new Error('Take comments are not part of this fixture') }),
    takeAcceptance: vi.fn(async () => { throw new Error('Take acceptance is not part of this fixture') }),
    takeAcceptanceMethod: vi.fn(async () => { throw new Error('Take acceptance method is not part of this fixture') }),
    selectTakeVersion: vi.fn(async () => { throw new Error('Take selection is not part of this fixture') }),
    recoverTakeVersionSelection: vi.fn(async () => { throw new Error('Take recovery is not part of this fixture') }),
    createTakeComment: vi.fn(async () => { throw new Error('Take comment creation is not part of this fixture') }),
    recoverTakeComment: vi.fn(async () => { throw new Error('Take comment recovery is not part of this fixture') }),
    takeReviewAuthority: vi.fn(async () => { throw new Error('Take review authority is not part of this fixture') }),
    createTakeReviewRecommendation: vi.fn(async () => {
      throw new Error('Take recommendation creation is not part of this fixture')
    }),
    recoverTakeReviewRecommendation: vi.fn(async () => {
      throw new Error('Take recommendation recovery is not part of this fixture')
    }),
    createTakeHumanDecision: vi.fn(async () => {
      throw new Error('Take HumanDecision creation is not part of this fixture')
    }),
    recoverTakeHumanDecision: vi.fn(async () => {
      throw new Error('Take HumanDecision recovery is not part of this fixture')
    }),
    takeTechnicalQc: vi.fn(async () => {
      throw new Error('Take technical QC is not part of this fixture')
    }),
    recordTakeTechnicalQc: vi.fn(async () => {
      throw new Error('Take technical QC creation is not part of this fixture')
    }),
    recoverTakeTechnicalQc: vi.fn(async () => {
      throw new Error('Take technical QC recovery is not part of this fixture')
    }),
    takeApprovalLifecycle: vi.fn(async () => {
      throw new Error('Take approval lifecycle is not part of this fixture')
    }),
    takeApprovalLifecycleMethod: vi.fn(async () => {
      throw new Error('Take approval lifecycle method is not part of this fixture')
    }),
    transitionTakeApprovalLifecycle: vi.fn(async () => {
      throw new Error('Take approval lifecycle transition is not part of this fixture')
    }),
    recoverTakeApprovalLifecycleTransition: vi.fn(async () => {
      throw new Error('Take approval lifecycle recovery is not part of this fixture')
    }),
    shotFindings: vi.fn(async (request: Parameters<QingmuYimengPort['shotFindings']>[0]) => ({
      schema: 'jason.qingmu-shot-finding-feed.v1', ...request, subject: null, snapshotSha256: null,
      availability: { status: 'unavailable', reason: 'selected_video_unavailable' },
      capabilities: { canRecordFinding: false }, items: [],
    } as const)),
    shotFindingMethod: vi.fn(async () => { throw new Error('Finding method is not part of this fixture') }),
    recordShotFinding: vi.fn(async () => { throw new Error('Finding record is not part of this fixture') }),
    recoverShotFinding: vi.fn(async () => { throw new Error('Finding recovery is not part of this fixture') }),
    reworkRouteSource: vi.fn(async () => { throw new Error('Rework route source is not part of this fixture') }),
    reworkRouteMethod: vi.fn(async () => { throw new Error('Rework route method is not part of this fixture') }),
    recordReworkRoute: vi.fn(async () => { throw new Error('Rework route record is not part of this fixture') }),
    recoverReworkRoute: vi.fn(async () => { throw new Error('Rework route recovery is not part of this fixture') }),
    probeReworkRouteAuthority: vi.fn(async () => { throw new Error('Rework route probe is not part of this fixture') }),
    productionUnits: vi.fn(async (request: Parameters<QingmuYimengPort['productionUnits']>[0]) => ({
      schema: 'jason.qingmu-production-unit-feed.v1', ...request,
      capabilities: { canBindUnit: false }, groups: [], bindings: [],
      planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false,
    } as const)),
    productionUnitMethod: vi.fn(async () => { throw new Error('Production-unit method is not part of this fixture') }),
    bindProductionUnit: vi.fn(async () => { throw new Error('Production-unit binding is not part of this fixture') }),
    recoverProductionUnitBinding: vi.fn(async () => { throw new Error('Production-unit recovery is not part of this fixture') }),
    proposeElementProfile: vi.fn(async () => { throw new Error('element proposal is not part of this fixture') }),
    proposeReferenceAsset: vi.fn(async () => { throw new Error('reference proposal is not part of this fixture') }),
    previewElementProfile: vi.fn(async () => { throw new Error('element preview is not part of this fixture') }),
    commitElementProfile: vi.fn(async () => { throw new Error('element commit is not part of this fixture') }),
    recoverElementProfileCommit: vi.fn(async () => { throw new Error('element recovery is not part of this fixture') }),
    createComment: vi.fn(async () => { throw new Error('comment is not part of this fixture') }),
    createHumanDecision: vi.fn(async () => { throw new Error('HumanDecision is not part of this fixture') }),
    createReferenceRightsExceptionRelease: vi.fn(async () => {
      throw new Error('reference-rights exception release is not part of this fixture')
    }),
    recoverReferenceRightsExceptionRelease: vi.fn(async () => {
      throw new Error('reference-rights exception recovery is not part of this fixture')
    }),
    proposeScript: vi.fn(async () => ({
      schema: 'jason.qingmu-change-set-proposal.v1',
      changeSet: CHANGE_SET,
      nextAction: 'preview',
    } as const)),
    previewScript: vi.fn(async () => PREVIEW),
    commitScript: vi.fn(async () => COMMIT),
    recoverScriptCommit: vi.fn(async () => RECOVERY),
    proposePromptIr: vi.fn(async () => { throw new Error('PromptIR proposal is not part of this fixture') }),
    previewPromptIr: vi.fn(async () => { throw new Error('PromptIR preview is not part of this fixture') }),
    commitPromptIrEdit: vi.fn(async () => { throw new Error('PromptIR edit commit is not part of this fixture') }),
    recoverPromptIrEditCommit: vi.fn(async () => { throw new Error('PromptIR edit recovery is not part of this fixture') }),
    selectPromptIr: vi.fn(async () => { throw new Error('PromptIR selection is not part of this fixture') }),
    recoverPromptIrSelection: vi.fn(async () => { throw new Error('PromptIR selection recovery is not part of this fixture') }),
    proposeStoryboardCanvas: vi.fn(async () => { throw new Error('storyboard canvas proposal is not part of this fixture') }),
    previewStoryboardCanvas: vi.fn(async () => { throw new Error('storyboard canvas preview is not part of this fixture') }),
    commitStoryboardCanvas: vi.fn(async () => { throw new Error('storyboard canvas commit is not part of this fixture') }),
    recoverStoryboardCanvasCommit: vi.fn(async () => { throw new Error('storyboard canvas recovery is not part of this fixture') }),
    ...overrides,
  }
}

function mount(port: QingmuYimengPort) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  return render(
    <QingmuCockpit wide port={port} t={t} useSessions={neverHook} useWorkspaces={neverHook} />,
    { container: root },
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('buildShotRelationMethodRequest', () => {
  it('preserves Yimeng frame numbers, rhythm, and exact current references without adding state', () => {
    const request = buildShotRelationMethodRequest(SHOT_RELATIONS, 'frame-2')

    expect(request.episodeRevision).toBe(3)
    expect(request.scenes).toEqual([
      {
        sceneId: 'scene-1',
        profileRevision: 2,
        snapshotSha256: '2'.repeat(64),
        elementIds: ['character-1', 'scene-1', 'prop-1'],
      },
      {
        sceneId: 'scene-2',
        profileRevision: 4,
        snapshotSha256: '3'.repeat(64),
        elementIds: ['character-1', 'scene-2'],
      },
    ])
    expect(request.elements).toEqual([
      {
        elementId: 'character-1', elementKind: 'actor', profileRevision: 2, snapshotSha256: '4'.repeat(64),
        currentReferenceAvailability: 'available', currentReference: SHOT_RELATIONS.shots[0].elements[0].currentReference,
      },
      {
        elementId: 'scene-1', elementKind: 'scene', profileRevision: 2, snapshotSha256: '2'.repeat(64),
        currentReferenceAvailability: 'missing', currentReference: null,
      },
      {
        elementId: 'prop-1', elementKind: 'prop', profileRevision: 1, snapshotSha256: '5'.repeat(64),
        currentReferenceAvailability: 'missing', currentReference: null,
      },
      {
        elementId: 'scene-2', elementKind: 'scene', profileRevision: 4, snapshotSha256: '3'.repeat(64),
        currentReferenceAvailability: 'missing', currentReference: null,
      },
    ])
    expect(request.shots).toEqual([
      {
        shotId: 'frame-1', sceneId: 'scene-1', frameNo: 1, durationSec: 2.5,
        dialogueRhythm: SHOT_RELATIONS.shots[0].dialogueRhythm,
        elementIds: ['character-1', 'scene-1', 'prop-1'],
        beats: [{ beatId: 'beat-1', elementIds: ['character-1', 'prop-1'] }],
      },
      {
        shotId: 'frame-2', sceneId: 'scene-2', frameNo: 2, durationSec: 1.5,
        dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] },
        elementIds: ['character-1', 'scene-2'],
        beats: [{ beatId: 'beat-2', elementIds: ['character-1'] }],
      },
    ])
  })

  it('keeps the Hero method on the E5-2 authority graph without the E5-3 read-only additions', () => {
    const request = buildHeroFrameRelationRequest(SHOT_RELATIONS, 'frame-2')
    expect(request.selectedShotId).toBe('frame-2')
    expect(request.shots[1]).toEqual({
      shotId: 'frame-2', sceneId: 'scene-2', elementIds: ['character-1', 'scene-2'],
      beats: [{ beatId: 'beat-2', elementIds: ['character-1'] }],
    })
    expect(request.elements[0]).toEqual({
      elementId: 'character-1', elementKind: 'actor', profileRevision: 2, snapshotSha256: '4'.repeat(64),
    })
    expect(request.scenes).toEqual(buildShotRelationMethodRequest(SHOT_RELATIONS, 'frame-2').scenes)
  })

  it('fails closed when one Element ID carries divergent Yimeng lineage across Shots', () => {
    const divergent = {
      ...SHOT_RELATIONS,
      shots: SHOT_RELATIONS.shots.map((shot, shotIndex) => ({
        ...shot,
        elements: shot.elements.map(element => (
          shotIndex === 1 && element.elementId === 'character-1'
            ? { ...element, profileRevision: 3, snapshotSha256: '6'.repeat(64) }
            : element
        )),
      })),
    } as YimengShotRelationsProjection

    expect(() => buildShotRelationMethodRequest(divergent, 'frame-2'))
      .toThrow('Element character-1 的权威血缘不一致')
  })

  it('fails closed when a repeated Element has a different current reference in another Shot', () => {
    const divergent: YimengShotRelationsProjection = {
      ...SHOT_RELATIONS,
      shots: SHOT_RELATIONS.shots.map((shot, index) => ({
        ...shot,
        elements: shot.elements.map(element => index === 1 && element.elementId === 'character-1'
          ? { ...element, currentReferenceAvailability: 'missing', currentReference: null }
          : element),
      })),
    }
    expect(() => buildShotRelationMethodRequest(divergent, 'frame-2'))
      .toThrow('Element character-1 的权威血缘不一致')
  })
})

describe('ShotRelationsView', () => {
  it('renders the Shot River by frameNo with scan-ready rhythm and reference status', () => {
    const onSelectShotId = vi.fn()
    const shotZ = { ...structuredClone(SHOT_RELATIONS.shots[0]), shotId: 'shot-z', frameNo: 7 }
    const shotB = { ...structuredClone(SHOT_RELATIONS.shots[1]), shotId: 'shot-b', frameNo: 12 }
    const relations = {
      ...structuredClone(SHOT_RELATIONS),
      shots: [shotB, shotZ],
    } as YimengShotRelationsProjection

    render(
      <ShotRelationsView
        relations={relations}
        selectedShotId="shot-z"
        onSelectShotId={onSelectShotId}
        t={t}
      />,
    )

    const river = screen.getByRole('list', { name: zh.shotRiver })
    const buttons = within(river).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([
      '07雨夜相遇shot-z2.5 秒1 句 · 1 已定时1/3 参考已绑定',
      '12走廊回望shot-b1.5 秒0 句 · 0 已定时1/2 参考已绑定',
    ])
    const selected = document.querySelector('[data-shot-id="shot-z"]')
    expect(selected).toBeTruthy()
    if (!(selected instanceof HTMLElement)) throw new Error('Shot-Z detail is missing')
    expect(within(selected).getByText('asset-character-1', { exact: false })).toBeTruthy()
    expect(within(selected).getByText('a'.repeat(64), { exact: false })).toBeTruthy()
    expect(within(selected).getByText('project-1 · episode-1 · actor:character-1')).toBeTruthy()
    expect(within(selected).getByText('identity_board', { exact: false })).toBeTruthy()
    expect(within(selected).getByText('job-character-1')).toBeTruthy()
    expect(within(selected).getByText('revision-character-1')).toBeTruthy()
    expect(within(selected).getByText('check-character-1')).toBeTruthy()

    fireEvent.click(buttons[1] as HTMLButtonElement)
    expect(onSelectShotId).toHaveBeenCalledOnce()
    expect(onSelectShotId).toHaveBeenCalledWith('shot-b')
  })
})

describe('QingmuCockpit journey', () => {
  it('opens the five-tab projection, states authority boundaries, and restores trigger focus on close', async () => {
    const workflow = vi.fn(async () => WORKFLOW)
    const port = makePort({ workflow })
    mount(port)
    const trigger = screen.getByRole('button', { name: zh.trigger })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: zh.title })
    await waitFor(() => {
      expect(workflow).toHaveBeenCalledWith(
        { projectId: 'project-1', episodeId: 'episode-1' },
        expect.any(AbortSignal),
      )
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByText(zh.truthBoundaryBody)).toBeTruthy()
    expect(within(dialog).getByText('jason.episode-workflow-projection.v1')).toBeTruthy()
    const projectSelect = within(dialog).getByRole('combobox', { name: zh.project })
    expect(projectSelect).toBeInstanceOf(HTMLSelectElement)
    if (!(projectSelect instanceof HTMLSelectElement)) throw new Error('project selector should be a select')
    expect(projectSelect.value).toBe('project-1')

    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual([
      zh.tabOverview,
      zh.tabDirector,
      zh.tabAssets,
      zh.tabShots,
      zh.tabGeneration,
      zh.tabDelivery,
    ])
    expect(within(dialog).getByRole('heading', { name: zh.stages })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    expect(within(dialog).getAllByText('林青').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getByText(zh.humanPending)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    expect(within(dialog).getByText('雨夜相遇')).toBeTruthy()
    expect(within(dialog).getAllByText('frame-1').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getAllByText('scene-1').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getByText('beat-1')).toBeTruthy()
    expect(within(dialog).getAllByText('character-1').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getAllByText('prop-1').length).toBeGreaterThanOrEqual(1)
    const method = await within(dialog).findByRole('region', { name: zh.shotRelationMethodTitle })
    expect(within(method).getByText('Scene / Shot / Beat / Element 关系检查')).toBeTruthy()
    expect(within(method).getByText('同一镜头身份')).toBeTruthy()
    expect(within(method).getByText('没有写入或执行')).toBeTruthy()
    expect(within(method).queryByText('hidden-agent')).toBeNull()
    expect(within(method).queryByText('hidden-skill')).toBeNull()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabGeneration }))
    expect(within(dialog).getByRole('heading', { name: zh.generationTitle })).toBeTruthy()
    expect(await within(dialog).findByRole('heading', { name: zh.gateAControlTitle })).toBeTruthy()
    expect(within(dialog).getByText(zh.gateAControlPassed)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabDelivery }))
    expect(within(dialog).getByText(zh.budgetDisclaimer)).toBeTruthy()
    expect(within(dialog).getByText(zh.releaseDisclaimer)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: zh.close }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: zh.title })).toBeNull() })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('shares one transient canonical Shot selection between relations and PromptIR', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const promptIr = vi.fn(async (request: Parameters<QingmuYimengPort['promptIr']>[0]) => promptIrRead(request.frameId))
    const relationMethod = vi.fn(async (request: Parameters<QingmuYimengPort['shotRelationMethod']>[0]) => shotRelationMethod(request))
    const port = makePort({
      workflow: vi.fn(async () => PROMPT_IR_WORKFLOW),
      promptIr,
      shotRelationMethod: relationMethod,
    })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /frame-2/ }))
    await waitFor(() => {
      expect(dialog.querySelector('[data-shot-id="frame-2"]')).toBeTruthy()
    })
    expect(within(dialog).getByText('beat-2')).toBeTruthy()
    await waitFor(() => {
      expect(relationMethod).toHaveBeenLastCalledWith(expect.objectContaining({
        episodeRevision: SHOT_RELATIONS.storyboardRevision.episodeRevision,
        storyboardRevisionId: SHOT_RELATIONS.storyboardRevision.revisionId,
        selectedShotId: 'frame-2',
        scenes: [
          {
            sceneId: 'scene-1',
            profileRevision: 2,
            snapshotSha256: '2'.repeat(64),
            elementIds: ['character-1', 'scene-1', 'prop-1'],
          },
          {
            sceneId: 'scene-2',
            profileRevision: 4,
            snapshotSha256: '3'.repeat(64),
            elementIds: ['character-1', 'scene-2'],
          },
        ],
        shots: [
          {
            shotId: 'frame-1',
            sceneId: 'scene-1',
            frameNo: 1,
            durationSec: 2.5,
            dialogueRhythm: SHOT_RELATIONS.shots[0].dialogueRhythm,
            elementIds: ['character-1', 'scene-1', 'prop-1'],
            beats: [{ beatId: 'beat-1', elementIds: ['character-1', 'prop-1'] }],
          },
          {
            shotId: 'frame-2',
            sceneId: 'scene-2',
            frameNo: 2,
            durationSec: 1.5,
            dialogueRhythm: SHOT_RELATIONS.shots[1].dialogueRhythm,
            elementIds: ['character-1', 'scene-2'],
            beats: [{ beatId: 'beat-2', elementIds: ['character-1'] }],
          },
        ],
        elements: [
          {
            elementId: 'character-1', elementKind: 'actor', profileRevision: 2, snapshotSha256: '4'.repeat(64),
            currentReferenceAvailability: 'available', currentReference: SHOT_RELATIONS.shots[0].elements[0].currentReference,
          },
          {
            elementId: 'scene-1', elementKind: 'scene', profileRevision: 2, snapshotSha256: '2'.repeat(64),
            currentReferenceAvailability: 'missing', currentReference: null,
          },
          {
            elementId: 'prop-1', elementKind: 'prop', profileRevision: 1, snapshotSha256: '5'.repeat(64),
            currentReferenceAvailability: 'missing', currentReference: null,
          },
          {
            elementId: 'scene-2', elementKind: 'scene', profileRevision: 4, snapshotSha256: '3'.repeat(64),
            currentReferenceAvailability: 'missing', currentReference: null,
          },
        ],
      }), expect.any(AbortSignal))
    })

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const selector = await within(dialog).findByRole('combobox', { name: zh.promptIrFrame })
    expect((selector as HTMLSelectElement).value).toBe('frame-2')
    await waitFor(() => {
      expect(promptIr).toHaveBeenCalledWith({
        projectId: 'project-1',
        episodeId: 'episode-1',
        storyboardRevisionId: SHOT_RELATIONS.storyboardRevision.revisionId,
        frameId: 'frame-2',
      }, expect.any(AbortSignal))
    })

    fireEvent.change(selector, { target: { value: 'frame-1' } })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    await waitFor(() => {
      expect(dialog.querySelector('[data-shot-id="frame-1"]')).toBeTruthy()
    })
    expect(storageWrite).not.toHaveBeenCalled()
  })

  it('fails closed when the IMAGO relation method claims a project-state write', async () => {
    const relationMethod = vi.fn(async (request: Parameters<QingmuYimengPort['shotRelationMethod']>[0]) => {
      const valid = shotRelationMethod(request)
      return {
        ...valid,
        projection: { ...valid.projection, project_state_persisted: true },
      } as unknown as Awaited<ReturnType<QingmuYimengPort['shotRelationMethod']>>
    })
    mount(makePort({ shotRelationMethod: relationMethod }))
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))

    const method = await within(dialog).findByRole('region', { name: zh.shotRelationMethodTitle })
    expect((await within(method).findByRole('alert')).textContent).toContain('零执行边界')
    expect(within(method).queryByText('Scene / Shot / Beat / Element 关系检查')).toBeNull()
  })

  it('requires both E5-3 read operations and never accepts a new write operation', async () => {
    const relationMethod = vi.fn(async (request: Parameters<QingmuYimengPort['shotRelationMethod']>[0]) => {
      const valid = shotRelationMethod(request)
      return {
        ...valid,
        projection: {
          ...valid.projection,
          work_order_projection: { ...valid.projection.work_order_projection, operations: ['reorderShots'] },
        },
      }
    })
    mount(makePort({ shotRelationMethod: relationMethod }))
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    const method = await within(dialog).findByRole('region', { name: zh.shotRelationMethodTitle })
    expect((await within(method).findByRole('alert')).textContent).toContain('工作单操作不匹配')
  })

  it.each(['duration', 'reference'] as const)('rejects stale E5-3 %s returned by the method', async (field) => {
    const relationMethod = vi.fn(async (request: Parameters<QingmuYimengPort['shotRelationMethod']>[0]) => {
      const valid = shotRelationMethod(request)
      const relationships = valid.projection.relationship_projection
      return {
        ...valid,
        projection: {
          ...valid.projection,
          relationship_projection: {
            ...relationships,
            ...(field === 'duration'
              ? { shots: relationships.shots.map((shot, index) => index === 0 ? { ...shot, durationSec: 9 } : shot) }
              : { elements: relationships.elements.map((element, index) => index === 0
                ? { ...element, currentReferenceAvailability: 'missing', currentReference: null } : element) }),
          },
        },
      } as unknown as Awaited<ReturnType<QingmuYimengPort['shotRelationMethod']>>
    })
    mount(makePort({ shotRelationMethod: relationMethod }))
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    const method = await within(dialog).findByRole('region', { name: zh.shotRelationMethodTitle })
    expect((await within(method).findByRole('alert')).textContent).toContain('与当前易梦关系快照不一致')
  })

  it('resets transient Shot selection on episode and project authority changes', async () => {
    const episodeTwo = workflowFor('project-1', 'episode-2', 'episode-2-frame-1', '第二集首镜')
    const projectTwo = workflowFor('project-2', 'episode-3', 'project-2-frame-1', '另一项目首镜')
    const projects = vi.fn(async () => ({
      items: [
        { id: 'project-1', name: '青木样片' },
        { id: 'project-2', name: '青木新片' },
      ],
      pagination: { page: 1, pageSize: 100, pages: 1, total: 2 },
    }))
    const episodes = vi.fn(async (request: Parameters<QingmuYimengPort['episodes']>[0]) => ({
      items: request.projectId === 'project-1'
        ? [
          { id: 'episode-1', projectId: 'project-1', episodeNumber: 1, name: '雨夜' },
          { id: 'episode-2', projectId: 'project-1', episodeNumber: 2, name: '追踪' },
        ]
        : [{ id: 'episode-3', projectId: 'project-2', episodeNumber: 1, name: '开场' }],
    }))
    const workflow = vi.fn(async (request: Parameters<QingmuYimengPort['workflow']>[0]) => {
      if (request.projectId === 'project-2') return projectTwo
      if (request.episodeId === 'episode-2') return episodeTwo
      return WORKFLOW
    })
    mount(makePort({ projects, episodes, workflow }))
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /frame-2/ }))
    await waitFor(() => { expect(dialog.querySelector('[data-shot-id="frame-2"]')).toBeTruthy() })

    fireEvent.change(within(dialog).getByRole('combobox', { name: zh.episode }), { target: { value: 'episode-2' } })
    await waitFor(() => {
      expect(dialog.querySelector('[data-shot-id="episode-2-frame-1"]')).toBeTruthy()
    })

    fireEvent.change(within(dialog).getByRole('combobox', { name: zh.project }), { target: { value: 'project-2' } })
    await waitFor(() => {
      expect(dialog.querySelector('[data-shot-id="project-2-frame-1"]')).toBeTruthy()
    })
    expect(dialog.querySelector('[data-shot-id="frame-2"]')).toBeNull()
  })

  it('shows Host-only token recovery when protected reads fail before projection', async () => {
    const projects = vi.fn(async () => {
      throw new Error('unauthorized: YIMENG_API_TOKEN is not configured in the Host environment')
    })
    const episodes = vi.fn(async () => ({ items: [] }))
    const workflow = vi.fn(async () => WORKFLOW)
    const port = makePort({ projects, episodes, workflow })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('YIMENG_API_TOKEN')
    expect(alert.textContent).toContain(zh.errorRecovery)
    expect(alert.textContent).toContain('qingmu-local.py login')
    expect(alert.textContent).toContain('此操作不重发命令')
    expect(alert.textContent).toContain('令牌不会进入浏览器')
    expect(episodes).not.toHaveBeenCalled()
    expect(workflow).not.toHaveBeenCalled()
  })

  it('keeps independent evidence reads available when the workflow projection is invalid', async () => {
    const evidenceLedger = vi.fn(async () => { throw new Error('isolated ledger failure') })
    mount(makePort({ workflow: vi.fn(async () => { throw new Error('storyboard_revision_missing') }), evidenceLedger }))
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    await screen.findByRole('alert')
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabGeneration }))
    const load = within(dialog).getByRole('button', { name: zh.evidenceLoad })
    expect(load.hasAttribute('disabled')).toBe(false)
    expect(evidenceLedger).not.toHaveBeenCalled()
    fireEvent.click(load)
    await waitFor(() => { expect(evidenceLedger).toHaveBeenCalledOnce() })
  })

  it('previews an immutable script ChangeSet and commits only after explicit confirmation', async () => {
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce({
        ...SCRIPT,
        script: AUTHORITATIVE_SCRIPT,
        scriptSha256: AUTHORITATIVE_SCRIPT_SHA256,
        revision: 4,
        updatedAt: COMMIT.committedAt,
      })
    const proposeScript = vi.fn(async () => ({
      schema: 'jason.qingmu-change-set-proposal.v1' as const,
      changeSet: CHANGE_SET,
      nextAction: 'preview' as const,
    }))
    const previewScript = vi.fn(async () => PREVIEW)
    const commitScript = vi.fn(async () => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
      return COMMIT
    })
    const workflow = vi.fn(async () => WORKFLOW)
    const port = makePort({ script, proposeScript, previewScript, commitScript, workflow })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    await waitFor(() => { expect(workflow).toHaveBeenCalledTimes(1) })

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    await waitFor(() => {
      expect(script).toHaveBeenCalledWith(
        { projectId: 'project-1', episodeId: 'episode-1' },
        expect.any(AbortSignal),
      )
    })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript, null, 2) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    await waitFor(() => {
      expect(proposeScript).toHaveBeenCalledWith({
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: PREVIEW.proposedScript,
        baseRevision: 3,
      }, expect.any(AbortSignal))
      expect(previewScript).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          episodeId: 'episode-1',
          changeSetId: CHANGE_SET.id,
          baseRevision: 3,
        },
        expect.any(AbortSignal),
      )
    })
    expect(await within(dialog).findByText('$.scenes[0].title')).toBeTruthy()

    const commitButton = within(dialog).getByRole('button', { name: zh.commitScript }) as HTMLButtonElement
    expect(commitButton.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: zh.commitConfirmLabel }))
    expect(commitButton.disabled).toBe(false)
    fireEvent.click(commitButton)

    await waitFor(() => {
      expect(commitScript).toHaveBeenCalledWith({
        projectId: 'project-1',
        episodeId: 'episode-1',
        changeSetId: CHANGE_SET.id,
        baseRevision: 3,
        idempotencyKey: `qingmu:${CHANGE_SET.id}:${CHANGE_SET.payloadSha256}`,
        expectedPayloadSha256: CHANGE_SET.payloadSha256,
      }, expect.any(AbortSignal))
    })
    expect(await within(dialog).findByRole('heading', { name: zh.commitSucceeded })).toBeTruthy()
    expect(within(dialog).getByText(COMMIT.commandReceiptId)).toBeTruthy()
    expect(within(dialog).getByText(COMMIT.eventId)).toBeTruthy()
    await waitFor(() => {
      expect(script).toHaveBeenCalledTimes(2)
      expect(workflow).toHaveBeenCalledTimes(2)
    })
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
  })

  it('fails closed when the preview reports an authority conflict', async () => {
    const conflict = {
      ...PREVIEW,
      authoritativeRevision: 4,
      revisionConflict: true,
      canCommit: false,
    }
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ previewScript: vi.fn(async () => conflict), commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    expect(await within(dialog).findByText(zh.conflictTitle)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('fails closed when the preview contains a different proposed script', async () => {
    const mismatchedPreview = {
      ...PREVIEW,
      proposedScript: { scenes: [{ title: '被错配的另一份剧本' }] },
    }
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ previewScript: vi.fn(async () => mismatchedPreview), commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('拟提交内容不一致')
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('fails closed when the preview belongs to a different episode subject', async () => {
    const mismatchedPreview = {
      ...PREVIEW,
      changeSet: {
        ...CHANGE_SET,
        episodeId: 'episode-2',
        targetId: 'episode-2',
      },
    }
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ previewScript: vi.fn(async () => mismatchedPreview), commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('预览血缘')
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('rejects a commit receipt whose base revision is not the confirmed preview base', async () => {
    const script = vi.fn(async () => SCRIPT)
    const commitScript = vi.fn(async () => ({ ...COMMIT, baseRevision: 2 }))
    const port = makePort({ script, commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    const commitButton = within(dialog).getByRole('button', { name: zh.commitScript })
    fireEvent.click(checkbox)
    fireEvent.click(commitButton)

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('提交回执与本次 ChangeSet 血缘不一致')
    expect(within(dialog).queryByRole('heading', { name: zh.commitSucceeded })).toBeNull()
    expect(within(dialog).getByRole('heading', { name: zh.receiptRecoveryTitle })).toBeTruthy()
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(script).toHaveBeenCalledOnce()
  })

  it('keeps the confirmed snapshot when the post-commit reread has a stale revision', async () => {
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce({ ...SCRIPT, revision: 5, updatedAt: COMMIT.committedAt })
    const port = makePort({ script })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    fireEvent.click(checkbox)
    fireEvent.click(within(dialog).getByRole('button', { name: zh.commitScript }))

    expect(await within(dialog).findByRole('heading', { name: zh.commitSucceeded })).toBeTruthy()
    expect(await within(dialog).findByText(/剧本版本与提交回执不一致/)).toBeTruthy()
    const revisionLabels = within(dialog).getAllByText(zh.scriptRevision)
    expect(revisionLabels[0]?.nextElementSibling?.textContent).toBe('3')
    expect(script).toHaveBeenCalledTimes(2)
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
  })

  it('retains a recovery marker and prevents commit resubmission after a commit response failure', async () => {
    const commitScript = vi.fn(async () => { throw new Error('isolated commit failure') })
    const port = makePort({ commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    const commitButton = within(dialog).getByRole('button', { name: zh.commitScript })
    if (!(checkbox instanceof HTMLInputElement) || !(commitButton instanceof HTMLButtonElement)) {
      throw new Error('commit controls should use native form elements')
    }
    fireEvent.click(checkbox)
    fireEvent.click(commitButton)

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('isolated commit failure')
    expect(within(dialog).getByRole('heading', { name: zh.receiptRecoveryTitle })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(commitScript).toHaveBeenCalledOnce()
  })

  it('does not submit when the recovery marker cannot be written and read back', async () => {
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))
    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    fireEvent.click(checkbox)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError')
    })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.commitScript }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(zh.receiptRecoveryStorageFailed)
    expect(commitScript).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('recovers an accepted commit after closing the modal without resubmitting it', async () => {
    let commitStarted = () => {}
    const started = new Promise<void>((resolve) => { commitStarted = resolve })
    const committedScript = {
      ...SCRIPT,
      script: AUTHORITATIVE_SCRIPT,
      scriptSha256: AUTHORITATIVE_SCRIPT_SHA256,
      revision: 4,
      updatedAt: COMMIT.committedAt,
    }
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce(committedScript)
      .mockResolvedValueOnce(committedScript)
    const commitScript = vi.fn<QingmuYimengPort['commitScript']>((_request, signal) => new Promise<typeof COMMIT>((_resolve, reject) => {
      commitStarted()
      signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    }))
    const recoverScriptCommit = vi.fn(async () => RECOVERY)
    const port = makePort({ script, commitScript, recoverScriptCommit })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    let dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel }))
    fireEvent.click(within(dialog).getByRole('button', { name: zh.commitScript }))
    await started
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')

    fireEvent.click(within(dialog).getByRole('button', { name: zh.close }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: zh.title })).toBeNull() })
    expect(commitScript).toHaveBeenCalledOnce()
    expect(recoverScriptCommit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const recoverButton = await within(dialog).findByRole('button', { name: zh.recoverReceipt })
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    fireEvent.click(recoverButton)

    expect(await within(dialog).findByRole('heading', { name: zh.receiptRecovered })).toBeTruthy()
    expect(committedScript.script.editMetadata.source).toBe('qingmu_change_set')
    expect(committedScript.script.durationScale).toBe(0.000001)
    expect(within(dialog).getByText(COMMIT.commandReceiptId)).toBeTruthy()
    expect(recoverScriptCommit).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    }, expect.any(AbortSignal))
    expect(commitScript).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
    })
  })

  it('retains a failed recovery until the user explicitly discards only the local marker', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const commitScript = vi.fn(async () => COMMIT)
    const recoverScriptCommit = vi.fn(async () => { throw new Error('receipt not found') })
    const port = makePort({ commitScript, recoverScriptCommit })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const recoverButton = await within(dialog).findByRole('button', { name: zh.recoverReceipt })
    fireEvent.click(recoverButton)

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('receipt not found')
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    const editor = within(dialog).getByRole('textbox', { name: zh.scriptDraftLabel })
    expect(editor).toBeInstanceOf(HTMLTextAreaElement)
    expect((editor as HTMLTextAreaElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: zh.discardRecoveryMarker }))
    await waitFor(() => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
    })
    expect((editor as HTMLTextAreaElement).disabled).toBe(false)
    expect(commitScript).not.toHaveBeenCalled()
    expect(recoverScriptCommit).toHaveBeenCalledOnce()
  })

  it('fails closed on recovered receipt lineage mismatch and retains the marker', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const recoverScriptCommit = vi.fn<QingmuYimengPort['recoverScriptCommit']>(async () => ({
      ...RECOVERY,
      receipt: { ...COMMIT, payloadSha256: 'f'.repeat(64) },
    }))
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ recoverScriptCommit, commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    fireEvent.click(await within(dialog).findByRole('button', { name: zh.recoverReceipt }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('提交回执与本次 ChangeSet 血缘不一致')
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('retains the marker when a recovered receipt revision matches but the authoritative script hash does not', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const wrongAuthoritativeScript = {
      ...SCRIPT,
      script: { scenes: [{ sceneIndex: 1, title: '同修订号但内容已被替换', dialogues: [] }] },
      scriptSha256: 'd'.repeat(64),
      revision: COMMIT.authoritativeRevision,
      updatedAt: COMMIT.committedAt,
    }
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce(wrongAuthoritativeScript)
    const recoverScriptCommit = vi.fn(async () => RECOVERY)
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ script, recoverScriptCommit, commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    fireEvent.click(await within(dialog).findByRole('button', { name: zh.recoverReceipt }))

    expect(await within(dialog).findByText(/权威剧本内容哈希与提交回执不一致/)).toBeTruthy()
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(commitScript).not.toHaveBeenCalled()
    expect(recoverScriptCommit).toHaveBeenCalledOnce()
  })

  it('allows explicit subject-scoped discard of an invalid marker without calling Yimeng', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const key = sessionStorage.key(0)
    if (key === null) throw new Error('recovery marker key should exist')
    sessionStorage.setItem(key, '{"schema":"tampered"}')
    const commitScript = vi.fn(async () => COMMIT)
    const recoverScriptCommit = vi.fn(async () => RECOVERY)
    const port = makePort({ commitScript, recoverScriptCommit })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    expect(await within(dialog).findByText(zh.receiptRecoveryInvalidTitle)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: zh.discardRecoveryMarker }))
    await waitFor(() => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
    })
    expect(commitScript).not.toHaveBeenCalled()
    expect(recoverScriptCommit).not.toHaveBeenCalled()
  })
})
