# Agent Note: Preflight a locally returned editorial master

Status: implemented

English | [中文](2026-09-01-editorial-master-return-preflight.zh.md)

## Problem

A verified OTIO handoff package does not prove that a later local master is readable, contains both picture and sound, or still belongs to the same project, episode, source, and package receipt. Treating file selection as a formal return would also invent editor activity, release authority, and human sign-off.

## Decision

The Host derives a returned-master capability only from the same authenticated successful package-import preview. The capability binds the original download and import request IDs, package SHA and size, project, episode, source snapshot, and projection. Browser bytes are streamed to an owner-only Host spool with a 32 GiB ceiling and independently hashed. A domain-separated HMAC then binds those immutable receipt facts plus the calculated master SHA and size for Writer; no Host key or trusted coordinate enters browser RPC.

Writer streams the exact bytes into its private instance spool, checks the declared SHA and size, verifies that current source and projection are unchanged, and runs a read-only magic/container plus ffprobe inspection. It reports duration, geometry, frame rate, video and audio streams, and structured blockers. Detectable no-audio, missing duration, unsupported container, or unavailable probe conditions remain visible blockers rather than success. The database and formal media tree are never mutated, and temporary files are removed on every terminal path.

One receipt lineage owns one canonical preflight state. A repeated status read or refreshed handoff rotates the capability without creating a second result; an old capability fails. Success and failure survive Host restart, while an interrupted running operation becomes an explicit failed state and never reuses partial bytes.

## Alternatives considered

Writing the returned file into the business media tree was rejected because a technical probe is not a formal return or release decision. Browser-side probing was rejected because it cannot bind trusted receipts or protect service identity. Reusing a shared temporary directory was rejected because it weakens instance ownership and restart cleanup.

## Verification

Focused Writer tests cover media facts, no-audio and probe-failure blockers, HMAC and owner binding, current-source drift, byte identity, and zero database or media-tree change. Host tests cover the one-use upload, exact Writer binding, terminal recovery, no second upstream request, and private spool cleanup. UI tests cover the successful facts, exact boundary label, retained local input, and package-preview prerequisite. The isolated FastAPI, built Host, and Chromium path exercises the same stream and recovery contracts without Provider calls.

## Consequences

This result is only a technical preflight. It does not prove that an NLE opened, an editor consumed the handoff, a master was formally returned, a release is ready, or a human signed off. Full editor return recording, immutable evidence freezing, release manifest checks, and actual NLE observation remain outside this slice.
