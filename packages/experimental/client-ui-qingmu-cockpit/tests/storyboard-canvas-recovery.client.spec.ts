// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearStoryboardCanvasRecoveryMarker,
  createStoryboardCanvasRecoveryMarker,
  deriveStoryboardCanvasIdempotencyKey,
  readStoryboardCanvasRecoveryMarker,
  writeStoryboardCanvasRecoveryMarker,
} from '../src/client/storyboard-canvas-recovery.ts'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

const COORDINATES = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevisionId: 'storyboard-7',
  frameId: 'shot-frame-3',
} as const

beforeEach(() => {
  sessionStorage.clear()
})

describe('Storyboard Canvas commit recovery marker', () => {
  it('stores only exact non-body receipt coordinates and clears only the same marker', async () => {
    const marker = createStoryboardCanvasRecoveryMarker({
      ...COORDINATES,
      targetType: 'storyboard_frame',
      targetId: 'shot-frame-3',
      changeSetId: 'change-set-1',
      baseRevision: 7,
      baseSnapshotSha256: SHA_A,
      idempotencyKey: await deriveStoryboardCanvasIdempotencyKey('change-set-1', SHA_B),
      expectedPayloadSha256: SHA_B,
    })

    expect(writeStoryboardCanvasRecoveryMarker(marker)).toBe(true)
    expect(readStoryboardCanvasRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker })
    const serialized = JSON.stringify(marker)
    expect(serialized).not.toContain('annotations')
    expect(serialized).not.toContain('methodProjection')
    expect(serialized).not.toContain('heroFrameMediaSha256')

    expect(clearStoryboardCanvasRecoveryMarker({ ...marker, changeSetId: 'other' })).toBe(false)
    expect(readStoryboardCanvasRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker })
    expect(clearStoryboardCanvasRecoveryMarker(marker)).toBe(true)
    expect(readStoryboardCanvasRecoveryMarker(COORDINATES)).toEqual({ status: 'none' })
  })

  it('fails closed for an invalid or cross-frame marker', async () => {
    const marker = createStoryboardCanvasRecoveryMarker({
      ...COORDINATES,
      targetType: 'storyboard_frame',
      targetId: 'shot-frame-3',
      changeSetId: 'change-set-1',
      baseRevision: 7,
      baseSnapshotSha256: SHA_A,
      idempotencyKey: await deriveStoryboardCanvasIdempotencyKey('change-set-1', SHA_B),
      expectedPayloadSha256: SHA_B,
    })
    expect(writeStoryboardCanvasRecoveryMarker(marker)).toBe(true)

    const otherFrame = { ...COORDINATES, frameId: 'shot-frame-4' }
    expect(readStoryboardCanvasRecoveryMarker(otherFrame)).toEqual({ status: 'none' })
    expect(writeStoryboardCanvasRecoveryMarker({ ...marker, expectedPayloadSha256: 'invalid' })).toBe(false)
    expect(readStoryboardCanvasRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker })
  })
})
