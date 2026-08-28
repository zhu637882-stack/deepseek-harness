# 青木易梦命令适配器

[English](README.md) | 中文

这个私有实验性 Host 插件通过仅限回环地址的 `/qingmu-yimeng-command` 通道，暴露易梦 `episode_script` 与人物、环境、道具 `element_profile` ChangeSet 的显式流程。剧本操作继续是 `proposeScript`、`previewScript`、`commitScript` 和只读的 `recoverScriptCommit`；元素操作是 `proposeElementProfile`、`proposeReferenceAsset`、`previewElementProfile`、`commitElementProfile` 和只读的 `recoverElementProfileCommit`。Take 普通评论使用 `createTakeComment` 和只读的 `recoverTakeComment`。所选视频 Finding 使用 `recordShotFinding` 和只读的 `recoverShotFinding`。通过机器校验的阶段工件使用 `registerStageArtifact`、`commitStageArtifactDecision`，以及只读的 `recoverStageArtifactRegistration` 和 `recoverStageArtifactDecision`。完整范围 LSU 计划使用 `sealLsuPlan`、只读的 `recoverLsuPlanSeal` 和 `probeLsuPlanAuthority`。

## 命令边界

适配器自身不写数据库。它校验浏览器输入，只从 Host 环境获取 `YIMENG_API_TOKEN`，并把命令转发给易梦拥有的 HTTP API。项目归属、修订检查、持久 ChangeSet、幂等回执、outbox 事件和下游失效仍由易梦掌权。

ChangeSet 提案不等于提交。Client 必须展示返回的预览，并且只有当 `canCommit` 为 true 且用户明确确认后才可提交。提交回执不等于人工创意签收，也不授权付费 Provider 调用。

元素命令使用通用的 `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` 路由族。运行时只接受准确的 `actor`、`scene` 和 `prop`，其他类型全部失败关闭。预览与提交校验把 ChangeSet、subject 坐标、修订号、snapshot 与 payload 哈希、operation，以及不授予权力的 preflight 标记绑定到原始浏览器请求。

每一类元素提案都必须携带字段精确的六字段 `qingmu.imago-element-method-attestation.v1` 证明。适配器会在转发前拒绝多余或缺失字段、非小写 64 位十六进制摘要，以及投影、输入快照或 subject 哈希绑定错配。这条元素档案提案链原样转发已校验的投影、投影哈希与证明，不读取 IMAGO 证明密钥，也不自行签名。返回的预览与回执还必须只包含七组标准影响数组及相匹配的 canonical `impactSha256`；多余或缺失影响字段都会失败关闭。

`proposeReferenceAsset` 只接受当前 `qingmu.imago-reference-asset-method-projection.v1` 与专用证明。Host 从环境读取至少 32 个 UTF-8 字节的 `QINGMU_IMAGO_ATTESTATION_KEY`，对字段精确的未签名证明执行 HMAC-SHA256，并以 timing-safe 方式比较签名；随后把投影、输入快照、目标、operation、候选资产 ID/SHA、修订号和易梦 snapshot SHA 逐项绑定。密钥、投影和证明都不会发送给易梦，也不会成为浏览器签名权力。通用 preview、commit、recovery 只在 Host 合同内保留准确 operation 与候选血缘，HTTP body 仍复用现有通用结构。

`selectReferenceAsset` 只记录用户明确的选择意图，不等于人工批准或签收。`requestReferenceRegeneration` 必须带非空 `repairPrompt`，并且只记录意图：成功预览和回执必须保持 `providerCalls: 0`、`workerStarted: false`，且不推断人工批准。两种操作都不会启动生成，也不会静默代选候选。

回执恢复只会向易梦 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/change-sets/{changeSetId}/command-receipt` 精确发送一次 `GET`；三类元素档案都使用对应的通用元素路由。两者都只使用原始 `Idempotency-Key` 请求头，不带请求体或 query。适配器只接受 `jason.qingmu-command-receipt-recovery.v1` wrapper，并重新核验其中原始提交回执的全部血缘；在接受 wrapper 的 `receiptSha256` 前，还会重算原始回执的 canonical JSON SHA-256；它绝不会重试 commit `POST`。

## Take 普通评论

`createTakeComment` 把精确的当前 Take 主体 SHA 绑定到所选 Take、时间码或帧锚点、评论正文和一个可见 ASCII 幂等键。它只向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/take-comments` 发送一次 `POST`；请求体准确包含 `expectedTakeSubjectSha256`、`takeId`、`anchor`、`body` 和 `idempotencyKey`，路径 ID、actor、角色与 session 均来自路由和易梦认证。结果必须保留原意图，并把 `changed`、选择、技术通过、正式批准、单集验证、人工签收、Provider 调用与预算影响保持为 false 或零。

