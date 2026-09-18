/** Shared plumbing for the same-origin browser routes that carry one human decision. */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Largest forwarded session cookie, in bytes. */
const MAX_COOKIE_BYTES = 8192

/** The Writer reports failures as snake_case identifiers, so only those are relayed. */
const WRITER_CODE = /^[a-z][a-z0-9_]{0,127}$/

/**
 * Narrow an unknown value to a JSON object.
 *
 * @param value - Parsed JSON or an upstream response body.
 * @returns True for a plain object, false for null, arrays and primitives.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the browser's own session cookie.
 *
 * @param req - Request whose `cookie` header is scanned.
 * @returns The `jason_token` cookie, or undefined when it is absent, oversized or
 * carries a control character that would let one request forge two.
 */
function sessionCookie(req: IncomingMessage): string | undefined {
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith('jason_token='))
  if (cookie === undefined || cookie.length > MAX_COOKIE_BYTES || /[\r\n]/.test(cookie)) return undefined
  return cookie
}

/**
 * Decide whether one request is a same-origin browser write presenting no service token.
 *
 * A route that writes Host state directly requires an `Origin` equal to the
 * request's own `Host` and no `Authorization` header, so a page on another origin
 * or a caller presenting a service token cannot drive it. It requires no session
 * cookie: the capsule promotion this guards writes two runtime-root files that any
 * process running as this user can already write, and a cookie the route never
 * verifies would only add a sign-in the operator's browser cannot satisfy. The
 * cookie-forwarding Writer routes add that check themselves in
 * {@link browserWriteHeaders}, where the Writer does verify the cookie.
 *
 * @param req - Request whose `host`, `origin` and `authorization` are checked.
 * @returns True for a same-origin browser post presenting no service token.
 */
export function isSameOriginBrowserWrite(req: IncomingMessage): boolean {
  const host = req.headers.host
  return typeof host === 'string' && req.headers.authorization === undefined
    && req.headers.origin === `http://${host}`
}

/**
 * Forward only the browser's own session cookie, rewritten to the upstream origin.
 *
 * Refusing anything but a same-origin browser request keeps the decision
 * attributable to the signed-in person even when the caller is a script inside the
 * same origin, and the forwarded `jason_token` cookie is the one the Writer
 * verifies against its own session store.
 *
 * @param req - Browser request whose `host`, `origin`, `authorization` and `cookie` are checked.
 * @param upstream - Resolved Writer URL that supplies the forwarded origin and host.
 * @returns Headers for the upstream call, or undefined when the request is not a same-origin browser post.
 */
export function browserWriteHeaders(req: IncomingMessage, upstream: URL): Headers | undefined {
  if (!isSameOriginBrowserWrite(req)) return undefined
  const cookie = sessionCookie(req)
  if (cookie === undefined) return undefined
  return new Headers({
    accept: 'application/json', 'content-type': 'application/json',
    cookie, origin: upstream.origin, host: upstream.host,
  })
}

/**
 * Read one JSON object body whose declared length the caller may trust.
 *
 * A body longer than its own `content-length` is refused rather than truncated:
 * the surplus would otherwise reach the Writer as a second, unvalidated request.
 *
 * @param req - Browser request to drain.
 * @param maxBytes - Largest accepted `content-length`, derived per route from the Writer's own field bounds.
 * @returns The parsed object, or undefined when the body is absent, oversized, misdeclared or not an object.
 */
export async function readJsonBody(
  req: IncomingMessage, maxBytes: number,
): Promise<Record<string, unknown> | undefined> {
  if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') return undefined
  const declared = Number(req.headers['content-length'] ?? '')
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > maxBytes) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    if (size > declared) return undefined
    chunks.push(chunk)
  }
  if (size !== declared) return undefined
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  return isRecord(parsed) ? parsed : undefined
}

/**
 * Write one JSON reply that a browser must not cache.
 *
 * @param res - Browser response to finish.
 * @param status - HTTP status code.
 * @param body - Value to serialize as the whole reply.
 */
export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Read the Writer's failure identifier out of a FastAPI `detail` body.
 *
 * Only a snake_case identifier is relayed, so an upstream message written for a
 * log cannot reach a browser as text the panel would render verbatim.
 *
 * @param value - Parsed upstream error body.
 * @returns The Writer's reason code, or undefined when it did not report one.
 */
export function writerCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const detail = value.detail
  const code = isRecord(detail) ? detail.code : detail
  return typeof code === 'string' && WRITER_CODE.test(code) ? code : undefined
}
