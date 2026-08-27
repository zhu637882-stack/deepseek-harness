/** Validate the rebuildable continuity evidence without assigning review authority. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { YimengContinuityDeltaProjection, YimengShotRelationsProjection } from './types.ts'

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    throw new Error(`${field}: invalid continuity fields`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\u0000') && value.isWellFormed()
}

function identifier(value: unknown): value is string {
  return text(value) && value.length <= 256 && value.trim() === value && !/[\r\n]/.test(value)
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function nullableFields(value: Record<string, unknown>, keys: readonly string[], check: (item: unknown) => boolean): void {
  for (const key of keys) {
    if (value[key] !== null && !check(value[key])) throw new Error(`continuity ${key}: invalid optional value`)
  }
}

function booleans(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') throw new Error(`continuity ${key}: expected boolean`)
  }
}

function pair(value: unknown, from: { shotId: string; frameNo: number }, to: { shotId: string; frameNo: number }): void {
  const item = exact(value, [
    'fromShotId', 'toShotId', 'fromFrameNo', 'toFrameNo', 'required', 'enforced', 'exemption',
    'legacyStatus', 'legacyEvidenceReady', 'contractDigest', 'currentBinding', 'audit',
    'bindingStatus', 'currentEvidenceReady', 'warnings',
  ], 'pair')
  if (item.fromShotId !== from.shotId || item.toShotId !== to.shotId
    || item.fromFrameNo !== from.frameNo || item.toFrameNo !== to.frameNo || !sha(item.contractDigest)) {
    throw new Error('continuity pair: canonical adjacent Shot binding mismatch')
  }
  booleans(item, ['required', 'enforced', 'legacyEvidenceReady', 'currentEvidenceReady'])
  const legacyStatus = item.exemption !== null ? 'exempt' : item.required
    ? item.legacyEvidenceReady ? 'passed' : 'blocked' : 'advisory'
  if (item.enforced !== item.required
    || ![null, 'scene_change', 'hard_cut'].includes(item.exemption as string | null)
    || item.legacyStatus !== legacyStatus
    || (item.exemption !== null && (item.required !== false || item.legacyStatus !== 'exempt'))
    || !Array.isArray(item.warnings) || !item.warnings.every(text)) {
    throw new Error('continuity pair: invalid legacy facts')
  }
  const binding = exact(item.currentBinding, [
    'tailAssetId', 'tailSha256', 'nextFirstFrameAssetId', 'nextFirstFrameSha256',
    'selectedVideoAssetId', 'selectedVideoTaskId', 'tailSourceTaskId',
    'tailFromSelectedVideo', 'nextFirstFrameSelected', 'nextFirstFrameStale', 'staleHandoff',
  ], 'currentBinding')
  nullableFields(binding, ['tailAssetId', 'nextFirstFrameAssetId', 'selectedVideoAssetId', 'selectedVideoTaskId', 'tailSourceTaskId'], identifier)
  nullableFields(binding, ['tailSha256', 'nextFirstFrameSha256'], sha)
  booleans(binding, ['tailFromSelectedVideo', 'nextFirstFrameSelected', 'nextFirstFrameStale', 'staleHandoff'])
  if ((binding.tailAssetId === null && binding.tailSha256 !== null)
    || (binding.nextFirstFrameAssetId === null && binding.nextFirstFrameSha256 !== null)
    || (binding.tailFromSelectedVideo === true && (binding.selectedVideoAssetId === null
      || binding.tailAssetId === null || binding.selectedVideoTaskId === null
      || binding.selectedVideoTaskId !== binding.tailSourceTaskId))
    || (binding.nextFirstFrameSelected === true && binding.nextFirstFrameAssetId === null)) {
    throw new Error('continuity pair: contradictory selected-asset lineage')
  }
  const audit = exact(item.audit, [
    'checkId', 'passed', 'createdAt', 'tailAssetId', 'tailSha256', 'nextFirstFrameAssetId',
    'nextFirstFrameSha256', 'providerTaskId', 'evidenceRef', 'dimensions',
  ], 'audit')
  nullableFields(audit, ['checkId', 'tailAssetId', 'nextFirstFrameAssetId', 'providerTaskId'], identifier)
  nullableFields(audit, ['tailSha256', 'nextFirstFrameSha256'], sha)
  nullableFields(audit, ['createdAt', 'evidenceRef'], text)
  if (audit.passed !== null && typeof audit.passed !== 'boolean') throw new Error('continuity audit: invalid passed fact')
  if (!Array.isArray(audit.dimensions) || audit.dimensions.length !== 4) throw new Error('continuity audit: missing dimension set')
  for (const [index, dimension] of ['character', 'scene', 'prop', 'action'].entries()) {
    const result = exact(audit.dimensions[index], ['dimension', 'result', 'reason'], 'dimension')
    if (result.dimension !== dimension || (result.result !== null && typeof result.result !== 'boolean')
      || (result.reason !== null && !text(result.reason))) throw new Error('continuity audit: invalid dimension')
  }
  const fields = ['tailAssetId', 'tailSha256', 'nextFirstFrameAssetId', 'nextFirstFrameSha256'] as const
  const complete = fields.every(key => binding[key] !== null && audit[key] !== null)
  const bindingStatus = !complete ? 'unavailable' : fields.every(key => binding[key] === audit[key]) ? 'current' : 'different'
  const ready = item.legacyEvidenceReady === true && bindingStatus === 'current'
    && binding.tailFromSelectedVideo === true && binding.nextFirstFrameSelected === true
    && binding.nextFirstFrameStale === false && binding.staleHandoff === false
  if (item.bindingStatus !== bindingStatus || item.currentEvidenceReady !== ready
    || (item.legacyEvidenceReady === true && (audit.checkId === null || audit.createdAt === null
      || fields.some(key => audit[key] === null) || audit.passed !== true
      || audit.dimensions.some(dimension => (dimension as Record<string, unknown>).result !== true)))) {
    throw new Error('continuity pair: historical evidence cannot grant current verification')
  }
}

/**
 * Validate all adjacent pairs and their exact digest against the current Shot index.
 * @param value - the optional new field returned by Yimeng.
 * @param relations - independently normalized current canonical Shot authority.
 * @param serialize - the Host's deterministic safe-number JSON serializer.
 * @returns unchanged validated data, retaining historical facts without granting approval.
 */
