# 青木 IMAGO 方法适配器

[English](README.md) | 中文

这个私有实验性 Host 插件把当前 IMAGO OS 方法编译为浏览器安全指引。`elementMethod` 用于资料编辑，`referenceAssetMethod` 用于受限的参考资产动作与权利指引，`promptIrMethod` 用于供应商无关的 PromptIR 候选，`shotRelationMethod` 用于 canonical Scene/Shot/Shot 内局部 Beat/Element 关系图以及 Shot River 节奏与参考绑定，`heroFrameStoryboardMethod` 用于确定性编译一个已选 Hero Frame 及其 Shot 内画布标注。`worksetMethod` 重新读取分集工作流，返回当前 IMAGO 阶段定义与明确的权威可用性。上述输入快照方法在 Host 内构造各自的有界输入，并把按 Unicode code point 排序、无空格的 JSON 通过 stdin 交给已审核的 Core 编译器。对应编译器返回的 `input_snapshot_sha256` 必须匹配这组准确输入字节的 SHA-256。

`shotFindingMethod`、`productionUnitMethod`、`stageSourceMethod`、`stageArtifactMethod` 与 `lsuPlanMethod` 使用下文各自的主体哈希约定；旧方法的 `input_snapshot_sha256` 字段不属于这些 schema。

## 证明边界

除只读 `worksetMethod` 与 `continuityMethod` 外，各端点都只从 Host 进程环境读取 `QINGMU_IMAGO_ATTESTATION_KEY`。原始环境字符串就是 HMAC 密钥：不做 trim，并且必须至少包含 32 个 UTF-8 字节。缺失、空串或不足长度时，这些方法会在编译前失败关闭。密钥不会进入 Cordis 配置、编译器子进程环境、浏览器响应、日志或错误正文。两个只读方法既不需要该密钥，也不签发批准证明。

对带证明的方法，Host 验证当前 Core 投影后，返回投影、投影 SHA-256，以及方法专用证明。Shot 关系证明通过下文的 E5-3 哈希投影，绑定准确的编译器输入、目标、Host 派生的 `relationSnapshotSha256` 和当前所选 canonical Shot。Hero Frame Storyboard 证明还绑定所选 Shot SHA、完整 Hero Frame 血缘绑定、原始标注 SHA 和编译结果 SHA。所选 Shot 始终是易梦故事板 frame ID，Beat ID 始终只在所属 Shot 内有效。浏览器只能转发证明，不能在缺少服务端密钥时签发或验证。

Host 从已校验的易梦关系输入派生关系权威 SHA 和所选 Shot SHA。`heroFrameStoryboardMethod` 还由 Host 派生 Hero Frame 绑定 SHA 和原始标注 SHA；浏览器不能提供这些权威哈希，也不能提供第二套 Shot 身份。Host 要求目标、关系图、画布、确定性编译结果、来源绑定、工作单、合法工作集合和权威字段全部精确匹配。方法可以描述通过易梦 ChangeSet 执行 `replaceStoryboardCanvas`，但本适配器不执行该写入，并拒绝生成、选择、批准、签收、Provider 或 Worker 回执。它不创建关系身份、画布仓库、数据库记录、项目状态或第二状态机。

Core 根目录继续由部署环境决定。非空白 `config.coreRoot` 优先，否则必须提供 `IMAGO_OS_CORE_ROOT`。本包不包含任何机器专属 Core 路径。

## Shot River 节奏与参考约定

E5-3 的 `shotRelationMethod` 请求增加权威 `frameNo`、数值 `durationSec`、对白原文及其节奏时间，以及各元素的当前参考可用性、资产 SHA 和最小血缘。Host 校验这些字段，不舍入秒值、不裁剪对白、不虚构参考，也不增加镜头排序状态。工作单只允许 `inspectCanonicalShotRelations` 与 `inspectShotRiverRhythmAndReferences`，两者均为只读。

