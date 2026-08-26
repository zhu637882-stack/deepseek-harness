# Agent Note：青木剧本 ChangeSet 工作台

Status: implemented

[English](2026-08-26-qingmu-script-changeset-workbench.md) | 中文

## Problem

青木 OS 已经可以查看易梦生产事实，但没有受限写入路径。如果通过通用 Harness 工具发送修改，或者把易梦 token 暴露给浏览器，就会绕过易梦的 revision、preview、幂等、审计和下游失效合同。

## Decision

第一条写入切片只支持 `episode_script`。私有 Host 命令适配器持有仅限回环地址的 `/qingmu-yimeng-command` 通道与 `YIMENG_API_TOKEN`，只暴露 propose、preview、commit 和只读提交回执恢复四种操作。浏览器只接收规范化结果，不接触 token、Cookie、任意 URL 或通用 HTTP 代理。

青木制作台实现一条显式状态机：读取权威剧本与 revision，编辑本地 JSON 草稿，提出带版本的 ChangeSet，预览冲突和失效范围，要求用户重新勾选防误触确认，以确定性幂等键提交，随后回读权威剧本与工作流。发送 commit `POST` 前，界面必须同步把一条最小、非秘密、按主体分键的精确恢复标记写入 `sessionStorage` 并读回核对；存储失败时禁止发送请求。如果随后关闭或切换对话框、主体，或者同一标签页刷新，恢复后的工作区只提供显式回执查询，绝不会重提 commit。恢复失败或血缘错配会保留标记并锁住新编辑；只有标记、回执全部血缘一致，且权威剧本回读匹配时，才会条件清除那条精确标记。损坏或无法恢复的标记可以由用户显式“只丢弃本地标记”，但界面会警告该操作不会调用易梦，也不会撤销服务端提交。这个勾选框只是界面防误触，不是身份授权、安全证明或内容签收。命令权限来自 Host 持有的 token 与易梦对已认证 owner/actor 的复核；人工内容签收仍属于独立流程。草稿、proposal、preview、项目、剧集、提交失败或响应血缘任何一项变化都会清除确认。Project ID、Episode ID、ChangeSet ID、payload hash、base revision 和幂等键不一致时失败关闭。提交后的剧本回读还必须同时匹配项目、剧集、回执声明的权威 revision 和 `authoritativeSnapshotSha256`。只读适配器对易梦返回的准确 Python canonical UTF-8 字节重算哈希，解析后递归拒绝两个投影中的非有限数和不安全整数，再与 `script` 深度比较、移除 canonical 原文，只向浏览器下发已验证的 `scriptSha256`；浏览器不跨语言重序列化剧本。错配回读不会替换已确认的界面快照，只会保留回执、标记并显示警告。

只读与命令流量继续使用两个独立 Host 通道。两个适配器都只允许无路径的回环 HTTP(S) 上游，拒绝重定向，不发送 Cookie，限制请求与响应体大小，移除凭据形态的响应字段，从响应键和值中清除当前 token，并返回脱敏错误。普通读取响应继续限制为 5 MiB；只有剧本响应设置 20 MiB 硬上限，使接近 5 MiB 的合法命令体仍可回传解析后剧本及其转义后的 canonical 证据，同时不形成无界读取。公开 health 请求不发送 Authorization，但 Host 仍只把活动 token 用作递归响应脱敏密钥。项目、剧集和基线 revision 随 propose、preview、commit 请求贯穿到易梦，并在 ChangeSet、preview 与 commit receipt 上重复核验。回执恢复是命令适配器的第四个操作，只向项目、剧集、ChangeSet 定位的 command-receipt endpoint 发送一次无 body、无 query 的 `GET`，并使用原始 `Idempotency-Key` header。Host 只接受 `jason.qingmu-command-receipt-recovery.v1`，在接受 `receiptSha256` 前会重算嵌套原始回执的 canonical JSON SHA-256，再核验其全部血缘，也接受合法的 `deduplicated: false`。青木发行 overlay 按只读适配器、命令适配器、制作台的顺序安装。

易梦仍是变更权威。propose 在写入日志前核验项目归属；preview 和 commit 在事务内核验项目、剧集和基线 revision；持久化 revision 必须是非负整数，浮点或布尔篡改会按完整性事故失败关闭。提交事务同时写入剧本、revision、下游失效、命令回执、领域事件和审计日志。第一版 outbox dispatcher 是同步核心并接受注入 sink：它在单个 SQLite 写事务中校验日志和回执血缘，支持重试和退避，并把 `eventId` 暴露为消费者处理 at-least-once 投递时的去重键。当前测试使用内存 sink，且没有接入生产 Worker。dispatcher 核心不会沙箱化任意 sink，也不强制其网络策略和超时；这些控制属于后续生产 sink adapter。

## Alternatives considered

**让制作台直接调用易梦。** 这会把 API token 和网络权限放进浏览器。Host 边界把凭据和 URL 策略留在客户端之外。

**一次请求直接修改剧本。** 这会删除可见的预览和冲突边界。三段 ChangeSet 协议让提议 payload、权威 revision、失效影响和人工提交决定可以分别观察。

**把 Harness 会话作为剧本真源。** 会话只是协作上下文，不是易梦生产状态。工作台提交后始终回读易梦，并展示该权威结果。

**响应中断后自动重试 commit。** 自动重试会掩盖传输结果未知与新用户命令之间的区别。工作区只保存非秘密血缘，要求用户显式执行只读回执查询，恢复期间绝不重提 `POST`。

**第一步就接网络 dispatcher 或 Provider Worker。** 这会扩大运行和费用权限。注入式内存测试 sink 可以在无外部副作用的前提下证明完整性、重试和幂等语义；带策略约束的生产 sink 与 Worker 接线留给独立阶段。

## Verification

Harness 的 35 条聚焦测试（只读适配器 12 条、命令适配器 7 条、制作台 15 条、bundle 顺序 1 条）覆盖 token 隔离、公开 health 脱敏、无 Cookie 请求、仅回环 URL、普通与剧本专用响应字节上限、凭据清洗、项目/剧集/基线血缘关联、包含 Python `1e-06` 的准确 canonical 剧本证据、不安全整数拒绝、伪造剧本与回执哈希、ChangeSet 预览、冲突失败、防误触确认失效、确定性幂等、严格恢复标记存储、失败保留、显式本地丢弃、恢复回执血缘和权威回读。易梦 47 条聚焦测试覆盖显式 schema 门禁、API 与事务垂直切片、revision 冲突、幂等重放、篡改检测、内存 outbox 重试与终止失败，以及既有剧本更新和下游失效合同；79 条核心生产门禁回归通过。青木 profile 构建和 1 条隔离真实 Chromium 流程覆盖“提交已受理 → 同标签页刷新 → 显式无 body 回执恢复 → 权威回读”，并断言全程只有一次 commit `POST`。这些验证不使用正式数据库、付费 Provider 或生产服务。

## Consequences

青木现在拥有一条狭窄、可审计的生产域写入工作台，而不是通用变更面。新增目标必须建立自己的易梦领域合同和界面状态机，不能自动继承剧本权限。恢复能力有意只覆盖当前标签页的 `sessionStorage` 生命周期；丢弃标记只能恢复本地编辑，不能证明或逆转服务端结果。ChangeSet schema 与 API 默认关闭，只有显式启用才开放。在正式数据库启用 schema、生产 Worker 接线、生产部署、付费生成和人工内容签收仍不在本变更内，必须分别授权并留证。
