import type { LocalReferenceUploadRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export interface SavedLocalReferenceInput {
  readonly request: LocalReferenceUploadRequest
  readonly pending: boolean
}

export interface RestoredLocalReferenceInput {
  readonly saved: SavedLocalReferenceInput | undefined
  /** True only when the full request can survive a page reload. */
  readonly durable: boolean
}

const databaseName = 'qingmu-local-reference-drafts-v1'
const storeName = 'drafts'
const openTimeoutMs = 5_000
const volatileSaved = new Map<string, SavedLocalReferenceInput>()

function invalidationKey(key: string): string {
  return `${key}:draft-invalidated`
}

function valid(value: unknown): value is SavedLocalReferenceInput {
  if (value === null || typeof value !== 'object') return false
  const saved = value as Record<string, unknown>
  if (saved.request === null || typeof saved.request !== 'object' || typeof saved.pending !== 'boolean') {
    return false
  }
  const request = saved.request as Record<string, unknown>
  return typeof request.projectId === 'string'
    && typeof request.elementKind === 'string'
    && typeof request.targetId === 'string'
    && typeof request.contentBase64 === 'string'
    && typeof request.originalFileName === 'string'
    && request.sourceDeclaration === 'local_file_unverified'
}

function matchesScope(key: string, saved: SavedLocalReferenceInput): boolean {
  const prefix = 'qingmu.local-reference.v1:'
  if (!key.startsWith(prefix)) return false
  const [projectId, elementKind, ...targetParts] = key.slice(prefix.length).split(':')
  return projectId === saved.request.projectId
    && elementKind === saved.request.elementKind
    && targetParts.join(':') === saved.request.targetId
}

function legacyRead(key: string): SavedLocalReferenceInput | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return valid(value) && matchesScope(key, value) ? value : undefined
  } catch {
    return undefined
  }
}

function invalidated(key: string): boolean {
  try {
    return localStorage.getItem(invalidationKey(key)) === '1'
  } catch {
    return false
  }
}

function markInvalidated(key: string): boolean {
  try {
    localStorage.setItem(invalidationKey(key), '1')
    return true
  } catch {
    return false
  }
}

function clearInvalidation(key: string): void {
  try {
    localStorage.removeItem(invalidationKey(key))
  } catch {
    // A tombstone in IndexedDB still prevents an old durable draft from returning.
  }
}

function legacyWrite(key: string, saved: SavedLocalReferenceInput | undefined): boolean {
  try {
    if (saved === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(saved))
    return true
  } catch {
    return false
  }
}

function indexedAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase> {
  if (!indexedAvailable()) return Promise.reject(new Error('indexeddb_unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      reject(new Error('indexeddb_open_timeout'))
    }, openTimeoutMs)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      finish(() => { resolve(request.result) })
    }
    request.onerror = () => { finish(() => { reject(request.error ?? new Error('indexeddb_open_failed')) }) }
    request.onblocked = () => { finish(() => { reject(new Error('indexeddb_open_blocked')) }) }
  })
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('indexeddb_transaction_failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('indexeddb_transaction_aborted')) }
  })
}

async function readIndexed(key: string): Promise<SavedLocalReferenceInput | null | undefined> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(key)
    const value = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => { resolve(request.result) }
      request.onerror = () => { reject(request.error ?? new Error('indexeddb_read_failed')) }
    })
    if (value === undefined) return undefined
    if (value === null) return null
    return valid(value) && matchesScope(key, value) ? value : null
  } finally {
    database.close()
  }
}

async function writeIndexed(key: string, saved: SavedLocalReferenceInput): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(saved, key)
    await complete(transaction)
  } finally {
    database.close()
  }
}

async function clearIndexed(key: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(null, key)
    await complete(transaction)
  } finally {
    database.close()
  }
}

/** Full-size drafts use IndexedDB. localStorage is only a migration path for old small drafts. */
export async function restoreLocalReferenceDraft(key: string): Promise<RestoredLocalReferenceInput> {
  const volatile = volatileSaved.get(key)
  if (volatile !== undefined) return { saved: volatile, durable: false }
  if (invalidated(key)) return { saved: undefined, durable: false }
  if (!indexedAvailable()) {
    const saved = legacyRead(key)
    return { saved, durable: saved !== undefined }
  }
  try {
    const indexed = await readIndexed(key)
    if (indexed !== undefined) return { saved: indexed ?? undefined, durable: indexed !== null }
    const legacy = legacyRead(key)
    if (legacy === undefined) return { saved: undefined, durable: false }
    await writeIndexed(key, legacy)
    legacyWrite(key, undefined)
    return { saved: legacy, durable: true }
  } catch {
    return { saved: undefined, durable: false }
  }
}

/** Returns false when the browser cannot durably retain the request. */
export async function saveLocalReferenceDraft(key: string, saved: SavedLocalReferenceInput): Promise<boolean> {
  if (!valid(saved) || !matchesScope(key, saved)) return false
  if (!indexedAvailable()) {
    if (legacyWrite(key, saved)) {
      volatileSaved.delete(key)
      clearInvalidation(key)
      return true
    }
    if (!legacyWrite(key, undefined)) markInvalidated(key)
    volatileSaved.set(key, saved)
    return false
  }
  try {
    await writeIndexed(key, saved)
    volatileSaved.delete(key)
    legacyWrite(key, undefined)
    clearInvalidation(key)
    return true
  } catch {
    try {
      await clearIndexed(key)
    } catch {
      markInvalidated(key)
    }
    volatileSaved.set(key, saved)
    return false
  }
}

/** Clear durable state before publishing a confirmed receipt to the parent. */
export async function clearLocalReferenceDraft(key: string): Promise<boolean> {
  if (!indexedAvailable()) {
    if (!legacyWrite(key, undefined)) return false
    volatileSaved.delete(key)
    clearInvalidation(key)
    return true
  }
  try {
    await clearIndexed(key)
    volatileSaved.delete(key)
    legacyWrite(key, undefined)
    clearInvalidation(key)
    return true
  } catch {
    return false
  }
}
