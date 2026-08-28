# 青木易梦只读适配器

[English](README.md) | 中文

这个私有实验性 Host 插件是青木 OS 与易梦 API 之间的只读 BFF。它注册仅限回环地址的 `/qingmu-yimeng` RPC 通道，并暴露 `health`、`capabilityCatalog`、`costRehearsal`、`gateAControlEvidence`、`projects`、`episodes`、`script`、`elementProfile`、`referenceCandidates`、`selectedVideoReview`、`takeVersions`、`takeComments`、`takeAcceptance`、`takeReviewAuthority`、`takeTechnicalQc`、`takeApprovalLifecycle`、`shotFindings`、`productionUnits`、`lsuPlanSource`、`stageSources` 和 `workflow`；它不暴露任何写入端点。

## 约定

`health` 归一化匿名存活与运行身份字段。`projects` 归一化分页，`episodes` 返回经过校验的项目剧集列表，`script` 返回权威结构化分集剧本、乐观并发修订号和经 Host 验证的 `scriptSha256`，`elementProfile` 从 `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` 读取人物、环境或道具，`referenceCandidates` 从同一元素路由的 `/reference-candidates` 子路由读取候选资产，`workflow` 要求准确的 `jason.episode-workflow-projection.v1` schema 及其强顶层字段，同时保留未知 JSON 字段。

剧本存在时，易梦会同时返回准确的 Python canonical JSON 原文、其 SHA-256 与解析后的剧本。Host 对 canonical 原文的 UTF-8 字节重算哈希，再解析原文，递归拒绝两个解析投影中的非有限数和超出 JavaScript 安全范围的整数，最后与 `script` 深度比较；哈希、数字安全或内容任何错配都会失败关闭。随后 Host 移除 canonical 原文，浏览器只接收解析后的剧本与已验证的 `scriptSha256`。Python `1e-06` 这类合法有限浮点数仍然有效。`found: false` 时，上游 canonical 原文和哈希都必须是 `null`。

三类元素档案使用同一证据边界：Host 对 `canonicalSnapshot` 原文字节重算哈希，解析并检查 JSON 安全数字，与 `jason.qingmu-element-profile-subject.v1` subject 深度比较，并在返回经验证的 `snapshotSha256` 前移除 `canonicalSnapshot`。运行时只接受准确的 `actor`、`scene` 和 `prop`：人物 subject 绑定 `actorId` 与 `visualIdentity`，环境和道具 subject 分别绑定 `sceneId` 或 `propId` 以及 `visualPrompt`。其他类型、标识、字段或 subject 形状错配都会失败关闭。

`referenceCandidates` 要求 `jason.qingmu-reference-asset-candidates.v1`、`targetType: element_profile`、请求中的项目、元素类型与目标 ID、非负档案修订号、小写 `elementSnapshotSha256`，以及字面值 `humanApprovalInferred: false`。每个返回候选只包含 `assetId`、`sha256`、`materializedSha256`、`bindingValid`、`projectId`、`sourceEpisodeId`、`ownerType`、`ownerId`、`role`、`localPath`、`qualityStatus`、`selectionStatus`、`isSelected`、`generationJobId`、`sourceRevisionId`、`formalConsistencyCheckId`、`formalConsistencyPassed`、`qualityProjectionSha256`、`decisionKind` 和 `decisionIdentity`。Host 会先校验候选的项目与 owner 绑定、ID、布尔值、SHA-256 字段，以及准确的 `Unselected | Selected | Rejected | Stale`、`pending | passed | failed` 和 `none | referenceSelection | humanReview` 取值集合，再返回投影。

`workflow.director.heroFrameStoryboards` 同级投影与 E5-1 权威 Shot 及准确分镜修订一对一连接。Host 会校验已选择首帧资产的绑定、有界整数 `0..10000` 标注坐标、Shot 内人物/道具引用、确定性的 `subjectLayout`、`objectAnchors` 与 `actionTrajectory` 编译结果，以及全部稳定 SHA。会过期的 `browserUrl` 被明确排除在 `shotsSha256` 之外，资产 ID、媒体 SHA 和绑定 SHA 仍在哈希覆盖范围内。这个对象只是只读投影，不是第二个画布仓库或修订系统。

