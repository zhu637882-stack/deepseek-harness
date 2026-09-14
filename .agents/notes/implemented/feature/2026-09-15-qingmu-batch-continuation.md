# Agent Note: Qingmu batch continuation and review

Status: implemented

English | [中文](2026-09-15-qingmu-batch-continuation.zh.md)

## Problem

Batch preparation skipped drafts whose director sources had changed. Any successful run prevented an explicit creative retake. Leaving the page lost unsubmitted items. Reviews and adding candidate footage to a working cut required repeated shot-level actions.

## Decision

Reuse the existing draft, upload, quote, queue and advisory-review services. Compare saved source hashes when choosing preparation scope and re-read before preparation. Source-aligned drafts survive partial retries. Explicit retake checkboxes scope new candidates without replacing old ones. Freeze every authorized queue command at the batch click in the existing tab storage, and replay uncertain commands before checking old runs. Keep the batch component mounted across application steps; a reload exposes one resume action.

Consolidate candidate review through the same validated GET/POST helper used by the single-shot panel. Read before submitting, reuse current reports, and report missing evidence as uncertain. One working-cut action fills missing shots in story order, preserving existing choices and trims. Unchosen footage is explicitly a preview candidate, never a selected Take.

## Validation and limits

Focused component and flow tests cover changed sources, partial preparation, lost submission responses, remount recovery, retained candidates, existing reports, mismatched review evidence and preview filling. Existing cockpit navigation and single-shot review tests remain applicable. Browser verification checks the real deployed controls without resubmitting old media. Client command recovery is scoped to the original tab; durable provider jobs and review records remain server-owned. No new provider route, batch database or automatic creative approval is introduced. New-project media validation is still required for visual continuity and voice quality.
