# Agent Note: Qingmu native entry

Status: implemented

English | [中文](2026-09-10-qingmu-native-entry.zh.md)

## Problem

The five-stage Qingmu workspace lives in DSH. Requiring a separate Next frontend to open that workspace adds a runtime and build dependency without serving its navigation.

## Decision

The [local launcher](../../../../scripts/qingmu-local.py) persists native entry selection at initialization. It manages the existing API, scoped workers and DSH Host, exposes the Host origin as the entry, and records Host artifacts without a Next build identity. Native readiness checks the real Host and never reports an invented frontend process. The [legacy instance decision](2026-08-29-qingmu-local-instance.md) continues to apply to instances initialized with the legacy entry.

Native mode rejects review-only startup because that mode disables the Host. Existing storage ownership, fixed origins, authentication, process cleanup, build drift checks and generation authorization remain in effect. The mode does not grant human approval or broaden dispatch scope.

## Alternatives considered

Keeping a Next process just for entry duplicates hosting. A permanent browser-test fixture does not provide ordinary API lifespan, authentication or durable user ownership.

## Consequences

Native startup needs no Node 20 or Next build. It still needs a complete Qingmu-profile DSH build and the real Writer runtime. Browser authentication for human decisions remains separate from the Host service token. Focused launcher checks cover entry ports, startup roles, missing frontend builds and Host failure; runtime acceptance must additionally exercise the actual CLI and browser.