`workflow.director.shotRelations.shots` 数组投影易梦权威故事板帧，不增加 Shot 真源。每个 Shot 携带 `shotId`、唯一 Shot 排序字段 `frameNo`、`durationSec` 和派生的 `dialogueRhythm`；它绝不携带 Shot 级 `order`、`sortOrder` 或 `sequence`。每个元素携带 `currentReferenceAvailability`，并携带 `currentReference: null` 或 E4-3 唯一当前已选参考的 `assetId`、`sha256` 与血缘。适配器不选择参考，也不持久化 Shot 选择状态。

包根入口导出请求与响应类型，包括 `YimengHealth`、`YimengCostRehearsalRequest`、`YimengCostRehearsalSubject`、`YimengCostRehearsalResponse`、`YimengProjectsResponse`、`YimengEpisodesResponse`、`YimengScriptResponse`、`YimengElementProfileRequest`、`YimengElementProfileResponse`、`YimengReferenceAssetCandidate`、`YimengReferenceCandidatesRequest`、`YimengReferenceCandidatesResponse`、`YimengTakeVersionStackResponse`、`YimengTakeCommentFeedResponse`、`YimengTakeAcceptanceResponse`、`YimengTakeReviewAuthorityFeedResponse`、`YimengTakeTechnicalQcFeedResponse`、`YimengTakeApprovalLifecycleFeedResponse`、`YimengShotRelationShot`、`YimengShotDialogueCue`、`YimengShotDialogueRhythm`、`YimengShotCurrentReference`、`YimengShotCurrentReferenceLineage`、`YimengShotRelationsProjection`、`YimengHeroFrameStoryboardsProjection` 和 `YimengWorkflowProjection`。

## Gate A 能力目录

`capabilityCatalog` 接受可选的 `modelId`、`capability` 以及排序去重后的 `requestedControls`，随后向易梦现有模型目录服务发送一次认证 GET。Host 使用 RFC 8785 JCS 独立重编每个模型快照，校验内容寻址 ID 和准确请求/目录身份，并根据规范请求与已声明互斥规则重新计算 eligibility。单一预检 SHA 绑定目录、请求、条目 ID 与重算结果。字节、身份、请求、字段、顺序、决定或权力边界任何漂移都会失败关闭。

投影固定为 `UNVERIFIED_FOR_PAID_PRODUCTION`、`providerCalls: 0`、`databaseWrites: 0` 和 `paidGenerationAuthorized: false`。真实模型缺少互斥声明时保留为明确错误；适配器不补造 Provider 事实，也不把目录中既有付费调度字段解释为当前授权。dry-run eligibility 只核对所请求的能力与控制组合，不创建任务、预算预留、数据库记录、Provider 请求、路由决定或人工签收。

## Gate A 费用演练

`costRehearsal` 接受一个 canonical frame、模型、能力、已排序控制项、分辨率、候选数量、刚由 Host 校验过的完整目录投影，以及它的准确目录、请求、预检与能力快照四个 SHA-256。它向易梦发送一次带认证且无请求体的 GET，目录投影本身不会进入 URL。权威镜头时长、目录单价、候选上限及只读 ProviderGate 预算投影只归易梦所有。Host 再次核验目录投影的 canonical bytes，独立推导 eligibility、费率与候选上限，校验全部回执字段，使用 RFC 8785 JCS 重编主体和完整回执，并以整数微元重算费用恒等式与预算窗口算术。候选数量不得超过所选能力快照声明的输出上限。

这只是预留提案演练，不是正式预留。正式预留 ID 为 `null`，正式预留金额与账本写入均为零，提交前实际费用不可用，项目/剧集额度明确保持 `NOT_CONFIGURED`；只投影既有全局 Provider 预算窗口。Provider、数据库、账本、任务、队列、提交、轮询、下载、Webhook 及付费权力字段只要不是字面零或 false，适配器就会失败关闭。Harness 不新增第二套预算账本、工作流状态、预留权力或业务真相。

## 离线 Gate A 控制证据

