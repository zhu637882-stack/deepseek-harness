import { useEffect, useState } from 'react'
import type {
  ImagoShotRelationMethodRequest,
  ImagoShotRelationMethodResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

interface ShotRelationMethodViewProps {
  readonly relations: YimengShotRelationsProjection
  readonly selectedShotId: string
  readonly port: QingmuYimengPort
  readonly t: (key: QingmuCockpitKey) => string
}

interface MethodHint {
  readonly id: string
  readonly title: string
  readonly guidance: string
}

interface MethodCheck {
  readonly id: string
  readonly label: string
}

interface MethodDisplay {
  readonly methodSha256: string
  readonly relationSnapshotSha256: string
  readonly reviewTitle: string
  readonly decisionBoundary: string
  readonly operation: string
  readonly hints: readonly MethodHint[]
  readonly checks: readonly MethodCheck[]
}

type MethodState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly display: MethodDisplay }
  | { readonly status: 'error'; readonly message: string }

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} 不是对象`)
  }
  return value as Record<string, unknown>
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不是非空字符串`)
  return value
}

function sha256Of(value: unknown, label: string): string {
  const text = stringOf(value, label)
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`${label} 不是 SHA-256`)
  return text
}

function arrayOf(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 不是数组`)
  return value
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function assertSame(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} 与当前易梦关系快照不一致`)
}

function uniqueIds(ids: readonly string[], label: string): readonly string[] {
  const seen = new Set<string>()
  return ids.map((id, index) => {
    if (id.trim() === '') throw new Error(`${label}[${String(index)}] 为空`)
    if (seen.has(id)) throw new Error(`${label} 含重复 ID ${id}`)
    seen.add(id)
    return id
  })
}

/** Compile the strict Yimeng read projection into the ID-only IMAGO input graph. */
export function buildShotRelationMethodRequest(
  relations: YimengShotRelationsProjection,
  selectedShotId: string,
): ImagoShotRelationMethodRequest {
  if (relations.scenes.length === 0 || relations.shots.length === 0) throw new Error('易梦镜头关系投影为空')
  if (!relations.shots.some(shot => shot.shotId === selectedShotId)) throw new Error('所选 Shot 不属于当前关系快照')

  const sceneIds = new Set(relations.scenes.map(scene => scene.sceneId))
  if (sceneIds.size !== relations.scenes.length) throw new Error('易梦关系快照含重复 Scene ID')
  const elements = new Map<string, 'actor' | 'scene' | 'prop'>()
  const shots = relations.shots.map((shot) => {
    if (!sceneIds.has(shot.sceneId)) throw new Error(`Shot ${shot.shotId} 指向未知 Scene`)
    const elementIds = uniqueIds(shot.elements.map(element => element.elementId), `Shot ${shot.shotId} Element`)
    for (const element of shot.elements) {
      const existing = elements.get(element.elementId)
      if (existing !== undefined && existing !== element.elementKind) {
        throw new Error(`Element ${element.elementId} 的类型不一致`)
      }
      elements.set(element.elementId, element.elementKind)
    }
    const shotElementIds = new Set(elementIds)
    const beats = shot.beats.map((beat) => {
      const beatElementIds = uniqueIds([...beat.actorIds, ...beat.propIds], `Shot ${shot.shotId} Beat ${beat.beatId}`)
      if (beatElementIds.some(elementId => !shotElementIds.has(elementId))) {
        throw new Error(`Shot ${shot.shotId} 的 Beat 引用了镜头外 Element`)
      }
      return { beatId: beat.beatId, elementIds: beatElementIds }
    })
    return { shotId: shot.shotId, sceneId: shot.sceneId, elementIds, beats }
  })

  const scenes = relations.scenes.map(scene => ({
    sceneId: scene.sceneId,
    elementIds: [...new Set(shots.filter(shot => shot.sceneId === scene.sceneId).flatMap(shot => shot.elementIds))],
  }))

  return {
    projectId: relations.projectId,
    episodeId: relations.episodeId,
    storyboardRevisionId: relations.storyboardRevision.revisionId,
    storyboardRevisionVersion: relations.storyboardRevision.revisionVersion,
    storyboardSourceSha256: relations.storyboardRevision.sourceSha256,
    selectedShotId,
    scenes,
    shots,
    elements: [...elements].map(([elementId, elementKind]) => ({ elementId, elementKind })),
  }
}

