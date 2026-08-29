# Agent Note: 将导演 Provider 执行绑定到私有 Host 身份

Status: implemented

[English](2026-08-29-director-execution-host-identity.md) | 中文

## Problem

导演 Provider 工作单 API 允许项目用户用普通产品操作所用的同一个 JWT 访问执行变更。准备响应还暴露任务 claim，用户因此可以拼装确认回执或把已签发请求标为 unknown。有效的 Provider 确认随后会停在 ingesting 状态，因为导演独占执行通道没有技术 finalizer。并发的首次签发即使保持了任务唯一，也可能留下重复的预检审计行。

## Decision

项目用户可以签发导演 Provider 工作单并读取公开状态，但不能准备、完成执行或把执行标为 unknown。这些变更只存在于私有 API 路由，并通过域分离 HMAC 鉴权；签名覆盖 HTTP 方法、路径、规范请求体 SHA、时间戳和 nonce。被签名的请求体携带不可变的任务、上下文、方法、价格、提供方、模型、dispatch、claim、工作单、请求和 payload 绑定。`QINGMU_DIRECTOR_EXECUTION_KEY` 缺失或短于 32 字节时，API 失败关闭。launcher 只为新建的隔离实例生成该密钥，以 `0600` 模式写入私密配置，注入 API 和 Host 进程，并在恢复时轮换。

只有 Host 持有执行密钥。它先取得私有绑定，准备一次独占 dispatch，再以 `maxRetries=0` 执行注入的 transport，最后提交 Provider 回执或 unknown 结果。浏览器不会收到密钥、claim token、Provider payload 或 dispatch permit。Host 错误日志不包含执行响应细节。

执行前，易梦会重算已存储的请求、Provider payload、工作单、上下文快照、提示词、方法、价格和不可变 preflight 的哈希。Host 在调用 transport 前，再独立重算 permit 的 payload、请求和工作单哈希并与签名绑定核对。即使 active route 已移除，settled 和 submission-unknown 结果仍从持久 task、outbox、receipt 与费用事实恢复；Host 既有 binding→prepare 顺序直接返回该终态，不进入 transport。queued 任务首次 prepare 仍要求 active route，未配置时失败关闭。公开签发与状态归一化使用显式字段白名单，不透传未知上游字段。

完全绑定的建议类 Provider 确认现在会在原有 generation task 中原子推进到 `Succeeded`，同时结算 submission outbox。这个 finalizer 只记录技术 schema 与谱系完成，不创建质检、选择、Ready 状态、PromptIR、ChangeSet、发布权威或人工决定。预留仍与已发生请求关联，表示预留上限；实际费用继续为 unknown，等待账单对账。unknown 提交状态保留预留，不能成为终态成功，也不能触发自动重试。

首次签发使用确定性的预检身份，并在既有事务任务路径中创建预检审计、generation task、预留和 dispatch intent。同键重放恢复原对象；载荷改变时拒绝。

## Alternatives considered

**保留用户 JWT 鉴权，只隐藏 claim token。** 不采用，因为同一用户仍可调用执行变更，或在没有 Host 服务身份的情况下强制进入 unknown 路径。

**新建 Host 侧任务或费用账本。** 不采用，因为易梦已经拥有 generation task、预留、submission outbox、对账与回执状态。第二账本会分裂恢复与计费权威。

**在 transport 中重试 unknown 请求。** 不采用，因为响应丢失前 Provider 可能已经接受请求；重试会带来重复工作和重复费用风险。

## Verification

聚焦 API 与服务测试覆盖密钥缺失、过短、错误、过期和签名篡改，存储任务与 payload 篡改，用户拒绝、同键并发、回执重放、unknown 提交、无 route 的终态恢复、无 route 的 queued 拒绝、漂移检查及单次技术终态化。Host 测试覆盖 permit 到 binding 的完整性校验、一次注入适配器调用、`maxRetries=0`、完成响应丢失、settled 与 unknown 终态无 transport 重放，以及浏览器安全的签发和状态响应。一条隔离 launcher、FastAPI、构建 Host、SQLite 与 Chromium 路径验证签发、私有 fake 执行、移除 active route 后重启恢复 settled，以及零外部网络调用。

## Consequences

除非隔离部署显式提供执行密钥和允许路由，否则可付费导演执行保持休眠。没有新密钥的旧实例继续保留回放、人工编辑、签发与公开状态行为，但私有执行失败关闭。已确认的建议输出不再悬挂于 ingesting 状态，并可在不第二次调用 Provider 的情况下恢复。实际 Provider 账单仍保持 unknown，直到既有账单对账路径提供权威数据。