`gateAControlEvidence` 只接受空请求，并向易梦既有 `/api/qingmu/provider-gate-a/control-evidence` 端点发送一次带认证且无请求体的 GET。Host 要求未授权拦截、重复确认、载荷 SHA 冲突、`submission_unknown` 隔离、模拟对账、轮询恢复、下载恢复和截断下载拒绝这八个场景及其断言使用准确顺序；同时校验规范相对源码路径、每个源码 SHA-256、固定的临时 SQLite／脚本化 Fake 环境，以及 RFC 8785 内容寻址证据 SHA。

这份回执只证明离线故障注入控制逻辑。外部 Provider 调用、正式数据库写入、预算账本写入、重复付费提交、未知状态自动重提、对账 Provider 调用、恢复重提、接受截断及网络外连必须保持字面零，否则适配器失败关闭。端点不能运行场景、对账任务、生成媒体、提交任务、授予付费权力或推断人工签收；真实付费生产仍为 `UNVERIFIED_FOR_PAID_PRODUCTION`。

## 连续性证据

可选的 `workflow.director.continuityDelta` 字段使用 `jason.qingmu-continuity-delta.v1`，绑定准确分镜修订及按 `frameNo` 排序的全部相邻 canonical Shot。字段存在时校验精确字段集、来源 SHA、ID、布尔值、有序四维记录、当前绑定和历史就绪关系；错误证据使工作流读取失败关闭。旧上游省略字段仍可兼容。

当前 SHA 必须有具名物化素材。审计 ID 缺失时可保留原始 SHA 声明，但不完整证据不能声称历史就绪或当前绑定。`legacyEvidenceReady` 保留易梦原有历史语义；`currentEvidenceReady` 还要求当前/审计素材 ID 与 SHA 相同、选定视频与尾帧任务血缘一致、下镜首帧已选且非 Stale，并且 handoff 未过期。未知维度保持 `null`。不创建检查、选择、Finding、锁实例或人工批准。

## 已选视频审核

`selectedVideoReview` 只接受项目、剧集与 canonical frame 三个 ID。它复用易梦已有 `/api/frames/{frameId}/video-candidates` GET，只返回唯一当前选中素材的元数据。根主体、选择标志、审核状态、决定、素材 ID/SHA、修订、数值和通过检查必须一致。待审、过期或不可用响应不能夹带旧审核；未选中的已通过候选不会被提升为当前素材。

规范化响应保留原始缺陷、备注，以及零、分数或 null 时间点。旧版缺少内容 SHA、缺陷时明确保留缺失。当前媒体与帧绑定由易梦核验；Host 不计算媒体字节哈希，不可用素材的存储 SHA 也不证明当前文件。媒体 URL、素材时间戳和费用均不透传。既有机器失败例外只作为原记录展示，不变成机器通过或经独立重验的批准权威。本读取不创建 Finding、锁、任务、选择或人工签收。

## 已选 Take 验收证据

`takeAcceptance` 只接受 `projectId`、`episodeId` 和 canonical `frameId`，随后向已选 Take 的 `/take-versions/acceptance` 路由发送一次认证且无正文的 GET。Host 会校验 RFC 8785 证据 SHA、准确当前选择身份、输出 SHA 绑定、严格整片解码回执、基于帧数的实际平均帧率、当前宏观／微观 QC 记录，以及真实 Provider outbox 回执或明确受限的本地 dry-run 状态。未知字段失败关闭，因此本地路径、媒体 URL 与 Provider 原始响应都不能进入浏览器。

本地媒体和 QC 可以独立于 Provider 核验通过。因此即使历史 Provider outbox 回执已完全验证，响应仍保持 `UNVERIFIED_FOR_PAID_PRODUCTION`、`selectedIsApproval: false` 和 `gateBCompleted: false`。本读取不调用 Provider、不写数据库、不选择、不批准、不修改预算，也不推断人工签收。

## Take 普通评论

