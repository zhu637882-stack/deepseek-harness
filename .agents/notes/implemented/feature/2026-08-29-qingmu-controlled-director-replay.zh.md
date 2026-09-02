# Agent Note: 受控导演 replay 建议

Status: implemented

[English](2026-08-29-qingmu-controlled-director-replay.md) | 中文

## Problem

已保存的场景规划工作区需要在任何付费 DeepSeek canary 前先有真实提案接缝。模型形态的返回不能变成第二套工作流、业务存储、质检决定、参考选择或自动修改。

## Decision

Host 从既有青木三方融合总案加载 SHA 绑定的方法包。IMAGO 只声明建议能力、输出 schema 和限制。易梦独占返回已鉴权、只读的导演上下文快照，并为一个准确的项目、集、场景和镜头签发内容寻址 replay 工作单。Harness/DSh 随后产生确定性本地 fixture，记录输入/输出 SHA、零调用、零费用和仅建议权威；replay 不携带 Provider 或模型路由。

导演台只在用户明确点击后读取建议，统一标记为非模型生成的演练建议，并展示原值、建议值和影响。采用某项只修改既有场景规划的本地草稿。在进入既有预览和人工确认保存前，Host 对原 context、方法、工作单、prompt、proposal 和 output SHA 做零费用 freshness 校验，绝不再次执行推理。如果 replay 接缝不可用，用户可以保留文字并转成普通人工草稿。

另设一份独立、版本化且默认关闭的易梦付费能力合同。它只能经易梦现有 generation task、ProviderGate、预留、持久 submission outbox、ack/unknown 与 reconcile 链签发 Provider/model/pricing 绑定工作单。其已签输出规则定义 Unicode code point 字符串长度，以及唯一准确的占位符规范化与拒绝集合；Writer 与 Host 共同消费这些规则。Host 只执行已签发 permit，最多一次请求且 adapter 零重试；结果不明停在 `submission_unknown`。

D1 只允许用实例私有配置激活一条精确绑定项目、剧集、模型、方法包和人民币上限的 production 路由。交互界面仍须人工明确确认，易梦才签发未执行工单；随后 Host 才把这个精确任务排入同一条单次执行器。浏览器拿不到凭据、Provider payload、claim 材料或执行许可。仅为密闭验收保留的回环 transport 必须是本机 HTTP，否则直接拒绝。项目、剧集、场景、镜头或上下文 SHA 一旦变化，未完成读取立即中止，已展示的付费建议立即清空，旧建议不能跨作用域残留。

单次 transport 会在解析仅建议提案前记录完整 Provider 事实。响应完整但 schema 非法时，以 `provider_response_invalid` 持久分类，并保留内容 SHA、字节数、completion/request 标识、finish reason 与 usage；不保留模型原文。transport 未取得完整事实时仍为 `submission_unknown`。两种分类都保留原预留，并通过唯一 outbox 与任务投影恢复，不再发起 Provider 请求。launcher 清理会在自有进程退出后写入真实的 stopped runtime 快照。

## Alternatives considered

**第二套导演数据库或工作流。** 这会与易梦的 canonical 对象、事务日志、ProviderGate、费用和人工决定竞争。因此 replay 接缝不持久化提案状态，只能通过既有规划命令写入。

**模型直接保存。** 提案不能自行提交。既有预览、明确确认、CAS、ChangeSet、outbox 和回执恢复仍是唯一写入路径。

**把 mock 成功当成 canary 成功。** 密闭浏览器链只证明确认、签发工单、Host 排队、一次 HTTP 请求、持久化和仅建议展示；它不证明 Provider 可用性、响应有效性、账单或建议质量。

## Consequences

本片对应 H2 的有界 UI 纵切和 H3 的 replay 前置。D1 精确付费文本路由已经实现并完成本地验证，但获授权的真实 canary 在一个 dispatch epoch 后因完整响应不符合签名建议合同而停在 `submission_unknown`。没有建议被接纳，并且禁止自动重试。普通青木实例没有被替换或更新。真实视觉、合法参考资格、PromptIR 就绪、阿里执行、视觉比较、发布和人工内容签收仍是后续独立工作。
