import { expect, it, vi } from 'vitest'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { prepareDialogueVideo } from '../src/dialogue-video.ts'
import { draftContext, draftScope } from '../examples/native-draft-fixture.ts'

function fixture() {
  const scope = draftScope
  const input: Parameters<typeof prepareDialogueVideo>[0] = { scope, context: draftContext,
    editableLines: [{ schemaVersion: 'dialogue-cue-v2', lineId: 'line6', speakerId: 'lina',
      verbatimText: '有人在吗？', plannedStartSec: 1, plannedEndSec: 3, timingVerified: false, legacy: false }] }
  const state = { schema: 'jason.qingmu-prompt-ir-bootstrap-state.v1',
    context: { projectId: scope.projectId, episodeId: scope.episodeId, frame: { id: scope.shotId },
      storyboard: { id: draftContext.storyboard.id } }, contextSnapshotSha256: 'a'.repeat(64), draft: null as object | null, ready: null }
  const fields = { imageGenPrompt: '车旁，保持机位。', lastFrameImagePrompt: '',
    videoGenPrompt: '原有构图；莉娜面向公路呼喊。', motionPrompt: '镜头固定。', negativePrompt: '禁止新增人物。' }
  const read = vi.fn(async () => ({ ok: true as const, value: state }))
  const method = vi.fn(async (_endpoint: string, payload: unknown) => ({ ok: true as const, value: {
    projectionSha256: 'b'.repeat(64), projection: { candidate: { editableProjection:
      (payload as { editableProjection?: object }).editableProjection ?? fields } }, methodAttestation: { signature: 'fixture' },
  } }))
  const command = vi.fn(async () => ({ ok: true as const, value: { draftCreated: true } }))
  const readers = { read: read as ConnectionRpcHandler, method: method as ConnectionRpcHandler,
    command: command as ConnectionRpcHandler }
  const beforeWrite = vi.fn(async () => {})
  return { input, state, fields, read, method, command, readers, beforeWrite }
}
it('includes the new exact utterance/speaker in the actual method and Writer Draft request, without paid or approval calls', async () => {
  const f = fixture()
  const result = await prepareDialogueVideo(f.input, f.readers, new AbortController().signal, f.beforeWrite)
  expect(result).toMatchObject({ status: 'awaiting_input_review', created: true,
    mediaGenerated: false, humanApprovalInferred: false })
  expect(f.method.mock.calls[1]?.[1]).toMatchObject({ editableProjection: {
    imageGenPrompt: f.fields.imageGenPrompt, videoGenPrompt: expect.stringContaining('lina："有人在吗？"') } })
  type DraftRequest = { methodProjection: { candidate: { editableProjection: typeof f.fields } } }
  const requests = f.command.mock.calls as unknown as [string, DraftRequest][]
  expect(requests[0]?.[0]).toBe('bootstrapPromptIr')
  expect(requests[0]?.[1].methodProjection.candidate.editableProjection.videoGenPrompt).toContain('有人在吗？')
  expect(f.beforeWrite).toHaveBeenCalledTimes(1)
  expect(f.command).toHaveBeenCalledTimes(1)
})
it('reuses a Draft observed after lost response/reload instead of creating or selecting another one', async () => {
  const f = fixture(); f.state.draft = { promptIrId: 'existing-draft', editableProjection: {
    ...f.fields, videoGenPrompt: '莉娜呼喊；lina："有人在吗？"' } }
  const result = await prepareDialogueVideo(f.input, f.readers, new AbortController().signal, f.beforeWrite)
  expect(result).toMatchObject({ created: false, status: 'awaiting_input_review', draft: f.state.draft })
  expect(f.command).not.toHaveBeenCalled(); expect(f.method).not.toHaveBeenCalled()
})
it('does not report an existing generic or old-dialogue Draft as ready for the new dialogue', async () => {
  const f = fixture(); f.state.draft = { promptIrId: 'existing-draft', editableProjection: f.fields }
  await expect(prepareDialogueVideo(f.input, f.readers, new AbortController().signal, f.beforeWrite))
    .rejects.toThrow('已有视频输入未包含本镜新台词与说话人')
  expect(f.command).not.toHaveBeenCalled(); expect(f.method).not.toHaveBeenCalled()
})
it('uses the same content-derived command key when the first result was uncertain', async () => {
  const f = fixture()
  f.command.mockRejectedValueOnce(new Error('response lost'))
  await expect(prepareDialogueVideo(f.input, f.readers, new AbortController().signal, f.beforeWrite)).rejects.toThrow('response lost')
  await prepareDialogueVideo(f.input, f.readers, new AbortController().signal, f.beforeWrite)
  const calls = f.command.mock.calls as unknown as unknown[][]
  expect(calls[0]?.slice(0, 2)).toEqual(calls[1]?.slice(0, 2))
})
it('does not save after target movement, cancellation, or unresolved speaker identity', async () => {
  const f = fixture(); f.beforeWrite.mockRejectedValue(new Error('selection moved'))
  await expect(prepareDialogueVideo(f.input, f.readers, new AbortController().signal, f.beforeWrite)).rejects.toThrow('selection moved')
  expect(f.command).not.toHaveBeenCalled()
  const controller = new AbortController(); controller.abort()
  await expect(prepareDialogueVideo(f.input, f.readers, controller.signal, f.beforeWrite)).rejects.toThrow()
  const input = { ...f.input, editableLines: [{ ...f.input.editableLines[0]!, speakerId: null }] }
  await expect(prepareDialogueVideo(input, f.readers, new AbortController().signal, f.beforeWrite)).rejects.toThrow('说话人')
  expect(f.command).not.toHaveBeenCalled()
})
