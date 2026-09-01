/** Same-origin Host download bridge for the authenticated Writer OTIO package. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const DOWNLOAD_PATH = '/api/qingmu/editorial-handoff/download'
const STATUS_PATH = '/api/qingmu/editorial-handoff/download-status'
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const REQUEST_ID = /^[a-f0-9-]{16,80}$/
const CAPABILITY = /^[a-f0-9]{64}$/
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024
const STATUS_TTL_MS = 24 * 60 * 60_000

interface DownloadBinding {
  readonly projectId: string
  readonly episodeId: string
  readonly sourceSnapshotSha256: string
  readonly projectionSha256: string
  readonly requestId: string
}

type DownloadStatus =
  | { readonly state: 'authorized'; readonly createdAt: number }
  | { readonly state: 'running'; readonly createdAt: number }
  | { readonly state: 'succeeded'; readonly createdAt: number; readonly sha256: string; readonly size: number }
  | { readonly state: 'failed'; readonly createdAt: number; readonly errorCode: string }

interface PersistedDownload extends DownloadBinding {
  readonly capabilitySha256: string
  readonly status: DownloadStatus
}

/** Browser-visible, narrowly bound capability issued only with an authenticated read projection. */
export interface EditorialHandoffDownloadAccess {
  readonly requestId: string
  readonly capability: string
}

/** Durable Host-side capability and terminal-status store; it contains no Writer token. */
export class EditorialHandoffDownloadAuthorizer {
  readonly #entries = new Map<string, PersistedDownload>()

  public constructor(private readonly stateFile: string) {
    this.#load()
  }

  /**
   * Issue one capability bound to the exact current handoff projection.
   * @param binding - Authenticated project, episode, source, and projection identity.
   * @returns A one-use browser capability whose clear value is not persisted.
   */
  public issue(binding: Omit<DownloadBinding, 'requestId'>): EditorialHandoffDownloadAccess {
    this.#sweep()
    const requestId = randomUUID()
    const capability = randomBytes(32).toString('hex')
    this.#entries.set(requestId, {
      ...binding,
      requestId,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: { state: 'authorized', createdAt: Date.now() },
    })
    this.#persist()
    return { requestId, capability }
  }

  /**
   * Read a capability's current status without changing it.
   * @param binding - Exact projection and request identity.
   * @param capability - Clear one-use capability returned by `issue`.
   * @returns Current status, or undefined when authentication or binding fails.
   */
  public status(binding: DownloadBinding, capability: string): DownloadStatus | undefined {
    this.#sweep()
    const entry = this.#authenticated(binding, capability)
    return entry?.status
  }

  /**
   * Atomically consume an authorized capability before any Writer request.
   * @param binding - Exact projection and request identity.
   * @param capability - Clear one-use capability returned by `issue`.
   * @returns True only for the first authenticated start.
   */
  public start(binding: DownloadBinding, capability: string): boolean {
    this.#sweep()
    const entry = this.#authenticated(binding, capability)
    if (entry?.status.state !== 'authorized') return false
    this.#entries.set(binding.requestId, {
      ...entry,
      status: { state: 'running', createdAt: entry.status.createdAt },
    })
    this.#persist()
    return true
  }

  /**
   * Persist a terminal result for later status recovery.
   * @param binding - Exact projection and request identity.
   * @param status - Verified success facts or a stable failure code.
   */
  public finish(binding: DownloadBinding, status: Extract<DownloadStatus, { state: 'succeeded' | 'failed' }>): void {
    const entry = this.#entries.get(binding.requestId)
    if (entry === undefined || !sameBinding(entry, binding)) return
    this.#entries.set(binding.requestId, { ...entry, status })
    this.#persist()
  }

  #authenticated(binding: DownloadBinding, capability: string): PersistedDownload | undefined {
    if (!CAPABILITY.test(capability)) return undefined
    const entry = this.#entries.get(binding.requestId)
    if (entry === undefined || !sameBinding(entry, binding)) return undefined
    const actual = Buffer.from(createHash('sha256').update(capability).digest('hex'))
    const expected = Buffer.from(entry.capabilitySha256)
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? entry : undefined
  }

  #sweep(): void {
    const threshold = Date.now() - STATUS_TTL_MS
    let changed = false
    for (const [id, entry] of this.#entries) {
      if (entry.status.createdAt < threshold) {
        this.#entries.delete(id)
        changed = true
      }
    }
    if (changed) this.#persist()
  }

  #load(): void {
    if (!existsSync(this.stateFile)) return
    const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error('editorial handoff: download state is invalid')
    let recoveredRunning = false
    for (const value of raw) {
      if (!validPersisted(value)) throw new Error('editorial handoff: download state is invalid')
      if (value.status.state === 'running') {
        recoveredRunning = true
        this.#entries.set(value.requestId, { ...value, status: {
          state: 'failed', createdAt: Date.now(), errorCode: 'host_restarted',
        } })
      } else {
        this.#entries.set(value.requestId, value)
      }
    }
    if (recoveredRunning) this.#persist()
    this.#sweep()
  }

  #persist(): void {
    const parent = dirname(this.stateFile)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const temporary = `${this.stateFile}.${process.pid.toString()}.${randomUUID()}.tmp`
    const descriptor = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(descriptor, JSON.stringify([...this.#entries.values()]), 'utf8')
    } finally {
      closeSync(descriptor)
    }
    renameSync(temporary, this.stateFile)
    chmodSync(this.stateFile, 0o600)
  }
}

