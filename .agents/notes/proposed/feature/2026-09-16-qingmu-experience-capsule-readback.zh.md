# Agent Note：青木导演经验胶囊读回

Status: proposed

[English](2026-09-16-qingmu-experience-capsule-readback.md) | 中文

## 问题

青木导演 Agent 的自学习有写入侧——`qingmu_submit_experience_capsule`（[experience-capsule-tools.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-tools.ts)）让导演把一条运维教训（踩过的坑，加上下次要遵守的具体规则）排入运行时根目录下的一个 JSON 审核队列。这一半是有效的：胶囊会落到 `experience-capsule-queue.json`。但闭环从未合上。没有任何路径把已审核的胶囊提升成后续会话读得到的东西，也没有任何环节把已审核胶囊注入导演的模型输入。写入侧另有一条通道（Python 流水线里的 `build_workflow_knowledge_block`）确实会注入精选知识，但它按工作流阶段过滤，而十四条手写胶囊全部标注为 `video`/`asset`，每个调用方请求的却是 `story`/`script`/`shot`——于是过滤器把它们全部丢弃。对照 live 代码核实的净效果：**零条胶囊到达模型。** 导演今天记下的教训，明天的导演看不见。

## 方案

在 harness（Node）侧合上闭环：加一条与既有写入路径对称的读取路径，再加一个供人工提升步骤使用的纯合并库。五块：

**一个新的读取/合并模块**——[experience-capsule-store.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-store.ts)。它把 active store 放在运行时身份旁边（`experience-capsules-active.json`，由 `capsuleActiveStorePathFor(runtimeRoot)` 解析，与队列同一套运行时根约定，因此 harness 进程无需知道仓库路径）。`loadActiveCapsules(storePath)` 读取并校验它，store 缺失或损坏时返回 `[]`。`renderExperienceCapsulesBlock(capsules, limit=12)` 把最新在前的胶囊渲染成一段中文人格块（`最近踩坑经验（人审入库，本次会话优先遵守）：` 后接 `- 症状→规则` 行），为空时返回 `''`。`mergeApprovedCapsules(queue, active, approvedIds, stagesById)` 是运维步骤使用的纯函数：把已审核的队列条目提升到 active store 最前、覆盖复用同一 id 的既有条目、并把已提升条目从队列移除。

**一个受作用域约束的人格变量**——在 [model-tools.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/model-tools.ts) 的 `apply()` 里，通过 `ctx.systemPrompt.variable(...)` 注册 `experience_capsules`（并把 `systemPrompt` 加入该插件的 `inject`）。它每次组装都实时读取 active store，且始终解析为字符串——store 缺失/为空时为空串——因此 `complete:true` 的人格仍能渲染。注册在 preset 作用域，会遮蔽任何全局值。每次组装实时读取意味着一次合并无需重启导演即可在下一轮生效。

**一个人格占位符**——在 [agent.cordis.yml](../../../../packages/experimental/qingmu-web/agent-presets/qingmu-director/agent.cordis.yml) 中，把 `{{experience_capsules}}` 追加为人格最后一段。尾部位置让冗长的人格前缀在多次合并之间保持逐字节稳定，因此 DeepSeek 提示缓存前缀只在胶囊真正变化时才移动。

**一个部署期 seed 脚本**——[seed_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/seed_experience_capsules.py)。纯标准库，因此在 live API 与 worker 所用的同一 venv 下即可运行、无需构建。它把写入侧精选的 `experience_capsules.json` 幂等地转换为运行时根的 active store：精选胶囊最新在前置于最前，此前任何人工合并已提升的胶囊在尾部存活，损坏的精选条目直接抛错。部署时运行一次，然后重启导演。

**一个运维提升 CLI**——[promote_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/promote_experience_capsules.py)。与 seed 脚本同样的纯标准库/venv/无需构建归宿，同样的 `--runtime-root` 环境变量缺省。它是一次性 seed 之后反复进行的人工审核步骤：`--list` 打印队列中的胶囊及其 id，`--approve <id>`（可重复）或 `--approve-all` 提升它们，`--stages <id>=phase1,phase2` 给已提升胶囊打阶段标签，`--dry-run` 只预览不写入。它读取写入侧队列（裸数组）与 active store（`{capsules: […]}`），套用 `mergeApprovedCapsules` 钉住的同一提升语义（已审核条目最新在前置于最前、覆盖复用的 id、从队列移除），再把两个文件写回。以后的 cockpit 审核面板可替换它而无需改动磁盘格式。

