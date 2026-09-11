# Agent Note: Source-bound first scene planning

Status: implemented

English | [中文](2026-08-29-qingmu-scene-entry.zh.md)

## Problem

A newly imported script has text scene coordinates, not database scene identities or editable storyboard frames. Users need a bounded planning entry without generated media or fabricated approval.

## Decision

The [planning workspace](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/ScenePlanningWorkspace.tsx) follows the independent [project and script creation entry](2026-08-29-qingmu-creation-entry.md). Writer binds one confirmed script scene's revision, complete SHA and source lines to text entities and up to 64 real frames per request, within the request-size limit. The existing Store transaction saves the canonical storyboard with ChangeSet/outbox/receipt records. Later scenes append to the episode while earlier saved plans remain editable. An Edit uses the existing kernel mutation; no second business store is introduced.

The outer shot selection owns both the reference workspace and scene planning editor. Selecting within either view updates the other; local unsaved planning input blocks navigation until saved or restored. The director stays unbound while its target differs from the visible editor. Independent local selection would allow a request about the visible shot to address another shot, even if the underlying context binding were internally valid.

Structural Ready records a planning snapshot, not creative approval. Empty references and absent PromptIR stay missing. Same-name actors in other scenes are not merged. Browser recovery retains exact commands and input; GET recovery precedes explicit retry or re-preparation. A competing first initialization loads the winner only after preserving the losing input locally and explicit confirmation.

The embedded cockpit emits a versioned save notification only after it has reread the saved planning and current Director context. The notification binds the exact parent origin, project, episode, scene, shot, context SHA and receipt. The outer Writer rejects any other source, origin, shape or scope, deduplicates the event, rereads both canonical resources, refreshes its workflow projection and locates only that exact shot. A stale canonical read remains a visible failure and never becomes an outer success state.

## Alternatives considered

**A fabricated empty Ready predecessor.** It would claim a snapshot without real frames merely to satisfy Insert. The narrow first-snapshot operation instead validates and snapshots actual rows atomically.

**Automatic prompts, references or stage execution.** These require additional source and authority contracts. Planning cannot grant those permissions or manufacture missing context.

**Replacing a competing initialization.** A stale intent cannot overwrite another saved plan. The browser retains a copy; another edit requires a fresh explicit intention.

## Consequences

The [creation browser path](../../../../apps/web/tests/qingmu-scene-planning.e2e.ts) covers persistence and outer notifications. The [keyless selection transcript](../../../../apps/web/tests/qingmu-scene-selection.spec.ts) runs against the normal launcher with a saved test scene containing at least three shots. Set `QINGMU_SELECTION_URL` and `QINGMU_SELECTION_STORAGE_STATE`; it exercises both selections and unsaved input without a model or business write. Focused tests additionally cover cross-scene selection and detaching a stale director. Planning and selection do not imply media generation or content acceptance.
