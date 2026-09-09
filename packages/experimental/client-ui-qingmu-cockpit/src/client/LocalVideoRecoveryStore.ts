import type { LocalVideoRecoveryRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export interface LocalVideoRecoveryMarker extends LocalVideoRecoveryRequest {
  readonly originalFileName: string
  readonly byteSize: number
}

export interface LocalVideoScope {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}

export type LocalVideoRecoveryRead =
  | { readonly status: 'ready'; readonly marker: LocalVideoRecoveryMarker | undefined }
  | { readonly status: 'corrupt' | 'unavailable'; readonly marker: undefined }

export type LocalVideoRecoveryWrite = 'written' | 'conflict' | 'corrupt' | 'unavailable'

const prefix = 'qingmu.local-video-recovery.v1:'
const maxBytes = 32 * 1024 * 1024
const sha256 = /^[a-f0-9]{64}$/u

export function localVideoRecoveryKey(scope: LocalVideoScope): string {
  return `${prefix}${scope.projectId}:${scope.episodeId}:${scope.frameId}`
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes(':')
}

export function localVideoRecoveryMatches(scope: LocalVideoScope, value: unknown): value is LocalVideoRecoveryMarker {
  if (value === null || typeof value !== 'object') return false
  const marker = value as Record<string, unknown>
  return marker.projectId === scope.projectId
    && marker.episodeId === scope.episodeId
    && marker.frameId === scope.frameId
    && validId(marker.projectId)
    && validId(marker.episodeId)
    && validId(marker.frameId)
    && typeof marker.idempotencyKey === 'string'
    && marker.idempotencyKey.startsWith('local-video-')
    && typeof marker.requestSha256 === 'string'
    && sha256.test(marker.requestSha256)
    && typeof marker.originalFileName === 'string'
    && marker.originalFileName.length > 0
    && !/[\\/\u0000]/u.test(marker.originalFileName)
    && typeof marker.byteSize === 'number'
    && Number.isInteger(marker.byteSize)
    && marker.byteSize > 0
    && marker.byteSize <= maxBytes
}

/** Reads only a recovery receipt locator; local video bytes and base64 are never persisted. */
export function readLocalVideoRecoveryState(scope: LocalVideoScope): LocalVideoRecoveryRead {
  let raw: string | null
  try {
    raw = localStorage.getItem(localVideoRecoveryKey(scope))
  } catch {
    return { status: 'unavailable', marker: undefined }
  }
  if (raw === null) return { status: 'ready', marker: undefined }
  try {
    const value: unknown = JSON.parse(raw)
    return localVideoRecoveryMatches(scope, value)
      ? { status: 'ready', marker: value }
      : { status: 'corrupt', marker: undefined }
  } catch {
    return { status: 'corrupt', marker: undefined }
  }
}

/** Compatibility reader for UI that has already handled unavailable/corrupt storage. */
export function readLocalVideoRecovery(scope: LocalVideoScope): LocalVideoRecoveryMarker | undefined {
  const result = readLocalVideoRecoveryState(scope)
  return result.status === 'ready' ? result.marker : undefined
}

/** The marker must be durable before a video upload may be dispatched. */
export function writeLocalVideoRecovery(scope: LocalVideoScope, marker: LocalVideoRecoveryMarker): LocalVideoRecoveryWrite {
  if (!localVideoRecoveryMatches(scope, marker)) return 'corrupt'
  const existing = readLocalVideoRecoveryState(scope)
  if (existing.status !== 'ready') return existing.status
  if (existing.marker !== undefined && (existing.marker.idempotencyKey !== marker.idempotencyKey
    || existing.marker.requestSha256 !== marker.requestSha256)) return 'conflict'
  try {
    localStorage.setItem(localVideoRecoveryKey(scope), JSON.stringify(marker))
  } catch {
    return 'unavailable'
  }
  const confirmed = readLocalVideoRecoveryState(scope)
  if (confirmed.status !== 'ready') return confirmed.status
  if (confirmed.marker?.idempotencyKey === marker.idempotencyKey
    && confirmed.marker.requestSha256 === marker.requestSha256) return 'written'
  return confirmed.marker === undefined ? 'unavailable' : 'conflict'
}

/** Does not remove a newer marker written by another explicit attempt. */
export function clearLocalVideoRecovery(scope: LocalVideoScope, expected: LocalVideoRecoveryMarker): boolean {
  const read = readLocalVideoRecoveryState(scope)
  const current = read.status === 'ready' ? read.marker : undefined
  if (current === undefined || current.idempotencyKey !== expected.idempotencyKey
    || current.requestSha256 !== expected.requestSha256) return false
  try {
    localStorage.removeItem(localVideoRecoveryKey(scope))
  } catch {
    return false
  }
  const confirmed = readLocalVideoRecoveryState(scope)
  return confirmed.status === 'ready' && confirmed.marker === undefined
}
