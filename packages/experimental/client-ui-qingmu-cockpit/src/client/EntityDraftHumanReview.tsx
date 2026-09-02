import { useEffect, useRef, useState } from 'react'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

interface DraftReviewState {
  readonly schema: 'jason.qingmu-entity-draft-human-review-state.v1'
  readonly identity: { readonly naturalPersonId: string; readonly state: 'bound' }
  readonly promptIr: { readonly id: string; readonly version: number; readonly contentSha256: string; readonly status: 'Ready' }
  readonly drafts: readonly {
    readonly draftId: string
    readonly entityType: string
    readonly entityId: string
    readonly canonicalName: string
    readonly status: 'PendingReview' | 'Accepted' | 'Rejected'
    readonly facts: Readonly<Record<string, unknown>>
    readonly reference: Readonly<Record<string, unknown>> & { readonly assetId: string }
    readonly referencePackId: string
    readonly contentSha256: string
    readonly referencePackSha256: string
    readonly binding: {
      readonly profileRevision: number
      readonly profileSnapshotSha256: string
      readonly referenceBindingSha256: string
      readonly canonicalAssetId: string
      readonly referenceAssetIds: readonly string[]
    }
    readonly review: null | { readonly reviewedAt: string; readonly reviewIdentity: string; readonly note: string }
  }[]
}

interface Props {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly promptIrId: string
  readonly t: (key: QingmuCockpitKey) => string
}

interface DraftInputState {
  readonly note: string
  readonly confirmed: boolean
}

function params(props: Props, draftId?: string): URLSearchParams {
  return new URLSearchParams({
    projectId: props.projectId,
    episodeId: props.episodeId,
    storyboardRevisionId: props.storyboardRevisionId,
    frameId: props.frameId,
    promptIrId: props.promptIrId,
    ...(draftId === undefined ? {} : { draftId }),
  })
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid response')
  return value as Record<string, unknown>
}

