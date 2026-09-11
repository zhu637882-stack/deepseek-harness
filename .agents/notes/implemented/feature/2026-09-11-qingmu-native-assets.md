# Agent Note: Native asset design and generation

Status: implemented

English | [中文](2026-09-11-qingmu-native-assets.zh.md)

## Problem

A new project could import a screenplay but its asset workspace only uploaded references. Initial image generation depended on an older script foundation route.

## Decision

Let the native director author editable character, scene and prop cards from the saved screenplay. Save those cards and the director bible atomically into existing project records. Quote the exact image request and queue one confirmed image through the existing budget gate, reservation, worker and media finalizer. Recover task progress after navigation without resubmission. Existing actors and scenes are reused when initializing storyboards.

## Alternatives considered

Another provider client would bypass the shared budget and task recovery. Upload-only creation would leave new projects incomplete. Treating native Markdown skills as old JSON method packages would discard the current director method. The image source retains the actual authored design and method identity without inventing model execution evidence or media approval.

## Consequences

The new API requires an authenticated owner and a saved screenplay. Script or design changes invalidate an unsent quote. Generated images remain candidates. Native AI design uses the existing DSH model account; image generation uses the shared Ali budget. The runnable native example and UI tests cover design adoption, quotation and read-only recovery. Provider output quality is checked separately in the film project.

Native asset cards preserve script facts, director inferences and explicit world exceptions. Each image keeps its relevant design basis, view and up to nine ordered project references with exact hashes and reuse instructions; optional regions use original-image pixels. Wan editing receives those image bytes and instructions through the existing task queue. A changed source invalidates the quote. Updating a description retains selected images and flags them for comparison; generating a candidate never replaces them. Authored scene views and requested text are preserved, and overlong requests fail without truncation. Reference previews and quotation do not upload or generate media.

A real screenplay run revealed that unbound writing was incorrectly treated as existing-shot editing and produced contradictory prop transitions. Creation requests now name their stage, the persona scopes shot tools to existing-shot work, and the main director method checks causality in the actual script. Canonical import still occurs through the existing editable-text and preview flow; this change does not claim automatic aesthetic acceptance.

Asset design now consumes effective creation settings at authoring time as well as at image submission. The director-method update declares exact compatible predecessors, preserving existing project contracts and selected media.

The second real writing candidate still rationalized a missing required world exception. Add an optional source-only screenplay revision through a separate native session, reusing draft adoption and recovery. The critic receives original intent and current text, not the writer’s claims about its own correctness.

Qingmu uses the native Pro model default for new creative sessions after a real Flash screenplay and independent review produced contradictory actions and false chronology corrections. User selections remain authoritative. Asset refinement receives current unsaved card edits as well as saved source data, so references and world decisions survive a refinement request.

Image framing belongs to each asset design. Film delivery framing can crop a full-body costume reference, while image edits normally inherit source framing. The existing output-size mapping drives a saved optional ratio through quotation to the provider snapshot. Narrative design facts remain available as background; the image execution paragraph selects only the current visible state. This ordering avoids treating future actions as a simultaneous object inventory without discarding the underlying design. Existing designs use auto until explicitly changed.

Scene drafts bind the asset-state SHA as well as the screenplay. Adoption rereads the saved state, so costume or layout edits made during a model run cannot silently reuse its old basis. Asynchronous adoption preserves the draft on a read failure or conflict. The director brief distinguishes an initial still from subsequent actions and requests motivated camera paths without prescribing movement in every shot.

The scene asset method explicitly designs narrative set dressing and intentional negative space. Generic instructions to simplify a composition can otherwise erase meaningful background detail. Asset authoring carries visible decisions into the image description and keeps their rationale in the existing design basis, avoiding a parallel scene schema. Runnable method delivery and contrasting scene requests verify the path; generated pixels require separate review.

Non-final browser media can use an expiring signed relative path when no public Provider URL exists. The read adapter resolves that capability against the configured local Writer, so generated images remain visible in the library and region editor. Public Provider reachability checks and authenticated final-media access remain separate.
