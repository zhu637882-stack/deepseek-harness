# Agent Note: 青木元素档案与精确影响范围

Status: implemented

[English](2026-08-27-qingmu-element-profiles-and-impact.md) | 中文

## Problem

青木的第一条资产切片只能编辑道具。如果只在客户端把人物和环境做成别名，易梦就没有这些主体的权威 revision，未知影响字段也可能穿过包边界，并形成第二套“哪些参考和派生工作已经失效”的解释。

## Decision

易梦为既有人物、场景和道具记录拥有唯一的 `element_profile` ChangeSet 合同。产品中的“环境”映射到易梦现有 `scene`；不创建新的元素标识、数据库或状态机。人物变更绑定 `actorId`、`visualIdentity` 和 `replaceVisualIdentity`；环境与道具分别绑定 `sceneId` 或 `propId`、`visualPrompt` 和 `replaceVisualPrompt`。每个主体都有易梦拥有的 `profile_revision`、canonical 快照哈希、不可变提案、服务端预览、revision 与 snapshot 双重乐观比较、幂等提交回执、审计日志和 outbox 事件。

影响结果是字段封闭的七数组记录：受影响参考资产、被失效的已批准资产、受影响派生资产、受影响参考包、受影响 PromptIR、受影响故事板帧，以及明确的未知项。易梦在提案时计算并对其 canonical 内容取哈希，提交事务内重新计算，并在变更前拒绝任何错配。成功且确有变化的提交会在同一事务内更新权威档案与 revision、清除过期的已选参考，并失效已发现依赖。Harness 适配器拒绝缺失或多余影响字段并复核 canonical 影响哈希，因此浏览器和 Host 都不能自行扩大或缩小影响解释。

无状态 IMAGO 适配器针对准确的易梦快照编译当前 B2aC 人物方法或 B2aS 环境/道具方法。三类元素复用[道具方法证明决策](2026-08-26-qingmu-prop-method-attestation.zh.md)中的服务端 HMAC 证明；该投影只是方法指导和预检证据，不授予变更、选择、生成、付费 Provider 或人工批准权。青木工作台把人物、环境和道具呈现为同一个产品界面，展示类型专属字段、基础/当前/拟议比较、七组影响范围、明确人工提交确认，以及按主体隔离的只读回执恢复。界面不暴露 Skill 包选择器、内部阶段标识或第二套工作流图。

命令与恢复机制继续沿用[剧本 ChangeSet 工作台](2026-08-26-qingmu-script-changeset-workbench.zh.md)确立的受限 Host → 易梦设计。Harness 只执行本地插件链，易梦仍是唯一业务与变更权威，IMAGO 只提供方法投影，并且只有通过易梦认证的操作人才能创建或提交权威 ChangeSet。

## Alternatives considered

**创建青木专属人物和环境表。** 这会重复易梦的标识、revision、选择和失效状态。复用既有易梦记录才能保留唯一生产真相。

**为所有元素发送一种通用 JSON patch。** 宽松 patch 会让元素类型、operation 和权威字段发生漂移。带判别字段的请求类型与服务端校验明确列出每种合法映射，并拒绝其他组合。

**在浏览器计算影响范围。** 浏览器不能观察全部权威引用或提交时竞态。易梦依据事务快照计算影响，Harness 只验证并原样展示准确结果。

**提交后自动重生成或选择资产。** 档案编辑不授予费用、生成、选择或内容签收权。提交只失效受影响工作，把后续决定保留为显式操作。

## Verification

Core 编译器、Harness 适配器与制作台、易梦事务的聚焦测试覆盖三类元素映射、严格方法与 HMAC 血缘、七字段影响校验、revision 与 snapshot 冲突、提交时影响篡改、幂等回执恢复、权威回读和依赖失效。组装后的青木 Profile 使用真实 Core 编译器与真实 Chromium，执行由人操作的人物和环境流程，同时保留既有道具恢复路径。这些检查只使用隔离数据库与本地 double；没有迁移正式数据库、调用 Provider、部署生产或记录人工创意批准。

## Consequences

人物、环境和道具定义现在共用一种可审计编辑模型，不制造影子业务状态。封闭的影响记录让已知失效范围可审核，并保留明确未知项，避免暗示系统已经发现全部依赖。代价是跨仓合同更严格：增加元素类型或影响类别时，必须同步更新易梦、Core、Host、界面和测试。PromptIR 编辑、权利例外、评论与审核决定、重生成、选择以及 Phase 3 完成仍属于后续工作。