`recoverTakeComment` 绝不重试 POST。它只向 `/command-receipt` 发送一次无正文 GET，在 query 中保留原 Take ID 与主体 SHA，在请求头中保留幂等键，随后校验原结果或严格的 `not_found`。两个操作都只使用 Host 持有的易梦 bearer token；凭据一旦反射进上游 JSON 就失败关闭。

## 镜头视频 Finding

`recordShotFinding` 接收[请求类型](src/types.ts)定义的项目、剧集与镜头 ID、预期 subject SHA、幂等键、八个明确填写的 Finding 字段、方法投影、投影 SHA 和证明。它校验 canonical subject 与投影摘要，并使用 Host 的 `QINGMU_IMAGO_ATTESTATION_KEY` 核验 HMAC-SHA256 证明，之后再校验规则摘要和方法中的责任岗位选项。密钥至少需要 32 个 UTF-8 字节。多余字段、非法严重度或责任岗位，以及绑定错配都失败关闭。作者原文和重复的证据引用均予保留；不会推断严重度或责任岗位。

适配器只向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/findings` 发送一次 `POST`，请求体不含三个路径 ID，也绝不提供 actor 或 session 字段。易梦要求显式的项目 reviewer 功能权限，并只记录 `OPEN` Finding，不批准、不改变选择、不执行返工，也不调用 Provider。响应必须保留提交字段与 subject、方法和规则哈希；认证会话 SHA 必须匹配本次请求使用的令牌。失败或中断的 `POST` 绝不自动重试。

`recoverShotFinding` 只接收三个 ID、原 subject SHA 和幂等键。它向相同路径加 `/command-receipt` 发送一次 `GET`，query 携带 `expectedSubjectSha256`，请求头携带原 `Idempotency-Key`。它只接受相匹配的 `committed` 结果，或 `result: null` 的 `not_found`。恢复仍由易梦认证，但不会读取当前 subject，也不要求历史记录匹配今天的 HMAC 密钥或 bearer-token 会话。

## 生产单元范围绑定

`bindProductionUnit` 把明确选择的单元 ID 登记到现有原生镜头组。请求将项目、剧集、镜头组和单元 ID 绑定到当前来源 SHA、上一条绑定修订号/SHA，以及带证明的 `qingmu.imago-production-unit-method.v1` 投影。修订号为零时，上一条 SHA 必须为 null。Host 先核验来源与方法摘要、HMAC 证明、方法定义和规则摘要，再向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/production-units/{unitId}/binding` 发送一次 `POST`。actor 和 session 字段来自易梦认证，绝不接受浏览器指定。

回执必须匹配这些坐标、下一条绑定修订号、方法与规则哈希、定义和本次请求的会话 SHA。`planSealed`、`humanSignoffInferred` 和 `reworkExecuted` 必须保持 false，`providerCalls` 必须保持零。范围绑定既不封存 LSU 计划，也不创建 StageInstance、批准、工作集或生成任务。

`recoverProductionUnitBinding` 向相同绑定路径加 `/command-receipt` 发送一次 `GET`，query 携带原镜头组 ID 和来源 SHA，请求头携带原 `Idempotency-Key`。它只接受相匹配的 `found: true` 回执，或 `result: null` 的 `found: false`。恢复不要求今天的来源、HMAC 密钥或历史 bearer-token 会话仍然相同。中断的写入绝不自动重试；回执损坏和血缘错配均失败关闭。

## 单集剧本来源引用绑定

