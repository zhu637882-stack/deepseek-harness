/** Host-private service authentication shared by Qingmu reads and commands. */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/**
 * Read the latest owner-only session for each operation without caching credentials.
 * @param sessionFile - absolute private JSON file; omission uses the environment reader.
 * @param fallback - token source for deployments without a session file.
 * @returns a reader that fails closed when a configured file is unavailable or invalid.
 */
export function createServiceTokenReader(
  sessionFile?: string,
  fallback: () => string | undefined = () => process.env.YIMENG_API_TOKEN,
): () => string | undefined {
  if (sessionFile === undefined || sessionFile === '') return fallback
  if (!isAbsolute(sessionFile)) throw new Error('Qingmu sessionFile must be an absolute path')
  return () => {
    let descriptor: number | undefined
    try {
      descriptor = openSync(sessionFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = fstatSync(descriptor)
      if (!stat.isFile() || (stat.mode & 0o077) !== 0
        || typeof process.getuid !== 'function' || stat.uid !== process.getuid()
        || stat.size < 1 || stat.size > 16_384) return undefined
      const buffer = Buffer.alloc(16_385)
      const length = readSync(descriptor, buffer, 0, buffer.length, 0)
      if (length > 16_384) return undefined
      const value: unknown = JSON.parse(buffer.subarray(0, length).toString('utf8'))
      if (value === null || typeof value !== 'object' || !('token' in value)) return undefined
      const token = value.token
      return typeof token === 'string' && token.length > 0 && !/\s/.test(token) ? token : undefined
    } catch {
      // Private-file IO and JSON failures mean unauthenticated, never stale-env fallback.
      return undefined
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
}
