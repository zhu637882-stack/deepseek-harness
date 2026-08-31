import type { LocalReferenceQualificationRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const SHA256 = /^[a-f0-9]{64}$/
const volatile = new Map<string, LocalReferenceQualificationRequest>()

function storageKey(projectId: string, elementKind: string, targetId: string): string {
  return `qingmu.local-reference-qualification.v1:${projectId}:${elementKind}:${targetId}`
}

function valid(value: unknown): value is LocalReferenceQualificationRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const marker = value as Record<string, unknown>
  return typeof marker.projectId === 'string' && marker.projectId !== ''
    && ['actor', 'scene', 'prop'].includes(String(marker.elementKind))
    && typeof marker.targetId === 'string' && marker.targetId !== ''
    && typeof marker.idempotencyKey === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(marker.idempotencyKey)
    && typeof marker.assetId === 'string' && marker.assetId !== ''
    && typeof marker.assetSha256 === 'string' && SHA256.test(marker.assetSha256)
    && typeof marker.baseRevision === 'number' && Number.isSafeInteger(marker.baseRevision) && marker.baseRevision >= 0
    && typeof marker.baseSnapshotSha256 === 'string' && SHA256.test(marker.baseSnapshotSha256)
}

/**
 * Read one safe coordinate-only qualification recovery marker.
 * @param projectId - Project bound to the marker.
 * @param elementKind - Element kind bound to the marker.
 * @param targetId - Element identifier bound to the marker.
 * @returns The validated marker when one exists, otherwise undefined.
 */
export function readLocalReferenceQualificationRecovery(
  projectId: string,
  elementKind: string,
  targetId: string,
): LocalReferenceQualificationRequest | undefined {
  const key = storageKey(projectId, elementKind, targetId)
  let value: unknown = volatile.get(key)
  try {
    const serialized = sessionStorage.getItem(key)
    if (serialized !== null) value = JSON.parse(serialized)
  } catch {
    // The in-memory marker remains the recovery source when session storage is unavailable.
  }
  if (!valid(value) || value.projectId !== projectId || value.elementKind !== elementKind || value.targetId !== targetId) {
    return undefined
  }
  return value
}

/**
 * Persist only immutable coordinates; rights declarations are deliberately excluded.
 * @param marker - Qualification request coordinates to retain for recovery.
 */
export function writeLocalReferenceQualificationRecovery(
  marker: LocalReferenceQualificationRequest,
): void {
  const key = storageKey(marker.projectId, marker.elementKind, marker.targetId)
  volatile.set(key, marker)
  try {
    sessionStorage.setItem(key, JSON.stringify(marker))
  } catch {
    // The in-memory marker still supports same-page recovery.
  }
}

/**
 * Remove the recovered qualification marker from both stores.
 * @param projectId - Project bound to the marker.
 * @param elementKind - Element kind bound to the marker.
 * @param targetId - Element identifier bound to the marker.
 */
export function clearLocalReferenceQualificationRecovery(
  projectId: string,
  elementKind: string,
  targetId: string,
): void {
  const key = storageKey(projectId, elementKind, targetId)
  volatile.delete(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    // An unavailable session store has no durable marker to clear.
  }
}
