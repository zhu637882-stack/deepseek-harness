/**
 * On-disk access to the two capsule files of the director experience channel:
 * the review queue the director's submission tool appends to, and the active
 * store the persona reads.
 *
 * Both files live in the harness runtime root and both are written from this
 * Node process — by the submission tool and by the operator's promotion route —
 * so every read-modify-write runs through {@link withCapsuleStoreLock} and
 * every write lands by rename. Without the lock a promotion would rewrite the
 * queue from a copy read before the director's concurrent append and silently
 * drop that lesson; without the rename a torn active store would make
 * {@link loadActiveCapsules} contribute no capsule at all to that turn.
 *
 * The out-of-process operators (`python/promote_experience_capsules.py`,
 * `python/seed_experience_capsules.py`) cannot take this lock. They run at
 * deploy time, when no director session is submitting.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseActiveCapsules, type ActiveCapsule, type QueuedCapsule } from './experience-capsule-store.ts'

/**
 * Capsule id accepted on both sides of the channel.
 *
 * The submission tool invents the id, so the pattern bounds what a promotion
 * request, a queue entry and a rendered persona line can contain.
 */
export const CAPSULE_ID = /^[A-Za-z0-9_-]{3,32}$/u

/**
 * Largest capsule file this process reads.
 *
 * Bounds one browser response and one in-memory merge: the queue is pruned only
 * by age, so a director submitting on every turn could otherwise grow it past
 * what an operator panel should render. 1 MiB holds roughly a thousand
 * capsules, an order of magnitude above the 30-day queue the tool keeps.
 */
const MAX_FILE_BYTES = 1024 * 1024

/**
 * Raised when a capsule file cannot be read or written.
 *
 * A file that does not exist yet is the normal pre-first-write state and is not
 * an error; an unreadable, oversized, malformed or unwritable file is, and the
 * filesystem error stays available as `cause`.
 */
export class CapsuleStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CapsuleStoreError'
  }
}

let tail: Promise<unknown> = Promise.resolve()

/**
 * Run one capsule read-modify-write after every previously queued one.
 *
 * @param task - the whole read-modify-write, so no other writer in this process
 * interleaves between its read and its write. A read-only task may return its
 * value directly; the chain flattens either form.
 * @returns whatever the task resolves to.
 * @remarks A failing task never blocks the next one; the chain swallows its
 * rejection after the caller has received it.
 */
export function withCapsuleStoreLock<T>(task: () => T | Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.then(() => undefined, () => undefined)
  return run
}

/**
 * Read one capsule file, refusing anything oversized or unparseable.
 *
 * @param path - the queue or active store path.
 * @returns the parsed JSON, or undefined when the file does not exist yet.
 * @throws {CapsuleStoreError} when the file is too large or is not valid JSON.
 */
function readCapsuleFile(path: string): unknown {
  let size: number
  try {
    size = statSync(path).size
  } catch (cause) {
    // Only a missing file is the normal pre-first-write state; a permission or
    // path error means the store exists and cannot be judged, so it fails loud.
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new CapsuleStoreError(`Capsule file is unreadable: ${path}`, { cause })
  }
  if (size > MAX_FILE_BYTES) throw new CapsuleStoreError(`Capsule file exceeds ${String(MAX_FILE_BYTES)} bytes: ${path}`)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new CapsuleStoreError(`Capsule file is unreadable: ${path}`, { cause })
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (cause) {
    throw new CapsuleStoreError(`Capsule file is not valid JSON: ${path}`, { cause })
  }
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length <= limit ? value : undefined
}

/**
 * Read the review queue in stored order.
 *
 * @param path - the queue path from `capsuleQueuePathFor`.
 * @returns the well-formed queued capsules; a missing queue is empty. Entries a
 * hand edit broke are dropped, which is what the submission tool already does
 * when it next rewrites the file.
 * @throws {CapsuleStoreError} when the file is oversized or unparseable.
 */
export function loadQueuedCapsules(path: string): QueuedCapsule[] {
  const raw = readCapsuleFile(path)
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new CapsuleStoreError(`Capsule queue is not an array: ${path}`)
  const capsules: QueuedCapsule[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const value = entry as Record<string, unknown>
    const id = text(value.id, 32)
    const symptom = text(value.symptom, 400)
    const rule = text(value.rule, 400)
    if (id === undefined || !CAPSULE_ID.test(id) || symptom === undefined || rule === undefined) continue
    const submittedAt = text(value.submittedAt, 64)
    const sessionId = text(value.sessionId, 256)
    capsules.push({
      id, symptom, rule,
      ...(submittedAt === undefined ? {} : { submittedAt }),
      ...(sessionId === undefined ? {} : { sessionId }),
    })
  }
  return capsules
}

/**
 * Read the approved capsules strictly.
 *
 * The persona path treats a corrupt store as empty so the director still runs;
 * the operator panel must not, because an empty list there reads as "nothing
 * approved yet" and hides that no lesson is being injected.
 *
 * @param path - the active-store path from `capsuleActiveStorePathFor`.
 * @returns the valid capsules in stored (newest-first) order; a missing store is empty.
 * @throws {CapsuleStoreError} when the file is unreadable, oversized or not valid JSON.
 */
export function loadApprovedCapsules(path: string): ActiveCapsule[] {
  return parseActiveCapsules(readCapsuleFile(path))
}

/**
 * Replace one capsule file by rename, so a reader sees either the old or the
 * new content and never a partial write.
 *
 * @param path - the queue or active store path; its directory is created.
 * @param value - the whole next file content.
 * @throws {CapsuleStoreError} when the file cannot be written or moved into
 * place, a full disk included; the previous content is then still intact.
 */
export async function writeCapsuleFile(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, path)
  } catch (cause) {
    throw new CapsuleStoreError(`Capsule file could not be written: ${path}`, { cause })
  } finally {
    // Swallows only a leftover temporary that cannot be removed: the write
    // failure the caller must act on is already on its way.
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
