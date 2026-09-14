# Agent Note: 原生对白表演字段位置

Status: implemented

[English](2026-09-15-native-dialogue-delivery-placement.md) | 中文

## Problem

真实原生场次稿把对白表演放在镜头顶层。分镜使用内嵌导演设计，采用时可能丢失表演要求。

## Decision

NativeSceneDesign 在采用时将无歧义的顶层 dialoguePlan 复制到 directorPlan。相同副本合并，冲突或无效值保留原稿供修正。原始返回和来源检查保持不变。

## Alternatives considered

**拒绝所有放错层级的设计。** 原本可用的稿件会为确定性的格式纠正再次调用模型。

**任选冲突版本之一。** 这会悄悄改变创作表演，因此有歧义时仍需修正。

## Consequences

聚焦采用测试覆盖顶层字段、相同副本、冲突和无效值。这个小范围兼容保留表演文字，不能证明生成媒体的音色或演技质量。
