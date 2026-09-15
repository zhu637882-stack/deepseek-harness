# Agent Note: Qingmu batch director reconciliation

Status: implemented

English | [中文](2026-09-15-qingmu-batch-director-reconciliation.zh.md)

## Problem

Batch authoring required a selected-shot binding to read old video observations, although its writing session has only an episode scope. Source contradictions could only be reported; the adoption path could not save the director's corrections before assembling video drafts.

## Decision

The existing candidate reader accepts the current creative episode request and checks shot membership. A batch proposal can include optional `directorRepairs` for its prepared shots. The existing adoption action validates the complete proposal, saves each repair through ordinary scene planning with sequential source revisions, then rereads sources and compiles through the shared single-shot prompt assembly.

## Alternatives considered

Manually copying corrections into each shot would leave the next batch with the same gap. Direct model writes would bypass the writing session's proposal/adoption boundary. A separate batch database or generation service is unnecessary; existing planning receipts and single-shot ports cover these operations.

## Consequences

Unknown receipt recovery fails before another save. Retrying the same proposal and source snapshot recovers an earlier committed repair before continuing; a fresh-page source change requires a new reconciled proposal. Existing candidates and canonical dialogue are preserved. Loader-backed tests exercise unbound batch review and episode isolation. Batch tests cover fresh source assembly, sequential saves, response loss and invalid proposals. These checks establish transport and preparation behavior, not visual or audio acceptance of generated films.
