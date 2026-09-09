# Agent Note: 青木引用视频预览

[English](2026-09-09-qingmu-reference-video-preview.md) | 中文

Status: implemented

## Problem

当素材顺序和原始对白混在同一段可改写提示词中时，导演难以可靠比较带参考素材的视频请求。

## Decision

现有只读适配器将明确的草稿交给 Writer 只读编译器。图片和音频的稳定引用标记分别编号，原始文字保持不变。Host 校验范围、顺序、编译文字和请求体 SHA。现有导演编辑器持有编辑缓冲，编辑时清除预览。显式保存和恢复使用每镜头一条草稿记录，并在事务中校验版本和来源。已存草稿估价使用同一编译请求和 ProviderGate dry-run；估算与账户账单、预算预留和生成操作保持区分。

## Alternatives considered

**仅通过 LibTV 生成。** 这会让青木依赖另一个产品的生成账户，也无法改善用户要求的模型直连工作流。

**改写普通文字中的引用序号。** 这可能改动引号内的对白，且无法保持引用与素材版本之间的关系。

## Consequences

实现沿用现有 DSH 插件、Writer、TaskCenter、ProviderGate 和派发 outbox。明确提交单个候选的命令在同一事务绑定已存草稿与准确报价。派发前复核来源和归一化定价；提交前失败时原子释放本地积分预留。远端提交结果不明时保持待核实。成功视频须完整解码，回流后仍是未采用候选。浏览器刷新查回服务端任务，保留结果不明的原命令编号。隔离集成测试覆盖真实 Worker/Gate/媒体链，只模拟 Provider HTTP 和下载；YAML Loader 测试覆盖 Host/Connection。本次没有新增付费调用或生产部署。