## 范围与波及面

仅 harness 读取侧。写入侧 Python 流水线保持不动——把胶囊路由到那边会命中错误的阶段过滤器，并给 story 阶段增加噪音。本次改动不做任何 live 构建、部署或运行时根写入；代码停在分支 `qingmu-self-learning-loop-20260916` 供审阅与安全窗口部署。

## 备选方案

**改写入侧的阶段过滤器。** 否决：写入侧通道按工作流阶段过滤是有正当理由的（story/script/shot 阶段得到与阶段相关的知识），而当前所有胶囊都是导演跨阶段适用的运维纪律教训，不是 story 知识。把它们重新标注到 story/script/shot 阶段会把执行纪律注入不相关的规划轮次。导演自己的人格才是它关于自身工具纪律所学教训的正确归宿。

**直接从写入队列注入胶囊、跳过 active store。** 否决：写入工具自身的契约是一条胶囊“只有在审核后才到达后续会话”。读原始队列会让导演把自己未经审核的文本注入自己的提示——一次没有人工闸门、也无法剪除坏教训的无界自写。

**用动态的 `systemPrompt.context` 贡献而非人格变量。** 否决：context 快照是逐轮变化、位于人格之外的模型可见运行时状态；而这些是稳定的精选规则，属于人格身份，应共享其缓存前缀。变量占位符还让部署方决定它在人格中的位置，而不是插件强塞一个快照段落。

**在人格 YAML 里硬编码胶囊列表。** 否决：这会让闭环失效。没有代码改动与重新部署，新的已审核教训永远无法出现，写入侧仍是摆设。

## 验收标准

- 无 active store 时，导演人格渲染保持不变（`{{experience_capsules}}` 行插值为空），组装不抛错。
- 有已 seed 的 active store 时，渲染出的人格以 `最近踩坑经验…` 块结尾，按最新在前列出已审核胶囊，受渲染上限截断。
- 经 `mergeApprovedCapsules` 提升的胶囊，无需进程重启即出现在下一次导演组装中。
- `loadActiveCapsules` 对缺失、非 JSON、schema 非法的 store 返回 `[]`（而非抛错）；`mergeApprovedCapsules` 只提升已审核 id、按 id 去重、并裁剪队列。由 [experience-capsule-store.spec.ts](../../../../packages/experimental/qingmu-director-context-bridge/tests/experience-capsule-store.spec.ts) 覆盖（8 条测试通过）。
- 对写入侧 14 条胶囊文件做 seed 会产出读取侧逐字加载的运行时根 store（最新在前、`stages` 保留）；重复 seed 幂等并保留此前的人工合并。由 [test_seed_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/test_seed_experience_capsules.py) 覆盖（7 条测试通过）。
- 提升 CLI 把已审核队列条目最新在前移入 active store、覆盖复用的 id、从队列移除、按 id 去重并忽略未知 id、套用审阅者 `stages`、拒绝损坏的已审核条目，且 `--dry-run` 不写任何文件。由 [test_promote_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/test_promote_experience_capsules.py) 覆盖（9 条测试通过）。

## 风险

- **部署期 seed 是一次性运维步骤。** [seed_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/seed_experience_capsules.py) 把它做成单条幂等命令，但在有人对运行时根运行它之前，闭环渲染为空、行为与今天完全一致——安全，但不跑这一步修复就是惰性的。此处记录以免部署时遗忘。
- **暂无运维 UI。** 提升经 [promote_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/promote_experience_capsules.py) CLI 进行（对 `mergeApprovedCapsules` 语义的薄封装）；cockpit 审核面板延后。在此之前审阅者手工先 `--list` 再 `--approve`。
- **提示缓存敏感。** 占位符特意放在人格尾部以保护缓存前缀；把它前移会在每次合并时失效已缓存前缀并抬高成本。任何未来改动都必须保持尾部位置。
