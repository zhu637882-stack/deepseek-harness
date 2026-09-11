import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
const request = { sourceProjectId: 'project_source', name: '新版本', expectedSourceSha256: 'a'.repeat(64), idempotencyKey: 'copy:test-intent' }
const requestSha256 = createHash('sha256').update(JSON.stringify({ expectedSourceSha256: request.expectedSourceSha256, name: request.name, sourceProjectId: request.sourceProjectId })).digest('hex')
const flags = { providerCalls: 0, stageStarted: false, approvalGranted: false }
const receipt = { schema: 'qingmu.project-copy-result.v1', ...flags, projectId: 'project_copy', sourceProjectId: request.sourceProjectId, name: request.name,
  episodeIds: ['episode_copy'], idempotencyKey: request.idempotencyKey, requestSha256 }
function setup(response: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' }) }
}
it('submits one exact copy and recovers the receipt through the authenticated adapter', async () => {
  const { handler, fetch } = setup(receipt)
  expect(await handler('copyProject', request, new AbortController().signal)).toMatchObject({ ok: true, value: receipt })
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(request), redirect: 'error' })
  expect(await handler('recoverProjectCopy', { idempotencyKey: request.idempotencyKey, requestSha256 }, new AbortController().signal)).toMatchObject({ ok: true })
  expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
})
it.each([{ ...receipt, requestSha256: 'b'.repeat(64) }, { ...receipt, projectId: request.sourceProjectId }, { ...receipt, providerCalls: 1 }])('rejects wrong or unexpected copy results', async (result) => {
  expect(await setup(result).handler('copyProject', request, new AbortController().signal)).toMatchObject({ ok: false })
})
it('rejects foreign input before transport and binds previews to the source', async () => {
  const { handler, fetch } = setup({})
  expect(await handler('copyProject', { ...request, owner: 'other' }, new AbortController().signal)).toMatchObject({ ok: false })
  expect(fetch).not.toHaveBeenCalled()
  const preview = { schema: 'qingmu.project-copy-preview.v1', ...flags, sourceProjectId: request.sourceProjectId, sourceName: '原作', sourceSha256: 'a'.repeat(64), counts: { episodes: 2 } }
  expect(await setup(preview).handler('previewProjectCopy', { sourceProjectId: request.sourceProjectId }, new AbortController().signal)).toMatchObject({ ok: true })
  expect(await setup(preview).handler('previewProjectCopy', { sourceProjectId: 'other' }, new AbortController().signal)).toMatchObject({ ok: false })
})
