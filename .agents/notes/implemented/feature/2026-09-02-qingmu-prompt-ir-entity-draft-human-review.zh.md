# Agent Note: PromptIR 关联实体草稿自然人审核

Status: implemented

[English](2026-09-02-qingmu-prompt-ir-entity-draft-human-review.md) | 中文

## Problem

Ready PromptIR 可能依赖仍需创作者判断内容的实体草稿事实与参考绑定。若把 PromptIR 结构选择、机器检查、Bearer 认证命令或生成任务关联当成这种判断，自动化就能取得人工权威。浏览器侧状态也无法作为 Writer 重启后的权威记录，并可能与其声称接受的精确 PromptIR、profile 和参考包来源发生漂移。

## Decision

易梦是每项 PromptIR 关联实体草稿决定的唯一权威。它的读模型把当前 Ready PromptIR 和分镜帧绑定到草稿内容 SHA、当前元素 profile 修订与快照 SHA、当前已选参考身份以及参考包 SHA。只有唯一绑定于 owner 的自然人身份可以继续。接受或拒绝要求近期同源 cookie 会话、明确确认，以及绑定精确请求、来源、用户、自然人和浏览器会话的短时意图证明。Writer 在原子更新中重新核对完整绑定；漂移、过期、会话变化、并发决定和证明重放都会失败关闭。

Host 提供专用同源浏览器路由，只转发 `jason_token` cookie。它拒绝 Bearer header，以及调用者提供的 actor、审核人、自然人或 session 身份。写入结果不确定时，使用不可变幂等键与请求 SHA 进行纯 GET 回执恢复。制作台在自然人决定前展示精确绑定的 PromptIR、草稿、profile、已选参考和参考包哈希。

决定只更新关联的 `entity_drafts` 记录并嵌入不可变审核证据。它不产生 outbox 事件、不修改生成任务、不启动 worker，也不调用 Provider。生成任务只能通过 canonical `generation_job_prompt_irs` 关系关联 Ready PromptIR；该关联既不是执行，也不是审核权威。既有公开实体草稿审核会拒绝 PromptIR 关联草稿，因此不能绕过本路由。

## Alternatives considered

**使用既有 Bearer 认证实体草稿审核端点。** 自动化可以持有 Bearer 凭据，它不能证明近期自然人浏览器动作。PromptIR 关联草稿必须使用 cookie-only 意图路径；无关的 legacy 草稿保留既有行为。

**把决定存入 Harness 或浏览器状态。** 这会建立第二业务权威，也无法在 Writer 重启后作为 canonical 证据恢复。Harness 只展示并传输意图；易梦负责持久化和恢复。

**从 Ready PromptIR 选择或生成任务创建推断接受。** 这些记录表达提示词版本选择和工作调度，不表达实体事实与参考的审核。它们保持独立，不能合成人工决定。

## Consequences

被接受且仍为当前的实体草稿可以满足既有首帧参考 blocker，而不创建或执行生成工作。更严格的路径要求在 cookie 缺失或超过十五分钟时重新登录，每项决定都要明确确认，并在任何来源漂移时失败。拒绝会成为持久证据，但不授予下游权威。本能力不批准提示词、媒体、单集、发布、Provider 费用或部署。
