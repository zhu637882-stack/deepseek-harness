const SCHEMA = 'qingmu.storyboard-canvas-commit-recovery-marker.v1'
const STORAGE_PREFIX = 'qingmu:storyboard-canvas-commit-recovery:v1'
const SHA256 = /^[0-9a-f]{64}$/u

const KEYS = [
  'schema',
  'projectId',
  'episodeId',
  'storyboardRevisionId',
  'frameId',
  'targetType',
  'targetId',
  'changeSetId',
  'baseRevision',
  'baseSnapshotSha256',
  'idempotencyKey',
  'expectedPayloadSha256',
] as const

/** Frame coordinates used to discover one same-tab commit recovery marker. */
export interface StoryboardCanvasRecoveryCoordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
}

/**
 * Non-secret pre-POST receipt coordinates. Canvas annotations, Hero media URLs,
 * method projections, attestations, and request bodies are deliberately absent.
 */
export interface StoryboardCanvasCommitRecoveryMarker extends StoryboardCanvasRecoveryCoordinates {
  readonly schema: typeof SCHEMA
  readonly targetType: 'storyboard_frame'
  readonly targetId: string
  readonly changeSetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly idempotencyKey: string
  readonly expectedPayloadSha256: string
}

/** Browser-safe commit coordinates accepted when creating a recovery marker. */
export type StoryboardCanvasCommitCoordinates = Omit<StoryboardCanvasCommitRecoveryMarker, 'schema'>

export type StoryboardCanvasRecoveryMarkerRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: StoryboardCanvasCommitRecoveryMarker }
  | { readonly status: 'invalid'; readonly error: string }

function isIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !/[\u0000\r\n]/u.test(value)
}

function requireSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} SHA-256 无效`)
}

function requireExactKeys(record: Record<string, unknown>): void {
  const actual = Object.keys(record).sort()
  const expected = [...KEYS].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('故事板画布恢复标记字段不符合合同')
  }
}

function requireCoordinates(
  record: Record<string, unknown>,
  expected: StoryboardCanvasRecoveryCoordinates,
  revisionPolicy: 'exact' | 'stored',
): void {
  for (const key of ['projectId', 'episodeId', 'frameId'] as const) {
    if (!isIdentifier(record[key]) || record[key] !== expected[key]) {
      throw new Error(`故事板画布恢复标记 ${key} 不匹配`)
    }
  }
  if (!isIdentifier(record.storyboardRevisionId)) {
    throw new Error('故事板画布恢复标记 storyboardRevisionId 无效')
  }
  if (revisionPolicy === 'exact' && record.storyboardRevisionId !== expected.storyboardRevisionId) {
    throw new Error('故事板画布恢复标记 storyboardRevisionId 不匹配')
  }
}

function parseMarker(
  value: unknown,
  expected: StoryboardCanvasRecoveryCoordinates,
  revisionPolicy: 'exact' | 'stored' = 'exact',
): StoryboardCanvasCommitRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('故事板画布恢复标记不是对象')
  }
  const record = value as Record<string, unknown>
  requireExactKeys(record)
  if (record.schema !== SCHEMA) throw new Error('故事板画布恢复标记合同不匹配')
  requireCoordinates(record, expected, revisionPolicy)
  if (record.targetType !== 'storyboard_frame') throw new Error('故事板画布恢复标记 Target Type 不匹配')
  const targetId = expected.frameId
  if (!isIdentifier(record.targetId) || record.targetId !== targetId) {
    throw new Error('故事板画布恢复标记 Target ID 不匹配')
  }
  if (!isIdentifier(record.changeSetId)) throw new Error('故事板画布恢复标记 ChangeSet ID 无效')
  if (!Number.isSafeInteger(record.baseRevision) || (record.baseRevision as number) < 1) {
    throw new Error('故事板画布恢复标记基础修订无效')
  }
  requireSha256(record.baseSnapshotSha256, '故事板画布恢复标记基础快照')
  if (!isIdentifier(record.idempotencyKey, 200) || record.idempotencyKey.length < 8) {
    throw new Error('故事板画布恢复标记幂等键无效')
  }
  requireSha256(record.expectedPayloadSha256, '故事板画布恢复标记 Payload')
  return {
    schema: SCHEMA,
    projectId: record.projectId as string,
    episodeId: record.episodeId as string,
    storyboardRevisionId: record.storyboardRevisionId as string,
    frameId: record.frameId as string,
    targetType: 'storyboard_frame',
    targetId: record.targetId,
    changeSetId: record.changeSetId,
    baseRevision: record.baseRevision as number,
    baseSnapshotSha256: record.baseSnapshotSha256,
    idempotencyKey: record.idempotencyKey,
    expectedPayloadSha256: record.expectedPayloadSha256,
  }
}

function storageKey(coordinates: StoryboardCanvasRecoveryCoordinates): string {
  return [
    STORAGE_PREFIX,
    encodeURIComponent(coordinates.projectId),
    encodeURIComponent(coordinates.episodeId),
    encodeURIComponent(coordinates.frameId),
  ].join(':')
}

function sameMarker(left: StoryboardCanvasCommitRecoveryMarker, right: StoryboardCanvasCommitRecoveryMarker): boolean {
  return KEYS.every(key => left[key] === right[key])
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoValue: unknown = Reflect.get(globalThis, 'crypto')
  if (
    typeof cryptoValue !== 'object'
    || cryptoValue === null
    || !('subtle' in cryptoValue)
    || typeof cryptoValue.subtle !== 'object'
    || cryptoValue.subtle === null
    || !('digest' in cryptoValue.subtle)
    || typeof cryptoValue.subtle.digest !== 'function'
  ) throw new Error('当前浏览器不支持安全幂等键生成')
  return cryptoValue.subtle as SubtleCrypto
}

async function sha256(value: string): Promise<string> {
  const digest = await getSubtleCrypto().digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Derive one deterministic key for the exact immutable canvas ChangeSet payload. */
export async function deriveStoryboardCanvasIdempotencyKey(
  changeSetId: string,
  payloadSha256: string,
): Promise<string> {
  if (!isIdentifier(changeSetId)) throw new Error('ChangeSet ID 无效，无法生成故事板画布幂等键')
  requireSha256(payloadSha256, '故事板画布 Payload')
  return `qingmu:storyboard-canvas:commit:v1:${await sha256(changeSetId)}:${payloadSha256}`
}

/** Validate and attach the marker schema before any commit POST is sent. */
export function createStoryboardCanvasRecoveryMarker(
  coordinates: StoryboardCanvasCommitCoordinates,
): StoryboardCanvasCommitRecoveryMarker {
  return parseMarker({ schema: SCHEMA, ...coordinates }, coordinates)
}

/** Discover the frame marker while retaining its originating revision and commit lineage. */
export function readStoryboardCanvasRecoveryMarker(
  coordinates: StoryboardCanvasRecoveryCoordinates,
): StoryboardCanvasRecoveryMarkerRead {
  try {
    const serialized = sessionStorage.getItem(storageKey(coordinates))
    if (serialized === null) return { status: 'none' }
    return { status: 'ready', marker: parseMarker(JSON.parse(serialized) as unknown, coordinates, 'stored') }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Persist and synchronously verify the marker before the commit POST begins. */
export function writeStoryboardCanvasRecoveryMarker(marker: StoryboardCanvasCommitRecoveryMarker): boolean {
  try {
    const validated = parseMarker(marker, marker)
    const key = storageKey(marker)
    const serialized = JSON.stringify(validated)
    const existing = sessionStorage.getItem(key)
    if (existing !== null) return sameMarker(parseMarker(JSON.parse(existing) as unknown, marker), marker)
    sessionStorage.setItem(key, serialized)
    const stored = sessionStorage.getItem(key)
    return stored === serialized && sameMarker(parseMarker(JSON.parse(stored) as unknown, marker), marker)
  } catch {
    return false
  }
}

/** Clear only the identical marker after authoritative refresh verifies the receipt. */
export function clearStoryboardCanvasRecoveryMarker(marker: StoryboardCanvasCommitRecoveryMarker): boolean {
  try {
    const key = storageKey(marker)
    const serialized = sessionStorage.getItem(key)
    if (serialized === null) return true
    const stored = parseMarker(JSON.parse(serialized) as unknown, marker)
    if (!sameMarker(stored, marker)) return false
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}
