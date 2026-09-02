# Agent Note: PromptIR 导演字段映射

Status: implemented

[English](2026-09-02-qingmu-prompt-ir-director-field-mapping.md) | 中文

## Problem

PromptIR 编辑方法提供五个可编辑字段，但没有声明各字段受哪项已准入导演指导约束。单一 E 阶段合同哈希无法如实表示 D 阶段关键帧指导，也无法表示 D/E 共享的负面提示词。

## Decision

`promptIrMethod` 适配器现在输出 `qingmu.imago-prompt-ir-field-mapping.v1`。`imageGenPrompt` 和 `lastFrameImagePrompt` 绑定 D 阶段及其关键帧卡片；`videoGenPrompt` 和 `motionPrompt` 绑定 E 阶段及其视频卡片；`negativePrompt` 按 D/E 顺序同时绑定两者。每个条目都携带 Core 方法哈希、从准确 Core 阶段合同来源读取的逐阶段合同绑定，以及通过谱系核验的卡片身份。Host 签署投影前会重新校验映射、准确卡片来源绑定和五项字段提示。

该映射只属于无状态方法投影。本切片不更改 PromptIR 引导、易梦命令适配器、制作台 UI、持久化、Provider 路由、Worker 或业务选择。业务链消费仍是后续集成。

## Alternatives considered

**为所有字段复用 Core E 阶段哈希。** 这会错误标记 D 阶段指导，也无法表示 D/E 负面提示词，因此每个适用阶段都携带自己的合同绑定。

**只通过自由文本提示绑定卡片。** 提示本身无法保留准确阶段、合同、内容、仓库和谱系身份，因此结构化映射与来源绑定继续作为权威。

## Consequences

缺失、重复、重排、错位或发生漂移的方法、阶段合同、卡片、谱系、来源绑定或提示身份都会失败关闭。方法仍然只供建议且零执行：Provider 调用、Worker 和最高费用均为零，数据库写入、项目状态变更、批准、选择和人工签收仍不可用。
