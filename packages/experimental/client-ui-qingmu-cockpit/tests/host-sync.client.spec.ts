import { describe, expect, it, vi } from 'vitest'
import type { ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorContextBindingState } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import {
  createQingmuHostSync,
  createQingmuScenePlanningSavedMessage,
  QINGMU_SCENE_PLANNING_SAVED_SCHEMA,
} from '../src/client/host-sync.ts'

const scope = { projectId: 'project_1', episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1' }
const result: ScenePlanningResult = {
  schema: 'jason.qingmu-scene-planning-result.v1', projectId: scope.projectId, episodeId: scope.episodeId,
  action: 'edit', sceneId: scope.sceneId, seriesId: 'series_1', shotIds: [scope.shotId], actorIds: {},
  source: { scriptRevision: 1, scriptSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64),
    sceneIndex: 1, sourceLineIds: ['line_1'] },
  storyboard: { id: 'revision_2', version: 2, sourceHash: 'c'.repeat(64), status: 'Ready' },
  idempotencyKey: 'intent_1', requestSha256: 'd'.repeat(64), commandReceiptId: 'receipt_1', eventId: 'event_1',
  providerCalls: 0, stageStarted: false, approvalGranted: false,
}
const binding: DirectorContextBindingState = { version: 1, binding: {
  scope, contextSnapshotSha256: 'e'.repeat(64),
}, proposal: null, transition: 'enter' }

function storage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('Qingmu Host save sync', () => {
  it('posts one versioned exact-origin message and deduplicates the same receipt', () => {
    const postMessage = vi.fn(), local = storage(), parent = { postMessage }
    const sync = createQingmuHostSync({ entryScope: scope, referrer: 'http://127.0.0.1:49001/qingmu-runtime/local-session',
      parent, self: {}, storage: local })
    const message = createQingmuScenePlanningSavedMessage(result, binding, null)
    expect(sync).not.toBeNull(); expect(message?.schema).toBe(QINGMU_SCENE_PLANNING_SAVED_SCHEMA)
    expect(sync?.publish(message!)).toBe(true)
    expect(sync?.publish(message!)).toBe(true)
    expect(sync?.replay(binding)).toBe(true)
    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledWith(message, 'http://127.0.0.1:49001')
    expect(sync?.pendingTarget()).toEqual({ sceneId: scope.sceneId, shotId: scope.shotId })
  })

  it('uses the browser ancestor origin when referrer policy removes the referrer', () => {
    const postMessage = vi.fn()
    const sync = createQingmuHostSync({ entryScope: scope, referrer: '', ancestorOrigin: 'http://127.0.0.1:49001',
      parent: { postMessage }, self: {}, storage: storage() })
    const message = createQingmuScenePlanningSavedMessage(result, binding, null)!
    expect(sync?.publish(message)).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(message, 'http://127.0.0.1:49001')
  })

  it('retains replay method proof but grants no Provider, stage or approval authority', () => {
    const message = createQingmuScenePlanningSavedMessage(result, binding, {
      proposalId: 'proposal_1', proposalSha256: '1'.repeat(64), outputSha256: '2'.repeat(64),
      inputContextSnapshotSha256: '3'.repeat(64), methodPackageVersion: 'qingmu.director-replay.v1',
      methodPackageSha256: '4'.repeat(64), workOrderId: 'work_order_1', workOrderSha256: '5'.repeat(64),
      promptSha256: '6'.repeat(64), adoptedItemIds: ['narrative-focus'],
    })
    expect(message?.method?.adoptedItemIds).toEqual(['narrative-focus'])
    expect(message?.authority).toEqual({ source: 'adopted_replay_suggestion', advisoryOnly: true,
      providerCalls: 0, stageStarted: false, approvalGranted: false })
  })

  it('marks adopted provider suggestions with a distinct, non-replay authority source', () => {
    const paidProof = {
      source: 'provider' as const,
      proposalId: 'work_order_paid_1', proposalSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64),
      inputContextSnapshotSha256: 'c'.repeat(64), methodPackageVersion: 'qingmu.director-provider.v1',
      methodPackageSha256: 'd'.repeat(64), workOrderId: 'work_order_paid_1', workOrderSha256: 'e'.repeat(64),
      promptSha256: 'f'.repeat(64), adoptedItemIds: ['visual-tighten'],
    }
    const message = createQingmuScenePlanningSavedMessage(result, binding, paidProof)
    expect(message?.method?.source).toBe('provider')
    expect(message?.authority).toEqual({ source: 'adopted_provider_suggestion', advisoryOnly: true,
      providerCalls: 0, stageStarted: false, approvalGranted: false })
    const postMessage = vi.fn()
    const sync = createQingmuHostSync({ entryScope: scope, referrer: 'http://127.0.0.1:49001/qingmu-runtime/local-session',
      parent: { postMessage }, self: {}, storage: storage() })
    expect(sync?.publish(message!)).toBe(true)
    // A provider proof must never be re-labelled as replay provenance.
    const forged = { ...message!, authority: { ...message!.authority, source: 'adopted_replay_suggestion' as const } }
    expect(sync?.publish(forged)).toBe(false)
    // Legacy replay proofs without a source field stay valid and replay-labelled.
    const { source: _omittedSource, ...legacyProof } = paidProof
    const legacyReplay = createQingmuScenePlanningSavedMessage(result, binding, legacyProof)
    expect(legacyReplay?.authority.source).toBe('adopted_replay_suggestion')
    expect(sync?.publish(legacyReplay!)).toBe(true)
  })

  it('fails closed for stale context, wrong scope, top-level use and an untrusted parent origin', () => {
    const local = storage(), parent = { postMessage: vi.fn() }
    const sync = createQingmuHostSync({ entryScope: scope, referrer: 'http://localhost:49001/entry',
      parent, self: {}, storage: local })!
    const message = createQingmuScenePlanningSavedMessage(result, binding, null)!
    expect(sync.publish(message)).toBe(true)
    const stale = { ...binding, binding: { ...binding.binding, contextSnapshotSha256: 'f'.repeat(64) } }
    const restarted = createQingmuHostSync({ entryScope: scope, referrer: 'http://localhost:49001/entry',
      parent, self: {}, storage: local })!
    expect(restarted.replay(stale)).toBe(false)
    expect(createQingmuScenePlanningSavedMessage({ ...result, projectId: 'other' }, binding, null)).toBeNull()
    expect(createQingmuHostSync({ entryScope: scope, referrer: 'https://example.com/entry',
      parent, self: {}, storage: local })).toBeNull()
    expect(createQingmuHostSync({ entryScope: scope, referrer: 'http://localhost:49001/entry',
      ancestorOrigin: 'http://127.0.0.1:49002', parent, self: {}, storage: local })).toBeNull()
    expect(createQingmuHostSync({ entryScope: scope, referrer: 'http://localhost:49001/entry',
      parent, self: parent, storage: local })).toBeNull()
  })
})
