# Agent Note: 收口剪辑交接包信任链

Status: implemented

[English](2026-09-01-editorial-handoff-package-trust-chain.md) | 中文

## Problem

剪辑交接包可以绑定外层归档摘要，但内部条目仍是隐式集合；Host 的一次性 capability 也没有携带 Writer 已认证用户身份。因此切换登录后仍可触达旧 capability，原生 OTIO 消费者也缺少包级证据，无法确认所有声明的媒体字节和 timeline 条目与 manifest 一致。分镜场景标识和对白媒体类型在导出前也需要精确的权威绑定。

## Decision

易梦把每个镜头投影到当前项目所属的 canonical 场景，并拒绝悬空或跨项目场景标识。对白媒体必须声明 `audio/*` 媒体类型；媒体去重把语义类型纳入冲突判定。

Manifest 声明除自身外精确的 ZIP 条目集。每个 timeline、未解决数据、视频和对白音频条目都携带路径、类型、字节大小和 SHA-256。确定性 ZIP_STORED 归档写完后，易梦会独立重新打开，拒绝缺失、额外和重复名称，核验每个声明条目，再通过原生 OpenTimelineIO 0.18.1 `opentimelineio.adapters.otio_json` 直接 API 与固定的 0.18.1 schema map 解析并往返 timeline。HTTP 响应继续用外层大小和 SHA-256 绑定完整归档。

Host 从易梦已认证的 `/api/auth/me` 响应取得当前用户，并把该服务端身份纳入私密持久 capability 绑定。浏览器查询参数不包含用户身份或 Writer token。其他当前登录会获得禁止响应，但不消耗 capability；原用户可在 Host 重启后恢复终态。

## Alternatives considered

**信任浏览器上报当前用户。** 不采用，因为浏览器提供的标识会成为第二身份来源，可被脱离 Writer JWT 伪造。

**只依赖完整 ZIP 摘要。** 不采用，因为 manifest 不能独立定义原生剪辑器的精确预期输入，也无法独立拒绝未声明的归档成员。

**使用通用 OpenTimelineIO adapter registry。** 不采用，因为环境中的插件 manifest 和 adapter 选择会改变解析结果。直接原生 adapter 才是本交付的互操作合同。

## Verification

Writer 聚焦测试覆盖内部 timeline 与未解决数据篡改、条目缺失、额外和重复、插件环境变量污染下的直接原生 adapter、场景作用域、对白媒体类型及含 kind 的冲突。Host 测试覆盖 Writer 认证用户绑定、切换登录不消耗 capability、重启恢复和私密 token 处理。隔离 FastAPI、构建 Host 与 Chromium 路径下载一个包，用原生 adapter 解析，拒绝内部被篡改的副本，并在零外部请求和零业务写入下验证登录切换恢复。

## Consequences

剪辑交接包可带着明确条目清单和两层完整性绑定交给 OpenTimelineIO 0.18.1 消费者。没有认证用户字段的旧 capability 会失败关闭，不会被静默升级。媒体 magic 校验仍是有界的容器检查，不是完整解码；祖先目录替换仍不在本次变更范围内。
