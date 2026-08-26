# 青木易梦命令适配器

[English](README.md) | 中文

这个私有实验性 Host 插件通过仅限回环地址的 `/qingmu-yimeng-command` 通道，暴露易梦 `episode_script` 与人物、环境、道具 `element_profile` ChangeSet 的显式流程。剧本操作继续是 `proposeScript`、`previewScript`、`commitScript` 和只读的 `recoverScriptCommit`；元素操作是 `proposeElementProfile`、`proposeReferenceAsset`、`previewElementProfile`、`commitElementProfile` 和只读的 `recoverElementProfileCommit`。

## 命令边界

适配器自身不写数据库。它校验浏览器输入，只从 Host 环境获取 `YIMENG_API_TOKEN`，并把命令转发给易梦拥有的 HTTP API。项目归属、修订检查、持久 ChangeSet、幂等回执、outbox 事件和下游失效仍由易梦掌权。

提案不等于提交。Client 必须展示返回的预览，并且只有当 `canCommit` 为 true 且用户明确确认后才可提交。提交回执不等于人工创意签收，也不授权付费 Provider 调用。

元素命令使用通用的 `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` 路由族。运行时只接受准确的 `actor`、`scene` 和 `prop`，其他类型全部失败关闭。预览与提交校验把 ChangeSet、subject 坐标、修订号、snapshot 与 payload 哈希、operation，以及不授予权力的 preflight 标记绑定到原始浏览器请求。

每一类元素提案都必须携带字段精确的六字段 `qingmu.imago-element-method-attestation.v1` 证明。适配器会在转发前拒绝多余或缺失字段、非小写 64 位十六进制摘要，以及投影、输入快照或 subject 哈希绑定错配。它原样转发已校验的投影、投影哈希与证明；命令链和浏览器都不读取 IMAGO 证明密钥，也不自行签名。返回的预览与回执还必须只包含七组标准影响数组及相匹配的 canonical `impactSha256`；多余或缺失影响字段都会失败关闭。

`proposeReferenceAsset` 只接受当前 `qingmu.imago-reference-asset-method-projection.v1` 与专用证明。Host 从环境读取至少 32 个 UTF-8 字节的 `QINGMU_IMAGO_ATTESTATION_KEY`，对字段精确的未签名证明执行 HMAC-SHA256，并以 timing-safe 方式比较签名；随后把投影、输入快照、目标、operation、候选资产 ID/SHA、修订号和易梦 snapshot SHA 逐项绑定。密钥、投影和证明都不会发送给易梦，也不会成为浏览器签名权力。通用 preview、commit、recovery 只在 Host 合同内保留准确 operation 与候选血缘，HTTP body 仍复用现有通用结构。

`selectReferenceAsset` 只记录用户明确的选择意图，不等于人工批准或签收。`requestReferenceRegeneration` 必须带非空 `repairPrompt`，并且只记录意图：成功预览和回执必须保持 `providerCalls: 0`、`workerStarted: false`，且不推断人工批准。两种操作都不会启动生成，也不会静默代选候选。

回执恢复只会向易梦 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/change-sets/{changeSetId}/command-receipt` 精确发送一次 `GET`；三类元素档案都使用对应的通用元素路由。两者都只使用原始 `Idempotency-Key` 请求头，不带请求体或 query。适配器只接受 `jason.qingmu-command-receipt-recovery.v1` wrapper，并重新核验其中原始提交回执的全部血缘；在接受 wrapper 的 `receiptSha256` 前，还会重算原始回执的 canonical JSON SHA-256；它绝不会重试 commit `POST`。

## 安全边界

上游必须是回环 HTTP(S)。适配器绝不返回 Host 令牌、不发送 Cookie、拒绝重定向、限制载荷大小和请求时长，并且不会把上游响应正文反射到错误中。浏览器只接收经过校验的 ChangeSet 数据和持久回执标识。

## 模型体验

### Host 命令桥

#### 模型可见内容

无。命令由认证浏览器界面发起，并通过 `/qingmu-yimeng-command` 返回同一个 Client 连接。本包不注册模型工具或提示词上下文。

#### token 影响

直接模型 token 影响为零。

#### KV Cache 影响

相互独立。ChangeSet 请求不会修改模型请求或可复用前缀。

## 已知限制与延期工作

- 这个本地适配器不是面向互联网的网关。
- 它实现 `episode_script` 以及人物、环境、道具 `element_profile` ChangeSet 垂直切片，并支持显式的参考资产选择与重生成请求意图。PromptIR、真实生成、评论、批准、签收和创意审核决定仍不属于本适配器，因此这不表示 Phase 3 已完成。
- 它不启动 outbox dispatcher，也不跨进程传输事件。
- 冲突恢复必须先重新读取权威数据，再由用户明确创建新提案。
- 回执恢复依赖易梦保留原始命令回执；回执不存在或血缘错配时一律失败关闭。
