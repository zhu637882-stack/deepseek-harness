import type { QingmuCockpitKey } from './locales.ts'
import type { YimengReferenceRightsRecord } from './contracts.ts'
import type {
  ReferenceContainsState,
  ReferenceDeclarationState,
  ReferenceRightsDraft,
  ReferenceRightsKnowledgeState,
} from './reference-rights.ts'
import css from './QingmuCockpit.module.css'

interface ReferenceRightsEditorProps {
  readonly value: ReferenceRightsDraft
  readonly disabled: boolean
  readonly onChange: (value: ReferenceRightsDraft) => void
  readonly t: (key: QingmuCockpitKey) => string
}

interface ReferenceRightsSummaryProps {
  readonly value: YimengReferenceRightsRecord
  readonly t: (key: QingmuCockpitKey) => string
}

const KNOWLEDGE_OPTIONS = [
  ['known', 'assetRightsStateKnown'],
  ['unknown', 'assetRightsStateUnknown'],
  ['not_applicable', 'assetRightsStateNotApplicable'],
] as const satisfies readonly (readonly [ReferenceRightsKnowledgeState, QingmuCockpitKey])[]

const CONTAINS_OPTIONS = [
  ['yes', 'assetRightsContainsYes'],
  ['no', 'assetRightsContainsNo'],
  ['unknown', 'assetRightsContainsUnknown'],
] as const satisfies readonly (readonly [ReferenceContainsState, QingmuCockpitKey])[]

const DECLARATION_OPTIONS = [
  ['provided', 'assetRightsDeclarationProvided'],
  ['unknown', 'assetRightsStateUnknown'],
  ['not_applicable', 'assetRightsStateNotApplicable'],
] as const satisfies readonly (readonly [ReferenceDeclarationState, QingmuCockpitKey])[]

function KnowledgeSelect({
  value,
  disabled,
  onChange,
  t,
}: {
  readonly value: ReferenceRightsKnowledgeState
  readonly disabled: boolean
  readonly onChange: (value: ReferenceRightsKnowledgeState) => void
  readonly t: (key: QingmuCockpitKey) => string
}) {
  return (
    <select
      aria-label={t('assetRightsState')}
      value={value}
      disabled={disabled}
      onChange={(event) => { onChange(event.target.value as ReferenceRightsKnowledgeState) }}
    >
      {KNOWLEDGE_OPTIONS.map(([option, key]) => <option value={option} key={option}>{t(key)}</option>)}
    </select>
  )
}

function ScalarEditor({
  label,
  state,
  value,
  disabled,
  onState,
  onValue,
  t,
}: {
  readonly label: QingmuCockpitKey
  readonly state: ReferenceRightsKnowledgeState
  readonly value: string
  readonly disabled: boolean
  readonly onState: (value: ReferenceRightsKnowledgeState) => void
  readonly onValue: (value: string) => void
  readonly t: (key: QingmuCockpitKey) => string
}) {
  return (
    <label className={css.rightsField}>
      <span>{t(label)}</span>
      <div className={css.rightsControlRow}>
        <KnowledgeSelect value={state} disabled={disabled} onChange={onState} t={t} />
        <input
          aria-label={`${t(label)} · ${t('assetRightsValue')}`}
          value={value}
          maxLength={4000}
          disabled={disabled || state !== 'known'}
          onChange={(event) => { onValue(event.target.value) }}
        />
      </div>
    </label>
  )
}

function ListEditor({
  label,
  state,
  value,
  disabled,
  onState,
  onValue,
  t,
}: {
  readonly label: QingmuCockpitKey
  readonly state: ReferenceRightsKnowledgeState
  readonly value: string
  readonly disabled: boolean
  readonly onState: (value: ReferenceRightsKnowledgeState) => void
  readonly onValue: (value: string) => void
  readonly t: (key: QingmuCockpitKey) => string
}) {
  return (
    <label className={css.rightsField}>
      <span>{t(label)}</span>
      <KnowledgeSelect value={state} disabled={disabled} onChange={onState} t={t} />
      <textarea
        aria-label={`${t(label)} · ${t('assetRightsValues')}`}
        value={value}
        maxLength={4000}
        rows={3}
        disabled={disabled || state !== 'known'}
        onChange={(event) => { onValue(event.target.value) }}
      />
      <small>{t('assetRightsValuesHint')}</small>
    </label>
  )
}

