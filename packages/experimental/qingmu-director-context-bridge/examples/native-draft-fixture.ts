/** Keyless input examples: these are not user-project or Provider evidence. */
export const draftScope = { projectId: 'example-project', episodeId: 'example-episode', sceneId: 'example-scene', shotId: 'example-shot' }
export const draftContext = {
  schema: 'jason.qingmu-director-context-snapshot.v1', ...draftScope, contextSnapshotSha256: 'a'.repeat(64),
  storyboard: { id: 'revision-1', version: 1, status: 'Ready', sourceHash: 'b'.repeat(64) },
  shot: { id: draftScope.shotId, narrative: '门铃响起，她停在门口。' }, sourceScene: {}, selectedReferences: [],
  providerCalls: 0, costAmountCny: '0', businessStateChanged: false,
  humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false,
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
