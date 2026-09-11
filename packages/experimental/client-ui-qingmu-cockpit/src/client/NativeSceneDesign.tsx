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
    const signal = reader.current?.signal
    const current = await readAssetDesign({ projectId, episodeId }, signal)
    if (signal?.aborted) throw new Error('场次已切换，保留原导演稿。')
    if (current.stateSha256 !== basis.stateSha256) {
      setBasis(current)
      throw new Error('素材或创作设定已更新，已重新读取当前依据。原导演稿保留，请检查差异后重新设计。')
    }
    onAdopt(parsed.shots)
  }
  const prompt = `为当前已保存剧本的本场戏完成可执行分镜。读取 cinematic-director、open-film-camera 及本场需要的 Leos 六部门参考；以完整故事理解本场目标、关系变化、空间轴线、表演与声音，再安排镜头，不按平均时长拆段。剧本决定对白与例外，不改写台词或增删原文来源行。逐项对照已保存素材的身份、衣装、空间、尺度及光源，不擅自添换服装。visual 只写动作发生前的单幅起始画面；随后发生的取物、开关、拆装和走位写到 action、actionBeats 与 continuity.end，不能在首帧提前出现完成态。运镜按戏剧动机决定：人物转移、注意对象变化或关系推进需要摄影机运动时，明确可见的起点构图、触发动作、移动方向与距离、终点构图；需要静止时说明留白或观察的目的，不把所有镜头默认写成固定加微调，也不强制每镜移动。同一信息在 visual、action、blocking 和 continuity 中保持相同状态，不追加互相矛盾的版本。明确起始和结束时的人物位置、朝向、持物、器具连接与运行状态，使相邻镜头能接续。对白发生时环境底声仍有空间存在感，配乐按整场剪辑时间设计。对复杂接触动作选择有用视角、动作省略或参考状态；不得假称模型能保证物理正确。\n本场输入：${JSON.stringify(scene)}\n全剧与已保存设计：${JSON.stringify(basis)}\n输出一个 txt 代码块中的 JSON：{"sourceScriptSha256":"${scriptSha256}","sourceAssetStateSha256":"${basis?.stateSha256 ?? ''}","sceneIndex":${scene.sceneIndex},"shots":[{"title":"镜头名","narrative":"叙事目的","visual":"起始画面与参考设计","action":"动作表演概要","durationSec":10,"dialogueLineIds":["逐字复制本场已有 sourceLineId"],"directorPlan":{"blocking":"空间调度","cameraAngle":"机位与构图","cameraMovement":"运镜起点、路径、终点与动机","coveragePlan":"剪辑衔接","performance":"潜台词、倾听和反应","lighting":"光源与质感","soundPlan":{"ambience":"整场底声与声学","foley":"动作拟音","music":"成片时间上的配乐意图"},"continuity":{"start":"开始状态","end":"结束状态"},"dialoguePlan":[{"sourceLineId":"真实来源行","character":"原角色名","line":"原台词","delivery":"具体语气、重音、停顿和回应"}]}}]}。directorPlan 可保留本场需要的其他部门设计，不限于示例字段；不要写内部来源元数据，不编造 actorId、propId、assetId。若写 actionBeats，每项包含唯一 beatId、type 和 visualResponsibility，startSec/endSec 在镜头时长内。dialoguePlan 与本镜 dialogueLineIds 顺序对应，可不填 actorId，由系统绑定真实身份；没有对白的镜头使用空数组。每句本场对白完整分配一次。每镜时长 0.5—30 秒是当前分段提交范围，镜头数量按戏剧需要确定，本次最多 64 个，正文不要截断。`
  return <div>
    {error && <p role="alert">创作依据暂未读取：{error}<button onClick={() => { setRefresh(value => value + 1) }}>重新读取设计依据</button></p>}
    {!ready && !error && <p>{basis ? '素材设计对应的剧本已变化，请先回素材页更新依据。' : '正在核对剧本与素材设计…'}</p>}
    <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId}
      source={JSON.stringify(scene)} settings="" disabled={disabled || !ready} onAdopt={adopt}
      purpose={{ key: `scene-design-${scene.sceneIndex}`, title: '场次导演设计',
        description: '导演结合全剧、素材与创作设定安排本场镜头。采用后可以编辑，再保存到分镜。',
        prompt, action: '让导演设计本场分镜', adopt: '采用到分镜卡片', adopted: '完整设计已放入分镜卡片；检查后预览保存。' }} />
  </div>
}