function ContainsEditor({
  label,
  value,
  disabled,
  onChange,
  t,
}: {
  readonly label: QingmuCockpitKey
  readonly value: ReferenceContainsState
  readonly disabled: boolean
  readonly onChange: (value: ReferenceContainsState) => void
  readonly t: (key: QingmuCockpitKey) => string
}) {
  return (
    <label className={css.rightsField}>
      <span>{t(label)}</span>
      <select
        aria-label={t(label)}
        value={value}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value as ReferenceContainsState) }}
      >
        {CONTAINS_OPTIONS.map(([option, key]) => <option value={option} key={option}>{t(key)}</option>)}
      </select>
    </label>
  )
}

/** Complete structured editor for the normalized reference-rights record. */
export function ReferenceRightsEditor({ value, disabled, onChange, t }: ReferenceRightsEditorProps) {
  const update = <Key extends keyof ReferenceRightsDraft,>(key: Key, next: ReferenceRightsDraft[Key]): void => {
    onChange({ ...value, [key]: next })
  }

  return (
    <fieldset className={css.rightsEditor} disabled={disabled}>
      <legend>{t('assetRightsEditorTitle')}</legend>
      <p>{t('assetRightsEditorBoundary')}</p>
      <div className={css.rightsGrid}>
        <ScalarEditor
          label="assetRightsSourceType"
          state={value.sourceTypeState}
          value={value.sourceTypeValue}
          disabled={disabled}
          onState={(next) => { update('sourceTypeState', next) }}
          onValue={(next) => { update('sourceTypeValue', next) }}
          t={t}
        />
        <ScalarEditor
          label="assetRightsHolder"
          state={value.rightsHolderState}
          value={value.rightsHolderValue}
          disabled={disabled}
          onState={(next) => { update('rightsHolderState', next) }}
          onValue={(next) => { update('rightsHolderValue', next) }}
          t={t}
        />
        <ListEditor
          label="assetRightsAuthorizationScope"
          state={value.authorizationScopeState}
          value={value.authorizationScopeValues}
          disabled={disabled}
          onState={(next) => { update('authorizationScopeState', next) }}
          onValue={(next) => { update('authorizationScopeValues', next) }}
          t={t}
        />
        <ListEditor
          label="assetRightsTerritory"
          state={value.territoryState}
          value={value.territoryValues}
          disabled={disabled}
          onState={(next) => { update('territoryState', next) }}
          onValue={(next) => { update('territoryValues', next) }}
          t={t}
        />
      </div>

      <fieldset className={css.rightsGroup}>
        <legend>{t('assetRightsTerm')}</legend>
        <KnowledgeSelect value={value.termState} disabled={disabled} onChange={(next) => { update('termState', next) }} t={t} />
        <div className={css.rightsGrid}>
          <label className={css.rightsField}>
            <span>{t('assetRightsStartsAt')}</span>
            <input
              aria-label={t('assetRightsStartsAt')}
              value={value.termStartsAt}
              placeholder="2030-01-01T00:00:00Z"
              disabled={disabled || value.termState !== 'known'}
              onChange={(event) => { update('termStartsAt', event.target.value) }}
            />
          </label>
          <label className={css.rightsField}>
            <span>{t('assetRightsEndsAt')}</span>
            <input
              aria-label={t('assetRightsEndsAt')}
              value={value.termEndsAt}
              placeholder="2031-01-01T00:00:00Z"
              disabled={disabled || value.termState !== 'known' || value.termPerpetual}
              onChange={(event) => { update('termEndsAt', event.target.value) }}
            />
          </label>
        </div>
        <label className={css.rightsCheck}>
          <input
            type="checkbox"
            checked={value.termPerpetual}
            disabled={disabled || value.termState !== 'known'}
            onChange={(event) => { update('termPerpetual', event.target.checked) }}
          />
          <span>{t('assetRightsPerpetual')}</span>
        </label>
      </fieldset>

      <ListEditor
        label="assetRightsRestrictions"
        state={value.restrictionsState}
        value={value.restrictionsValues}
        disabled={disabled}
        onState={(next) => { update('restrictionsState', next) }}
        onValue={(next) => { update('restrictionsValues', next) }}
        t={t}
      />

      <fieldset className={css.rightsGroup}>
        <legend>{t('assetRightsContains')}</legend>
        <div className={css.rightsContainsGrid}>
          <ContainsEditor label="assetRightsRealPerson" value={value.containsRealPersonLikeness} disabled={disabled} onChange={(next) => { update('containsRealPersonLikeness', next) }} t={t} />
          <ContainsEditor label="assetRightsTrademark" value={value.containsTrademark} disabled={disabled} onChange={(next) => { update('containsTrademark', next) }} t={t} />
          <ContainsEditor label="assetRightsMusic" value={value.containsMusic} disabled={disabled} onChange={(next) => { update('containsMusic', next) }} t={t} />
          <ContainsEditor label="assetRightsFont" value={value.containsFont} disabled={disabled} onChange={(next) => { update('containsFont', next) }} t={t} />
          <ContainsEditor label="assetRightsThirdPartyCharacter" value={value.containsThirdPartyCharacter} disabled={disabled} onChange={(next) => { update('containsThirdPartyCharacter', next) }} t={t} />
        </div>
      </fieldset>

      <fieldset className={css.rightsGroup}>
        <legend>{t('assetRightsProviderTerms')}</legend>
        <KnowledgeSelect value={value.providerTermsState} disabled={disabled} onChange={(next) => { update('providerTermsState', next) }} t={t} />
        <div className={css.rightsGrid}>
          <label className={css.rightsField}>
            <span>{t('assetRightsTerms')}</span>
            <textarea
              aria-label={t('assetRightsTerms')}
              value={value.providerTermsValue}
              maxLength={4000}
              rows={3}
              disabled={disabled || value.providerTermsState !== 'known'}
              onChange={(event) => { update('providerTermsValue', event.target.value) }}
            />
          </label>
          <label className={css.rightsField}>
            <span>{t('assetRightsReviewedAt')}</span>
            <input
              aria-label={t('assetRightsReviewedAt')}
              value={value.providerTermsReviewedAt}
              placeholder="2030-01-01T00:00:00Z"
              disabled={disabled || value.providerTermsState !== 'known'}
              onChange={(event) => { update('providerTermsReviewedAt', event.target.value) }}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={css.rightsGroup}>
        <legend>{t('assetRightsModelLicenses')}</legend>
        <div className={css.rightsGrid}>
          <ScalarEditor label="assetRightsModelCode" state={value.modelCodeState} value={value.modelCodeValue} disabled={disabled} onState={(next) => { update('modelCodeState', next) }} onValue={(next) => { update('modelCodeValue', next) }} t={t} />
          <ScalarEditor label="assetRightsModelWeights" state={value.modelWeightsState} value={value.modelWeightsValue} disabled={disabled} onState={(next) => { update('modelWeightsState', next) }} onValue={(next) => { update('modelWeightsValue', next) }} t={t} />
          <ScalarEditor label="assetRightsModelOutputUse" state={value.modelOutputUseState} value={value.modelOutputUseValue} disabled={disabled} onState={(next) => { update('modelOutputUseState', next) }} onValue={(next) => { update('modelOutputUseValue', next) }} t={t} />
        </div>
      </fieldset>

      <fieldset className={css.rightsGroup}>
        <legend>{t('assetRightsHumanDeclaration')}</legend>
        <select
          aria-label={t('assetRightsHumanDeclaration')}
          value={value.humanDeclarationState}
          disabled={disabled}
          onChange={(event) => { update('humanDeclarationState', event.target.value as ReferenceDeclarationState) }}
        >
          {DECLARATION_OPTIONS.map(([option, key]) => <option value={option} key={option}>{t(key)}</option>)}
        </select>
        <label className={css.rightsField}>
          <span>{t('assetRightsDeclarationText')}</span>
          <textarea
            aria-label={t('assetRightsDeclarationText')}
            value={value.humanDeclarationText}
            maxLength={4000}
            rows={3}
            disabled={disabled || value.humanDeclarationState !== 'provided'}
            onChange={(event) => { update('humanDeclarationText', event.target.value) }}
          />
        </label>
      </fieldset>

      <ScalarEditor
        label="assetRightsContentCredentials"
        state={value.contentCredentialsState}
        value={value.contentCredentialsValue}
        disabled={disabled}
        onState={(next) => { update('contentCredentialsState', next) }}
        onValue={(next) => { update('contentCredentialsValue', next) }}
        t={t}
      />
    </fieldset>
  )
}