export function normalizeContinuityDelta(
  value: unknown,
  relations: YimengShotRelationsProjection,
  serialize: (value: unknown, field: string) => string,
): YimengContinuityDeltaProjection {
  const root = exact(value, [
    'schema', 'projectId', 'episodeId', 'storyboardRevision', 'availability', 'reason', 'pairs',
    'snapshotSha256', 'readOnly', 'providerCalls', 'taskMutation', 'budgetMutation', 'humanSignoffInferred',
  ], 'continuityDelta')
  if (root.schema !== 'jason.qingmu-continuity-delta.v1'
    || root.projectId !== relations.projectId || root.episodeId !== relations.episodeId
    || !isDeepStrictEqual(root.storyboardRevision, relations.storyboardRevision)
    || !Array.isArray(root.pairs) || !sha(root.snapshotSha256)
    || root.readOnly !== true || root.providerCalls !== 0 || root.taskMutation !== false
    || root.budgetMutation !== false || root.humanSignoffInferred !== false) {
    throw new Error('continuityDelta: source or read-only boundary mismatch')
  }
  if (root.availability === 'unavailable') {
    if (!text(root.reason) || root.pairs.length !== 0) throw new Error('continuityDelta: unavailable source contains pairs')
  } else if (root.availability === 'available') {
    const shots = [...relations.shots].sort((left, right) => left.frameNo - right.frameNo)
    if (root.reason !== null || root.pairs.length !== Math.max(0, shots.length - 1)) {
      throw new Error('continuityDelta: incomplete adjacent pair set')
    }
    root.pairs.forEach((item, index) => {
      const from = shots[index]
      const to = shots[index + 1]
      if (from === undefined || to === undefined) throw new Error('continuityDelta: missing adjacent Shot')
      pair(item, from, to)
    })
  } else {
    throw new Error('continuityDelta: invalid availability')
  }
  const { snapshotSha256, ...body } = root
  const computed = createHash('sha256').update(serialize(body, 'continuityDelta'), 'utf8').digest('hex')
  if (computed !== snapshotSha256) throw new Error('continuityDelta: snapshot SHA mismatch')
  return root as unknown as YimengContinuityDeltaProjection
}
