import type {
  YimengProductionTakeResult,
  YimengQueueProductionTakeIntent,
} from './contracts.ts'

const MARKER_SCHEMA = 'qingmu.production-take-recovery-marker.v1'
const MARKER_PREFIX = 'qingmu:production-take-recovery:v1'
const RECEIPT_PREFIX = 'qingmu:production-take-receipt:v1'
const SHA256 = /^[0-9a-f]{64}$/u
const FIELDS = ['imageGenPrompt', 'lastFrameImagePrompt', 'videoGenPrompt', 'motionPrompt', 'negativePrompt'] as const
const STAGES = [['D'], ['D'], ['E'], ['E'], ['D', 'E']] as const
const REFERENCE_FIELDS = [
  'elementKind', 'elementId', 'assetId', 'assetSha256', 'materializedSha256', 'selectionIdentity',
  'sourceRevisionId', 'referencePackSha256',
] as const

/** Stable browser-storage coordinates for one Shot's Production Take state. */
export interface ProductionTakeCoordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
}

/** Durable, authority-free intent retained only while a Writer response is unknown. */
export interface ProductionTakeRecoveryMarker extends Omit<YimengQueueProductionTakeIntent, 'takeOrdinal'> {
  readonly schema: typeof MARKER_SCHEMA
  readonly takeOrdinal: 1 | 2
}

/** Result of validating a browser-stored marker or receipt. */
export type ProductionTakeStoredRead<T> =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'invalid'; readonly error: string }

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} 不是对象`)
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  const item = record(value, field)
  const actual = Object.keys(item).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${field} 字段不符合合同`)
  }
  return item
}