function normalizeMethodDisplay(
  response: ImagoShotRelationMethodResponse,
  request: ImagoShotRelationMethodRequest,
): MethodDisplay {
  const root = recordOf(response, '方法响应')
  if (root.schema !== 'qingmu.imago-shot-relation-method-adapter-result.v1') throw new Error('方法响应 schema 不匹配')
  const projectionSha256 = sha256Of(root.projectionSha256, 'projectionSha256')
  const projection = recordOf(root.projection, 'projection')
  if (projection.schema !== 'qingmu.imago-shot-relation-method-projection.v1') throw new Error('方法投影 schema 不匹配')
  const target = recordOf(projection.target, 'projection.target')
  const expectedTarget = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    storyboardRevisionId: request.storyboardRevisionId,
    storyboardRevisionVersion: request.storyboardRevisionVersion,
    storyboardSourceSha256: request.storyboardSourceSha256,
    selectedShotId: request.selectedShotId,
  }
  for (const [key, expected] of Object.entries(expectedTarget)) {
    if (target[key] !== expected) throw new Error(`方法目标 ${key} 与当前选择不一致`)
  }
  const relationSnapshotSha256 = sha256Of(target.relationSnapshotSha256, 'relationSnapshotSha256')

  const relationship = recordOf(projection.relationship_projection, 'relationship_projection')
  if (relationship.canonicalShotIdSource !== 'yimeng_storyboard_frame_id' || relationship.beatIdScope !== 'shot_local') {
    throw new Error('方法投影改变了 Shot 或 Beat 身份边界')
  }
  assertSame(relationship.scenes, request.scenes, 'Scene 关系')
  assertSame(relationship.shots, request.shots, 'Shot 关系')
  assertSame(relationship.elements, request.elements, 'Element 关系')
  const selectedShot = request.shots.find(shot => shot.shotId === request.selectedShotId)
  assertSame(relationship.selectedShot, selectedShot, '所选 Shot')

  if (
    projection.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || projection.project_state_persisted !== false
    || projection.providerCalls !== 0
    || projection.workerStarted !== false
    || projection.selection_executed !== false
    || projection.human_approval_inferred !== false
    || projection.human_signoff_inferred !== false
  ) throw new Error('方法响应越过了只读、零执行边界')

  const attestation = recordOf(root.methodAttestation, 'methodAttestation')
  if (
    attestation.schema !== 'qingmu.imago-shot-relation-method-attestation.v1'
    || attestation.algorithm !== 'hmac-sha256'
    || attestation.projectionSha256 !== projectionSha256
    || attestation.inputSnapshotSha256 !== projection.input_snapshot_sha256
    || attestation.relationSnapshotSha256 !== relationSnapshotSha256
  ) throw new Error('方法证明与投影血缘不一致')
  sha256Of(attestation.targetSha256, 'targetSha256')
  sha256Of(attestation.selectedShotSha256, 'selectedShotSha256')
  sha256Of(attestation.signature, 'signature')

  const method = recordOf(projection.method_definition, 'method_definition')
  const review = recordOf(projection.review_card, 'review_card')
  const workOrder = recordOf(projection.work_order_projection, 'work_order_projection')
  if (workOrder.operation !== 'inspectCanonicalShotRelations') throw new Error('工作单操作不匹配')
  if (arrayOf(workOrder.allowed_mutations, 'allowed_mutations').length !== 0
    || workOrder.providerCalls !== 0 || workOrder.workerStarted !== false) {
    throw new Error('工作单包含写入或执行权限')
  }

  const hints = arrayOf(projection.field_hints, 'field_hints').map((value, index) => {
    const hint = recordOf(value, `field_hints[${String(index)}]`)
    return {
      id: stringOf(hint.hint_id, `field_hints[${String(index)}].hint_id`),
      title: stringOf(hint.title, `field_hints[${String(index)}].title`),
      guidance: stringOf(hint.guidance, `field_hints[${String(index)}].guidance`),
    }
  })
  const checks = arrayOf(projection.checklist, 'checklist').map((value, index) => {
    const check = recordOf(value, `checklist[${String(index)}]`)
    if (check.required !== true) throw new Error('方法检查清单包含非必需项')
    return {
      id: stringOf(check.check_id, `checklist[${String(index)}].check_id`),
      label: stringOf(check.label, `checklist[${String(index)}].label`),
    }
  })
  if (hints.length === 0 || checks.length === 0) throw new Error('方法响应缺少字段帮助或检查清单')

  return {
    methodSha256: sha256Of(method.sha256, 'method_definition.sha256'),
    relationSnapshotSha256,
    reviewTitle: stringOf(review.title, 'review_card.title'),
    decisionBoundary: stringOf(review.decision_boundary, 'review_card.decision_boundary'),
    operation: stringOf(workOrder.operation, 'work_order_projection.operation'),
    hints,
    checks,
  }
}

