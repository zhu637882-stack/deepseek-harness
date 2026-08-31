// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLocalReferenceQualificationRecovery,
  readLocalReferenceQualificationRecovery,
  writeLocalReferenceQualificationRecovery,
} from '../src/client/local-reference-qualification-recovery.ts'

const marker = {
  projectId: 'project-qualification-recovery',
  elementKind: 'prop' as const,
  targetId: 'prop-qualification-recovery',
  assetId: 'asset_localref_qualification_recovery',
  assetSha256: 'a'.repeat(64),
  baseRevision: 4,
  baseSnapshotSha256: 'b'.repeat(64),
  idempotencyKey: 'qualification-recovery-001',
}

describe('local reference qualification recovery marker', () => {
  afterEach(() => {
    clearLocalReferenceQualificationRecovery(marker.projectId, marker.elementKind, marker.targetId)
    sessionStorage.clear()
  })

  it('persists only immutable coordinates needed for GET-only receipt recovery', () => {
    writeLocalReferenceQualificationRecovery(marker)

    expect(readLocalReferenceQualificationRecovery(
      marker.projectId,
      marker.elementKind,
      marker.targetId,
    )).toEqual(marker)
    const serialized = Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index)
      return key === null ? '' : sessionStorage.getItem(key) ?? ''
    }).join('\n')
    expect(serialized).not.toContain('rightsHolder')
    expect(serialized).not.toContain('humanDeclaration')
    expect(serialized).not.toContain('authorizationScope')
    expect(serialized).not.toContain('token')
  })

  it('fails closed for a malformed or cross-scope marker', () => {
    sessionStorage.setItem(
      `qingmu.local-reference-qualification.v1:${marker.projectId}:${marker.elementKind}:${marker.targetId}`,
      JSON.stringify({ ...marker, assetSha256: 'not-a-sha' }),
    )
    expect(readLocalReferenceQualificationRecovery(
      marker.projectId,
      marker.elementKind,
      marker.targetId,
    )).toBeUndefined()
    expect(readLocalReferenceQualificationRecovery(
      'project-other',
      marker.elementKind,
      marker.targetId,
    )).toBeUndefined()
  })
})
