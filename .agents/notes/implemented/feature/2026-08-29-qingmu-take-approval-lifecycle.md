# Agent Note: Qingmu Take approval lifecycle

Status: implemented

English | [中文](2026-08-29-qingmu-take-approval-lifecycle.zh.md)

## Problem

A small production team needs one auditable path from ordinary discussion through human review, technical QC, formal Take approval, and later episode verification. Those records have different owners and meanings. A generic status would let a comment, recommendation, machine-oriented technical pass, or stale approval masquerade as final authority. An uncertain browser response could also duplicate a write if recovery repeated the command.

## Decision

The workflow keeps five meanings separate: an ordinary comment, a Reviewer recommendation or Approver decision, technical QC evidence, formal Take approval, and whole-episode verification. Yimeng remains the sole journal and business authority. IMAGO Core is stateless and compiles the current technical-QC and approval-lifecycle methods. Harness validates, displays, and forwards explicit intents without storing a second workflow truth.

E7-2 records Reviewer recommendations and Approver decisions independently. Yimeng authenticates role, session, producer, participants, and natural-person identity. An Approver cannot be the producer or a review participant for the same Take subject, and changing role or session cannot bypass that natural-person separation. A recommendation is never promoted into a decision.

E7-3 records an immutable technical assessment against the exact current selected Take, strict receipt evidence, fixed macro and micro checks, and current rules. A pass requires a passing receipt and no macro or micro issue. It is technical evidence only and does not approve content.

E7-4 permits only `APPROVE`, `INVALIDATE`, `REQUEST_REWORK`, and `RESUBMIT` when the freshly compiled method declares the action legal. Approval binds the exact selected Take, Approver decision, technical assessment, and rules SHA. Any bound drift removes current approval immediately while preserving audit history. Rework records defect classes and the existing bounded Finding-to-earliest-Owner route but does not execute rework. A third same-class cycle requires method review before direct resubmission. A new Take revision never inherits a prior approval.

Before each write, the client stores and reads back a versioned non-secret recovery marker. The browser RPC receives only the exact command intent; local marker schema metadata is stripped. An uncertain write is resolved only with the original GET-only receipt lookup, never by repeating the POST. A confirmed receipt triggers a fresh Yimeng read before the UI presents current authority.

## Alternatives considered

**Use one generic Take status.** This collapses collaboration, review, technical evidence, formal authority, and episode verification into an ambiguous flag and makes invalidation impossible to audit correctly.

**Compute reviewer eligibility or current approval in the browser.** Browser roles and sessions are not identity authority, and client-computed approval would become a second truth. Yimeng authenticates people and persists records; Core derives legal method state from current sources.

**Automatically retry uncertain POST requests.** Idempotency helps duplicate control but does not turn an unknown outcome into a confirmed receipt. GET-only recovery preserves the distinction.

**Execute rework from the lifecycle action.** Approval routing must not start workers, call Providers, spend budget, mutate selection, or close Findings. It records only the bounded preparation state.

## Consequences

The cockpit can show exactly why a Take is ready, approved, invalidated, awaiting rework, or ready to resubmit without conflating nearby records. Rule, selection, decision, or QC drift fails closed. Natural-person separation survives role and session changes. Recovery is auditable and cannot duplicate the original transition. The lifecycle performs no Provider call, budget mutation, worker execution, episode verification, or human signoff, and it does not weaken the later Evidence Ledger boundary.
