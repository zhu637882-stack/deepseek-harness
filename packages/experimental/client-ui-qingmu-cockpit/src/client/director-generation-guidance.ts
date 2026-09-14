/** Shared authoring instruction for scene planning and existing-shot reconciliation. */
export const generationContextGuidance = '为每镜在 directorPlan.generationContext 写出本镜需要继承的全片设定：先完整阅读剧本、世界与例外、场景布局、主体身份及各部门设计，再将与本段有关的时代和例外、外观材质、空间关系、光影色调、表演与声音原则具体落实；保留本镜需要的专项方法，不照抄其他段的动作、对白和完整剧情顺序。已有镜头用 qingmu_read_director_plan 读取本镜，再用 qingmu_read_reference_draft 读取 saved.directorSource.prompt 中当前完整的全片与资产设计；本镜读取不包含全部全片资料，不能用会话里的旧布局补空缺。尚未建立分镜时使用当前创作请求读取的完整资产设计与剧本。这个字段由导演主动整理，不由程序按关键词删减；它非空时，生成使用它替代未分镜的全片方案，完整全片方案仍保留在导演研究来源。逐镜动作、起止状态、段内切镜、运镜、逐字对白和声音仍完整写在原执行字段并一同生成；不把它们浓缩成摘要，也不把待定估计说成观察事实。核对继承内容与全部相关来源，避免遗漏或冲突；原设计有矛盾时明确处理，不把不同版本揉在一起。旧稿缺少该字段时先整理保存，再读取新来源，检查人数、空间、道具状态和动作是否前后一致，不只检查字段是否存在。'

/** First-frame authoring uses the shared director source and the real image compiler. */
export const completeFirstFrameGuidance = '首帧须独立写齐这个时刻的可见人物、服装、场景材质、道具比例与连接状态、机位及光影（包括画外光源对画面的影响），并在 directorPlan 中明确设 selfContainedImagePrompt:true。新建分镜写在 visual，修改已有镜头写在 imagePromptCn。生成首帧使用这份完整描述、当前起始状态、素材用途和构图参考，不再叠加整段 generationContext 或其他时刻的灯光变化；有构图参考时也不重复全场陈设清单，无构图参考时仍沿用共用空间关系。因此不能只写局部修图指令或依赖未写明的背景。完整剧本、场景依据和导演各部门设计继续保留，generationContext、运镜、表演、动作、对白及声音仍服务于视频。旧稿未明确整理成独立画面时保留原模式，不直接开此选项。'

export const firstFrameDirectorPrompt = [
  '请整理当前镜头的首帧画面，作为当前项目正常图生视频流程的起点。先用 qingmu_read_director_plan 读取本镜完整设计，再用 qingmu_read_reference_draft 读取 saved.directorSource.prompt 中当前剧本、全片设定和资产资料；按当前可用的看图工具检查实际引用。',
  '围绕剧本和导演意图，核对共用房间的门窗、固定家具、通路与尺度依据；同一场景换机位只改变观察角度，不能把左右画面位置误当世界方位。人物站坐位置、朝向、手持物、支撑接触、道具数量与连接状态应符合动作开始时刻，后续移动和终态留在视频设计中。物理与年代例外由当前剧本解释，不能用固定禁令覆盖。',
  '比较世界资料中的旧导演推导与当前绑定场景的 space、sceneLayout、visualIdentity；有矛盾就依据剧本、已确认设计和实际参考明确处理。保留推导依据和不确定性，不把相互矛盾的尺寸、家具位置或道具状态一同交给模型，也不把估计改称实测。镜头另有换场或时间变化时照导演设计落实。',
  generationContextGuidance,
  completeFirstFrameGuidance,
  '用 qingmu_save_director_plan 保存独立 imagePromptCn 和必要的 imageStage 起始机位、走位、状态；需要几何取景时沿用当前场景坐标保存 imageCamera。保留本镜完整视频、运镜、表演、逐字对白、soundPlan 和 editorialContext；不要为首帧重写整段视频，也不自动改动共用资产或其他镜头。',
  '保存后必须调用 qingmu_preview_first_frame 核对实际提示词与全部引用顺序。若正式参考未就绪，可从当前项目实际素材中明确选择 referenceImages，每张传 assetId、assetSha256、purpose；用途写清哪些外观和布局需要继承，哪些动作时刻属于别的画面。不能凭空编素材。预览不生成图片。',
  '预览若被拒绝，按返回的具体原因在本次整理范围内修正并重新核对，不重复提交相同输入。若超过选定模型的实际输入上限，检查全片设定、首帧描述、起始状态和引用用途中的重复表达，按各字段用途重整，保留人物、房间、道具、风格及起始状态的有效设计；视频运镜、动作、对白和声音仍保留在完整执行字段。不能机械截断，也不能以缩短为由删掉创作内容。普通笔误与重复表达可随本次整理修正，无需另外请用户逐项确认。',
  '检查最终请求中的场景布局、全片画风、人物位置、道具尺度和起始状态是否相容；仍有冲突就修对应来源并重读，不能仅在末尾追加相反要求。说明实际保存了什么、哪些观察尚无法确认。不要提交图片或视频，不选用候选，不修改用户批准。',
].join('\n')