/** Visible proof that the current relationship view uses IMAGO's read-only current method. */
export function ShotRelationMethodView({ relations, selectedShotId, port, t }: ShotRelationMethodViewProps) {
  const [state, setState] = useState<MethodState>({ status: 'idle' })

  useEffect(() => {
    if (selectedShotId === '') {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    let request: ImagoShotRelationMethodRequest
    try {
      request = buildShotRelationMethodRequest(relations, selectedShotId)
    } catch (cause) {
      setState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      return
    }
    setState({ status: 'loading' })
    void port.shotRelationMethod(request, controller.signal).then((response) => {
      if (controller.signal.aborted) return
      setState({ status: 'ready', display: normalizeMethodDisplay(response, request) })
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { controller.abort() }
  }, [port, relations, selectedShotId])

  return (
    <section className={css.relationMethod} aria-label={t('shotRelationMethodTitle')}>
      <div className={css.relationMethodHead}>
        <div><h4>{t('shotRelationMethodTitle')}</h4><p>{t('shotRelationMethodBoundary')}</p></div>
        <span>{t('shotRelationMethodReadOnly')}</span>
      </div>
      {state.status === 'idle' && <p className={css.empty}>{t('shotRelationChoose')}</p>}
      {state.status === 'loading' && <p role="status">{t('shotRelationMethodLoading')}</p>}
      {state.status === 'error' && <p className={css.warning} role="alert">{t('shotRelationMethodError')}: {state.message}</p>}
      {state.status === 'ready' && (
        <div className={css.relationMethodBody}>
          <dl className={css.relationAuthority}>
            <div><dt>{t('shotRelationMethodReview')}</dt><dd>{state.display.reviewTitle}</dd></div>
            <div><dt>{t('shotRelationMethodHash')}</dt><dd>{state.display.methodSha256}</dd></div>
            <div><dt>{t('shotRelationMethodRelationHash')}</dt><dd>{state.display.relationSnapshotSha256}</dd></div>
            <div><dt>{t('shotRelationMethodWorkOrder')}</dt><dd>{state.display.operation}</dd></div>
          </dl>
          <p className={css.boundary}>{state.display.decisionBoundary}</p>
          <div className={css.relationMethodColumns}>
            <article>
              <h5>{t('shotRelationMethodFieldHelp')}</h5>
              <ul>{state.display.hints.map(hint => (
                <li key={hint.id}><strong>{hint.title}</strong><span>{hint.guidance}</span></li>
              ))}</ul>
            </article>
            <article>
              <h5>{t('shotRelationMethodChecklist')}</h5>
              <ul>{state.display.checks.map(check => <li key={check.id}><span>✓</span><strong>{check.label}</strong></li>)}</ul>
            </article>
          </div>
        </div>
      )}
    </section>
  )
}