只有 E5-3 的关系、投影和所选 Shot 摘要使用 `qingmu.e5-3-seconds-binary64-hash-projection.v1`：以 `schema`/`subject` 包装，仅为哈希把固定 `durationSec`、`plannedStartSec`、`plannedEndSec` 路径替换为 `binary64:<16 big-endian hex digits>`。`null` 仍是 `null`，负零按零计算。实际请求与响应的秒值仍为数值。输入快照 SHA 继续绑定带数值的准确 stdin 字节，因此无需改动通用 canonical 序列化器，即可避开 Python/JavaScript 指数写法的差异。Hero/E5-2 保留更窄的 ID 图与原有哈希语义。

## 只读 IMAGO 工作集

`worksetMethod` 只接受准确的 `projectId` 和 `episodeId`，不接受浏览器提供的工作流、批准、规则或命令。每次调用都解析可选的 `qingmuYimengRead` 能力，复用已配置只读适配器原有的 `workflow` GET，沿用其令牌、超时、取消、范围校验与响应上限。卸载该读取插件会禁用工作集与连续性读取；重新加载后即可恢复这些能力，无需重新注册其他方法。

Host 对完整归一化工作流与完整 `sourceRevision` 计算哈希，保留合法有限小数 JSON 值。原有 `inputFingerprint` 只保留为血缘信息，不作为唯一缓存键。v2 输入固定报告 `authority_snapshot.status: unavailable`，原因是 `authoritative_stage_evidence_unavailable`：旧工作流的 `complete`、已选参考、质量检查或未知透传批准字段，都不能建立具名 IMAGO Stage 或 LSU 权威。响应包含当前 23 个阶段定义模板，但不虚构阶段实例、合法任务、推荐或完成结论；`availability` 和 `shadow_comparison` 会说明不可用原因。

固定的 `scripts/compile_qingmu_imago_workset_v2.py` 编译器返回 `qingmu.imago-workset.v2`，外层为 `qingmu.imago-workset-method-adapter-result.v1`。Host 独立对七个本地规则文件计算哈希，校验准确的 `rule_bindings` 映射及其 `rules_sha256`，并绑定准确输入字节、分集主体、来源投影和不执行标记。七个文件是 `pipeline/imago-os-current.json`、`pipeline/workflow-channel-registry.json`、`pipeline/v6-stage-contracts.json`、`pipeline/workflow-spec.v6.production-beta.json`、`scripts/compile_qingmu_imago_workset.py`、`scripts/compile_qingmu_imago_workset_v2.py` 和 `scripts/imago_v6_draft_ctl.py`。Core 继续独占定义、依赖与排序规则；Harness 不保存第二套 DAG 或项目状态。

编译器进程不会收到名称包含 `key`、`token`、`secret` 或 `password` 的环境变量，匹配不区分大小写。共享执行器对 stdout 和 stderr 分别设置 5 MiB 上限，超时、输出无效或退出失败时拒绝结果，不返回 stderr。工作集取消会等待被终止的子进程关闭后再返回。工作集不提供执行、付费派发或人工签收端点。

## 只读镜头连续性

`continuityMethod` 只接受 `projectId`、`episodeId` 与 canonical `selectedShotId`。它重新读取同一个已配置工作流，绑定完整来源与修订，并以精确 stdin 字节哈希调用 `scripts/compile_qingmu_continuity_method.py`。编译后 Host 独立重算固定 14 份 Core 文件的原始 SHA：当前机器规则、C5 与 LSUQC 岗位方法和参考，以及两个编译器来源。锁定义与返修传播必须匹配实际 workflow 规则字节。

响应区分当前物化素材绑定与审计原始声明。旧检查可合法通过另一尾帧，但不能证明当前选中链已验证。缺少维度保持未知，不转成失败。只有明确 false 的维度成为 Finding 候选，严重度、最早责任人和时码保持 null；候选不会创建正式 Finding、任务或审核决定。六类锁定义不代表项目锁实例，`lock_authority` 仍不可用。来源明确 unavailable 或旧上游省略字段时均显示不可用。取消会等待编译器子进程关闭；本端点不执行写入或 Provider 调用。

## 绑定镜头问题方法

