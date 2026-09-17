import { useEffect, useRef, useState } from 'react'
import { HumanSessionSignIn, jsonObject } from './human-session.tsx'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

/** The closed `status` set the Writer's `frame_status` returns. */
type FrameStatus = 'technical_invalid' | 'pending' | 'stale' | 'rejected' | 'accepted'

interface ReviewFrame {
  readonly frameId: string
  readonly frameNo: number
  readonly title: string
  readonly durationSec: number
  readonly frameDigest: string
  readonly status: FrameStatus
  readonly accepted: boolean
  readonly blockerCode: string | null
}

interface EpisodeReviewState {
  readonly version: 'storyboard-preproduction-human-review-v1'
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevision: number
  readonly frameSetDigest: string
  readonly totalCount: number
  readonly acceptedCount: number
  readonly accepted: boolean
  readonly blockerCode: 'storyboard_human_review_required' | null
  readonly items: readonly ReviewFrame[]
  readonly providerCalls: 0
  readonly budgetMutation: false
}

interface Props {
  readonly episodeId: string
  readonly t: (key: QingmuCockpitKey) => string
}

/**
 * Writer rejection codes this surface explains.
 *
 * These are the codes `accept_episode_review` can raise for the item shape the
 * command bridge allows: it refuses `prompt_override`, `preflight_id`, `model`
 * and `resolution`, so the preflight-authority codes are unreachable and are
 * deliberately absent. Any other code is shown verbatim rather than guessed at.
 */
const REVIEW_REASONS: Readonly<Record<string, QingmuCockpitKey>> = {
  storyboard_human_review_frame_set_changed: 'storyboardReviewReasonFrameSetChanged',
  storyboard_human_review_frame_set_invalid: 'storyboardReviewReasonFrameSetChanged',
  storyboard_human_review_frame_set_incomplete: 'storyboardReviewReasonFrameSetIncomplete',
  storyboard_human_review_frame_set_digest_invalid: 'storyboardReviewReasonFrameSetIncomplete',
  storyboard_prompt_contract_invalid: 'storyboardReviewReasonPromptContractInvalid',
  storyboard_human_review_effective_contract_mismatch: 'storyboardReviewReasonPromptContractInvalid',
  storyboard_review_origin_forbidden: 'storyboardReviewReasonOriginForbidden',
  storyboard_human_review_authenticated_human_required: 'storyboardReviewReasonHumanRequired',
  storyboard_human_review_note_invalid: 'storyboardReviewReasonNoteInvalid',
  storyboard_human_review_idempotency_key_invalid: 'storyboardReviewReasonIdempotencyKeyInvalid',
  storyboard_human_review_idempotency_conflict: 'storyboardReviewReasonIdempotencyConflict',
  storyboard_human_review_atomic_acceptance_failed: 'storyboardReviewReasonAcceptanceFailed',
}

/**
 * Whole-episode storyboard pre-production review gate.
 *
 * The browser sends no identity field: the Host bridge authenticates with the
 * natural person's own `jason_token` cookie and refuses anything else. Nothing
 * here ever accepts on its own — acceptance needs a typed note plus an explicit
 * tick, because which storyboard is good enough to produce is the human's
 * creative decision.
 */
