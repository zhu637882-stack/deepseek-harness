# Agent Note: 青木引用视频预览

[English](2026-09-09-qingmu-reference-video-preview.md) | 中文

Status: implemented

## Problem

当素材顺序和原始对白混在同一段可改写提示词中时，导演难以可靠比较带参考素材的视频请求。

## Decision

现有只读适配器将明确的草稿交给 Writer 只读编译器。图片和音频的稳定引用标记分别编号，原始文字保持不变。Host 校验范围、顺序、编译文字和请求体 SHA。现有导演编辑器持有编辑缓冲，编辑时清除预览。显式保存和恢复使用每镜头一条草稿记录，并在事务中校验版本和来源。

## Alternatives considered

**仅通过 LibTV 生成。** 这会让青木依赖另一个产品的生成账户，也无法改善用户要求的模型直连工作流。

**改写普通文字中的引用序号。** 这可能改动引号内的对白，且无法保持引用与素材版本之间的关系。

## Consequences

实现沿用现有 DSH 插件和 Writer 适配器，不增加 Agent 循环、工作流引擎或付费提交通道。提交时媒体校验和接入既有生成队列仍是后续工作。草稿持久化不改变选定的 PromptIR 或生产状态。单元与浏览器交互测试覆盖明确输入和过期预览；YAML Loader 组合测试通过真实 Host、Connection RPC，仅替换上游服务。
