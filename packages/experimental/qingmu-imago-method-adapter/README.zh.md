# 青木 IMAGO 方法适配器

[English](README.md) | 中文

这个私有实验性 Host 插件把当前 IMAGO OS 方法编译为浏览器安全指引。`elementMethod` 用于资料编辑，`referenceAssetMethod` 用于受限的参考资产动作与权利指引，`promptIrMethod` 用于供应商无关的 PromptIR 候选，`shotRelationMethod` 用于 canonical Scene/Shot/Shot 内局部 Beat/Element 关系图以及 Shot River 节奏与参考绑定，`heroFrameStoryboardMethod` 用于确定性编译一个已选 Hero Frame 及其 Shot 内画布标注。`worksetMethod` 重新读取分集工作流，返回当前 IMAGO 阶段定义与明确的权威可用性。每个端点都在 Host 内构造各自的有界输入，并把按 Unicode code point 排序、无空格的 JSON 通过 stdin 交给已审核的 Core 编译器。编译器返回的 `input_snapshot_sha256` 必须匹配这组准确输入字节的 SHA-256。

## 证明边界

除只读 `worksetMethod` 外，各端点都只从 Host 进程环境读取 `QINGMU_IMAGO_ATTESTATION_KEY`。原始环境字符串就是 HMAC 密钥：不做 trim，并且必须至少包含 32 个 UTF-8 字节。缺失、空串或不足长度时，这些方法会在编译前失败关闭。密钥不会进入 Cordis 配置、编译器子进程环境、浏览器响应、日志或错误正文。`worksetMethod` 既不需要该密钥，也不签发批准证明。

对带证明的方法，Host 验证当前 Core 投影后，返回投影、投影 SHA-256，以及方法专用证明。Shot 关系证明通过下文的 E5-3 哈希投影，绑定准确的编译器输入、目标、Host 派生的 `relationSnapshotSha256` 和当前所选 canonical Shot。Hero Frame Storyboard 证明还绑定所选 Shot SHA、完整 Hero Frame 血缘绑定、原始标注 SHA 和编译结果 SHA。所选 Shot 始终是易梦故事板 frame ID，Beat ID 始终只在所属 Shot 内有效。浏览器只能转发证明，不能在缺少服务端密钥时签发或验证。

Host 从已校验的易梦关系输入派生关系权威 SHA 和所选 Shot SHA。`heroFrameStoryboardMethod` 还由 Host 派生 Hero Frame 绑定 SHA 和原始标注 SHA；浏览器不能提供这些权威哈希，也不能提供第二套 Shot 身份。Host 要求目标、关系图、画布、确定性编译结果、来源绑定、工作单、合法工作集合和权威字段全部精确匹配。方法可以描述通过易梦 ChangeSet 执行 `replaceStoryboardCanvas`，但本适配器不执行该写入，并拒绝生成、选择、批准、签收、Provider 或 Worker 回执。它不创建关系身份、画布仓库、数据库记录、项目状态或第二状态机。

Core 根目录继续由部署环境决定。非空白 `config.coreRoot` 优先，否则必须提供 `IMAGO_OS_CORE_ROOT`。本包不包含任何机器专属 Core 路径。

## Shot River 节奏与参考约定

E5-3 的 `shotRelationMethod` 请求增加权威 `frameNo`、数值 `durationSec`、对白原文及其节奏时间，以及各元素的当前参考可用性、资产 SHA 和最小血缘。Host 校验这些字段，不舍入秒值、不裁剪对白、不虚构参考，也不增加镜头排序状态。工作单只允许 `inspectCanonicalShotRelations` 与 `inspectShotRiverRhythmAndReferences`，两者均为只读。

