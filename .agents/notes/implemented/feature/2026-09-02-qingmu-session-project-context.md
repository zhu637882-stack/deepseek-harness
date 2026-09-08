# Agent Note: Qingmu session-bound project context and director replay

Status: implemented

English | [中文](2026-09-02-qingmu-session-project-context.zh.md)

## Problem

The existing Qingmu adapters could read current Yimeng production facts and expose an immutable IMAGO director replay method, but DSh had no durable identity for which project object a session was discussing. Calling the existing director proposal command was not suitable because it writes a Yimeng work order. Keeping selection only in a browser or process-local variable would lose it on restart, while copying project content into Harness would create a second business source of truth.

## Decision

`@deepseek-ai/dsh-experimental-qingmu-project-context` records one whole-value `qingmu/project-context` event in the existing DSh session log. The value contains only project, episode, Scene, and Shot coordinates plus the exact episode, storyboard, and Scene revisions and the storyboard, Scene, Shot, and context SHA-256 identities. The latest event is the current binding, so switching Shots and restoring a stopped session use the same deterministic fold. No new persistence system or business ledger exists.

Every suggestion rereads the normalized Yimeng workflow. A revision or SHA difference, or a removed or moved Scene/Shot after a successful read, appends a `stale` state and returns `refresh_required` before loading the IMAGO method. A fresh binding loads only the existing zero-authority `directorReplayMethod` and constructs a deterministic proposed change set for the bound Shot. Text and visual suggestions preserve their separately declared output schemas. The response names the current object, exact method and context hashes, explicit differences, impact scope, and negative authority. The session retains a compact hash receipt rather than proposal or project prose; replay validation recomputes each binding identity and relates each receipt to the current binding before it.

The private loopback handler owns only `bind`, `current`, and `suggest`. It neither imports the Yimeng command adapter nor modifies launcher, status, navigation, authentication, proxy, runtime-route, creation-setting, ProviderGate, release, Stage, or cost contracts. No application bundle loads the package in this slice. Missing method capability leaves manual work available.

## Alternatives considered

**Reuse the existing director proposal command.** Rejected because that path creates a Yimeng work order; this slice must prove context and replay suggestions without business writes.

**Persist selection in a second Qingmu database or browser store.** Rejected because restart recovery already belongs to DSh session persistence, and another store would introduce competing authority and drift.

**Copy the current project snapshot into the session log.** Rejected because the session needs coordinates and freshness identities, not a replica of business content. Fresh content is read from Yimeng at use time.

**Treat IMAGO or model unavailability as a blocked session.** Rejected because the replay suggestion is advisory. Manual creative work remains available and no Provider call is required for this deterministic slice.

## Consequences

A DSh session can resume the exact Qingmu object it was discussing, switch Shots explicitly, and reproduce the same SHA-bound suggestion while inputs stay unchanged. Source drift fails closed before suggestion construction and requires an explicit refresh. The package gains no approval, selection, generation, budget, Provider, or business-write authority. The cost is that a caller must bind again after any relevant revision or SHA changes, and a later application composition must deliberately load this optional package before its RPC is available.

## Testing

The package test uses the real event-sourced `Session` implementation with injected read-only workflow and method handlers. It covers exact binding, deterministic replay, Shot switching, revision/SHA and removed-Shot invalidation, corrupted binding/receipt rejection, cancellation, compact receipts, zero-authority fields, and method-unavailable manual continuation. A JSONL persistence round trip remounts the backend before restoring the exact binding. Package typecheck, repository constraints, documentation gates, and lint cover the new workspace and event declarations.