/** Private dependencies supplied by the Host process for Writer package downloads. */
export interface EditorialHandoffDownloadDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
  readonly readToken: () => string | undefined
  readonly authorizer: EditorialHandoffDownloadAuthorizer
  readonly temporaryRoot?: string
}

function sameBinding(left: DownloadBinding, right: DownloadBinding): boolean {
  return left.projectId === right.projectId && left.episodeId === right.episodeId
    && left.sourceSnapshotSha256 === right.sourceSnapshotSha256
    && left.projectionSha256 === right.projectionSha256 && left.requestId === right.requestId
}

function validPersisted(value: unknown): value is PersistedDownload {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const status = item.status
  if (!safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    || !safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    || typeof item.sourceSnapshotSha256 !== 'string' || !SHA256.test(item.sourceSnapshotSha256)
    || typeof item.projectionSha256 !== 'string' || !SHA256.test(item.projectionSha256)
    || typeof item.requestId !== 'string' || !REQUEST_ID.test(item.requestId)
    || typeof item.capabilitySha256 !== 'string' || !SHA256.test(item.capabilitySha256)
    || typeof status !== 'object' || status === null) return false
  const state = status as Record<string, unknown>
  if (typeof state.createdAt !== 'number' || !Number.isSafeInteger(state.createdAt) || state.createdAt < 0) return false
  if (state.state === 'authorized' || state.state === 'running') return Object.keys(state).length === 2
  if (state.state === 'succeeded') {
    return typeof state.sha256 === 'string' && SHA256.test(state.sha256)
      && typeof state.size === 'number' && Number.isSafeInteger(state.size) && state.size > 0
  }
  return state.state === 'failed' && typeof state.errorCode === 'string' && state.errorCode.length > 0
}

function privateHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'cache-control': 'private, no-store, max-age=0',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
    ...extra,
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, privateHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
  }))
  res.end(bytes)
}

function validToken(value: string | undefined): string | undefined {
  const token = value?.trim()
  return token !== undefined && token.length > 0 && token.length <= 8192
    && !/[\r\n]/.test(token) ? token : undefined
}

function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://loopback.invalid').searchParams
}

function exactParams(params: URLSearchParams, names: readonly string[]): boolean {
  const keys = [...params.keys()]
  return keys.length === names.length && names.every(name => params.getAll(name).length === 1)
}

function safeIdentifier(value: string | null): value is string {
  return value !== null && IDENTIFIER.test(value)
}

const BINDING_PARAMS = [
  'projectId',
  'episodeId',
  'sourceSnapshotSha256',
  'projectionSha256',
  'requestId',
  'capability',
] as const

function downloadBinding(params: URLSearchParams): {
  readonly binding: DownloadBinding
  readonly capability: string
} | undefined {
  if (!exactParams(params, BINDING_PARAMS)) return undefined
  const projectId = params.get('projectId')
  const episodeId = params.get('episodeId')
  const sourceSnapshotSha256 = params.get('sourceSnapshotSha256')
  const projectionSha256 = params.get('projectionSha256')
  const requestId = params.get('requestId')
  const capability = params.get('capability')
  if (!safeIdentifier(projectId) || !safeIdentifier(episodeId)
    || sourceSnapshotSha256 === null || !SHA256.test(sourceSnapshotSha256)
    || projectionSha256 === null || !SHA256.test(projectionSha256)
    || requestId === null || !REQUEST_ID.test(requestId)
    || capability === null || !CAPABILITY.test(capability)) return undefined
  return {
    binding: { projectId, episodeId, sourceSnapshotSha256, projectionSha256, requestId },
    capability,
  }
}

function statusBody(status: DownloadStatus | undefined): Record<string, unknown> {
  if (status === undefined) return { status: 'not_found', sha256: null, size: null, errorCode: null }
  if (status.state === 'authorized') return { status: 'not_started', sha256: null, size: null, errorCode: null }
  if (status.state === 'running') return { status: 'running', sha256: null, size: null, errorCode: null }
  if (status.state === 'succeeded') {
    return { status: 'succeeded', sha256: status.sha256, size: status.size, errorCode: null }
  }
  return { status: 'failed', sha256: null, size: null, errorCode: status.errorCode }
}

/**
 * Register the private loopback download and status routes.
 *
 * @param webServer - Host-only loopback web server.
 * @param dependencies - Writer endpoint, authenticated fetch, and private token lookup.
 * @returns A disposer that unregisters both routes and clears transient status.
 */
