// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertCanonicalReferenceRightsRecord,
  createReferenceRightsDraft,
  digestReferenceRightsRecord,
  normalizeReferenceRightsDraft,
  referenceRightsRecordsEqual,
} from '../src/client/reference-rights.ts'

const UNKNOWN_RIGHTS = {
  schema: 'jason.qingmu-reference-rights-record.v1',
  sourceType: { state: 'unknown', value: null },
  rightsHolder: { state: 'unknown', value: null },
  authorizationScope: { state: 'unknown', values: [] },
  territory: { state: 'unknown', values: [] },
  term: { state: 'unknown', startsAt: null, endsAt: null, perpetual: null },
  restrictions: { state: 'unknown', values: [] },
  contains: {
    realPersonLikeness: 'unknown',
    trademark: 'unknown',
    music: 'unknown',
    font: 'unknown',
    thirdPartyCharacter: 'unknown',
  },
  providerTerms: { state: 'unknown', terms: null, reviewedAt: null },
  modelLicenses: {
    code: { state: 'unknown', value: null },
    weights: { state: 'unknown', value: null },
    outputUse: { state: 'unknown', value: null },
  },
  humanDeclaration: { state: 'unknown', text: null },
  contentCredentials: { state: 'unknown', value: null },
} as const

describe('reference rights browser boundary', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('round-trips all 11 structured rights groups into the strict normalized record', () => {
    const rights = normalizeReferenceRightsDraft({
      ...createReferenceRightsDraft(UNKNOWN_RIGHTS),
      sourceTypeState: 'known',
      sourceTypeValue: ' licensed archive ',
      rightsHolderState: 'known',
      rightsHolderValue: ' Qingmu Studio ',
      authorizationScopeState: 'known',
      authorizationScopeValues: 'adaptation\ncommercial use',
      territoryState: 'known',
      territoryValues: 'CN\nWorldwide',
      termState: 'known',
      termStartsAt: '2026-08-27T00:00:00Z',
      termEndsAt: '2036-08-27T00:00:00Z',
      termPerpetual: false,
      restrictionsState: 'known',
      restrictionsValues: 'no resale\nno biometric training',
      containsRealPersonLikeness: 'yes',
      containsTrademark: 'no',
      containsMusic: 'no',
      containsFont: 'yes',
      containsThirdPartyCharacter: 'no',
      providerTermsState: 'known',
      providerTermsValue: 'Commercial output is allowed.',
      providerTermsReviewedAt: '2026-08-27T01:02:03Z',
      modelCodeState: 'not_applicable',
      modelWeightsState: 'known',
      modelWeightsValue: 'Apache-2.0',
      modelOutputUseState: 'known',
      modelOutputUseValue: 'commercial',
      humanDeclarationState: 'provided',
      humanDeclarationText: 'I verified the source and authorization.',
      contentCredentialsState: 'known',
      contentCredentialsValue: 'c2pa:manifest-1',
    })

    expect(rights.sourceType).toEqual({ state: 'known', value: 'licensed archive' })
    expect(rights.authorizationScope.values).toEqual(['adaptation', 'commercial use'])
    expect(rights.territory.values).toEqual(['CN', 'Worldwide'])
    expect(rights.term).toEqual({
      state: 'known',
      startsAt: '2026-08-27T00:00:00Z',
      endsAt: '2036-08-27T00:00:00Z',
      perpetual: false,
    })
    expect(rights.contains.realPersonLikeness).toBe('yes')
    expect(rights.providerTerms.reviewedAt).toBe('2026-08-27T01:02:03Z')
    expect(rights.modelLicenses.weights.value).toBe('Apache-2.0')
    expect(rights.humanDeclaration.state).toBe('provided')
    expect(rights.contentCredentials.value).toBe('c2pa:manifest-1')
    expect(createReferenceRightsDraft(rights).humanDeclarationText)
      .toBe('I verified the source and authorization.')
  })

  it('fails closed for extra fields, illegal unknown values, and invalid terms', () => {
    expect(() => assertCanonicalReferenceRightsRecord({ ...UNKNOWN_RIGHTS, exceptionRelease: true }))
      .toThrow(/字段不符合权利记录合同/)
    expect(() => assertCanonicalReferenceRightsRecord({
      ...UNKNOWN_RIGHTS,
      rightsHolder: { state: 'unknown', value: 'machine guessed' },
    })).toThrow(/仅可在已知状态填写/)
    expect(() => normalizeReferenceRightsDraft({
      ...createReferenceRightsDraft(UNKNOWN_RIGHTS),
      termState: 'known',
      termStartsAt: '2026-08-28T00:00:00Z',
      termEndsAt: '2026-08-27T00:00:00Z',
    })).toThrow(/不得早于/)
  })

  it('produces a stable hash without persisting the rights body in session storage', async () => {
    sessionStorage.setItem('unrelated', 'keep')
    const first = await digestReferenceRightsRecord(UNKNOWN_RIGHTS)
    const second = await digestReferenceRightsRecord(assertCanonicalReferenceRightsRecord(UNKNOWN_RIGHTS))

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
    expect(referenceRightsRecordsEqual(UNKNOWN_RIGHTS, assertCanonicalReferenceRightsRecord(UNKNOWN_RIGHTS))).toBe(true)
    expect(sessionStorage.length).toBe(1)
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
  })
})
