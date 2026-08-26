// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPromptIrEditRecoveryMarker,
  clearPromptIrSelectionRecoveryMarker,
  createPromptIrEditRecoveryMarker,
  createPromptIrSelectionRecoveryMarker,
  derivePromptIrEditIdempotencyKey,
  derivePromptIrSelectionIdempotencyKey,
  readPromptIrEditRecoveryMarker,
  readPromptIrSelectionRecoveryMarker,
  writePromptIrEditRecoveryMarker,
  writePromptIrSelectionRecoveryMarker,
} from '../src/client/prompt-ir-recovery.ts'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)

const COORDINATES = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevisionId: 'storyboard-7',
  frameId: 'frame-3',
} as const

beforeEach(() => {
  sessionStorage.clear()
})

describe('PromptIR recovery markers', () => {
  it('keeps edit and selection as independent pre-POST markers', async () => {
    const edit = createPromptIrEditRecoveryMarker({
      ...COORDINATES,
      targetType: 'prompt_ir',
      targetId: 'storyboard-7:frame-3',
      changeSetId: 'change-set-1',
      basePromptIrId: 'prompt-ready-1',
      baseRevision: 4,
      baseSnapshotSha256: SHA_A,
      idempotencyKey: await derivePromptIrEditIdempotencyKey('change-set-1', SHA_B),
      expectedPayloadSha256: SHA_B,
    })
    const selectionIdentity = {
      ...COORDINATES,
      draftPromptIrId: 'prompt-draft-1',
      draftVersion: 5,
      draftContentSha256: SHA_C,
    }
    const selection = createPromptIrSelectionRecoveryMarker({
      ...selectionIdentity,
      idempotencyKey: await derivePromptIrSelectionIdempotencyKey(selectionIdentity),
    })

    expect(writePromptIrEditRecoveryMarker(edit)).toBe(true)
    expect(writePromptIrSelectionRecoveryMarker(selection)).toBe(true)
    expect(readPromptIrEditRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker: edit })
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker: selection })
    expect(selection).not.toHaveProperty('changeSetId')

    expect(clearPromptIrEditRecoveryMarker(edit)).toBe(true)
    expect(readPromptIrEditRecoveryMarker(COORDINATES)).toEqual({ status: 'none' })
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker: selection })

    expect(clearPromptIrSelectionRecoveryMarker(selection)).toBe(true)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES)).toEqual({ status: 'none' })
  })

  it('does not overwrite or clear a different exact lineage marker', async () => {
    const edit = createPromptIrEditRecoveryMarker({
      ...COORDINATES,
      targetType: 'prompt_ir',
      targetId: 'storyboard-7:frame-3',
      changeSetId: 'change-set-1',
      basePromptIrId: 'prompt-ready-1',
      baseRevision: 4,
      baseSnapshotSha256: SHA_A,
      idempotencyKey: await derivePromptIrEditIdempotencyKey('change-set-1', SHA_B),
      expectedPayloadSha256: SHA_B,
    })
    expect(writePromptIrEditRecoveryMarker(edit)).toBe(true)

    const different = createPromptIrEditRecoveryMarker({ ...edit, changeSetId: 'change-set-2' })
    expect(writePromptIrEditRecoveryMarker(different)).toBe(false)
    expect(clearPromptIrEditRecoveryMarker(different)).toBe(false)
    expect(readPromptIrEditRecoveryMarker(COORDINATES)).toEqual({ status: 'ready', marker: edit })
  })
})
