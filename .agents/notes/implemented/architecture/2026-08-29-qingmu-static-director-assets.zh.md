# Agent Note: 青木静态导演资产准入

Status: implemented

[English](2026-08-29-qingmu-static-director-assets.md) | 中文

## Problem

导演模板与隔离模块需要可复用的来源身份，但不能引入其他项目的业务状态、执行策略或审批权威。

## Decision

[方法适配器](../../../../packages/experimental/qingmu-imago-method-adapter/README.zh.md)拥有单一静态注册表和阶段到文件的候选映射。八个选定仓库快照保留许可证、准入限制、修改记录和文件摘要。注册表固定每份完整来源账本；资产包校验拒绝额外文件、符号链接、账本漂移与内容漂移。读取单个文件前先校验完整资产包。

合并保留来源提交 `cdc619af16`、`c7a3d578de`、`c787bef97f` 和主线 E7-3/E7-4 历史。导入资产字节与来源分支相同。生成的[清单](../../../../packages/experimental/qingmu-imago-method-adapter/DIRECTOR_ASSET_SBOM.json)和[声明](../../../../THIRD_PARTY_NOTICES.md)披露准入范围；ArcReel 主应用被排除，选定 skill 保留其独立 MIT 许可证。

## Alternatives considered

**重新实现资产集合：**来源分支已经提供固定且可测试的集合并记录了限制，因此不采用。

**激活上游工作流：**静态准入既不提供隔离，也不授予执行工具、调用 Provider、修改业务状态或批准媒体的权力，因此不采用。

## Consequences

资产测试覆盖准入、完整账本校验、内容漂移、阶段映射和不执行代码的文件读取。清单与声明具有同步性测试。资产文本不进入模型上下文或运行中的 UI，因此本次修改不引入模型可见 transcript 或浏览器行为。

执行仍未激活。读取期间本地资产根目录必须保持稳定；这些检查不能抵御并发文件系统替换，也不能代替进程沙箱。BlueFish 占位符行为、运行时隔离、工作单激活、Storyboard 适配器与创作质量评估仍是独立工作。当前 Take 审核、QC、生命周期与人工签收权威不变。
