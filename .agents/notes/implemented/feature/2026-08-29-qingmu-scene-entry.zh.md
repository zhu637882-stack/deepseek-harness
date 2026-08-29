# Agent Note: 绑定来源的首场镜头规划

Status: implemented

[English](2026-08-29-qingmu-scene-entry.md) | 中文

## Problem

新导入剧本只有文本场景坐标，没有数据库场景身份或可编辑分镜。用户需要有界规划入口，且不能生成媒体或伪造批准。

## Decision

[规划工作区](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/ScenePlanningWorkspace.tsx)衔接独立的[项目与剧本创作入口](2026-08-29-qingmu-creation-entry.zh.md)。易梦把已确认剧本中一场戏的版本、完整 SHA 和来源行绑定到新文本实体、1–8 个真实镜头与首个 canonical 分镜快照，在同一个既有 Store 事务中保存 ChangeSet/outbox/回执记录。Edit 复用既有内核修改。不增加 schema 或第二份业务存储。

结构 Ready 记录规划快照，不表示创意批准。空参考和缺失 PromptIR 仍保持缺失。不合并其他场景中的同名人物。浏览器恢复保留准确命令和输入；显式重试或重新准备前先 GET 恢复。首版初始化竞争时，只有保留落败请求的本地输入并明确确认后，才载入先保存的版本。

## Alternatives considered

**伪造空 Ready 前代。** 这只是为满足 Insert 而声明没有真实镜头的快照。窄首版快照操作改为原子校验和快照真实记录。

**自动提示词、参考或阶段执行。** 这些需要额外的来源和权威约定。规划不能授予这些权限或编造缺失上下文。

**替换竞争初始化。** 陈旧意图不能覆盖另一份已保存规划。浏览器保留副本；下一次修改需要新的明确意图。

## Consequences

[真实浏览器路径](../../../../apps/web/tests/qingmu-scene-planning.e2e.ts)使用正常启动器和独立空库，经 UI 创建/导入、丢弃一次真实成功响应、修改并重启到新浏览器。聚焦约定覆盖所有权、来源冲突、原子回滚和事务日志恢复。规划仍限单场；外部导演方法、PromptIR 就绪、媒体生成和内容验收属于独立工作。
