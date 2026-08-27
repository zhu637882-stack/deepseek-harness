import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  QingmuYimengPort,
  YimengCommitScriptResponse,
  YimengRecoverScriptCommitResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { StageSourceView } from './StageSourceView.tsx'
import {
  INITIAL_SCRIPT_WORKSPACE_STATE,
  canCommitScript,
  canPrepareScript,
  parseScriptDraft,
  scriptCommitIdempotencyKey,
  scriptWorkspaceReducer,
} from './script-workspace-state.ts'
import {
  clearScriptCommitRecoveryMarker,
  createScriptCommitRecoveryMarker,
  discardScriptCommitRecoveryMarker,
  readScriptCommitRecoveryMarker,
  writeScriptCommitRecoveryMarker,
  type ScriptCommitRecoveryMarker,
  type ScriptCommitRecoveryMarkerRead,
} from './script-commit-recovery.ts'
import css from './QingmuCockpit.module.css'

const SHA256 = /^[0-9a-f]{64}$/

export interface ScriptWorkspaceProps {
  readonly projectId: string
  readonly episodeId: string
  readonly port: QingmuYimengPort
  readonly t: (key: QingmuCockpitKey) => string
  readonly onCommitted: () => Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]))
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftObject = left as Record<string, unknown>
  const rightObject = right as Record<string, unknown>
  const leftKeys = Object.keys(leftObject).sort()
  const rightKeys = Object.keys(rightObject).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(leftObject[key], rightObject[key]))
}

function assertCommitReceiptLineage(
  receipt: YimengCommitScriptResponse,
  marker: ScriptCommitRecoveryMarker,
): void {
  const receiptContract = receipt as unknown as Record<string, unknown>
  if (
    receiptContract.schema !== 'jason.qingmu-episode-script-commit-result.v1'
    || receipt.changeSetId !== marker.changeSetId
    || receipt.projectId !== marker.projectId
    || receipt.episodeId !== marker.episodeId
    || receipt.baseRevision !== marker.baseRevision
    || receipt.payloadSha256 !== marker.expectedPayloadSha256
    || receipt.idempotencyKey !== marker.idempotencyKey
  ) {
    throw new Error('易梦返回的提交回执与本次 ChangeSet 血缘不一致')
  }
}

function assertRecoveryLineage(
  recovery: YimengRecoverScriptCommitResponse,
  marker: ScriptCommitRecoveryMarker,
): YimengCommitScriptResponse {
  const recoveryContract = recovery as unknown as Record<string, unknown>
  if (
    recoveryContract.schema !== 'jason.qingmu-command-receipt-recovery.v1'
    || recoveryContract.recovered !== true
    || !SHA256.test(recovery.receiptSha256)
  ) {
    throw new Error('易梦返回的回执恢复合同不完整')
  }
  assertCommitReceiptLineage(recovery.receipt, marker)
  return recovery.receipt
}

