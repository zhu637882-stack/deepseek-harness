# 青木导演上下文桥接

[English](README.md) | 中文

这个私有实验包把一个 DSh Session 精确绑定到一个易梦 `project / episode / scene / shot` 及其规范化 `contextSnapshotSha256`。绑定使用仅日志、整值快照的 Session 事件，所以进程停止再启动后，可以从原 Session 日志恢复同一身份，不建立第二套数据库或账本。

## 挂载接口

`createDirectorContextBridge(readPort)` 提供 `enter`、`clear`、`bindProposal`、`recover`、`current` 和 `freshnessRequest`。read port 必须复用现有已规范化的 `director-inference/context` adapter 路径，不得创建 work order、调用模型、派发 Provider 或写易梦业务状态。

`enter` 绑定或切换精确四级对象。Host 接受尚未取消的不同对象进入请求后，先在 I/O 前追加空绑定事件，清除前一对象和 proposal。此后读取等待、失败或取消时，原生工具不能读取旧镜头；冷回放保持未绑定，直到成功进入新对象。若进入失败前清除了旧绑定，返回 `changed: true`。进入前已经取消的请求不读取、不写日志。`bindProposal` 只接受现有 command adapter 返回、且 scope 和 input SHA 与当前绑定一致的 replay proposal。`freshnessRequest` 直接返回现有 command adapter 的 freshness 坐标，不另造合同。

浏览器每次视图绑定提供新的 `ownerId`。`clear(session, scope, ownerId)` 比较当前 owner 与 scope 后才清除绑定或取消待完成进入；旧清理回调不能清除较新视图，即使二者指向同一镜头。无 owner 的原生刷新保留同 scope 的浏览器 owner，进入不同对象则撤销它。owner 只是运行期清理租约，不是认证或业务权威。

`recover` 先折叠持久 DSh 日志，再重新读取当前易梦 context。context SHA 发生变化时，自动追加新的完整绑定并清空旧 proposal。context 或模型能力不可用时，保留最后已知绑定并返回 `manualWorkAllowed: true`，不阻断普通人工编辑。

异步进入和恢复使用 Session 级操作代次与 binding 事件 CAS。迟到结果返回 `superseded`，不能覆盖较新的对象选择或 proposal 挂接。未绑定时的恢复、被拒绝的 proposal 挂接不会取消正在等待的进入操作。投影状态仍为可空的版本 1；产生空事件之前，须一起交付更新后的事件读取器。

Cordis plugin 注册 `qingmuDirectorContext` Session projection 和仅限 loopback 的浏览器 facade。青木 bundle 在 cockpit 之前挂载它。工作区把旧规划镜头或选中的权威自动分镜绑定到同一当前会话；自动分镜绑定不会启用旧规划保存。facade 不会暴露底层 Host command handler、token、Provider payload 或 permit。

`readNativeDirectorReadiness({ sessionId })` 检查已附着会话的运行中 agent（智能体）与作用域工具注册表，不恢复会话或加载预设。它返回 mounted、missing-tools、inactive 或 unavailable；记录中的预设名称和成功的镜头绑定都不能证明工具存在。结果只是某一时点的注册检查，不代表实际执行、模型可用、Writer 健康或创意批准。可选原生服务缺失时，绑定接口仍保留。

## 权威与副作用

易梦仍是唯一业务真源。绑定事件只保存对象坐标、context SHA 和不可变 proposal/freshness 哈希，不保存提示词正文、参考媒体、内容签收、选择、Ready、Provider 结果、费用记录或通用聊天历史。下述可选模型工具会把创作上下文和方法正文保存在普通工具结果事件中。本包产生零 Provider 调用、零易梦业务写入。

## 原生导演读取工具

可选的 `@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools` 插件挂载在青木 Agent 或预设作用域内，不能挂在 Host 根作用域。它依赖 `tools`、`qingmuYimengCommand` 与 `qingmuImagoMethod`。仅挂载现有绑定插件不会启用这些工具，本次源码改动也不会更新生产预设。

- `qingmu_read_bound_context({})` 读取会话绑定对象的真实、已规范化 Writer 上下文。模型不能指定其他项目、镜头或会话。
- `qingmu_get_imago_method({ capability })` 读取 `director_development` 或 `shot_design` 对应的当前 IMAGO 方法正文。C5 响应若有必读 `additionalReferences`，须再调用 `{ capability: 'shot_design', resourceId: 'rough_final_feedback' }`；列出哈希不等于已经读到正文。

