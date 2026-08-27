/** Synthetic UI-only evidence: no approval, task, or project lock is created. */
import type { ImagoContinuityMethodResponse, YimengWorkflowProjection } from '../../src/client/contracts.ts'
import { continuityFixture, continuityRelations } from '../../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'

/** Minimal workflow source used by the selected-Shot continuity component tests. */
export function continuitySource(): YimengWorkflowProjection {
  return {
    schema: 'jason.episode-workflow-projection.v1', projectId: 'project-e55', episodeId: 'episode-e55',
    inputFingerprint: 'same-fingerprint', sourceRevision: { storyboard: 4 },
    director: { shotRelations: continuityRelations(), continuityDelta: continuityFixture() },
  } as unknown as YimengWorkflowProjection
}

/** Renderable fake method response; real compiler/Host checks have their own integration tests. */
export function continuityResponse(source: YimengWorkflowProjection, selectedShotId: string): ImagoContinuityMethodResponse {
  const selected = source.director.shotRelations.shots.find(shot => shot.shotId === selectedShotId)
  if (selected === undefined) throw new Error('fixture selected Shot is missing')
  const delta = source.director.continuityDelta
  const incoming = delta?.pairs.find(pair => pair.toShotId === selectedShotId) ?? null
  const outgoing = delta?.pairs.find(pair => pair.fromShotId === selectedShotId) ?? null
  return {
    schema: 'qingmu.imago-continuity-method-adapter-result.v1',
    projection: {
      schema: 'qingmu.imago-continuity-method-projection.v1',
      subject: {
        projectId: source.projectId, episodeId: source.episodeId, selectedShotId,
        storyboardRevision: source.director.shotRelations.storyboardRevision,
      },
      selected_shot: { shotId: selected.shotId, frameNo: selected.frameNo },
      source_projection_sha256: '1'.repeat(64), source_revision_sha256: '2'.repeat(64), input_snapshot_sha256: '3'.repeat(64),
      continuity_snapshot_sha256: delta?.snapshotSha256 ?? null,
      rule_bindings: { 'pipeline/imago-os-current.json': '4'.repeat(64) }, rules_sha256: '5'.repeat(64),
      availability: delta === undefined ? { status: 'unavailable', reason: 'continuity_evidence_unavailable' }
        : { status: delta.availability, reason: delta.reason },
      adjacent_pairs: { incoming, outgoing },
      candidate_findings: [incoming, outgoing].flatMap(pair => pair === null ? []
        : pair.audit.dimensions.filter(item => item.result === false).map(item => ({
          from_shot_id: pair.fromShotId, to_shot_id: pair.toShotId, dimension: item.dimension, reason: item.reason,
          check_id: pair.audit.checkId, evidence_ref: pair.audit.evidenceRef,
          evidence_scope: pair.bindingStatus === 'different' ? 'historical' as const
            : pair.bindingStatus === 'current' && pair.currentBinding.tailFromSelectedVideo
              && pair.currentBinding.nextFirstFrameSelected && !pair.currentBinding.nextFirstFrameStale
              && !pair.currentBinding.staleHandoff ? 'current' as const : 'unavailable' as const,
          severity: null, earliest_owner: null, timecode: null, attribution: 'pending' as const, formal_finding: false as const,
        }))),
      lock_definitions: [{ id: 'SCRIPT_LOCK', producer_stage: 'A1S' }, { id: 'PRODUCTION_BLUEPRINT_LOCK', producer_stage: 'C5F' }],
      rework_propagation: [{ changed_lock: 'SCRIPT_LOCK', invalidates_from: 'B1', scope: 'all_downstream' }],
      lock_authority: { status: 'unavailable', reason: 'authoritative_lock_instances_unavailable', instances: [] },
      field_help: [{ field: 'currentBinding', label: '当前证据绑定', help: '保留当前与历史的区别', source_paths: ['pipeline/imago-os-current.json'] }],
      checklist: [{ id: 'real_media', label: '实际媒体需整片看听后由人裁决', source_paths: ['pipeline/imago-os-current.json'] }],
      work_order: {
        mode: 'read_only', allowed_actions: ['inspect_current_binding', 'inspect_historical_audit', 'review_candidate_findings', 'inspect_lock_definitions'],
        allowed_mutations: [], requires_human_attribution: true, provider_calls: 0,
        task_mutation: false, budget_mutation: false, human_signoff_inferred: false,
      },
      read_only: true, provider_calls: 0, task_mutation: false, budget_mutation: false, human_signoff_inferred: false,
      project_state_persisted: false, formal_activation_allowed: false,
    },
  }
}
