import { useState } from 'react'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

/**
 * Shared plumbing for the panels whose decision needs the operator's own browser
 * session: the JSON reader every one of them uses, the sign-in request they all
 * send, and the sign-in form they all render.
 */

/** The sign-in route the Host bridge exposes for a natural person's own session. */
const HUMAN_SESSION_PATH = '/api/qingmu/editorial-handoff/human-session'

/**
 * Read one JSON object reply.
 *
 * @param response - fetched reply whose body is consumed here.
 * @returns the parsed object.
 * @throws when the body is not a JSON object, so a caller's own error code is never
 * replaced by a field read on an array or a primitive.
 */
export async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid response')
  return value as Record<string, unknown>
}

/**
 * Sign the operator's own browser in and let the Host set its session cookie.
 *
 * The credential never reaches the panel state after this resolves, and the
 * browser sends no identity field on the decision requests that follow.
 *
 * @param username - account the operator typed.
 * @param password - password the operator typed.
 * @param failureCode - panel-specific code reported when the request is refused.
 * @throws the failure code, so each panel explains a refused sign-in in its own terms.
 */
export async function signInHumanSession(username: string, password: string, failureCode: string): Promise<void> {
  const response = await fetch(HUMAN_SESSION_PATH, {
    method: 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) throw new Error(failureCode)
}

/** What the panel tells the sign-in form and what it asks back. */
export interface HumanSessionSignInProps {
  readonly t: (key: QingmuCockpitKey) => string
  /** Code reported when the sign-in request itself is refused. */
  readonly failureCode: string
  /** Receives the failure code, or undefined to clear a stale one before a new attempt. */
  readonly onError: (message: string | undefined) => void
  /** Runs once the cookie is set: reload the gated state, or simply hide this form. */
  readonly onSignedIn: () => void | Promise<void>
}

/**
 * The sign-in form a panel shows when its own route answered that the session expired.
 *
 * Credentials stay inside this component: the password is dropped on success and is
 * never handed to the panel, so a panel cannot log it or resend it.
 *
 * @param props - labels, the panel's failure code and the two callbacks.
 */
export function HumanSessionSignIn(props: HumanSessionSignInProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy || username === '' || password === '') return
    setBusy(true); props.onError(undefined)
    try {
      await signInHumanSession(username, password, props.failureCode)
      setPassword('')
      await props.onSignedIn()
    } catch (cause) {
      props.onError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  return <div className={css.entityReviewLogin}>
    <label><span>{props.t('entityDraftReviewAccount')}</span>
      <input aria-label={props.t('entityDraftReviewAccount')} value={username}
        autoComplete="username" onChange={(event) => { setUsername(event.target.value) }} /></label>
    <label><span>{props.t('entityDraftReviewPassword')}</span>
      <input aria-label={props.t('entityDraftReviewPassword')} value={password} type="password"
        autoComplete="current-password" onChange={(event) => { setPassword(event.target.value) }} /></label>
    <button type="button" className={css.primaryAction} disabled={busy || username === '' || password === ''}
      onClick={() => { void submit() }}>{props.t('entityDraftReviewLogin')}</button>
  </div>
}
