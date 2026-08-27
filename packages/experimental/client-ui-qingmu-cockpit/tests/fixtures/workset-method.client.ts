import type { ImagoWorksetMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'

/** Small display fixture only; it is not an authoritative Yimeng stage snapshot. */
export function unavailableWorksetResponse(projectId = 'project-1', episodeId = 'episode-1'): ImagoWorksetMethodResponse {
  return {
    schema: 'qingmu.imago-workset-method-adapter-result.v1',
    projection: {
      schema: 'qingmu.imago-workset.v2',
      subject: {
        project_id: projectId,
        episode_id: episodeId,
        source_revision_sha256: '1'.repeat(64),
        input_fingerprint: 'fingerprint-1',
        projection_schema: 'jason.episode-workflow-projection.v1',
      },
      source_projection_sha256: '2'.repeat(64),
      input_snapshot_sha256: '3'.repeat(64),
      rule_bindings: { 'display-test-only-rule.json': '4'.repeat(64) },
      rules_sha256: '5'.repeat(64),
      stage_definitions: [
        {
          stage_id: 'A0', stage_name: '资料确认', scope: 'global', owner_role: 'A0',
          source_stage_ids: [], required_lock_ids: [], produces_lock_id: null,
          contract_order: 0, contract_sha256: '6'.repeat(64),
        },
        {
          stage_id: 'F', stage_name: '视频任务', scope: 'per_lsu', owner_role: 'F',
          source_stage_ids: ['E'], required_lock_ids: [], produces_lock_id: null,
          contract_order: 21, contract_sha256: '7'.repeat(64),
        },
      ],
      work_items: [], legal_work_items: [], recommended_order: [], recommended_item: null,
      availability: {
        status: 'unavailable', authority_snapshot: 'unavailable', global_scope: 'unavailable',
        per_lsu_scope: 'unavailable', reason: 'authoritative_stage_evidence_unavailable',
      },
      blockers: [{ code: 'AUTHORITATIVE_STAGE_EVIDENCE_UNAVAILABLE', stage_id: null, scope_instance: null, lock_id: null }],
      shadow_comparison: {
        status: 'unavailable', reason: 'authoritative_stage_evidence_unavailable',
        comparison_scope: 'dependency_and_lock_readiness_only', activation_allowed: false,
        execution_equivalence_claimed: false, comparisons: [],
      },
      project_state_persisted: false, paid_provider_authority: 'not_granted', human_approval_inferred: false,
      authority_snapshot_attestation: 'not_verified_by_compiler', formal_activation_allowed: false,
    },
  }
}
