// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTakeVersionSelectionMarker, createTakeVersionSelectionMarker,
  readTakeVersionSelectionMarker, writeTakeVersionSelectionMarker,
} from '../src/client/take-version-recovery.ts'

const SCOPE = { projectId: 'project-take', episodeId: 'episode-take', frameId: 'frame-take' } as const
const INTENT = {
  ...SCOPE,
  expectedStackSha256: 'a'.repeat(64),
  expectedSelectedTakeId: 'asset-take-1',
  candidateTakeId: 'asset-take-2',
  candidateVersionOrdinal: 2,
  candidateOutputSha256: 'b'.repeat(64),
} as const

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Take selection recovery marker', () => {
  it('is deterministic, stores only exact nonsecret coordinates, and compare-clears', async () => {
    const first = await createTakeVersionSelectionMarker(INTENT)
    const second = await createTakeVersionSelectionMarker(INTENT)
    expect(second).toEqual(first)
    expect(first.idempotencyKey).toMatch(/^qingmu:take-select:v1:[0-9a-f]{64}$/)
    expect(writeTakeVersionSelectionMarker(first)).toBe(true)
    expect(readTakeVersionSelectionMarker(SCOPE)).toEqual({ status: 'ready', marker: first })
    const serialized = JSON.stringify(first)
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('actor')
    expect(serialized).not.toContain('approve')
    expect(clearTakeVersionSelectionMarker(SCOPE, { status: 'ready', marker: { ...first, candidateTakeId: 'other' } })).toBe(false)
    expect(clearTakeVersionSelectionMarker(SCOPE, { status: 'ready', marker: first })).toBe(true)
    expect(readTakeVersionSelectionMarker(SCOPE)).toEqual({ status: 'none' })
  })

  it('never overwrites a different unresolved intent', async () => {
    const first = await createTakeVersionSelectionMarker(INTENT)
    const second = await createTakeVersionSelectionMarker({ ...INTENT, candidateTakeId: 'asset-take-3', candidateVersionOrdinal: 3 })
    expect(writeTakeVersionSelectionMarker(first)).toBe(true)
    expect(writeTakeVersionSelectionMarker(second)).toBe(false)
    expect(readTakeVersionSelectionMarker(SCOPE)).toEqual({ status: 'ready', marker: first })
  })

  it('isolates markers by Project, Episode, and Shot', async () => {
    const marker = await createTakeVersionSelectionMarker(INTENT)
    expect(writeTakeVersionSelectionMarker(marker)).toBe(true)
    expect(readTakeVersionSelectionMarker({ ...SCOPE, frameId: 'other-frame' })).toEqual({ status: 'none' })
  })

  it('fails closed on malformed local storage and clears it only by exact invalid snapshot', () => {
    const key = ['qingmu:take-version-selection-recovery:v1', SCOPE.projectId, SCOPE.episodeId, SCOPE.frameId]
      .map(encodeURIComponent).join(':')
    sessionStorage.setItem(key, '{broken')
    const invalid = readTakeVersionSelectionMarker(SCOPE)
    expect(invalid.status).toBe('invalid')
    expect(clearTakeVersionSelectionMarker(SCOPE, { status: 'invalid', serialized: '{different' })).toBe(false)
    expect(clearTakeVersionSelectionMarker(SCOPE, invalid)).toBe(true)
    expect(readTakeVersionSelectionMarker(SCOPE)).toEqual({ status: 'none' })
  })
})
