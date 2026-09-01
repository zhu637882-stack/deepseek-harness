import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  EditorialHandoffDownloadAuthorizer,
  registerEditorialHandoffDownload,
} from '../src/editorial-handoff-download.ts'

const SOURCE_SHA = '1'.repeat(64)
const PROJECTION_SHA = '2'.repeat(64)
let server: Server | undefined
let disposeRoutes: (() => void) | undefined
let temporaryRoot: string | undefined

afterEach(async () => {
  disposeRoutes?.()
  disposeRoutes = undefined
  if (server !== undefined) {
    server.close()
    await once(server, 'close')
    server = undefined
  }
  if (temporaryRoot !== undefined) {
    await rm(temporaryRoot, { recursive: true, force: true })
    temporaryRoot = undefined
  }
})

async function host(
  fetchUpstream: typeof globalThis.fetch,
  token = 'host-token',
  readUserId: () => string = () => 'writer-user',
) {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'qingmu-download-test-'))
  const stateFile = join(temporaryRoot, 'state', 'downloads.json')
  const authorizer = new EditorialHandoffDownloadAuthorizer(stateFile)
  const access = authorizer.issue({
    authenticatedUserId: 'writer-user',
    projectId: 'project-e8', episodeId: 'episode-e8',
    sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
  })
  const routes = new Map<string, WebRoute>()
  const registrar = {
    register(route: WebRoute) {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  } as unknown as WebServer
  const authenticatedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input
      : new URL(typeof input === 'string' ? input : input.url)
    if (url.pathname === '/api/auth/me') {
      return new Response(JSON.stringify({ id: readUserId() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return fetchUpstream(input, init)
  }
  disposeRoutes = registerEditorialHandoffDownload(registrar, {
    baseUrl: 'http://127.0.0.1:18815', fetch: authenticatedFetch, readToken: () => token,
    authorizer, temporaryRoot,
  })
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://loopback.invalid').pathname
    const route = routes.get(path)
    if (route === undefined) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test Host did not bind TCP')
  return { base: `http://127.0.0.1:${String(address.port)}`, access, stateFile }
}

function downloadUrl(base: string, access: { readonly requestId: string; readonly capability: string }): string {
  const query = new URLSearchParams({
    projectId: 'project-e8', episodeId: 'episode-e8',
    sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
    requestId: access.requestId, capability: access.capability,
  })
  return `${base}/api/qingmu/editorial-handoff/download?${query.toString()}`
}

describe('editorial handoff Host download bridge', () => {
  it('streams one authenticated package and exposes only verified status facts', async () => {
    const bytes = Buffer.from('deterministic-otio-package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, {
      status: 200, headers: {
        'content-type': 'application/zip', 'content-length': String(bytes.length),
        'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
      },
    })) as unknown as typeof globalThis.fetch
    const { base, access } = await host(fetchUpstream)

    const response = await fetch(downloadUrl(base, access))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="qingmu-editorial-handoff.otio.zip"',
    )
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
    const call = (fetchUpstream as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(call?.[0])).toContain('/projects/project-e8/episodes/episode-e8/editorial-handoff/download')
    expect(call?.[1]).toMatchObject({ method: 'GET', headers: {
      authorization: 'Bearer host-token', accept: 'application/zip',
      'x-qingmu-authenticated-user-id': 'writer-user',
    } })

    const status = await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))
    expect(await status.json()).toEqual({ status: 'succeeded', sha256: digest, size: bytes.length, errorCode: null })
    expect((await fetch(downloadUrl(base, access))).status).toBe(409)
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('fails closed on stale source and preserves a recoverable failed status', async () => {
    const fetchUpstream = vi.fn(async () => new Response(JSON.stringify({
      detail: { code: 'editorial_handoff_source_drift' },
    }), { status: 409, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch
    const { base, access } = await host(fetchUpstream)
    expect((await fetch(downloadUrl(base, access))).status).toBe(409)
    const status = await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))
    expect(await status.json()).toEqual({ status: 'failed', sha256: null, size: null, errorCode: 'source_stale' })
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('does not call Writer without a private Host read token', async () => {
    const fetchUpstream = vi.fn() as unknown as typeof globalThis.fetch
    const { base, access } = await host(fetchUpstream, '')
    expect((await fetch(downloadUrl(base, access))).status).toBe(403)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('rejects an unissued capability before using the private Writer token', async () => {
    const fetchUpstream = vi.fn() as unknown as typeof globalThis.fetch
    const { base, access } = await host(fetchUpstream)
    const forged = { ...access, capability: 'f'.repeat(64) }
    expect((await fetch(downloadUrl(base, forged))).status).toBe(403)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('does not expose upstream bytes until the full body matches its declared digest', async () => {
    const bytes = Buffer.from('corrupt-package')
    const fetchUpstream = vi.fn(async () => new Response(bytes, {
      status: 200, headers: {
        'content-type': 'application/zip', 'content-length': String(bytes.length),
        'x-qingmu-package-sha256': '9'.repeat(64), 'x-qingmu-package-size': String(bytes.length),
      },
    })) as unknown as typeof globalThis.fetch
    const { base, access } = await host(fetchUpstream)
    const response = await fetch(downloadUrl(base, access))
    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ code: 'editorial_handoff_download_failed' })
  })

  it('recovers terminal status from the private state file after Host restart', async () => {
    const bytes = Buffer.from('restart-stable-package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
    } })) as unknown as typeof globalThis.fetch
    const { base, access, stateFile } = await host(fetchUpstream)
    expect((await fetch(downloadUrl(base, access))).status).toBe(200)
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toHaveLength(1)
    const recovered = new EditorialHandoffDownloadAuthorizer(stateFile)
    expect(recovered.status({
      authenticatedUserId: 'writer-user',
      projectId: 'project-e8', episodeId: 'episode-e8', requestId: access.requestId,
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
    }, access.capability)).toMatchObject({ state: 'succeeded', sha256: digest, size: bytes.length })
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('fails a previously running request closed after Host restart', async () => {
    const fetchUpstream = vi.fn() as unknown as typeof globalThis.fetch
    const { access, stateFile } = await host(fetchUpstream)
    const running = JSON.parse(await readFile(stateFile, 'utf8')) as Array<Record<string, unknown>>
    const entry = running[0]
    if (entry === undefined) throw new Error('authorized download entry is required')
    entry.status = { state: 'running', createdAt: Date.now() }
    await writeFile(stateFile, JSON.stringify(running), { mode: 0o600 })

    const recovered = new EditorialHandoffDownloadAuthorizer(stateFile)

    expect(recovered.status({
      authenticatedUserId: 'writer-user',
      projectId: 'project-e8', episodeId: 'episode-e8', requestId: access.requestId,
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
    }, access.capability)).toMatchObject({ state: 'failed', errorCode: 'host_restarted' })
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('binds capability consumption and terminal recovery to the Writer-authenticated user', async () => {
    let userId = 'writer-user'
    const bytes = Buffer.from('identity-bound-package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
    } })) as unknown as typeof globalThis.fetch
    const { base, access, stateFile } = await host(fetchUpstream, 'host-token', () => userId)
    userId = 'different-user'
    expect((await fetch(downloadUrl(base, access))).status).toBe(403)
    expect((await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))).status).toBe(403)
    expect(fetchUpstream).not.toHaveBeenCalled()
    userId = 'writer-user'
    const download = await fetch(downloadUrl(base, access))
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
    const terminal = await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))
    expect(await terminal.json()).toMatchObject({ status: 'succeeded', sha256: digest })
    const recovered = new EditorialHandoffDownloadAuthorizer(stateFile)
    expect(recovered.status({
      authenticatedUserId: 'writer-user',
      projectId: 'project-e8', episodeId: 'episode-e8', requestId: access.requestId,
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
    }, access.capability)).toMatchObject({ state: 'succeeded', sha256: digest })
  })
})