function identifier(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value !== value.trim()
    || /[\u0000\r\n]/u.test(value)) throw new Error(`${field} 无效`)
  return value
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${field} 不是 SHA-256`)
  return value
}

function same(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function key(prefix: string, coordinates: ProductionTakeCoordinates): string {
  return [prefix, coordinates.projectId, coordinates.episodeId, coordinates.storyboardRevisionId, coordinates.frameId]
    .map(encodeURIComponent).join(':')
}

function assertCoordinates(value: Record<string, unknown>, expected: ProductionTakeCoordinates): void {
  for (const field of ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId'] as const) {
    if (identifier(value[field], field) !== expected[field]) throw new Error(`Production Take ${field} 不匹配`)
  }
}

function parseMarker(value: unknown, expected: ProductionTakeCoordinates): ProductionTakeRecoveryMarker {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'takeKind', 'takeOrdinal', 'confirmReady',
  ], 'Production Take 恢复标记')
  if (item.schema !== MARKER_SCHEMA) throw new Error('Production Take 恢复标记版本不匹配')
  assertCoordinates(item, expected)
  if ((item.takeOrdinal !== 1 && item.takeOrdinal !== 2)
    || (item.takeOrdinal === 1 ? item.takeKind !== 'initial' : item.takeKind !== 'targeted_rework')
    || item.confirmReady !== true) throw new Error('Production Take 恢复意图无效')
  return item as unknown as ProductionTakeRecoveryMarker
}

/**
 * Validate the Host result again before it controls browser state or durable recovery.
 * @param value - Untrusted Host result.
 * @param expected - Exact Shot and Take intent the receipt must bind.
 * @returns The validated Host result.
 */
export function assertProductionTakeResult(
  value: unknown,
  expected: ProductionTakeRecoveryMarker,
): YimengProductionTakeResult {
  const root = exact(value, ['schema', 'method', 'receipt', 'providerCalls', 'workerStarted', 'maximumCostCny'], 'Host Production Take 回执')
  if (root.schema !== 'qingmu.production-take-host-result.v1' || root.providerCalls !== 0
    || root.workerStarted !== false || root.maximumCostCny !== '0') throw new Error('Host Production Take 零执行边界不匹配')
  const method = exact(root.method, ['projectionSha256', 'fieldMappingSha256', 'fields'], 'Production Take 方法证据')
  sha(method.projectionSha256, '方法投影')
  sha(method.fieldMappingSha256, '字段映射')
  if (!Array.isArray(method.fields) || method.fields.length !== FIELDS.length) throw new Error('五字段方法证据不完整')
  method.fields.forEach((entry, index) => {
    const field = exact(entry, ['field', 'stageIds', 'contractSha256s', 'cardSha256s', 'sourceSha256s', 'hintSha256'], `方法字段 ${String(index + 1)}`)
    const expectedStages = STAGES[index]
    if (expectedStages === undefined || field.field !== FIELDS[index]
      || !Array.isArray(field.stageIds) || !same(field.stageIds, expectedStages)) {
      throw new Error('五字段 D/E 顺序不匹配')
    }
    for (const listName of ['contractSha256s', 'cardSha256s', 'sourceSha256s'] as const) {
      if (!Array.isArray(field[listName]) || field[listName].length === 0) throw new Error(`${listName} 不完整`)
      field[listName].forEach((item, shaIndex) => { sha(item, `${listName}[${String(shaIndex)}]`) })
    }
    sha(field.hintSha256, '字段提示')
  })
  const receipt = exact(root.receipt, [
    'schema', 'projectId', 'episodeId', 'sceneId', 'shotId', 'storyboardRevisionId', 'promptIr',
    'authoritySnapshotSha256', 'firstFrameQuoteProjectionSha256', 'referenceBindings', 'takeKind',
    'takeOrdinal', 'takeLimit', 'taskId', 'taskStatus', 'requestIdempotencyKey', 'idempotencyKey',
    'deduplicated', 'recovered', 'queued',
  ], 'Writer Production Take 回执')
  const promptIr = exact(receipt.promptIr, ['id', 'version', 'contentSha256', 'videoPromptSha256'], 'Writer PromptIR 回执')
  if (receipt.schema !== 'jason.qingmu-writer-production-take.v1'
    || receipt.projectId !== expected.projectId || receipt.episodeId !== expected.episodeId
    || receipt.storyboardRevisionId !== expected.storyboardRevisionId || receipt.shotId !== expected.frameId
    || receipt.takeKind !== expected.takeKind || receipt.takeOrdinal !== expected.takeOrdinal || receipt.takeLimit !== 2
    || typeof receipt.queued !== 'boolean' || typeof receipt.recovered !== 'boolean'
    || typeof receipt.deduplicated !== 'boolean' || !Array.isArray(receipt.referenceBindings)
    || receipt.referenceBindings.length === 0) throw new Error('Writer Production Take 回执血缘不匹配')
  identifier(promptIr.id, 'promptIr.id')
  if (!Number.isSafeInteger(promptIr.version) || Number(promptIr.version) < 1) throw new Error('promptIr.version 无效')
  sha(promptIr.contentSha256, 'promptIr.contentSha256')
  sha(promptIr.videoPromptSha256, 'promptIr.videoPromptSha256')
  receipt.referenceBindings.forEach((entry, index) => {
    const reference = exact(entry, REFERENCE_FIELDS, `referenceBindings[${String(index)}]`)
    REFERENCE_FIELDS.forEach((field) => {
      if (field.endsWith('Sha256')) sha(reference[field], `referenceBindings[${String(index)}].${field}`)
      else identifier(reference[field], `referenceBindings[${String(index)}].${field}`, 512)
    })
  })
  identifier(receipt.sceneId, 'sceneId')
  identifier(receipt.taskId, 'taskId')
  identifier(receipt.taskStatus, 'taskStatus')
  identifier(receipt.requestIdempotencyKey, 'requestIdempotencyKey')
  identifier(receipt.idempotencyKey, 'idempotencyKey')
  sha(receipt.authoritySnapshotSha256, 'authoritySnapshotSha256')
  sha(receipt.firstFrameQuoteProjectionSha256, 'firstFrameQuoteProjectionSha256')
  return root as unknown as YimengProductionTakeResult
}

/**
 * Create and validate the durable marker for an unresolved Production Take request.
 * @param intent - Exact browser intent to preserve for same-command recovery.
 * @returns The versioned recovery marker.
 */
export function createProductionTakeRecoveryMarker(
  intent: Omit<YimengQueueProductionTakeIntent, 'takeOrdinal'> & { readonly takeOrdinal: 1 | 2 },
): ProductionTakeRecoveryMarker {
  return parseMarker({ schema: MARKER_SCHEMA, ...intent }, intent)
}

/**
 * Read and validate the unresolved Production Take marker for one Shot.
 * @param coordinates - Shot coordinates used to address and bind the marker.
 * @returns A missing, valid, or invalid storage result.
 */
export function readProductionTakeRecoveryMarker(
  coordinates: ProductionTakeCoordinates,
): ProductionTakeStoredRead<ProductionTakeRecoveryMarker> {
  try {
    const raw = localStorage.getItem(key(MARKER_PREFIX, coordinates))
    return raw === null ? { status: 'none' } : { status: 'ready', value: parseMarker(JSON.parse(raw), coordinates) }
  } catch (cause) {
    return { status: 'invalid', error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Persist one validated unresolved Production Take marker without overwriting a different intent.
 * @param marker - Versioned marker to persist.
 * @returns Whether the exact marker was durably read back.
 */
export function writeProductionTakeRecoveryMarker(marker: ProductionTakeRecoveryMarker): boolean {
  try {
    const storageKey = key(MARKER_PREFIX, marker)
    const existing = localStorage.getItem(storageKey)
    if (existing !== null && JSON.stringify(parseMarker(JSON.parse(existing), marker)) !== JSON.stringify(marker)) return false
    localStorage.setItem(storageKey, JSON.stringify(marker))
    return JSON.stringify(parseMarker(JSON.parse(localStorage.getItem(storageKey) ?? ''), marker)) === JSON.stringify(marker)
  } catch { return false }
}

/**
 * Clear only the unresolved marker that exactly matches the recovered intent.
 * @param marker - Exact marker eligible for removal.
 * @returns Whether the matching marker is absent after the operation.
 */
export function clearProductionTakeRecoveryMarker(marker: ProductionTakeRecoveryMarker): boolean {
  try {
    const storageKey = key(MARKER_PREFIX, marker)
    const existing = localStorage.getItem(storageKey)
    if (existing === null || JSON.stringify(parseMarker(JSON.parse(existing), marker)) !== JSON.stringify(marker)) return false
    localStorage.removeItem(storageKey)
    return localStorage.getItem(storageKey) === null
  } catch { return false }
}

/**
 * Read and revalidate the latest durable Writer receipt for one Shot.
 * @param coordinates - Shot coordinates used to address and bind the receipt.
 * @returns A missing, valid, or invalid storage result.
 */
export function readProductionTakeReceipt(
  coordinates: ProductionTakeCoordinates,
): ProductionTakeStoredRead<YimengProductionTakeResult> {
  try {
    const raw = localStorage.getItem(key(RECEIPT_PREFIX, coordinates))
    if (raw === null) return { status: 'none' }
    const parsed = JSON.parse(raw) as unknown
    const root = record(parsed, 'Production Take 本地回执')
    const receipt = record(root.receipt, 'Production Take 本地 Writer 回执')
    const ordinal = receipt.takeOrdinal
    if (ordinal !== 1 && ordinal !== 2) throw new Error('Production Take 本地回执编号无效')
    const marker = createProductionTakeRecoveryMarker({
      projectId: coordinates.projectId,
      episodeId: coordinates.episodeId,
      storyboardRevisionId: coordinates.storyboardRevisionId,
      frameId: coordinates.frameId,
      takeOrdinal: ordinal,
      takeKind: ordinal === 1 ? 'initial' : 'targeted_rework', confirmReady: true })
    return { status: 'ready', value: assertProductionTakeResult(parsed, marker) }
  } catch (cause) {
    return { status: 'invalid', error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Persist a validated Writer receipt without allowing Take order to regress.
 * @param result - Host result containing the Writer receipt.
 * @param marker - Exact browser intent the result must satisfy.
 * @returns Whether the same receipt was durably read back.
 */
export function writeProductionTakeReceipt(
  result: YimengProductionTakeResult,
  marker: ProductionTakeRecoveryMarker,
): boolean {
  try {
    const verified = assertProductionTakeResult(result, marker)
    const storageKey = key(RECEIPT_PREFIX, marker)
    const existing = readProductionTakeReceipt(marker)
    if (existing.status === 'invalid'
      || (existing.status === 'ready' && existing.value.receipt.takeOrdinal > verified.receipt.takeOrdinal)) return false
    localStorage.setItem(storageKey, JSON.stringify(verified))
    const readback = readProductionTakeReceipt(marker)
    return readback.status === 'ready'
      && readback.value.receipt.requestIdempotencyKey === verified.receipt.requestIdempotencyKey
      && readback.value.receipt.takeOrdinal === verified.receipt.takeOrdinal
  } catch { return false }
}