`shotFindingMethod` 只接受易梦的三个 ID：`projectId`、`episodeId` 和 canonical `frameId`。它通过已配置的可插拔只读能力重新读取 `shotFindings`；浏览器主体、Owner、严重度不进入 Core。它运行 `scripts/compile_qingmu_shot_finding_method.py`，并独立重算固定 18 份当前来源。当前工作流、阶段合同、角色定义、QC Owner 字面规则、供应商中立审核策略和实施方案必须一致。只提供当前活跃工作流中的 Owner，排除仅为兼容保留的岗位。

输出绑定规范主体 SHA、八个必填字段、三种严重度、当前 Owner 选项、规则 SHA，以及固定的 `OPEN`、不批准、不执行返修边界。此 schema 使用 `subjectSnapshotSha256`，不同于旧 schema 的 `input_snapshot_sha256`。Host 只用现有服务端 HMAC 密钥签署已校验的方法坐标；不记录 Finding，不代做归因、批准、建任务、选素材或付费生成。媒体缺失、读取插件卸载、规则不可用、来源字节变化或密钥缺失只禁用本方法，不影响无关方法。

## 制作单元绑定方法

`productionUnitMethod` 只接受 `projectId`、`episodeId` 和 `groupId`。它在编译前后通过已配置的可选读取能力调用 `productionUnits` GET，只比较所请求且可用分组的来源。其他分组不可用、历史绑定或 `canBindUnit: false` 都不会提供或否定该来源。浏览器传入的快照、规则与单元 ID 会被拒绝。分组成员与绑定 CAS 的最终权威仍是后端事务。

固定的 `scripts/compile_qingmu_production_unit_method.py` 只接收 `schema`、`subject` 和 `snapshotSha256`，上限为 1 MiB。Host 保留 ID 和标题原文，校验安全整数、顺序正确且不重复的成员 Shot，并重算来源 SHA。它独立检查活跃指针、注册表、阶段约定哈希，以及当前六个逐单元方法与工作流循环的一致性。固定九份原始规则哈希覆盖七份工作集来源，再加 `scripts/compile_qingmu_element_method.py` 与此编译器；编译前后全部必须保持不变。

响应为 `qingmu.imago-production-unit-method-adapter-result.v1`，包含 `projection`、`projectionSha256` 和 `methodAttestation`，使用现有 Host 专属密钥签名。它不分配单元 ID、不登记绑定、不封存计划、不批准阶段，也不调用 Provider。来源或规则缺失及变化、编译输出无效、读取插件卸载或密钥不可用时失败关闭。取消会等待被终止的子进程关闭。测试可通过 `createImagoMethodHandler` 注入 `readProductionUnits` 与 `runProductionUnitCompiler`；没有新增配置或模型可见内容。

## 单集剧本来源引用方法

`stageSourceMethod` 只接受 `projectId`、`episodeId` 和 `stageId: A1S`。它在编译前后通过已配置的可选读取能力读取当前 `stageSources` 描述。浏览器不能提供来源、快照、规则或剧本正文。历史绑定不能替代不可用的当前来源；所有者权限本身既不建立也不否定来源证据。

固定的 `scripts/compile_qingmu_stage_source_method.py` 接收 `schema`、`stageId`、七字段 `subject` 和 `snapshotSha256`。Host 独立检查当前 A1S 约定，包括全局范围、完整编剧包要求、上游与锁依赖，以及规范输出。九份原始规则哈希覆盖七份工作集来源，再加 `scripts/compile_qingmu_element_method.py` 与此编译器。编译前后来源或规则变化时失败关闭。

响应为 `qingmu.imago-stage-source-method-adapter-result.v1`，包含 `projection`、`projectionSha256` 和 `methodAttestation`。现有 Host 专属密钥只签署已核验的来源引用坐标；不会把单集剧本变成 `SCREENPLAY_PACKAGE`，也不授予阶段完成、批准、锁、计划封存或 Provider 执行权。来源与绑定 CAS 的最终权威仍是后端。测试可通过 `createImagoMethodHandler` 注入 `readStageSources` 和 `runStageSourceCompiler`；正常路径使用有界子进程执行器，取消时等待子进程关闭。

