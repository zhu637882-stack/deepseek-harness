// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCommandCommitRecoveryMarker,
  createCommandCommitRecoveryMarker,
  digestCommandRecoveryHumanDecisions,
  digestCommandRecoveryVisualBaseline,
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

const RIGHTS_INPUT = {
  ...INPUT,
  operation: 'replaceReferenceRights',
  referenceAssetId: 'asset-1',
  referenceAssetSha256: 'c'.repeat(64),
  referenceRightsSha256: 'd'.repeat(64),
  preCommitVisualBaselineSha256: 'e'.repeat(64),
  preCommitHumanDecisionsSha256: 'f'.repeat(64),
  selectionStatus: 'Selected',
  isSelected: true,
} as const

beforeEach(() => { sessionStorage.clear() })

describe('element command commit recovery marker v4', () => {
  it('derives a deterministic key within the backend limit for a full-length ChangeSet ID', async () => {
    const fullLengthId = 'x'.repeat(256)
    const key = await deriveCommandIdempotencyKey(fullLengthId, INPUT.payloadSha256)

    expect(key).toMatch(/^qingmu:element:v4:[0-9a-f]{64}:[0-9a-f]{64}$/)
    expect(key.length).toBeLessThanOrEqual(200)
    expect(await deriveCommandIdempotencyKey(fullLengthId, INPUT.payloadSha256)).toBe(key)
    expect(await deriveCommandIdempotencyKey(`${'x'.repeat(255)}y`, INPUT.payloadSha256)).not.toBe(key)
    expect(createCommandCommitRecoveryMarker({ ...INPUT, changeSetId: fullLengthId, idempotencyKey: key }))
      .toMatchObject({ changeSetId: fullLengthId, idempotencyKey: key })
  })

  it('digests visual baselines and HumanDecision events without treating stale derivation or order as mutations', async () => {
    const visual = {
      visualPrompt: '一枚银色怀表。',
      officialReferenceImageUrl: '/media/props/watch.png',
    }
    expect(await digestCommandRecoveryVisualBaseline(visual)).toBe(
      await digestCommandRecoveryVisualBaseline({ ...visual }),
    )
    expect(await digestCommandRecoveryVisualBaseline(visual)).not.toBe(
      await digestCommandRecoveryVisualBaseline({ ...visual, visualPrompt: '被篡改的提示词' }),
    )
    const decision = {
      id: 'decision-1',
      subjectType: 'element_profile',
      subjectId: 'prop-1',
      subjectRevision: 3,
      subjectSha256: 'a'.repeat(64),
      decision: 'approve',
      reason: '素材身份与用途已核验。',
      actorId: 'approver-1',
      actorRole: 'approver',
      authSessionId: 'session-1',
      decidedAt: '2026-08-27T09:00:00+00:00',
      stale: false,
    }
    const second = { ...decision, id: 'decision-2', decidedAt: '2026-08-27T09:01:00+00:00' }
    const baseline = await digestCommandRecoveryHumanDecisions([decision, second])
    expect(await digestCommandRecoveryHumanDecisions([
      { ...second, stale: true },
      { ...decision, stale: true },
    ])).toBe(baseline)
    expect(await digestCommandRecoveryHumanDecisions([
      { ...decision, reason: '被篡改的正式决定理由' },
      second,
    ])).not.toBe(baseline)
    expect(await digestCommandRecoveryHumanDecisions([decision])).not.toBe(baseline)
    expect(await digestCommandRecoveryHumanDecisions([
      decision,
      second,
      { ...decision, id: 'decision-3' },
    ])).not.toBe(baseline)
  })

  it('round-trips exact element lineage under a key isolated from script recovery', () => {
    const marker = createCommandCommitRecoveryMarker(INPUT)

    expect(writeCommandCommitRecoveryMarker(marker)).toBe(true)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'ready', marker })
    expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))).toEqual([
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-1',
    ])
  })

  it('round-trips exact reference operation and candidate lineage', () => {
    const marker = createCommandCommitRecoveryMarker(REFERENCE_INPUT)

    expect(writeCommandCommitRecoveryMarker(marker)).toBe(true)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'ready', marker })
    expect(marker).toMatchObject({
      schema: 'qingmu.command-commit-recovery-marker.v4',
      operation: 'selectReferenceAsset',
      candidateAssetId: 'asset-1',
      candidateAssetSha256: 'c'.repeat(64),
    })
  })

  it('stores only rights digest, immutable asset lineage, and pre-commit selection facts', () => {
    const marker = createCommandCommitRecoveryMarker(RIGHTS_INPUT)

    expect(writeCommandCommitRecoveryMarker(marker)).toBe(true)
    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({ status: 'ready', marker })
    expect(marker).toEqual({ schema: 'qingmu.command-commit-recovery-marker.v4', ...RIGHTS_INPUT })
    const serialized = sessionStorage.getItem(
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-1',
    )
    expect(serialized).not.toBeNull()
    expect(serialized).not.toContain('rightsHolder')
    expect(serialized).not.toContain('authorizationScope')
    expect(Object.keys(JSON.parse(serialized ?? '{}')).sort()).toEqual([
      'baseRevision',
      'baseSnapshotSha256',
      'changeSetId',
      'elementKind',
      'idempotencyKey',
      'isSelected',
      'operation',
      'payloadSha256',
      'preCommitHumanDecisionsSha256',
      'preCommitVisualBaselineSha256',
      'projectId',
      'referenceAssetId',
      'referenceAssetSha256',
      'referenceRightsSha256',
      'schema',
      'selectionStatus',
      'targetId',
      'targetType',
    ].sort())
    expect(() => createCommandCommitRecoveryMarker({
      ...RIGHTS_INPUT,
      rights: { rightsHolder: 'must-not-persist' },
    } as unknown as typeof RIGHTS_INPUT)).toThrow('恢复标记字段不符合合同')
  })

  it('fails closed on a pre-baseline v4 rights marker until it is discarded', () => {
    const legacyRightsInput = Object.fromEntries(Object.entries(RIGHTS_INPUT).filter(([key]) => (
      key !== 'preCommitVisualBaselineSha256' && key !== 'preCommitHumanDecisionsSha256'
    )))
    sessionStorage.setItem(
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-1',
      JSON.stringify({ schema: 'qingmu.command-commit-recovery-marker.v4', ...legacyRightsInput }),
    )

    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({
      status: 'invalid',
      error: '恢复标记字段不符合合同',
    })
    expect(discardCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toBe(true)
  })

  it('fails closed on a legacy v3 marker until that exact subject marker is discarded', () => {
    sessionStorage.setItem(
      'qingmu:command-commit-recovery:v3:project-1:element_profile:prop:prop-1',
      JSON.stringify({
        schema: 'qingmu.command-commit-recovery-marker.v3',
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
    expect(() => createCommandCommitRecoveryMarker({
      ...RIGHTS_INPUT,
      referenceRightsSha256: undefined,
    } as unknown as typeof RIGHTS_INPUT)).toThrow('恢复标记权利记录 SHA-256 无效')
    expect(() => createCommandCommitRecoveryMarker({
      ...RIGHTS_INPUT,
      preCommitVisualBaselineSha256: undefined,
    } as unknown as typeof RIGHTS_INPUT)).toThrow('恢复标记提交前视觉基线 SHA-256 无效')
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
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-1',
      JSON.stringify({ ...createCommandCommitRecoveryMarker(INPUT), baseRevision: -1 }),
    )
    sessionStorage.setItem(
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-2',
      'keep',
    )

    expect(readCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toEqual({
      status: 'invalid',
      error: '恢复标记基线修订号无效',
    })
    expect(discardCommandCommitRecoveryMarker('project-1', 'prop', 'prop-1')).toBe(true)
    expect(sessionStorage.getItem(
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-2',
    )).toBe('keep')
  })
})
