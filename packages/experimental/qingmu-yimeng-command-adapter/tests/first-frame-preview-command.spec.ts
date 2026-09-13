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
it('returns the actual image input rejection to the director without credentials or automatic retry', async () => {
  const h = setup()
  const detail = '首帧完整请求为6001字符，超过5000字符上限；未截断导演内容、未提交生成。private-token'
  h.fetch.mockImplementationOnce(async () => Response.json({ detail }, { status: 409 }))
  const result = await h.handler('previewShootingFirstFrame', scope, new AbortController().signal)
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('6001字符，超过5000字符上限') } })
  expect(JSON.stringify(result)).not.toContain('private-token')
  expect(h.fetch).toHaveBeenCalledOnce()
})
it.each([{ status: 500, detail: 'internal diagnostic' }, { status: 409, detail: 'x'.repeat(2049) }])(
  'keeps unrelated or oversized upstream errors private (%s)', async ({ status, detail }) => {
    const h = setup()
    h.fetch.mockImplementationOnce(async () => Response.json({ detail }, { status }))
    expect(await h.handler('previewShootingFirstFrame', scope, new AbortController().signal)).toMatchObject({
      ok: false, error: { message: `Yimeng rejected command (HTTP ${status})` },
    })
    expect(h.fetch).toHaveBeenCalledOnce()
  })
