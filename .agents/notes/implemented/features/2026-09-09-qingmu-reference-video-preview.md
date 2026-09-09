# Agent Note: Qingmu reference video preview

English | [中文](2026-09-09-qingmu-reference-video-preview.zh.md)

Status: implemented

## Problem

A director cannot reliably compare reference-based video requests when media ordering and literal dialogue are mixed in one rewritable prompt.

## Decision

The existing read adapter forwards an explicit draft to Writer's read-only compiler. Stable reference tokens resolve independently for images and audio; literal text stays unchanged. The Host checks scope, ordering, compiled text and body SHA. The existing director editor owns a temporary local draft and clears previews on edits.

## Alternatives considered

**Generating through LibTV only.** This leaves Qingmu dependent on a separate product's generation account and does not improve the direct model workflow the user requested.

**Rewriting numbered references in plain text.** This can alter quoted dialogue and loses the connection between an edited reference and its asset version.

## Consequences

The implementation extends existing DSH plugins and Writer adapters. It adds no agent loop, workflow engine or paid submission path. Saving reference drafts, validating media at dispatch and attaching these inputs to the existing generation queue remain separate work. Unit and browser interaction tests cover explicit input and stale previews; a YAML Loader composition checks the real Host and Connection RPC path with only the upstream service stubbed.