`bindStageSource` 接收项目与剧集 ID、明确的 `stageId: A1S`、当前来源 SHA、上一条绑定修订号/SHA、幂等键，以及 Host 原签发的方法投影、投影 SHA 和证明。Host 先校验规范来源、方法、规则、定义和 HMAC，再向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/stage-sources/A1S/binding` 发送一次 `POST`。七字段请求体不含路径 ID；actor 与 session 只来自易梦认证。仅所有者可写的后端事务同时检查来源和绑定 CAS，只登记来源引用，不改写剧本。

两个来源绑定端点都要求幂等键原样包含 8..200 个可见 ASCII 字符（`U+0021..U+007E`），确保同一键可通过 JSON 和恢复请求头传输。不对该键做 trim、编码或改写；项目与剧集 ID 保持原有 Unicode 约定。

精确的 `jason.qingmu-stage-source-result.v1` 回执必须绑定所请求来源、下一条绑定修订号、方法与规则哈希、定义，以及本次请求的会话 SHA。Host 重算绑定 SHA，并拒绝任何工件创建、阶段批准、锁激活、计划封存、人工签收、返修或 Provider 调用声明。单集剧本引用不满足 A1S 的完整输出要求，也不会使工作集权威变为可用。

`recoverStageSourceBinding` 向该绑定路径加 `/command-receipt` 发送一次 `GET`，携带原 `expectedSubjectSha256` query 和 `Idempotency-Key` 请求头。它校验原 `jason.qingmu-stage-source-recovery.v1` 包装层及内嵌 `receipt`；回执缺失或范围错误时仍是上游 404，不包装成成功的 `found` 响应。恢复既不需要当前来源，也不要求今天的 HMAC 密钥或原 bearer-token 会话相同。中断的写入绝不自动重试。会话或证明变化后不再是原 POST 意图，应改用回执恢复。

## 不可变阶段工件登记

`registerStageArtifact` 接收项目、单集、阶段与范围坐标，一份准确 V6 工件，工件记录修订/SHA 比较条件，可见 ASCII 幂等键，以及当前 Host 签名的 `qingmu.imago-stage-artifact-method.v1` 投影。Host 独立把工件 SHA 与修订绑定到主体，校验当前阶段定义及其版本、机器校验结果、规则摘要与 HMAC 证明，并拒绝一切批准或执行授权。它通过同一套只限阶段工件、兼容 Python 的有限数字定点表示序列化工件，并在传输前拒绝物理 JSON 嵌套超过易梦路由的 64 层上限。随后它只向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/stage-artifacts/{stageId}/{scopeInstance}` 发送一次 `POST`。路径 ID、actor、自然人身份和 session 绝不接受浏览器在 POST 正文中指定；这些身份只由易梦认证和事务掌管。

准确回执绑定不可变工件、下一记录修订、方法与规则哈希、认证生产者身份和本次请求的会话 SHA。Host 重算记录 SHA，并要求 `stageArtifactRegistered: true`，同时确保工件可用性、依赖权威、阶段批准、锁激活、计划封存、人工签收、返修和 Provider 调用保持 false 或零。因此，登记不会满足依赖、批准阶段、激活锁、封存 LSU 计划或启动生产工作。

`recoverStageArtifactRegistration` 只接收原始坐标、主体 SHA 与幂等键。它向同一路径加 `/command-receipt` 发送一次无正文 `GET`，在 `Idempotency-Key` 请求头中保留原键，在 query 中携带主体 SHA。它只接受准确的 `jason.qingmu-stage-artifact-recovery.v1` 包装层，并重新校验内嵌原回执。恢复特意不要求今天的工件、当前 HMAC 密钥或历史 bearer-token 会话仍然相同。结果不确定的登记 POST 绝不重试。

## 绑定准确记录的独立阶段决定

`commitStageArtifactDecision` 接收一次明确的 `approve`、`reject` 或 `request_changes` 意图与理由，并绑定准确的当前工件记录修订/SHA、工件修订/SHA、主体 SHA 和完整准确工件。调用方不能提供方法投影、投影 SHA 或证明。受信 Host 针对该工件调用当前已加载的 `stageArtifactMethod` 能力，重新核验其投影、规则摘要、阶段定义、主体绑定和 HMAC 证明，再向同一阶段工件路径加 `/decisions` 发送一次 POST。调用方也不能提供 actor、自然人身份、岗位或 session 字段；这些事实由易梦认证派生。易梦还负责强制生产者与批准者是不同自然人、重新计算当前上游与锁权威，并拥有唯一持久决定账本。

结果必须绑定准确工件记录、方法与规则、认证批准者及会话、生产者身份和易梦计算的依赖快照。只有快照已核验时才接受批准；来源、规则、记录、工件、修订、SHA 或锁事件任一漂移，都会在易梦失败关闭。`reject` 与 `request_changes` 绝不会让工件变为可用。有效批准只能激活已登记阶段定义声明的锁。所有结果都必须保持计划封存、推断人工签收、返修执行和 Provider 调用为 false 或零。Harness 只校验这些声明，不计算或保存依赖权威，也不增加第二套 DAG 或状态机。

