import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
const EDITORIAL_KEY = 'editorial-host-test-key-at-least-32-bytes'
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
  prepareRoot?: (root: string) => Promise<void>,
  editorialKey = EDITORIAL_KEY,
) {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'qingmu-download-test-'))
  await prepareRoot?.(temporaryRoot)
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
    readEditorialHandoffKey: () => editorialKey, authorizer, temporaryRoot,
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
  return { base: `http://127.0.0.1:${String(address.port)}`, access, stateFile, authorizer, temporaryRoot }
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
    expect(await status.json()).toMatchObject({
      status: 'succeeded', sha256: digest, size: bytes.length, errorCode: null,
      importAccess: { requestId: expect.any(String), capability: expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
    expect((await fetch(downloadUrl(base, access))).status).toBe(409)
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('reselects the exact downloaded bytes once and recovers the verified consumption preview', async () => {
    const bytes = Buffer.from('deterministic-otio-package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const result = {
      schema: 'jason.qingmu-editorial-package-consumption-preview.v1',
      projectId: 'project-e8', episodeId: 'episode-e8', packageSha256: digest, packageSize: bytes.length,
      receiptMatch: true, internalValidity: true,
      currentAuthority: { matches: true, sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA, errorCode: null },
      packageBinding: { sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA },
      preview: {
        tracks: [{ name: 'Picture', kind: 'Video', clipCount: 1 }, { name: 'Dialogue', kind: 'Audio', clipCount: 1 }],
        orderedShots: [{
          order: 1, sceneId: 'scene-1', frameId: 'frame-1', frameNo: 1,
          videoRange: { start: 0, durationSec: 5, rate: 24 },
          audioRange: { start: 0, durationSec: 5, rate: 24 },
          videoPath: `media/${digest}.mp4`, audioPath: `media/${digest}.wav`,
        }],
        media: [
          { kind: 'video', path: `media/${digest}.mp4`, size: bytes.length, sha256: digest },
          { kind: 'audio', path: `media/${digest}.wav`, size: bytes.length, sha256: digest },
        ],
        unresolved: [],
      },
      readOnly: true, businessMutations: 0, providerCalls: 0,
      boundaries: { nleOpened: false, productionComplete: false, releaseReady: false, humanSignoffInferred: false },
    }
    const fetchUpstream = vi.fn(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(bytes, { status: 200, headers: {
        'content-type': 'application/zip', 'content-length': String(bytes.length),
        'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
      } })) as unknown as typeof globalThis.fetch
    const { base, access, authorizer } = await host(fetchUpstream)
    expect((await fetch(downloadUrl(base, access))).status).toBe(200)
    const terminal = await (await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))).json() as {
      importAccess: { requestId: string; capability: string }
    }
    const importQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...terminal.importAccess,
    })
    const importUrl = `${base}/api/qingmu/editorial-handoff/import?${importQuery.toString()}`
    const verified = await fetch(importUrl, {
      method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes,
    })
    expect(verified.status).toBe(200)
    expect(await verified.json()).toEqual(result)
    expect(fetchUpstream).toHaveBeenCalledTimes(2)
    const writerRequest = (fetchUpstream as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[1] as RequestInit
    const writerHeaders = new Headers(writerRequest.headers)
    expect(writerHeaders.get('x-qingmu-editorial-signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(writerHeaders.get('x-qingmu-editorial-nonce')).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(writerHeaders.get('x-qingmu-download-request-id')).toBe(access.requestId)
    expect(JSON.stringify(writerRequest)).not.toContain(EDITORIAL_KEY)
    expect((await fetch(importUrl, {
      method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes,
    })).status).toBe(200)
    expect(fetchUpstream).toHaveBeenCalledTimes(2)
    const recovered = await fetch(importUrl.replace('/import?', '/import-status?'))
    expect(await recovered.json()).toEqual({ status: 'succeeded', result, errorCode: null })
    const refreshedAccess = authorizer.issue({
      authenticatedUserId: 'writer-user', projectId: 'project-e8', episodeId: 'episode-e8',
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
    }).importAccess
    expect(refreshedAccess).toBeDefined()
    const refreshedQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...refreshedAccess,
    })
    const refreshed = await fetch(`${base}/api/qingmu/editorial-handoff/import-status?${refreshedQuery.toString()}`)
    expect(await refreshed.json()).toEqual({ status: 'succeeded', result, errorCode: null })
    expect(fetchUpstream).toHaveBeenCalledTimes(2)
  })

  it('fails closed before Writer verification when the private editorial Host key is absent', async () => {
    const bytes = Buffer.from('exact-package-bytes')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
    } })) as unknown as typeof globalThis.fetch
    const { base, access } = await host(fetchUpstream, 'host-token', () => 'writer-user', undefined, '')
    expect((await fetch(downloadUrl(base, access))).status).toBe(200)
    const terminal = await (await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))).json() as {
      importAccess: { requestId: string; capability: string }
    }
    const query = new URLSearchParams({ projectId: 'project-e8', episodeId: 'episode-e8', ...terminal.importAccess })
    const response = await fetch(`${base}/api/qingmu/editorial-handoff/import?${query.toString()}`, {
      method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes,
    })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ code: 'host_service_unavailable' })
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('rejects changed bytes, wrong scope, and switched identity before Writer verification', async () => {
    const bytes = Buffer.from('exact-package-bytes')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
    } })) as unknown as typeof globalThis.fetch
    let userId = 'writer-user'
    const { base, access } = await host(fetchUpstream, 'host-token', () => userId)
    expect((await fetch(downloadUrl(base, access))).status).toBe(200)
    const terminal = await (await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))).json() as {
      importAccess: { requestId: string; capability: string }
    }
    const query = new URLSearchParams({ projectId: 'project-e8', episodeId: 'episode-e8', ...terminal.importAccess })
    const url = `${base}/api/qingmu/editorial-handoff/import?${query.toString()}`
    const wrongScope = new URL(url)
    wrongScope.searchParams.set('projectId', 'different-project')
    expect((await fetch(wrongScope, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes })).status).toBe(403)
    userId = 'different-user'
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes })).status).toBe(403)
    userId = 'writer-user'
    const changed = Buffer.from(bytes)
    changed[0] = (changed[0] ?? 0) ^ 1
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: changed })).status).toBe(409)
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('cleans abandoned private spools on startup and recovers a running import as failed after restart', async () => {
    const bytes = Buffer.from('restart-package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
    } })) as unknown as typeof globalThis.fetch
    const setup = async (root: string) => {
      const orphan = join(root, 'qingmu-otio-import-abandoned')
      await mkdir(orphan)
      await writeFile(join(orphan, 'package.zip'), bytes)
    }
    const { base, access, stateFile, authorizer, temporaryRoot: root } = await host(
      fetchUpstream, 'host-token', () => 'writer-user', setup,
    )
    expect((await readdir(root)).some(name => name.startsWith('qingmu-otio-import-'))).toBe(false)
    expect((await fetch(downloadUrl(base, access))).status).toBe(200)
    const terminal = await (await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))).json() as {
      importAccess: { requestId: string; capability: string }
    }
    expect(authorizer.startImport(
      'writer-user', 'project-e8', 'episode-e8', terminal.importAccess.requestId, terminal.importAccess.capability,
    )).toBeTruthy()
    const recovered = new EditorialHandoffDownloadAuthorizer(stateFile)
    expect(recovered.importStatus(
      'writer-user', 'project-e8', 'episode-e8', terminal.importAccess.requestId, terminal.importAccess.capability,
    )).toEqual({ state: 'failed', createdAt: expect.any(Number), errorCode: 'host_restarted' })
  })

  it('fails a truncated upload and removes its private spool without contacting Writer', async () => {
    const bytes = Buffer.from('complete-package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchUpstream = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
    } })) as unknown as typeof globalThis.fetch
    const { base, access, temporaryRoot: root } = await host(fetchUpstream)
    expect((await fetch(downloadUrl(base, access))).status).toBe(200)
    const terminal = await (await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))).json() as {
      importAccess: { requestId: string; capability: string }
    }
    const query = new URLSearchParams({ projectId: 'project-e8', episodeId: 'episode-e8', ...terminal.importAccess })
    const response = await fetch(`${base}/api/qingmu/editorial-handoff/import?${query.toString()}`, {
      method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes.subarray(0, 3),
    })
    expect(response.status).toBe(409)
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
    expect((await readdir(root)).some(name => name.startsWith('qingmu-otio-import-'))).toBe(false)
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
