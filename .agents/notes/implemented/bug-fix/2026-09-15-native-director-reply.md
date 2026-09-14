# Agent Note: Native director reply visibility

Status: implemented

English | [中文](2026-09-15-native-director-reply.zh.md)

## Problem

The shot composer acknowledged ordinary performance requests but rendered only structured dialogue-edit progress. A completed director reply was invisible in the cockpit.

## Decision

Expose the latest project-director reply through the existing read-only native history port. Show pending and failure states explicitly, and discard late reads after navigation. Reading does not replay a prompt or save creative data.

## Alternatives considered

**Create a separate director execution pipeline.** Unnecessary; the native session already owns the result.

## Consequences

Nine focused reply and session-UI tests pass. The panel labels its content as the latest director reply, not a current-shot approval. Runtime and creative review remain separate.
