# Agent Note：青木导演上下文 Session 桥接

Status: implemented

[English](2026-09-02-qingmu-director-context-bridge.md) | 中文

## 问题

DSh 导演 Session 原来没有持久身份，把它精确绑定到进入时的易梦项目、episode、scene、shot 和 context 快照。进程恢复或 UI 切换对象后，旧的建议 proposal 可能被错误地带到原上下文之外。

## 决策

一个私有实验包拥有一个整值快照、仅日志的 Session 事件。最新快照只包含易梦四级对象坐标、`contextSnapshotSha256` 和现有 command adapter 的 proposal freshness 哈希。纯 Session projection 把该值提供给未来 UI 挂载。

桥接层通过注入的只读 port 重新读取 context；该 port 必须由现有已规范化的 `director-inference/context` 路径支撑。进入不同对象或观察到新的 context SHA 时，写入完整替换状态并清空旧 proposal。冷恢复先重放同一个 Session 事件日志，再执行读取。context 或模型能力不可用时，返回明确的非阻断结果，并保持人工工作可继续。

Session 级操作代次和 binding 事件 CAS 会阻止迟到的进入/恢复结果覆盖较新的对象。持久状态 schema 也会拒绝对象坐标或 context SHA 与当前 binding 不一致的 proposal。

## 考虑过的替代方案

**第二套绑定数据库或账本。** 拒绝。DSh 已经有持久追加式 Session 日志，易梦必须继续作为唯一业务真源。

**把绑定文本写进聊天历史。** 拒绝。运行身份不应变成模型可见提示词上下文，也不应消耗 Token。

**恢复时创建 proposal。** 拒绝。现有 proposal command 同时会创建 replay work order；恢复只需要现有只读 context 路径，且必须保持零业务写入。

## 结果

Session 身份可以跨重启恢复；切换对象不会继承旧 proposal；context SHA 漂移会自动让旧 proposal 失效。本包不增加提示词仓库、Provider 路由、费用账本、业务写入、审批、选择、Ready 授予或人工签收推断。实际 cockpit 挂载留作单独切片，由它提供现有 read adapter port。