`takeComments` 只接受 `projectId`、`episodeId` 和 canonical `frameId`，随后向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/take-comments` 发送一次认证且无正文的 GET。Host 会校验字段精确的当前 Take 版本主体及其 RFC 8785 SHA-256 身份、不可变普通评论、时间码或帧锚点、经认证的评论者角色和服务端声明的 `currentBinding`；当前评论与历史评论均原样返回，不重新绑定。

易梦仍是唯一评论账本与 Take 主体权威。本读取不选择 Take、不创建 Finding、不改变技术通过或正式批准、不验证单集、不推断人工签收、不调用 Provider，也不修改预算。

## Reviewer 与 Approver 权威

`takeReviewAuthority` 一并读取当前 Take 主体、Reviewer 推荐与 Approver 决定，并校验准确哈希、认证角色和自然人身份。同一主体的 Approver 不能是生产者或审核参与者，切换角色或 session 也不能绕过自然人隔离。推荐不等于决定；两种动作均不改变选择、技术 QC、正式批准、单集验证、Provider 或预算状态。

## Take 技术 QC

`takeTechnicalQc` 读取当前已选 Take 的不可变技术评估。Host 校验固定的宏观／微观问题码分类、严格媒体回执与必检项、准确当前主体绑定、评估 SHA 和当前规则 SHA。只有回执通过且宏观、微观均无问题时才是技术通过。它仍只是技术证据：本读取不能批准内容、改变选择、创建 Finding、验证单集或推断人工签收。

## Take 批准生命周期

`takeApprovalLifecycle` 读取准确的当前已选 Take、当前 Approver 决定、当前技术评估、规则身份和不可变批准转换历史。Host 校验 canonical 来源字节、顺序、跨记录引用、认证角色、方法复审要求和当前规则 SHA。任一绑定的 Take、决定、QC 或规则身份漂移时，旧批准仍保留为审计历史，但立即失去当前效力。本读取不推导新合法动作，也不执行写入、返修、Provider 调用、Evidence 账本写入、单集验证或人工签收。

## 镜头问题账本

`shotFindings` 只接受 `projectId`、`episodeId` 和 canonical `frameId`，向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/findings` 发送一次认证 GET，不带请求体。当前选中视频主体与原始问题账本均由易梦持有。Host 校验精确字段、规范主体 SHA、正整数 `frameNo`、非负安全整数修订、八字段原文、`OPEN` 状态、记录者身份，以及唯一 Finding/event ID。资产缺少版本列时沿用已有零哨兵值，不虚构新版本。

响应区分 `currentBinding` 与历史；当前媒体缺失不会抹掉旧记录。`canRecordFinding` 只表示明确的项目 reviewer 功能权限，不代表媒体或方法可用，也不是批准。记录动作与 GET 回执恢复走独立命令适配器。本读取不代选 Owner、不改严重度、不批准视频，也不执行返修。

## 生产单元绑定

`productionUnits` 只接受 `projectId` 和 `episodeId`，向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/production-units` 发送一次认证 GET，不带请求体。它原样保留 `jason.qingmu-production-unit-feed.v1`：当前镜头组来源、各单元最新的显式绑定、所有者权限与原文。Host 校验精确字段、来源与绑定的规范 SHA、项目/剧集/组身份、唯一组/单元身份、正安全整数的组号与镜号、有序且唯一的成员镜头，以及非负分镜修订号。镜号可以不连续；不根据组号推导单元 ID。ID 与文本按 Python 空白语义和 Unicode 码点长度校验，不重写输入。

当前组不可用或不存在时，历史绑定仍可读取。`currentBinding` 必须与当前来源及其 SHA 精确一致；`canBindUnit` 只表示易梦已有的所有者权限。历史方法定义及其存储 SHA 原样保留，不按当前 Core 规则重新签证。响应固定 `planSealed: false`、`providerCalls: 0`、`humanSignoffInferred: false` 和 `reworkExecuted: false`。此端点不绑定单元、不封存计划、不批准 Stage、不选择媒体，也不执行返修。根入口和 `/types` 导出 `YimengProductionUnitsRequest`、`YimengProductionUnitsResponse`、`YimengProductionUnitSource`、`YimengProductionUnitDefinition` 与 `YimengProductionUnitBinding`。

## 当前 LSU 计划来源

`lsuPlanSource` 只接受 `projectId`、`episodeId` 和 Host 派生的当前 C5F 锁规则 SHA，向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/lsu-plan/source` 发送一次认证 GET，不带正文。准确的非空主体只含按序排列的当前生产单元绑定和已独立批准的 `PRODUCTION_BLUEPRINT_LOCK` 血缘。Host 会先校验唯一单元/镜头组 ID、正整数绑定与工件记录修订、规范 SHA、准确坐标及所请求的锁规则代际，Method 编译器才能使用它。

