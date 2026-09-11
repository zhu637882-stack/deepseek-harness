import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

function setup(response: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' }) }
}

it('updates the exact project using PATCH without touching creation or media', async () => {
  const saved = { id: 'project_1', name: '夜航', status: 'archived' }
  const { fetch, handler } = setup(saved)
  expect(await handler('updateProject', { projectId: 'project_1', name: ' 夜航 ', status: 'archived' }, new AbortController().signal)).toMatchObject({ ok: true, value: saved })
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:49123/api/projects/project_1')
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ name: '夜航', status: 'archived' }), redirect: 'error' })
})

it.each([{ projectId: '../escape', name: 'x' }, { projectId: 'project_1', name: ' ' }, { projectId: 'project_1', owner: 'other' }, { projectId: 'project_1', status: 'deleted' }, { projectId: 'project_1' }])('rejects invalid edits before transport: %j', async (request) => {
  const { fetch, handler } = setup({})
  expect(await handler('updateProject', request, new AbortController().signal)).toMatchObject({ ok: false })
  expect(fetch).not.toHaveBeenCalled()
})

it.each([{ id: 'other', name: '夜航', status: 'active' }, { id: 'project_1', name: '旧名称', status: 'active' }])('rejects a different project or unapplied update', async (response) => {
  expect(await setup(response).handler('updateProject', { projectId: 'project_1', name: '夜航' }, new AbortController().signal)).toMatchObject({ ok: false })
})
