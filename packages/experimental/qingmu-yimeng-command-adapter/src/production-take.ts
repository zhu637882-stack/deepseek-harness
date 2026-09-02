/** Host-owned E1-C bridge from browser intent to the strict Writer production-Take contract. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  YimengCommandJsonObject,
  YimengProductionTakeMethodEvidence,
  YimengProductionTakeReceipt,
  YimengProductionTakeResult,
  YimengQueueProductionTakeIntent,
} from './types.ts'

const INTENT_FIELDS = [
  'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'takeKind', 'takeOrdinal', 'confirmReady',
  'firstFrameSelectionReceiptSha256', 'selectedFirstFrameAssetId', 'selectedFirstFrameMaterializedSha256',
  'videoPreflightSha256', 'videoQuoteProjectionSha256', 'maximumReservationCny', 'candidateCount', 'maxAttempts',
  'selectAsOfficial', 'paidConfirmed', 'paidConfirmationText',
] as const
const EDITABLE_FIELDS = [
  'imageGenPrompt', 'lastFrameImagePrompt', 'videoGenPrompt', 'motionPrompt', 'negativePrompt',
] as const
const EXPECTED_STAGES = {
  imageGenPrompt: ['D'],
  lastFrameImagePrompt: ['D'],
  videoGenPrompt: ['E'],
  motionPrompt: ['E'],
  negativePrompt: ['D', 'E'],
} as const
const EXPECTED_CARDS = {
  D: 'assets/keyframe-prompt-template.md',
  E: 'assets/video-prompt-template.md',
} as const
const PROMPT_IR_SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
  'pipeline/v6-video-generation-routing-policy.json',
  'agents/e-image-to-video/AGENTS.md',
  'skill-package/imago-e-kling-lsu-compiler/SKILL.md',
] as const
const PROMPT_IR_SOURCE_KINDS = [
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'prompt_ir_policy',
  'role_agent',
  'role_method',
] as const
const PROMPT_IR_FIELD_HINTS = {
  imageGenPrompt: ['首帧图像提示词', '应用 D 阶段关键帧方法卡。'],
  lastFrameImagePrompt: ['尾帧图像提示词', '应用 D 阶段关键帧方法卡。'],
  videoGenPrompt: ['视频生成提示词', '应用 E 阶段视频提示词方法卡。'],
  motionPrompt: ['运动提示词', '应用 E 阶段视频提示词方法卡。'],
  negativePrompt: ['共享负面提示词', '同时应用 D 与 E 阶段方法卡。'],
} as const
const METHOD_DEFINITION_FIELDS = [
  'id', 'version', 'sha256', 'stage_contract_sha256', 'role_capability_sha256', 'prompt_ir_schema',
  'field_mapping', 'agent_path', 'skill_path',
] as const
const FIELD_MAPPING_FIELDS = ['schema', 'version', 'fields', 'sha256'] as const
const FIELD_MAPPING_ENTRY_FIELDS = [
  'field', 'stage_ids', 'stage_contract_bindings', 'method_sha256', 'card_bindings',
] as const
const FIELD_HINT_FIELDS = [
  'hint_id', 'field', 'title', 'guidance', 'mapping_sha256', 'stage_ids', 'card_sha256s',
] as const
const DIRECTOR_CARD_FIELDS = [
  'kind', 'stage_id', 'repo_id', 'repository_commit', 'path', 'sha256', 'provenance_sha256',
] as const
const WORK_ORDER_FIELDS = [
  'target', 'operation', 'allowed_mutations', 'editable_fields', 'required_read_set', 'before_compile',
  'after_compile', 'providerCalls', 'workerStarted', 'maximumCostCny',
] as const
const METHOD_RESULT_FIELDS = ['schema', 'projectionSha256', 'projection', 'methodAttestation'] as const
const METHOD_PROJECTION_FIELDS = [
  'schema', 'input_snapshot_sha256', 'target', 'normalized_candidate', 'candidate_sha256',
  'changed_paths', 'blockers', 'warnings', 'method_definition', 'source_bindings', 'field_hints',
  'checklist', 'work_order_projection', 'authority_snapshot_attestation', 'project_state_persisted',
  'providerCalls', 'workerStarted', 'maximumCostCny', 'selection_executed',
  'human_approval_inferred', 'human_signoff_inferred',
] as const
const METHOD_ATTESTATION_FIELDS = [
  'schema', 'algorithm', 'projectionSha256', 'inputSnapshotSha256', 'targetSha256',
  'baseEditableProjectionSha256', 'candidateEditableProjectionSha256', 'candidateSha256', 'signature',
] as const
const RECEIPT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'sceneId', 'shotId', 'storyboardRevisionId', 'promptIr',
  'authoritySnapshotSha256', 'firstFrameQuoteProjectionSha256', 'firstFrameSelectionReceiptSha256',
  'selectedFirstFrameAssetId', 'selectedFirstFrameMaterializedSha256', 'videoPreflightSha256',
  'videoQuoteProjectionSha256', 'maximumReservationCny', 'candidateCount', 'maxAttempts', 'selectAsOfficial',
  'paidConfirmed', 'paidConfirmationTextSha256', 'referenceBindings', 'takeKind',
  'takeOrdinal', 'takeLimit', 'taskId', 'taskStatus', 'requestIdempotencyKey', 'idempotencyKey',
  'deduplicated', 'recovered', 'queued',
] as const
const REFERENCE_FIELDS = [
  'elementKind', 'elementId', 'assetId', 'assetSha256', 'materializedSha256', 'selectionIdentity',
  'sourceRevisionId', 'referencePackSha256',
] as const
const SHA256 = /^[a-f0-9]{64}$/u
const GIT_OID = /^[a-f0-9]{40}$/u

type ErrorFactory = (message: string) => Error
type EditableField = typeof EDITABLE_FIELDS[number]

/** Host-provided canonicalization, error, and attestation primitives for E1-C. */
export interface ProductionTakeHelpers {
  readonly canonicalJson: (value: unknown, field: string) => string
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly readAttestationKey: () => string
}

