# Agent Note：青木道具方法编译证明

Status: implemented

[English](2026-08-26-qingmu-prop-method-attestation.md) | 中文

## Problem

道具 ChangeSet 浏览器链路可以转发 IMAGO 方法投影，但易梦无法获得密码学证明，确认该投影由当前 Host 编译器针对准确的权威快照与 subject 完成过校验。

## Decision

IMAGO Host 适配器只从环境读取一个原始、不 trim 且至少包含 32 个 UTF-8 字节的 `QINGMU_IMAGO_ATTESTATION_KEY`。它编译 canonical 快照 JSON 并校验返回投影后，签发字段精确的 HMAC-SHA-256 证明，绑定 canonical 投影、输入快照和 subject 哈希。密钥会从编译器子进程环境中移除，也不会进入 Cordis 配置、浏览器数据、日志或错误。

Client 只校验公开证明的精确字段和小写 64 位十六进制值，然后原样转发投影、投影哈希与证明。命令适配器在回环转发前重新校验 canonical 投影、输入与 subject 绑定并拒绝畸形证明；它不访问签名密钥。易梦继续负责权威验证与业务变更。

## 考虑过的替代方案

- 拒绝在浏览器签发，因为这会向不可信 Client 代码暴露服务端权威和签名材料。
- 拒绝只转发无签名的投影哈希，因为它不能证明哪个可信 Host 校验了绑定的快照和 subject。

## Consequences

道具方法投影现已通过既有 Host → 浏览器 → 易梦请求合同完成密码学绑定，但不会因此获得生成、选择、付费 Provider、人工签收、Core 修改或生产状态写入权。后续[元素档案与精确影响决策](2026-08-27-qingmu-element-profiles-and-impact.zh.md)已把同一证明扩展到人物与环境。密钥轮换、生产上线及 Phase 3 完成仍不属于这项决策。
