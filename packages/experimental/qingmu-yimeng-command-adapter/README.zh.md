# 青木易梦命令适配器

[English](README.md) | 中文

这个私有实验性 Host 插件通过仅限回环地址的 `/qingmu-yimeng-command` 通道，暴露易梦 `episode_script` 与人物、环境、道具 `element_profile` ChangeSet 的显式流程。剧本操作继续是 `proposeScript`、`previewScript`、`commitScript` 和只读的 `recoverScriptCommit`；元素操作是 `proposeElementProfile`、`proposeReferenceAsset`、`previewElementProfile`、`commitElementProfile` 和只读的 `recoverElementProfileCommit`。所选视频 Finding 使用 `recordShotFinding` 和只读的 `recoverShotFinding`。

## 命令边界

适配器自身不写数据库。它校验浏览器输入，只从 Host 环境获取 `YIMENG_API_TOKEN`，并把命令转发给易梦拥有的 HTTP API。项目归属、修订检查、持久 ChangeSet、幂等回执、outbox 事件和下游失效仍由易梦掌权。

ChangeSet 提案不等于提交。Client 必须展示返回的预览，并且只有当 `canCommit` 为 true 且用户明确确认后才可提交。提交回执不等于人工创意签收，也不授权付费 Provider 调用。

元素命令使用通用的 `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` 路由族。运行时只接受准确的 `actor`、`scene` 和 `prop`，其他类型全部失败关闭。预览与提交校验把 ChangeSet、subject 坐标、修订号、snapshot 与 payload 哈希、operation，以及不授予权力的 preflight 标记绑定到原始浏览器请求。

每一类元素提案都必须携带字段精确的六字段 `qingmu.imago-element-method-attestation.v1` 证明。适配器会在转发前拒绝多余或缺失字段、非小写 64 位十六进制摘要，以及投影、输入快照或 subject 哈希绑定错配。这条元素档案提案链原样转发已校验的投影、投影哈希与证明，不读取 IMAGO 证明密钥，也不自行签名。返回的预览与回执还必须只包含七组标准影响数组及相匹配的 canonical `impactSha256`；多余或缺失影响字段都会失败关闭。

`proposeReferenceAsset` 只接受当前 `qingmu.imago-reference-asset-method-projection.v1` 与专用证明。Host 从环境读取至少 32 个 UTF-8 字节的 `QINGMU_IMAGO_ATTESTATION_KEY`，对字段精确的未签名证明执行 HMAC-SHA256，并以 timing-safe 方式比较签名；随后把投影、输入快照、目标、operation、候选资产 ID/SHA、修订号和易梦 snapshot SHA 逐项绑定。密钥、投影和证明都不会发送给易梦，也不会成为浏览器签名权力。通用 preview、commit、recovery 只在 Host 合同内保留准确 operation 与候选血缘，HTTP body 仍复用现有通用结构。

`selectReferenceAsset` 只记录用户明确的选择意图，不等于人工批准或签收。`requestReferenceRegeneration` 必须带非空 `repairPrompt`，并且只记录意图：成功预览和回执必须保持 `providerCalls: 0`、`workerStarted: false`，且不推断人工批准。两种操作都不会启动生成，也不会静默代选候选。

回执恢复只会向易梦 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/change-sets/{changeSetId}/command-receipt` 精确发送一次 `GET`；三类元素档案都使用对应的通用元素路由。两者都只使用原始 `Idempotency-Key` 请求头，不带请求体或 query。适配器只接受 `jason.qingmu-command-receipt-recovery.v1` wrapper，并重新核验其中原始提交回执的全部血缘；在接受 wrapper 的 `receiptSha256` 前，还会重算原始回执的 canonical JSON SHA-256；它绝不会重试 commit `POST`。

## 镜头视频 Finding

`recordShotFinding` 接收[请求类型](src/types.ts)定义的项目、剧集与镜头 ID、预期 subject SHA、幂等键、八个明确填写的 Finding 字段、方法投影、投影 SHA 和证明。它校验 canonical subject 与投影摘要，并使用 Host 的 `QINGMU_IMAGO_ATTESTATION_KEY` 核验 HMAC-SHA256 证明，之后再校验规则摘要和方法中的责任岗位选项。密钥至少需要 32 个 UTF-8 字节。多余字段、非法严重度或责任岗位，以及绑定错配都失败关闭。作者原文和重复的证据引用均予保留；不会推断严重度或责任岗位。

适配器只向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/findings` 发送一次 `POST`，请求体不含三个路径 ID，也绝不提供 actor 或 session 字段。易梦要求显式的项目 reviewer 功能权限，并只记录 `OPEN` Finding，不批准、不改变选择、不执行返工，也不调用 Provider。响应必须保留提交字段与 subject、方法和规则哈希；认证会话 SHA 必须匹配本次请求使用的令牌。失败或中断的 `POST` 绝不自动重试。

`recoverShotFinding` 只接收三个 ID、原 subject SHA 和幂等键。它向相同路径加 `/command-receipt` 发送一次 `GET`，query 携带 `expectedSubjectSha256`，请求头携带原 `Idempotency-Key`。它只接受相匹配的 `committed` 结果，或 `result: null` 的 `not_found`。恢复仍由易梦认证，但不会读取当前 subject，也不要求历史记录匹配今天的 HMAC 密钥或 bearer-token 会话。

## 生产单元范围绑定

`bindProductionUnit` 把明确选择的单元 ID 登记到现有原生镜头组。请求将项目、剧集、镜头组和单元 ID 绑定到当前来源 SHA、上一条绑定修订号/SHA，以及带证明的 `qingmu.imago-production-unit-method.v1` 投影。修订号为零时，上一条 SHA 必须为 null。Host 先核验来源与方法摘要、HMAC 证明、方法定义和规则摘要，再向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/production-units/{unitId}/binding` 发送一次 `POST`。actor 和 session 字段来自易梦认证，绝不接受浏览器指定。

回执必须匹配这些坐标、下一条绑定修订号、方法与规则哈希、定义和本次请求的会话 SHA。`planSealed`、`humanSignoffInferred` 和 `reworkExecuted` 必须保持 false，`providerCalls` 必须保持零。范围绑定既不封存 LSU 计划，也不创建 StageInstance、批准、工作集或生成任务。

`recoverProductionUnitBinding` 向相同绑定路径加 `/command-receipt` 发送一次 `GET`，query 携带原镜头组 ID 和来源 SHA，请求头携带原 `Idempotency-Key`。它只接受相匹配的 `found: true` 回执，或 `result: null` 的 `found: false`。恢复不要求今天的来源、HMAC 密钥或历史 bearer-token 会话仍然相同。中断的写入绝不自动重试；回执损坏和血缘错配均失败关闭。

## 安全边界

上游必须是回环 HTTP(S)。适配器绝不返回 Host 令牌、不发送 Cookie、拒绝重定向、限制载荷大小和请求时长，并且不会把上游响应正文反射到错误中。浏览器只接收经过校验的命令数据和持久回执标识。

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
- 它实现 `episode_script` 以及人物、环境、道具 `element_profile` ChangeSet 垂直切片，支持显式的参考资产选择与重生成请求意图，记录所选视频 Finding，并登记生产单元范围绑定。真实生成和自动创意批准不属于这些操作；仅登记范围不代表生产流程已完成。
- 它不启动 outbox dispatcher，也不跨进程传输事件。
- 冲突恢复必须先重新读取权威数据，再由用户明确创建新提案。
- 回执恢复依赖易梦保留原始命令回执；血缘错配时一律失败关闭。Finding 回执不存在时返回 `not_found`，不会重新提交写入。