## 机器校验的阶段工件方法

`stageArtifactMethod` 只接受 `projectId`、`episodeId`、`stageId`、`scopeInstance` 和一份完整 V6 阶段工件。固定工件信封仍由机器合同掌管，阶段专属内容字段保持原样。Host 使用只限阶段工件的规范 JSON 定点表示，与 Core 的 Python 加载/转储路径一致，并覆盖有限小数、指数边界和负零；非有限数字失败关闭。它拒绝超过 1 MiB 的快照，并对坐标、工件修订与准确工件 SHA 组成的独立主体计算摘要。浏览器提供的批准、依赖、锁、计划、返修、规则或执行声明都不是请求字段。

正常路径调用当前 `scripts/compile_qingmu_stage_artifact_method.py` 子进程。编译前后，Host 都独立读取七份工作集规则，以及 `scripts/build_v6_stage_contracts.py`、`scripts/validate_v6_stage_contracts.py`、`scripts/compile_qingmu_element_method.py` 和阶段工件编译器本身。它重建准确的当前阶段 Owner、范围、合同哈希、来源与锁要求、工件类型和标准输出；规则字节发生变化，或编译器投影与这些事实不同，都会失败关闭。Core 执行完整的确定性工件校验，包括阶段专属来源、锁、内容章节和未决问题要求。

响应为 `qingmu.imago-stage-artifact-method-adapter-result.v1`，包含由 SHA 绑定的投影与 Host 专属 HMAC 证明。插件还把同一处理器提供为私有 Cordis `qingmuImagoMethod` 能力，使受信 Host 命令能按当前已加载的 Core 规则重新编译准确工件，而不是接受调用方提供的历史证明。它只允许登记这份已通过机器校验的工件。依赖权威仍未核验；阶段批准、锁激活、LSU 计划封存、返修执行、Provider 调用和人工签收均不可用。此方法不读取易梦业务状态，也不执行写入。不可变登记由独立命令与易梦事务掌管；后续依赖权威和独立审核仍是分开的检查点。

## 当前完整范围 LSU 计划方法

`lsuPlanMethod` 只接受 `projectId` 与 `episodeId`。Host 先重建当前生产单元规则和 C5F 锁规则，派生锁规则 SHA，再通过已配置的 `lsuPlanSource` 能力取得准确当前范围。随后运行 `scripts/compile_qingmu_lsu_plan_method.py`，再次读取同一来源并再次重建全部规则。主体、绑定、制作蓝图锁、文件字节、规则哈希或定义发生任何漂移，都会在签证前失败关闭。

准确投影绑定非空且按序排列的已登记 `LSU[0-9]{2,}` 单元、当前已独立批准的 `PRODUCTION_BLUEPRINT_LOCK`、六个当前逐 LSU 阶段定义、全部编译器/规则字节及锁规则子集。Host 独立校验每个字段后用 HMAC 密钥签名。这个无状态 Method 只允许显式的易梦计划封存事务；它不创建 Stage 实例、批准、锁、返修、Provider 调用、Worker、项目状态或人工签收。

## 模型体验

### 私有方法 RPC

#### 模型看到的内容

无。`shotRelationMethod` 和 `worksetMethod` 等端点是私有浏览器 RPC，不是模型工具、提示词段落或会话事件。

#### Token 影响

无。RPC 响应不会进入模型上下文。

#### KV Cache 影响

无。没有新增模型可见 token。

## 已知限制与延期工作

- Shot 关系只接受受限 ID 图、节奏与参考绑定；Hero Frame Storyboard 接受原有关系图、血缘和归一化整数标注。标题编辑、实际生成、选择执行、ChangeSet 提交、评论和创意审核决定仍不属于本适配器。
- 证明只表示 Host 校验及精确输入绑定，不授予付费 Provider、资产选择、人工批准或生产状态写入权。
- 本次受限切片不包含密钥轮换或多密钥验证。
- 工作集模板不是已批准的业务阶段。只有未来明确的业务约定提供具名 Stage/LSU 权威后，才可展示实际合法工作推荐或影子对照；不使用旧状态回退。
