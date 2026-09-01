# Agent Note: Verify a downloaded editorial package for consumption

Status: implemented

English | [中文](2026-09-01-editorial-handoff-consumption-preview.zh.md)

## Problem

A successful browser download proves only the bytes returned at that moment. It does not prove that a later local file is the same package, that a native OTIO consumer can still parse its tracks and media references, or that its project, episode, source snapshot, and projection are still current.

## Decision

The Host derives a one-use import capability from the Writer-authenticated successful download terminal. The browser can only reselect a ZIP and never supplies trusted identity, package SHA, size, or source coordinates. The Host streams the upload into a 0600 file under its private DSH home, checks the exact terminal size and SHA-256, and only then streams it to a new authenticated Writer read-only verifier under a domain-separated Host HMAC. Its per-instance key is private, rotates on restore, and fails closed when absent or short. Interrupted spools are removed, and startup removes only this feature's named orphan directories.

Writer reuses the canonical package verifier, validates the exact archive inventory and each entry digest in chunks, parses native OpenTimelineIO 0.18.1 JSON, and binds the Picture and Dialogue tracks, clip order, source ranges, and relative media references to the manifest. A separate current projection read reports whether the otherwise-valid package still matches current project and episode authority. Source drift does not become package corruption or success.

The Director desk presents the receipt match, internal package validity, and current-authority match as three independent conclusions. It shows track and shot summaries without opening an NLE. A successful terminal preview is recoverable after refresh or restart from a freshly scoped capability without reuploading or contacting Writer again. Failed selection retains the local file in the browser for an explicit retry.

## Verification

Writer tests cover Host-service authentication, native-reference self-signing, archive tampering, owner and scope checks, exact receipt bytes, and current-source drift. Host tests cover missing service credentials, changed or truncated bytes, login and scope changes, one-use recovery, Host restart, and orphan cleanup. UI tests cover the three independent conclusions, retained input, terminal-status recovery, and rejection of late import responses after refresh or scope change. The built Qingmu Host and actual FastAPI Chromium path downloads and reselects the package, previews both tracks, restarts FastAPI, recovers in a fresh browser context, and confirms the fixture database SHA and storage tree are unchanged with zero external requests.

## Alternatives considered

**Trust a browser-computed digest.** Rejected because the browser must not assert the receipt SHA, authenticated identity, or source coordinates. The Host instead derives all authority from its authenticated successful-download terminal and independently streams and hashes the reselected bytes.

**Upload directly from the browser to Writer.** Rejected because that would expose a privileged Writer credential or broaden the browser API. The narrow same-origin Host bridge keeps authentication and the one-use binding out of the browser contract.

## Consequences

This is a read-only editorial consumption preview. It does not open an NLE, establish production completion or release readiness, or infer human sign-off. Media container validation is still bounded rather than a complete independent decode. Central-directory and ZIP64 header details are not independently locked beyond Python's ZIP parser and the existing deterministic envelope checks, and ancestor-directory replacement remains a deferred TOCTOU hardening item.