/** Current-authority reads and E1-B method execution required by the bridge. */
export interface ProductionTakeDependencies {
  readonly readYimeng: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>
  readonly runPromptIrMethod: (payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>
}

/** Strict Writer request plus the receipt validator bound to its current authority. */
export interface PreparedProductionTakeCommand {
  readonly path: string
  readonly body: YimengCommandJsonObject
  readonly idempotencyKey: string
  readonly normalize: (value: unknown) => YimengProductionTakeResult
}

function object(value: unknown, field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw error(`${field} must be an object`)
  return value as YimengCommandJsonObject
}

function exact(value: unknown, fields: readonly string[], field: string, error: ErrorFactory): YimengCommandJsonObject {
  const item = object(value, field, error)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...fields].sort())) throw error(`${field} has invalid fields`)
  return item
}

function text(value: unknown, field: string, error: ErrorFactory, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value !== value.trim()
    || value.includes('\u0000') || /[\r\n]/u.test(value)) throw error(`${field} must be canonical text`)
  return value
}

function promptText(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length > 100_000 || value !== value.trim()
    || value.includes('\u0000') || /[\r\n]/u.test(value)) throw error(`${field} must be canonical prompt text`)
  return value
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw error(`${field} must be sha256`)
  return value
}

function gitOid(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !GIT_OID.test(value)) throw error(`${field} must be a full git commit`)
  return value
}

function digest(value: unknown, helpers: ProductionTakeHelpers, field: string): string {
  return createHash('sha256').update(helpers.canonicalJson(value, field), 'utf8').digest('hex')
}

function methodCandidate(promptIr: ReturnType<typeof currentPromptIr>) {
  return { videoGenPrompt: promptIr.editableProjection.videoGenPrompt }
}

function boolean(value: unknown, field: string, error: ErrorFactory): boolean {
  if (typeof value !== 'boolean') throw error(`${field} must be boolean`)
  return value
}

function nonEmptyTextArray(value: unknown, field: string, helpers: ProductionTakeHelpers): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  value.forEach((item, index) => {
    text(item, `${field}[${String(index)}]`, helpers.responseError, 1_000)
  })
  return true
}

/**
 * Parse the complete browser intent. It contains no authority, readiness, Provider, or routing fields.
 * @param value - Untrusted browser payload.
 * @param helpers - Host validation and error factories.
 * @returns The exact seven-field Production Take intent.
 */
export function parseQueueProductionTakeIntent(
  value: unknown,
  helpers: ProductionTakeHelpers,
): YimengQueueProductionTakeIntent {
  const item = exact(value, INTENT_FIELDS, 'productionTakeIntent', helpers.inputError)
  const takeOrdinal = item.takeOrdinal
  if (takeOrdinal !== 1 && takeOrdinal !== 2 && takeOrdinal !== 3) {
    throw helpers.inputError('productionTakeIntent.takeOrdinal must be 1, 2, or 3')
  }
  const takeKind = item.takeKind
  if ((takeOrdinal === 1 && takeKind !== 'initial')
    || (takeOrdinal !== 1 && takeKind !== 'targeted_rework')) {
    throw helpers.inputError('productionTakeIntent Take kind and ordinal mismatch')
  }
  if (item.confirmReady !== true) {
    throw helpers.inputError('productionTakeIntent.confirmReady must be true')
  }
  if (item.candidateCount !== 1 || item.maxAttempts !== 1 || item.selectAsOfficial !== false || item.paidConfirmed !== true
    || typeof item.maximumReservationCny !== 'number' || !Number.isFinite(item.maximumReservationCny)
    || item.maximumReservationCny < 0 || item.maximumReservationCny > 1_000) {
    throw helpers.inputError('productionTakeIntent video quote confirmation invalid')
  }
  return {
    projectId: text(item.projectId, 'productionTakeIntent.projectId', helpers.inputError),
    episodeId: text(item.episodeId, 'productionTakeIntent.episodeId', helpers.inputError),
    storyboardRevisionId: text(
      item.storyboardRevisionId, 'productionTakeIntent.storyboardRevisionId', helpers.inputError,
    ),
    frameId: text(item.frameId, 'productionTakeIntent.frameId', helpers.inputError),
    takeKind: takeKind as 'initial' | 'targeted_rework',
    takeOrdinal,
    confirmReady: true,
    firstFrameSelectionReceiptSha256: sha(item.firstFrameSelectionReceiptSha256, 'productionTakeIntent.selectionReceipt', helpers.inputError),
    selectedFirstFrameAssetId: text(item.selectedFirstFrameAssetId, 'productionTakeIntent.selectedFirstFrameAssetId', helpers.inputError),
    selectedFirstFrameMaterializedSha256: sha(item.selectedFirstFrameMaterializedSha256, 'productionTakeIntent.selectedFirstFrameMaterializedSha256', helpers.inputError),
    videoPreflightSha256: sha(item.videoPreflightSha256, 'productionTakeIntent.videoPreflightSha256', helpers.inputError),
    videoQuoteProjectionSha256: sha(item.videoQuoteProjectionSha256, 'productionTakeIntent.videoQuoteProjectionSha256', helpers.inputError),
    maximumReservationCny: item.maximumReservationCny, candidateCount: 1, maxAttempts: 1, selectAsOfficial: false,
    paidConfirmed: true, paidConfirmationText: text(item.paidConfirmationText, 'productionTakeIntent.paidConfirmationText', helpers.inputError, 256),
  }
}