每次调用在返回正文前刷新绑定。上下文 SHA 改变会使待处理建议失效；任一读取过程中切换对象，都会拒绝迟到结果。上下文或方法缺失、取消操作不会生成替代内容，也不阻断手工编辑。这个入口不包含采用建议、业务写入、批准或生成工具。

作用域消费方还具有 `qingmuYimengRead` 时，会注册 `qingmu_read_prompt_draft` 和 `qingmu_propose_prompt_edit`。前者读取当前 Ready/草稿提示词、绑定上下文与完整 C5 方法，包括必读追加参考。建议使用成功配对的原生工具调用与结果中的读取回执，替换现有五个提示词字段之一。Host 返回建议前重新核对来源，不接受模型自填的原文基线或旧回放工作单。

`readNativeDraftProposal` 是读取最新已记录原生建议的只读 loopback 接口。它重新核对 Writer 上下文、提示词基线、方法与会话绑定，区分 current、stale、unavailable 和没有建议。建议只包含来源坐标、回执 ID、原文/替换文字和理由；上下文与方法正文留在原始读取结果中。驾驶舱对照原文与建议，明确采用到未保存草稿；采用时再核对来源，并保留人工修改。既有方法检查、预览、保存和 Writer 权威回读仍独立执行，不引入场景规划保存、批准、生成、额外数据库或队列。单字段建议需要已有 Ready PromptIR；首份草稿仍走原工作区。

`maxOutputBytes` 默认限制每份完整 JSON 响应为 262144 个 UTF-8 字节。超限时失败，不截断内容。IMAGO 来源加载器另设单文件 128 KiB、整包 512 KiB 上限，因此合规来源包仍可能超过本消费端的响应上限。须显式配置 Host 上限或读取固定追加参考，不能静默缩减方法。

工具通过原生工具注册表返回无损 JSON，不注入系统提示词，不新建事件日志、业务数据库或独立 Agent 循环。当前上下文是文本证据，不等于逐像素审图，也不代表已经具备全剧剧本。

在 Harness 根目录用 `node --import tsx packages/experimental/qingmu-director-context-bridge/examples/model-tools-keyless.ts` 运行[免密钥示例](examples/model-tools-keyless.ts)。它通过 Loader 加载随包青木导演预设，创建仅存内存的原生会话，并以脚本化外部响应驱动真实 Agent 循环。快照包含实际角色提示、作用域工具、持久事件格式以及进入下一轮模型请求的方法正文。不发起网络或付费 Provider 请求；独立组合测试还核验冷恢复。

## 模型体验

### Session 绑定桥

#### 模型看到什么

什么也看不到。`qingmu-director-context/state` 事件只进入日志，不进入派生模型历史。

#### Token 影响

直接模型 Token 影响为零。

#### KV Cache 影响

相互独立。绑定、切换和恢复不会修改模型请求。

### 原生读取工具

#### 模型看到什么

上下文与方法工具 schema，以及 PromptIR 读取器可用时的两个提示词建议工具。工具结果持久化到原有会话日志，并进入下一轮模型请求。单独读取方法时须另行补读必读参考；提示词草稿读取包含全部必读 C5 参考。建议结果只带精简来源坐标，不重复方法或上下文正文。

#### Token 影响

只有显式启用的 Agent 接收 schema；每次读取的上下文或方法正文增加模型输入 token。不会在每轮系统提示词中自动追加全部来源正文。

#### KV Cache 影响

新结果追加到对话历史。上下文或方法正文变化会改变该后缀；插件不重写先前消息，也不向系统提示词注入不稳定内容。

## 已知限制与后续工作

- 运行期 owner 不跨 Host 重启保留。已持久化的成功绑定仍按原会话语义恢复，已持久化空值则保持未绑定。存活的浏览器须重新进入以取得新的清理租约。离线或被拒的清理不能保证解除绑定；界面仍挂载且没有新绑定时，会报告清理未确认。
- 原生组合通过 Loader 预设和脚本化模型传输验证。本地组件测试覆盖建议采用到既有草稿保存/回读；这些不证明生产启用、真实 Writer 持久化、真实模型创作质量或生成。
- 旧回放建议仍由 `checkDirectorProposalFreshness` 检查漂移；原生提示词建议使用其已记录的读取回执和只读接口。
- 本包没有启用真实 DeepSeek 路由、凭据、外部请求、费用或生产 canary。
