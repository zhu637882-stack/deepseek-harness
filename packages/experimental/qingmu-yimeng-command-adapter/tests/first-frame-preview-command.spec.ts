import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const scope = { projectId: 'project_1', episodeId: 'episode_1', frameId: 'frame_1' }
const refs = [{ assetId: 'asset_room', assetSha256: 'a'.repeat(64), purpose: '同一房间，起始门关闭；保留完整文字。' }]
const preview = { ...scope, schema: 'qingmu.shooting-first-frame-preview.v1', preflightId: 'b'.repeat(64), payloadHash: 'c'.repeat(64),
  prompt: '门关闭，演员站在桌西侧。', blockers: [], referenceMode: 'working', referenceBindings: refs }
function setup(result: unknown = preview) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' }) }
}
it('prepares the same scoped image input as the shooting page and preserves ordered reference purposes', async () => {
  const h = setup()
  expect(await h.handler('previewShootingFirstFrame', { ...scope, referenceImages: refs }, new AbortController().signal)).toEqual({ ok: true, value: preview })
  expect(h.fetch).toHaveBeenCalledTimes(1)
  expect(h.fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:49123/api/pipeline/first-frames/shooting-preview')
  expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1]?.body))).toEqual({ project_id: scope.projectId,
    episode_id: scope.episodeId, frame_ids: [scope.frameId], reference_images: refs })
})
it.each([{ paidConfirmed: true }, { frameId: '../another' }, { referenceImages: [] }, { referenceImages: [...refs, ...refs] },
  { referenceImages: [{ ...refs[0], url: 'https://elsewhere.test/image.png' }] }])('rejects generation flags or invalid references before transport: %j', async (extra) => {
  const h = setup()
  expect(await h.handler('previewShootingFirstFrame', { ...scope, ...extra }, new AbortController().signal)).toMatchObject({ ok: false })
  expect(h.fetch).not.toHaveBeenCalled()
})
it.each([{ projectId: 'another' }, { frameId: 'another' }, { prompt: 'private-token' }, { payloadHash: 'bad' }])('rejects a mismatched or credential-reflecting response: %j', async (extra) => {
  const h = setup({ ...preview, ...extra })
  expect(await h.handler('previewShootingFirstFrame', scope, new AbortController().signal)).toMatchObject({ ok: false })
})
