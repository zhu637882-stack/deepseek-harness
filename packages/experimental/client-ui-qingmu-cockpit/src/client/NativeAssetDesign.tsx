/** Project asset designs are editable before an explicitly priced image request. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import type { AssetDesign, AssetDesignItem, AssetDesignState, AssetImageQuote, AssetImageRuns, AssetWorldDesign } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import { NativeStoryComposer } from './NativeStoryComposer.tsx'
import { parseQuotedDesignJson } from './quoted-design-json.ts'
import css from './NativeDirectorComposer.module.css'
import { AssetImageReferences, type AssetImageReferencePort } from './AssetImageReferences.tsx'
import { AssetSpatialDesign } from './AssetSpatialDesign.tsx'
import { SceneLayoutEditor } from './SceneLayoutEditor.tsx'
import { AssetSourceFeedback } from './SceneSourceFeedback.tsx'

type Port = Pick<QingmuYimengPort, 'readAssetDesign' | 'previewSceneLayout' | 'saveAssetDesign' | 'quoteAssetImage' | 'generateAssetImage' | 'readAssetImageRuns' | 'readAssetVoiceRuns' | 'quoteAssetVoice' | 'generateAssetVoice'> & AssetImageReferencePort
const emptyWorld: AssetWorldDesign = { setting: '', scriptFacts: '', directorInferences: '', exceptions: '', openQuestions: '' }
const names = { actor: '人物', scene: '场景', prop: '道具' } as const
function parseDesign(text: string): { design: AssetDesign; repaired: boolean } {
  const { value, repaired } = parseQuotedDesignJson(text)
  if (!value || typeof value !== 'object' || !('assets' in value) || !Array.isArray(value.assets)
    || !value.assets.length || value.assets.length > 40 || !('director' in value) || !value.director || typeof value.director !== 'object') throw new Error('设计需要人物、场景或道具，以及全片导演设定。')
  for (const entry of value.assets as unknown[]) {
    const item = entry as Record<string, unknown> | null
    if (!item || typeof item !== 'object' || (typeof item.kind !== 'string' || !['actor', 'scene', 'prop'].includes(item.kind))
      || typeof item.name !== 'string' || !item.name.trim() || typeof item.imagePrompt !== 'string' || !item.imagePrompt.trim()) throw new Error('素材设计缺少类型、名称或画面描述。')
    if (item.selfContainedImagePrompt !== undefined && typeof item.selfContainedImagePrompt !== 'boolean') throw new Error('完整画面描述选项需要是布尔值。')
    if (item.visualIdentity !== undefined && (typeof item.visualIdentity !== 'string' || !item.visualIdentity.trim())) throw new Error('主体设定不能为空。')
    const vector = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
    if (item.sceneLayout != null) {
      const layout = item.sceneLayout as Record<string, unknown>
      if (item.kind !== 'scene' || typeof layout !== 'object' || typeof layout.basis !== 'string' || typeof layout.coordinateFrame !== 'string'
        || !Array.isArray(layout.objects) || !layout.objects.length || layout.objects.length > 60
        || layout.objects.some((entry: unknown) => {
          const row = entry as Record<string, unknown> | null
          return !row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.label !== 'string'
          || !vector(row.center) || !vector(row.size) || (row.size as number[]).some(n => n <= 0)
          || typeof row.rotation !== 'number' || !Number.isFinite(row.rotation) || typeof row.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(row.color)
        })) throw new Error('空间布局需要有效的物件名称、中心、尺寸、角度和识别色。')
    }
    if (item.imageCamera != null) {
      const camera = item.imageCamera as Record<string, unknown>
      if (typeof camera !== 'object' || !vector(camera.position) || !vector(camera.target)
        || typeof camera.verticalFov !== 'number' || !Number.isFinite(camera.verticalFov)) throw new Error('空间取景需要有效的摄影机位置、目标与视野角度。')
    }
    for (const field of ['space', 'imageStage']) {
      const block = item[field]
      if (block == null) continue
      if (typeof block !== 'object' || Array.isArray(block)
        || Object.values(block).some(value => value !== null && typeof value !== 'string')) throw new Error('场景布局与取景字段需要文字描述。')
      if (field === 'space' && item.kind !== 'scene') throw new Error('共用布局请填写在场景素材中。')
    }
  }
  const director = value.director as Record<string, unknown>
  for (const field of ['visualStyle', 'tone', 'lightingRules', 'cameraGrammar', 'performanceRules', 'characterContinuityRules']) {
    if (typeof director[field] !== 'string' || !director[field]) throw new Error('全片导演设定尚不完整。')
  }
  if (!Array.isArray(director.colorPalette) || !director.colorPalette.every(color => typeof color === 'string')) throw new Error('缺少全片色彩设计。')
  return { design: value as AssetDesign, repaired }
}
function withIdentities(value: AssetDesign, previous?: AssetDesign, retainOmitted = false): AssetDesign {
  const updates = new Map<AssetDesignItem, AssetDesignItem>(), additions: AssetDesignItem[] = []
  const incoming = value.assets.map((item) => {
    const matches = previous?.assets.filter(row => row.kind === item.kind && (item.id ? row.id === item.id : row.name === item.name))
    const old = matches?.length === 1 ? matches[0] : undefined
    const merged = { ...old, ...item, visualIdentity: item.visualIdentity ?? old?.visualIdentity ?? old?.imagePrompt ?? item.imagePrompt }
    for (const field of ['space', 'imageStage'] as const) {
      if (item[field] != null) merged[field] = { ...old?.[field], ...item[field] }
    }
    if (old) {
      if (retainOmitted && updates.has(old)) throw new Error('设计重复更新同一素材，请整理为一份设计后再采用。')
      updates.set(old, merged)
    } else additions.push(merged)
    return merged
  })
  const assets = retainOmitted && previous ? [...previous.assets.map(item => updates.get(item) ?? item), ...additions] : incoming
  if (assets.length > 40) throw new Error('合并后超过当前 40 项素材上限。原设计已保留，请整理后再采用。')
  const world = value.world || previous?.world
    ? { ...emptyWorld, ...previous?.world, ...value.world } : undefined
  return { ...value, assets, ...(world ? { world } : {}) }
}
/** Author, save and generate characters/scenes/props using the native director and image queue.
 * @param props - Current episode, owner-scoped commands and native director session.
 * @returns Editable creative cards, exact price confirmation and recovered generation progress.
 */
