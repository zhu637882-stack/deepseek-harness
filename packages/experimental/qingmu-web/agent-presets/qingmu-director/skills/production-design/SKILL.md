---
name: production-design
description: "Create and maintain continuity bibles for characters, locations, props, costumes, color palettes, style rules, reference assets, and cross-shot visual anchors."
---

## 青木接入：美术设计与提示词编排

本技能由 0xhughs/director-skills 的角色/场景/道具设定与电影图片提示词两个完整方法组成，供青木导演在素材设计时使用。先读本入口与当前项目，再通过 qingmu_read_skill_resource 读取 `image-prompting/SKILL.md`，按任务读取相应支持文件；图片提示词阶段至少读取 `image-prompting/references/prompt_anatomy.md`。原始 image-prompting 入口的相对链接以 image-prompting/ 为根。模板仅辅助推导，不新增输出文件流程。

创作意图先形成可见的美术选择，再整理为模型实际可接收的文字。身份、场景等级与材质须由导演根据本片来源独立设计；“皇家、豪华、古装、电影感”等词只表示目标，不能代替建筑、服装形制、妆发及材质设计。使用 character-asset、scene-asset、prop-asset 的相关细则具体化。实际项目未指定历史朝代时保持架空美术一致性，不谎称精确史实。

使用青木已有 ID 和字段：稳定外观写 visualIdentity，具体可见画面写 imagePrompt，依据写 designBasis，场景结构写 space/sceneLayout，当前状态写 imageStage；不要另建一套合同。优先级是当前用户决定、当前剧本事实与已明确认可的设计；保存状态仅表示可恢复，不是创作通过。未确认的旧候选不是必守外观。用户要求重新设计时，先区分必须继承的剧本身份与本次被否定的旧设计；未认可的脸、服装或环境不能因为已经保存就变成锁定项。将本次要改变的可见特征与旧稿比较，在 designBasis 简述差异；只是换措辞、加小饰件而保留被否定的大形，不算完成重新设计。不擅自替换保留素材。复用精简、可辨识的锚点，不把全剧资料和设计过程写进图片文字；不得执行任何外部脚本、自动出图、自动采用或固定多视图扩建。

### 默认任务：先设计与复核，再交付字段

素材设计入口即使没有创作补充，也是在委托专业设计，不是导出或重新排版已有 JSON。先从原始资料和剧本提取设计目标，再独立检查现有每项画面与声音描述是否体现目标；字段齐全、文字很长、已有图片、已有 voice_id 都不代表设计充分。保留有依据且相容的内容，直接改正缺少设计或违背本技能的部分，不等用户逐条点名。不得为了证明工作而强行改变已充分的设计。

根据 character-asset 复核审美目标、服装大形和听觉年龄，根据 scene-asset 复核场所身份及建筑结构，根据 prop-asset 复核材料、尺度与单一状态。用原始资料支持意图，用具体可见或可听的选择完成它。读取上文指定的图片提示词结构参考后，在 designBasis 简述本次发现与设计决定，再把结果落实到实际 imagePrompt 或 voiceIdentity；“原稿完整，其余逐字保留”不能替代这项工作。补充框仅承载用户额外偏好，不是运行这些步骤的开关。

### 交稿前：按实际消费者读回设计

逐项把更新后的 visualIdentity 与 imagePrompt 对照：身份和年代的可见特征、整体尺寸与单位、当前可见的结构和相对比例，必须在完整 imagePrompt 中自足；voiceIdentity 则独立包含已知年龄及可听出的声质。selfContainedImagePrompt=true 时模型不会再收到整段 visualIdentity 或 designBasis，不能依赖它们补救遗漏。只转写当前画面需要的事实，不复制全剧情、内部说明或跨场动作。

“保留图片、不重画”约束素材选择和生成动作，不代表冻结有遗漏的文字设计。补全保留素材的尺度和结构时，同步相关 imagePrompt，原图片 ID 与引用保持不变，不能借此重新生成。只有真正完全未变的字段可以省略。复核容器内净尺寸、开口尺寸与物体装入方向；区分整体包围厚度与局部薄壁、压缝、纸张的材料厚度，不将身体最厚处套给每个部件。估值保留可修正标记。

空间先按 scene-asset 的坐标与支承面核对，再预览构图；预览成功只表示能渲染，不证明家具落地、门能通行或提示词一致。修正发现的矛盾后，交付同一次最终预览采用的布局和文字，不混用旧试算。

# character-location-prop-bible

## When to use
- The user needs consistency across images, shots, scenes, or models.
- The user asks for a character bible, location bible, prop list, wardrobe continuity, style bible, or continuity checklist.
- The project is moving from idea/script into repeatable image/video generation.

## When not to use
- The user only wants one disposable prompt with no continuity need.
- The task is pure model parameter research.
- The user asks for story structure without visual asset continuity.

## Required inputs
- Project title or scene
- Existing descriptions or outputs
- Characters/locations/props/costumes to track
- Target visual style

## Optional inputs
- Reference images
- Shot list
- Model-specific requirements
- Palette or genre anchors
- Version history

## Workflow
1. Create stable IDs for characters, locations, props, costumes, and style rules.
2. Record immutable anchors: identity, silhouette, proportions, palette, materials, prop condition, location geography, and lighting baseline.
3. Separate mutable state: emotion, wardrobe changes, damage, weather, time of day, prop position, and story-state changes.
4. Create golden-image reference prompt entries for clean sheets before dramatic variants.
5. After each generated output or script change, update only the changed fields and preserve a changelog note.
6. Prepare a continuity packet for prompting: minimal anchors for each shot plus exclusions for drift-prone details.

## Decision logic
- If a detail must never change, place it in immutable anchors.
- If a detail changes by scene, place it in state timeline.
- If two sources conflict, prefer the latest user-approved bible entry and log the conflict.
- If model transfer causes drift, route to model-adaptation and use reference-image workflows where supported.

## Output formats
- Character profile
- Location profile
- Prop profile
- Costume profile
- Visual style bible
- Continuity checklist
- Reference asset index
- Golden image plan
- State timeline

## Quality checks
- Every recurring asset has an ID and stable anchor fields.
- Mutable state is tied to scene/shot numbers.
- Prompt anchors are concise enough to reuse.
- Style rules distinguish creative intent from execution details.
- Conflicts are logged instead of silently resolved.

## Anti-patterns
- Changing character descriptions between prompts
- Mixing immutable identity with temporary emotion
- Overlong bible entries that agents cannot practically reuse
- Ignoring prop state after action beats
- Relying on text-only consistency when references are available.

## Exit criteria
- A concise continuity packet exists for downstream screenplay, shot list, image prompts, video prompts, and model exports.

## Supporting files
Read only the supporting file needed for the active task:
- `references/continuity_system.md`
- `references/visual_bible_system.md`
- `references/identity_anchors.md`
- `references/golden_image_workflow.md`
- `templates/character_profile.md`
- `templates/location_profile.md`
- `templates/continuity_checklist.md`
