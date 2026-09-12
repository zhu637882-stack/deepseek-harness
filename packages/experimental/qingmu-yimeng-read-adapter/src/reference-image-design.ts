/** Original generation intent travels with the image; it is not a pixel observation. */
export interface ReferenceImageDesign {
  readonly name: string
  readonly view: string
  readonly visualIdentity: string
  readonly imagePrompt: string
  readonly submittedPrompt: string
  readonly designBasis: string
  readonly space?: Readonly<Record<'orientation' | 'layout' | 'scale' | 'lighting', string>>
  readonly imageStage?: Readonly<Record<'sceneName' | 'camera' | 'blocking' | 'state', string>>
  readonly sceneContext?: { readonly name: string; readonly space: NonNullable<ReferenceImageDesign['space']> }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
function space(value: unknown): ReferenceImageDesign['space'] {
  const row = record(value)
  if (!Object.keys(row).length) return undefined
  return { orientation: text(row.orientation), layout: text(row.layout), scale: text(row.scale), lighting: text(row.lighting) }
}

/**
 * Read only creative fields from a saved native image source, never the current entity draft.
 * @param config - Persisted generation_config from an authenticated image asset.
 * @returns The original description when present; legacy/imported media remains undescribed.
 */
export function referenceImageDesign(config: unknown): ReferenceImageDesign | undefined {
  if (typeof config === 'string') {
    try { config = JSON.parse(config) as unknown } catch { return undefined }
  }
  const anchor = record(record(config).anchor), design = record(anchor.assetDesign)
  if (anchor.schema !== 'qingmu.asset-image-authorization.v1' || typeof design.name !== 'string'
    || typeof design.imagePrompt !== 'string') return undefined
  const savedSpace = space(design.space), stage = record(design.imageStage)
  const scene = record(anchor.sceneContext), sceneSpace = space(scene.space)
  return { name: design.name, imagePrompt: design.imagePrompt, submittedPrompt: text(record(config).prompt), view: text(design.view),
    visualIdentity: text(design.visualIdentity), designBasis: text(design.designBasis),
    ...(savedSpace ? { space: savedSpace } : {}),
    ...(Object.keys(stage).length ? { imageStage: { sceneName: text(stage.sceneName),
      camera: text(stage.camera), blocking: text(stage.blocking), state: text(stage.state) } } : {}),
    ...(sceneSpace && typeof scene.name === 'string' ? { sceneContext: { name: scene.name, space: sceneSpace } } : {}) }
}