export function NativeAssetDesign({ projectId, episodeId, port, storyPort, onGenerated }: {
  readonly projectId: string
  readonly episodeId: string
  readonly port: Port
  readonly storyPort?: NativeStoryPort | undefined
  readonly onGenerated: () => void
}) {
  const [state, setState] = useState<AssetDesignState>(), [design, setDesign] = useState<AssetDesign>()
  const [quote, setQuote] = useState<AssetImageQuote>(), [runs, setRuns] = useState<AssetImageRuns['items']>([])
  const [voiceRuns, setVoiceRuns] = useState<AssetImageRuns['items']>([])
  const changesKey = `qingmu.asset-design-instructions.v1:${projectId}:${episodeId}`
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [instructions, setInstructions] = useState(() => ({ key: changesKey, text: localStorage.getItem(changesKey) ?? '' }))
  const changes = instructions.key === changesKey ? instructions.text : localStorage.getItem(changesKey) ?? ''
  const [referenceEditor, setReferenceEditor] = useState<number>()
  const [dirty, setDirty] = useState(false), [manual, setManual] = useState('')
  const lock = useRef(false), live = useRef(true)
  const scope = { projectId, episodeId }
  const projectSettings = state?.creativeSettings?.project
  const projectRatio = projectSettings && typeof projectSettings === 'object' && 'aspectRatio' in projectSettings && typeof projectSettings.aspectRatio === 'string' ? projectSettings.aspectRatio : '16:9'
  const readRuns = useCallback(async () => {
    const result = await port.readAssetImageRuns({ projectId, episodeId })
    const voices = await port.readAssetVoiceRuns({ projectId, episodeId })
    if (live.current) { setRuns(result.items); setVoiceRuns(voices.items) }
    for (const run of [...result.items, ...voices.items]) {
      const medium = voices.items.includes(run) ? 'audio' : 'image'
      const key = `qingmu.asset-request:${projectId}:${episodeId}:${medium}:${run.entityId}`
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (saved && typeof saved === 'object' && 'requestId' in saved && saved.requestId === run.requestId) localStorage.removeItem(key)
      } catch { /* A corrupt local receipt never changes the authoritative run list. */ }
    }
  }, [port, projectId, episodeId])
  useEffect(() => {
    live.current = true
    void port.readAssetDesign({ projectId, episodeId }).then((result) => {
      if (live.current) { setState(result); setDesign(result.design ? withIdentities(result.design) : undefined) }
    }).catch((error: unknown) => { if (live.current) setNotice(`请先保存本集剧本，再建立素材。${error instanceof Error ? error.message : ''}`) })
    void readRuns().catch(() => { /* Initial asset read reports missing script or authentication above. */ })
    return () => { live.current = false }
  }, [projectId, episodeId, port, readRuns])
  const pending = [...runs, ...voiceRuns].some(run => !run.assetId && !['Failed', 'Cancelled', 'Succeeded', 'Completed'].includes(run.status))
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => { void readRuns().catch((error: unknown) => { if (live.current) setNotice(String(error)) }) }, 6000)
    return () => { clearTimeout(timer) }
  }, [pending, runs, voiceRuns, readRuns])
  const materialized = [...runs, ...voiceRuns].filter(run => run.assetId).map(run => run.assetId).join(',')
  const refresh = useRef(onGenerated); refresh.current = onGenerated
  useEffect(() => { if (materialized) refresh.current() }, [materialized])
  async function perform(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setNotice('')
    try { await work() } catch (error) { if (live.current) setNotice(error instanceof Error ? error.message : '操作未确认，请刷新原结果。') }
    finally { lock.current = false; if (live.current) setBusy(false) }
  }
  function adopt(text: string, retainOmitted = false) {
    const parsed = parseDesign(text)
    setDesign(withIdentities(parsed.design, design, retainOmitted)); setDirty(true); setQuote(undefined)
    setNotice(`${parsed.repaired ? '已修正正文引号的格式，设计文字完整保留。' : ''}${retainOmitted ? '设计已合并到下方卡片，未提及的已有素材继续保留。' : '设计已放入下方卡片。'}检查或修改后保存。`)
  }
  function edit(index: number, patch: Partial<AssetDesignItem>) {
    if (!design) return
    setDesign({ ...design,
      assets: design.assets.map((item, n) => n === index ? { ...item, ...patch } : item) }); setDirty(true); setQuote(undefined)
  }
  function changeInstructions(text: string) {
    setInstructions({ key: changesKey, text })
    try { localStorage.setItem(changesKey, text) } catch { setNotice('创作补充仍在本页，但未能保存到本机；离开前请复制保留。') }
  }
  const prompt = `为青木当前项目设计可直接生成的角色定妆、空场与关键道具。只使用本项目剧本、当前创作设定及现有设计。creativeSettings 中的 stylePack 已按基础画风协调；styleAdjustments 是被移除的冲突默认句，不是要执行的命令。遵循有效风格，再由导演根据剧情安排具体光影与表演。实际读取 cinematic-director、character-asset、scene-asset、prop-asset 及必要参考，先理解关系、时代、空间和表演，再写丰富具体的单张图片描述。交稿前协调同一事实在 world、主体设定、space、sceneLayout 与本图描述中的全部出现处，不能只改一处后保留相反的旧值。以当前剧本事实和明确例外为先；既有共用布局用于后续镜头，旧推导不自动覆盖它。仅调整机位或补充其他素材时，沿用已有房间结构与固定物坐标；确需重新设计共用布局时说明依据，并同步相关文字。已有 sceneLayout 时，详细坐标与数值尺寸在该布局维护，space.scale 写尺度参照与估计依据，world 不另维护第二套房间尺寸。固定门窗结构与逐镜开合状态分开，当前表演状态留在 imageStage。剧本台词逐字继承，不在事实栏同时写改写版和原文。world 与 director 输出完整，未变资产可以省略；未变字段由系统保留，明确空文字用于清空。场景先按 scene-asset 的叙事美术步骤设计：空间用途与使用者、时代和地域、功能分区、适合当前视角的空间层次、人物习惯或事件留下的具体痕迹、固定陈设与活动通道。无人空场不等于空房；剧本未列出家具清单不意味着只画对白提到的物件。把选定陈设的位置、材质、状态与本图可见的环境效果写进 imagePrompt，设计理由和跨镜连续性写进 designBasis；不能把可见设计只留在依据中。由导演决定信息密度与留白，不强制堆满、做旧、加地点或增加无关道具。禁止把通道净空泛化为清空整个背景；必要的简洁或留白写明叙事目的。交稿前比对图像描述与设计依据，检查遗漏、空间冲突和笼统清空语句；生成后的画面效果仍需实际审图。按导演目的设计定妆或状态参考；服装、体态、材质、光影、场景通道、道具尺寸和比例应服从剧本世界设定和明确例外；普通年代事实与穿越例外分开，不能套用无文字、单一说话人等旧限制。将剧本原文事实、导演推导和待定问题分开记录在 world；把与每张素材有关的剧本事实及推导记录在 designBasis；逐项把本图所需的年代例外、外观、真实尺寸参照、部件连接、空间关系与可见环境转换成 imagePrompt 的具体画面描述。交稿前对照 visualIdentity 和 designBasis 核对上述内容，不遗漏物理依据，不把前后动作或不在本图的物件复制进画面描述。整理完整后设 selfContainedImagePrompt=true。同时启用 imageCamera 空间取景时，图片模型收到基础画风、完整 imagePrompt、当前站位与物件连接状态 imageStage、视角、引用用途和本机位构图图；整场陈设与导演总览不再次追加为出图清单。你须先读完整场设定与导演设计，将本视角所需的外观材质、时代例外、明暗色调和具体光源写齐到 imagePrompt。没有空间取景时仍沿用全片视觉设定与共用场景布局。两种方式均保留完整 visualIdentity、designBasis、场景和导演原文于素材设计、任务来源及后续导演上下文中，不将整段身份与剧情依据再次追加进完整画面描述。这不是缩短描述，画面细节、陈设层次和具体尺度仍须写完整。visualIdentity 记录主体完整外观、结构、尺度与场景布局，供后续分镜沿用；它不包含本次修图命令或单一取景要求。改变视角或局部修图时保留主体设定，只有导演明确改变该主体设计时才更新。imagePrompt 只描述本图可见的实体、数量与一个明确当前状态；不可见的携带物、此前或此后的动作留在 designBasis。重复提及同一道具不意味着增加一个实例。必要文字按导演要求清楚呈现，不额外装饰标牌。选择 imageAspectRatio 为 auto、1:1、3:4、4:3、9:16 或16:9；全身定妆可选3:4留出头顶与鞋底，器具可选4:3，最终由取景目的决定，不受成片画幅强制裁切。不要把整个剧情动作堆进一张定妆图。声音身份与逐句语气分开。保留已有实体 id、references 顺序、assetId 和 assetSha256；不要编造任何素材编号。需要用户未提供的图片时写建议，不虚构引用。不修改正式媒体。人物 name 必须逐字沿用剧本中的人物名，年龄、年代、服装和状态放在 description、designBasis 或 view 中，不追加到姓名；同一人物的不同状态共用身份。场景 name 逐字沿用当前剧本的场景 title，避免生成另一份地点身份。新增无对白角色可以由导演安排，并在依据中说明。\n空间布局需要跨机位复用时，可用 qingmu_preview_scene_layout 检查简化取景；采用的 layout 完整保存在场景资产 sceneLayout，camera 完整保存在本图 imageCamera。系统据此渲染构图图并附带到图片请求。换机位只改 imageCamera，固定布局不重建；先核对原图，未知尺寸标为设计估计。先预览，避免机位被墙体挡住或错误遮挡。复杂形状可由多个体块组成；体块颜色只是识别，不是美术配色。没有空间参考需求时保留空值；已有布局和机位在重新设计时沿用，不悄悄丢失。\n当前可用图片模型：${JSON.stringify(state?.imageModels ?? [])}；默认模型：${state?.model}。这是当前接口能力，不能从模型名称推断已配置专用多视角控制。已有 imageModel、imagePromptExtend、imageAspectRatio 与 references 按当前选择保留；用户要求调整或发现不兼容时说明理由再提出选择，不因重新设计而重置。\n当前创作设定：${JSON.stringify(state?.creativeSettings)}\n剧本：${JSON.stringify(state?.script)}\n已有设计：${JSON.stringify(design ?? state?.design)}\n用户补充：${changes}\n最终只将完整 JSON 放在一个 txt 代码块内，格式：{"assets":[{"kind":"actor或scene或prop","name":"名称","description":"用途","visualIdentity":"主体完整外观、结构、尺度与空间布局","imagePrompt":"本次生成或修改画面的完整描述","selfContainedImagePrompt":true,"voiceIdentity":"仅角色声音身份","designBasis":"与本素材相关的剧本事实、尺度、结构和例外","view":"本图需要的视角或静态状态","imageAspectRatio":"auto","references":[]}],"director":{"visualStyle":"全片质感","tone":"情绪基调","lightingRules":"光源规则","colorPalette":["色彩"],"cameraGrammar":"摄影与运镜","performanceRules":"表演原则","characterContinuityRules":"连续性"},"world":{"setting":"年代地点与世界设定","scriptFacts":"剧本已明确事实","directorInferences":"导演为拍摄补足的设定","exceptions":"剧本明确支持的例外及适用范围","openQuestions":"尚待确定的事项"}}。kind 必须是 actor、scene、prop 其中之一。场景资产增加 space 对象：{"orientation":"以固定地标定义方位","layout":"门窗、主要陈设、区域与通道的关系","scale":"尺度、参照依据及待定项","lighting":"固定光源位置"}；从剧本及已有设计建立，同一场景换视角不重排格局，明确剧情改造可更新。每个资产可增加 imageStage：{"sceneName":null,"camera":"本图机位、看向与可见范围","blocking":"本图人物相对固定地标的位置与朝向","state":"物件的当前摆放、持有、开合与连接状态"}。场景图默认自身场景，其他资产在场景内取景时 sceneName 逐字引用本集场景素材 name；定妆或展示背景保持 null。共用布局不含暂时的站位与剧情状态。imagePrompt、space 与 imageStage 必须相容。当换机位涉及画面左右、前后或家具正背面且空间关系难以直接核对时，使用 qingmu_check_camera_geometry：先按当前布局和实际参考图建立同一平面的相对坐标，标明原点、轴向、依据与不确定处；物件 frontDirection 表示其有意义的正面朝向，不是长轴。只改变摄影机，保留固定地标坐标，计算新机位的画面左右、镜头前后和朝向。未知位置或背面不能伪装成测量值；工具不判断遮挡、高度，也不保证图片模型按布局生成。把采用的布局依据保留在 space，把相应取景结论写入 imageStage.camera 和 imagePrompt；分镜则写入 cameraAngle、blocking 与连续性设计。换机位时先从固定地标定位原摄影机与新摄影机，写清从哪里移到哪里、看向哪里、哪个地标进入近景、哪些对象转到摄影机身后或被遮挡；在 imageStage.camera 保留这份可核对的取景决定。再从新机位推导 imagePrompt 中的前后层次、大小与画面左右，不照抄原参考图的构图。自检：若新旧描述的地标位置、遮挡与视角几乎相同，就尚未实现所要求的机位变化；先修正设计再交稿。无法从参考图确认的背面只作有依据的推断；不为展示全部陈设而挪动物件，不把机位后方的对象硬塞进画面。不编造实测尺寸，不擅改已有布局；新建场景由导演补足合理设计并在依据中标明。每项还可带 imageModel（上述当前可用模型的 id，null 使用默认）和 imagePromptExtend（布尔值，仅支持的模型生效）；未列出的字段不要增加。`
  return <section className={css.composer} aria-label="角色与场景生成">
    <h2>设计与生成素材</h2>
    <p>先从当前剧本设计人物、场景和道具，检查画面描述后生成图片；生成结果会进入本项目素材库。</p>
    {state?.projectId === projectId && state.episodeId === episodeId
      && <AssetSourceFeedback key={`${projectId}:${episodeId}`} state={state} disabled={busy} onUse={(text) => {
        const next = changes.includes(text) ? changes : [changes, text].filter(Boolean).join('\n\n')
        changeInstructions(next)
      }} />}
    <label>创作补充<textarea aria-label="创作补充" value={changes} onChange={(event) => {
      changeInstructions(event.target.value)
    }} placeholder="例如人物气质、服装年代、空间布局，或道具的真实尺寸" /></label>
    {state && storyPort && <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId}
      source={JSON.stringify(state.script)} settings="" disabled={busy} onAdopt={(text) => { adopt(text, true) }}
      purpose={{ key: 'asset-design', jsonOutput: true, freshRevision: true,
        sourceKey: JSON.stringify({ stateSha256: state.stateSha256, design }), title: '让青木设计素材', description: '导演会结合剧本和素材方法提出完整设计，你可以逐项调整。',
        prompt, action: '根据剧本设计素材', adopt: '采用到素材卡片', adopted: '已合并设计，未提及的已有素材继续保留。请检查下方卡片后保存。' }} />}
    {design && <>
      <details><summary>剧本世界与设计依据</summary>{(['setting', 'scriptFacts', 'directorInferences', 'exceptions', 'openQuestions'] as const).map((field, index) => <label key={field}>{['年代与世界设定', '剧本明确事实', '导演推导', '剧本例外', '待定事项'][index]}<textarea value={(design.world ?? emptyWorld)[field]} onChange={(event) => {
        setDesign({ ...design, world: { ...(design.world ?? emptyWorld), [field]: event.target.value } })
        setDirty(true); setQuote(undefined)
      }} /></label>)}</details>
      <details><summary>全片设计</summary>{(['visualStyle', 'tone', 'lightingRules', 'cameraGrammar', 'performanceRules', 'characterContinuityRules'] as const).map((field, index) => <label key={field}>{['画面质感', '情绪基调', '光源设计', '摄影与运镜', '表演', '连续性'][index]}<textarea value={design.director[field]} onChange={(event) => {
        setDesign({ ...design, director: { ...design.director, [field]: event.target.value } }); setDirty(true); setQuote(undefined)
      }} /></label>)}</details>
      {design.assets.map((item, index) => {
        const run = runs.find(value => value.entityId === item.id)
        const voice = voiceRuns.find(value => value.entityId === item.id)
        return <section key={`${item.kind}:${index}`} aria-label={`${names[item.kind]} ${item.name}`}>
          <h3>{names[item.kind]} · {item.name}</h3>
          {!item.id && <label>素材名称<input value={item.name} onChange={(event) => { edit(index, { name: event.target.value }) }} /></label>}
          <details><summary>主体设定</summary>
            <label>主体完整设定<textarea value={item.visualIdentity ?? item.imagePrompt}
              onChange={(event) => { edit(index, { visualIdentity: event.target.value }) }} /></label>
            <p>记录人物外观、场景布局或道具结构，供后续导演与分镜沿用。只换视角或局部修图时，修改下方画面描述即可。</p>
          </details>
          <AssetSpatialDesign item={item} assets={design.assets} onChange={(patch) => { edit(index, patch) }} />
          <SceneLayoutEditor {...scope} key={`${projectId}:${episodeId}:${item.id ?? index}`}
            layout={(item.kind === 'scene' ? item : design.assets.find(row => row.kind === 'scene' && row.name === item.imageStage?.sceneName))?.sceneLayout}
            camera={item.imageCamera} ratio={item.imageAspectRatio && item.imageAspectRatio !== 'auto' ? item.imageAspectRatio : projectRatio}
            onLayout={item.kind === 'scene' ? (sceneLayout) => { edit(index, { sceneLayout }) } : undefined}
            onCamera={(imageCamera) => { edit(index, { imageCamera }) }} previewLayout={port.previewSceneLayout} />
          <label>画面描述<textarea value={item.imagePrompt}
            onChange={(event) => { edit(index, { imagePrompt: event.target.value }) }} /></label>
          <label><input type="checkbox" checked={item.selfContainedImagePrompt ?? false}
            onChange={(event) => { edit(index, { selfContainedImagePrompt: event.target.checked }) }} />以完整画面描述出图</label>
          <p>{item.selfContainedImagePrompt
            ? '请在画面描述中写齐本图可见的外观、尺度、结构、年代设定和光影。启用空间取景时，以该机位的构图图和完整描述出图，保留当前站位与连接状态；整场陈设保留给导演和后续分镜，不再次作为本图清单。未启用空间取景时仍沿用全片视觉设定与场景布局。'
            : '当前沿用旧设计：主体设定和剧情依据会一起进入图片请求。让导演整理完整画面描述后，可启用上方选项，避免把其他剧情状态提前画入。'}</p>
          <label>设计依据<textarea value={item.designBasis ?? ''} onChange={(event) => { edit(index, { designBasis: event.target.value }) }} placeholder="与本素材相关的剧本事实、年代例外、尺寸参照、结构与空间关系" /></label>
          <label>视角与状态<input value={item.view ?? ''} onChange={(event) => { edit(index, { view: event.target.value }) }} placeholder="由导演决定，例如后侧视角、接电前状态" /></label>
          <label>素材画幅<select value={item.imageAspectRatio ?? 'auto'} onChange={(event) => { edit(index, { imageAspectRatio: event.target.value as NonNullable<AssetDesignItem['imageAspectRatio']> }) }}>
            <option value="auto">自动 · 新图沿用项目，修改沿用参考图</option>
            <option value="1:1">1:1 方形</option><option value="3:4">3:4 竖幅</option><option value="4:3">4:3 横幅</option>
            <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option>
          </select></label>
          <label>图片模型<select value={item.imageModel ?? ''} onChange={(event) => { edit(index, { imageModel: event.target.value || null, imagePromptExtend: false }) }}>
            <option value="">默认 · {state?.model}</option>
            {item.imageModel && !state?.imageModels?.some(model => model.id === item.imageModel)
              && <option value={item.imageModel}>{item.imageModel} · 当前不可用</option>}
            {state?.imageModels?.map(model => <option key={model.id} value={model.id}>{model.name} · 最多 {model.maxReferences} 张参考{model.supportsBoxes ? ' · 支持框选' : ''}</option>)}
          </select></label>
          <p>只决定本张素材的取景，不改变全片画幅。全身定妆可选竖幅；背景依据中的其他剧情状态不需要同时出现在本图。</p>
          {(item.imageModel ?? state?.model)?.startsWith('qwen-image-3.0') && <label><input type="checkbox" checked={item.imagePromptExtend ?? false}
            onChange={(event) => { edit(index, { imagePromptExtend: event.target.checked }) }} />启用模型描述优化与思考（可能调整细节）</label>}
          {item.id && (state?.retainedSelections?.[item.id]?.length ?? 0) > 0 && <p>描述已更新，原来采用的图片已保留。新设计是否需要换图，可在素材库比较后决定。</p>}
          <button type="button" disabled={busy} aria-expanded={referenceEditor === index} onClick={() => { setReferenceEditor(referenceEditor === index ? undefined : index) }}>参考与局部修改 · {item.references?.length ?? 0} 张图</button>
          {referenceEditor === index && <AssetImageReferences projectId={projectId} references={item.references ?? []}
            port={port} disabled={busy}
            onChange={(references) => { edit(index, { references }) }} />}
          {item.kind === 'actor' && <label>声音身份<textarea value={item.voiceIdentity ?? ''} onChange={(event) => { edit(index, { voiceIdentity: event.target.value }) }} /></label>}
          <button type="button" disabled={busy || dirty || !item.id || (run !== undefined && !run.assetId && !['Failed', 'Cancelled', 'Succeeded', 'Completed'].includes(run.status))}
            onClick={() => {
              void perform(async () => {
                if (item.id) setQuote(await port.quoteAssetImage({ ...scope, entityId: item.id }))
              }) }}>查看生成费用</button>
          {item.kind === 'actor' && <><button type="button" disabled={busy || dirty || !item.id || !item.voiceIdentity?.trim() || (voice !== undefined && !['Failed', 'Cancelled', 'Succeeded', 'Completed'].includes(voice.status))}
            onClick={() => {
              void perform(async () => { if (item.id) setQuote(await port.quoteAssetVoice({ ...scope, entityId: item.id })) })
            }}>生成声音试听</button>
          {voice && <p role="status">{voice.assetId ? '声音已生成，可在素材库试听并引用' : `声音进度：${voice.status}${voice.errorCode ? ` · ${voice.errorCode}` : ''}`}</p>}</>}
          {run && <p role="status">{run.assetId ? '图片已生成，可在下方素材库查看' : run.status === 'Failed' ? `生成失败：${run.errorCode ?? '请查看任务详情'}` : `生成进度：${run.status}`}</p>}
        </section>
      })}
      <button type="button" disabled={busy || !dirty || !state} onClick={() => {
        void perform(async () => {
          const result = await port.saveAssetDesign({ ...scope,
            expectedStateSha256: state?.stateSha256 ?? '',
            design: { assets: design.assets, director: design.director, ...(design.world ? { world: design.world } : {}) } })
          if (live.current) { setState(result); setDesign(result.design ? withIdentities(result.design) : undefined); setDirty(false); setNotice('素材设计已保存。现在可以逐项生成图片。') }
        }) }}>保存素材设计</button>
    </>}
    {quote && <section aria-label={quote.mediaType === 'audio' ? '确认声音生成' : '确认图片生成'}><h3>生成 {quote.entity.name}</h3><p>{quote.model} · {quote.mediaType === 'audio' ? '一段声音试听' : '一张图片'} · ¥{Number(quote.estimatedCny).toFixed(2)}</p>
      {quote.mediaType !== 'audio' && <p>{quote.compositionReference ? `使用 ${quote.references?.length ?? 0} 张素材参考图和 1 张空间取景图生成新候选。` : quote.references?.length ? `使用 ${quote.references.length} 张参考图派生，新图作为候选保留。` : '根据文字设计生成新候选。'}</p>}
      <details><summary>查看完整生成描述</summary><pre>{quote.prompt}</pre></details>
      {quote.compositionReference && <figure><img style={{ width: '100%', maxHeight: 450, objectFit: 'contain' }} src={quote.compositionReference.imageUrl} alt="本次生成附带的空间取景图" /><figcaption>本次使用的空间取景图。实际外观由素材与导演描述决定。</figcaption></figure>}
      <button type="button" disabled={busy || dirty || !quote.generationAvailable} onClick={() => {
        void perform(async () => {
          const newCommand = { requestId: crypto.randomUUID(), kind: quote.entity.kind,
            quoteSha256: quote.quoteSha256, authorizationCapCny: quote.estimatedCny, paidConfirmed: true as const }
          const key = `qingmu.asset-request:${projectId}:${episodeId}:${quote.mediaType ?? 'image'}:${quote.entity.id}`
          const previous: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
          const command = previous && typeof previous === 'object' && 'requestId' in previous ? previous as typeof newCommand : newCommand
          localStorage.setItem(key, JSON.stringify(command))
          try {
            await (quote.mediaType === 'audio' ? port.generateAssetVoice : port.generateAssetImage)({ ...scope, entityId: quote.entity.id, command }); setQuote(undefined)
            setNotice('已提交，离开或刷新页面后可继续读取同一任务。')
          } catch (error) { setQuote(undefined); throw error }
          finally { await readRuns() }
        }) }}>{quote.mediaType === 'audio' ? '确认费用并生成试听' : '确认费用并生成一张'}</button>
      {!quote.generationAvailable && <p>当前账户尚未开通图片生成额度。</p>}
    </section>}
    <button type="button" disabled={busy} onClick={() => { void perform(readRuns) }}>刷新生成进度</button>
    <details><summary>导入已有素材设计</summary><p>导入会以这份完整清单替换下方设计卡片；已有媒体保留。请检查清单后保存。</p><textarea aria-label="素材设计数据" value={manual} onChange={(event) => { setManual(event.target.value) }} /><button type="button" disabled={busy || !manual.trim()} onClick={() => {
      try { adopt(manual) } catch (error) { setNotice(String(error)) }
    }}>载入设计</button></details>
    {notice && <p role="status">{notice}</p>}
  </section>
}
