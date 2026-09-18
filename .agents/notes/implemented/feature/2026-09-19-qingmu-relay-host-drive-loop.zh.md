# Agent Note：青木接力 Host 驱动循环

状态：已实现

[English](2026-09-19-qingmu-relay-host-drive-loop.md) | 中文

## 问题

接力批次已具备全部持久化护栏——账本、单写者租约、准入门控、预算预留、run 回查——但唯一的生产驱动方是浏览器：`RelayBatchPanel` 每 15 秒经回环 RPC 调用 `driveRelayBatch`，页面一关，运行中的批次就停摆，直到有人重新打开页面。一个价值在于"镜 N 生成时准备镜 N+1"的批次，无法在"必须开着页面才能推进"的前提下作为操作能力交付。

## 决策

`relay-host-loop.ts` 拥有一个 Host 侧驱动循环。`apply()` 在既有的 `['connection', 'sessions', 'qingmuYimengCommand']` 注入块内启动它——Yimeng 读/命令端口与 agent 注册表本就住在那里。循环按 session 维护一个开放批次登记表，由三类 session 事件喂入：类型为 `qingmu-director-relay/state` 的 `session/event` 依据事件的整态载荷重新归类；`session/created` 为持久日志里已带开放批次的 session 登记（Host 重启后的 attach 路径）；`session/disposed` 注销。一个 `setInterval` 心跳（`relayDriveIntervalMs`，新增的受校验 `Config` 字段，默认 15000）串行驱动每个已登记 session。

心跳与浏览器 RPC 共用同一个按 session 的单飞门：一次驱动在飞时，心跳跳过、RPC 回答 `waiting/drive-in-progress`。心跳路径额外要求 `mode === 'running'`，因此暂停的批次与浏览器面板的轮询门一样，等待其显式恢复路径；RPC 面保持较宽的契约（面板本就为非 running 批次禁用驱动按钮）。agent 按次现查——agent 缺失时心跳静默跳过、RPC 报 `agent-unavailable`——因为 Host 重启会 detach 全部 session，而面板的租约恢复访问正是约定的重新 attach 时机；循环绝不绕过存储的 preset 组合去捏造 agent。被拒绝的驱动记录日志并隔离，一个坏 session 不会拖停其余批次。

## 备选方案

**由 writer worker 驱动**被否决：那里的 `--disable-durable-director-orchestration` 通道是旧的 jason 编排，与 DSH 接力是两条路线，且付费命令必须继续流经 runner 已设防的 Host 回环 Yimeng 命令门面。

**在循环内 resume agent**（`ctx.agents.resume`）暂被否决：正确的 resume 必须经 apiproxy 的 `ensureSession`，让存储的 preset 组合与 cwd 校验获胜；在 bridge 里复刻会分叉恢复契约。Host 重启后，操作者打开一次面板（租约恢复）即经既有路径重新 attach session，此后循环无人值守运行。该边界记为已知限制。

**每次心跳全量扫描 attached session 而不建登记表**被否决：登记表让心跳成本正比于开放批次数，并给循环一个显式生命周期（创建→开放→终态），而不是反复重扫 store。

**把浏览器 15 秒轮询硬编码为循环节拍**按可调参数规则否决；节拍是 `Config` 字段，部署可从 `cordis.yml` 调整。

## 后果

运行中的批次现在仅靠 Host 进程即可推进：创建后浏览器页面可以关闭，批次继续在授权内准入、准备、提交并收录。浏览器 RPC 与心跳不会双重驱动同一 session，暂停的批次保持暂停直到显式恢复。循环不创建 agent，因此 Host 重启后的首次面板访问仍是重新 attach 步骤（已写进面板更新的 `agent-unavailable` 提示）。终态模式注销其 session，已收敛但未完成的批次在完成或关闭前仍占用心跳，与操作者显式结算的职责一致。

## 测试

`relay-host-loop.spec.ts`（模块级 mock `driveRelayBatch`，用携带真实接力账本的真实 `Session`）覆盖登记分类（running/paused 保留，completed/closed/null 注销）、心跳门（驱动 running、跳过 paused）、单飞门（并发 RPC 回 `drive-in-progress`，随后原 promise 收敛）、RPC 面独立区分 `agent-unavailable` 跳过、`read-port-unavailable` 停靠，以及心跳对被拒绝驱动的隔离——下一次心跳仍继续驱动。完整 bridge 套件在生产 `apply()` 接线在位的情况下通过。

## 关联

建立在[接力账本](2026-09-16-qingmu-director-relay-ledger.zh.md)、接力控制器（`implemented/qingmu-relay-controller.md`，英文）与浏览器面板 note（`feature/2026-09-16-qingmu-relay-browser-panel.md`，英文）之上；面板 note 中"没有生产驱动方"的后果由本循环取代，其轮询保留为 UI 层面的催动，而非批次的推进力。
