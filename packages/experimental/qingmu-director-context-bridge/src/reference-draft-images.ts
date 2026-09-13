/** Deliver saved reference pixels alongside the draft without another observer call. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ReferenceVideoAsset, ReferenceVideoDraftResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { readReferenceImage } from './reference-image.ts'

/** One exact binding, with either delivered pixels or an explicit missing-input reason. */
export interface DraftImageInput {
  bindingToken: string
  assetId: string
  assetSha256: string
  status: 'attached' | 'not_on_page' | 'stale' | 'unavailable'
  reason?: string
  attachment?: ImageAttachmentRef
  originalImageDesign?: ReferenceVideoAsset['imageDesign']
}

/**
 * Load this page's already-bound images for an image-capable director.
 * @param ctx - Host attachment and current model services.
 * @param saved - Persisted draft whose bindings choose the image identities.
 * @param catalog - Current project page; unrelated images are never attached.
 * @param exec - Owning native turn.
 * @param check - Revalidate the current shot after asynchronous work.
 * @returns Image inputs and explicit omissions, without image selection or model calls.
 */
export async function readDraftImages(ctx: Context, saved: ReferenceVideoDraftResponse,
  catalog: readonly ReferenceVideoAsset[], exec: ToolRunContext, check: () => void): Promise<DraftImageInput[]> {
  const bindings = saved.draft?.request.bindings.filter(item => saved.mediaTypes[item.bindingToken] === 'reference_image') ?? []
  if (!bindings.length) return []
  const store = ctx.get('attachments')
  const llm = ctx.get('llm')
  const route = exec.agent?.session.requestHeader()?.config ?? exec.agent?.options
  const model = llm && route?.provider && route.model
    ? await llm.resolveModelInfo(route.provider, route.model, exec.signal) : undefined
  check()
  const inputs: DraftImageInput[] = []
  let bytes = 0
  let count = 0
  for (const binding of bindings) {
    const input: DraftImageInput = { bindingToken: binding.bindingToken,
      assetId: binding.assetId, assetSha256: binding.assetSha256, status: 'unavailable' }
    inputs.push(input)
    const asset = catalog.find(item => item.assetId === binding.assetId)
    if (!asset) { input.status = 'not_on_page'; continue }
    if (asset.assetSha256 !== binding.assetSha256 || asset.mediaType !== 'reference_image') {
      input.status = 'stale'; continue
    }
    if (!store || !model?.inputModalities?.includes('image')) {
      input.reason = 'Direct image input is unavailable. Use explicit image inspection with the configured observer; no observer was called by this read.'
      continue
    }
    if (count >= store.imageLimits.maxImagesPerMessage) {
      input.reason = 'Message image limit reached; inspect this image separately.'
      continue
    }
    try {
      const attachment = await readReferenceImage(ctx, asset, exec, check)
      if (bytes + attachment.bytes > store.imageLimits.maxMessageImageBytes) {
        input.reason = 'Message image byte limit reached; inspect this image separately.'
        continue
      }
      input.status = 'attached'
      input.attachment = attachment
      if (asset.imageDesign) input.originalImageDesign = asset.imageDesign
      bytes += attachment.bytes
      count += 1
    } catch (error) {
      // A failed media read must remain visible while the editable draft is recoverable.
      check()
      input.reason = error instanceof Error ? error.message : 'Reference image could not be loaded.'
    }
  }
  return inputs
}
