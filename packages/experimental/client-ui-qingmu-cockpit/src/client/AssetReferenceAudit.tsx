import { useRef, useState } from 'react'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

/** One quoted image in a formal asset-reference audit batch. */
interface AuditQuoteItem {
  readonly assetId: string
  readonly assetSha256: string
  readonly ownerType: string
  readonly ownerId: string
  readonly role: string
  readonly label: string
  readonly originalCheckId: string | null
  readonly estimatedCny: number
  readonly pricingVerified: boolean
  readonly quoteAllowed: boolean
}

/** The Writer's free audit quote, already validated by the Host bridge. */
interface AuditQuote {
  readonly schema: 'asset-reference-audit-preflight-v1'
  readonly quoteReady: boolean
  readonly phaseLabel: string
  readonly auditMode: AuditMode
  readonly preflightId: string
  readonly manifest: readonly AuditQuoteItem[]
  readonly callCount: number
  readonly estimatedCny: number
  readonly authorizationCapCny: number
  readonly sourceLockHash: string
  readonly callPlanHash: string
  readonly expiresAt: string
  readonly confirmationText: string
  readonly validationErrors: readonly string[]
  readonly imageRegeneration: false
  readonly providerCalls: 0
  readonly budgetMutation: false
}

type AuditMode = 'new_candidates' | 'rule_reaudit'

interface Props {
  readonly projectId: string
  readonly episodeId: string
  readonly t: (key: QingmuCockpitKey) => string
}

/**
 * Writer rejection codes this surface explains.
 *
 * These are the codes the audit preflight and start routes can raise for the
 * request the command bridge allows. Any other code is shown verbatim rather
 * than guessed at, and the per-asset `validationErrors` strings are always
 * shown verbatim because they carry the offending asset id.
 */
const AUDIT_REASONS: Readonly<Record<string, QingmuCockpitKey>> = {
  asset_reference_audit_preflight_not_found: 'assetAuditReasonNotFound',
  asset_reference_audit_preflight_not_allowed: 'assetAuditReasonNotAllowed',
  asset_reference_audit_preflight_stage_mismatch: 'assetAuditReasonStageMismatch',
  asset_reference_audit_preflight_expired: 'assetAuditReasonExpired',
  asset_reference_audit_preflight_already_consumed: 'assetAuditReasonAlreadyConsumed',
  asset_reference_audit_mode_changed: 'assetAuditReasonQuoteChanged',
  asset_reference_audit_source_lock_changed: 'assetAuditReasonQuoteChanged',
  asset_reference_audit_call_plan_changed: 'assetAuditReasonQuoteChanged',
  asset_reference_audit_confirmation_contract_incomplete: 'assetAuditReasonConfirmationIncomplete',
}

/** Codes whose prefix carries a bound column name the operator must see verbatim. */
const BINDING_PREFIX = 'asset_reference_audit_preflight_binding_mismatch:'

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid response')
  return value as Record<string, unknown>
}

/**
 * Formal visual audit of the episode's existing reference images.
 *
 * Quoting is free and writes only an expiring preflight row; starting consumes
 * that row and queues a paid `vision.audit` batch. Nothing here quotes or starts
 * on its own — both are explicit button presses, and starting additionally needs
 * a tick under the Writer's own confirmation text and price. The browser sends no
 * identity field: the Host bridge authenticates with the natural person's own
 * `jason_token` cookie and refuses anything else.
 */
