# Agent Note: Qingmu director frame route

Status: implemented

English | [中文](2026-09-13-qingmu-director-frame-route.zh.md)

## Decision

The precise-reference workspace only emitted multimodal references, so a composed image could not become the actual video starting frame. Add optional image endpoint roles to the existing draft, compiler and native tools, reusing preparation, quotes, queued tasks and review. Preserve old drafts by omitting the new field unless chosen. Do not copy another shot’s endpoint role during material inheritance.

Wan3 frame inputs cannot mix separate image, audio or video references. The editor explains the tradeoff and keeps invalid mixtures editable; the server checks actual asset types and the provider body. Neither switching routes nor passing a request check proves visual compliance.

## Validation

Focused browser-component, native-tool and adapter checks cover roles, save/reload, unchanged text, invalid mixtures and inheritance. Writer checks save/quote/queue/worker dispatch and immutable requests after later edits; temporary OSS frame inputs produce the required transport header. Runtime and real-media verification are recorded separately in the implementation checkpoint.

## Source

[Alibaba Wan3 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference), checked 2026-09-13.
