// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  clearReferenceRightsExceptionReleaseRecoveryMarker,
  createReferenceRightsExceptionReleaseRecoveryMarker,
  deriveReferenceRightsExceptionIdempotencyKey,
  digestReferenceRightsExceptionReason,
  digestReferenceRightsExceptionScope,
  discardReferenceRightsExceptionReleaseRecoveryMarker,
  normalizeReferenceRightsExceptionScope,
  readReferenceRightsExceptionReleaseRecoveryMarker,
  writeReferenceRightsExceptionReleaseRecoveryMarker,
} from '../src/client/reference-rights-exception-release-recovery.ts'

const SCOPE = {
  kind: 'reference_rights',
  referenceAssetId: 'asset-1',
  referenceAssetSha256: 'b'.repeat(64),
  rightsRecordSha256: 'c'.repeat(64),
  rightsFields: ['rightsHolder', 'sourceType'],
} as const

beforeEach(() => { sessionStorage.clear() })

describe('reference-rights exception-release recovery marker v1', () => {
  it('normalizes only the 11 legal rights fields as a non-empty unique finite scope', () => {
    expect(normalizeReferenceRightsExceptionScope(SCOPE)).toEqual({
      ...SCOPE,
      rightsFields: ['sourceType', 'rightsHolder'],
    })
    expect(() => normalizeReferenceRightsExceptionScope({ ...SCOPE, rightsFields: [] }))
      .toThrow('至少选择一个权利字段')
    expect(() => normalizeReferenceRightsExceptionScope({
      ...SCOPE,
      rightsFields: ['rightsHolder', 'rightsHolder'],
    })).toThrow('不得重复')
    expect(() => normalizeReferenceRightsExceptionScope({
      ...SCOPE,
      rightsFields: ['futureRightsField'],
    })).toThrow('未授权')
    expect(() => normalizeReferenceRightsExceptionScope({
      ...SCOPE,
      projectId: '*',
    })).toThrow('字段不符合合同')
  })

  it('derives digests and a deterministic bounded idempotency key from exact coordinates', async () => {
    const reason = '权利人已书面确认本次素材用途。'
    const reasonSha256 = await digestReferenceRightsExceptionReason(reason)
    const scopeSha256 = await digestReferenceRightsExceptionScope(SCOPE)
    const canonicalScope = JSON.stringify({
      kind: 'reference_rights',
      referenceAssetId: SCOPE.referenceAssetId,
      referenceAssetSha256: SCOPE.referenceAssetSha256,
      rightsFields: ['sourceType', 'rightsHolder'],
      rightsRecordSha256: SCOPE.rightsRecordSha256,
    })
    const coordinates = {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
      expectedSubjectRevision: 3,
      expectedSubjectSha256: 'a'.repeat(64),
      referenceAssetId: SCOPE.referenceAssetId,
      referenceAssetSha256: SCOPE.referenceAssetSha256,
      rightsRecordSha256: SCOPE.rightsRecordSha256,
      reasonSha256,
      scopeSha256,
    } as const
    const key = await deriveReferenceRightsExceptionIdempotencyKey(coordinates)

    expect(reasonSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(scopeSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(reasonSha256).toBe(createHash('sha256').update(JSON.stringify(reason), 'utf8').digest('hex'))
    expect(scopeSha256).toBe(createHash('sha256').update(canonicalScope, 'utf8').digest('hex'))
    expect(key).toMatch(/^qingmu:rights-exception:v1:[0-9a-f]{64}$/)
    expect(key.length).toBeLessThanOrEqual(200)
    expect(await deriveReferenceRightsExceptionIdempotencyKey(coordinates)).toBe(key)
    expect(await deriveReferenceRightsExceptionIdempotencyKey({
      ...coordinates,
      expectedSubjectRevision: 4,
    })).not.toBe(key)
  })

  it('stores only the explicitly allowed lineage and digests, then synchronously reads it back', async () => {
    const reason = '权利人已书面确认本次素材用途。'
    const markerWithoutKey = {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
      expectedSubjectRevision: 3,
      expectedSubjectSha256: 'a'.repeat(64),
      referenceAssetId: SCOPE.referenceAssetId,
      referenceAssetSha256: SCOPE.referenceAssetSha256,
      rightsRecordSha256: SCOPE.rightsRecordSha256,
      reasonSha256: await digestReferenceRightsExceptionReason(reason),
      scopeSha256: await digestReferenceRightsExceptionScope(SCOPE),
    } as const
    const marker = createReferenceRightsExceptionReleaseRecoveryMarker({
      ...markerWithoutKey,
      idempotencyKey: await deriveReferenceRightsExceptionIdempotencyKey(markerWithoutKey),
    })

    expect(writeReferenceRightsExceptionReleaseRecoveryMarker(marker)).toBe(true)
    expect(readReferenceRightsExceptionReleaseRecoveryMarker('project-1', 'prop', 'prop-1'))
      .toEqual({ status: 'ready', marker })
    const key = sessionStorage.key(0)
    expect(key).toBe('qingmu:reference-rights-exception-release-recovery:v1:project-1:prop:prop-1')
    const serialized = sessionStorage.getItem(key ?? '') ?? ''
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual([
      'projectId',
      'elementKind',
      'targetId',
      'expectedSubjectRevision',
      'expectedSubjectSha256',
      'referenceAssetId',
      'referenceAssetSha256',
      'rightsRecordSha256',
      'reasonSha256',
      'scopeSha256',
      'idempotencyKey',
    ].sort())
    for (const forbidden of [
      reason,
      'rightsHolder',
      'actorId',
      'naturalPersonId',
      'actorRole',
      'authSessionId',
      'decidedAt',
      'changeSetId',
      'commandReceiptId',
      'eventId',
      'payloadSha256',
    ]) expect(serialized).not.toContain(forbidden)
  })

  it('fails closed on malformed or extra fields and clears only the identical marker', async () => {
    const input = {
      projectId: 'project-1',
      elementKind: 'prop',
      targetId: 'prop-1',
      expectedSubjectRevision: 3,
      expectedSubjectSha256: 'a'.repeat(64),
      referenceAssetId: SCOPE.referenceAssetId,
      referenceAssetSha256: SCOPE.referenceAssetSha256,
      rightsRecordSha256: SCOPE.rightsRecordSha256,
      reasonSha256: await digestReferenceRightsExceptionReason('精确理由'),
      scopeSha256: await digestReferenceRightsExceptionScope(SCOPE),
    } as const
    const marker = createReferenceRightsExceptionReleaseRecoveryMarker({
      ...input,
      idempotencyKey: await deriveReferenceRightsExceptionIdempotencyKey(input),
    })
    const changed = createReferenceRightsExceptionReleaseRecoveryMarker({
      ...marker,
      expectedSubjectRevision: 4,
    })
    expect(writeReferenceRightsExceptionReleaseRecoveryMarker(changed)).toBe(true)
    expect(clearReferenceRightsExceptionReleaseRecoveryMarker(marker)).toBe(false)
    expect(readReferenceRightsExceptionReleaseRecoveryMarker('project-1', 'prop', 'prop-1'))
      .toEqual({ status: 'ready', marker: changed })

    sessionStorage.setItem(
      'qingmu:reference-rights-exception-release-recovery:v1:project-1:prop:prop-1',
      JSON.stringify({ ...marker, actorId: 'must-not-exist' }),
    )
    expect(readReferenceRightsExceptionReleaseRecoveryMarker('project-1', 'prop', 'prop-1'))
      .toEqual({ status: 'invalid', error: '异常放行恢复标记字段不符合合同' })
    expect(discardReferenceRightsExceptionReleaseRecoveryMarker('project-1', 'prop', 'prop-1')).toBe(true)
    expect(readReferenceRightsExceptionReleaseRecoveryMarker('project-1', 'prop', 'prop-1'))
      .toEqual({ status: 'none' })
  })
})
