import type { ProjectInitializationRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export type ProductImages = NonNullable<ProjectInitializationRequest['productImages']>

/** Full image bytes live in IndexedDB; localStorage holds only the draft key. */
export async function productImageDraft(key: string, write?: ProductImages | null): Promise<ProductImages> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器无法保存产品图片，请允许本地存储后重试。')); return }
    let database: IDBDatabase | undefined
    let settled = false
    const finish = (error?: Error, value: ProductImages = []) => {
      if (settled) return
      settled = true; clearTimeout(timer); database?.close()
      if (error) reject(error); else resolve(value)
    }
    const timer = setTimeout(() => { finish(new Error('保存产品图片超时，请重试。')) }, 5000)
    const open = indexedDB.open('qingmu-product-image-drafts-v1', 1)
    open.onupgradeneeded = () => { open.result.createObjectStore('drafts') }
    open.onerror = () => { finish(new Error('浏览器无法读取产品图片草稿。')) }
    open.onblocked = () => { finish(new Error('产品图片草稿被其他页面占用，请关闭旧页面后重试。')) }
    open.onsuccess = () => {
      database = open.result
      if (settled) { database.close(); return }
      const transaction = database.transaction('drafts', write === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('drafts')
      const request = write === undefined ? store.get(key) : write === null ? store.delete(key) : store.put(write, key)
      let value: ProductImages = write ?? []
      request.onsuccess = () => {
        if (write !== undefined || request.result === undefined) return
        const restored: unknown = request.result
        if (!Array.isArray(restored) || restored.length > 5 || restored.some((item: unknown) => {
          if (item === null || typeof item !== 'object') return true
          const image = item as Record<string, unknown>
          return typeof image.filename !== 'string' || typeof image.contentSha256 !== 'string'
            || !/^[a-f0-9]{64}$/.test(image.contentSha256) || typeof image.contentBase64 !== 'string'
            || !image.contentBase64 || image.contentBase64.length > 11184812
        })) { finish(new Error('产品图片草稿损坏，请重新上传原图片。')); return }
        value = restored as ProductImages
      }
      transaction.oncomplete = () => { finish(undefined, value) }
      transaction.onerror = transaction.onabort = () => { finish(new Error('产品图片未能保存，请检查浏览器存储空间。')) }
    }
  })
}

/** Stable recovery identity excludes binary content, which is bound by SHA-256. */
export function projectRequestIdentity(request: Omit<ProjectInitializationRequest, 'idempotencyKey'>): unknown {
  const value = { ...request, ...(request.productImages ? {
    productImages: request.productImages.map(({ filename, contentSha256 }) => ({ filename, contentSha256 })),
  } : {}) }
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted)
    if (item !== null && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sorted(child)]))
    return item
  }
  return sorted(value)
}
