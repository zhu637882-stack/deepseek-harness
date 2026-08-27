import { createHash, createHmac } from 'node:crypto'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function buildStoryboardCanvasFixture(attestationKey: string) {
  const projectId = 'project-1'
  const episodeId = 'episode-1'
  const storyboardRevisionId = 'storyboard-revision-7'
  const frameId = 'frame-1'
  const baseRevision = 7
  const baseSnapshotSha256 = '7'.repeat(64)
  const storyboardSourceSha256 = '8'.repeat(64)
  const relationSnapshotSha256 = '9'.repeat(64)
  const heroFrameAssetId = 'asset-hero-1'
  const heroFrameMediaSha256 = 'a'.repeat(64)
  const selectedShot = {
    shotId: frameId,
    sceneId: 'scene-1',
    elementIds: [],
    beats: [],
  }
  const selectedShotSnapshotSha256 = canonicalSha256(selectedShot)
  const target = {
    projectId,
    episodeId,
    episodeRevision: 3,
    storyboardRevisionId,
    storyboardRevisionVersion: baseRevision,
    storyboardSourceSha256,
    relationSnapshotSha256,
    selectedShotId: frameId,
    selectedShotSnapshotSha256,
  }
  const methodHeroFrameBindingSha256 = canonicalSha256({
    schema: 'jason.qingmu-hero-frame-binding.v1',
    projectId,
    episodeId,
    episodeRevision: target.episodeRevision,
    storyboardRevisionId,
    storyboardRevisionVersion: baseRevision,
    storyboardSourceSha256,
    relationSnapshotSha256,
    selectedShotId: frameId,
    selectedShotSnapshotSha256,
    assetId: heroFrameAssetId,
    mediaSha256: heroFrameMediaSha256,
  })
  const heroFrameBindingSha256 = canonicalSha256({
    assetId: heroFrameAssetId,
    mediaSha256: heroFrameMediaSha256,
    shotId: frameId,
  })
  const annotations = [{
    id: 'subject-1',
    kind: 'subject_region',
    entityType: 'actor',
    entityId: 'actor-1',
    geometry: { x: 1200, y: 900, width: 2600, height: 6200 },
  }]
  const methodRawAnnotationsSha256 = canonicalSha256({
    schema: 'jason.qingmu-storyboard-raw-annotations.v1',
    projectId,
    episodeId,
    storyboardRevisionId,
    storyboardRevisionVersion: baseRevision,
    selectedShotId: frameId,
    selectedShotSnapshotSha256,
    heroFrameBindingSha256: methodHeroFrameBindingSha256,
    annotations,
  })
  const compiled = {
    subjectLayout: [{
      annotationId: 'subject-1',
      entityType: 'actor',
      entityId: 'actor-1',
      x: 1200,
      y: 900,
      width: 2600,
      height: 6200,
    }],
    objectAnchors: [],
    actionTrajectory: [],
  }
  const compiledSha256 = canonicalSha256(compiled)
  const methodProjection = {
    schema: 'qingmu.imago-hero-frame-storyboard-method-projection.v1',
    input_snapshot_sha256: 'b'.repeat(64),
    target,
    canvas_projection: {
      canonicalShotIdSource: 'yimeng_storyboard_frame_id',
      shotId: frameId,
      selectedShot,
      heroFrame: {
        assetId: heroFrameAssetId,
        mediaSha256: heroFrameMediaSha256,
        bindingSha256: methodHeroFrameBindingSha256,
      },
      baseCanvasSha256: null,
      rawAnnotations: annotations,
      rawAnnotationsSha256: methodRawAnnotationsSha256,
      compiledResult: compiled,
      compiledResultSha256: compiledSha256,
    },
    method_definition: {
      id: 'imago-v6-c-c5-hero-frame-storyboard-canvas',
      version: 1,
      sha256: 'c'.repeat(64),
      stage_contract_sha256: 'd'.repeat(64),
      role_capability_sha256: 'e'.repeat(64),
      agent_paths: [],
      skill_paths: [],
    },
    source_bindings: [],
    field_hints: [],
    checklist: [],
    work_order_projection: {
      target,
      operation: 'compileHeroFrameStoryboardCanvas',
      allowed_mutations: ['replaceStoryboardCanvas'],
      required_read_set: [],
      before_compile: [],
      after_compile: [],
      providerCalls: 0,
      workerStarted: false,
    },
    review_card: {},
    legal_work_set: {
      reads: ['yimeng_hero_frame_storyboard_canvas_snapshot'],
      writes: ['replace_storyboard_canvas_via_changeset'],
      forbidden: [
        'direct_project_state_write',
        'direct_database_write',
        'second_shot_identity_create',
        'imago_canvas_state_persist',
        'provider_dispatch',
        'asset_generation',
        'asset_selection',
        'human_approval',
        'human_signoff',
      ],
    },
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    providerCalls: 0,
    workerStarted: false,
    selection_executed: false,
    human_approval_inferred: false,
    human_signoff_inferred: false,
  }
  const methodProjectionSha256 = canonicalSha256(methodProjection)
  const unsignedAttestation = {
    schema: 'qingmu.imago-hero-frame-storyboard-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: methodProjectionSha256,
    inputSnapshotSha256: methodProjection.input_snapshot_sha256,
    targetSha256: canonicalSha256(target),
    relationSnapshotSha256,
    selectedShotSha256: selectedShotSnapshotSha256,
    heroFrameBindingSha256: methodHeroFrameBindingSha256,
    rawAnnotationsSha256: methodRawAnnotationsSha256,
    compiledResultSha256: compiledSha256,
  }
  const methodAttestation = {
    ...unsignedAttestation,
    signature: createHmac('sha256', attestationKey)
      .update(canonicalJson(unsignedAttestation), 'utf8')
      .digest('hex'),
  }
  const changeSetId = 'changeset-canvas-1'
  const payloadSha256 = '4'.repeat(64)
  const changeSet = {
    schema: 'jason.qingmu-change-set.v1',
    id: changeSetId,
    workspaceId: null,
    projectId,
    episodeId,
    targetType: 'storyboard_frame',
    targetId: frameId,
    baseRevision,
    baseSnapshotSha256,
    payloadSha256,
    originKind: 'human',
    actorUserId: 'user-1',
    harnessSessionId: 'harness-session-1',
    status: 'draft',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-27T08:00:00Z',
    updatedAt: '2026-08-27T08:00:00Z',
  }
  const heroFrame = {
    assetId: heroFrameAssetId,
    mediaSha256: heroFrameMediaSha256,
    bindingSha256: heroFrameBindingSha256,
  }
  const canvas = {
    schema: 'jason.qingmu-storyboard-canvas.v1',
    heroFrameBindingSha256,
    annotations,
    rawAnnotationsSha256: canonicalSha256(annotations),
    compiled,
    compiledSha256,
  }
  const storyboardRevision = {
    revisionId: storyboardRevisionId,
    revisionVersion: baseRevision,
    sourceSha256: storyboardSourceSha256,
  }
  const changedPaths = [
    '$.directorPlan.storyboardCanvas',
    '$.directorPlan.subjectLayout',
    '$.directorPlan.objectAnchors',
    '$.directorPlan.actionTrajectory',
    '$.visualAtoms.storyboardCanvas',
    '$.visualAtoms.subjectLayout',
    '$.visualAtoms.objectAnchors',
    '$.visualAtoms.actionTrajectory',
  ]
  const proposal = {
    schema: 'jason.qingmu-storyboard-canvas-change-set-proposal.v1',
    changeSet,
    nextAction: 'preview',
  }
  const preview = {
    schema: 'jason.qingmu-storyboard-canvas-preview.v1',
    changeSetId,
    projectId,
    episodeId,
    targetType: 'storyboard_frame',
    targetId: frameId,
    operation: 'replaceStoryboardCanvas',
    storyboardRevision,
    baseRevision,
    baseSnapshotSha256,
    payloadSha256,
    heroFrame,
    methodHeroFrameBindingSha256,
    before: null,
    after: canvas,
    changedPaths,
    providerCalls: 0,
    workerStarted: false,
    selectionExecuted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  }
  const authoritativeRevision = {
    revisionId: 'storyboard-revision-8',
    revisionVersion: 8,
    sourceSha256: 'f'.repeat(64),
  }
  const commit = {
    schema: 'jason.qingmu-storyboard-canvas-commit-result.v1',
    changeSetId,
    commandReceiptId: 'receipt-canvas-1',
    eventId: 'event-canvas-1',
    eventType: 'StoryboardCanvasReplaced',
    projectId,
    episodeId,
    targetType: 'storyboard_frame',
    targetId: frameId,
    operation: 'replaceStoryboardCanvas',
    storyboardRevision: { base: storyboardRevision, authoritative: authoritativeRevision },
    baseRevision,
    authoritativeRevision: authoritativeRevision.revisionVersion,
    authoritativeSnapshotSha256: '1'.repeat(64),
    heroFrame,
    methodHeroFrameBindingSha256,
    rawAnnotationsSha256: canvas.rawAnnotationsSha256,
    methodRawAnnotationsSha256,
    compiledSha256,
    payloadSha256,
    idempotencyKey: 'qingmu-canvas-1',
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    selectionExecuted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T08:01:00Z',
  }
  const proposeRequest = {
    projectId,
    episodeId,
    storyboardRevisionId,
    frameId,
    operation: 'replaceStoryboardCanvas',
    baseRevision,
    baseSnapshotSha256,
    heroFrameAssetId,
    heroFrameMediaSha256,
    heroFrameBindingSha256,
    methodProjection,
    methodProjectionSha256,
    methodAttestation,
    harnessSessionId: 'harness-session-1',
  }
  const previewRequest = {
    projectId,
    episodeId,
    storyboardRevisionId,
    frameId,
    targetType: 'storyboard_frame',
    targetId: frameId,
    changeSetId,
    baseRevision,
    baseSnapshotSha256,
  }
  const commitRequest = {
    ...previewRequest,
    idempotencyKey: commit.idempotencyKey,
    expectedPayloadSha256: payloadSha256,
  }
  return {
    methodHeroFrameBindingSha256,
    methodProjection,
    methodProjectionSha256,
    methodAttestation,
    proposal,
    preview,
    commit,
    recovery: {
      schema: 'jason.qingmu-command-receipt-recovery.v1',
      recovered: true,
      receiptSha256: canonicalSha256(commit),
      receipt: commit,
    },
    proposeRequest,
    previewRequest,
    commitRequest,
  }
}
