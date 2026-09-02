import type { ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorContextBindingState } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'

interface QingmuEntryScopeLike {
  readonly projectId: string
  readonly episodeId: string
}

/** Whole-value contract version for a completed scene-planning save notification. */
export const QINGMU_SCENE_PLANNING_SAVED_SCHEMA = 'deepseek.dsh.qingmu-scene-planning-saved.v1' as const
/** Discriminant used by the outer Host message receiver. */
export const QINGMU_SCENE_PLANNING_SAVED_TYPE = 'qingmu:scene-planning-saved' as const

/** Replay method coordinates retained with a pending save and its recovered receipt. */
export interface QingmuAdvisorySaveProof {
  readonly proposalId: string
  readonly proposalSha256: string
  readonly outputSha256: string
  readonly inputContextSnapshotSha256: string
  readonly methodPackageVersion: string
  readonly methodPackageSha256: string
  readonly workOrderId: string
  readonly workOrderSha256: string
  readonly promptSha256: string
  readonly adoptedItemIds: readonly string[]
}

/** Versioned, authority-bounded notification emitted only after canonical reread. */
export interface QingmuScenePlanningSavedMessage {
  readonly schema: typeof QINGMU_SCENE_PLANNING_SAVED_SCHEMA
  readonly type: typeof QINGMU_SCENE_PLANNING_SAVED_TYPE
  readonly messageId: string
  readonly scope: {
    readonly projectId: string
    readonly episodeId: string
    readonly sceneId: string
    readonly shotId: string
  }
  readonly context: { readonly snapshotSha256: string }
  readonly method: QingmuAdvisorySaveProof | null
  readonly receipt: {
    readonly commandReceiptId: string
    readonly eventId: string
    readonly idempotencyKey: string
    readonly requestSha256: string
    readonly storyboardRevisionId: string
    readonly storyboardVersion: number
    readonly storyboardSourceHash: string
  }
  readonly locate: { readonly stage: 'storyboard'; readonly sceneId: string; readonly shotId: string }
  readonly authority: {
    readonly source: 'manual_edit' | 'adopted_replay_suggestion'
    readonly advisoryOnly: true
    readonly providerCalls: 0
    readonly stageStarted: false
    readonly approvalGranted: false
  }
}

/** Narrow Host/iframe sender. The outer workspace owns refresh, locate and deduplication. */
export interface QingmuHostSync {
  readonly pendingTarget: () => { readonly sceneId: string; readonly shotId: string } | null
  readonly publish: (message: QingmuScenePlanningSavedMessage) => boolean
  readonly replay: (binding: DirectorContextBindingState) => boolean
}

interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

interface SyncStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const identityPattern = /^[A-Za-z0-9_.:-]{1,256}$/u
const digestPattern = /^[a-f0-9]{64}$/u

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && identityPattern.test(value)
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function validProof(value: unknown): value is QingmuAdvisorySaveProof {
  const item = record(value)
  return item !== null
    && validIdentity(item.proposalId)
    && validDigest(item.proposalSha256)
    && validDigest(item.outputSha256)
    && validDigest(item.inputContextSnapshotSha256)
    && validIdentity(item.methodPackageVersion)
    && validDigest(item.methodPackageSha256)
    && validIdentity(item.workOrderId)
    && validDigest(item.workOrderSha256)
    && validDigest(item.promptSha256)
    && Array.isArray(item.adoptedItemIds)
    && item.adoptedItemIds.length > 0
    && item.adoptedItemIds.length <= 100
    && new Set(item.adoptedItemIds).size === item.adoptedItemIds.length
    && item.adoptedItemIds.every(validIdentity)
}

/**
 * Reject malformed, wrong-scope or authority-escalating messages before crossing the iframe boundary.
 *
 * @param value Candidate whole-value notification.
 * @param entryScope Exact project and episode supplied by the embedded entry.
 * @returns Whether the candidate is a valid notification for that entry scope.
 */
export function isQingmuScenePlanningSavedMessage(
  value: unknown,
  entryScope: QingmuEntryScopeLike,
): value is QingmuScenePlanningSavedMessage {
  const item = record(value)
  const scope = record(item?.scope)
  const context = record(item?.context)
  const receipt = record(item?.receipt)
  const locate = record(item?.locate)
  const authority = record(item?.authority)
  return item?.schema === QINGMU_SCENE_PLANNING_SAVED_SCHEMA
    && item.type === QINGMU_SCENE_PLANNING_SAVED_TYPE
    && validIdentity(item.messageId)
    && scope?.projectId === entryScope.projectId
    && scope.episodeId === entryScope.episodeId
    && validIdentity(scope.sceneId)
    && validIdentity(scope.shotId)
    && validDigest(context?.snapshotSha256)
    && (item.method === null || validProof(item.method))
    && validIdentity(receipt?.commandReceiptId)
    && receipt.eventId === item.messageId
    && validIdentity(receipt.idempotencyKey)
    && validDigest(receipt.requestSha256)
    && validIdentity(receipt.storyboardRevisionId)
    && typeof receipt.storyboardVersion === 'number'
    && Number.isSafeInteger(receipt.storyboardVersion)
    && receipt.storyboardVersion >= 1
    && validDigest(receipt.storyboardSourceHash)
    && locate?.stage === 'storyboard'
    && locate.sceneId === scope.sceneId
    && locate.shotId === scope.shotId
    && authority?.source === (item.method === null ? 'manual_edit' : 'adopted_replay_suggestion')
    && authority.advisoryOnly === true
    && authority.providerCalls === 0
    && authority.stageStarted === false
    && authority.approvalGranted === false
}