export function AssetReferenceAudit(props: Props) {
  const [mode, setMode] = useState<AuditMode>('new_candidates')
  const [quote, setQuote] = useState<AuditQuote>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  const [dispatched, setDispatched] = useState<string>()
  const [error, setError] = useState<string>()
  const requestScope = `${props.projectId}:${props.episodeId}:${mode}`
  const activeScope = useRef(requestScope)
  activeScope.current = requestScope

  const query = `projectId=${encodeURIComponent(props.projectId)}&episodeId=${encodeURIComponent(props.episodeId)}`

  const post = async (path: string, body: Record<string, unknown>): Promise<{
    readonly response: Response
    readonly value: Record<string, unknown>
  }> => {
    const response = await fetch(`${path}?${query}`, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { response, value: await responseJson(response) }
  }

  const login = async (): Promise<void> => {
    if (busy || username === '' || password === '') return
    setBusy(true); setError(undefined)
    try {
      const response = await fetch('/api/qingmu/editorial-handoff/human-session', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) throw new Error('asset_audit_login_failed')
      setPassword(''); setNeedsLogin(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const explain = (reason: string): string => {
    if (reason.startsWith(BINDING_PREFIX)) return `${props.t('assetAuditReasonBindingMismatch')}${reason.slice(BINDING_PREFIX.length)}`
    const key = AUDIT_REASONS[reason]
    return key === undefined ? reason : props.t(key)
  }

  /** Ask the Writer for one free quote; a rejected or stale scope leaves no quote behind. */
  const requestQuote = async (): Promise<void> => {
    if (busy || props.projectId === '' || props.episodeId === '') return
    const scope = requestScope
    setBusy(true); setError(undefined); setOutcomeUnknown(false)
    setQuote(undefined); setConfirmed(false); setDispatched(undefined)
    try {
      const { response, value } = await post('/api/qingmu/asset-reference-audit/quote', {
        auditMode: mode, assetIds: [],
      })
      if (activeScope.current !== scope) return
      if (response.status === 401) { setNeedsLogin(true); throw new Error('asset_audit_relogin_required') }
      if (!response.ok) {
        const code = typeof value.code === 'string' ? value.code : 'asset_audit_quote_failed'
        throw new Error(typeof value.reason === 'string' ? `${code}: ${explain(value.reason)}` : code)
      }
      setQuote(value as unknown as AuditQuote)
      setNeedsLogin(false)
    } catch (cause) {
      if (activeScope.current === scope) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (activeScope.current === scope) setBusy(false) }
  }

  /**
   * Consume the quote the operator is looking at and queue the paid batch.
   *
   * A 502 means the Writer may already have consumed the quote and queued the
   * batch, so the quote is dropped and never resubmitted: resubmitting an
   * already-consumed preflight is refused by the Writer, and a fresh quote could
   * price a different set of images. The operator must re-quote deliberately.
   */
  const start = async (): Promise<void> => {
    const reviewed = quote
    if (busy || reviewed === undefined || !reviewed.quoteReady || !confirmed) return
    setBusy(true); setError(undefined); setOutcomeUnknown(false)
    try {
      const { response, value } = await post('/api/qingmu/asset-reference-audit/start', {
        confirmed: true,
        preflightId: reviewed.preflightId,
        sourceLockHash: reviewed.sourceLockHash,
        callPlanHash: reviewed.callPlanHash,
        confirmationText: reviewed.confirmationText,
        auditMode: reviewed.auditMode,
        assetIds: [],
      })
      setConfirmed(false)
      if (response.status === 401) { setNeedsLogin(true); setQuote(undefined); throw new Error('asset_audit_relogin_required') }
      if (response.status === 502) { setOutcomeUnknown(true); setQuote(undefined); return }
      if (!response.ok) {
        setQuote(undefined)
        const code = typeof value.code === 'string' ? value.code : 'asset_audit_start_failed'
        throw new Error(typeof value.reason === 'string' ? `${code}: ${explain(value.reason)}` : code)
      }
      const task = value.task
      setDispatched(typeof task === 'object' && task !== null && typeof (task as Record<string, unknown>).id === 'string'
        ? (task as Record<string, unknown>).id as string
        : undefined)
      setQuote(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const cny = (amount: number): string => `¥${amount.toFixed(4)}`

  return <section className={css.entityReview} aria-label={props.t('assetAuditTitle')}>
    <h4>{props.t('assetAuditTitle')}</h4>
    <p className={css.boundary}>{props.t('assetAuditBoundary')}</p>
    {needsLogin && <div className={css.entityReviewLogin}>
      <label><span>{props.t('entityDraftReviewAccount')}</span>
        <input aria-label={props.t('entityDraftReviewAccount')} value={username}
          autoComplete="username" onChange={(event) => { setUsername(event.target.value) }} /></label>
      <label><span>{props.t('entityDraftReviewPassword')}</span>
        <input aria-label={props.t('entityDraftReviewPassword')} value={password} type="password"
          autoComplete="current-password" onChange={(event) => { setPassword(event.target.value) }} /></label>
      <button type="button" className={css.primaryAction} disabled={busy || username === '' || password === ''}
        onClick={() => { void login() }}>{props.t('entityDraftReviewLogin')}</button>
    </div>}
    <div className={css.scriptActions}>
      <label className={css.rightsCheck}>
        <input type="radio" name="asset-audit-mode" checked={mode === 'new_candidates'} disabled={busy}
          onChange={() => { setMode('new_candidates'); setQuote(undefined); setConfirmed(false) }} />
        <span>{props.t('assetAuditModeNew')}</span></label>
      <label className={css.rightsCheck}>
        <input type="radio" name="asset-audit-mode" checked={mode === 'rule_reaudit'} disabled={busy}
          onChange={() => { setMode('rule_reaudit'); setQuote(undefined); setConfirmed(false) }} />
        <span>{props.t('assetAuditModeReaudit')}</span></label>
      <button type="button" className={css.primaryAction}
        disabled={busy || props.projectId === '' || props.episodeId === ''}
        onClick={() => { void requestQuote() }}>{props.t('assetAuditQuote')}</button>
    </div>
    {dispatched !== undefined && <p role="status"><strong>
      {props.t('assetAuditDispatched')}: {dispatched}
    </strong></p>}
    {quote !== undefined && <>
      <p role="status"><strong>
        {quote.quoteReady ? props.t('assetAuditQuoteReady') : props.t('assetAuditQuoteBlocked')}
      </strong> · {quote.phaseLabel}</p>
      <p><strong>{props.t('assetAuditEstimated')}: {cny(quote.estimatedCny)}</strong>
        {' · '}{props.t('assetAuditCap')}: {cny(quote.authorizationCapCny)}
        {' · '}{props.t('assetAuditCallCount')}: {quote.callCount}</p>
      <p>{props.t('assetAuditExpires')}: {quote.expiresAt}</p>
      {quote.validationErrors.length > 0 && <>
        <h5>{props.t('assetAuditValidationErrors')}</h5>
        <ul className={css.list}>
          {quote.validationErrors.map(item => <li key={item}>{item}</li>)}
        </ul>
      </>}
      {quote.manifest.length === 0
        ? <p className={css.empty}>{props.t('assetAuditEmptyManifest')}</p>
        : <>
          <h5>{props.t('assetAuditManifest')}</h5>
          <ul className={css.list}>
            {quote.manifest.map(item => <li key={item.assetId}>
              {item.role} · {item.label} · {cny(item.estimatedCny)}
              {' · '}{item.quoteAllowed ? props.t('assetAuditAllowed') : props.t('assetAuditNotAllowed')}
              {' · '}{item.originalCheckId === null
                ? props.t('assetAuditNoCheck') : props.t('assetAuditHasCheck')}
            </li>)}
          </ul>
        </>}
      {quote.quoteReady && quote.manifest.length > 0 && <>
        <p className={css.boundary}>{props.t('assetAuditConfirmation')}: {quote.confirmationText}</p>
        <label className={css.rightsCheck}>
          <input type="checkbox" checked={confirmed} aria-label={props.t('assetAuditConfirm')}
            onChange={(event) => { setConfirmed(event.target.checked) }} />
          <span>{props.t('assetAuditConfirm')}</span></label>
        <div className={css.scriptActions}>
          <button type="button" className={css.primaryAction} disabled={busy || !confirmed}
            onClick={() => { void start() }}>{props.t('assetAuditStart')}</button>
        </div>
      </>}
    </>}
    {outcomeUnknown && <p role="alert">{props.t('assetAuditUnknown')}</p>}
    {error !== undefined && <p role="alert">{props.t('assetAuditError')}: {error}</p>}
  </section>
}
