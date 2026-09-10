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
