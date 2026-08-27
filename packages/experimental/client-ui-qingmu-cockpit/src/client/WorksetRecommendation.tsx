import { useEffect, useState } from 'react'
import type { ImagoWorksetAction, ImagoWorksetItem } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type {
  ImagoWorksetProjection, QingmuImagoMethodPort, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './WorksetRecommendation.module.css'

interface WorksetRecommendationProps {
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuImagoMethodPort, 'worksetMethod'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface RequestIdentity {
  readonly source: YimengWorkflowProjection
  readonly projectId: string
  readonly episodeId: string
  readonly refresh: number
}

type WorksetState = RequestIdentity & (
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: ImagoWorksetProjection }
  | { readonly status: 'error'; readonly message: string }
)

const ACTION_LABELS: Record<ImagoWorksetAction, QingmuCockpitKey> = {
  review_artifact: 'worksetReviewAction',
  compile_preflight: 'worksetPreflightAction',
  prepare_work_order: 'worksetPrepareAction',
}

const PRIORITY_LABELS = {
  human_pending: 'worksetHumanPriority',
  unlocked_critical_path: 'worksetCriticalPriority',
  low_cost_preflight: 'worksetPreflightPriority',
  other_legal_work: 'worksetOtherPriority',
} as const

function sameItem(left: ImagoWorksetItem, right: { readonly stage_id: string; readonly scope_instance: string }): boolean {
  return left.stage_id === right.stage_id && left.scope_instance === right.scope_instance
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read-only advice with request-local identity: a refreshed projection never reuses old recommendations. */
export function WorksetRecommendation({ projectId, episodeId, projection, enabled, port, t }: WorksetRecommendationProps) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<WorksetState>()

  useEffect(() => {
    if (!enabled || projection === undefined || projectId === '' || episodeId === '') return
    const controller = new AbortController()
    let live = true
    const identity: RequestIdentity = { source: projection, projectId, episodeId, refresh }
    setState({ ...identity, status: 'loading' })
    const load = async () => {
      try {
        const response: unknown = await port.worksetMethod({ projectId, episodeId }, controller.signal)
        if (!live) return
        if (!isRecord(response) || response.schema !== 'qingmu.imago-workset-method-adapter-result.v1'
          || !isRecord(response.projection)) throw new Error(t('worksetInvalid'))
        const raw = response.projection
        if (raw.schema !== 'qingmu.imago-workset.v2' || !isRecord(raw.subject)
          || raw.subject.project_id !== projectId || raw.subject.episode_id !== episodeId
          || raw.project_state_persisted !== false || raw.human_approval_inferred !== false
          || raw.formal_activation_allowed !== false || raw.paid_provider_authority !== 'not_granted'
          || !isRecord(raw.shadow_comparison) || raw.shadow_comparison.activation_allowed !== false
          || raw.shadow_comparison.execution_equivalence_claimed !== false
          || !isRecord(raw.availability) || !Array.isArray(raw.stage_definitions)
          || !Array.isArray(raw.work_items) || !Array.isArray(raw.legal_work_items)) {
          throw new Error(t('worksetInvalid'))
        }
        // The Host validates the full compiler DTO; re-check the browser scope and non-executing boundary here.
        const result = raw as ImagoWorksetProjection
        const recommended = result.recommended_item
        if (result.legal_work_items.some(item => item.allowed_action === null
            || item.status === 'blocked' || item.status === 'complete')
          || (result.availability.status === 'unavailable'
            && (result.work_items.length > 0 || result.legal_work_items.length > 0 || result.recommended_item !== null))
          || (recommended !== null
            && !result.legal_work_items.some(item => sameItem(item, recommended)
              && item.allowed_action === recommended.allowed_action))) {
          throw new Error(t('worksetInvalid'))
        }
        setState({ ...identity, status: 'ready', result })
      } catch (cause) {
        if (live) setState({ ...identity, status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    void load()
    return () => { live = false; controller.abort() }
  }, [enabled, episodeId, port, projectId, projection, refresh, t])

  // Object identity intentionally complements source fingerprints: readiness can change without a new fingerprint.
  const current = enabled && state !== undefined && state.source === projection && state.projectId === projectId
    && state.episodeId === episodeId && state.refresh === refresh ? state : undefined
  const result = current?.status === 'ready' ? current.result : undefined
  const chosen = result?.recommended_item
  const recommendation = chosen == null ? undefined : result?.legal_work_items.find(item => sameItem(item, chosen))
  const loading = enabled && projection !== undefined && (current === undefined || current.status === 'loading')
  const titleFor = (item: { readonly stage_id: string }) =>
    result?.stage_definitions.find(definition => definition.stage_id === item.stage_id)?.stage_name ?? item.stage_id
  const scopeFor = (scope: string) => scope === 'GLOBAL' ? t('worksetGlobal') : scope

  return (
    <section className={`${card.card} ${css.workset}`} aria-label={t('recommended')}>
      <div className={css.header}>
        <div><h3>{t('recommended')}</h3><p>{t('worksetBoundary')}</p></div>
        <button type="button" disabled={!enabled || projection === undefined || loading} onClick={() => { setRefresh(value => value + 1) }}>
          {t('worksetRefresh')}
        </button>
      </div>
      {projection === undefined && <p>{t('recommendedChoose')}</p>}
      {loading && <p role="status">{t('worksetLoading')}</p>}
      {current?.status === 'error' && <p role="alert" className={card.warning}>{t('worksetError')}: {current.message}</p>}
      {result !== undefined && (
        <div className={css.body}>
          {result.availability.status === 'unavailable'
            ? <p role="status" className={css.notice}>{t('worksetUnavailable')}</p>
            : result.availability.status === 'partial' && <p className={css.notice}>{t('worksetPartial')}</p>}
          {recommendation === undefined
            ? result.availability.status !== 'unavailable' && <p>{t('worksetNoRecommendation')}</p>
            : (
              <article className={css.recommendation} aria-label={t('recommended')}>
                <span>{recommendation.priority_class === null ? '' : t(PRIORITY_LABELS[recommendation.priority_class])}</span>
                <h4>{titleFor(recommendation)}</h4>
                <p>{recommendation.allowed_action === null ? '' : t(ACTION_LABELS[recommendation.allowed_action])}</p>
                <small>{scopeFor(recommendation.scope_instance)} · {t('worksetOwner')}: {recommendation.owner_role}</small>
                <p>{t('worksetAdviceOnly')}</p>
              </article>
            )}
          <details className={css.details}>
            <summary>{t('worksetLegal')} · {result.legal_work_items.length}</summary>
            {result.legal_work_items.length === 0 ? <p>{t('worksetNoLegal')}</p> : (
              <ol className={css.items} aria-label={t('worksetLegal')}>
                {result.legal_work_items.map(item => (
                  <li key={JSON.stringify([item.stage_id, item.scope_instance])}>
                    <h4>{titleFor(item)}</h4>
                    <span>{scopeFor(item.scope_instance)} · {t('worksetOwner')}: {item.owner_role}</span>
                    <p>{item.allowed_action === null ? '' : t(ACTION_LABELS[item.allowed_action])}</p>
                    <p>{t('worksetPrerequisites')}: {[
                      ...item.prerequisites.stages.map(source => `${titleFor(source)} (${scopeFor(source.scope_instance)} · ${source.status})`),
                      ...item.prerequisites.locks.map(lock => `${lock.lock_id} (${lock.status})`),
                    ].join(' / ') || t('worksetNoPrerequisites')}</p>
                    {item.parallel_group !== null && <p>{t('worksetParallel')}: <code>{item.parallel_group}</code></p>}
                  </li>
                ))}
              </ol>
            )}
          </details>
          <details className={css.details}>
            <summary>{t('worksetDefinitions')} · {result.stage_definitions.length}</summary>
            <p>{t('worksetDefinitionsBoundary')}</p>
            <ul className={css.definitions}>
              {result.stage_definitions.map(definition => (
                <li key={definition.stage_id}>
                  <strong>{definition.stage_name}</strong>
                  <span>{definition.scope === 'global' ? t('worksetGlobal') : t('worksetPerLsu')} · {definition.owner_role}</span>
                </li>
              ))}
            </ul>
          </details>
          <details className={css.details}>
            <summary>{t('worksetEvidence')}</summary>
            <dl className={css.evidence}>
              <div><dt>{t('worksetSourceHash')}</dt><dd><code>{result.source_projection_sha256}</code></dd></div>
              <div><dt>{t('worksetRevisionHash')}</dt><dd><code>{result.subject.source_revision_sha256}</code></dd></div>
              <div><dt>{t('worksetInputHash')}</dt><dd><code>{result.input_snapshot_sha256}</code></dd></div>
              <div><dt>{t('worksetRulesHash')}</dt><dd><code>{result.rules_sha256}</code></dd></div>
            </dl>
            <h4>{t('worksetShadow')}</h4>
            <p>{t(result.shadow_comparison.status === 'unavailable' ? 'worksetShadowUnavailable'
              : result.shadow_comparison.comparisons.some(item => !item.equivalent) ? 'worksetShadowMismatch' : 'worksetShadowCompared')}</p>
            {result.blockers.length > 0 && <ul className={css.codes}>{result.blockers.map((blocker, index) => (
              <li key={`${String(index)}:${blocker.code}`}><code>{blocker.code}</code></li>
            ))}</ul>}
            <h4>{t('worksetRuleFiles')}</h4>
            <dl className={css.evidence}>{Object.entries(result.rule_bindings).map(([path, sha]) => (
              <div key={path}><dt><code>{path}</code></dt><dd><code>{sha}</code></dd></div>
            ))}</dl>
          </details>
        </div>
      )}
    </section>
  )
}
