/** Point-in-time episode evidence and explicit read-only canonical verification. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  QingmuYimengReadPort, YimengEpisodeEvidenceLedgerResponse,
  YimengEpisodeVerificationResponse, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './EpisodeEvidenceLedger.module.css'

/** The panel has no command, approval, export, Provider, or persistence port. */
export type EpisodeEvidencePort = Pick<QingmuYimengReadPort, 'evidenceLedger' | 'verifyEpisode'>

interface Props {
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: EpisodeEvidencePort
  readonly t: (key: QingmuCockpitKey) => string
}

interface Scope {
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: EpisodeEvidencePort
}

interface State {
  readonly scope: Scope
  readonly busy?: 'load' | 'verify'
  readonly ledger?: YimengEpisodeEvidenceLedgerResponse | undefined
  readonly result?: YimengEpisodeVerificationResponse
  readonly notice?: QingmuCockpitKey
  readonly failed?: boolean
}

interface Run {
  readonly scope: Scope
  readonly controller: AbortController
}

function assertLedger(ledger: YimengEpisodeEvidenceLedgerResponse, scope: Scope): void {
  if (ledger.projectId !== scope.projectId || ledger.episodeId !== scope.episodeId
    || ledger.source.projectId !== scope.projectId || ledger.source.episodeId !== scope.episodeId
    || !/^[0-9a-f]{64}$/.test(ledger.sourceSnapshotSha256)) throw new Error('EVIDENCE_SCOPE_INVALID')
}

function failureNotice(error: unknown): QingmuCockpitKey {
  const message = error instanceof Error ? error.message.toUpperCase() : ''
  if (/STALE|DRIFT|SOURCE_CHANGED|SOURCE_SNAPSHOT_CONFLICT/.test(message)) return 'evidenceStale'
  if (/TIMEOUT|TIMED OUT/.test(message)) return 'evidenceTimeout'
  if (/BUSY/.test(message)) return 'evidenceBusy'
  if (/PROBE_UNAVAILABLE/.test(message)) return 'evidenceProbeUnavailable'
  return 'evidenceError'
}

/** Render verified Host projections without turning probe success into approval. */
export function EpisodeEvidenceLedger({ projectId, episodeId, projection, enabled, port, t }: Props) {
  const scope = useMemo(() => ({ projectId, episodeId, projection, enabled, port }),
    [projectId, episodeId, projection, enabled, port])
  const [state, setState] = useState<State>({ scope })
  const running = useRef<Run>()
  useEffect(() => () => {
    if (running.current?.scope === scope) {
      running.current.controller.abort()
      running.current = undefined
    }
  }, [scope])
  const current = state.scope === scope ? state : undefined
  const busy = current?.busy !== undefined
  const ledger = current?.ledger
  const result = current?.result
  const available = enabled && projectId !== '' && episodeId !== ''

  async function execute(kind: 'load' | 'verify'): Promise<void> {
    if (!available || running.current !== undefined || (kind === 'verify' && ledger === undefined)) return
    const run: Run = { scope, controller: new AbortController() }
    running.current = run
    // Any read/retry immediately retires the previous verification, even if the read fails.
    setState({ scope, busy: kind, ledger: kind === 'verify' ? ledger : undefined })
    try {
      const request = { projectId, episodeId }
      if (kind === 'load') {
        const next = await port.evidenceLedger(request, run.controller.signal)
        assertLedger(next, scope)
        if (running.current === run) setState({ scope, ledger: next })
      } else if (ledger !== undefined) {
        const verified = await port.verifyEpisode({ ...request, sourceSnapshotSha256: ledger.sourceSnapshotSha256 }, run.controller.signal)
        if (verified.projectId !== projectId || verified.episodeId !== episodeId
          || verified.verification.project_id !== projectId || verified.verification.episode_id !== episodeId
          || verified.sourceSnapshotSha256 !== ledger.sourceSnapshotSha256) throw new Error('EVIDENCE_SOURCE_CHANGED')
        // Re-read after the probe: a newer source cannot inherit the completed report.
        const latest = await port.evidenceLedger(request, run.controller.signal)
        assertLedger(latest, scope)
        if (latest.sourceSnapshotSha256 !== verified.sourceSnapshotSha256) throw new Error('EVIDENCE_SOURCE_CHANGED')
        if (running.current === run) setState({ scope, ledger: latest, result: verified })
      }
    } catch (error) {
      if (running.current === run) setState({ scope, notice: failureNotice(error), failed: true })
    } finally {
      if (running.current === run) running.current = undefined
    }
  }

  return (
    <section className={card.card} aria-label={t('evidenceTitle')} aria-busy={busy}>
      <h3>{t('evidenceTitle')}</h3>
      <p className={css.note}>{t('evidenceBoundary')}</p>
      <div className={css.actions}>
        <button type="button" disabled={!available || busy} onClick={() => { void execute('load') }}>
          {t(current?.busy === 'load' ? 'evidenceLoading' : ledger === undefined ? 'evidenceLoad' : 'evidenceRefresh')}
        </button>
        <button type="button" disabled={!available || busy || ledger === undefined} onClick={() => { void execute('verify') }}>
          {t(current?.busy === 'verify' ? 'evidenceVerifying' : 'evidenceVerify')}
        </button>
      </div>
      {current?.notice !== undefined
        ? <p role={current.failed ? 'alert' : 'status'}>{t(current.notice)}</p>
        : <p role="status">{t(busy ? 'evidenceWorking' : result === undefined ? 'evidenceUnverified' : 'evidenceRecorded')}</p>}
      {ledger !== undefined && <>
        <p>{t('evidenceScope')}: {projectId} / {episodeId}</p>
        <p className={css.hash}>{t('evidenceSourceSha')}: <code>{ledger.sourceSnapshotSha256}</code></p>
        <p className={css.note}>{t('evidenceSignoff')}</p>
        {ledger.source.frames.length === 0 && <p>{t('evidenceNoFrames')}</p>}
        {ledger.source.frames.map(frame => (
          <details key={frame.frameId}>
            <summary>{t('evidenceFrame')} {frame.frameNo} · {frame.frameId}</summary>
            {([
              ['evidenceTakes', frame.stack], ['evidenceComments', frame.comments],
              ['evidenceReview', frame.review], ['evidenceReceipt', frame.acceptance],
              ['evidenceQc', frame.qc], ['evidenceLifecycle', frame.lifecycle],
            ] as const).map(([key, value]) => <details key={key}>
              <summary>{t(key)}</summary>
              {value === null ? <p>{t('evidenceMissing')}</p> : <pre className={css.json}>{JSON.stringify(value, null, 2)}</pre>}
            </details>)}
          </details>
        ))}
      </>}
      {result !== undefined && <div className={css.report}>
        <h4>{t('evidenceReport')}</h4>
        <p className={css.note}>{t('evidencePointInTime')}</p>
        <dl>
          <dt>{t('evidenceVerifiedAt')}</dt><dd>{result.verifiedAt}</dd>
          <dt>{t('evidenceCanonicalOk')}</dt><dd>{String(result.verification.ok)}</dd>
          <dt>{t('evidenceTechnicalOk')}</dt><dd>{String(result.verification.technical_ok)}</dd>
          <dt>{t('evidenceCreativeOk')}</dt><dd>{String(result.verification.creative_ok)}</dd>
        </dl>
        <p className={css.hash}>{t('evidenceReportSha')}: <code>{result.verificationSha256}</code></p>
        <pre className={css.json} aria-label={t('evidenceRawReport')}>{JSON.stringify(result.verification, null, 2)}</pre>
      </div>}
    </section>
  )
}
