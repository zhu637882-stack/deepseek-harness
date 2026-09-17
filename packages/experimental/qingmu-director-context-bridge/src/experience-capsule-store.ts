/**
 * Read side of the director experience channel: approved capsules the director
 * reads back into its own persona so a lesson it recorded reaches later sessions.
 *
 * {@link experience-capsule-tools.ts} owns the write side (the director queues a
 * lesson for human review). A human promotes approved queue entries into the
 * active store with {@link mergeApprovedCapsules}; nothing here writes files.
 * The active store lives next to the runtime identity so the harness Node
 * process reads it without knowing any repository path.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** One approved capsule in the active store the director reads each assembly. */
export interface ActiveCapsule {
  /** Stable capsule id, unique within the store. */
  id: string
  /** The pitfall the director hit, one sentence. */
  symptom: string
  /** The concrete behavior to apply next time, one sentence. */
  rule: string
  /** Optional workflow phases the reviewer tagged; absent means every phase. */
  stages?: string[]
}

/** One human-review queue entry (the write side's on-disk record). */
export interface QueuedCapsule {
  id: string
  symptom: string
  rule: string
  submittedAt?: string
  sessionId?: string
}

/** Result of promoting approved queue entries into the active store. */
export interface MergeResult {
  /** The next active store, approved entries newest-first. */
  active: ActiveCapsule[]
  /** The queue with promoted entries removed. */
  remainingQueue: QueuedCapsule[]
  /** Ids that were promoted this merge. */
  merged: string[]
}

/**
 * Newest-first cap on the injected block. Bounds the persona tail so the model
 * input stays small and the cache prefix moves only when the store changes.
 * Approved capsules past this count stay stored but are not injected.
 */
export const ACTIVE_CAPSULE_RENDER_LIMIT = 12

/**
 * Resolve the runtime root both capsule files live in.
 * @returns `QINGMU_RUNTIME_ROOT`, else `QINGMU_NATIVE_ROOT`, else `''`. An empty
 * root unmounts the director's submission tool and makes the review routes answer
 * that the channel is unconfigured, rather than reading or writing a path built
 * from `''`.
 */
export function resolveCapsuleRuntimeRoot(): string {
  return process.env.QINGMU_RUNTIME_ROOT ?? process.env.QINGMU_NATIVE_ROOT ?? ''
}

/**
 * Resolve the approved-capsule store next to the runtime identity and its queue.
 * @param runtimeRoot - the harness runtime root both capsule files live in.
 * @returns the store path the persona reads and a promotion rewrites.
 */
export function capsuleActiveStorePathFor(runtimeRoot: string): string {
  return join(runtimeRoot, 'experience-capsules-active.json')
}

/**
 * Resolve the director's review queue next to the runtime identity.
 * @param runtimeRoot - the harness runtime root both capsule files live in.
 * @returns the queue path the submission tool appends to and a promotion trims.
 */
export function capsuleQueuePathFor(runtimeRoot: string): string {
  return join(runtimeRoot, 'experience-capsule-queue.json')
}

/** Accept only well-formed capsules so a hand-edited store cannot inject garbage. */
function isActiveCapsule(value: unknown): value is ActiveCapsule {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const capsule = value as Record<string, unknown>
  return typeof capsule.id === 'string' && capsule.id.trim().length > 0
    && typeof capsule.symptom === 'string'
    && typeof capsule.rule === 'string' && capsule.rule.trim().length > 0
    && (capsule.stages === undefined
      || (Array.isArray(capsule.stages) && capsule.stages.every(entry => typeof entry === 'string')))
}

/**
 * Validate one parsed active-store document.
 * @param raw - the parsed store file content.
 * @returns the valid capsules in stored (newest-first) order; a document that is
 * not `{capsules: [...]}` contributes none.
 */
export function parseActiveCapsules(raw: unknown): ActiveCapsule[] {
  const capsules = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).capsules
    : undefined
  if (!Array.isArray(capsules)) return []
  return capsules.filter(isActiveCapsule).map(capsule => ({
    id: capsule.id,
    symptom: capsule.symptom,
    rule: capsule.rule,
    ...(capsule.stages ? { stages: capsule.stages } : {}),
  }))
}

/**
 * Read the approved capsules in stored (newest-first) order.
 * @param storePath - the active-store path from {@link capsuleActiveStorePathFor}.
 * @returns the valid capsules; a missing or malformed store contributes none, so
 * the persona still renders when the operator has approved nothing yet.
 */
export function loadActiveCapsules(storePath: string): ActiveCapsule[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(storePath, 'utf8'))
  } catch {
    // A missing store before the first merge is the normal empty case.
    return []
  }
  return parseActiveCapsules(raw)
}

/**
 * Render the approved capsules as one persona block.
 * @param capsules - approved capsules, newest-first.
 * @param limit - maximum lines rendered; the rest are dropped as too old.
 * @returns the block prefixed with a line break, so it always starts its own persona
 * line; `''` when there are no capsules, so the inline persona placeholder
 * interpolates to nothing and leaves no trailing blank line.
 */
export function renderExperienceCapsulesBlock(capsules: readonly ActiveCapsule[], limit = ACTIVE_CAPSULE_RENDER_LIMIT): string {
  const lines = capsules.slice(0, Math.max(0, limit)).map((capsule) => {
    const symptom = capsule.symptom.trim()
    const rule = capsule.rule.trim()
    return symptom ? `${symptom}→${rule}` : rule
  })
  if (lines.length === 0) return ''
  return `\n最近踩坑经验（人审入库，本次会话优先遵守）：\n${lines.map(line => `- ${line}`).join('\n')}`
}

/**
 * Promote human-approved queue entries into the active store.
 *
 * Pure function over in-memory arrays: the operator (a review UI, endpoint, or
 * maintenance script) reads the queue and store, calls this, then writes both
 * back. Approved entries move to the front (newest-first), supersede any active
 * entry that reuses their id, and leave the queue.
 * @param queue - the current review queue.
 * @param active - the current active store.
 * @param approvedIds - ids a human approved this merge.
 * @param stagesById - optional reviewer-assigned phase tags per id.
 * @returns the next active store, the trimmed queue, and the promoted ids.
 */
export function mergeApprovedCapsules(
  queue: readonly QueuedCapsule[],
  active: readonly ActiveCapsule[],
  approvedIds: readonly string[],
  stagesById: Readonly<Record<string, string[]>> = {},
): MergeResult {
  const approved = new Set(approvedIds)
  const promoted: ActiveCapsule[] = []
  for (const entry of queue) {
    if (!approved.has(entry.id) || promoted.some(capsule => capsule.id === entry.id)) continue
    const stages = stagesById[entry.id]
    promoted.push({
      id: entry.id,
      symptom: entry.symptom,
      rule: entry.rule,
      ...(stages ? { stages } : {}),
    })
  }
  const promotedIds = new Set(promoted.map(capsule => capsule.id))
  return {
    active: [...promoted, ...active.filter(capsule => !promotedIds.has(capsule.id))],
    remainingQueue: queue.filter(entry => !promotedIds.has(entry.id)),
    merged: promoted.map(capsule => capsule.id),
  }
}
