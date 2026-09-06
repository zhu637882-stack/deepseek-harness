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

易梦仍是唯一业务真源。绑定事件只保存对象坐标、context SHA 和不可变 proposal/freshness 哈希，不保存提示词正文、参考媒体、内容签收、选择、Ready、Provider 结果、费用记录或通用聊天历史。下述可选模型工具会把创作上下文和方法正文保存在普通工具结果事件中。本包产生零 Provider 调用、零易梦业务写入。

## 原生导演读取工具

可选的 `@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools` 插件挂载在青木 Agent 或预设作用域内，不能挂在 Host 根作用域。它依赖 `tools`、`qingmuYimengCommand` 与 `qingmuImagoMethod`。仅挂载现有绑定插件不会启用这些工具，本次源码改动也不会更新生产预设。

- `qingmu_read_bound_context({})` 读取会话绑定对象的真实、已规范化 Writer 上下文。模型不能指定其他项目、镜头或会话。
- `qingmu_get_imago_method({ capability })` 读取 `director_development` 或 `shot_design` 对应的当前 IMAGO 方法正文。C5 响应若有必读 `additionalReferences`，须再调用 `{ capability: 'shot_design', resourceId: 'rough_final_feedback' }`；列出哈希不等于已经读到正文。

每次调用在返回正文前刷新绑定。上下文 SHA 改变会使待处理建议失效；任一读取过程中切换对象，都会拒绝迟到结果。上下文或方法缺失、取消操作不会生成替代内容，也不阻断手工编辑。这个入口不包含采用建议、业务写入、批准或生成工具。

`maxOutputBytes` 默认限制每份完整 JSON 响应为 262144 个 UTF-8 字节。超限时失败，不截断内容。IMAGO 来源加载器另设单文件 128 KiB、整包 512 KiB 上限，因此合规来源包仍可能超过本消费端的响应上限。须显式配置 Host 上限或读取固定追加参考，不能静默缩减方法。

工具通过原生工具注册表返回无损 JSON，不注入系统提示词，不新建事件日志、业务数据库或独立 Agent 循环。当前上下文是文本证据，不等于逐像素审图，也不代表已经具备全剧剧本。

在 Harness 根目录用 `node --import tsx packages/experimental/qingmu-director-context-bridge/examples/model-tools-keyless.ts` 运行[免密钥示例](examples/model-tools-keyless.ts)。它用固定 Host 测试数据打印稳定的工具响应快照，不发起模型或网络请求；独立的组合测试覆盖真实 Loader 预设、Agent 循环和下一轮模型输入。

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

两个工具 schema，以及调用后带来源哈希与只读权威声明的绑定 Writer 上下文或完整所请求 IMAGO 正文。工具结果持久化到原有会话日志，并进入下一轮模型请求。必读追加参考需要另行调用读取。

#### Token 影响

只有显式启用的 Agent 接收 schema；每次读取的上下文或方法正文增加模型输入 token。不会在每轮系统提示词中自动追加全部来源正文。

#### KV Cache 影响

新结果追加到对话历史。上下文或方法正文变化会改变该后缀；插件不重写先前消息，也不向系统提示词注入不稳定内容。

## 已知限制与后续工作

- 原生读取工具组合已通过 Loader 预设和脚本化模型传输验证。这不证明生产启用、真实模型创作质量、建议采用或生成已完成。
- proposal 的 method 漂移仍由现有 `checkDirectorProposalFreshness` command 路径检查。本桥自动处理 context SHA 漂移，并保留该 freshness 所需坐标。
- 本包没有启用真实 DeepSeek 路由、凭据、外部请求、费用或生产 canary。
