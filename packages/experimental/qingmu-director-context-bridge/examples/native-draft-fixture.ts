/** Keyless input examples: these are not user-project or Provider evidence. */
export const draftScope = { projectId: 'example-project', episodeId: 'example-episode', sceneId: 'example-scene', shotId: 'example-shot' }
export const draftContext = {
  schema: 'jason.qingmu-director-context-snapshot.v1' as const, ...draftScope, contextSnapshotSha256: 'a'.repeat(64),
  script: { revision: 1, sha256: '0'.repeat(64) }, sceneSource: {}, sourceTime: '2026-09-07T00:00:00Z',
  storyboard: { id: 'revision-1', version: 1, status: 'Ready' as const, sourceHash: 'b'.repeat(64) },
  shot: { id: draftScope.shotId, title: '门口停顿', narrative: '门铃响起，她停在门口。', visual: '门在画面左侧。',
    action: '她停住并听铃声。', durationSec: 4, dialogueLineIds: [] }, sourceScene: {}, creativeContract: null, selectedReferences: [],
  episodeScenes: [{ sceneIndex: 1, title: '门口', current: true }],
  cast: [{ actorId: 'example-actor', name: '小雨', identity: '短发' }],
  adjacentShots: { previous: null, next: { id: 'example-shot-2', title: '反应', action: '停顿' } },
  providerCalls: 0 as const, costAmountCny: '0' as const, businessStateChanged: false as const,
  humanDecisionInferred: false as const, formalQcInferred: false as const, selectionGranted: false as const, readyGranted: false as const,
}
export const draftPrompt = {
  schema: 'jason.qingmu-prompt-ir-subject-read.v1', baseRevision: 1, baseSnapshotSha256: 'c'.repeat(64), draft: null,
  subject: { schema: 'jason.qingmu-prompt-ir-subject.v1', projectId: draftScope.projectId, episodeId: draftScope.episodeId,
    targetType: 'prompt_ir', targetId: 'prompt-1', storyboardRevisionId: 'revision-1', frameId: draftScope.shotId,
    promptIrId: 'prompt-1', promptIrVersion: 1, promptIrContentSha256: 'd'.repeat(64), status: 'Ready',
    editableProjection: { imageGenPrompt: '她站在门口。', lastFrameImagePrompt: '', videoGenPrompt: '门铃响起，她停住。',
      motionPrompt: '停步', negativePrompt: '不要增加人物' } },
}
export function draftMethod(resourceId: 'rough_final_feedback' | null = null) {
  const id = resourceId ?? 'skill'
  const source = { resourceId: id, path: `example/${id}.md`, kind: 'skill', sha256: 'e'.repeat(64), byteLength: 120,
    content: resourceId ? '逐镜比对锁定意图、表演、空间关系、声画线索和连续性。' : '从场景意图确定机位、遮挡与表演，先界定首帧的开始状态。' }
  const { content: _content, ...binding } = source
  return { schema: 'qingmu.imago-director-instructions.v1', capability: 'shot_design', requestedResourceId: resourceId,
    sources: [source], sourceBindings: [binding], packageSha256: 'f'.repeat(64), packagePath: 'example',
    additionalReferences: resourceId ? [] : [{ resourceId: 'rough_final_feedback', required: true, path: 'example/feedback.md' }],
    methodScope: 'keyless example', maxResourceBytes: 131072, maxPackageBytes: 524288,
    authority: { readOnly: true, businessTruth: 'yimeng', methodSource: 'imago_os', providerCalls: 0,
      maximumCostCny: '0', approvalGranted: false, humanDecisionInferred: false, formalQcInferred: false, projectStateWrite: false } }
}
/** Empty first-prompt state served by the keyless Writer stand-in. */
export const firstDraftBootstrap = {
  schema: 'jason.qingmu-prompt-ir-bootstrap-state.v1',
  context: { projectId: 'example-project', episodeId: 'example-episode',
    storyboard: { id: 'revision-1' }, frame: { id: 'example-shot' } },
  contextSnapshotSha256: 'c'.repeat(64), referenceNames: [], draft: null, ready: null,
  draftMethodSha256: null, selectionChallenge: null, providerCalls: 0, workerStarted: false,
  humanApprovalInferred: false, humanSignoff: false, selectionExecuted: false,
} as const