/**
 * Build the only cross-interface save notification from a verified receipt and current binding.
 *
 * @param result Authoritative save or recovered-receipt result.
 * @param binding Fresh director binding obtained after the authoritative reread.
 * @param method Optional method-bound proof for explicitly adopted advisory items.
 * @returns A validated notification, or null when any scope or authority field disagrees.
 */
export function createQingmuScenePlanningSavedMessage(
  result: ScenePlanningResult,
  binding: DirectorContextBindingState,
  method: QingmuAdvisorySaveProof | null,
): QingmuScenePlanningSavedMessage | null {
  const { scope } = binding.binding
  if (result.projectId !== scope.projectId
    || result.episodeId !== scope.episodeId
    || result.sceneId !== scope.sceneId
    || !result.shotIds.includes(scope.shotId)
    || !validDigest(binding.binding.contextSnapshotSha256)) return null
  const message: QingmuScenePlanningSavedMessage = {
    schema: QINGMU_SCENE_PLANNING_SAVED_SCHEMA,
    type: QINGMU_SCENE_PLANNING_SAVED_TYPE,
    messageId: result.eventId,
    scope,
    context: { snapshotSha256: binding.binding.contextSnapshotSha256 },
    method,
    receipt: {
      commandReceiptId: result.commandReceiptId,
      eventId: result.eventId,
      idempotencyKey: result.idempotencyKey,
      requestSha256: result.requestSha256,
      storyboardRevisionId: result.storyboard.id,
      storyboardVersion: result.storyboard.version,
      storyboardSourceHash: result.storyboard.sourceHash,
    },
    locate: { stage: 'storyboard', sceneId: scope.sceneId, shotId: scope.shotId },
    authority: {
      source: method === null ? 'manual_edit' : 'adopted_replay_suggestion',
      advisoryOnly: true,
      providerCalls: result.providerCalls,
      stageStarted: result.stageStarted,
      approvalGranted: result.approvalGranted,
    },
  }
  return isQingmuScenePlanningSavedMessage(message, scope) ? message : null
}

function localParentOrigin(referrer: string): string | null {
  try {
    const url = new URL(referrer)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
    return url.protocol === 'http:' && loopback ? url.origin : null
  } catch {
    return null
  }
}

/**
 * Create an exact-origin sender for the local Writer parent; invalid embeddings get no channel.
 *
 * @param options Embedded entry scope, origin evidence, message target and bounded storage.
 * @returns A scope-bound sender, or null when the embedding cannot be trusted.
 */
export function createQingmuHostSync(options: {
  readonly entryScope: QingmuEntryScopeLike | null | undefined
  readonly referrer: string
  readonly ancestorOrigin?: string | undefined
  readonly parent: MessageTarget
  readonly self: unknown
  readonly storage: SyncStorage
}): QingmuHostSync | null {
  if (options.entryScope === undefined || options.entryScope === null || options.parent === options.self) return null
  const referrerOrigin = options.referrer === '' ? null : localParentOrigin(options.referrer)
  const ancestorOrigin = options.ancestorOrigin === undefined || options.ancestorOrigin === ''
    ? null
    : localParentOrigin(options.ancestorOrigin)
  if ((options.referrer !== '' && referrerOrigin === null)
    || (options.ancestorOrigin !== undefined && options.ancestorOrigin !== '' && ancestorOrigin === null)
    || (referrerOrigin !== null && ancestorOrigin !== null && referrerOrigin !== ancestorOrigin)) return null
  const targetOrigin = referrerOrigin ?? ancestorOrigin
  if (targetOrigin === null) return null
  const entryScope = options.entryScope
  const key = `qingmu.host-sync.v1:${entryScope.projectId}:${entryScope.episodeId}`
  const posted = new Set<string>()
  const read = (): QingmuScenePlanningSavedMessage | null => {
    try {
      const value = JSON.parse(options.storage.getItem(key) ?? 'null') as unknown
      if (isQingmuScenePlanningSavedMessage(value, entryScope)) return value
      options.storage.removeItem(key)
    } catch {
      try { options.storage.removeItem(key) } catch { /* Fail closed when storage is unavailable. */ }
    }
    return null
  }
  const post = (message: QingmuScenePlanningSavedMessage): boolean => {
    if (posted.has(message.messageId)) return true
    try {
      options.parent.postMessage(message, targetOrigin)
      posted.add(message.messageId)
      return true
    } catch {
      return false
    }
  }
  return {
    pendingTarget: () => {
      const message = read()
      return message === null ? null : { sceneId: message.scope.sceneId, shotId: message.scope.shotId }
    },
    publish: (message) => {
      if (!isQingmuScenePlanningSavedMessage(message, entryScope)) return false
      try { options.storage.setItem(key, JSON.stringify(message)) } catch { return false }
      return post(message)
    },
    replay: (binding) => {
      const message = read()
      if (message === null
        || binding.binding.contextSnapshotSha256 !== message.context.snapshotSha256
        || binding.binding.scope.projectId !== message.scope.projectId
        || binding.binding.scope.episodeId !== message.scope.episodeId
        || binding.binding.scope.sceneId !== message.scope.sceneId
        || binding.binding.scope.shotId !== message.scope.shotId) return false
      return post(message)
    },
  }
}
