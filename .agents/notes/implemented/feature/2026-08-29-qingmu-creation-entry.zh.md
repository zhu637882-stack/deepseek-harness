# Agent Note: 青木可恢复的项目与剧本创建

Status: implemented

[English](2026-08-29-qingmu-creation-entry.md) | 中文

## Problem

空的持久青木实例需要可编辑的剧本入口，且不能触发制作。浏览器双击及响应丢失不能创建重复项目或覆盖较新剧本。

## Decision

[创作工作区](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/CreationWorkspace.tsx)只调用[有界 Host 操作](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/creation.ts)。易梦在同一个既有 Store 事务中创建项目、季、集，以及按操作者作用域保存的 ChangeSet/回执/outbox 记录。明确的 project-bootstrap 命令表示创建，不伪造对旧对象的编辑；无需变更 schema。同键恢复校验请求及完整事务日志，同键异参失败。

Canonical TextImportService 拥有 TXT 字节、解析草稿、校正以及受指纹/版本检查保护的剧本确认。GET 恢复只读。未完成草稿创建只能通过显式同键重试，在来源及前序索引未变化时补齐自己的活动索引；后续创建将旧草稿标为陈旧以阻止回退。浏览器存储保留未保存输入及请求坐标，不拥有权威项目/剧本状态。高级剧本 JSON 保留在可展开的既有编辑器中。

## Alternatives considered

**仅前端防重复。** 禁用按钮不能在进程重启或响应丢失后恢复请求；持久的操作者作用域回执拥有创建身份。

**新项目数据库或通用 HTTP 代理。** 两者都无必要地扩大权威范围。既有易梦事务和六个允许操作保留唯一业务所有者。

**导入后自动制作。** 文本确认仅涉及解析及剧本持久化；资产生成、阶段和创意/媒体批准须另行操作。

## Consequences

创建和导入无需 Provider。粘贴及 UTF-8 TXT 有明确限制；此入口不支持 DOC/DOCX。新浏览器恢复权威已存数据，不恢复仅保存在浏览器的未提交文字。项目事务、陈旧来源拒绝及文件系统失败恢复由聚焦测试覆盖。[真实浏览器测试](../../../../apps/web/tests/qingmu-creation.e2e.ts)使用正常本地启动器、独立空库和响应丢失注入，不替换 API。本地集成不证明完整产品、媒体或人工验收。
