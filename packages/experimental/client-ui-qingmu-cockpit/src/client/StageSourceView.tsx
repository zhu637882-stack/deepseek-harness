/** Explicit saved-script source registration inside the existing script workspace. */
import { useEffect, useId, useRef, useState } from 'react'
import type { ImagoStageSourceMethodResponse, QingmuYimengPort, YimengScriptResponse, YimengStageSourcesResponse } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearStageSourceMarker, createStageSourceMarker, readStageSourceMarker, stageSourceRecoveryRequest,
  verifyStageSourceFeed, verifyStageSourceMethod, verifyStageSourceReceipt, verifyStageSourceRecovery, writeStageSourceMarker,
  type StageSourceRecoveryRead,
} from './stage-source-contract.ts'
import card from './QingmuCockpit.module.css'
import css from './ShotFindingView.module.css'

interface StageSourceViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly savedScript: YimengScriptResponse | undefined
  readonly scriptBusy: boolean
  readonly port: Pick<QingmuYimengPort, 'stageSources' | 'stageSourceMethod' | 'bindStageSource' | 'recoverStageSourceBinding'>
  readonly t: (key: QingmuCockpitKey) => string
}
interface View {
  readonly projectId: string
  readonly episodeId: string
  readonly source: YimengScriptResponse | undefined
  readonly port: StageSourceViewProps['port']
  readonly refresh: number
}
interface Run extends View { readonly controller: AbortController; live: boolean }
type ReadState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'error' }
  | { readonly status: 'ready'; readonly feed: YimengStageSourcesResponse }
)
type MethodState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'unavailable' }
  | { readonly status: 'ready'; readonly value: ImagoStageSourceMethodResponse }
)
interface Operation { readonly run: Run; readonly kind: 'bind' | 'recover' }
interface Notice {
  readonly source: YimengScriptResponse | undefined
  readonly port: StageSourceViewProps['port']
  readonly key: QingmuCockpitKey
  readonly error: boolean
}
function sameView(left: View, right: View) {
  return left.projectId === right.projectId && left.episodeId === right.episodeId
    && left.source === right.source && left.port === right.port && left.refresh === right.refresh
}

/**
 * Attach current IMAGO method provenance to an already saved business script, not to an editor draft.
 * @param props - Existing episode selection, saved snapshot and three private Host channels.
 * @returns A source-only panel with explicit confirmation and GET-only receipt recovery.
 */
export function StageSourceView(props: StageSourceViewProps) {
  return <StageSourcePanel key={JSON.stringify([props.projectId, props.episodeId])} {...props} />
}

