# Agent Note: Qingmu bound Shot findings and receipt recovery

Status: implemented

English | [中文](2026-08-27-qingmu-shot-finding.zh.md)

## Problem

The same canonical Shot needs an explicit reviewer's problem record. Existing video defects lack the complete Finding contract and cannot become new approval or rework authority by inference. A lost POST response must not cause a second write or lose the original receipt when today's selected video changes.

## Decision

Yimeng alone stores the Finding through its existing ChangeSet, receipt, and outbox transaction. The Host rereads the selected-video subject, compiles the current IMAGO method, verifies the fixed 18 source hashes, and attests the exact subject and method. Reviewer permission is checked by Yimeng, not by the browser's form. The eight author fields are explicit and preserved, including duplicate references; Python-compatible text validation never rewrites canonical IDs or author text.

The cockpit adds a problem form and history under the existing shared Shot. It uses the same frame ID and displayed frame number, validates the business storyboard revision, and isolates stale responses when selection, source, or adapter changes. Owner and severity start empty. Normal UI uses professional role names; internal stage codes stay in expandable record details.

Before one POST, the browser synchronously persists and reads back an eight-field recovery marker containing only scope, idempotency key, and subject/payload/method hashes. Unknown outcomes retain it. Explicit recovery performs GET only with the original coordinates; a verified original receipt can clear it even when current media or methods are unavailable. A missing receipt retains the marker. This is same-tab session storage, not cross-browser persistence.

Recording always yields an OPEN Finding. It does not approve content, change selection or quality, release a lock, route a task, run rework, or call a Provider. Historical bindings stay historical. Harness holds references, not a second business ledger or project DAG.

## Alternatives considered

**Promote old defects automatically.** That invents responsibility, severity, and reviewer intent. Existing review evidence remains read-only; a new Finding requires all author fields.

**Retry an uncertain POST or recover against current media.** Either risks a second write or loses the old transaction. Recovery queries only the frozen idempotency and subject coordinates.

**Use ordinary JavaScript trimming everywhere.** Its whitespace set differs from Python's authority contract. The bounded Finding validators match that contract while preserving original Unicode and code-point limits.

## Consequences

The new local path is testable through real Core compilation, Yimeng temporary SQLite, and real Host/Chromium with an isolated HTTP upstream. These are complementary local checks, not a production end-to-end claim. Formal schema/API remain opt-in. Actual Stage/LSU/approval-lock authority and executable rework are still separate unfinished work. No paid generation, production database activation, human signoff, or push is implied.
