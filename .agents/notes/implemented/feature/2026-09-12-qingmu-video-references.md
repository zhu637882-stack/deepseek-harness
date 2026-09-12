# Agent Note: Video references in the Qingmu director workflow

Status: implemented

English | [中文](2026-09-12-qingmu-video-references.zh.md)

## Problem

Still images cannot express all motion and spatial relationships needed by a director. Accepting a video URL alone also omits inspected duration, upload behavior and input-video cost.

## Decision

Video references share the existing scoped drafts, preparation, compilation, quotation and worker submission. Writer probes and hashes local clips before preparation and rechecks sources at dispatch. Duration remains outside the provider body. Video quotation includes input plus output seconds, with fixed-decimal checksum projection across Python and JavaScript. The workspace and native director preserve ordered bindings without selecting the source or result.

## Alternatives considered

A second video-editing workflow would duplicate drafts and generation controls. Output-only pricing would underestimate the paid request. Neither alternative is used. Automatic duration remains outside this explicit-duration implementation; the existing adaptive aspect-ratio choice is retained.

## Consequences

Existing image/audio drafts remain readable. The implementation needs actual local-media, upload, quotation and dispatch failure checks, a native director transcript, and browser save/restore verification. Passing those checks proves integration, not the creative quality of a generated result. Each source still needs review for errors before reuse.
