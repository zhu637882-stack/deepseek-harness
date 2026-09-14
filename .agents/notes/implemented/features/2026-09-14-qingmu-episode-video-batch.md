# Agent Note: Qingmu episode video preparation

Status: implemented

## Problem

Whole-scene direction was saved together, but reference preparation and generation still required opening every shot. Asset display names also suggested off-frame owners in otherwise complete prop-image prompts.

## Decision

Use the existing native writing result for episode reference choices and the existing single-shot draft, upload, quote and run ports. Keep saved director text verbatim, resolve references through real project assets, preserve existing drafts and candidates, and queue ready shots without awaiting remote rendering. Share the single-shot pending-command key for uncertain responses. Complete asset views describe visible subjects without prepending owner-bearing display names; the frozen asset retains its name and identity.

## Alternatives considered

A new batch database, scheduler and approval framework would duplicate the current persistent task queue. Manually repairing film-specific prompts would leave future projects on the same broken route.

## Consequences

Preparation can report a per-shot failure while other shots remain usable. A batch action does not approve resulting media or claim every optional creative method applies to each shot. Focused tests cover sound preservation, missing/duplicate references, multiple queued shots, existing candidates and lost-response recovery; the native preset example records an episode plan through the real writing loop. Live generation quality remains separate from these checks.

The same batch workspace collects completed runs into the existing shot review stack through the normal registration ports, retaining already registered candidates and leaving running tasks alone. Collection never selects or approves a video.