function currentPromptIr(value: unknown, intent: YimengQueueProductionTakeIntent, helpers: ProductionTakeHelpers) {
  const root = object(value, 'currentPromptIr', helpers.responseError)
  const subject = object(root.subject, 'currentPromptIr.subject', helpers.responseError)
  const projection = exact(
    subject.editableProjection, EDITABLE_FIELDS, 'currentPromptIr.subject.editableProjection', helpers.responseError,
  )
  if (root.schema !== 'jason.qingmu-prompt-ir-subject-read.v1'
    || subject.schema !== 'jason.qingmu-prompt-ir-subject.v1' || subject.targetType !== 'prompt_ir'
    || subject.status !== 'Ready' || subject.projectId !== intent.projectId || subject.episodeId !== intent.episodeId
    || subject.storyboardRevisionId !== intent.storyboardRevisionId || subject.frameId !== intent.frameId) {
    throw helpers.responseError('current Ready PromptIR scope mismatch')
  }
  const baseVersion = subject.promptIrVersion
  if (!Number.isSafeInteger(baseVersion) || (baseVersion as number) < 1 || root.baseRevision !== baseVersion) {
    throw helpers.responseError('current Ready PromptIR version mismatch')
  }
  const normalized = Object.fromEntries(EDITABLE_FIELDS.map(field => [
    field, promptText(projection[field], `currentPromptIr.${field}`, helpers.responseError),
  ])) as Record<EditableField, string>
  return {
    id: text(subject.promptIrId, 'currentPromptIr.promptIrId', helpers.responseError),
    version: baseVersion as number,
    contentSha256: sha(subject.promptIrContentSha256, 'currentPromptIr.contentSha256', helpers.responseError),
    snapshotSha256: sha(root.baseSnapshotSha256, 'currentPromptIr.baseSnapshotSha256', helpers.responseError),
    editableProjection: normalized,
  }
}

