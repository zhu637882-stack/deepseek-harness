# Agent Note: 青木原生入口

Status: implemented

[English](2026-09-10-qingmu-native-entry.md) | 中文

## 问题

青木五阶段工作台位于 DSH。要求通过独立 Next 前端打开该工作台，会增加与其导航无关的运行和构建依赖。

## 决策

[本机启动器](../../../../scripts/qingmu-local.py) 在初始化时持久记录原生入口选择，管理已有 API、限定范围的 Worker 和 DSH Host，以 Host origin 作为入口，并在构建清单中记录 Host 产物而不要求 Next 构建身份。[旧实例决策](2026-08-29-qingmu-local-instance.zh.md) 继续适用于使用旧入口初始化的实例。

原生就绪状态核验真实 Host，不报告虚构前端进程。原生模式拒绝会停用 Host 的 review-only 启动。已有存储所有权、固定 origin、身份认证、进程清理、构建漂移检查和生成授权保持有效；该模式不授予本人批准，也不扩大调度范围。

## 考虑过的替代方案

仅为入口保留 Next 进程会重复托管。长期运行浏览器测试 fixture 无法提供正常 API 生命周期、身份认证和持久用户所有权。

## 后果

原生启动无需 Node 20 或 Next 构建，仍需完整 Qingmu profile 的 DSH 构建及真实 Writer 运行时。本人决定所需的浏览器身份独立于 Host 服务令牌。聚焦启动器检查覆盖入口端口、启动进程、缺少旧前端构建及 Host 故障；运行验收还须使用真实 CLI 和浏览器。
