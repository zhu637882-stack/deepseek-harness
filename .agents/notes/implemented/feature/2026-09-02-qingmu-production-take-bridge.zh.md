# Agent Note：青木 Ready 绑定的 Production Take 桥

Status: implemented

[English](2026-09-02-qingmu-production-take-bridge.md) | 中文

## 问题

导演工作区可以准备并选择 Ready PromptIR，但还没有一条从准确镜头、经过当前 IMAGO 方法、直到 Writer Production Take 记录的连续权威链。若让浏览器组装 PromptIR 血缘、Provider 路由或 owner 字段，就会产生第二权威，也无法安全处理丢响应、刷新和 Host 重启。

## 决策

浏览器只发送准确项目、剧集、故事板、镜头、Take 类型/编号和明确 Ready 确认。它绝不发送 owner、Ready、选择、批准、force、Provider、模型、路由、凭据、证明材料或 Writer 血缘。

Host 重读当前 Ready PromptIR 与首帧报价，用 Ready 五字段基线加上合法的 `videoGenPrompt` 无变化 candidate 调用当前 PromptIR 方法，并且只接受已签名的 `qingmu.imago-prompt-ir-method-adapter-result.v1` 投影。Host 验证投影摘要与 HMAC、准确 D/E 字段顺序、独立阶段合同、导演卡及来源绑定、字段提示、空 warnings 和零执行边界。任何漂移都会在请求 Writer 前失败关闭。

随后 Host 才组装 Writer 的准确九字段请求。一个确定性幂等键绑定项目、剧集、镜头与 Take 编号。双击、丢响应、浏览器刷新或 Writer 服务重启后的重放因此仍是同一语义命令；Host 也只接受全部匹配的服务端回执。Take 1 是 `initial`，Take 2 是 `targeted_rework`；界面保持 Take 3 不可用，而伪造的 Take 3 意图会到达 Writer，使持久上限继续作为最终拒绝权威。

界面在请求前保存有界、无秘密的恢复标记，成功后保存通过校验的 Writer 回执。排队任务只标为“已排队”，绝不写成“已生成”。生产链失败时，五字段人工导演编辑仍可使用。

## 考虑过的替代方案

**由浏览器发送完整 Writer 请求。** 拒绝。陈旧的 PromptIR、报价、参考或路由会变成浏览器权威，敏感控制字段也会跨越 RPC 边界。

**每次点击生成随机幂等键。** 拒绝。丢响应和重启后可能创建另一个 Take，而不是恢复既有服务端记录。

**把既有界面方法检查当成充分证明。** 拒绝。浏览器持有的方法输出可能陈旧或被篡改；Host 必须在写边界重新调用并校验当前证明。

## 结果

工作区现在提供一条从 canonical 镜头和当前 Ready PromptIR 到至多两条 Writer 所有 Production Take 记录的连续技术路径，并且能跨进程确定性恢复。额外 Host 重读和严格方法校验会在任何上游权威变化时阻止请求，这是刻意的失败关闭。本切片不调用 Provider、不启动 Worker、不迁移生产数据、不批准内容、不选择 Take、不证明媒体已经生成，也不执行人工签收。
