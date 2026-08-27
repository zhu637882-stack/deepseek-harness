import { describe, expect, it } from 'vitest'
import { normalizeContinuityDelta } from '../src/continuity.ts'
import type { YimengContinuityDeltaProjection } from '../src/types.ts'
import { continuityFixture, continuityJson, continuityRelations, rebindContinuity } from './continuity-fixture.ts'

const normalize = (value: unknown) => normalizeContinuityDelta(value, continuityRelations(), continuityJson)

describe('continuity evidence normalization', () => {
  it('preserves current facts with the cross-language golden SHA and non-lexical order', () => {
    const value = continuityFixture()
    expect(value.snapshotSha256).toBe('fec36f9349031cf2e568121184081bd2e127b28f5fa255deb6e47fbfd77b150c')
    expect(normalize(value)).toEqual(value)
    expect(value.pairs[0]?.fromShotId).toBe('frame-z')
  })

  it('preserves a historical pass without claiming current selected-asset readiness', () => {
    const value = continuityFixture()
    const historical = rebindContinuity({ ...value, pairs: value.pairs.map(pair => ({
      ...pair, currentBinding: { ...pair.currentBinding, tailAssetId: 'new-tail', tailSha256: 'e'.repeat(64) },
      bindingStatus: 'different', currentEvidenceReady: false,
    })) })
    expect(normalize(historical).pairs[0]).toMatchObject({ legacyEvidenceReady: true, currentEvidenceReady: false, bindingStatus: 'different' })
  })

  it('preserves unavailable dimension values instead of inventing failed findings', () => {
    const value = continuityFixture()
    const missing = rebindContinuity({ ...value, pairs: value.pairs.map(pair => ({
      ...pair, legacyEvidenceReady: false, currentEvidenceReady: false, legacyStatus: 'blocked',
      audit: { ...pair.audit, passed: null, dimensions: pair.audit.dimensions.map(item => ({ ...item, result: null, reason: null })) },
    })) })
    expect(normalize(missing).pairs[0]?.audit.dimensions.every(item => item.result === null)).toBe(true)
  })

  it.each(['tailFromSelectedVideo', 'nextFirstFrameSelected', 'nextFirstFrameStale', 'staleHandoff'] as const)(
    'declines current readiness when the %s lineage condition changes', (field) => {
      const value = continuityFixture()
      const changed = rebindContinuity({ ...value, pairs: value.pairs.map(pair => ({
        ...pair, currentBinding: { ...pair.currentBinding, [field]: !pair.currentBinding[field] }, currentEvidenceReady: false,
      })) })
      expect(normalize(changed).pairs[0]?.currentEvidenceReady).toBe(false)
      const forged = rebindContinuity({ ...changed, pairs: changed.pairs.map(pair => ({ ...pair, currentEvidenceReady: true })) })
      expect(() => normalize(forged)).toThrow('current verification')
    },
  )

  it.each([
    ['wrong subject', (value: YimengContinuityDeltaProjection) => ({ ...value, episodeId: 'another-episode' })],
    ['non-adjacent pair', (value: YimengContinuityDeltaProjection) => ({ ...value, pairs: value.pairs.map(pair => ({ ...pair, fromShotId: 'display-shot-7' })) })],
    ['wrong digest', (value: YimengContinuityDeltaProjection) => ({ ...value, snapshotSha256: '0'.repeat(64) })],
    ['new authority field', (value: YimengContinuityDeltaProjection) => ({ ...value, approved: true })],
    ['missing pair', (value: YimengContinuityDeltaProjection) => ({ ...value, pairs: [] })],
    ['reordered dimensions', (value: YimengContinuityDeltaProjection) => ({ ...value, pairs: value.pairs.map(pair => ({ ...pair, audit: { ...pair.audit, dimensions: [...pair.audit.dimensions].reverse() } })) })],
  ])('rejects %s', (_name, mutate) => {
    expect(() => normalize(mutate(continuityFixture()))).toThrow()
  })

  it('requires an explicit unavailable reason and no pair data', () => {
    const value = rebindContinuity({ ...continuityFixture(), availability: 'unavailable', reason: 'source_missing', pairs: [] })
    expect(normalize(value).availability).toBe('unavailable')
    expect(() => normalize(rebindContinuity({ ...value, reason: null }))).toThrow('unavailable')
  })

  it('rejects a well-hashed contradiction in historical audit readiness', () => {
    const value = continuityFixture()
    const forged = rebindContinuity({ ...value, pairs: value.pairs.map(pair => ({ ...pair, audit: { ...pair.audit, passed: false } })) })
    expect(() => normalize(forged)).toThrow('current verification')
  })

  it.each(['checkId', 'createdAt', 'tailAssetId', 'tailSha256', 'nextFirstFrameAssetId', 'nextFirstFrameSha256'] as const)(
    'requires the original audit %s for a historical-ready claim', (field) => {
      const value = continuityFixture()
      const forged = rebindContinuity({ ...value, pairs: value.pairs.map(pair => ({
        ...pair, audit: { ...pair.audit, [field]: null }, currentEvidenceReady: false,
        bindingStatus: field === 'checkId' || field === 'createdAt' ? 'current' : 'unavailable',
      })) })
      expect(() => normalize(forged)).toThrow('current verification')
    },
  )

  it('rejects malformed Unicode instead of normalizing a different byte source', () => {
    const value = continuityFixture()
    const broken = rebindContinuity({ ...value, pairs: value.pairs.map(pair => ({ ...pair, warnings: ['\ud800'] })) })
    expect(() => normalize(broken)).toThrow()
  })
})