/** Dedicated natural-person decision surface; browser authority never enters the RPC port. */
export function EntityDraftHumanReview(props: Props) {
  const [state, setState] = useState<DraftReviewState>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [draftInputs, setDraftInputs] = useState<Readonly<Record<string, DraftInputState>>>({})
  const [busy, setBusy] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState<string>()
  const scopeKey = params(props).toString()
  const activeScope = useRef(scopeKey)
  const loadRevision = useRef(0)
  activeScope.current = scopeKey

  const load = async (signal?: AbortSignal): Promise<void> => {
    const requestScope = scopeKey
    const requestRevision = ++loadRevision.current
    const stale = (): boolean => signal?.aborted === true
      || activeScope.current !== requestScope || loadRevision.current !== requestRevision
    const response = await fetch(`/api/qingmu/entity-draft-human-review/state?${requestScope}`, {
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
      ...(signal === undefined ? {} : { signal }),
    })
    if (stale()) return
    if (response.status === 401) {
      setNeedsLogin(true); setState(undefined); return
    }
    const value = await responseJson(response)
    if (stale()) return
    if (!response.ok || value.schema !== 'jason.qingmu-entity-draft-human-review-state.v1') {
      throw new Error(typeof value.code === 'string' ? value.code : 'entity_draft_review_state_failed')
    }
    setState(value as unknown as DraftReviewState)
    setNeedsLogin(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    setDraftInputs({})
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { controller.abort() }
  }, [props.projectId, props.episodeId, props.storyboardRevisionId, props.frameId, props.promptIrId])

  const login = async (): Promise<void> => {
    if (busy || username === '' || password === '') return
    setBusy(true); setError(undefined)
    try {
      const response = await fetch('/api/qingmu/editorial-handoff/human-session', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) throw new Error('entity_draft_review_login_failed')
      setPassword('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const decide = async (draftId: string, decision: 'accepted' | 'rejected'): Promise<void> => {
    const draftInput = draftInputs[draftId]
    if (busy || draftInput?.confirmed !== true) return
    setBusy(true); setError(undefined)
    try {
      const response = await fetch(
        `/api/qingmu/entity-draft-human-review/decision?${params(props, draftId).toString()}`,
        {
          method: 'POST', cache: 'no-store', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            decision, note: draftInput.note.trim() || null, confirmed: true,
            idempotencyKey: `entity-review-${crypto.randomUUID()}`,
          }),
        },
      )
      if (response.status === 401) {
        setNeedsLogin(true); setState(undefined); setDraftInputs({})
        throw new Error('entity_draft_review_relogin_required')
      }
      const value = await responseJson(response)
      if (!response.ok) throw new Error(typeof value.code === 'string' ? value.code : 'entity_draft_review_failed')
      setDraftInputs((current) => {
        const { [draftId]: _completed, ...remaining } = current
        return remaining
      })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  return <section className={css.entityReview} aria-label={props.t('entityDraftReviewTitle')}>
    <h4>{props.t('entityDraftReviewTitle')}</h4>
    <p>{props.t('entityDraftReviewBoundary')}</p>
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
    {state !== undefined && <>
      <p role="status">{props.t('entityDraftReviewBound')}: {state.identity.naturalPersonId}</p>
      <p>PromptIR {state.promptIr.id} · v{state.promptIr.version} · {state.promptIr.contentSha256}</p>
      {state.drafts.map((draft) => {
        const draftInput = draftInputs[draft.draftId] ?? { note: '', confirmed: false }
        return <article key={draft.draftId} className={css.entityReviewCard}>
          <h5>{draft.canonicalName} · {draft.entityType}/{draft.entityId}</h5>
          <p>{props.t('entityDraftReviewStatus')}: <strong>{draft.status}</strong></p>
          <details><summary>{props.t('directorSourceDetails')}</summary>
            <h6>{props.t('entityDraftReviewFacts')}</h6>
            <pre className={css.entityReviewJson}>{JSON.stringify(draft.facts, null, 2)}</pre>
            <h6>{props.t('entityDraftReviewReference')}</h6>
            <pre className={css.entityReviewJson}>{JSON.stringify(draft.reference, null, 2)}</pre>
            <p>Draft SHA: {draft.contentSha256}</p>
            <p>Profile v{draft.binding.profileRevision}: {draft.binding.profileSnapshotSha256}</p>
            <p>Reference: {draft.binding.referenceBindingSha256}</p>
            <p>{props.t('entityDraftReviewSelectedAsset')}: {draft.binding.canonicalAssetId}</p>
            <p>Pack {draft.referencePackId}: {draft.referencePackSha256}</p>
            {draft.review !== null && <p>Review: {draft.review.reviewIdentity} · {draft.review.reviewedAt}</p>}
          </details>
          {draft.status === 'PendingReview' && <>
            <label className={css.scriptEditor}><span>{props.t('entityDraftReviewNote')}</span>
              <textarea aria-label={`${props.t('entityDraftReviewNote')}: ${draft.canonicalName}`} rows={2} maxLength={2000}
                value={draftInput.note} onChange={(event) => { setDraftInputs(current => ({
                  ...current, [draft.draftId]: { ...draftInput, note: event.target.value },
                })) }} /></label>
            <label className={css.rightsCheck}><input type="checkbox" checked={draftInput.confirmed}
              aria-label={`${props.t('entityDraftReviewConfirm')}: ${draft.canonicalName}`}
              onChange={(event) => { setDraftInputs(current => ({
                ...current, [draft.draftId]: { ...draftInput, confirmed: event.target.checked },
              })) }} />
            <span>{props.t('entityDraftReviewConfirm')}</span></label>
            <div className={css.scriptActions}>
              <button type="button" className={css.primaryAction} disabled={busy || !draftInput.confirmed}
                aria-label={`${props.t('entityDraftReviewAccept')}: ${draft.canonicalName}`}
                onClick={() => { void decide(draft.draftId, 'accepted') }}>{props.t('entityDraftReviewAccept')}</button>
              <button type="button" disabled={busy || !draftInput.confirmed}
                aria-label={`${props.t('entityDraftReviewReject')}: ${draft.canonicalName}`}
                onClick={() => { void decide(draft.draftId, 'rejected') }}>{props.t('entityDraftReviewReject')}</button>
            </div>
          </>}
        </article>})}
    </>}
    {error !== undefined && <p role="alert">{props.t('entityDraftReviewError')}: {error}</p>}
  </section>
}
