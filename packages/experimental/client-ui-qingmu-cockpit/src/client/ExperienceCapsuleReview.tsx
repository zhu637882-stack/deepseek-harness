import { useEffect, useRef, useState } from 'react'
import { HumanSessionSignIn, jsonObject } from './human-session.tsx'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

/** One capsule the director queued for review. */
interface QueueEntry {
  readonly id: string
  readonly symptom: string
  readonly rule: string
  readonly submittedAt?: string
  readonly alreadyApproved: boolean
}

/** One approved capsule, newest-first. */
interface ActiveEntry {
  readonly id: string
  readonly symptom: string
  readonly rule: string
  readonly stages: readonly string[]
  readonly injected: boolean
}

interface ReviewState {
  readonly schema: 'qingmu-experience-capsule-review-v1'
  readonly renderLimit: number
  readonly injectedCount: number
  readonly queue: readonly QueueEntry[]
  readonly active: readonly ActiveEntry[]
  readonly promoted?: readonly string[]
}

interface Props {
  readonly t: (key: QingmuCockpitKey) => string
}

const REVIEW_PATH = '/api/qingmu/experience-capsule-review'

/**
 * Human review of the director's self-written experience capsules.
 *
 * The director queues a lesson after a rejected take; only a promotion moves it
 * into the store the persona injects, so this panel is the loop's one human
 * gate. Nothing here ticks or promotes on its own: every capsule is an explicit
 * checkbox and the button stays disabled until one is ticked. The request reads
 * and writes two files in the harness runtime root — no provider call, no budget
 * movement — and a deployment without that root renders nothing at all.
 */
export function ExperienceCapsuleReview(props: Props) {
  const [state, setState] = useState<ReviewState>()
  const [absent, setAbsent] = useState(false)
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState<string>()
  const loadRevision = useRef(0)

  const load = async (signal?: AbortSignal): Promise<void> => {
    const revision = ++loadRevision.current
    const response = await fetch(REVIEW_PATH, {
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
      ...(signal === undefined ? {} : { signal }),
    })
    const value = await jsonObject(response)
    if (loadRevision.current !== revision) return
    const code = typeof value.code === 'string' ? value.code : undefined
    if (code === 'experience_capsule_review_runtime_root_unconfigured') { setAbsent(true); return }
    if (!response.ok || value.schema !== 'qingmu-experience-capsule-review-v1') {
      throw new Error(code ?? 'experience_capsule_review_state_failed')
    }
    setAbsent(false)
    setState(value as unknown as ReviewState)
    setTicked([])
  }

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { controller.abort(); loadRevision.current += 1 }
  }, [])

  const promote = async (): Promise<void> => {
    if (busy || ticked.length === 0) return
    setBusy(true); setError(undefined)
    try {
      const response = await fetch(`${REVIEW_PATH}/promote`, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true, ids: ticked }),
      })
      const value = await jsonObject(response)
      const code = typeof value.code === 'string' ? value.code : undefined
      if (response.status === 403) {
        setNeedsLogin(true)
        throw new Error(code ?? 'experience_capsule_review_forbidden')
      }
      if (!response.ok || value.schema !== 'qingmu-experience-capsule-review-v1') {
        // The queue moved under this decision, or the files are unusable: reload
        // so the operator promotes against what is actually queued.
        setTicked([])
        // Swallows only a failed reload: the refusal below is the error worth showing.
        await load().catch(() => undefined)
        throw new Error(code ?? 'experience_capsule_review_promote_failed')
      }
      setNeedsLogin(false)
      setState(value as unknown as ReviewState)
      setTicked([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const refresh = (): void => {
    if (busy) return
    setBusy(true); setError(undefined)
    void load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setBusy(false) })
  }

  if (absent) return null
  const reviewed = state
  return <section className={css.entityReview} aria-label={props.t('capsuleReviewTitle')}>
    <h4>{props.t('capsuleReviewTitle')}</h4>
    <p className={css.boundary}>{props.t('capsuleReviewBoundary')}</p>
    {needsLogin && <HumanSessionSignIn t={props.t} failureCode="experience_capsule_review_login_failed"
      onError={setError} onSignedIn={() => load()} />}
    {reviewed === undefined && error === undefined
      && <p role="status" className={css.empty}>{props.t('capsuleReviewLoading')}</p>}
    {reviewed !== undefined && <>
      <p role="status">
        {props.t('capsuleReviewQueued')}: {reviewed.queue.length}
        {' · '}{props.t('capsuleReviewActive')}: {reviewed.active.length}
        {' · '}{props.t('capsuleReviewInjected')}: {reviewed.injectedCount}/{reviewed.renderLimit}
      </p>
      {reviewed.promoted !== undefined && <p role="status"><strong>
        {props.t('capsuleReviewPromoted')}: {reviewed.promoted.join(', ')}
      </strong></p>}
      {reviewed.queue.length === 0
        ? <p className={css.empty}>{props.t('capsuleReviewQueueEmpty')}</p>
        : <ul className={css.list}>
          {reviewed.queue.map((entry) => {
            const checked = ticked.includes(entry.id)
            return <li key={entry.id}>
              <label className={css.rightsCheck}>
                <input type="checkbox" checked={checked} aria-label={`${props.t('capsuleReviewTick')} ${entry.id}`}
                  onChange={(event) => {
                    setTicked(event.target.checked
                      ? [...ticked, entry.id] : ticked.filter(id => id !== entry.id))
                  }} />
                <span><strong>{entry.id}</strong>
                  {entry.submittedAt === undefined ? '' : ` · ${entry.submittedAt}`}
                  {entry.alreadyApproved ? ` · ${props.t('capsuleReviewAlreadyApproved')}` : ''}
                  <br />{entry.symptom === '' ? '' : `${entry.symptom} → `}{entry.rule}
                </span>
              </label>
            </li>
          })}
        </ul>}
      <details>
        <summary>{props.t('capsuleReviewActiveTitle')}</summary>
        {reviewed.active.length === 0
          ? <p className={css.empty}>{props.t('capsuleReviewActiveEmpty')}</p>
          : <ul className={css.list}>
            {reviewed.active.map((entry) => {
              const stages = entry.stages.length === 0
                ? props.t('capsuleReviewAllStages') : entry.stages.join(', ')
              return <li key={entry.id}>
                <strong>{entry.id}</strong>
                {' · '}{props.t('capsuleReviewStages')}: {stages}
                {' · '}{entry.injected ? props.t('capsuleReviewEntryInjected') : props.t('capsuleReviewNotInjected')}
                <br />{entry.symptom === '' ? '' : `${entry.symptom} → `}{entry.rule}
              </li>
            })}
          </ul>}
      </details>
    </>}
    <div className={css.scriptActions}>
      {reviewed !== undefined && <button type="button" className={css.primaryAction}
        disabled={busy || ticked.length === 0}
        onClick={() => { void promote() }}>{props.t('capsuleReviewPromote')}</button>}
      <button type="button" disabled={busy} onClick={refresh}>{props.t('capsuleReviewRefresh')}</button>
    </div>
    {error !== undefined && <p role="alert">{props.t('capsuleReviewError')}: {error}</p>}
  </section>
}