function StageSourcePanel({ projectId, episodeId, savedScript, scriptBusy, port, t }: StageSourceViewProps) {
  const scope = { projectId, episodeId }
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ReadState>()
  const [methodState, setMethodState] = useState<MethodState>()
  const [confirmed, setConfirmed] = useState<Run>()
  const [marker, setMarker] = useState<StageSourceRecoveryRead>(() => readStageSourceMarker(scope))
  const [busy, setBusy] = useState<Operation>()
  const [notice, setNotice] = useState<Notice>()
  const runRef = useRef<Run | undefined>(undefined)
  const busyRef = useRef<Operation | undefined>(undefined)
  const view = { projectId, episodeId, source: savedScript, port, refresh }
  const visibleRef = useRef({ ...view, scriptBusy })
  visibleRef.current = { ...view, scriptBusy }
  const titleId = useId()
  const boundaryId = useId()
  const enabled = projectId !== '' && episodeId !== ''
  const live = (run: Run) => run.live && runRef.current === run && !run.controller.signal.aborted && sameView(run, visibleRef.current)

  useEffect(() => {
    setMarker(readStageSourceMarker({ projectId, episodeId }))
    setConfirmed(undefined)
    setMethodState(undefined)
    if (!enabled) { setState(undefined); return }
    const run: Run = { projectId, episodeId, source: savedScript, port, refresh, controller: new AbortController(), live: true }
    runRef.current = run
    busyRef.current = undefined
    setBusy(undefined)
    setState({ run, status: 'loading' })
    setNotice(previous => previous?.source === savedScript && previous?.port === port ? previous : undefined)
    const current = () => run.live && runRef.current === run && !run.controller.signal.aborted && sameView(run, visibleRef.current)
    void (async () => {
      let feed: YimengStageSourcesResponse
      try {
        feed = await port.stageSources({ projectId, episodeId }, run.controller.signal)
        if (!current()) return
        await verifyStageSourceFeed(feed, { projectId, episodeId })
        if (!current()) return
        setState({ run, status: 'ready', feed })
      } catch {
        if (current()) setState({ run, status: 'error' })
        return
      }
      if (feed.source === null) return
      setMethodState({ run, status: 'loading' })
      try {
        const value = await port.stageSourceMethod({ projectId, episodeId, stageId: 'A1S' }, run.controller.signal)
        if (!current()) return
        await verifyStageSourceMethod(value, feed)
        if (current()) setMethodState({ run, status: 'ready', value })
      } catch {
        if (current()) setMethodState({ run, status: 'unavailable' })
      }
    })()
    return () => {
      run.live = false
      run.controller.abort()
      if (runRef.current === run) runRef.current = undefined
      if (busyRef.current?.run === run) busyRef.current = undefined
    }
  }, [enabled, projectId, episodeId, savedScript, port, refresh])

  useEffect(() => { if (scriptBusy) setConfirmed(undefined) }, [scriptBusy])
  const current = state !== undefined && live(state.run) ? state : undefined
  const feed = current?.status === 'ready' ? current.feed : undefined
  const currentMethod = methodState !== undefined && live(methodState.run) ? methodState : undefined
  const method = currentMethod?.status === 'ready' ? currentMethod.value : undefined
  const activeBusy = busy !== undefined && live(busy.run) ? busy : undefined
  const visibleNotice = notice?.source === savedScript && notice?.port === port ? notice : undefined
  const source = feed?.source
  const editorMatches = source !== undefined && source !== null && savedScript?.found === true
    && savedScript.projectId === projectId && savedScript.episodeId === episodeId
    && savedScript.revision === source.revision && savedScript.scriptSha256 === source.contentSha256
  const latest = feed?.latestBinding
  const rulesMatch = method !== undefined && latest !== undefined && latest !== null
    ? latest.binding.rulesSha256 === method.projection.rulesSha256 : undefined
  const needsBinding = feed !== undefined && (feed.currentBinding === null || rulesMatch === false)
  const formAvailable = feed?.canBind === true && editorMatches && method !== undefined && needsBinding
    && feed.bindingRevision < Number.MAX_SAFE_INTEGER
  const canBind = formAvailable && current !== undefined && confirmed === current.run && !scriptBusy
    && marker.status === 'none' && activeBusy === undefined

  function announce(run: Run, key: QingmuCockpitKey, error = false) {
    if (live(run)) setNotice({ source: run.source, port: run.port, key, error })
  }
  function begin(kind: Operation['kind']): Operation | undefined {
    const run = runRef.current
    if (!enabled || run === undefined || !live(run) || busyRef.current !== undefined) return undefined
    const operation = { run, kind }
    busyRef.current = operation
    setBusy(operation)
    setNotice(undefined)
    return operation
  }
  function finish(operation: Operation) {
    if (busyRef.current === operation) {
      busyRef.current = undefined
      if (live(operation.run)) setBusy(undefined)
    }
  }
  function accepted(operation: Operation, original: StageSourceRecoveryRead) {
    if (!live(operation.run)) return
    const cleared = clearStageSourceMarker(scope, original)
    setMarker(readStageSourceMarker(scope))
    setConfirmed(undefined)
    announce(operation.run, cleared ? operation.kind === 'recover' ? 'stageSourceRecovered' : 'stageSourceStored' : 'stageSourceClearFailed', !cleared)
    // A receipt is historical proof. Only the subsequent GET may render a current binding.
    setRefresh(value => value + 1)
  }
  async function bind() {
    if (!canBind) return
    const operation = begin('bind')
    if (operation === undefined) return
    try {
      const intent = await createStageSourceMarker({ projectId, episodeId, stageId: 'A1S',
        expectedSubjectSha256: method.projection.subjectSnapshotSha256, expectedBindingRevision: feed.bindingRevision,
        expectedBindingSha256: feed.bindingSha256, methodProjectionSha256: method.projectionSha256,
        rulesSha256: method.projection.rulesSha256 })
      if (!live(operation.run) || visibleRef.current.scriptBusy) return
      const previous = readStageSourceMarker(scope)
      if (previous.status !== 'none') {
        setMarker(previous)
        announce(operation.run, 'stageSourceExistingMarker', true)
        return
      }
      if (!writeStageSourceMarker(intent)) {
        setMarker(readStageSourceMarker(scope))
        announce(operation.run, 'stageSourceStorageFailed', true)
        return
      }
      setMarker({ status: 'ready', marker: intent })
      const result = await port.bindStageSource({ projectId, episodeId, stageId: 'A1S',
        expectedSubjectSha256: intent.expectedSubjectSha256, expectedBindingRevision: intent.expectedBindingRevision,
        expectedBindingSha256: intent.expectedBindingSha256, idempotencyKey: intent.idempotencyKey,
        methodProjection: method.projection, methodProjectionSha256: method.projectionSha256, methodAttestation: method.methodAttestation,
      }, operation.run.controller.signal)
      if (!live(operation.run)) return
      await verifyStageSourceReceipt(result, intent)
      accepted(operation, { status: 'ready', marker: intent })
    } catch { announce(operation.run, 'stageSourceOperationFailed', true) }
    finally { finish(operation) }
  }
  async function recover() {
    if (marker.status !== 'ready') return
    const operation = begin('recover')
    if (operation === undefined) return
    try {
      const request = await stageSourceRecoveryRequest(marker.marker)
      if (!live(operation.run)) return
      const result = await port.recoverStageSourceBinding(request, operation.run.controller.signal)
      if (!live(operation.run)) return
      await verifyStageSourceRecovery(result, marker.marker)
      accepted(operation, marker)
    } catch { announce(operation.run, 'stageSourceRecoveryFailed', true) }
    finally { finish(operation) }
  }
  function discard() {
    const run = runRef.current
    if (run === undefined || !live(run) || busyRef.current !== undefined) return
    const cleared = clearStageSourceMarker(scope, marker)
    setMarker(readStageSourceMarker(scope))
    setConfirmed(undefined)
    announce(run, cleared ? 'stageSourceDiscarded' : 'stageSourceClearFailed', !cleared)
    if (cleared) setRefresh(value => value + 1)
  }
  if (!enabled) return null
  return <section className={`${css.panel} ${css.source}`} aria-labelledby={titleId}>
    <div className={css.header}>
      <div><h4 id={titleId}>{t('stageSourceTitle')}</h4><p id={boundaryId} className={css.hint}>{t('stageSourceBoundary')}</p></div>
      <button type="button" disabled={activeBusy !== undefined} onClick={() => { setRefresh(value => value + 1) }}>{t('stageSourceRefresh')}</button>
    </div>
    {marker.status !== 'none' && <aside className={css.recovery} aria-label={t('stageSourceRecoveryTitle')}>
      <h5>{t('stageSourceRecoveryTitle')}</h5>
      <p role={marker.status === 'invalid' ? 'alert' : undefined}>{t(marker.status === 'invalid' ? 'stageSourceInvalidMarker' : 'stageSourceRecoveryHelp')}</p>
      {marker.status === 'ready' && <>
        <dl className={css.evidence}><div><dt>{t('stageSourceSnapshotSha')}</dt><dd>{marker.marker.expectedSubjectSha256}</dd></div></dl>
        <button type="button" disabled={activeBusy !== undefined} onClick={() => { void recover() }}>
          {t(activeBusy?.kind === 'recover' ? 'stageSourceRecovering' : 'stageSourceRecover')}
        </button>
      </>}
      <details><summary>{t('stageSourceDiscardTitle')}</summary><p>{t('stageSourceDiscardHelp')}</p>
        <button type="button" disabled={activeBusy !== undefined} onClick={discard}>{t('stageSourceDiscard')}</button>
      </details>
    </aside>}
    {visibleNotice !== undefined && <p role={visibleNotice.error ? 'alert' : 'status'}>{t(visibleNotice.key)}</p>}
    {current === undefined || current.status === 'loading' ? <p role="status">{t('stageSourceLoading')}</p>
      : current.status === 'error' ? <p role="alert">{t('stageSourceReadFailed')}</p> : <div className={css.body}>
        {source === null ? <p>{t('stageSourceUnavailable')}</p> : source !== undefined && <dl className={css.evidence}>
          <div><dt>{t('scriptRevision')}</dt><dd>{source.revision}</dd></div>
          <div><dt>{t('stageSourceContentSha')}</dt><dd>{source.contentSha256}</dd></div>
        </dl>}
        {latest === null ? <p>{t('stageSourceNoBinding')}</p> : latest !== undefined && <div>
          <p>{t(feed?.currentBinding !== null ? 'stageSourceCurrent' : 'stageSourceHistorical')}</p>
          <p className={css.hint}>{t(rulesMatch === undefined ? 'stageSourceRulesUnknown' : rulesMatch ? 'stageSourceRulesCurrent' : 'stageSourceRulesChanged')}</p>
          <details><summary>{t('stageSourceEvidence')}</summary><dl className={css.evidence}>
            <div><dt>{t('stageSourceBindingRevision')}</dt><dd>{latest.binding.bindingRevision}</dd></div>
            <div><dt>{t('scriptRevision')}</dt><dd>{latest.binding.source.revision}</dd></div>
            <div><dt>{t('stageSourceContentSha')}</dt><dd>{latest.binding.source.contentSha256}</dd></div>
            <div><dt>{t('stageSourceRulesSha')}</dt><dd>{latest.binding.rulesSha256}</dd></div>
            <div><dt>{t('stageSourceMethodVersion')}</dt><dd>{latest.binding.definition.version}</dd></div>
            <div><dt>{t('changeSet')}</dt><dd>{latest.binding.changeSetId}</dd></div>
          </dl></details>
        </div>}
        {source !== null && source !== undefined && <>
          {!editorMatches && <p>{t('stageSourceEditorMismatch')}</p>}
          {feed?.canBind === false && <p>{t('stageSourceReadOnly')}</p>}
          {currentMethod?.status === 'loading' && <p role="status">{t('stageSourceMethodLoading')}</p>}
          {currentMethod?.status === 'unavailable' && <p>{t('stageSourceMethodUnavailable')}</p>}
        </>}
        {formAvailable && <div>
          <label className={css.actions}>
            <input type="checkbox" style={{ width: 'auto' }} checked={confirmed === current.run && !scriptBusy}
              disabled={activeBusy !== undefined || scriptBusy || marker.status !== 'none'} aria-describedby={boundaryId}
              onChange={(event) => { setConfirmed(event.target.checked ? current.run : undefined) }} />
            <span>{t('stageSourceConfirm')}</span>
          </label>
          <div className={css.actions}><button type="button" className={card.primaryAction} disabled={!canBind} onClick={() => { void bind() }}>
            {t(activeBusy?.kind === 'bind' ? 'stageSourceBinding' : 'stageSourceBind')}
          </button></div>
        </div>}
      </div>}
  </section>
}
