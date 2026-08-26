// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCommandCommitRecoveryMarker,
  createCommandCommitRecoveryMarker,
  deriveCommandIdempotencyKey,
  discardCommandCommitRecoveryMarker,
  readCommandCommitRecoveryMarker,
  writeCommandCommitRecoveryMarker,
} from '../src/client/command-commit-recovery.ts'

const INPUT = {
  projectId: 'project-1',
  targetType: 'element_profile',
  elementKind: 'prop',
  targetId: 'prop-1',
  changeSetId: 'changeset-1',
  baseRevision: 3,
  baseSnapshotSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64),
  idempotencyKey: 'qingmu:element:changeset-1',
  operation: 'replaceVisualPrompt',
} as const

const REFERENCE_INPUT = {
  ...INPUT,
  operation: 'selectReferenceAsset',
  candidateAssetId: 'asset-1',
  candidateAssetSha256: 'c'.repeat(64),
} as const

beforeEach(() => { sessionStorage.clear() })

describe('element command commit recovery marker v3', () => {
  it('derives a deterministic key within the backend limit for a full-length ChangeSet ID', async () => {
    const fullLengthId = 'x'.repeat(256)
    const key = await deriveCommandIdempotencyKey(fullLengthId, INPUT.payloadSha256)

    expect(key).toMatch(/^qingmu:element:v3:[0-9a-f]{64}:[0-9a-f]{64}$/)
    expect(key.length).toBeLessThanOrEqual(200)
    expect(await deriveCommandIdempotencyKey(fullLengthId, INPUT.payloadSha256)).toBe(key)
    expect(await deriveCommandIdempotencyKey(`${'x'.repeat(255)}y`, INPUT.payloadSha256)).not.toBe(key)
    expect(createCommandCommitRecoveryMarker({ ...INPUT, changeSetId: fullLengthId, idempotencyKey: key }))
      .toMatchObject({ changeSetId: fullLengthId, idempotencyKey: key })
  })

  it('round-trips exact element lineage under a key isolated from script recovery', () => {
    const marker = createCommandCommitRecoveryMarker(INPUT)

    expect(writeCommandCommitRecoveryMarker(marker)).toBe(true)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'ready', marker })
    expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))).toEqual([
      'qingmu:command-commit-recovery:v3:project-1:element_profile:prop:prop-1',
    ])
  })

  it('round-trips exact reference operation and candidate lineage', () => {
    const marker = createCommandCommitRecoveryMarker(REFERENCE_INPUT)

    expect(writeCommandCommitRecoveryMarker(marker)).toBe(true)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'ready', marker })
    expect(marker).toMatchObject({
      schema: 'qingmu.command-commit-recovery-marker.v3',
      operation: 'selectReferenceAsset',
      candidateAssetId: 'asset-1',
      candidateAssetSha256: 'c'.repeat(64),
    })
  })

  it('fails closed on a legacy v2 marker until that exact subject marker is discarded', () => {
    sessionStorage.setItem(
      'qingmu:command-commit-recovery:v2:project-1:element_profile:prop:prop-1',
      JSON.stringify({
        schema: 'qingmu.command-commit-recovery-marker.v2',
        projectId: INPUT.projectId,
        targetType: INPUT.targetType,
        elementKind: INPUT.elementKind,
        targetId: INPUT.targetId,
        changeSetId: INPUT.changeSetId,
        baseRevision: INPUT.baseRevision,
        baseSnapshotSha256: INPUT.baseSnapshotSha256,
        payloadSha256: INPUT.payloadSha256,
        idempotencyKey: INPUT.idempotencyKey,
      }),
    )

    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({
      status: 'invalid',
      error: '检测到旧版恢复标记，必须先丢弃后才能继续',
    })
    expect(discardCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toBe(true)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'none' })
  })

  it('rejects operation drift and incomplete reference candidate lineage', () => {
    expect(() => createCommandCommitRecoveryMarker({
      ...INPUT,
      operation: 'replaceVisualIdentity',
    })).toThrow('恢复标记操作与 Element Kind 不匹配')
    expect(() => createCommandCommitRecoveryMarker({
      ...REFERENCE_INPUT,
      candidateAssetSha256: undefined,
    } as unknown as typeof REFERENCE_INPUT)).toThrow('恢复标记候选资产 SHA-256 无效')
  })

  it('does not clear a different marker written for the same subject', () => {
    const first = createCommandCommitRecoveryMarker(INPUT)
    const second = createCommandCommitRecoveryMarker({
      ...INPUT,
      changeSetId: 'changeset-2',
      payloadSha256: 'c'.repeat(64),
    })
    expect(writeCommandCommitRecoveryMarker(second)).toBe(true)

    expect(clearCommandCommitRecoveryMarker(first)).toBe(false)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'ready', marker: second })
  })

  it('retains malformed storage as invalid and discards only the requested element key', () => {
    sessionStorage.setItem(
      'qingmu:command-commit-recovery:v3:project-1:element_profile:prop:prop-1',
      JSON.stringify({ ...createCommandCommitRecoveryMarker(INPUT), baseRevision: -1 }),
    )
    sessionStorage.setItem(
      'qingmu:command-commit-recovery:v3:project-1:element_profile:prop:prop-2',
      'keep',
    )

    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({
      status: 'invalid',
      error: '恢复标记基线修订号无效',
    })
    expect(discardCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toBe(true)
    expect(sessionStorage.getItem(
      'qingmu:command-commit-recovery:v3:project-1:element_profile:prop:prop-2',
    )).toBe('keep')
  })
})