function stateText(
  state: ReferenceRightsKnowledgeState,
  t: (key: QingmuCockpitKey) => string,
): string {
  return t(state === 'known'
    ? 'assetRightsStateKnown'
    : state === 'unknown'
      ? 'assetRightsStateUnknown'
      : 'assetRightsStateNotApplicable')
}

function scalarText(
  value: YimengReferenceRightsRecord['sourceType'],
  t: (key: QingmuCockpitKey) => string,
): string {
  return value.state === 'known' ? value.value ?? '' : stateText(value.state, t)
}

function listText(
  value: YimengReferenceRightsRecord['authorizationScope'],
  t: (key: QingmuCockpitKey) => string,
): string {
  return value.state === 'known' ? value.values.join(' · ') || t('empty') : stateText(value.state, t)
}

/** Human-readable exact preview of the normalized rights body. */
export function ReferenceRightsSummary({ value, t }: ReferenceRightsSummaryProps) {
  const term = value.term.state !== 'known'
    ? stateText(value.term.state, t)
    : value.term.perpetual
      ? `${value.term.startsAt ?? ''} · ${t('assetRightsPerpetual')}`
      : `${value.term.startsAt ?? ''} → ${value.term.endsAt ?? ''}`
  const contains = [
    [t('assetRightsRealPerson'), value.contains.realPersonLikeness],
    [t('assetRightsTrademark'), value.contains.trademark],
    [t('assetRightsMusic'), value.contains.music],
    [t('assetRightsFont'), value.contains.font],
    [t('assetRightsThirdPartyCharacter'), value.contains.thirdPartyCharacter],
  ].map(([label, state]) => `${label}: ${state}`).join(' · ')
  return (
    <dl className={css.rightsSummary}>
      <div><dt>{t('assetRightsSourceType')}</dt><dd>{scalarText(value.sourceType, t)}</dd></div>
      <div><dt>{t('assetRightsHolder')}</dt><dd>{scalarText(value.rightsHolder, t)}</dd></div>
      <div><dt>{t('assetRightsAuthorizationScope')}</dt><dd>{listText(value.authorizationScope, t)}</dd></div>
      <div><dt>{t('assetRightsTerritory')}</dt><dd>{listText(value.territory, t)}</dd></div>
      <div><dt>{t('assetRightsTerm')}</dt><dd>{term}</dd></div>
      <div><dt>{t('assetRightsRestrictions')}</dt><dd>{listText(value.restrictions, t)}</dd></div>
      <div><dt>{t('assetRightsContains')}</dt><dd>{contains}</dd></div>
      <div><dt>{t('assetRightsProviderTerms')}</dt><dd>{value.providerTerms.state === 'known' ? `${value.providerTerms.terms ?? ''} · ${value.providerTerms.reviewedAt ?? ''}` : stateText(value.providerTerms.state, t)}</dd></div>
      <div><dt>{t('assetRightsModelLicenses')}</dt><dd>{[
        scalarText(value.modelLicenses.code, t),
        scalarText(value.modelLicenses.weights, t),
        scalarText(value.modelLicenses.outputUse, t),
      ].join(' · ')}</dd></div>
      <div><dt>{t('assetRightsHumanDeclaration')}</dt><dd>{value.humanDeclaration.state === 'provided' ? value.humanDeclaration.text : value.humanDeclaration.state}</dd></div>
      <div><dt>{t('assetRightsContentCredentials')}</dt><dd>{scalarText(value.contentCredentials, t)}</dd></div>
    </dl>
  )
}
