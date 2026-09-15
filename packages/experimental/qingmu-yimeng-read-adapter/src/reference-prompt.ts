/** Shared authoring contract for a single take or an episode batch. */
import type { ReferenceDirectorSource, ReferenceVideoPromptPart } from './reference-video-types.ts'

export const executionPromptGuidance = '逐镜写 executionPrompt：把当前设计与实际参考整理成可拍摄的自然语言，保留有用细节，不粘贴整份 JSON、字段名、研究过程或修改意见。先交代本段地点、可见人物、起始站位朝向和持物；按实际时长写动作先后、接触与交接、说话时的表情重音和倾听者反应，摄影机的起点、路径与终点，以及结束时可接续的状态。具体到谁做什么、看向谁、何时停顿；多人动作按因果安排，不用一条总述让所有动作同时发生。景别变化不等于地点变化，固定门窗与家具仍在原位。只写本段需要的环境、拟音和原生音乐，保留原设计的光影与风格。逐字台词由系统另附一次；正文用对白顺序指明表演与时点，不重抄或补写台词。画内文字、画外声音、画外人物与实际出镜人物分清；产品特写只沿用道具外观与剧情需要的细节，不带入宣传图人物或界面。导演已定内容若在时长内不可执行或互相矛盾，指出具体上游问题，不暗改剧情、压缩表演或假称已经解决。'

/** Resolve reference order once, then preserve the authored execution and canonical suffix. */
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
