# Agent Note: Batch notes recovery

Status: implemented

English | [中文](2026-09-15-batch-notes-recovery.zh.md)

## Problem

Reload restored a native batch candidate but discarded the operator's supplementary instructions. Subsequent revision or preparation therefore used a different input.

## Decision

Persist the existing input in local browser storage by project and episode, and restore it on remount. A storage failure leaves the current input usable and reports that it has not been saved. No generation or adoption is triggered by restoration.

## Alternatives considered

**Ask the operator to retype.** This undermines task recovery and loses creative constraints.

**Create a new backend instruction resource.** The existing browser draft convention suffices for this local editing field.

## Consequences

Seven batch component tests pass, including remount recovery and episode isolation. Browser-local recovery does not promise cross-device synchronization.