/** Human-operated draft → ChangeSet preview → explicit commit workspace. */
export function ScriptWorkspace({ projectId, episodeId, port, t, onCommitted }: ScriptWorkspaceProps) {
  const [state, dispatch] = useReducer(scriptWorkspaceReducer, INITIAL_SCRIPT_WORKSPACE_STATE)
  const [recovery, setRecovery] = useState<ScriptCommitRecoveryMarkerRead>(() =>
    readScriptCommitRecoveryMarker(projectId, episodeId))
  const abortRef = useRef<AbortController>()

  useEffect(() => {
    setRecovery(readScriptCommitRecoveryMarker(projectId, episodeId))
  }, [episodeId, projectId])

  const loadSnapshot = useCallback(async (): Promise<void> => {
    abortRef.current?.abort()
    if (projectId === '' || episodeId === '') {
      dispatch({ type: 'reset' })
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'load-start' })
    try {
      const snapshot = await port.script({ projectId, episodeId }, controller.signal)
      if (snapshot.projectId !== projectId || snapshot.episodeId !== episodeId) {
        throw new Error('易梦返回的剧本与当前项目或剧集不一致')
      }
      if (!isAborted(controller.signal)) dispatch({ type: 'load-success', snapshot })
    } catch (error) {
      if (!isAborted(controller.signal)) dispatch({ type: 'load-failure', error: messageOf(error) })
    }
  }, [episodeId, port, projectId])

  useEffect(() => {
    void loadSnapshot()
    return () => { abortRef.current?.abort() }
  }, [loadSnapshot])

  const prepare = async (): Promise<void> => {
    if (!canPrepareScript(state) || state.snapshot === undefined || recovery.status !== 'none') return
    let script: Record<string, unknown>
    try {
      script = parseScriptDraft(state.draft)
    } catch (error) {
      dispatch({ type: 'prepare-failure', error: messageOf(error) })
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'prepare-start' })
    try {
      const proposal = await port.proposeScript({
        projectId,
        episodeId,
        script,
        baseRevision: state.snapshot.revision,
      }, controller.signal)
      if (
        proposal.changeSet.projectId !== projectId
        || proposal.changeSet.episodeId !== episodeId
        || proposal.changeSet.targetId !== episodeId
        || proposal.changeSet.baseRevision !== state.snapshot.revision
      ) {
        throw new Error('易梦返回的提案与当前剧集基线不一致')
      }
      const preview = await port.previewScript({
        projectId,
        episodeId,
        changeSetId: proposal.changeSet.id,
        baseRevision: proposal.changeSet.baseRevision,
      }, controller.signal)
      if (
        preview.changeSetId !== proposal.changeSet.id
        || preview.changeSet.id !== proposal.changeSet.id
        || preview.changeSet.projectId !== projectId
        || preview.changeSet.episodeId !== episodeId
        || preview.changeSet.targetId !== episodeId
        || preview.payloadSha256 !== proposal.changeSet.payloadSha256
        || preview.baseRevision !== proposal.changeSet.baseRevision
        || preview.changeSet.baseRevision !== proposal.changeSet.baseRevision
        || !sameJson(preview.proposedScript, script)
      ) {
        throw new Error('易梦返回的提案、预览血缘或拟提交内容不一致')
      }
      if (!isAborted(controller.signal)) {
        dispatch({
          type: 'prepare-success',
          preview,
          idempotencyKey: scriptCommitIdempotencyKey(preview.changeSetId, preview.payloadSha256),
        })
      }
    } catch (error) {
      if (!isAborted(controller.signal)) dispatch({ type: 'prepare-failure', error: messageOf(error) })
    }
  }

  const finishAcceptedCommit = async (
    result: YimengCommitScriptResponse,
    marker: ScriptCommitRecoveryMarker,
    controller: AbortController,
    recovered: boolean,
  ): Promise<void> => {
    if (isAborted(controller.signal)) return
    assertCommitReceiptLineage(result, marker)
    dispatch({ type: 'commit-success', commit: result, recovered })

    const [scriptRefresh, workflowRefresh] = await Promise.allSettled([
      port.script({ projectId, episodeId }, controller.signal),
      onCommitted(),
    ])
    if (isAborted(controller.signal)) return
    const scriptSubjectMismatch = scriptRefresh.status === 'fulfilled'
      && (scriptRefresh.value.projectId !== projectId || scriptRefresh.value.episodeId !== episodeId)
    const scriptRevisionMismatch = scriptRefresh.status === 'fulfilled'
      && scriptRefresh.value.revision !== result.authoritativeRevision
    const scriptSnapshotMismatch = scriptRefresh.status === 'fulfilled'
      && !scriptSubjectMismatch
      && !scriptRevisionMismatch
      && scriptRefresh.value.scriptSha256 !== result.authoritativeSnapshotSha256
    const authoritativeReadSucceeded = scriptRefresh.status === 'fulfilled'
      && !scriptSubjectMismatch
      && !scriptRevisionMismatch
      && !scriptSnapshotMismatch
    if (authoritativeReadSucceeded) {
      dispatch({ type: 'post-commit-refresh', snapshot: scriptRefresh.value })
    }
    const markerCleared = authoritativeReadSucceeded && clearScriptCommitRecoveryMarker(marker)
    if (markerCleared) setRecovery({ status: 'none' })
    const warnings = [
      ...(scriptSubjectMismatch ? ['易梦刷新后的剧本与当前项目或剧集不一致'] : []),
      ...(scriptRevisionMismatch ? ['易梦刷新后的剧本版本与提交回执不一致'] : []),
      ...(scriptSnapshotMismatch ? [t('receiptRecoverySnapshotMismatch')] : []),
      ...(scriptRefresh.status === 'rejected' ? [messageOf(scriptRefresh.reason)] : []),
      ...(workflowRefresh.status === 'rejected' ? [messageOf(workflowRefresh.reason)] : []),
      ...(authoritativeReadSucceeded && !markerCleared ? [t('receiptRecoveryClearWarning')] : []),
    ]
    if (warnings.length > 0) {
      dispatch({ type: 'post-commit-warning', warning: warnings.join(' · ') })
    }
  }

  const commit = async (): Promise<void> => {
    if (
      !canCommitScript(state)
      || state.preview === undefined
      || state.idempotencyKey === undefined
      || recovery.status !== 'none'
    ) return
    const marker = createScriptCommitRecoveryMarker({
      projectId,
      episodeId,
      changeSetId: state.preview.changeSetId,
      baseRevision: state.preview.baseRevision,
      idempotencyKey: state.idempotencyKey,
      expectedPayloadSha256: state.preview.payloadSha256,
    })
    const existingMarker = readScriptCommitRecoveryMarker(projectId, episodeId)
    if (existingMarker.status !== 'none') {
      setRecovery(existingMarker)
      dispatch({ type: 'commit-failure', error: t('receiptRecoveryExistingMarker') })
      return
    }
    if (!writeScriptCommitRecoveryMarker(marker)) {
      dispatch({ type: 'commit-failure', error: t('receiptRecoveryStorageFailed') })
      return
    }
    setRecovery({ status: 'ready', marker })
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'commit-start' })
    try {
      const result = await port.commitScript({
        projectId: marker.projectId,
        episodeId: marker.episodeId,
        changeSetId: marker.changeSetId,
        baseRevision: marker.baseRevision,
        idempotencyKey: marker.idempotencyKey,
        expectedPayloadSha256: marker.expectedPayloadSha256,
      }, controller.signal)
      await finishAcceptedCommit(result, marker, controller, false)
    } catch (error) {
      if (!isAborted(controller.signal)) dispatch({ type: 'commit-failure', error: messageOf(error) })
    }
  }

  const recover = async (): Promise<void> => {
    if (recovery.status !== 'ready') return
    const marker = recovery.marker
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'recover-start' })
    try {
      const recovered = await port.recoverScriptCommit({
        projectId: marker.projectId,
        episodeId: marker.episodeId,
        changeSetId: marker.changeSetId,
        baseRevision: marker.baseRevision,
        idempotencyKey: marker.idempotencyKey,
        expectedPayloadSha256: marker.expectedPayloadSha256,
      }, controller.signal)
      if (isAborted(controller.signal)) return
      const result = assertRecoveryLineage(recovered, marker)
      await finishAcceptedCommit(result, marker, controller, true)
    } catch (error) {
      if (!isAborted(controller.signal)) dispatch({ type: 'recover-failure', error: messageOf(error) })
    }
  }

  const discardRecovery = (): void => {
    if (discardScriptCommitRecoveryMarker(projectId, episodeId)) {
      setRecovery({ status: 'none' })
      dispatch({ type: 'discard-recovery' })
      return
    }
    setRecovery(readScriptCommitRecoveryMarker(projectId, episodeId))
    dispatch({ type: 'recover-failure', error: t('receiptRecoveryDiscardFailed') })
  }

  if (projectId === '' || episodeId === '') {
    return <p className={css.empty}>{t('scriptChooseEpisode')}</p>
  }

  const preview = state.preview
  const busy = state.phase === 'loading'
    || state.phase === 'preparing'
    || state.phase === 'committing'
    || state.phase === 'recovering'
  return (
    <section className={css.scriptWorkspace} aria-label={t('scriptWorkspaceTitle')}>
      <div className={css.scriptWorkspaceHead}>
        <div>
          <h3>{t('scriptWorkspaceTitle')}</h3>
          <p>{t('scriptWorkspaceBoundary')}</p>
        </div>
        <button type="button" onClick={() => { void loadSnapshot() }} disabled={busy}>
          {t('reloadScript')}
        </button>
      </div>

      <dl className={css.scriptMeta}>
        <div><dt>{t('scriptRevision')}</dt><dd>{state.snapshot?.revision ?? t('unknown')}</dd></div>
        <div><dt>{t('scriptUpdated')}</dt><dd>{state.snapshot?.updatedAt || t('unknown')}</dd></div>
        <div><dt>{t('scriptState')}</dt><dd>{t(`scriptPhase_${state.phase}`)}</dd></div>
      </dl>

      <StageSourceView projectId={projectId} episodeId={episodeId} savedScript={state.snapshot}
        scriptBusy={busy || recovery.status !== 'none'} port={port} t={t} />

      {recovery.status === 'ready' && (
        <section className={css.recoveryDock} aria-label={t('receiptRecoveryTitle')}>
          <div>
            <h4>{t('receiptRecoveryTitle')}</h4>
            <p>{t('receiptRecoveryBody')}</p>
          </div>
          <dl>
            <div><dt>{t('changeSet')}</dt><dd>{recovery.marker.changeSetId}</dd></div>
            <div><dt>{t('scriptRevision')}</dt><dd>{recovery.marker.baseRevision}</dd></div>
            <div><dt>{t('payloadHash')}</dt><dd>{recovery.marker.expectedPayloadSha256}</dd></div>
          </dl>
          <div className={css.recoveryActions}>
            <button
              type="button"
              className={css.primaryAction}
              onClick={() => { void recover() }}
              disabled={busy}
            >
              {state.phase === 'recovering' ? t('recoveringReceipt') : t('recoverReceipt')}
            </button>
            <button type="button" onClick={discardRecovery} disabled={busy}>
              {t('discardRecoveryMarker')}
            </button>
          </div>
        </section>
      )}

      {recovery.status === 'invalid' && (
        <div className={css.scriptError} role="alert">
          <strong>{t('receiptRecoveryInvalidTitle')}</strong>
          <p>{t('receiptRecoveryInvalidBody')}: {recovery.error}</p>
          <button type="button" onClick={discardRecovery} disabled={busy}>
            {t('discardRecoveryMarker')}
          </button>
        </div>
      )}

      <label className={css.scriptEditor}>
        <span>{t('scriptDraftLabel')}</span>
        <textarea
          aria-label={t('scriptDraftLabel')}
          value={state.draft}
          onChange={(event) => { dispatch({ type: 'edit', draft: event.target.value }) }}
          disabled={busy || state.snapshot === undefined || recovery.status !== 'none'}
          spellCheck={false}
          rows={18}
        />
        <small>{t('scriptDraftHint')}</small>
      </label>

      <div className={css.scriptActions}>
        <button
          type="button"
          className={css.primaryAction}
          onClick={() => { void prepare() }}
          disabled={!canPrepareScript(state) || recovery.status !== 'none'}
        >
          {state.phase === 'preparing' ? t('preparingPreview') : t('preparePreview')}
        </button>
        <span>{t('prepareBoundary')}</span>
      </div>

      {state.error !== undefined && (
        <div className={css.scriptError} role="alert">
          <strong>{t('scriptErrorTitle')}</strong>
          <p>{state.error}</p>
        </div>
      )}

      {preview !== undefined && (
        <section className={css.previewDock} aria-label={t('previewTitle')}>
          <div className={css.previewHead}>
            <div>
              <h4>{t('previewTitle')}</h4>
              <p>{preview.changed ? t('previewChanged') : t('noSemanticChange')}</p>
            </div>
            <span>{preview.canCommit ? t('previewCommittable') : t('previewBlocked')}</span>
          </div>
          <dl className={css.previewMeta}>
            <div><dt>{t('changeSet')}</dt><dd>{preview.changeSetId}</dd></div>
            <div><dt>{t('previewHash')}</dt><dd>{preview.previewSha256}</dd></div>
            <div><dt>{t('scriptRevision')}</dt><dd>{preview.baseRevision} → {preview.authoritativeRevision}</dd></div>
          </dl>
          <div className={css.previewColumns}>
            <div>
              <strong>{t('changedPaths')}</strong>
              {preview.changedPaths.length === 0
                ? <p>{t('noSemanticChange')}</p>
                : <ul>{preview.changedPaths.map(path => <li key={path}>{path}</li>)}</ul>}
            </div>
            <div>
              <strong>{t('invalidatedStages')}</strong>
              {preview.invalidatedStages.length === 0
                ? <p>{t('noInvalidation')}</p>
                : <ul>{preview.invalidatedStages.map(stage => <li key={stage}>{stage}</li>)}</ul>}
            </div>
          </div>
          {(preview.revisionConflict || preview.baseSnapshotConflict) && (
            <div className={css.conflict} role="status">
              <strong>{t('conflictTitle')}</strong>
              <p>{t('conflictBody')}</p>
              <ul>
                {preview.revisionConflict && <li>{t('revisionConflict')}</li>}
                {preview.baseSnapshotConflict && <li>{t('baseConflict')}</li>}
              </ul>
            </div>
          )}
          {preview.canCommit && state.phase !== 'committed' && recovery.status === 'none' && (
            <div className={css.commitDock}>
              <label>
                <input
                  type="checkbox"
                  checked={state.confirmed}
                  onChange={(event) => { dispatch({ type: 'confirm', value: event.target.checked }) }}
                  disabled={state.phase === 'committing'}
                />
                <span>{t('commitConfirmLabel')}</span>
              </label>
              <button
                type="button"
                className={css.primaryAction}
                disabled={!canCommitScript(state)}
                onClick={() => { void commit() }}
              >
                {state.phase === 'committing' ? t('committingScript') : t('commitScript')}
              </button>
            </div>
          )}
        </section>
      )}

      {state.commit !== undefined && (
        <section className={css.commitReceipt} role="status">
          <h4>{state.commitRecovered ? t('receiptRecovered') : t('commitSucceeded')}</h4>
          <dl>
            <div><dt>{t('receiptId')}</dt><dd>{state.commit.commandReceiptId}</dd></div>
            <div><dt>{t('eventId')}</dt><dd>{state.commit.eventId}</dd></div>
            <div><dt>{t('authoritativeRevision')}</dt><dd>{state.commit.authoritativeRevision}</dd></div>
            <div><dt>{t('deduplicated')}</dt><dd>{state.commit.deduplicated ? t('yes') : t('no')}</dd></div>
          </dl>
          {state.postCommitRefreshing && <p>{t('postCommitRefreshing')}</p>}
          {state.refreshWarning !== undefined && (
            <p className={css.warning}>{t('postCommitWarning')}: {state.refreshWarning}</p>
          )}
        </section>
      )}
    </section>
  )
}
