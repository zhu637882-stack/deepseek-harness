# Agent Note: 受控导演 replay 建议

Status: implemented

[English](2026-08-29-qingmu-controlled-director-replay.md) | 中文

## Problem

已保存的场景规划工作区需要在任何付费 DeepSeek canary 前先有真实提案接缝。模型形态的返回不能变成第二套工作流、业务存储、质检决定、参考选择或自动修改。

## Decision

Host 从既有青木三方融合总案加载 SHA 绑定的方法包。IMAGO 只声明建议能力、输出 schema 和限制。易梦独占返回已鉴权、只读的导演上下文快照，并为一个准确的项目、集、场景和镜头签发内容寻址 replay 工作单。Harness/DSh 随后产生确定性本地 fixture，记录输入/输出 SHA、零调用、零费用和仅建议权威；replay 不携带 Provider 或模型路由。

导演台只在用户明确点击后读取建议，统一标记为非模型生成的演练建议，并展示原值、建议值和影响。采用某项只修改既有场景规划的本地草稿。在进入既有预览和人工确认保存前，Host 对原 context、方法、工作单、prompt、proposal 和 output SHA 做零费用 freshness 校验，绝不再次执行推理。如果 replay 接缝不可用，用户可以保留文字并转成普通人工草稿。

另设一份独立、版本化且默认关闭的易梦付费能力合同。它只能经易梦现有 generation task、ProviderGate、预留、持久 submission outbox、ack/unknown 与 reconcile 链签发 Provider/model/pricing 绑定工作单。Host 只执行已签发 permit，最多一次请求且 adapter 零重试；结果不明停在 `submission_unknown`。

## Alternatives considered

**第二套导演数据库或工作流。** 这会与易梦的 canonical 对象、事务日志、ProviderGate、费用和人工决定竞争。因此 replay 接缝不持久化提案状态，只能通过既有规划命令写入。

**模型直接保存。** 提案不能自行提交。既有预览、明确确认、CAS、ChangeSet、outbox 和回执恢复仍是唯一写入路径。

**本片调用 DeepSeek。** 当前未绑定生产路由、模型注册、凭据、网络 Provider 或预算。fake transport 只证明未激活合同与回执形状，不证明模型质量。

## Consequences

本片对应 H2 的有界 UI 纵切和 H3 的 replay 前置。真实 DeepSeek 文本/视觉价格与预算绑定、合法参考资格、PromptIR 就绪、阿里执行、视觉比较和人工内容签收仍是后续独立工作。