最新持久封存仍然只是历史证据。只有该封存的完整主体、主体 SHA 与锁规则 SHA 都匹配今日来源，`latestSealSourceCurrent` 才能为 true；当前范围不可用不会抹掉旧回执。`canSealPlan` 只报告易梦已有权限。本读取不会封存、批准 Stage、激活锁、执行返修、调用 Provider 或推断签收，也不会把历史回执提升为当前权威。

## 单集剧本来源引用

`stageSources` 只接受 `projectId` 和 `episodeId`，向 `/api/qingmu/projects/{projectId}/episodes/{episodeId}/stage-sources` 发送一次认证 GET，不带请求体。它校验 `jason.qingmu-stage-source-feed.v1`、固定的 `A1S` 坐标、七字段 `episode_script` 来源描述、规范主体与绑定哈希、绑定修订号、原回执 ID，以及不授予批准的标记。易梦对包含 metadata 的完整存储剧本 JSON 计算 `contentSha256`；此端点不携带剧本正文，Host 也不复算该内容哈希。

剧本缺失或变化时，`latestBinding` 仍保留原来源引用回执。`currentBinding` 只能是与当前来源及主体 SHA 精确一致的最新回执；不能用更早的相符记录替代。`canBind` 独立报告已有的所有者权限，不与来源可用性混为一谈。来源引用不等于 `SCREENPLAY_PACKAGE`、阶段完成、工件批准、锁或工作集权威。根入口和 `/types` 导出 `YimengStageSourcesRequest`、`YimengStageSourcesResponse`、`YimengStageSource`、`YimengStageSourceDefinition`、`YimengStageSourceBinding` 与 `YimengStageSourceResult`。

## 安全边界

同一个已配置处理函数还作为仅供 Host 使用的 `qingmuYimengRead` 能力提供给内部调用方。内部调用方可以复用原有 `workflow`、`productionUnits`、`lsuPlanSource` 与 `stageSources` GET，不另建 HTTP 客户端、令牌配置或缓存。Cordis 会在所属插件卸载时移除该能力。这不会把业务阶段完成、已选媒体或未知透传字段解释为具名 IMAGO Stage/LSU 批准。

默认上游为 `http://127.0.0.1:8115`。配置的基础 URL 必须继续使用 HTTP 或 HTTPS 回环地址。受保护读取从 Host 环境获取 `YIMENG_API_TOKEN`，并且只通过 `Authorization: Bearer` 请求头发送；适配器不读取 `localStorage` 或 `JWT_SECRET`、不发送 Cookie，也不返回令牌。请求使用 `cache: no-store`，并具有超时、调用方取消和失败关闭的重定向处理。普通 JSON 响应继续限制为 5 MiB；只有剧本响应单独限制为 20 MiB，使接近 5 MiB 的合法命令体仍可回传解析后剧本及其转义后的 canonical 证据，同时保持读取有界。

## 三项相互独立的权力

- Harness 执行权限不授予修改易梦数据的权限。
- `budget.valid`、剩余额度、`releaseReady` 和 `qualityPassed` 都是状态事实，绝不构成付费 Provider 授权。
- 适配器把人工签收与生产就绪明确标记为“不推断”；只有可核验的认证人工审核才能提供人工接受结论。

## 模型体验

### Host 只读投影

#### 模型可见内容

无。`/qingmu-yimeng` 响应返回给 Client 连接，`qingmuYimengRead` 供 Host 内部调用方使用；适配器不注册提示词、工具 schema、工具结果或其他模型可见上下文。

#### token 影响

直接 token 影响为零，因为读取结果不进入模型上下文。

#### KV Cache 影响

相互独立。读取或取消投影不会改变模型请求或其可复用前缀。

## 已知限制与延期工作

- 适配器继续保持只读且仅限本地使用。剧本修改走独立私有命令适配器与明确的 ChangeSet 预览；本通道没有写入、生成、批准或发布端点。
- Host 凭据缺失时，受保护读取会在任何上游请求前失败。
- 浏览器的剧本完整性比较只使用 Host 已验证的 `scriptSha256`，不复现 `1e-06` 等 Python 浮点写法。Finding 坐标只含安全整数，另行遵守受限的规范主体合同。
- 健康响应只证明存活，工作流投影只报告事实，不授权生产或交付。
