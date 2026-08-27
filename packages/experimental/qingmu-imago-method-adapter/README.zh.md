# 青木 IMAGO 方法适配器

[English](README.md) | 中文

这个私有实验性 Host 插件把当前 IMAGO OS 方法编译为浏览器安全指引。`elementMethod` 用于资料编辑，`referenceAssetMethod` 用于受限的参考资产动作与权利指引，`promptIrMethod` 用于供应商无关的 PromptIR 候选，`shotRelationMethod` 用于一个 canonical Scene/Shot/Shot 内局部 Beat/Element ID 图，`heroFrameStoryboardMethod` 用于确定性编译一个已选 Hero Frame 及其 Shot 内画布标注。每个端点都在 Host 内构造固定的易梦权威信息，并把按 Unicode code point 排序、无空格的 canonical JSON 通过 stdin 交给已审核的 Core 编译器。编译器返回的 `input_snapshot_sha256` 必须匹配这组准确 canonical 字节的 SHA-256。

## 证明边界

所有端点都只从 Host 进程环境读取 `QINGMU_IMAGO_ATTESTATION_KEY`。原始环境字符串就是 HMAC 密钥：不做 trim，并且必须至少包含 32 个 UTF-8 字节。缺失、空串或不足长度时，会在编译前失败关闭。密钥不会进入 Cordis 配置、编译器子进程环境、浏览器响应、日志或错误正文。

Host 验证当前 Core 投影后，返回投影、投影 canonical SHA-256，以及方法专用证明。Shot 关系证明绑定准确的编译器输入、目标、Host 派生的 `relationSnapshotSha256` 和当前所选 canonical Shot。Hero Frame Storyboard 证明还绑定所选 Shot SHA、完整 Hero Frame 血缘绑定、原始标注 SHA 和编译结果 SHA。所选 Shot 始终是易梦故事板 frame ID，Beat ID 始终只在所属 Shot 内有效。浏览器只能转发证明，不能在缺少服务端密钥时签发或验证。

Host 从准确易梦 ID 图派生关系权威 SHA 和所选 Shot SHA。`heroFrameStoryboardMethod` 还由 Host 派生 Hero Frame 绑定 SHA 和原始标注 SHA；浏览器不能提供这些权威哈希，也不能提供第二套 Shot 身份。Host 要求目标、关系图、画布、确定性编译结果、来源绑定、工作单、合法工作集合和权威字段全部精确匹配。方法可以描述通过易梦 ChangeSet 执行 `replaceStoryboardCanvas`，但本适配器不执行该写入，并拒绝生成、选择、批准、签收、Provider 或 Worker 回执。它不创建关系身份、画布仓库、数据库记录、项目状态或第二状态机。

Core 根目录继续由部署环境决定。非空白 `config.coreRoot` 优先，否则必须提供 `IMAGO_OS_CORE_ROOT`。本包不包含任何机器专属 Core 路径。

## 模型体验

### 私有方法 RPC

#### 模型看到的内容

无。这些端点是私有浏览器 RPC，不是模型工具、提示词段落或会话事件。

#### Token 影响

无。RPC 响应不会进入模型上下文。

#### KV Cache 影响

无。没有新增模型可见 token。

## 已知限制与延期工作

- Shot 关系与 Hero Frame Storyboard 切片只接受可直接送入编译器的 ID、血缘和归一化整数标注。展示元数据、Shot River 节奏、实际生成、选择执行、ChangeSet 提交、评论和创意审核决定仍不属于本适配器。
- 证明只表示 Host 校验及精确输入绑定，不授予付费 Provider、资产选择、人工批准或生产状态写入权。
- 本次受限切片不包含密钥轮换或多密钥验证。