只有 E5-3 的关系、投影和所选 Shot 摘要使用 `qingmu.e5-3-seconds-binary64-hash-projection.v1`：以 `schema`/`subject` 包装，仅为哈希把固定 `durationSec`、`plannedStartSec`、`plannedEndSec` 路径替换为 `binary64:<16 big-endian hex digits>`。`null` 仍是 `null`，负零按零计算。实际请求与响应的秒值仍为数值。输入快照 SHA 继续绑定带数值的准确 stdin 字节，因此无需改动通用 canonical 序列化器，即可避开 Python/JavaScript 指数写法的差异。Hero/E5-2 保留更窄的 ID 图与原有哈希语义。

## 只读 IMAGO 工作集

`worksetMethod` 只接受准确的 `projectId` 和 `episodeId`，不接受浏览器提供的工作流、批准、规则或命令。每次调用都解析可选的 `qingmuYimengRead` 能力，复用已配置只读适配器原有的 `workflow` GET，沿用其令牌、超时、取消、范围校验与响应上限。卸载该读取插件只会禁用这个端点；重新加载后即可恢复能力，无需重新注册其他方法。

Host 对完整归一化工作流与完整 `sourceRevision` 计算哈希，保留合法有限小数 JSON 值。原有 `inputFingerprint` 只保留为血缘信息，不作为唯一缓存键。v2 输入固定报告 `authority_snapshot.status: unavailable`，原因是 `authoritative_stage_evidence_unavailable`：旧工作流的 `complete`、已选参考、质量检查或未知透传批准字段，都不能建立具名 IMAGO Stage 或 LSU 权威。响应包含当前 23 个阶段定义模板，但不虚构阶段实例、合法任务、推荐或完成结论；`availability` 和 `shadow_comparison` 会说明不可用原因。

固定的 `scripts/compile_qingmu_imago_workset_v2.py` 编译器返回 `qingmu.imago-workset.v2`，外层为 `qingmu.imago-workset-method-adapter-result.v1`。Host 独立对七个本地规则文件计算哈希，校验准确的 `rule_bindings` 映射及其 `rules_sha256`，并绑定准确输入字节、分集主体、来源投影和不执行标记。七个文件是 `pipeline/imago-os-current.json`、`pipeline/workflow-channel-registry.json`、`pipeline/v6-stage-contracts.json`、`pipeline/workflow-spec.v6.production-beta.json`、`scripts/compile_qingmu_imago_workset.py`、`scripts/compile_qingmu_imago_workset_v2.py` 和 `scripts/imago_v6_draft_ctl.py`。Core 继续独占定义、依赖与排序规则；Harness 不保存第二套 DAG 或项目状态。

编译器进程不会收到名称包含 `key`、`token`、`secret` 或 `password` 的环境变量，匹配不区分大小写。共享执行器对 stdout 和 stderr 分别设置 5 MiB 上限，超时、输出无效或退出失败时拒绝结果，不返回 stderr。工作集取消会等待被终止的子进程关闭后再返回。工作集不提供执行、付费派发或人工签收端点。

## 模型体验

### 私有方法 RPC

#### 模型看到的内容

无。`shotRelationMethod` 和 `worksetMethod` 等端点是私有浏览器 RPC，不是模型工具、提示词段落或会话事件。

#### Token 影响

无。RPC 响应不会进入模型上下文。

#### KV Cache 影响

无。没有新增模型可见 token。

## 已知限制与延期工作

- Shot 关系只接受受限 ID 图、节奏与参考绑定；Hero Frame Storyboard 接受原有关系图、血缘和归一化整数标注。标题、实际生成、选择执行、ChangeSet 提交、评论和创意审核决定仍不属于本适配器。
- 证明只表示 Host 校验及精确输入绑定，不授予付费 Provider、资产选择、人工批准或生产状态写入权。
- 本次受限切片不包含密钥轮换或多密钥验证。
- 工作集模板不是已批准的业务阶段。只有未来明确的业务约定提供具名 Stage/LSU 权威后，才可展示实际合法工作推荐或影子对照；不使用旧状态回退。