function verifyMethod(
  value: unknown,
  intent: YimengQueueProductionTakeIntent,
  promptIr: ReturnType<typeof currentPromptIr>,
  helpers: ProductionTakeHelpers,
): YimengProductionTakeMethodEvidence {
  const root = exact(value, METHOD_RESULT_FIELDS, 'currentPromptIrMethod', helpers.responseError)
  if (root.schema !== 'qingmu.imago-prompt-ir-method-adapter-result.v1') {
    throw helpers.responseError('current PromptIR Method schema mismatch')
  }
  const projection = exact(root.projection, METHOD_PROJECTION_FIELDS, 'currentPromptIrMethod.projection', helpers.responseError)
  const projectionSha256 = sha(root.projectionSha256, 'currentPromptIrMethod.projectionSha256', helpers.responseError)
  if (digest(projection, helpers, 'currentPromptIrMethod.projection') !== projectionSha256
    || projection.schema !== 'qingmu.imago-prompt-ir-method-projection.v1') {
    throw helpers.responseError('current PromptIR Method projection SHA mismatch')
  }
  const target = exact(projection.target, [
    'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'basePromptIrId', 'baseVersion',
    'baseSnapshotSha256', 'baseContentSha256',
  ], 'currentPromptIrMethod.projection.target', helpers.responseError)
  const expectedTarget = {
    projectId: intent.projectId, episodeId: intent.episodeId,
    storyboardRevisionId: intent.storyboardRevisionId, frameId: intent.frameId,
    basePromptIrId: promptIr.id, baseVersion: promptIr.version,
    baseSnapshotSha256: promptIr.snapshotSha256, baseContentSha256: promptIr.contentSha256,
  }
  if (!isDeepStrictEqual(target, expectedTarget)
    || !isDeepStrictEqual(projection.normalized_candidate, promptIr.editableProjection)
    || !isDeepStrictEqual(projection.changed_paths, [])
    || !isDeepStrictEqual(projection.blockers, ['candidate_has_no_editable_changes'])
    || !isDeepStrictEqual(projection.warnings, [])) {
    throw helpers.responseError('current PromptIR Method projection authority mismatch')
  }
  const candidateSha256 = sha(projection.candidate_sha256, 'currentPromptIrMethod.candidateSha256', helpers.responseError)
  if (digest(promptIr.editableProjection, helpers, 'currentPromptIrMethod.candidate') !== candidateSha256
    || projection.providerCalls !== 0 || projection.workerStarted !== false || projection.maximumCostCny !== '0'
    || projection.project_state_persisted !== false || projection.selection_executed !== false
    || projection.human_approval_inferred !== false || projection.human_signoff_inferred !== false) {
    throw helpers.responseError('current PromptIR Method execution boundary mismatch')
  }
  const definition = exact(
    projection.method_definition, METHOD_DEFINITION_FIELDS,
    'currentPromptIrMethod.definition', helpers.responseError,
  )
  const methodSha256 = sha(definition.sha256, 'currentPromptIrMethod.definition.sha256', helpers.responseError)
  const eStageDefinitionSha256 = sha(
    definition.stage_contract_sha256,
    'currentPromptIrMethod.definition.stageContractSha256', helpers.responseError,
  )
  sha(definition.role_capability_sha256, 'currentPromptIrMethod.definition.roleCapabilitySha256', helpers.responseError)
  if (definition.id !== 'imago-v6-e-provider-neutral-prompt-ir-edit-method'
    || definition.version !== 1 || definition.prompt_ir_schema !== 'IMAGO-V6-VideoPromptIR-v1'
    || definition.agent_path !== PROMPT_IR_SOURCE_PATHS[5]
    || definition.skill_path !== PROMPT_IR_SOURCE_PATHS[6]) {
    throw helpers.responseError('PromptIR Method definition mismatch')
  }
  const mapping = exact(
    definition.field_mapping, FIELD_MAPPING_FIELDS,
    'currentPromptIrMethod.fieldMapping', helpers.responseError,
  )
  const fields = Array.isArray(mapping.fields) ? mapping.fields : []
  if (mapping.schema !== 'qingmu.imago-prompt-ir-field-mapping.v1' || mapping.version !== 1
    || fields.length !== EDITABLE_FIELDS.length) throw helpers.responseError('PromptIR field mapping mismatch')
  const fieldMappingSha256 = sha(mapping.sha256, 'currentPromptIrMethod.fieldMapping.sha256', helpers.responseError)
  const unsignedMapping = { ...mapping }
  delete unsignedMapping.sha256
  if (digest(unsignedMapping, helpers, 'currentPromptIrMethod.fieldMapping') !== fieldMappingSha256) {
    throw helpers.responseError('PromptIR field mapping SHA mismatch')
  }
  const sourceBindings = Array.isArray(projection.source_bindings) ? projection.source_bindings : []
  if (sourceBindings.length !== PROMPT_IR_SOURCE_PATHS.length + 2) {
    throw helpers.responseError('PromptIR source binding count mismatch')
  }
  const normalizedSources = sourceBindings.map((entry, index) => {
    const source = exact(
      entry,
      index < PROMPT_IR_SOURCE_PATHS.length ? ['kind', 'path', 'sha256'] : DIRECTOR_CARD_FIELDS,
      `currentPromptIrMethod.source[${String(index)}]`, helpers.responseError,
    )
    if (index < PROMPT_IR_SOURCE_PATHS.length
      && (source.kind !== PROMPT_IR_SOURCE_KINDS[index] || source.path !== PROMPT_IR_SOURCE_PATHS[index])) {
      throw helpers.responseError('PromptIR source binding identity mismatch')
    }
    return {
      value: source,
      sha256: sha(source.sha256, `currentPromptIrMethod.source[${String(index)}].sha256`, helpers.responseError),
    }
  })
  const directorSources = normalizedSources.slice(PROMPT_IR_SOURCE_PATHS.length).map((source, index) => {
    const stage = index === 0 ? 'D' : 'E'
    const value = source.value
    if (value.kind !== 'director_method_card' || value.stage_id !== stage
      || value.repo_id !== 'director-skill-core' || value.path !== EXPECTED_CARDS[stage]) {
      throw helpers.responseError('PromptIR director card source identity mismatch')
    }
    gitOid(value.repository_commit, `currentPromptIrMethod.sourceCard[${String(index)}].commit`, helpers.responseError)
    sha(value.provenance_sha256, `currentPromptIrMethod.sourceCard[${String(index)}].provenance`, helpers.responseError)
    return value
  })
  const hints = Array.isArray(projection.field_hints) ? projection.field_hints : []
  if (hints.length !== EDITABLE_FIELDS.length) throw helpers.responseError('PromptIR field hint count mismatch')
  const checklist = Array.isArray(projection.checklist) ? projection.checklist : []
  if (checklist.length === 0) throw helpers.responseError('PromptIR Method checklist must not be empty')
  checklist.forEach((item, index) => {
    const check = exact(
      item, ['check_id', 'label', 'required'],
      `currentPromptIrMethod.checklist[${String(index)}]`, helpers.responseError,
    )
    text(check.check_id, `currentPromptIrMethod.checklist[${String(index)}].id`, helpers.responseError, 1_000)
    text(check.label, `currentPromptIrMethod.checklist[${String(index)}].label`, helpers.responseError, 1_000)
    if (check.required !== true) throw helpers.responseError('PromptIR Method checklist item mismatch')
  })
  const contractByStage = new Map<string, string>()
  const evidenceFields = EDITABLE_FIELDS.map((field, index) => {
    const entry = exact(
      fields[index], FIELD_MAPPING_ENTRY_FIELDS,
      `currentPromptIrMethod.field[${String(index)}]`, helpers.responseError,
    )
    const stageIds = entry.stage_ids
    if (entry.field !== field || entry.method_sha256 !== methodSha256
      || !isDeepStrictEqual(stageIds, EXPECTED_STAGES[field])) {
      throw helpers.responseError('PromptIR D/E field mapping mismatch')
    }
    const contracts = Array.isArray(entry.stage_contract_bindings) ? entry.stage_contract_bindings : []
    const cards = Array.isArray(entry.card_bindings) ? entry.card_bindings : []
    if (contracts.length !== EXPECTED_STAGES[field].length || cards.length !== EXPECTED_STAGES[field].length) {
      throw helpers.responseError('PromptIR field contract/card binding mismatch')
    }
    const contractSha256s = contracts.map((binding, bindingIndex) => {
      const contract = exact(binding, ['stage_id', 'contract_sha256'],
        `currentPromptIrMethod.contract[${String(bindingIndex)}]`, helpers.responseError)
      if (contract.stage_id !== EXPECTED_STAGES[field][bindingIndex]) {
        throw helpers.responseError('PromptIR stage contract binding mismatch')
      }
      const contractSha256 = sha(contract.contract_sha256,
        `currentPromptIrMethod.contract[${String(bindingIndex)}].sha256`, helpers.responseError)
      const prior = contractByStage.get(String(contract.stage_id))
      if (prior !== undefined && prior !== contractSha256) {
        throw helpers.responseError('PromptIR stage contract consistency mismatch')
      }
      contractByStage.set(String(contract.stage_id), contractSha256)
      return contractSha256
    })
    const cardSha256s = cards.map((binding, bindingIndex) => {
      const card = exact(binding, DIRECTOR_CARD_FIELDS,
        `currentPromptIrMethod.card[${String(bindingIndex)}]`, helpers.responseError)
      const expectedStage = EXPECTED_STAGES[field][bindingIndex]
      if (expectedStage === undefined || card.kind !== 'director_method_card' || card.stage_id !== expectedStage
        || card.repo_id !== 'director-skill-core' || card.path !== EXPECTED_CARDS[expectedStage]) {
        throw helpers.responseError('PromptIR director card binding mismatch')
      }
      gitOid(card.repository_commit, `currentPromptIrMethod.card[${String(bindingIndex)}].commit`, helpers.responseError)
      sha(card.provenance_sha256, `currentPromptIrMethod.card[${String(bindingIndex)}].provenance`, helpers.responseError)
      const cardSha256 = sha(card.sha256,
        `currentPromptIrMethod.card[${String(bindingIndex)}].sha256`, helpers.responseError)
      if (!isDeepStrictEqual(card, directorSources[expectedStage === 'D' ? 0 : 1])) {
        throw helpers.responseError('PromptIR director card source binding mismatch')
      }
      return cardSha256
    })
    const hint = exact(
      hints[index], FIELD_HINT_FIELDS,
      `currentPromptIrMethod.hint[${String(index)}]`, helpers.responseError,
    )
    const [title, guidance] = PROMPT_IR_FIELD_HINTS[field]
    if (hint.hint_id !== `director-method-card-${field}` || hint.field !== field
      || hint.title !== title || hint.guidance !== guidance || hint.mapping_sha256 !== fieldMappingSha256
      || !isDeepStrictEqual(hint.stage_ids, EXPECTED_STAGES[field])
      || !isDeepStrictEqual(hint.card_sha256s, cardSha256s)) {
      throw helpers.responseError('PromptIR field hint binding mismatch')
    }
    return {
      field, stageIds: EXPECTED_STAGES[field], contractSha256s, cardSha256s,
      sourceSha256s: normalizedSources.map(source => source.sha256),
      hintSha256: digest(hint, helpers, `currentPromptIrMethod.hint[${String(index)}]`),
    }
  })
  const dStageContractSha256 = contractByStage.get('D')
  const eStageContractSha256 = contractByStage.get('E')
  if (dStageContractSha256 === undefined || eStageContractSha256 === undefined
    || dStageContractSha256 === eStageContractSha256 || eStageContractSha256 !== eStageDefinitionSha256) {
    throw helpers.responseError('PromptIR D/E stage contract authority mismatch')
  }
  const workOrder = exact(
    projection.work_order_projection, WORK_ORDER_FIELDS,
    'currentPromptIrMethod.workOrder', helpers.responseError,
  )
  const expectedReadSet = [{
    source: 'yimeng', resource: 'prompt_ir_authoritative_snapshot', projectId: intent.projectId,
    episodeId: intent.episodeId, targetId: `${intent.storyboardRevisionId}:${intent.frameId}`,
    storyboardRevisionId: intent.storyboardRevisionId, frameId: intent.frameId, promptIrId: promptIr.id,
    promptIrVersion: promptIr.version, snapshotSha256: promptIr.snapshotSha256,
    contentSha256: promptIr.contentSha256, status: 'Ready',
  }]
  if (!isDeepStrictEqual(workOrder.target, expectedTarget)
    || workOrder.operation !== 'compilePromptIrCandidateProjection'
    || !isDeepStrictEqual(workOrder.allowed_mutations, [])
    || !isDeepStrictEqual(workOrder.editable_fields, EDITABLE_FIELDS)
    || !isDeepStrictEqual(workOrder.required_read_set, expectedReadSet)
    || !nonEmptyTextArray(workOrder.before_compile, 'currentPromptIrMethod.workOrder.before', helpers)
    || !nonEmptyTextArray(workOrder.after_compile, 'currentPromptIrMethod.workOrder.after', helpers)
    || workOrder.providerCalls !== 0 || workOrder.workerStarted !== false || workOrder.maximumCostCny !== '0') {
    throw helpers.responseError('current PromptIR Method work-order boundary mismatch')
  }
  const snapshot = {
    schema: 'qingmu.prompt-ir-method-snapshot.v1', target: expectedTarget,
    baseEditableProjection: promptIr.editableProjection,
    candidateEditableProjection: methodCandidate(promptIr),
    authority: {
      business_truth: 'yimeng', method_source: 'imago_os_current', human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
  if (projection.input_snapshot_sha256 !== digest(snapshot, helpers, 'currentPromptIrMethod.snapshot')
    || projection.authority_snapshot_attestation !== 'not_verified_by_compiler') {
    throw helpers.responseError('current PromptIR Method snapshot authority mismatch')
  }
  const proof = exact(root.methodAttestation, METHOD_ATTESTATION_FIELDS, 'currentPromptIrMethod.attestation', helpers.responseError)
  const unsigned = {
    schema: 'qingmu.imago-prompt-ir-method-attestation.v1', algorithm: 'hmac-sha256', projectionSha256,
    inputSnapshotSha256: digest(snapshot, helpers, 'currentPromptIrMethod.snapshot'),
    targetSha256: digest(expectedTarget, helpers, 'currentPromptIrMethod.target'),
    baseEditableProjectionSha256: digest(promptIr.editableProjection, helpers, 'currentPromptIrMethod.base'),
    candidateEditableProjectionSha256: digest(methodCandidate(promptIr), helpers, 'currentPromptIrMethod.candidate'),
    candidateSha256,
  }
  if (Object.entries(unsigned).some(([key, expected]) => proof[key] !== expected)) {
    throw helpers.responseError('current PromptIR Method attestation binding mismatch')
  }
  const signature = sha(proof.signature, 'currentPromptIrMethod.attestation.signature', helpers.responseError)
  const expectedSignature = createHmac('sha256', helpers.readAttestationKey())
    .update(helpers.canonicalJson(unsigned, 'currentPromptIrMethod.attestation'), 'utf8').digest()
  if (!timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex'))) {
    throw helpers.responseError('current PromptIR Method attestation signature mismatch')
  }
  return { projectionSha256, fieldMappingSha256, fields: evidenceFields }
}

function currentQuote(
  value: unknown,
  intent: YimengQueueProductionTakeIntent,
  promptIr: ReturnType<typeof currentPromptIr>,
  helpers: ProductionTakeHelpers,
) {
  const quote = object(value, 'currentFirstFrameQuote', helpers.responseError)
  const authority = object(quote.authoritySnapshot, 'currentFirstFrameQuote.authoritySnapshot', helpers.responseError)
  const frame = object(authority.frame, 'currentFirstFrameQuote.frame', helpers.responseError)
  const boundPrompt = object(authority.promptIr, 'currentFirstFrameQuote.promptIr', helpers.responseError)
  const promptBinding = object(quote.promptBinding, 'currentFirstFrameQuote.promptBinding', helpers.responseError)
  if (quote.schema !== 'jason.qingmu-ready-prompt-ir-first-frame-quote.v1'
    || quote.projectId !== intent.projectId || quote.episodeId !== intent.episodeId
    || quote.storyboardRevisionId !== intent.storyboardRevisionId || quote.frameId !== intent.frameId
    || frame.id !== intent.frameId || boundPrompt.id !== promptIr.id || boundPrompt.version !== promptIr.version
    || boundPrompt.contentSha256 !== promptIr.contentSha256 || boundPrompt.status !== 'Ready') {
    throw helpers.responseError('current first-frame authority mismatch')
  }
  if (quote.quoteReady !== true || quote.readOnly !== true || quote.providerCalls !== 0
    || quote.taskCreated !== false || quote.submitted !== false || quote.charged !== false
    || promptBinding.dispatchCompatible !== true || !isDeepStrictEqual(promptBinding.executionBlockers, [])
    || !isDeepStrictEqual(quote.blockers, [])) {
    throw helpers.responseError('current first-frame prerequisites are blocked')
  }
  const rawReferences = Array.isArray(authority.references) ? authority.references : []
  if (rawReferences.length === 0 || !isDeepStrictEqual(authority.referenceExecutionBlockers, [])) {
    throw helpers.responseError('current human reference authority is blocked')
  }
  const referenceBindings = rawReferences.map((raw, index) => {
    const reference = object(raw, `currentFirstFrameQuote.reference[${String(index)}]`, helpers.responseError)
    return Object.fromEntries(REFERENCE_FIELDS.map(field => [field, field.endsWith('Sha256')
      ? sha(reference[field], `currentFirstFrameQuote.reference.${field}`, helpers.responseError)
      : text(reference[field], `currentFirstFrameQuote.reference.${field}`, helpers.responseError, 512)]))
  })
  return {
    sceneId: text(frame.sceneId, 'currentFirstFrameQuote.frame.sceneId', helpers.responseError),
    authoritySnapshotSha256: sha(quote.authoritySnapshotSha256, 'currentFirstFrameQuote.authoritySha', helpers.responseError),
    projectionSha256: sha(quote.projectionSha256, 'currentFirstFrameQuote.projectionSha', helpers.responseError),
    referenceBindings,
  }
}

function currentVideoQuote(
  value: unknown,
  intent: YimengQueueProductionTakeIntent,
  helpers: ProductionTakeHelpers,
) {
  const quote = exact(value, [
    'schema', 'preflightSha256', 'projectionSha256', 'maximumReservationCny', 'candidateCount', 'maxAttempts',
    'selectAsOfficial', 'quoteReady', 'dispatchReady', 'quoteBlockers', 'dispatchBlockers',
    'requiredPaidConfirmationText', 'requiredPaidConfirmationTextSha256',
  ], 'currentVideoQuote', helpers.responseError)
  const quoteBlockers = quote.quoteBlockers
  const dispatchBlockers = quote.dispatchBlockers
  if (quote.schema !== 'jason.qingmu-writer-video-quote.v1'
    || quote.preflightSha256 !== intent.videoPreflightSha256
    || quote.projectionSha256 !== intent.videoQuoteProjectionSha256
    || quote.maximumReservationCny !== intent.maximumReservationCny
    || quote.candidateCount !== 1 || quote.maxAttempts !== 1 || quote.selectAsOfficial !== false
    || quote.quoteReady !== true || quote.dispatchReady !== false
    || !Array.isArray(quoteBlockers) || !isDeepStrictEqual(quoteBlockers, [])
    || !Array.isArray(dispatchBlockers) || !isDeepStrictEqual(dispatchBlockers, ['operator_paid_confirmation_required'])
    || typeof quote.requiredPaidConfirmationText !== 'string'
    || quote.requiredPaidConfirmationText !== intent.paidConfirmationText
    || digest(quote.requiredPaidConfirmationText, helpers, 'currentVideoQuote.requiredPaidConfirmationText')
      !== sha(quote.requiredPaidConfirmationTextSha256, 'currentVideoQuote.requiredPaidConfirmationTextSha256', helpers.responseError)) {
    throw helpers.responseError('current video quote authority mismatch')
  }
  return {
    preflightSha256: intent.videoPreflightSha256,
    projectionSha256: intent.videoQuoteProjectionSha256,
    maximumReservationCny: intent.maximumReservationCny,
    paidConfirmationTextSha256: sha(
      quote.requiredPaidConfirmationTextSha256,
      'currentVideoQuote.requiredPaidConfirmationTextSha256',
      helpers.responseError,
    ),
  }
}

function normalizeReceipt(
  value: unknown,
  intent: YimengQueueProductionTakeIntent,
  promptIr: ReturnType<typeof currentPromptIr>,
  quote: ReturnType<typeof currentQuote>,
  videoQuote: ReturnType<typeof currentVideoQuote>,
  body: YimengCommandJsonObject,
  helpers: ProductionTakeHelpers,
): YimengProductionTakeReceipt {
  const receipt = exact(value, RECEIPT_FIELDS, 'productionTakeReceipt', helpers.responseError)
  const boundPrompt = exact(receipt.promptIr, ['id', 'version', 'contentSha256', 'videoPromptSha256'], 'productionTakeReceipt.promptIr', helpers.responseError)
  if (receipt.schema !== 'jason.qingmu-writer-production-take.v1'
    || receipt.projectId !== intent.projectId || receipt.episodeId !== intent.episodeId
    || receipt.sceneId !== quote.sceneId || receipt.shotId !== intent.frameId
    || receipt.storyboardRevisionId !== intent.storyboardRevisionId || receipt.takeKind !== intent.takeKind
    || receipt.takeOrdinal !== intent.takeOrdinal || receipt.takeLimit !== 2
    || receipt.requestIdempotencyKey !== body.idempotencyKey
    || boundPrompt.id !== promptIr.id || boundPrompt.version !== promptIr.version
    || boundPrompt.contentSha256 !== promptIr.contentSha256
    || receipt.authoritySnapshotSha256 !== quote.authoritySnapshotSha256
    || receipt.firstFrameQuoteProjectionSha256 !== quote.projectionSha256
    || receipt.firstFrameSelectionReceiptSha256 !== intent.firstFrameSelectionReceiptSha256
    || receipt.selectedFirstFrameAssetId !== intent.selectedFirstFrameAssetId
    || receipt.selectedFirstFrameMaterializedSha256 !== intent.selectedFirstFrameMaterializedSha256
    || receipt.videoPreflightSha256 !== videoQuote.preflightSha256
    || receipt.videoQuoteProjectionSha256 !== videoQuote.projectionSha256
    || receipt.maximumReservationCny !== videoQuote.maximumReservationCny
    || receipt.candidateCount !== 1 || receipt.maxAttempts !== 1 || receipt.selectAsOfficial !== false
    || receipt.paidConfirmed !== true || receipt.paidConfirmationTextSha256 !== videoQuote.paidConfirmationTextSha256
    || !isDeepStrictEqual(receipt.referenceBindings, body.referenceBindings)) {
    throw helpers.responseError('Writer production-Take receipt lineage mismatch')
  }
  sha(boundPrompt.videoPromptSha256, 'productionTakeReceipt.videoPromptSha256', helpers.responseError)
  sha(receipt.authoritySnapshotSha256, 'productionTakeReceipt.authoritySnapshotSha256', helpers.responseError)
  sha(receipt.firstFrameQuoteProjectionSha256, 'productionTakeReceipt.quoteProjectionSha256', helpers.responseError)
  sha(receipt.firstFrameSelectionReceiptSha256, 'productionTakeReceipt.selectionReceiptSha256', helpers.responseError)
  text(receipt.selectedFirstFrameAssetId, 'productionTakeReceipt.selectedFirstFrameAssetId', helpers.responseError)
  sha(receipt.selectedFirstFrameMaterializedSha256, 'productionTakeReceipt.selectedFirstFrameMaterializedSha256', helpers.responseError)
  sha(receipt.videoPreflightSha256, 'productionTakeReceipt.videoPreflightSha256', helpers.responseError)
  sha(receipt.videoQuoteProjectionSha256, 'productionTakeReceipt.videoQuoteProjectionSha256', helpers.responseError)
  if (typeof receipt.maximumReservationCny !== 'number' || !Number.isFinite(receipt.maximumReservationCny)
    || receipt.maximumReservationCny < 0 || receipt.maximumReservationCny > 1_000) {
    throw helpers.responseError('Writer production-Take receipt maximum reservation invalid')
  }
  sha(receipt.paidConfirmationTextSha256, 'productionTakeReceipt.paidConfirmationTextSha256', helpers.responseError)
  text(receipt.taskId, 'productionTakeReceipt.taskId', helpers.responseError, 512)
  text(receipt.taskStatus, 'productionTakeReceipt.taskStatus', helpers.responseError, 128)
  text(receipt.idempotencyKey, 'productionTakeReceipt.idempotencyKey', helpers.responseError, 200)
  boolean(receipt.deduplicated, 'productionTakeReceipt.deduplicated', helpers.responseError)
  boolean(receipt.recovered, 'productionTakeReceipt.recovered', helpers.responseError)
  boolean(receipt.queued, 'productionTakeReceipt.queued', helpers.responseError)
  if (!Array.isArray(receipt.referenceBindings) || receipt.referenceBindings.length === 0) {
    throw helpers.responseError('Writer production-Take reference receipt missing')
  }
  return receipt as unknown as YimengProductionTakeReceipt
}

/**
 * Re-read Ready authority, compile and verify current E1-B Method, then prepare the exact Writer POST.
 * @param intent - Validated seven-field browser intent.
 * @param dependencies - Current Yimeng reads and E1-B method execution.
 * @param helpers - Host canonicalization, error, and attestation primitives.
 * @param signal - Cancellation signal propagated through every authority read.
 * @returns The exact Writer request and authority-bound receipt validator.
 */
export async function prepareProductionTakeCommand(
  intent: YimengQueueProductionTakeIntent,
  dependencies: ProductionTakeDependencies,
  helpers: ProductionTakeHelpers,
  signal: AbortSignal,
): Promise<PreparedProductionTakeCommand> {
  const promptResult = await dependencies.readYimeng('promptIr', {
    projectId: intent.projectId, episodeId: intent.episodeId,
    storyboardRevisionId: intent.storyboardRevisionId, frameId: intent.frameId,
  }, signal)
  if (!promptResult.ok) throw helpers.responseError('current Ready PromptIR is unavailable')
  const promptIr = currentPromptIr(promptResult.value, intent, helpers)
  const methodRequest = {
    projectId: intent.projectId, episodeId: intent.episodeId,
    storyboardRevisionId: intent.storyboardRevisionId, frameId: intent.frameId,
    basePromptIrId: promptIr.id, baseVersion: promptIr.version,
    baseSnapshotSha256: promptIr.snapshotSha256, baseContentSha256: promptIr.contentSha256,
    baseEditableProjection: promptIr.editableProjection,
    candidateEditableProjection: methodCandidate(promptIr),
  }
  const methodResult = await dependencies.runPromptIrMethod(methodRequest, signal)
  if (!methodResult.ok) throw helpers.responseError('current PromptIR Method is unavailable')
  const method = verifyMethod(methodResult.value, intent, promptIr, helpers)
  const quoteResult = await dependencies.readYimeng('firstFrameQuote', {
    projectId: intent.projectId, episodeId: intent.episodeId,
    storyboardRevisionId: intent.storyboardRevisionId, frameId: intent.frameId,
    promptIrId: promptIr.id, promptIrVersion: promptIr.version,
    promptIrContentSha256: promptIr.contentSha256,
  }, signal)
  if (!quoteResult.ok) throw helpers.responseError('current first-frame authority is unavailable')
  const quote = currentQuote(quoteResult.value, intent, promptIr, helpers)
  const videoQuoteResult = await dependencies.readYimeng('videoQuote', {
    projectId: intent.projectId, episodeId: intent.episodeId, sceneId: quote.sceneId, shotId: intent.frameId,
  }, signal)
  if (!videoQuoteResult.ok) throw helpers.responseError('current video quote is unavailable')
  const videoQuote = currentVideoQuote(videoQuoteResult.value, intent, helpers)
  const requestIdempotencyKey = `qwb-ui-v1-${createHash('sha256').update(helpers.canonicalJson({
    projectId: intent.projectId, episodeId: intent.episodeId, frameId: intent.frameId,
    takeOrdinal: intent.takeOrdinal,
  }, 'productionTakeIdempotency')).digest('hex').slice(0, 40)}`
  const body = {
    takeKind: intent.takeKind,
    storyboardRevisionId: intent.storyboardRevisionId,
    promptIrId: promptIr.id,
    promptIrVersion: promptIr.version,
    promptIrContentSha256: promptIr.contentSha256,
    authoritySnapshotSha256: quote.authoritySnapshotSha256,
    firstFrameQuoteProjectionSha256: quote.projectionSha256,
    referenceBindings: quote.referenceBindings,
    firstFrameSelectionReceiptSha256: intent.firstFrameSelectionReceiptSha256,
    selectedFirstFrameAssetId: intent.selectedFirstFrameAssetId,
    selectedFirstFrameMaterializedSha256: intent.selectedFirstFrameMaterializedSha256,
    videoPreflightSha256: intent.videoPreflightSha256,
    videoQuoteProjectionSha256: intent.videoQuoteProjectionSha256,
    maximumReservationCny: intent.maximumReservationCny,
    candidateCount: 1,
    maxAttempts: 1,
    selectAsOfficial: false,
    paidConfirmed: true,
    paidConfirmationText: intent.paidConfirmationText,
    idempotencyKey: requestIdempotencyKey,
  }
  return {
    path: `/api/qingmu/projects/${encodeURIComponent(intent.projectId)}/episodes/${encodeURIComponent(intent.episodeId)}`
      + `/scenes/${encodeURIComponent(quote.sceneId)}/shots/${encodeURIComponent(intent.frameId)}/production-takes`,
    body,
    idempotencyKey: requestIdempotencyKey,
    normalize: (value): YimengProductionTakeResult => ({
      schema: 'qingmu.production-take-host-result.v1', method,
      receipt: normalizeReceipt(value, intent, promptIr, quote, videoQuote, body, helpers),
      providerCalls: 0, workerStarted: false, maximumCostCny: '0',
    }),
  }
}