export function StoryboardHumanReview(props: Props) {
  const [state, setState] = useState<EpisodeReviewState>()
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  const [error, setError] = useState<string>()
  const scope = props.episodeId
  const activeScope = useRef(scope)
  const loadRevision = useRef(0)
  const idempotencyKey = useRef<string>()
  activeScope.current = scope

  const load = async (signal?: AbortSignal): Promise<void> => {
    const requestScope = scope
    const requestRevision = ++loadRevision.current
    const stale = (): boolean => signal?.aborted === true
      || activeScope.current !== requestScope || loadRevision.current !== requestRevision
    const response = await fetch(
      `/api/qingmu/storyboard-human-review/state?episodeId=${encodeURIComponent(requestScope)}`,
      {
        method: 'GET', cache: 'no-store', credentials: 'same-origin',
        ...(signal === undefined ? {} : { signal }),
      },
    )
    if (stale()) return
    if (response.status === 401) {
      setNeedsLogin(true); setState(undefined); return
    }
    const value = await jsonObject(response)
    if (stale()) return
    if (!response.ok || value.version !== 'storyboard-preproduction-human-review-v1') {
      throw new Error(typeof value.code === 'string' ? value.code : 'storyboard_human_review_state_failed')
    }
    setState(value as unknown as EpisodeReviewState)
    setNeedsLogin(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined); setOutcomeUnknown(false); setNote(''); setConfirmed(false)
    idempotencyKey.current = undefined
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { controller.abort() }
  }, [props.episodeId])

  const explain = (reason: string): string => {
    const key = REVIEW_REASONS[reason]
    return key === undefined ? reason : props.t(key)
  }

  const accept = async (): Promise<void> => {
    const reviewed = state
    const cleanNote = note.trim()
    if (busy || reviewed === undefined || reviewed.accepted || reviewed.items.length === 0) return
    if (cleanNote === '' || !confirmed) return
    setBusy(true); setError(undefined); setOutcomeUnknown(false)
    // One key per decision: the Writer replays an identical (key, content) pair as
    // a no-op, so an unknown outcome can be resubmitted safely with the same key.
    const key = idempotencyKey.current ?? `storyboard-review-${crypto.randomUUID()}`
    idempotencyKey.current = key
    try {
      const response = await fetch(
        `/api/qingmu/storyboard-human-review/accept?episodeId=${encodeURIComponent(props.episodeId)}`,
        {
          method: 'POST', cache: 'no-store', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedFrameSetDigest: reviewed.frameSetDigest,
            items: reviewed.items.map(item => ({
              frameId: item.frameId, expectedFrameDigest: item.frameDigest,
            })),
            note: cleanNote, idempotencyKey: key, confirmed: true,
          }),
        },
      )
      if (response.status === 401) {
        // Definitive non-write: the bridge and the Writer both reject before any
        // transaction, so the next attempt starts from a fresh key.
        idempotencyKey.current = undefined
        setNeedsLogin(true); setState(undefined); setNote(''); setConfirmed(false)
        throw new Error('storyboard_human_review_relogin_required')
      }
      const value = await jsonObject(response)
      if (response.status === 502) {
        // Outcome unknown: keep the key and the note so a retry is an exact
        // idempotent replay, but drop the tick so nothing is accepted implicitly.
        setOutcomeUnknown(true); setConfirmed(false)
        await load()
        return
      }
      if (!response.ok) {
        const code = typeof value.code === 'string' ? value.code : 'storyboard_human_review_accept_failed'
        idempotencyKey.current = undefined
        setNote(''); setConfirmed(false)
        throw new Error(typeof value.reason === 'string'
          ? `${code}: ${explain(value.reason)}` : code)
      }
      idempotencyKey.current = undefined
      setNote(''); setConfirmed(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const reviewable = state !== undefined && !state.accepted && state.items.length > 0

  return <section className={css.entityReview} aria-label={props.t('storyboardReviewTitle')}>
    <h4>{props.t('storyboardReviewTitle')}</h4>
    <p className={css.boundary}>{props.t('storyboardReviewBoundary')}</p>
    {needsLogin && <HumanSessionSignIn t={props.t} failureCode="storyboard_human_review_login_failed"
      onError={setError} onSignedIn={() => load()} />}
    {state === undefined && !needsLogin && error === undefined
      && <p role="status" className={css.empty}>{props.t('storyboardReviewLoading')}</p>}
    {state !== undefined && <>
      <p role="status"><strong>
        {state.accepted ? props.t('storyboardReviewAccepted') : props.t('storyboardReviewPending')}
      </strong></p>
      <p>{props.t('storyboardReviewProgress')}: {state.acceptedCount}/{state.totalCount}</p>
      <p>{props.t('storyboardReviewBlocker')}: {state.blockerCode ?? '—'}</p>
      <p>{props.t('storyboardReviewRevision')}: {state.storyboardRevision}</p>
      <p>{props.t('storyboardReviewFrameSetDigest')}: {state.frameSetDigest}</p>
      {state.items.length === 0
        ? <p className={css.empty}>{props.t('storyboardReviewEmpty')}</p>
        : <>
          <h5>{props.t('storyboardReviewFrames')}</h5>
          <ul className={css.list}>
            {state.items.map(item => <li key={item.frameId}>
              {props.t('storyboardReviewFrameNo')} {item.frameNo} · {item.title}
              {' · '}{props.t('storyboardReviewFrameDuration')} {item.durationSec}
              {' · '}{props.t('storyboardReviewFrameStatus')} {item.status}
              <br />{props.t('storyboardReviewFrameDigest')}: {item.frameDigest}
            </li>)}
          </ul>
        </>}
      {reviewable && <>
        <label className={css.scriptEditor}><span>{props.t('storyboardReviewNote')}</span>
          <textarea aria-label={props.t('storyboardReviewNote')} rows={2} maxLength={1000} value={note}
            onChange={(event) => { setNote(event.target.value) }} /></label>
        <label className={css.rightsCheck}>
          <input type="checkbox" checked={confirmed} aria-label={props.t('storyboardReviewConfirm')}
            onChange={(event) => { setConfirmed(event.target.checked) }} />
          <span>{props.t('storyboardReviewConfirm')}</span></label>
        <div className={css.scriptActions}>
          <button type="button" className={css.primaryAction}
            disabled={busy || !confirmed || note.trim() === ''}
            onClick={() => { void accept() }}>{props.t('storyboardReviewAccept')}</button>
        </div>
      </>}
    </>}
    {outcomeUnknown && <p role="alert">{props.t('storyboardReviewUnknown')}</p>}
    {error !== undefined && <p role="alert">{props.t('storyboardReviewError')}: {error}</p>}
  </section>
}
