import { useEffect, useState } from 'react'
import type {
  QingmuYimengReadPort, YimengGateAControlEvidenceResponse, YimengGateAControlScenarioId,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './GenerationGateAControlEvidence.module.css'

interface GenerationGateAControlEvidenceProps {
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengReadPort, 'gateAControlEvidence'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface RequestIdentity {
  readonly port: GenerationGateAControlEvidenceProps['port']
  readonly refresh: number
}

type EvidenceState = RequestIdentity & (
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: YimengGateAControlEvidenceResponse }
  | { readonly status: 'error'; readonly message: string }
)

const SCENARIO_LABELS: Record<YimengGateAControlScenarioId, QingmuCockpitKey> = {
  unauthorized_request_blocked: 'gateAControlScenarioUnauthorized',
  duplicate_ack_replay: 'gateAControlScenarioDuplicateAck',
  payload_sha_conflict: 'gateAControlScenarioPayloadConflict',
  submission_unknown_quarantine: 'gateAControlScenarioUnknown',
  simulated_reconciliation: 'gateAControlScenarioReconciliation',
  poll_recovery: 'gateAControlScenarioPollRecovery',
  download_timeout_recovery: 'gateAControlScenarioDownloadRecovery',
  truncated_download_rejected: 'gateAControlScenarioTruncatedDownload',
}

/** Read-only projection of source-bound, offline Gate A fault-injection evidence. */
export function GenerationGateAControlEvidence({
  enabled, port, t,
}: GenerationGateAControlEvidenceProps) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<EvidenceState>()

  useEffect(() => {
    if (!enabled) {
      setState(undefined)
      return
    }
    const controller = new AbortController()
    const identity = { port, refresh }
    setState({ ...identity, status: 'loading' })
    void (async () => {
      try {
        const result = await port.gateAControlEvidence({}, controller.signal)
        if (!controller.signal.aborted) setState({ ...identity, status: 'ready', result })
      } catch (cause) {
        if (!controller.signal.aborted) {
          setState({
            ...identity,
            status: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    })()
    return () => { controller.abort() }
  }, [enabled, port, refresh])

  const current = enabled && state?.port === port && state.refresh === refresh ? state : undefined
  const loading = enabled && (current === undefined || current.status === 'loading')
  const result = current?.status === 'ready' ? current.result : undefined

  return <section
    className={`${card.card} ${css.evidence}`}
    aria-label={t('gateAControlTitle')}
    aria-busy={loading}
  >
    <header className={css.header}>
      <div>
        <h3>{t('gateAControlTitle')}</h3>
        <p>{t('gateAControlBoundary')}</p>
      </div>
      <button type="button" disabled={!enabled || loading} onClick={() => { setRefresh(value => value + 1) }}>
        {t('gateAControlRefresh')}
      </button>
    </header>

    {loading && <p role="status">{t('gateAControlLoading')}</p>}
    {current?.status === 'error' && <p role="alert" className={card.warning}>
      {t('gateAControlError')}: {current.message}
    </p>}

    {result !== undefined && <>
      <div className={css.summary} role="status">
        <article className={css.passed}>
          <span>{t('gateAControlStatus')}</span>
          <strong>{t('gateAControlPassed')}</strong>
        </article>
        <article>
          <span>{t('gateAControlProduction')}</span>
          <strong>{t('gateAControlUnverified')}</strong>
        </article>
        <article>
          <span>{t('gateAControlScenarios')}</span>
          <strong>{result.scenarios.length}/{result.scenarios.length}</strong>
        </article>
        <article>
          <span>{t('gateAControlFakeSubmits')}</span>
          <strong>{result.simulatedProviderSubmitAttempts}</strong>
        </article>
      </div>

      <div className={css.body}>
        <div>
          <h4>{t('gateAControlScenarioTitle')}</h4>
          <ul className={css.scenarios}>
            {result.scenarios.map(scenario => <li key={scenario.id}>
              <span aria-hidden="true">✓</span>
              <strong>{t(SCENARIO_LABELS[scenario.id])}</strong>
              <code>{scenario.id}</code>
            </li>)}
          </ul>
        </div>

        <div>
          <h4>{t('gateAControlZeroTitle')}</h4>
          <dl className={css.zeros}>
            <div><dt>{t('gateAControlExternalCalls')}</dt><dd>{result.externalProviderCalls}</dd></div>
            <div><dt>{t('gateAControlDuplicatePaid')}</dt><dd>{result.assertions.duplicatePaidSubmissions}</dd></div>
            <div><dt>{t('gateAControlUnknownResubmits')}</dt><dd>{result.assertions.unknownAutomaticResubmits}</dd></div>
            <div><dt>{t('gateAControlProductionWrites')}</dt><dd>{result.productionDatabaseWrites}</dd></div>
            <div><dt>{t('gateAControlBudgetWrites')}</dt><dd>{result.formalBudgetLedgerWrites}</dd></div>
            <div><dt>{t('gateAControlNetworkEgress')}</dt><dd>{result.assertions.networkEgressAttempts}</dd></div>
          </dl>
        </div>
      </div>

      <details className={css.details}>
        <summary>{t('gateAControlEvidence')}</summary>
        <dl>
          <div><dt>{t('gateAControlMode')}</dt><dd><code>{result.mode}</code></dd></div>
          <div><dt>{t('gateAControlDatabase')}</dt><dd><code>{result.environment.database}</code></dd></div>
          <div><dt>{t('gateAControlProvider')}</dt><dd><code>{result.environment.provider}</code></dd></div>
          <div><dt>{t('gateAControlSnapshotSha')}</dt><dd><code>{result.evidenceSnapshotSha256}</code></dd></div>
        </dl>
        <h4>{t('gateAControlSources')}</h4>
        <ul className={css.sources}>{result.sourceBindings.map(binding => <li key={binding.path}>
          <code>{binding.path}</code>
          <code>{binding.sha256}</code>
        </li>)}</ul>
      </details>

      <p className={css.limit}>{t('gateAControlLimit')}</p>
    </>}
  </section>
}
