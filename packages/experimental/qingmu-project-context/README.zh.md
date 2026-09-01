# 青木项目上下文

[English](README.md) | 中文

这个私有实验性 Host 插件把一个实时 DSh 会话绑定到易梦中精确的项目、剧集、场景和 Shot。绑定只在现有仅追加会话日志中保存坐标、revision 标识和 SHA-256 值。折叠最新的 `qingmu/project-context` 事件即可在进程重启后恢复当前对象；本包不创建数据库、项目存储、Stage 台账、费用台账或浏览器持久化。

仅限 loopback 的 `/qingmu-project-context` 通道提供 `bind`、`current` 和 `suggest`。`bind` 读取标准化的易梦 `workflow` 投影，并拒绝缺失或不匹配的 Scene 或 Shot。绑定另一个 Shot 会追加一个完整替换值。`suggest` 重新读取同一投影，并比较剧集、故事板、Scene 和 Shot 的 revision/SHA 标识。任何差异都会在 IMAGO 方法运行前追加一个 `stale` 绑定并返回 `refresh_required`；只有再次显式调用 `bind` 才会刷新绑定。

对于新鲜绑定，`suggest` 从现有可选 IMAGO 方法适配器请求 `directorReplayMethod`，并为该 Shot 返回确定性的 `text_director_proposal` 或 `visual_finding`。文本建议使用 `qingmu.director-proposal.v1`，视觉审阅使用 `qingmu.visual-review-proposal.v1`，与所选回放方法的声明一致。建议包含当前对象、方法与上下文 SHA 值、显式差异和影响范围。它只是一份变更集草案：不会自动保存、批准、选择、签收、提交生成、调用模型提供方、修改预算或写入易梦业务状态。会话日志只保留包含坐标和哈希的精简建议回执，不保留项目正文或建议内容。每条回执必须匹配它前面的当前绑定，恢复时会重新计算绑定的上下文 SHA。方法不可用时返回 `method_unavailable` 和 `manualWorkBlocked: false`。

## 模型体验

没有，因为这个私有 RPC 插件不注册提示词、schema、工具、结果或提供方路由。

#### KV Cache 影响

没有。本包不增加进入模型的 token，也不发起提供方请求。

## 已知限制与延后工作

- 当前没有已交付的应用组合包加载本包。后续组合可以选择加载 Host 插件及其不变量配套插件，而无需修改启动器或现有运行时路由。
- 确定性建议只标识受限的审阅重点；它不是创意验收、正式 QC、易梦 ChangeSet 或执行请求。
- 适配器要求存在实时 DSh 会话且当前易梦工作流可读。源数据缺失时不会返回建议，也不会阻止人工工作。
- 建议回执是回放证据，不是第二个建议仓库。未来由调用方拥有用户编辑后的草稿和业务提交流程。
