# 青木导演上下文桥接

[English](README.md) | 中文

这个私有实验包把一个 DSh Session 精确绑定到一个易梦 `project / episode / scene / shot` 及其规范化 `contextSnapshotSha256`。绑定使用仅日志、整值快照的 Session 事件，所以进程停止再启动后，可以从原 Session 日志恢复同一身份，不建立第二套数据库或账本。

## 挂载接口

`createDirectorContextBridge(readPort)` 提供 `enter`、`bindProposal`、`recover`、`current` 和 `freshnessRequest`。read port 必须复用现有已规范化的 `director-inference/context` adapter 路径，不得创建 work order、调用模型、派发 Provider 或写易梦业务状态。

`enter` 绑定或切换精确四级对象；切换时清空前一对象的 proposal。`bindProposal` 只接受现有 command adapter 返回、且 scope 和 input SHA 与当前绑定一致的 replay proposal。`freshnessRequest` 直接返回现有 command adapter 的 freshness 坐标，不另造合同。

`recover` 先折叠持久 DSh 日志，再重新读取当前易梦 context。context SHA 发生变化时，自动追加新的完整绑定并清空旧 proposal。context 或模型能力不可用时，保留最后已知绑定并返回 `manualWorkAllowed: true`，不阻断普通人工编辑。

异步进入和恢复使用 Session 级操作代次与 binding 事件 CAS。迟到结果返回 `superseded`，不能覆盖较新的对象选择或 proposal 挂接。

Cordis plugin 注册 `qingmuDirectorContext` Session projection 和仅限 loopback 的浏览器 facade。青木 bundle 在 cockpit 之前挂载它，现有场景规划工作区显示当前绑定，并用它核验 replay proposal 谱系。facade 不会暴露底层 Host command handler、token、Provider payload 或 permit。

## 权威与副作用

易梦仍是唯一业务真源。Session 事件只保存对象坐标、context SHA 和不可变 proposal/freshness 哈希，不保存提示词正文、参考媒体、内容签收、选择、Ready、Provider 结果、费用记录或通用聊天历史。本包产生零 Provider 调用、零易梦业务写入。

## 模型体验

### Session 绑定桥

#### 模型看到什么

什么也看不到。`qingmu-director-context/state` 事件只进入日志，不进入派生模型历史。

#### Token 影响

直接模型 Token 影响为零。

#### KV Cache 影响

相互独立。绑定、切换和恢复不会修改模型请求。

## 已知限制与后续工作

- 已挂载的 cockpit 路径仍为 replay-only，不启用真实模型 transport 或 Provider route。
- proposal 的 method 漂移仍由现有 `checkDirectorProposalFreshness` command 路径检查。本桥自动处理 context SHA 漂移，并保留该 freshness 所需坐标。
- 本包没有启用真实 DeepSeek 路由、凭据、外部请求、费用或生产 canary。