export function registerEditorialHandoffDownload(
  webServer: WebServer,
  dependencies: EditorialHandoffDownloadDependencies,
): () => void {
  const disposeStatus = webServer.register({
    kind: 'exact', path: STATUS_PATH, handler: (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      const params = query(req)
      const access = downloadBinding(params)
      if (access === undefined) {
        json(res, 400, { code: 'editorial_handoff_download_request_invalid' })
        return
      }
      const status = dependencies.authorizer.status(access.binding, access.capability)
      if (status === undefined) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      json(res, 200, statusBody(status))
    },
  })
  const disposeDownload = webServer.register({
    kind: 'exact', path: DOWNLOAD_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      const params = query(req)
      const access = downloadBinding(params)
      if (access === undefined) {
        json(res, 400, { code: 'editorial_handoff_download_request_invalid' })
        return
      }
      const { binding, capability } = access
      if (!dependencies.authorizer.start(binding, capability)) {
        const status = dependencies.authorizer.status(binding, capability)
        json(res, status === undefined ? 403 : 409, {
          code: status === undefined
            ? 'editorial_handoff_download_forbidden'
            : 'editorial_handoff_download_request_reused',
        })
        return
      }
      const token = validToken(dependencies.readToken())
      if (token === undefined) {
        dependencies.authorizer.finish(binding, {
          state: 'failed', createdAt: Date.now(), errorCode: 'authentication_required',
        })
        json(res, 503, { code: 'editorial_handoff_download_unavailable' })
        return
      }
      const upstream = new URL(
        `/api/qingmu/projects/${encodeURIComponent(binding.projectId)}/episodes/${encodeURIComponent(binding.episodeId)}/editorial-handoff/download`,
        dependencies.baseUrl,
      )
      upstream.searchParams.set('sourceSnapshotSha256', binding.sourceSnapshotSha256)
      upstream.searchParams.set('projectionSha256', binding.projectionSha256)
      const controller = new AbortController()
      const cancel = (): void => { if (!res.writableEnded) controller.abort() }
      res.once('close', cancel)
      let temporaryDirectory: string | undefined
      try {
        const response = await dependencies.fetch(upstream, {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { authorization: `Bearer ${token}`, accept: 'application/zip' },
        })
        const declaredSha = response.headers.get('x-qingmu-package-sha256')
        const declaredSizeText = response.headers.get('x-qingmu-package-size')
          ?? response.headers.get('content-length')
        const declaredSize = declaredSizeText === null ? Number.NaN : Number(declaredSizeText)
        if (!response.ok || response.body === null || declaredSha === null || !SHA256.test(declaredSha)
          || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > MAX_PACKAGE_BYTES
          || response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/zip') {
          dependencies.authorizer.finish(binding, {
            state: 'failed', createdAt: Date.now(),
            errorCode: response.status === 409 ? 'source_stale' : 'package_contract_failed',
          })
          json(res, response.status === 409 ? 409 : 502, { code: 'editorial_handoff_download_failed' })
          return
        }
        temporaryDirectory = await mkdtemp(join(dependencies.temporaryRoot ?? tmpdir(), 'qingmu-otio-'))
        const temporaryPath = join(temporaryDirectory, 'package.zip')
        const output = await open(temporaryPath, 'wx', 0o600)
        const digest = createHash('sha256')
        const reader = response.body.getReader()
        let size = 0
        try {
          while (true) {
            const result = await reader.read()
            if (result.done) break
            size += result.value.byteLength
            if (size > declaredSize || size > MAX_PACKAGE_BYTES) throw new Error('package_size_mismatch')
            digest.update(result.value)
            let offset = 0
            while (offset < result.value.byteLength) {
              const written = await output.write(
                result.value, offset, result.value.byteLength - offset, null,
              )
              offset += written.bytesWritten
            }
          }
        } finally {
          await output.close()
        }
        if (size !== declaredSize || digest.digest('hex') !== declaredSha) throw new Error('package_digest_mismatch')
        res.writeHead(200, privateHeaders({
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="qingmu-editorial-handoff.otio.zip"',
          'content-length': String(declaredSize),
          'x-qingmu-package-sha256': declaredSha,
          'x-qingmu-package-size': String(declaredSize),
        }))
        for await (const chunk of createReadStream(temporaryPath)) {
          if (!res.write(chunk)) await once(res, 'drain')
        }
        dependencies.authorizer.finish(binding, {
          state: 'succeeded', createdAt: Date.now(), sha256: declaredSha, size,
        })
        res.end()
      } catch (error) {
        dependencies.authorizer.finish(binding, {
          state: 'failed', createdAt: Date.now(),
          errorCode: error instanceof DOMException && error.name === 'AbortError'
            ? 'download_cancelled' : 'package_stream_failed',
        })
        if (res.headersSent) res.destroy()
        else json(res, 502, { code: 'editorial_handoff_download_failed' })
      } finally {
        res.off('close', cancel)
        if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  })
  return () => {
    disposeDownload()
    disposeStatus()
  }
}
