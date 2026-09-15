# Agent Note: 剧本确认前读取产品

Status: implemented

[English](2026-09-15-qingmu-prescript-product-read.md) | 中文

## Problem

新项目的原生编剧调用 `qingmu_read_asset_design` 查看上传的产品参考。Writer 将保存设计的前提也用于读取，导致没有剧本时返回 `asset_design_script_required`。

## Decision

读取沿用规划服务的归属校验，但不要求已有剧本。适配器将缺失的 `script` 和 `scriptSha256` 表示为 null，同时返回创作设定和产品参考。已有剧本的来源校验与保存设计的前提仍由 Writer 执行。

## Alternatives considered

**先创建占位剧本。** 未采用，因为读取上传素材不应创建正式剧本，也不应暗示编剧阶段完成。

## Consequences

编剧可以查看本项目的产品输入。客户端只读发现阶段须兼容没有剧本的状态；保存设计及生成仍满足原有前提。Writer 回归测试覆盖新建产品项目、跨用户拒绝，以及读取和拒绝保存后的存储不变；适配器测试覆盖 GET 返回的空剧本字段与产品参考。
