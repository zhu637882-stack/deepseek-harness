# Agent Note: Qingmu selected video review evidence

Status: implemented

English | [中文](2026-08-27-qingmu-selected-video-review.zh.md)

## Problem

The continuity panel did not expose defects already recorded on the current selected video. Copying candidate status or asset timestamps into a new approval model would lose source identity and could promote stale or unselected evidence.

## Decision

Reuse the existing Yimeng video-candidates GET through the Host read adapter. Accept only three IDs and project the unique selected asset's original review after validating identity, selection, status, asset SHA, and acceptance consistency. Keep legacy omissions explicit; omit media URLs, costs, and asset timestamps. Yimeng remains responsible for current media and frame binding. An unavailable file's stored SHA is not proof of current bytes.

Render that metadata next to continuity using the same canonical Shot. Preserve original defects, zero and fractional timecodes, null timecodes, and notes. Check the review's revision against the visible episode revision. Cancellation and request identity isolate refreshes, source changes, Shot switches, and closure. The only control rereads the source.

## Alternatives considered

**Add a new Yimeng API or review store.** The existing endpoint already provides the required source facts; no production runtime or schema change is necessary.

**Promote accepted candidates or machine quality to signoff.** Only the uniquely selected asset is displayed. Existing review and machine-exception records do not grant independent Qingmu or IMAGO approval, authenticated reviewer roles, or automatic rework.

**Load media to create a new review workflow.** This slice only connects existing evidence; it adds no media load, approval button, or Provider operation.

## Consequences

Host and UI tests cover original statuses, omitted legacy fields, exact binding, and late responses. Yimeng tests run the existing API against query-only temporary databases and real local fixture bytes. Chromium verifies shared selection and read-only behavior without touching formal data or generating media. Formal Findings, responsibility, locks, and production acceptance remain separate work.
