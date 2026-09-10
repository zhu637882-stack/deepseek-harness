/** Same-origin read-only bridge for Writer's catalog-owned creation style thumbnails. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

export const CREATION_STYLE_PREVIEW_PATH = '/api/qingmu/creation-style-preview'
const STYLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_BYTES = 4 * 1024 * 1024

export interface CreationStylePreviewDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

function reject(res: ServerResponse, status: number, code: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ code }))
}

function styleId(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  if ([...url.searchParams.keys()].join(',') !== 'styleId') return undefined
  const value = url.searchParams.get('styleId') ?? ''
  return STYLE_ID.test(value) ? value : undefined
}

/**
 * Register the Host-local thumbnail route. It accepts only one catalog key and cannot write project state.
 * @param webServer - Host-owned loopback server.
 * @param dependencies - Writer source and fetch implementation.
 * @returns Route disposer.
 */
export function registerCreationStylePreview(
  webServer: WebServer,
  dependencies: CreationStylePreviewDependencies,
): () => void {
  return webServer.register({
    kind: 'exact', path: CREATION_STYLE_PREVIEW_PATH, handler: async (req, res) => {
      const id = styleId(req)
      if (req.method !== 'GET' || req.headers.authorization !== undefined || !isTrustedApiRequest(req, []) || id === undefined) {
        reject(res, 400, 'creation_style_preview_request_invalid'); return
      }
      try {
        const response = await dependencies.fetch(new URL(`/images/tago-styles/${encodeURIComponent(id)}.webp`, dependencies.baseUrl), {
          headers: { accept: 'image/webp' }, redirect: 'error',
        })
        const declaredHeader = response.headers.get('content-length')
        const declared = declaredHeader === null ? undefined : Number(declaredHeader)
        const type = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase()
        if (!response.ok || type !== 'image/webp' || (declared !== undefined && (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_BYTES))) {
          reject(res, 404, 'creation_style_preview_unavailable'); return
        }
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length < 1 || bytes.length > MAX_BYTES) { reject(res, 404, 'creation_style_preview_unavailable'); return }
        res.statusCode = 200
        res.setHeader('content-type', 'image/webp')
        res.setHeader('cache-control', 'private, max-age=300')
        res.end(bytes)
      } catch { reject(res, 502, 'creation_style_preview_unavailable') }
    },
  })
}
