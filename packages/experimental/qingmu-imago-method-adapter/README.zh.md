# 青木 IMAGO 方法适配器

[English](README.md) | 中文

这个私有实验性 Host 插件把当前 IMAGO OS 的人物、环境或道具方法编译为浏览器安全指引。`elementMethod` 用于资料编辑。`referenceAssetMethod` 针对一个精确的资料版本、资料 SHA、候选资产 ID 和资产 SHA，提供 `selectReferenceAsset` 或 `requestReferenceRegeneration` 指引。两个端点都在 Host 内构造固定的易梦权威信息，并把按 Unicode code point 排序、无空格的 canonical JSON 通过 stdin 交给各自已审核的 Core 编译器。编译器返回的 `input_snapshot_sha256` 必须匹配这组准确 canonical 字节的 SHA-256。

## 证明边界

两个端点都只从 Host 进程环境读取 `QINGMU_IMAGO_ATTESTATION_KEY`。原始环境字符串就是 HMAC 密钥：不做 trim，并且必须至少包含 32 个 UTF-8 字节。缺失、空串或不足长度时，会在编译前失败关闭。密钥不会进入 Cordis 配置、编译器子进程环境、浏览器响应、日志或错误正文。

Host 验证当前 Core 投影后，返回投影、投影 canonical SHA-256，以及方法专用证明。`qingmu.imago-element-method-attestation.v1` 绑定资料 subject。`qingmu.imago-reference-asset-method-attestation.v1` 则通过 `targetSha256` 绑定精确参考资产目标，不复用元素证明的 `subjectSha256` 语义。浏览器只能转发这两类 HMAC-SHA-256 证明，不能在缺少服务端密钥时签发或验证它们。

参考资产投影只是严格只读指引。Host 要求目标、来源绑定、操作、合法工作集合和权威字段全部精确匹配，包括 `providerCalls: 0`、`workerStarted: false` 和 `selection_executed: false`。选择或请求重新生成仍是后续易梦 ChangeSet 操作；本适配器不执行其中任何一种。

Core 根目录继续由部署环境决定。非空白 `config.coreRoot` 优先，否则必须提供 `IMAGO_OS_CORE_ROOT`。本包不包含任何机器专属 Core 路径。

## 模型体验

### 私有方法 RPC

#### 模型看到的内容

无。`elementMethod` 和 `referenceAssetMethod` 是私有浏览器 RPC 端点，不是模型工具、提示词段落或会话事件。

#### Token 影响

无。RPC 响应不会进入模型上下文。

#### KV Cache 影响

无。没有新增模型可见 token。

## 已知限制与延期工作

- 当前切片支持受限的人物、环境和道具资料指引，以及参考资产选择或重新生成指引。PromptIR 编译、实际生成、选择执行、评论和创意审核决定仍不属于本适配器。
- 证明只表示 Host 校验及精确输入绑定，不授予付费 Provider、资产选择、人工批准或生产状态写入权。
- 本次受限切片不包含密钥轮换或多密钥验证。
