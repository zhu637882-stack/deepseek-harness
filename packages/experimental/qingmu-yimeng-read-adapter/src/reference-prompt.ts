/** Shared authoring contract for a single take or an episode batch. */
import type { ReferenceDirectorSource, ReferenceVideoPromptPart } from './reference-video-types.ts'

/** Shared preparation method; applies before authoring single or batch execution. */
export const executionPromptGuidance = '已有候选的返修先用 qingmu_read_reference_video_candidates 读取该镜相关 reviewPage 的独立音画观察与评论，与 comparisonIntent 中的生成原要求比较，再核对当前设计；空评论不等于没有审片。观察报告与听写可能出错，对照时注明“报告记载/疑似偏差”；没有原片回放证据，不把模型转述升级成“确定发生”，尤其多余台词须保留待听审。仅凭观察报告不能当作已经验收，也不能仅凭两张静帧判定动作跳变。逐镜写 executionPrompt：把当前设计与实际参考整理成可拍摄的自然语言，保留有用细节，不粘贴整份 JSON、字段名、研究过程或修改意见。先交代本段地点、可见人物、起始站位朝向和持物；按实际时长写动作先后、接触与交接、说话时的表情重音和倾听者反应，摄影机的起点、路径与终点，以及结束时可接续的状态。具体到谁做什么、看向谁、何时停顿；多人动作按因果安排，不用一条总述让所有动作同时发生。已有 sceneLayout 与 imageCamera 时，读取共用布局，连同当前 imageObjectStates、imageSubjects 和画幅调用 qingmu_preview_scene_layout，比对实际参考图片，核对可见门窗家具、遮挡、取景范围及人物所在侧；核对演员站位时，把本镜已定演员按当前占位写入临时 imageSubjects，保存与预览相同的布置；不把演员添加到固定场景。头肩裁切用分别标明的头部与躯干体块检查。体块估计不证明目光、肢体姿态或表演正确，没有演员体块时也不能声称验证了演员站位。世界方位不是画面左右，须从摄影机朝向推导，不能沿用另一机位的左右或前后景。比较参考场景的原始取景与本镜机位，明确它提供的是场地外观还是完整构图；反向取景不能要求模型既照搬原图又移除其中主要背景。若来源彼此矛盾、缺少要拍摄方向的可靠依据，返回导演或素材准备修正来源，再整理执行稿，不用追加否定句掩盖。景别变化不等于地点变化，固定门窗与家具仍在原位。只写本段需要的环境、拟音和原生音乐，保留原设计的光影与风格。逐字台词由系统另附一次；正文用对白顺序指明表演与时点，不重抄或补写台词。画内文字、画外声音、画外人物与实际出镜人物分清；产品特写只沿用道具外观与剧情需要的细节，不带入宣传图人物或界面。导演已定内容若在时长内不可执行或互相矛盾，指出具体上游问题，不暗改剧情、压缩表演或假称已经解决。'

/**
 * Resolve reference order once, then preserve execution and the canonical suffix.
 * @param bindings Ordered media bindings.
 * @param uses Authored purpose of each binding.
 * @param source Saved director context and canonical suffix.
 * @param executionPrompt Authored executable direction; absent only for legacy callers.
 * @returns Saved provider prompt parts in reference order.
 */
export function assembleReferencePrompt(
  bindings: readonly { readonly bindingToken: string }[],
  uses: readonly { readonly bindingToken: string; readonly purpose: string }[],
  source: ReferenceDirectorSource, executionPrompt?: string,
): ReferenceVideoPromptPart[] {
  const purposes = new Map<string, string>()
  for (const use of uses) {
    if (typeof use.bindingToken !== 'string' || typeof use.purpose !== 'string' || !use.purpose.trim()) {
      throw new Error('Each reference use needs its bindingToken and a nonempty purpose.')
    }
    if (purposes.has(use.bindingToken)) throw new Error('Describe each bound reference exactly once.')
    purposes.set(use.bindingToken, use.purpose)
  }
  const parts: ReferenceVideoPromptPart[] = [{ text: '【引用素材用途】\n' }]
  for (const binding of bindings) {
    const purpose = purposes.get(binding.bindingToken)
    if (purpose === undefined) throw new Error('Describe each bound reference exactly once; do not add unbound references.')
    purposes.delete(binding.bindingToken)
    parts.push({ bindingToken: binding.bindingToken }, { text: `：${purpose}\n` })
  }
  if (purposes.size) throw new Error('Reference uses must match the bound references.')
  if (executionPrompt !== undefined) {
    if (typeof executionPrompt !== 'string' || !executionPrompt.trim()) throw new Error('请导演完成本镜拍摄执行描述。')
    if (!source.executionSuffix) throw new Error('请重新读取当前导演来源与逐字对白。')
    parts.push({ text: '\n【本镜拍摄执行】\n' }, { text: executionPrompt },
      { text: '\n【原始对白与画面约定】\n' + source.executionSuffix })
  } else {
    // Previously authored drafts remain readable and editable; new preparation authors execution explicitly.
    if (!source.generationPrompt) throw new Error('Read the current director production design before assembly.')
    parts.push({ text: '\n【本镜完整导演设计】\n' }, { text: source.generationPrompt })
  }
  return parts
}
