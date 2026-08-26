# Agent Note: 青木参考资产方法投影

Status: implemented

[English](2026-08-27-qingmu-reference-asset-method-projection.md) | 中文

## 问题

青木资产工作台需要在人工选择参考资产或请求重新生成之前取得当前 IMAGO 指引。复用资料编辑输入或其 subject 绑定证明会混淆资料变更与资产操作意图，而接受浏览器传入的权威字段可能把这种意图升权为生成、批准或选择执行。

## 决定

私有 `referenceAssetMethod` Host 端点只接受 `projectId`、`elementKind`、`elementId`、`profileRevision`、`snapshotSha256`、`assetId`、`assetSha256` 和 `operation`。它支持人物、环境和道具目标，并且只允许 `selectReferenceAsset` 与 `requestReferenceRegeneration` 操作。Host 在把 canonical JSON 交给 `compile_qingmu_reference_asset_method.py` 之前，补入固定的易梦业务权威以及明确未授予的人工批准和付费提供方权限。

Host 在返回参考资产投影之前校验其全部字段。目标、IMAGO 方法身份、有序来源绑定、操作、必须执行的易梦读取、合法工作集合和权威字段必须与请求及当前受限方法一致。工作单和投影都必须声明 Provider 调用为零、没有启动 Worker 且没有执行选择。未知投影字段会失败关闭。

这个端点沿用[元素方法证明决定](2026-08-26-qingmu-prop-method-attestation.zh.md)确立的仅环境 HMAC 密钥和子进程密钥移除方式，但返回专用的 `qingmu.imago-reference-asset-method-attestation.v1` 证明。其签名绑定投影哈希、canonical 输入快照哈希和 canonical 目标哈希。该证明不复用 `subjectSha256`，因为参考资产目标同时包含资料版本和候选资产身份。

现有资产工作台现在会从易梦读取权威候选，针对用户明确选择的候选与 operation 调用这个方法，再把投影和证明交给 Host 命令适配器。Host 在向易梦提议 ChangeSet 前校验 HMAC，以及快照、目标、operation、资产 ID 和资产 SHA 的准确绑定；随后从易梦请求中剥离两个方法字段。通用预览和提交仍需用户明确确认。v3 恢复标记会在 commit `POST` 前绑定 operation 与候选 ID/SHA；恢复只允许显式 GET 查询，并且只有元素档案与参考候选两次权威回读都匹配后才能清除标记。

## 考虑过的替代方案

**原样复用元素方法请求与证明。** 该请求描述资料编辑并绑定资料 subject，而不是候选资产和操作。专用请求及 `targetSha256` 在不增加另一权威来源的前提下保留了不同语义。

**允许浏览器传入权威或执行标志。** 浏览器控制的权威可能把指引变成人工批准、付费生成、Worker 执行或已完成选择。Host 自行构造权威，并且不接受任何执行字段。

**从这个端点执行选择或重新生成。** IMAGO 适配器只提供无状态方法指引，易梦负责业务变更和后续认证 ChangeSet。在这里执行会产生第二条写入路径并绕过生产流水线。

## 验证

包测试覆盖精确八字段输入、三类元素、两种操作、专用目标绑定 HMAC 证明、严格投影及来源校验、权威与执行字段失败关闭和密钥缺失行为。集成用例直接调用当前 Core 编译器，确认 `providerCalls: 0`、`workerStarted: false` 和 `selection_executed: false`，且不触发 Provider、数据库写入、部署或人工决定。浏览器 E2E 使用真实 Host 适配器和 IMAGO 子进程，覆盖权威候选读取、方法调用、提案、通用预览、明确确认、POST 前标记、提交、丢响应后的 GET-only 恢复，以及两项权威回读；同时提交返修意图，并证明 Provider 调用为零、Worker 未启动且没有自动选择。

## 后果

Harness 现在可以通过现有 loopback Host 通道和易梦 ChangeSet 管道传递受限参考意图，而不会开始生成或自动执行选择。记录“已选择”仍不同于认证人工批准或签收，返修请求仍然只是意图。实际生成、自动选择、批准、签收、Provider 权限和 Phase 3 完成都属于后续独立工作。
