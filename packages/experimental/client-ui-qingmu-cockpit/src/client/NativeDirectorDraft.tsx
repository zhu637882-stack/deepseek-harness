/** A logged native suggestion can edit one local field, never save, select Ready or generate. */
import { useEffect, useRef, useState } from 'react'
import type { DirectorContextClientPort, DirectorObjectScope, NativeDraftProposal } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import type { YimengPromptIrResponse } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import { useDirectorConnection } from './native-director-session.ts'

/** The active native session and canonical Writer shot, supplied by the workspace. */
export interface NativeDirectorDraftContext {
  readonly bridge: DirectorContextClientPort
  readonly sessionId: string | undefined
  readonly scope: DirectorObjectScope
  readonly connection?: HostDescriptionSource | undefined
}

/** Reject stale Writer baselines and preserve local edits, including changes made while checking freshness. */
export function mergeNativeDraft(
  proposal: NativeDraftProposal, snapshot: YimengPromptIrResponse,
  draft: YimengPromptIrResponse['subject']['editableProjection'], scope: DirectorObjectScope,
): YimengPromptIrResponse['subject']['editableProjection'] {
  const input = proposal.input
  if (Object.entries(scope).some(([key, value]) => input.scope[key as keyof DirectorObjectScope] !== value)
    || input.baseSnapshotSha256 !== snapshot.baseSnapshotSha256
    || input.baseRevision !== snapshot.baseRevision
    || input.storyboardRevisionId !== snapshot.subject.storyboardRevisionId
    || input.frameId !== snapshot.subject.frameId
    || input.draftSnapshotSha256 !== (snapshot.draft?.subjectSnapshotSha256 ?? null)
    || snapshot.draft?.status === 'stale') throw new Error('stale')
  const original = (snapshot.draft?.subject ?? snapshot.subject).editableProjection[proposal.field]
  if (original !== proposal.before || draft[proposal.field] !== proposal.before) throw new Error('conflict')
  return { ...draft, [proposal.field]: proposal.after }
}

/** Async replies are scoped to the current editor lifetime; adoption reruns Host freshness checks. */
export function NativeDirectorDraft({ context, disabled, sourceKey, onAdopt, t }: {
  readonly context: NativeDirectorDraftContext
  readonly disabled: boolean
  readonly sourceKey: string
  readonly onAdopt: (proposal: NativeDraftProposal) => void
  readonly t: (key: QingmuCockpitKey) => string
}) {
  const connection = useDirectorConnection(context.connection)
  const [proposal, setProposal] = useState<NativeDraftProposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<QingmuCockpitKey | null>(null)
  const pending = useRef<AbortController | null>(null)
  const key = JSON.stringify([context.sessionId, context.scope, sourceKey])
  const latest = useRef({ key, connection, disabled, onAdopt })
  latest.current = { key, connection, disabled, onAdopt }
  useEffect(() => {
    pending.current?.abort()
    pending.current = null
    setProposal(null); setBusy(false); setNotice(null)
    return () => { pending.current?.abort() }
  }, [key, connection])

  async function read(adopt: boolean) {
    const readProposal = context.bridge.readNativeDraftProposal
    if (!connection || !context.sessionId || !readProposal || disabled || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setNotice(null)
    try {
      const result = await readProposal(context.sessionId, context.scope, controller.signal)
      if (controller.signal.aborted || latest.current.key !== key || latest.current.connection !== connection) return
      if (result.status !== 'current') {
        setProposal(null)
        setNotice(result.status === 'none' ? 'nativeDraftNone' : result.status === 'stale' ? 'nativeDraftStale' : 'nativeDraftUnavailable')
        return
      }
      if (!adopt) { setProposal(result.proposal); return }
      if (latest.current.disabled) return
      if (JSON.stringify(result.proposal) !== JSON.stringify(proposal)) {
        setProposal(result.proposal); setNotice('nativeDraftChanged'); return
      }
      latest.current.onAdopt(result.proposal)
      setProposal(null); setNotice('nativeDraftAdopted')
    } catch {
      if (!controller.signal.aborted && latest.current.key === key) setNotice(adopt ? 'nativeDraftConflict' : 'nativeDraftUnavailable')
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }

  return <section aria-label={t('nativeDraftTitle')}>
    <h4>{t('nativeDraftTitle')}</h4><p>{t('nativeDraftHint')}</p>
    <button type="button" disabled={!connection || disabled || busy || !context.sessionId || !context.bridge.readNativeDraftProposal}
      onClick={() => { void read(false) }}>{t(busy ? 'nativeDraftChecking' : 'nativeDraftRead')}</button>
    {connection && proposal && <div>
      <p>{proposal.reason}</p><p>{t('nativeDraftField')}: {proposal.field}</p>
      <details><summary>{t('nativeDraftBefore')}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{proposal.before}</pre></details>
      <h5>{t('nativeDraftAfter')}</h5><pre style={{ whiteSpace: 'pre-wrap' }}>{proposal.after}</pre>
      <button type="button" disabled={disabled || busy} onClick={() => { void read(true) }}>{t('nativeDraftAdopt')}</button>
    </div>}
    {notice && <p role="status">{t(notice)}</p>}
  </section>
}
