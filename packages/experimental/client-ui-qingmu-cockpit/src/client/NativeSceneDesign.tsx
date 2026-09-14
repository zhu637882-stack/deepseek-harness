import { imageObjectStates } from './image-object-states.ts'
import { imageCameraGuidance, validImageCamera } from './director-image-camera.ts'
import { completeFirstFrameGuidance, generationContextGuidance } from './director-generation-guidance.ts'
/** Scene design uses the existing DSH writing session and editable planning command. */
import { useEffect, useRef, useState } from 'react'
import type { AssetDesignState, PlanningScene, PlanningShot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import type { QingmuYimengPort } from './contracts.ts'
import { NativeStoryComposer } from './NativeStoryComposer.tsx'

/**
 * Read the saved film design before asking the director for complete scene coverage.
 * @param props Current scene and source revision; adoption remains an editable local plan.
 * @returns A native design request with explicit source and dialogue checks on adoption.
 */
export function NativeSceneDesign({ projectId, episodeId, scene, scriptSha256, readAssetDesign, storyPort, disabled, onAdopt }: {
  readonly projectId: string
  readonly episodeId: string
  readonly scene: PlanningScene
  readonly scriptSha256: string
  readonly readAssetDesign: QingmuYimengPort['readAssetDesign']
  readonly storyPort: NativeStoryPort
  readonly disabled: boolean
  readonly onAdopt: (shots: unknown) => void
}) {
  const [basis, setBasis] = useState<AssetDesignState>()
  const [error, setError] = useState('')
  const [direction, setDirection] = useState('')
  const [refresh, setRefresh] = useState(0)
  const reader = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController(); reader.current = controller
    setBasis(undefined); setError('')
    void readAssetDesign({ projectId, episodeId }, controller.signal).then((value) => {
      if (!controller.signal.aborted) setBasis(value)
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { controller.abort() }
  }, [projectId, episodeId, scriptSha256, readAssetDesign, refresh])
  const ready = basis?.scriptSha256 === scriptSha256
    && (!basis.design || basis.design.sourceScriptSha256 === scriptSha256)
  async function adopt(text: string) {
    if (!ready) throw new Error('当前素材设计与剧本尚未对齐，请先更新创作依据。')
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !('sourceScriptSha256' in parsed)
      || parsed.sourceScriptSha256 !== scriptSha256 || !('sceneIndex' in parsed)
      || parsed.sceneIndex !== scene.sceneIndex || !('shots' in parsed) || !Array.isArray(parsed.shots)) {
      throw new Error('设计来源与当前场景不一致，请保留原结果并重新设计。')
    }
    const assigned = parsed.shots.flatMap((shot: Partial<PlanningShot>) => shot?.dialogueLineIds ?? [])
    const expected = new Set(scene.dialogues.map(line => line.sourceLineId))
    if (assigned.length !== expected.size || new Set(assigned).size !== expected.size
      || assigned.some(id => !expected.has(id))) throw new Error('每句原对白需要完整分配一次；当前设计有遗漏、重复或未知来源行。')
    if (!('sourceAssetStateSha256' in parsed) || parsed.sourceAssetStateSha256 !== basis.stateSha256) {
      throw new Error('导演稿使用的素材与创作设定版本不一致或未记录。原稿已保留，请按当前设计重新创作，或检查后手动编辑分镜。')
    }
    const layouts = basis.design?.assets.filter(asset => asset.kind === 'scene' && asset.name === scene.title && asset.sceneLayout) ?? []
    for (const shot of parsed.shots) {
      const plan: unknown = shot?.directorPlan
      if (plan && typeof plan === 'object' && 'imageObjectStates' in plan) imageObjectStates(plan.imageObjectStates)
      const hasCamera = !!plan && typeof plan === 'object' && 'imageCamera' in plan
      if (layouts.length && !hasCamera) throw new Error('本场已有共用布局，每镜需明确提供 imageCamera 或用 null 表达不使用空间构图，不能只写文字机位。')
      if (hasCamera && !validImageCamera(plan.imageCamera)) throw new Error('首帧相机参数无效，请核对位置、目标和垂直视角；原导演稿保留。')
    }
    const signal = reader.current?.signal
    const current = await readAssetDesign({ projectId, episodeId }, signal)
    if (signal?.aborted) throw new Error('场次已切换，保留原导演稿。')
    if (current.stateSha256 !== basis.stateSha256) {
      setBasis(current)
      throw new Error('素材或创作设定已更新，已重新读取当前依据。原导演稿保留，请检查差异后重新设计。')
    }
    onAdopt(parsed.shots)
  }
  const prompt = `${completeFirstFrameGuidance}\n${generationContextGuidance}\n${imageCameraGuidance}\n为当前已保存剧本的本场戏完成可执行分镜。读取 cinematic-director、open-film-camera 及本场需要的 Leos 六部门参考；以完整故事理解本场目标、关系变化、空间轴线、表演与声音，再安排镜头，不按平均时长拆段。剧本决定对白与例外，不改写台词或增删原文来源行。逐项对照已保存素材的身份、衣装、空间、尺度及光源，不擅自添换服装。沿用本场对应场景资产的 space 共用布局：固定地标定义方位，门窗、家具、通道和光源不随反打重新摆放。由这份布局推导 cameraAngle 的机位与可见范围、blocking 的站位朝向，以及 continuity.start/end 的前后状态；画面左右与房间方位分开。若剧本明确改造或移动，设计变化及承接。复杂机位可用 qingmu_check_camera_geometry 核对：同一场景坐标不变，只改变摄影机；按参考事实或明确导演设计建立坐标，记录不确定处，不以计算结果冒充实景测量或遮挡验证。素材 imageStage 只描述某张图的时刻，不自动继承为本镜的剧情状态；可用作参考图实际内容的线索。旧设计没有 space 时从已有场景说明和参考图辨别布局，标明不确定处，不谎称已量测。素材 visualIdentity 是主体完整设定，imagePrompt 只是某次生成或局部修改要求；不能把换视角、删物等修图命令当作完整场景，也不能据此丢弃主体设定。visual 只写动作发生前的单幅起始画面；随后发生的取物、开关、拆装和走位写到 action、actionBeats 与 continuity.end，不能在首帧提前出现完成态。运镜按戏剧动机决定：人物转移、注意对象变化或关系推进需要摄影机运动时，明确可见的起点构图、触发动作、移动方向与距离、终点构图；需要静止时说明留白或观察的目的，不把所有镜头默认写成固定加微调，也不强制每镜移动。同一信息在 visual、action、blocking 和 continuity 中保持相同状态，不追加互相矛盾的版本。明确起始和结束时的人物位置、朝向、持物、器具连接与运行状态，使相邻镜头能接续。对白发生时环境底声仍有空间存在感。配乐按整场剪辑时间设计并写入 editorialContext，交给成片独立音轨；soundPlan 只描述本段需要生成的原生声音，明确后期配乐不烘焙进分段视频。剧中收音机、现场演奏、人物歌唱等有源音乐按剧本保留，导演明确选择模型原生配乐时也保留其决定。对复杂接触动作选择有用视角、动作省略或参考状态；不得假称模型能保证物理正确。\n本次导演要求（用户本次补充，结合当前来源调整；修订上稿时保留其中未受影响的有效设计）：${direction.trim() || '无额外要求'}\n本场输入：${JSON.stringify(scene)}\n全剧与已保存设计：${JSON.stringify(basis)}\n输出一个 txt 代码块中的 JSON：{"sourceScriptSha256":"${scriptSha256}","sourceAssetStateSha256":"${basis?.stateSha256 ?? ''}","sceneIndex":${scene.sceneIndex},"shots":[{"title":"镜头名","narrative":"叙事目的","visual":"起始画面与参考设计","action":"动作表演概要","durationSec":10,"dialogueLineIds":["逐字复制本场已有 sourceLineId"],"directorPlan":{"blocking":"空间调度","cameraAngle":"机位与构图","cameraMovement":"运镜起点、路径、终点与动机","coveragePlan":"仅本次生成段内的景别、焦点与切点", "editorialContext":"交给后期的前后段衔接、声桥、整片配乐与重叠覆盖安排","performance":"潜台词、倾听和反应","lighting":"光源与质感","soundPlan":{"ambience":"整场底声与声学","foley":"动作拟音","music":"本段原生音乐安排；后期配乐意图写 editorialContext"},"continuity":{"start":"开始状态","end":"结束状态"},"dialoguePlan":[{"sourceLineId":"真实来源行","character":"原角色名","line":"原台词","delivery":"具体语气、重音、停顿和回应"}]}}]}。coveragePlan 只写本段内部实际要生成的镜头覆盖，可包含多个切镜；跨生成段的接镜、下一段画面及后期声桥另写 editorialContext，该字段保留给剪辑，不发送为本段视频内容。当前段的入口/出口、可见人物、运镜和表演必须在相应执行字段完整表达，不能只写进 editorialContext。不要机械搬走含“切”字的描述。directorPlan 可保留本场需要的其他部门设计，不限于示例字段；不要写内部来源元数据，不编造 actorId、propId、assetId。若写 actionBeats，每项包含唯一 beatId、type 和 visualResponsibility，startSec/endSec 在镜头时长内。dialoguePlan 与本镜 dialogueLineIds 顺序对应，可不填 actorId，由系统绑定真实身份；没有对白的镜头使用空数组。每句本场对白完整分配一次。每镜时长 0.5—30 秒是当前分段提交范围，镜头数量按戏剧需要确定，本次最多 64 个，正文不要截断。`
  return <div>
    <label>本场导演要求<textarea value={direction} disabled={disabled}
      onChange={(event) => { setDirection(event.target.value) }}
      placeholder="例如调整节奏、运镜、表演或空间关系；也可说明上一稿哪里需要重做" /></label>
    {error && <p role="alert">创作依据暂未读取：{error}<button onClick={() => { setRefresh(value => value + 1) }}>重新读取设计依据</button></p>}
    {!ready && !error && <p>{basis ? '素材设计对应的剧本已变化，请先回素材页更新依据。' : '正在核对剧本与素材设计…'}</p>}
    <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId}
      source={JSON.stringify(scene)} settings="" disabled={disabled || !ready} onAdopt={adopt}
      purpose={{ key: `scene-design-${scene.sceneIndex}`, jsonOutput: true, freshRevision: true, sourceKey: JSON.stringify({ scene, stateSha256: basis?.stateSha256 }), title: '场次导演设计',
        description: '导演结合全剧、素材与创作设定安排本场镜头。采用后可以编辑，再保存到分镜。',
        prompt, action: '让导演设计本场分镜', adopt: '采用到分镜卡片', adopted: '完整设计已放入分镜卡片；检查后预览保存。' }} />
  </div>
}
