# Agent Note: Workspace unarchiveSession 能力缝与青木导演进入恢复

Status: implemented

[English](2026-09-17-workspace-unarchive-session.md) | 中文

## 问题

项目导演会话一旦被归档，进入青木项目原生导演的按钮就静默失效。进入流程正确地创建并选中了导演会话，但客户端投影清扫会把任何落入注册表级全局归档集合的当前 selection 清空，于是刚选中的导演在同一次更新内被清回 New Session 视图。驾驶舱闸门（`currentSessionId === projectDirectorSessionId(projectId)`）始终不打开，没有错误提示，按钮看起来是死的。归档集合是 Host 持久状态，因此每次重试都命中同一次清扫。live 上有四个项目导演会话处于这种状态。

wire 文档早已承诺了缺失的另一半：`workspace.archiveSession` 的文档写明未来的 unarchive 会恢复会话的分组位置，注册表也正是为了无损恢复而保留已归档会话的记账槽位。但端点、注册表方法和客户端接口都不存在。

## 决策

`workspace.unarchiveSession` 补齐归档能力缝，在每一层镜像 `archiveSession`。

workspace 注册表方法把一个 id 从持久归档集合中移除。与归档不同，它接受任何 id：恢复操作不可能把未知会话误当已知会话，因此未归档或从未知晓的 id 直接解析、不写入，不产生变更，也就不推送 `host/archived-sessions-changed` 帧。apiproxy 层新增请求/响应 schema、RPC 映射项、fetch handler 路由、fetch client 方法和网关装配，并像其他归档集合来源一样应答完整的更新后集合。client runtime 经 `IWorkspaces` 契约、manager（成功时安装一元回声的完整集合）与 service（失败时抛出 Host 错误）镜像该能力；fixture、两个 fake API client 与 test-support double 携带同一形状。

青木原生导演进入流程补上产品缺口：在 `activate` 的项目分支中，导演会话出现在 Host 列表之后、`sessions.open` 之前，仍留在归档集合中的导演会话先被恢复。检查在那一时刻读取新鲜快照，因此会话创建期间的并发归档也无法绕过。恢复先于打开，selection 得以在投影清扫中存活，驾驶舱闸门首次点击即打开；从未归档的导演则直接打开，不多一次恢复往返。

## 备选方案

**直接手工编辑 live 持久状态清除归档标记**被否决：它绕过注册表的持久写路径，让其他标签页的投影停留在旧状态，且违反"绝不手工编辑 live 持久状态"的规则。部署后由进入流程通过新端点按需恢复，不需要任何数据迁移。

**让导演会话豁免投影清扫**被否决：清扫的单一规则——已归档的当前 selection 处处清空——正是本地回声、远端帧与重连基线保持一致的根基。对某一种会话开特例会撕裂这条不变量。

**在 `sessions.open` 内部恢复**被否决：sessions runtime 没有归档集合的处置权，且恢复是 Host 持久变更而非选择行为；驾驶舱进入流程是唯一知道导演会话必须可见的位置。

**要求 unarchive 的会话必须已知**被否决：成员资格是唯一重要的事实——移除一个不在集合中的 id 本身已是正确的终态；报 not-found 会迫使客户端先读集合，引入竞态却没有保护任何东西。

## 影响

任何客户端都可以经归档所用的同一条 wire 契约恢复已归档会话，被恢复的会话在其保留的记账槽位上重新出现在所有分组视图中。已归档的青木项目导演仅凭进入按钮即可恢复；live 上已归档的四个会话不需要人工修复。归档端到端仍是显示集操作——两个方向都不触碰会话日志、workspace 记账或会话本身。

## 测试

注册表规格覆盖持久往返、未归档 id 的幂等空操作（无介质写入、无变更事件），以及对从未知晓 id 的接受。apiproxy workspace 规格经真实网关驱动端点：恢复应答空集合并恰好推送一次变更帧，记账保持不动，幂等重复与从未知晓的 id 都应答集合且不再推送帧。client service 规格证明被恢复的 selection 在投影清扫中存活，且 Host 失败保持集合不动并以 Host 错误拒绝。native-director-session 规格证明进入顺序——已归档导演先恢复后打开，未归档则没有恢复往返。fetch-carrier 规格携带新的 fake 端点。
