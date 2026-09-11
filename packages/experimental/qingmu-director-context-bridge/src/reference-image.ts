/** Read verified project image bytes into the host's durable attachment store. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/**
 * Admit a catalog-selected image without exposing its signed transport URL.
 * @param ctx - Native host with the existing attachment and model services.
 * @param asset - Exact image selected from the current project's validated catalog.
 * @param exec - Current native director tool execution.
 * @param assertCurrent - Recheck cancellation and the bound shot after asynchronous work.
 * @returns Durable image reference after source hash and decoder verification.
 */
export async function readReferenceImage(
  ctx: Context,
  asset: { browserUrl: string; assetSha256: string; label: string },
  exec: ToolRunContext,
  assertCurrent: () => void,
): Promise<ImageAttachmentRef> {
  assertCurrent()
  const store = ctx.get('attachments')
  const llm = ctx.get('llm')
  const route = exec.agent?.session.requestHeader()?.config
  const provider = route?.provider ?? exec.agent?.options.provider
  const model = route?.model ?? exec.agent?.options.model
  if (!store || !llm || !provider || !model) throw new Error('The director needs an attachment store and a resolved image-capable model.')
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  assertCurrent()
  if (!info.inputModalities?.includes('image')) throw new Error('The current director model does not declare image input; metadata cannot substitute for viewing the picture.')
  // The read adapter has restricted this URL to its configured Writer origin.
  if (!asset.browserUrl) throw new Error('This image has no verified local media URL. Refresh the asset catalog.')
  let response: Response
  try {
    response = await fetch(asset.browserUrl, { signal: exec.signal, redirect: 'error', credentials: 'omit' })
  } catch {
    exec.signal.throwIfAborted()
    throw new Error('The reference image could not be read. Refresh its catalog entry before retrying.')
  }
  try {
    assertCurrent()
    if (!response.ok) throw new Error(`Reference image read failed with HTTP ${response.status}.`)
    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() as ImageMediaType | undefined
    if (!mediaType || !store.imageLimits.mediaTypes.includes(mediaType)) throw new Error('Reference media is not a supported raster image.')
    const limit = Math.min(store.imageLimits.maxImageBytes, store.imageLimits.maxMessageImageBytes)
    if (Number(response.headers.get('content-length') ?? 0) > limit) throw new Error('Reference image exceeds the host attachment byte limit.')
    if (!response.body) throw new Error('Reference image response has no body.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const part = await reader.read()
        assertCurrent()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > limit) throw new Error('Reference image exceeds the host attachment byte limit.')
        chunks.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    const data = Buffer.concat(chunks, bytes)
    if (createHash('sha256').update(data).digest('hex') !== asset.assetSha256) throw new Error('Reference image bytes do not match the selected asset hash. Refresh and inspect the current version.')
    assertCurrent()
    const [attachment] = await store.saveImages([{ data, mediaType, name: asset.label }])
    assertCurrent()
    if (!attachment) throw new Error('Reference image was not stored.')
    return attachment
  } finally {
    // Cancellation may have errored the stream; cleanup must preserve the read failure.
    await response.body?.cancel().catch(() => undefined)
  }
}
