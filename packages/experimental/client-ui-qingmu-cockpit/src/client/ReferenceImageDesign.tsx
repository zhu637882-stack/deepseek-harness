import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

/**
 * Show what was authored for these exact image bytes before using them in another view or shot.
 * @param props - The catalog image, with its retained generation description.
 * @returns An optional source panel; opening it never changes a design or submits a request.
 */
export function ReferenceImageDesign({ asset }: { readonly asset: ReferenceVideoAsset | undefined }) {
  const design = asset?.imageDesign
  if (!asset || !design) return null
  const space = design.space ?? design.sceneContext?.space
  const fields = [
    ['原图视角', design.view],
    ['取景场景', design.imageStage?.sceneName || design.sceneContext?.name],
    ['摄影机与取景', design.imageStage?.camera],
    ['人物站位', design.imageStage?.blocking],
    ['物件与当前状态', design.imageStage?.state],
    ['方位参照', space?.orientation], ['固定格局', space?.layout],
    ['尺度依据', space?.scale], ['固定光源', space?.lighting],
  ] as const
  return <details aria-label={`${asset.label}的原图设计`}>
    <summary>查看原图的机位、状态与设计</summary>
    <p>这是生成这张图时保存的设计。请与图片对照；换机位时沿用核对后的固定格局，人物和物件状态按当前剧情衔接。</p>
    <dl>{fields.filter(([, value]) => value).map(([label, value]) => <div key={label}>
      <dt>{label}</dt><dd style={{ whiteSpace: 'pre-wrap', marginInlineStart: 0 }}>{value}</dd>
    </div>)}</dl>
    {design.spatialReference && <details><summary>生成时的空间布局与摄影机</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ layout: design.spatialReference.layout, camera: design.spatialReference.camera }, null, 2)}</pre></details>}
    <details><summary>原图完整描述与依据</summary>
      {[['主体设定', design.visualIdentity], ['画面描述', design.imagePrompt], ['创作依据', design.designBasis],
        ['实际提交描述', design.submittedPrompt]].filter(([, value]) => value).map(([label, value]) =>
        <div key={label}><strong>{label}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{value}</p></div>)}
    </details>
  </details>
}
