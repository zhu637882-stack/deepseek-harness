import { useEffect, useState } from 'react'
import type {
  QingmuYimengReadPort, YimengCapabilityCatalogResponse, YimengCapabilitySnapshot,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './GenerationCapabilityCatalog.module.css'

interface GenerationCapabilityCatalogProps {
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengReadPort, 'capabilityCatalog'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface RequestIdentity {
  readonly port: GenerationCapabilityCatalogProps['port']
  readonly refresh: number
}

type CatalogState = RequestIdentity & (
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: YimengCapabilityCatalogResponse }
  | { readonly status: 'error'; readonly message: string }
)

function objectKeys(value: object): string[] {
  return Object.keys(value).sort()
}

function compactJson(value: object): string {
  try { return JSON.stringify(value) } catch { return '—' }
}

function SnapshotCard({ snapshot, sha256, t }: {
  readonly snapshot: YimengCapabilitySnapshot
  readonly sha256: string
  readonly t: GenerationCapabilityCatalogProps['t']
}) {
  const declarationsComplete = snapshot.declaration.errors.length === 0
  return <article className={css.model}>
    <header>
      <div>
        <h4>{snapshot.displayName}</h4>
        <p><code>{snapshot.modelId}</code> · {t('capabilityCatalogProvider')} <code>{snapshot.providerId}</code></p>
      </div>
      <span className={css.status}>{t('capabilityCatalogUnverified')}</span>
    </header>
    <dl className={css.facts}>
      <div><dt>{t('capabilityCatalogInputs')}</dt><dd>{objectKeys(snapshot.inputs).join(' · ') || '—'}</dd></div>
      <div><dt>{t('capabilityCatalogOutputs')}</dt><dd>{objectKeys(snapshot.outputs).join(' · ') || '—'}</dd></div>
      <div><dt>{t('capabilityCatalogGeometry')}</dt><dd><code>{compactJson(snapshot.geometry)}</code></dd></div>
    </dl>
    <div className={css.section}>
      <h5>{t('capabilityCatalogControls')}</h5>
      <div className={css.tags}>{snapshot.controls.map(control => <code key={control}>{control}</code>)}</div>
    </div>
    <div className={css.section}>
      <h5>{t('capabilityCatalogMutual')}</h5>
      {snapshot.mutualExclusions.length === 0
        ? <p className={css.missing}>{t('capabilityCatalogMutualMissing')}</p>
        : <ul>{snapshot.mutualExclusions.map(rule => <li key={rule.ruleId}>
          <strong>{rule.ruleId}</strong>
          <span>{rule.controls.join(' × ')}</span>
          <small>{t('capabilityCatalogRuleMax')} {rule.maxSelected}</small>
        </li>)}</ul>}
    </div>
    {!declarationsComplete && <p className={css.missing} role="status">
      {t('capabilityCatalogDeclarationIncomplete')}: <code>{snapshot.declaration.errors.join(', ')}</code>
    </p>}
    <details>
      <summary>{t('capabilityCatalogEvidence')}</summary>
      <dl className={css.evidence}>
        <div><dt>{t('capabilityCatalogSnapshotSha')}</dt><dd><code>{sha256}</code></dd></div>
        <div><dt>{t('capabilityCatalogRuntime')}</dt><dd><code>{snapshot.runtime.deploymentScope || '—'}</code></dd></div>
        <div><dt>{t('capabilityCatalogCost')}</dt><dd><code>{compactJson(snapshot.cost)}</code></dd></div>
      </dl>
    </details>
  </article>
}

/** Read-only Gate A capability inventory. It cannot submit, reserve, or authorize Provider work. */
export function GenerationCapabilityCatalog({ enabled, port, t }: GenerationCapabilityCatalogProps) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<CatalogState>()

  useEffect(() => {
    if (!enabled) { setState(undefined); return }
    const controller = new AbortController()
    const identity = { port, refresh }
    setState({ ...identity, status: 'loading' })
    void (async () => {
      try {
        const result = await port.capabilityCatalog({}, controller.signal)
        if (controller.signal.aborted) return
        setState({ ...identity, status: 'ready', result })
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
  }, [enabled, port, refresh, t])

  const current = enabled && state?.port === port && state.refresh === refresh ? state : undefined
  const loading = enabled && (current === undefined || current.status === 'loading')
  const result = current?.status === 'ready' ? current.result : undefined

  return <section
    className={`${card.card} ${css.catalog}`}
    aria-label={t('capabilityCatalogTitle')}
    aria-busy={loading}
  >
    <header className={css.header}>
      <div>
        <h3>{t('capabilityCatalogTitle')}</h3>
        <p>{t('capabilityCatalogBoundary')}</p>
      </div>
      <button type="button" disabled={!enabled || loading} onClick={() => { setRefresh(value => value + 1) }}>
        {t('capabilityCatalogRefresh')}
      </button>
    </header>
    {loading && <p role="status">{t('capabilityCatalogLoading')}</p>}
    {current?.status === 'error' && <p role="alert" className={card.warning}>
      {t('capabilityCatalogError')}: {current.message}
    </p>}
    {result !== undefined && <>
      <div className={css.summary} role="status">
        <div><span>{t('capabilityCatalogStatus')}</span><strong>{t('capabilityCatalogUnverified')}</strong></div>
        <div><span>{t('capabilityCatalogProfile')}</span><strong>{result.activeProfile}</strong></div>
        <div><span>{t('capabilityCatalogModels')}</span><strong>{result.items.length}</strong></div>
      </div>
      <p className={css.hash}>{t('capabilityCatalogCatalogSha')}: <code>{result.catalogSnapshotSha256}</code></p>
      {result.items.length === 0
        ? <p>{t('capabilityCatalogEmpty')}</p>
        : <div className={css.grid}>{result.items.map(item => <SnapshotCard
          key={item.capabilitySnapshotId}
          snapshot={item.snapshot}
          sha256={item.capabilitySnapshotSha256}
          t={t}
        />)}</div>}
      <p className={css.zero}>{t('capabilityCatalogZeroAuthority')}</p>
    </>}
  </section>
}
