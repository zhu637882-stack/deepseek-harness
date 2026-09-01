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
  writeAllSpoolBytes,
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
    const statusBody = await status.json() as {
      status: string
      sha256: string
      size: number
      errorCode: null
      importAccess: { requestId: string; capability: string }
    }
    expect(statusBody).toMatchObject({ status: 'succeeded', sha256: digest, size: bytes.length, errorCode: null })
    expect(statusBody.importAccess.requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/)
    expect(statusBody.importAccess.capability).toMatch(/^[0-9a-f]{64}$/)
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
    const masterBytes = Buffer.from('local-returned-master')
    const masterDigest = createHash('sha256').update(masterBytes).digest('hex')
    const masterResult = {
      schema: 'jason.qingmu-editorial-master-preflight.v1',
      preflightSha256: '6'.repeat(64),
      projectId: 'project-e8', episodeId: 'episode-e8',
      binding: {
        sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
        downloadRequestId: '', importRequestId: '', packageSha256: digest, packageSize: bytes.length,
      },
      master: {
        sha256: masterDigest, size: masterBytes.length, mimeType: 'video/mp4', container: 'mp4',
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec: 5, width: 720, height: 1280, fps: 24,
        videoStreams: [{ codec: 'h264', width: 720, height: 1280, fps: 24 }],
        audioStreams: [{ codec: 'aac', channels: 2, sampleRate: 48000 }], blockers: [],
      },
      checks: { currentAuthorityMatches: true, packageReceiptBound: true, containerVerified: true, probeSucceeded: true },
      blockers: [], unresolved: [], readOnly: true, businessMutations: 0, providerCalls: 0,
      boundaries: { nleOpened: false, editorConsumed: false, formalReturnRecorded: false,
        releaseReady: false, humanSignoffInferred: false },
    }
    let savedCandidate: Record<string, unknown> | undefined
    let loseCandidateResponseOnce = true
    const fetchUpstream = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(target).pathname
      if (path.endsWith('/returned-master-candidates')) {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({
            schema: 'jason.qingmu-returned-master-candidates.v1',
            projectId: 'project-e8', episodeId: 'episode-e8',
            candidates: savedCandidate === undefined ? [] : [savedCandidate],
            providerCalls: 0, stageStarted: false, approvalGranted: false,
            selectionGranted: false, releaseGranted: false, humanSignoffInferred: false,
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        const headers = new Headers(init?.headers)
        savedCandidate = {
          schema: 'jason.qingmu-returned-master-candidate-result.v1',
          projectId: 'project-e8', episodeId: 'episode-e8', assetId: 'asset_editorial_master_1',
          storageKey: `qingmu/editorial-master-candidates/project/${masterDigest}.mp4`,
          masterSha256: masterDigest, materializedSha256: masterDigest, byteSize: masterBytes.length,
          mimeType: 'video/mp4', durationSec: 5, width: 720, height: 1280, fps: 24,
          packageSha256: digest, sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
          downloadRequestId: headers.get('x-qingmu-download-request-id'),
          importRequestId: headers.get('x-qingmu-import-request-id'),
          preflightRequestId: headers.get('x-qingmu-preflight-request-id'),
          preflightSha256: headers.get('x-qingmu-preflight-sha256'),
          qualityStatus: 'pending', selectionStatus: 'Unselected', isSelected: false,
          approved: false, published: false, idempotencyKey: headers.get('x-qingmu-idempotency-key'),
          requestSha256: '7'.repeat(64), commandReceiptId: 'receipt_candidate_1',
          changeSetId: 'changeset_candidate_1', eventId: 'event_candidate_1',
          savedAt: '2026-09-01T00:00:00Z', providerCalls: 0, stageStarted: false,
          approvalGranted: false, selectionGranted: false, releaseGranted: false,
          humanSignoffInferred: false,
        }
        const response = new Response(JSON.stringify(savedCandidate), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
        if (loseCandidateResponseOnce) {
          loseCandidateResponseOnce = false
          Object.defineProperty(response, 'arrayBuffer', {
            value: async () => { throw new Error('simulated committed response loss') },
          })
        }
        return response
      }
      if (path.endsWith('/preflight-returned-master')) {
        const headers = new Headers(init?.headers)
        return new Response(JSON.stringify({
          ...masterResult,
          binding: {
            ...masterResult.binding,
            downloadRequestId: headers.get('x-qingmu-download-request-id'),
            importRequestId: headers.get('x-qingmu-import-request-id'),
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return init?.method === 'POST'
        ? new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(bytes, { status: 200, headers: {
          'content-type': 'application/zip', 'content-length': String(bytes.length),
          'x-qingmu-package-sha256': digest, 'x-qingmu-package-size': String(bytes.length),
        } })
    }) as unknown as typeof globalThis.fetch
    const { base, access, authorizer, stateFile } = await host(fetchUpstream)
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
    const recoveredBody = await recovered.json() as {
      status: string
      result: unknown
      errorCode: null
      masterAccess: { requestId: string; capability: string }
    }
    expect(recoveredBody).toMatchObject({ status: 'succeeded', result, errorCode: null })
    expect(recoveredBody.masterAccess.requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/)
    expect(recoveredBody.masterAccess.capability).toMatch(/^[0-9a-f]{64}$/)
    const masterQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...recoveredBody.masterAccess,
    })
    const masterUrl = `${base}/api/qingmu/editorial-handoff/master-preflight?${masterQuery.toString()}`
    const master = await fetch(masterUrl, {
      method: 'POST', headers: { 'content-type': 'video/mp4' }, body: masterBytes,
    })
    expect(master.status).toBe(200)
    const masterBody = await master.json() as {
      candidateAccess: { requestId: string; capability: string }
    }
    expect(masterBody).toMatchObject({
      schema: 'jason.qingmu-editorial-master-preflight.v1',
      master: { sha256: masterDigest, size: masterBytes.length },
    })
    expect(masterBody.candidateAccess.requestId).toMatch(/^[0-9a-f]{64}$/)
    expect(fetchUpstream).toHaveBeenCalledTimes(3)
    expect((await fetch(masterUrl, {
      method: 'POST', headers: { 'content-type': 'video/mp4' }, body: masterBytes,
    })).status).toBe(409)
    expect(fetchUpstream).toHaveBeenCalledTimes(3)
    const recoveredMaster = await fetch(masterUrl.replace('/master-preflight?', '/master-preflight-status?'))
    expect(await recoveredMaster.json()).toMatchObject({
      status: 'succeeded', result: { master: { sha256: masterDigest } }, errorCode: null,
    })
    const candidateQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...masterBody.candidateAccess,
    })
    const candidateUrl = `${base}/api/qingmu/editorial-handoff/returned-master-candidate?${candidateQuery.toString()}`
    const [candidate, concurrentCandidate] = await Promise.all([
      fetch(candidateUrl, {
        method: 'POST', headers: { 'content-type': 'video/mp4' }, body: masterBytes,
      }),
      fetch(candidateUrl, {
        method: 'POST', headers: { 'content-type': 'video/mp4' }, body: masterBytes,
      }),
    ])
    expect([candidate.status, concurrentCandidate.status].sort()).toEqual([409, 502])
    const unknownResponse = candidate.status === 502 ? candidate : concurrentCandidate
    expect(await unknownResponse.json()).toMatchObject({ code: 'editorial_master_candidate_submission_unknown' })
    const candidateStatus = await fetch(candidateUrl.replace(
      '/returned-master-candidate?', '/returned-master-candidate-status?',
    ))
    expect(await candidateStatus.json()).toMatchObject({
      status: 'succeeded', result: { masterSha256: masterDigest, selectionStatus: 'Unselected' },
    })
    expect((await fetch(candidateUrl, {
      method: 'POST', headers: { 'content-type': 'video/mp4' }, body: masterBytes,
    })).status).toBe(200)
    const firstImportAccess = terminal.importAccess
    const initialImportBytes = Buffer.byteLength(await readFile(`${stateFile}.imports`, 'utf8'))
    let refreshedAccess = firstImportAccess
    for (let index = 0; index < 100; index += 1) {
      const response = await fetch(downloadUrl(base, access).replace('/download?', '/download-status?'))
      const value = await response.json() as { importAccess: typeof firstImportAccess }
      refreshedAccess = value.importAccess
    }
    for (let index = 0; index < 100; index += 1) {
      refreshedAccess = authorizer.issue({
        authenticatedUserId: 'writer-user', projectId: 'project-e8', episodeId: 'episode-e8',
        sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
      }).importAccess ?? refreshedAccess
    }
    expect(refreshedAccess).toBeDefined()
    const persistedImports = await readFile(`${stateFile}.imports`, 'utf8')
    expect(Buffer.byteLength(persistedImports)).toBeLessThanOrEqual(initialImportBytes + 256)
    expect(JSON.parse(persistedImports)).toHaveLength(1)
    expect(persistedImports.match(/jason\.qingmu-editorial-package-consumption-preview\.v1/gu)).toHaveLength(1)
    const refreshedQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...refreshedAccess,
    })
    const refreshed = await fetch(`${base}/api/qingmu/editorial-handoff/import-status?${refreshedQuery.toString()}`)
    const refreshedBody = await refreshed.json() as {
      status: string
      result: unknown
      errorCode: null
      masterAccess: { requestId: string; capability: string }
    }
    expect(refreshedBody).toMatchObject({ status: 'succeeded', result, errorCode: null })
    const refreshedMasterQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...refreshedBody.masterAccess,
    })
    const refreshedMaster = await fetch(
      `${base}/api/qingmu/editorial-handoff/master-preflight-status?${refreshedMasterQuery.toString()}`,
    )
    const refreshedMasterBody = await refreshedMaster.json() as {
      candidateAccess: { requestId: string; capability: string }
    }
    expect(refreshedMasterBody).toMatchObject({
      status: 'succeeded', result: { master: { sha256: masterDigest } }, errorCode: null,
    })
    expect(refreshedMasterBody.candidateAccess.requestId).toBe(masterBody.candidateAccess.requestId)
    const refreshedCandidateQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...refreshedMasterBody.candidateAccess,
    })
    expect((await fetch(`${base}/api/qingmu/editorial-handoff/returned-master-candidate?${refreshedCandidateQuery.toString()}`, {
      method: 'POST', headers: { 'content-type': 'video/mp4' }, body: masterBytes,
    })).status).toBe(200)
    const expiredQuery = new URLSearchParams({
      projectId: 'project-e8', episodeId: 'episode-e8', ...firstImportAccess,
    })
    expect((await fetch(`${base}/api/qingmu/editorial-handoff/import-status?${expiredQuery.toString()}`)).status).toBe(403)
    expect(fetchUpstream).toHaveBeenCalledTimes(5)
  })

  it('previews and commits one formal master selection, then recovers a lost Writer response', async () => {
    const assetId = 'asset_editorial_master_1'
    const previewSha = '8'.repeat(64)
    const idempotencyKey = `e8-master-select-${'9'.repeat(32)}`
    const candidate = {
      assetId, masterSha256: 'a'.repeat(64), materializedSha256: 'a'.repeat(64), byteSize: 2048,
      mimeType: 'video/mp4', durationSec: 5, width: 720, height: 1280, fps: 24,
      packageSha256: 'b'.repeat(64), sourceSnapshotSha256: SOURCE_SHA,
      projectionSha256: PROJECTION_SHA, downloadRequestId: '1'.repeat(16),
      importRequestId: '2'.repeat(16), preflightRequestId: '3'.repeat(16),
      preflightSha256: 'c'.repeat(64), qualityStatus: 'pending', selectionStatus: 'Unselected',
      isSelected: false, assetUpdatedAt: '2026-09-01T00:00:00Z', finalOutputId: null,
      selectionReceiptId: null, selectedAt: null,
    }
    const releaseConditions = {
      ready: false,
      blockers: ['technical_qc_not_approved', 'content_approval_missing',
        'release_manifest_not_frozen', 'human_signoff_missing'],
    }
    const flags = {
      providerCalls: 0, stageStarted: false, approvalGranted: false,
      releaseGranted: false, humanSignoffInferred: false,
    }
    const preview = {
      schema: 'jason.qingmu-returned-master-selection-preview.v1',
      projectId: 'project-e8', episodeId: 'episode-e8', candidate, currentFormalMaster: null,
      selectionRevision: 0, previewSha256: previewSha, idempotencyKey, canConfirm: true,
      hardBlockers: [], releaseConditions,
      impact: {
        promoteExistingCandidateInPlace: true, mediaCopies: 0,
        revokePreviousFormalSelection: false, qualityApprovalGranted: false,
        releaseGranted: false, humanSignoffInferred: false,
      },
      ...flags,
    }
    const requestSha = createHash('sha256').update(
      `{"assetId":"${assetId}","previewSha256":"${previewSha}"}`,
    ).digest('hex')
    const result = {
      schema: 'jason.qingmu-returned-master-selection-result.v1',
      projectId: 'project-e8', episodeId: 'episode-e8', assetId,
      finalOutputId: 'final_editorial_master_1', masterSha256: candidate.masterSha256,
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
      preflightSha256: candidate.preflightSha256, packageSha256: candidate.packageSha256,
      selectionStatus: 'Selected', isSelected: true, qualityStatus: 'pending',
      selectionRevision: 1, releaseAuthorityRevision: 1,
      previousFormalAssetId: null, previousFinalOutputId: null, selectedBy: 'writer-user',
      mediaCopies: 0, releaseConditions, idempotencyKey, requestSha256: requestSha,
      commandReceiptId: 'receipt_selection_1', changeSetId: 'changeset_selection_1',
      eventId: 'event_selection_1', selectedAt: '2026-09-01T00:00:01Z', ...flags,
    }
    let selectionPosts = 0
    const fetchUpstream = vi.fn(async (input: string | URL | Request) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(target)
      if (url.pathname.endsWith('/returned-master-selection-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-selection-status.v1',
          projectId: 'project-e8', episodeId: 'episode-e8', selectionRevision: 0,
          releaseAuthority: {
            schema: 'jason.episode-release-authority.v2', revision: 0,
            currentFinalOutputId: null, currentFinalAssetId: null,
            acceptedFinalOutputId: null, acceptedFinalAssetId: null,
            acceptedFinalSha256: null, acceptedReadinessToken: null,
          },
          currentFormalMaster: null, candidates: [candidate], releaseConditions, ...flags,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.endsWith('/returned-master-selection-preview')) {
        return new Response(JSON.stringify(preview), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.pathname.endsWith('/returned-master-selections')) {
        selectionPosts += 1
        const response = new Response(JSON.stringify(result), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
        Object.defineProperty(response, 'arrayBuffer', {
          value: async () => { throw new Error('simulated committed response loss') },
        })
        return response
      }
      if (url.pathname.includes('/returned-master-selections/')) {
        expect(url.searchParams.get('requestSha256')).toBe(requestSha)
        return new Response(JSON.stringify(result), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const { base } = await host(fetchUpstream)
    const scope = new URLSearchParams({ projectId: 'project-e8', episodeId: 'episode-e8' })
    const status = await fetch(`${base}/api/qingmu/editorial-handoff/returned-master-selection-status?${scope.toString()}`)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ currentFormalMaster: null, candidates: [{ assetId }] })
    const previewResponse = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-selection-preview?${scope.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId }) },
    )
    expect(previewResponse.status).toBe(200)
    expect(await previewResponse.json()).toMatchObject({ canConfirm: true, previewSha256: previewSha })
    const confirm = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-selection?${scope.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        assetId, previewSha256: previewSha, idempotencyKey,
      }) },
    )
    expect(confirm.status).toBe(200)
    expect(await confirm.json()).toEqual(result)
    expect(selectionPosts).toBe(1)
    const malformed = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-selection?${scope.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId }) },
    )
    expect(malformed.status).toBe(400)
    expect(selectionPosts).toBe(1)
  })

  it('runs technical QC through the bound formal master and recovers one committed receipt', async () => {
    const previewSha256 = 'd'.repeat(64)
    const idempotencyKey = `e8-master-qc-${'e'.repeat(32)}`
    const releaseConditions = {
      ready: false,
      blockers: ['content_approval_missing', 'release_manifest_not_frozen', 'human_signoff_missing'],
    }
    const flags = {
      providerCalls: 0, stageStarted: false, approvalGranted: false,
      releaseGranted: false, manifestFrozen: false, humanSignoffInferred: false,
    }
    const releaseAuthority = {
      schema: 'jason.episode-release-authority.v2', revision: 2,
      currentFinalAssetId: 'asset_editorial_master_1', currentFinalOutputId: 'final_editorial_master_1',
      acceptedFinalAssetId: null, acceptedFinalOutputId: null, acceptedFinalSha256: null,
      acceptedReadinessToken: null,
    }
    const currentFormalMaster = {
      projectId: 'project-e8', episodeId: 'episode-e8',
      assetId: 'asset_editorial_master_1', finalOutputId: 'final_editorial_master_1',
      assetRole: 'b7_final', selectionStatus: 'Selected', qualityStatus: 'passed',
      masterSha256: 'a'.repeat(64), materializedSha256: 'a'.repeat(64),
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
      selectionSourceSha256: '3'.repeat(64), packageSha256: '4'.repeat(64),
      preflightSha256: '5'.repeat(64), selectionReceiptId: 'receipt_selection_1',
      selectionReceiptSha256: '7'.repeat(64), candidateReceiptId: 'receipt_candidate_1',
      candidateReceiptSha256: '8'.repeat(64), releaseAuthority,
      projectAspectRatio: '9:16',
    }
    const currentEditorialContract = {
      sourceSnapshotSha256: '9'.repeat(64), projectionSha256: 'a'.repeat(64),
      selectionSourceSha256: '3'.repeat(64), projectAspectRatio: '9:16',
      deliveryProfileSha256: 'b'.repeat(64),
      probeContractVersion: 'returned-master-technical-qc-probe-v1',
    }
    const previewMaster = {
      ...currentFormalMaster, qualityStatus: 'pending',
      releaseAuthority: { ...releaseAuthority, revision: 1 },
    }
    const preview = {
      schema: 'jason.qingmu-returned-master-technical-qc-preview.v1',
      projectId: 'project-e8', episodeId: 'episode-e8', currentFormalMaster: previewMaster,
      currentEditorialContract,
      previewSha256, idempotencyKey, canConfirm: true, hardBlockers: [], ...flags,
    }
    const requestSha256 = createHash('sha256')
      .update(`{"previewSha256":"${previewSha256}"}`).digest('hex')
    const result = {
      schema: 'jason.qingmu-returned-master-technical-qc-result.v1',
      projectId: 'project-e8', episodeId: 'episode-e8',
      assetId: currentFormalMaster.assetId, finalOutputId: currentFormalMaster.finalOutputId,
      masterSha256: currentFormalMaster.masterSha256, sourceSnapshotSha256: SOURCE_SHA,
      projectionSha256: PROJECTION_SHA, selectionSourceSha256: '3'.repeat(64),
      editorialSourceSnapshotSha256: currentEditorialContract.sourceSnapshotSha256,
      editorialProjectionSha256: currentEditorialContract.projectionSha256,
      projectAspectRatio: '9:16', deliveryProfileSha256: 'b'.repeat(64),
      probeContractVersion: 'returned-master-technical-qc-probe-v1',
      packageSha256: '4'.repeat(64), preflightSha256: '5'.repeat(64),
      selectionReceiptId: 'receipt_selection_1', outcome: 'passed', qualityStatus: 'passed',
      canonicalResultSha256: '6'.repeat(64), technicalFacts: {
        container: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec: 5, width: 720, height: 1280,
        fps: '24/1', videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac',
        hasVideo: true, hasAudio: true, byteSize: 2048,
        materializedSha256: currentFormalMaster.masterSha256,
      }, checks: [], uncertainty: [],
      probeTool: { kind: 'ffprobe', binary: 'ffprobe', service: 'MediaProbeService' },
      releaseAuthorityRevisionAtStart: 1, releaseAuthorityRevision: 2,
      releaseConditions, idempotencyKey, requestSha256,
      commandReceiptId: 'receipt_qc_1', changeSetId: 'changeset_qc_1', eventId: 'event_qc_1',
      recordedAt: '2026-09-01T00:00:02Z', ...flags,
    }
    const status = {
      schema: 'jason.qingmu-returned-master-technical-qc-status.v1',
      projectId: 'project-e8', episodeId: 'episode-e8', currentFormalMaster,
      currentTechnicalQc: result, currentEditorialContract, staleTechnicalQc: null,
      records: [result], hardBlockers: [], releaseConditions, ...flags,
    }
    let statusPayload: unknown = status
    let confirmPosts = 0
    let recoveryGets = 0
    let confirmMode: 'lost-response' | 'stale' = 'lost-response'
    const fetchUpstream = vi.fn(async (input: string | URL | Request) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(target)
      if (url.pathname.endsWith('/returned-master-technical-qc-status')) {
        return new Response(JSON.stringify(statusPayload), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.pathname.endsWith('/returned-master-technical-qc-preview')) {
        return new Response(JSON.stringify(preview), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.pathname.endsWith('/returned-master-technical-qc')) {
        confirmPosts += 1
        if (confirmMode === 'stale') {
          return new Response(JSON.stringify({
            detail: { code: 'returned_master_qc_editorial_binding_drift' },
          }), { status: 409, headers: { 'content-type': 'application/json' } })
        }
        const response = new Response(JSON.stringify(result), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
        Object.defineProperty(response, 'arrayBuffer', {
          value: async () => { throw new Error('simulated committed response loss') },
        })
        return response
      }
      if (url.pathname.includes('/returned-master-technical-qc/')) {
        recoveryGets += 1
        expect(url.searchParams.get('requestSha256')).toBe(requestSha256)
        return new Response(JSON.stringify(result), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const { base } = await host(fetchUpstream)
    const scope = new URLSearchParams({ projectId: 'project-e8', episodeId: 'episode-e8' })

    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(200)
    const previewResponse = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-preview?${scope.toString()}`,
      { method: 'POST' },
    )
    expect(previewResponse.status).toBe(200)
    expect(await previewResponse.json()).toMatchObject({ previewSha256, canConfirm: true })
    const confirm = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc?${scope.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        previewSha256, idempotencyKey,
      }) },
    )
    expect(confirm.status).toBe(200)
    expect(await confirm.json()).toEqual(result)
    expect(confirmPosts).toBe(1)
    expect(recoveryGets).toBe(1)

    confirmMode = 'stale'
    const staleReplay = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc?${scope.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        previewSha256, idempotencyKey,
      }) },
    )
    expect(staleReplay.status).toBe(409)
    expect(confirmPosts).toBe(2)
    expect(recoveryGets).toBe(1)

    statusPayload = {
      ...status,
      currentTechnicalQc: { ...result, projectId: 'project-cross-scope' },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(502)
    statusPayload = {
      ...status,
      currentTechnicalQc: {
        ...result,
        technicalFacts: { ...result.technicalFacts, materializedSha256: '9'.repeat(64) },
      },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(502)
    statusPayload = {
      ...status,
      currentFormalMaster: {
        ...currentFormalMaster,
        releaseAuthority: {
          ...releaseAuthority,
          acceptedFinalAssetId: currentFormalMaster.assetId,
        },
      },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(502)
    statusPayload = {
      ...status,
      currentTechnicalQc: null,
      staleTechnicalQc: {
        stale: true,
        code: 'returned_master_qc_editorial_binding_drift',
        commandReceiptId: result.commandReceiptId,
        driftFields: ['projectAspectRatio'],
      },
      currentEditorialContract: { ...currentEditorialContract, projectAspectRatio: '16:9' },
      currentFormalMaster: { ...currentFormalMaster, projectAspectRatio: '16:9' },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(200)
    statusPayload = {
      ...status,
      currentEditorialContract: { ...currentEditorialContract, deliveryProfileSha256: 'c'.repeat(64) },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(502)
    statusPayload = {
      ...status,
      currentFormalMaster: { ...currentFormalMaster, qualityStatus: 'failed' },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(502)
    statusPayload = {
      ...status,
      currentFormalMaster: { ...currentFormalMaster, qualityStatus: 'failed' },
      currentTechnicalQc: {
        ...result, outcome: 'failed', qualityStatus: 'failed', checks: ['final_audio_stream_missing'],
      },
    }
    expect((await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${scope.toString()}`,
    )).status).toBe(502)
    statusPayload = status

    const malformed = await fetch(
      `${base}/api/qingmu/editorial-handoff/returned-master-technical-qc?${scope.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        previewSha256,
      }) },
    )
    expect(malformed.status).toBe(400)
    expect(confirmPosts).toBe(2)
  })

  it('writes every upload byte when the spool writer reports partial progress', async () => {
    const stored: number[] = []
    const writer = {
      async write(bytes: Uint8Array, offset: number, length: number) {
        const accepted = Math.min(2, length)
        stored.push(...bytes.subarray(offset, offset + accepted))
        return { bytesWritten: accepted, buffer: bytes }
      },
    }
    const input = Buffer.from('partial-write-proof')
    await writeAllSpoolBytes(writer, input)
    expect(Buffer.from(stored)).toEqual(input)
  })

  it('keeps distinct package receipts in separate canonical import records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingmu-import-receipts-'))
    try {
      const stateFile = join(root, 'downloads.json')
      const authorizer = new EditorialHandoffDownloadAuthorizer(stateFile)
      const binding = {
        authenticatedUserId: 'writer-user', projectId: 'project-e8', episodeId: 'episode-e8',
        sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
      }
      const first = authorizer.issue(binding)
      const firstBinding = { ...binding, requestId: first.requestId }
      expect(authorizer.start(firstBinding, first.capability)).toBe(true)
      authorizer.finish(firstBinding, {
        state: 'succeeded', createdAt: Date.now(), sha256: '3'.repeat(64), size: 3,
      })
      expect(authorizer.issueImport(firstBinding, first.capability)).toBeDefined()

      const second = authorizer.issue(binding)
      const secondBinding = { ...binding, requestId: second.requestId }
      expect(authorizer.start(secondBinding, second.capability)).toBe(true)
      authorizer.finish(secondBinding, {
        state: 'succeeded', createdAt: Date.now() + 1, sha256: '4'.repeat(64), size: 4,
      })
      expect(authorizer.issueImport(secondBinding, second.capability)).toBeDefined()

      const persisted = JSON.parse(await readFile(`${stateFile}.imports`, 'utf8')) as Array<{
        packageSha256: string
      }>
      expect(persisted).toHaveLength(2)
      expect(new Set(persisted.map(entry => entry.packageSha256))).toEqual(
        new Set(['3'.repeat(64), '4'.repeat(64)]),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('expires import capabilities when only import status is read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingmu-import-ttl-'))
    try {
      const stateFile = join(root, 'downloads.json')
      const authorizer = new EditorialHandoffDownloadAuthorizer(stateFile)
      const binding = {
        authenticatedUserId: 'writer-user', projectId: 'project-e8', episodeId: 'episode-e8',
        sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
      }
      const download = authorizer.issue(binding)
      const downloadBinding = { ...binding, requestId: download.requestId }
      expect(authorizer.start(downloadBinding, download.capability)).toBe(true)
      authorizer.finish(downloadBinding, {
        state: 'succeeded', createdAt: Date.now(), sha256: '5'.repeat(64), size: 5,
      })
      const access = authorizer.issueImport(downloadBinding, download.capability)
      expect(access).toBeDefined()
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 25 * 60 * 60_000)
      try {
        expect(authorizer.importStatus(
          'writer-user', 'project-e8', 'episode-e8',
          access?.requestId ?? '', access?.capability ?? '',
        )).toBeUndefined()
      } finally {
        clock.mockRestore()
      }
      expect(JSON.parse(await readFile(`${stateFile}.imports`, 'utf8'))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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
    const recoveredStatus = recovered.importStatus(
      'writer-user', 'project-e8', 'episode-e8', terminal.importAccess.requestId, terminal.importAccess.capability,
    )
    expect(recoveredStatus).toMatchObject({ state: 'failed', errorCode: 'host_restarted' })
    expect(typeof recoveredStatus?.createdAt).toBe('number')
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
    const statusUrl = downloadUrl(base, access).replace('/download?', '/download-status?')
    await expect.poll(async () => {
      const terminal = await fetch(statusUrl)
      return await terminal.json() as unknown
    }).toMatchObject({ status: 'succeeded', sha256: digest })
    const recovered = new EditorialHandoffDownloadAuthorizer(stateFile)
    expect(recovered.status({
      authenticatedUserId: 'writer-user',
      projectId: 'project-e8', episodeId: 'episode-e8', requestId: access.requestId,
      sourceSnapshotSha256: SOURCE_SHA, projectionSha256: PROJECTION_SHA,
    }, access.capability)).toMatchObject({ state: 'succeeded', sha256: digest })
  })
})
