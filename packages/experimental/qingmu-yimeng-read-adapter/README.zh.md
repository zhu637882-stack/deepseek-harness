# 青木易梦只读适配器

[English](README.md) | 中文

这个私有实验性 Host 插件是青木 OS 与易梦 API 之间的只读 BFF。它注册仅限回环地址的 `/qingmu-yimeng` RPC 通道，并暴露 `health`、`projects`、`episodes`、`script`、`elementProfile`、`referenceCandidates` 和 `workflow`；它不暴露任何写入端点。

## 约定

`health` 归一化匿名存活与运行身份字段。`projects` 归一化分页，`episodes` 返回经过校验的项目剧集列表，`script` 返回权威结构化分集剧本、乐观并发修订号和经 Host 验证的 `scriptSha256`，`elementProfile` 从 `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` 读取人物、环境或道具，`referenceCandidates` 从同一元素路由的 `/reference-candidates` 子路由读取候选资产，`workflow` 要求准确的 `jason.episode-workflow-projection.v1` schema 及其强顶层字段，同时保留未知 JSON 字段。

剧本存在时，易梦会同时返回准确的 Python canonical JSON 原文、其 SHA-256 与解析后的剧本。Host 对 canonical 原文的 UTF-8 字节重算哈希，再解析原文，递归拒绝两个解析投影中的非有限数和超出 JavaScript 安全范围的整数，最后与 `script` 深度比较；哈希、数字安全或内容任何错配都会失败关闭。随后 Host 移除 canonical 原文，浏览器只接收解析后的剧本与已验证的 `scriptSha256`。Python `1e-06` 这类合法有限浮点数仍然有效。`found: false` 时，上游 canonical 原文和哈希都必须是 `null`。

三类元素档案使用同一证据边界：Host 对 `canonicalSnapshot` 原文字节重算哈希，解析并检查 JSON 安全数字，与 `jason.qingmu-element-profile-subject.v1` subject 深度比较，并在返回经验证的 `snapshotSha256` 前移除 `canonicalSnapshot`。运行时只接受准确的 `actor`、`scene` 和 `prop`：人物 subject 绑定 `actorId` 与 `visualIdentity`，环境和道具 subject 分别绑定 `sceneId` 或 `propId` 以及 `visualPrompt`。其他类型、标识、字段或 subject 形状错配都会失败关闭。

`referenceCandidates` 要求 `jason.qingmu-reference-asset-candidates.v1`、`targetType: element_profile`、请求中的项目、元素类型与目标 ID、非负档案修订号、小写 `elementSnapshotSha256`，以及字面值 `humanApprovalInferred: false`。每个返回候选只包含 `assetId`、`sha256`、`materializedSha256`、`bindingValid`、`projectId`、`sourceEpisodeId`、`ownerType`、`ownerId`、`role`、`localPath`、`qualityStatus`、`selectionStatus`、`isSelected`、`generationJobId`、`sourceRevisionId`、`formalConsistencyCheckId`、`formalConsistencyPassed`、`qualityProjectionSha256`、`decisionKind` 和 `decisionIdentity`。Host 会先校验候选的项目与 owner 绑定、ID、布尔值、SHA-256 字段，以及准确的 `Unselected | Selected | Rejected | Stale`、`pending | passed | failed` 和 `none | referenceSelection | humanReview` 取值集合，再返回投影。

`workflow.director.heroFrameStoryboards` 同级投影与 E5-1 权威 Shot 及准确分镜修订一对一连接。Host 会校验已选择首帧资产的绑定、有界整数 `0..10000` 标注坐标、Shot 内人物/道具引用、确定性的 `subjectLayout`、`objectAnchors` 与 `actionTrajectory` 编译结果，以及全部稳定 SHA。会过期的 `browserUrl` 被明确排除在 `shotsSha256` 之外，资产 ID、媒体 SHA 和绑定 SHA 仍在哈希覆盖范围内。这个对象只是只读投影，不是第二个画布仓库或修订系统。

包根入口导出请求与响应类型，包括 `YimengHealth`、`YimengProjectsResponse`、`YimengEpisodesResponse`、`YimengScriptResponse`、`YimengElementProfileRequest`、`YimengElementProfileResponse`、`YimengReferenceAssetCandidate`、`YimengReferenceCandidatesRequest`、`YimengReferenceCandidatesResponse`、`YimengHeroFrameStoryboardsProjection` 和 `YimengWorkflowProjection`。

## 安全边界

默认上游为 `http://127.0.0.1:8115`。配置的基础 URL 必须继续使用 HTTP 或 HTTPS 回环地址。受保护读取从 Host 环境获取 `YIMENG_API_TOKEN`，并且只通过 `Authorization: Bearer` 请求头发送；适配器不读取 `localStorage` 或 `JWT_SECRET`、不发送 Cookie，也不返回令牌。请求使用 `cache: no-store`，并具有超时、调用方取消和失败关闭的重定向处理。普通 JSON 响应继续限制为 5 MiB；只有剧本响应单独限制为 20 MiB，使接近 5 MiB 的合法命令体仍可回传解析后剧本及其转义后的 canonical 证据，同时保持读取有界。

## 三项相互独立的权力

- Harness 执行权限不授予修改易梦数据的权限。
- `budget.valid`、剩余额度、`releaseReady` 和 `qualityPassed` 都是状态事实，绝不构成付费 Provider 授权。
- 适配器把人工签收与生产就绪明确标记为“不推断”；只有可核验的认证人工审核才能提供人工接受结论。

## 模型体验

### Host 只读投影

#### 模型可见内容

无。`/qingmu-yimeng` 响应只返回给 Client 连接；适配器不注册提示词、工具 schema、工具结果或其他模型可见上下文。

#### token 影响

直接 token 影响为零，因为响应只返回给发起请求的 Client 连接。

#### KV Cache 影响

相互独立。读取或取消投影不会改变模型请求或其可复用前缀。

## 已知限制与延期工作

- 适配器继续保持只读且仅限本地使用。剧本修改走独立私有命令适配器与明确的 ChangeSet 预览；本通道没有写入、生成、批准或发布端点。
- Host 凭据缺失时，受保护读取会在任何上游请求前失败。
- 浏览器不复现 Python canonical JSON；完整性比较只使用 Host 已验证的 `scriptSha256`，因此也覆盖 `1e-06` 这类合法 Python 浮点表示。
- 健康响应只证明存活，工作流投影只报告事实，不授权生产或交付。
