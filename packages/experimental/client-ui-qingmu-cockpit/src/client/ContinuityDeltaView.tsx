import { useEffect, useState } from 'react'
import type { YimengContinuityPair } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ImagoContinuityMethodProjection, QingmuImagoMethodPort, YimengWorkflowProjection } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './ContinuityDeltaView.module.css'

interface ContinuityDeltaViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuImagoMethodPort, 'continuityMethod'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface RequestIdentity {
  readonly source: YimengWorkflowProjection
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly refresh: number
  readonly port: ContinuityDeltaViewProps['port']
}

type ContinuityState = RequestIdentity & (
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: ImagoContinuityMethodProjection }
  | { readonly status: 'error'; readonly message: string }
)

const DIMENSIONS = {
  character: 'continuityCharacter', scene: 'continuityScene', prop: 'continuityProp', action: 'continuityAction',
} as const
const SCOPES = {
  current: 'continuityScopeCurrent', historical: 'continuityScopeHistorical', unavailable: 'continuityScopeUnavailable',
} as const
const LOCKS: Readonly<Record<string, QingmuCockpitKey>> = {
  ACCEPTANCE_LOCK: 'continuityLockAcceptance', SCRIPT_LOCK: 'continuityLockScript', ANIMATIC_LOCK: 'continuityLockAnimatic',
  ASSET_REQUIREMENT_LOCK: 'continuityLockAssets', PROJECT_PILOT_LOCK: 'continuityLockPilot', PRODUCTION_BLUEPRINT_LOCK: 'continuityLockBlueprint',
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function PairCard({ pair, title, t }: { readonly pair: YimengContinuityPair | null; readonly title: string; readonly t: ContinuityDeltaViewProps['t'] }) {
  const resultLabel = (value: boolean | null) => t(value === null ? 'continuityUnknown' : value ? 'continuityMatch' : 'continuityMismatch')
  return (
    <article className={css.pair} aria-label={title}>
      <h4>{title}</h4>
      {pair === null ? <p>{t('continuityNoAdjacent')}</p> : <>
        <strong className={css.shotNumbers}>{pair.fromFrameNo} → {pair.toFrameNo}</strong>
        <small><code>{pair.fromShotId}</code> → <code>{pair.toShotId}</code></small>
        <p className={css.notice}>{t(pair.currentEvidenceReady ? 'continuityCurrentReady'
          : pair.bindingStatus === 'different' ? 'continuityHistorical'
            : pair.bindingStatus === 'current' ? 'continuityCurrentUnverified' : 'continuityUnbound')}</p>
        <p>{t(pair.exemption === 'scene_change' ? 'continuitySceneChange' : pair.exemption === 'hard_cut' ? 'continuityHardCut'
          : pair.required ? 'continuityRequired' : 'continuityAdvisory')} · {t('continuityAudit')}: {resultLabel(pair.audit.passed)}</p>
        <table className={css.dimensions}>
          <thead><tr><th scope="col">{t('continuityDimension')}</th><th scope="col">{t('continuityAudit')}</th></tr></thead>
          <tbody>{pair.audit.dimensions.map(item => <tr key={item.dimension}>
            <th scope="row">{t(DIMENSIONS[item.dimension])}</th>
            <td>{resultLabel(item.result)}{item.reason !== null && <small>{item.reason}</small>}</td>
          </tr>)}</tbody>
        </table>
        <details className={css.details}>
          <summary>{t('continuityBindings')}</summary>
          <div className={css.bindings}>{(['currentBinding', 'audit'] as const).map(key => <div key={key}>
            <h5>{t(key === 'audit' ? 'continuityAuditAssets' : 'continuityCurrentAssets')}</h5>
            <dl className={css.evidence}>{([
              ['continuityTail', pair[key].tailAssetId, pair[key].tailSha256],
              ['continuityFirstFrame', pair[key].nextFirstFrameAssetId, pair[key].nextFirstFrameSha256],
            ] as const).map(([label, id, sha]) => <div key={label}>
              <dt>{t(label)}</dt><dd><code>{id ?? t('continuityUnknown')}</code><small>{sha ?? t('continuityUnknown')}</small></dd>
            </div>)}</dl>
          </div>)}</div>
          <dl className={css.evidence}>
            <div><dt>{t('continuityCheckId')}</dt><dd><code>{pair.audit.checkId ?? t('continuityUnknown')}</code></dd></div>
            <div><dt>{t('continuityEvidenceRef')}</dt><dd>{pair.audit.evidenceRef ?? t('continuityUnknown')}</dd></div>
          </dl>
          {pair.warnings.length > 0 && <><h5>{t('continuityWarnings')}</h5><ul>{pair.warnings.map((warning, index) => <li key={`${String(index)}:${warning}`}>{warning}</li>)}</ul></>}
        </details>
      </>}
    </article>
  )
}

/** Read-only continuity view sharing the canonical Shot selection and source lifecycle. */
export function ContinuityDeltaView({ projectId, episodeId, selectedShotId, projection, enabled, port, t }: ContinuityDeltaViewProps) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ContinuityState>()
  const selected = projection?.director.shotRelations.shots.find(shot => shot.shotId === selectedShotId)
  const eligible = enabled && projection !== undefined && selected !== undefined
    && projection.projectId === projectId && projection.episodeId === episodeId

  useEffect(() => {
    if (!eligible) { setState(undefined); return }
    const controller = new AbortController()
    let live = true
    const identity = { source: projection, projectId, episodeId, selectedShotId, refresh, port }
    setState({ ...identity, status: 'loading' })
    const load = async () => {
      try {
        const response: unknown = await port.continuityMethod({ projectId, episodeId, selectedShotId }, controller.signal)
        if (!live) return
        if (!record(response) || response.schema !== 'qingmu.imago-continuity-method-adapter-result.v1'
          || !record(response.projection)) throw new Error(t('continuityInvalid'))
        const raw = response.projection
        const expectedRevision = projection.director.shotRelations.storyboardRevision
        const revision = record(raw.subject) ? raw.subject.storyboardRevision : undefined
        if (raw.schema !== 'qingmu.imago-continuity-method-projection.v1' || !record(raw.subject)
          || raw.subject.projectId !== projectId || raw.subject.episodeId !== episodeId || raw.subject.selectedShotId !== selectedShotId
          || !record(revision) || Object.entries(expectedRevision).some(([key, value]) => revision[key] !== value)
          || !record(raw.selected_shot) || raw.selected_shot.shotId !== selectedShotId || raw.selected_shot.frameNo !== selected.frameNo
          || raw.continuity_snapshot_sha256 !== (projection.director.continuityDelta?.snapshotSha256 ?? null)
          || raw.read_only !== true || raw.provider_calls !== 0 || raw.task_mutation !== false || raw.budget_mutation !== false
          || raw.human_signoff_inferred !== false || raw.project_state_persisted !== false || raw.formal_activation_allowed !== false
          || !record(raw.availability) || !record(raw.adjacent_pairs) || !record(raw.lock_authority)
          || raw.lock_authority.status !== 'unavailable' || !Array.isArray(raw.lock_authority.instances) || raw.lock_authority.instances.length !== 0
          || !Array.isArray(raw.candidate_findings) || !Array.isArray(raw.lock_definitions) || !Array.isArray(raw.rework_propagation)
          || !Array.isArray(raw.field_help) || !Array.isArray(raw.checklist) || !record(raw.rule_bindings)
          || raw.candidate_findings.some(item => !record(item) || item.formal_finding !== false || item.attribution !== 'pending'
            || item.severity !== null || item.earliest_owner !== null || item.timecode !== null)) {
          throw new Error(t('continuityInvalid'))
        }
        // Full evidence and rule DTOs are verified in the Host; the browser also binds visible Shot/source identity.
        setState({ ...identity, status: 'ready', result: raw as ImagoContinuityMethodProjection })
      } catch (cause) {
        if (live) setState({ ...identity, status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    void load()
    return () => { live = false; controller.abort() }
  }, [eligible, episodeId, port, projectId, projection, refresh, selected, selectedShotId, t])

  const current = eligible && state?.source === projection && state.projectId === projectId && state.episodeId === episodeId
    && state.selectedShotId === selectedShotId && state.refresh === refresh && state.port === port ? state : undefined
  const result = current?.status === 'ready' ? current.result : undefined
  const loading = eligible && (current === undefined || current.status === 'loading')

  return <section className={`${card.card} ${css.continuity}`} aria-label={t('continuityTitle')}>
    <div className={css.header}>
      <div><h3>{t('continuityTitle')}</h3><p>{t('continuityBoundary')}</p></div>
      <button type="button" disabled={!eligible || loading} onClick={() => { setRefresh(value => value + 1) }}>{t('continuityRefresh')}</button>
    </div>
    {!eligible && enabled && <p>{t('continuityChoose')}</p>}
    {loading && <p role="status">{t('continuityLoading')}</p>}
    {current?.status === 'error' && <p role="alert" className={card.warning}>{t('continuityError')}: {current.message}</p>}
    {result !== undefined && <div className={css.body}>
      {result.availability.status === 'unavailable' ? <p role="status" className={css.notice}>{t('continuityUnavailable')}</p> : <div className={css.pairs}>
        <PairCard pair={result.adjacent_pairs.incoming} title={t('continuityIncoming')} t={t} />
        <PairCard pair={result.adjacent_pairs.outgoing} title={t('continuityOutgoing')} t={t} />
      </div>}
      <div className={css.candidates}>
        <h4>{t('continuityCandidates')} · {result.candidate_findings.length}</h4><p>{t('continuityCandidatesBoundary')}</p>
        {result.candidate_findings.length === 0 ? <p>{t('continuityNoCandidates')}</p> : <ul aria-label={t('continuityCandidates')}>
          {result.candidate_findings.map(item => <li key={JSON.stringify([item.from_shot_id, item.to_shot_id, item.dimension])}>
            <strong>{t(DIMENSIONS[item.dimension])} · {t(SCOPES[item.evidence_scope])}</strong>
            <p>{item.reason ?? t('continuityUnknown')}</p><small>{t('continuityPending')}</small>
          </li>)}
        </ul>}
      </div>
      <details className={css.details}>
        <summary>{t('continuityLocks')} · {result.lock_definitions.length}</summary><p>{t('continuityLocksBoundary')}</p>
        <ul className={css.locks}>{result.lock_definitions.map((lock) => {
          const label = LOCKS[lock.id]
          const propagation = result.rework_propagation.find(item => item.changed_lock === lock.id)
          return <li key={lock.id}>
            <strong>{label === undefined ? lock.id : t(label)}</strong><small>{t('continuityProducer')}: {lock.producer_stage}</small>
            <p>{propagation === undefined ? t('continuityNoPropagation') : `${t('continuityReworkFrom')}: ${propagation.invalidates_from}`}</p>
            <code>{propagation?.scope ?? lock.id}</code>
          </li>
        })}</ul>
      </details>
      <details className={css.details}>
        <summary>{t('continuityGuidance')}</summary>
        <dl className={css.evidence}>{result.field_help.map(item => (
          <div key={item.field}><dt>{item.label}</dt><dd>{item.help}</dd></div>
        ))}</dl>
        <ul>{result.checklist.map(item => <li key={item.id}>{item.label}</li>)}</ul>
      </details>
      <details className={css.details}>
        <summary>{t('continuityEvidence')}</summary>
        <dl className={css.evidence}>{([
          ['worksetSourceHash', result.source_projection_sha256], ['worksetRevisionHash', result.source_revision_sha256],
          ['worksetInputHash', result.input_snapshot_sha256], ['worksetRulesHash', result.rules_sha256],
        ] as const).map(([label, sha]) => <div key={label}><dt>{t(label)}</dt><dd><code>{sha}</code></dd></div>)}</dl>
        <h4>{t('worksetRuleFiles')}</h4><dl className={css.evidence}>{Object.entries(result.rule_bindings).map(([path, sha]) => (
          <div key={path}><dt><code>{path}</code></dt><dd><code>{sha}</code></dd></div>
        ))}</dl>
      </details>
    </div>}
  </section>
}
