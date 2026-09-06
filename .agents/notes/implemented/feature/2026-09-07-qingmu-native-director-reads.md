# Agent Note: Native Qingmu director reads

Status: implemented

English | [中文](2026-09-07-qingmu-native-director-reads.zh.md)

## Problem

Binding a DSh session to a Writer shot records its identity, but does not give the model the shot's creative input. Method registration and source hashes likewise do not expose IMAGO's actual directing instructions. An assistant can appear connected while lacking the evidence needed for a useful suggestion.

## Decision

Add an opt-in, scoped `model-tools` entry to the director context bridge. It uses the existing Host command adapter to read the bound Writer snapshot and the IMAGO method adapter to read complete C or C5 Skill text and direct references. C5's fourth reference is available through a fixed follow-up resource ID. The model cannot choose another session, object, filesystem path, or method root.

Use the native tool registry and agent loop. Ordinary tool results preserve the exact returned JSON in the existing session log and next model request; binding events remain log-only. Refresh the current context before each read, reject late results after a scope switch, and retain manual editing on failure. Source hashes identify method bytes but confer no business or creative approval.

Writer stays the business truth; Core stays the method source. No copied project, new database, controller or agent loop is introduced. This implements a source-level read capability, not deployment or a complete creative workflow. IMAGO is used for scene intent, performance, blocking, continuity, and sound-picture reasoning, not reduced to a prompt-formatting library.

The experimental Qingmu bundle ships a `qingmu-director` preset with a complete creative persona and these two tools. The generic profile loader resolves an optional `dsh.bundle.agentPresets` directory inside each listed bundle; the CLI adds it after stock presets, without importing an experimental package from a release app. The Qingmu distribution default selects this mode, subject to native user settings. Existing sessions retain their recorded composition. The mode is read-only, separate from coding and system-editing presets; it does not turn creative instructions into arbitrary filesystem or execution authority.

## Alternatives considered

**Inject all skills into every system prompt.** This would increase tokens and hide which method was actually requested. Explicit, complete tool responses are replayable and let the agent read required references as needed.

**Expose generic filesystem or all Writer commands.** That would widen authority before the read boundary is proven. Fixed method IDs and the session binding provide the needed content without business mutation or arbitrary file access.

**Build another orchestration loop.** DSh already persists tool calls and results. A parallel loop would duplicate recovery and make model input harder to inspect.

## Consequences

The cockpit now binds selected canonical automatic-storyboard shots as well as legacy planning shots. Accepted different-object entry clears the old durable binding before I/O; failed or cancelled reads stay unbound, and rejected proposals or unbound recovery cannot supersede an in-flight selection. Scope-bound browser cleanup leases prevent an old view from clearing a newer binding; clearing selection and unmounting clear the owned binding, and revision changes rebind. Null is a log-only clearing value, not a business deletion. Projection readers and the bridge must ship together. Browser status separates the last context synchronization from actual preset/tool readiness. Runtime-only leases do not survive Host restart; successful persisted bindings still recover and require re-entry for browser cleanup, while persisted null remains unbound. Disconnected cleanup is not guaranteed.

Opted-in agents can receive actual Writer context and IMAGO method text. Root and ordinary agents do not acquire these tools. Textual context does not prove image quality or a full-screenplay understanding; unavailable facts remain unknown.

The source loader bounds file reads and rejects outward symlinks; deployment must still keep the method tree stable during reads. A 512 KiB source package may exceed the consumer's default 256 KiB serialized-response limit, which fails without truncation. Full method text consumes tokens only when requested.

The runnable keyless example and Loader-preset tests load the actual shipped director composition and use scripted external responses. They verify the persona, next model input, scoped catalog and cold log restoration; launcher tests verify bundle-only root composition. Component, bridge and RPC tests cover same-session binding transitions and stale-response rejection. These checks cannot establish real-provider quality. Proposal adoption, Writer persistence, PromptIR, generation, production activation and reconnect behavior still require their own connected flow and runtime verification.