`recoverStageArtifactDecision` 只接收原始阶段坐标、工件记录修订/SHA 与幂等键。它向 `/decision-command-receipt` 发送一次无正文 `GET`，query 保留记录坐标，请求头保留原幂等键，并重新校验原始准确回执。恢复不要求今天的 HMAC 密钥或历史 bearer 会话仍然相同，也绝不重提结果不确定的决定 POST。

`probeStageArtifactAuthority` 是只读的当前权威路径。它接收准确的工件记录修订/SHA、工件修订/SHA、主体 SHA 和完整准确工件。受信 Host 在内部调用当前已加载的 `stageArtifactMethod` 能力，并把新鲜证明随一次不含调用方身份或幂等字段的 POST 转发到 `/authority-probe`。调用方夹带的历史方法字段会在该能力运行前被拒绝。只有易梦重算的依赖快照、当前决定、规则 SHA、可用性、批准状态和当前阶段定义声明的准确锁彼此一致时，Harness 才接受紧凑结果。普通工件 `GET` 仍只是历史 feed；没有这份新鲜证明时，它有意不授予当前权威。因此，规则或血缘漂移会返回一份没有当前批准的有效失败关闭探针，而不会复活旧决定。

## 准确完整范围 LSU 计划封存

`sealLsuPlan` 只接受项目/剧集坐标、预期当前主体 SHA、上一计划修订/SHA 的 CAS 对，以及一个可见 ASCII 幂等键。调用方不能提供 Method、actor、自然人身份、session、批准或锁声明。Host 调用当前已加载的 `lsuPlanMethod`，校验其完整主体、定义、规则代际、投影 SHA 和 HMAC，随后只向 `/lsu-plan/seals` 转发一次 POST。只有易梦负责认证所有者、重新核对准确当前生产单元绑定与已批准 C5F 制作蓝图锁、执行 CAS，并在既有三本账中持久化封存。

回执绑定下一修订、完整主体、Method/规则 SHA、认证所有者与会话、事件及 ChangeSet。它只授予 `planSealed: true`；Stage 批准、锁激活、Provider 调用、推断签收和返修仍为 false 或零。结果不确定的 POST 绝不重试。`recoverLsuPlanSeal` 使用原主体 SHA、计划 CAS 坐标和幂等键发送一次无正文 GET，不要求今日 Method 密钥或历史 bearer 会话仍相同。`probeLsuPlanAuthority` 每次都重编新鲜 Method，并让易梦判断最新历史封存是否仍匹配今日完整主体和两组规则代际；普通来源读取和旧回执都不授予当前权威。

## 安全边界

上游必须是回环 HTTP(S)。适配器绝不返回 Host bearer 凭据、不发送 Cookie、拒绝重定向、限制载荷大小和请求时长，并且不会把非成功响应正文反射到错误中。成功的阶段登记与恢复响应会保持完整，直到整份业务 schema 校验结束，因此名为 `token` 的合法回执字段不会被通用秘密脱敏误删。校验后，任意键或字符串只要包含当前实际 bearer 凭据，就会用静态错误失败关闭。合同失败仍只返回静态安全错误。浏览器只接收经过校验的命令数据和持久回执标识。

阶段决定结果、恢复出的决定回执和权威探针同样先经过整份 schema 校验，再执行凭据反射检查。

## 模型体验

### Host 命令桥

#### 模型可见内容

无。命令由认证浏览器界面发起，并通过 `/qingmu-yimeng-command` 返回同一个 Client 连接。本包不注册模型工具或提示词上下文。

#### token 影响

直接模型 token 影响为零。

#### KV Cache 影响

相互独立。命令请求不会修改模型请求或可复用前缀。

## 已知限制与延期工作

- 这个本地适配器不是面向互联网的网关。
- 它实现 `episode_script` 以及人物、环境、道具 `element_profile` ChangeSet 垂直切片，支持显式的参考资产选择与重生成请求意图，记录所选视频 Finding，并登记生产单元范围、单集剧本来源引用、机器校验阶段工件和完整范围 LSU 计划封存。它还传递绑定准确记录的独立阶段决定、只读回执恢复和新鲜签名的当前权威探针，但依赖、锁和当前计划权威只由易梦计算和持久化。真实生成和自动创意批准不属于这些操作；登记、批准或计划封存本身都不代表生产流程已完成。
- 它不启动 outbox dispatcher，也不跨进程传输事件。
- ChangeSet 提案发生冲突时，必须先重新读取权威数据，再由用户明确创建新提案。
- 回执恢复依赖易梦保留原始命令回执；血缘错配时一律失败关闭。Finding 回执不存在时返回 `not_found`，不会重新提交写入。
