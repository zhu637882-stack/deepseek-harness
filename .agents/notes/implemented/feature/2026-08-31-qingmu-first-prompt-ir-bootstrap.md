# Agent Note: First PromptIR bootstrap from exact selected references

Status: implemented

English | [中文](2026-08-31-qingmu-first-prompt-ir-bootstrap.zh.md)

## Problem

The existing PromptIR editor required a current Ready version, so a new scene could not enter the canonical prompt workflow without a fixture or a fabricated base. Creating a Ready record directly would conflate a machine-generated draft with the project owner's version choice, while accepting every selected entity reference would overconstrain an establishing shot that only depicts its environment.

## Decision

The Qingmu cockpit now exposes a two-step first-PromptIR path for a real Ready storyboard frame with no PromptIR lineage. Yimeng builds one revision- and SHA-bound context from the current script, storyboard frame, exact selected and qualified references, element profiles, and materialized bytes. The required reference set follows the shot itself: the scene is required, while actors and props are required only when the frame's dialogue or action binding uses them.

IMAGO compiles that context with a versioned, attested, zero-execution method into five editable prompt fields and a stable ordered reference list. Yimeng verifies the method projection and writes one Draft, its structural reference packs, ChangeSet, outbox event, agent-run provenance, and command receipt atomically. A separate authenticated owner command may promote only that exact current Draft to Ready after rechecking context, method, content, and reference hashes. Selection additionally requires a short-lived Writer-signed challenge bound to that Draft and a Host freshness attestation over the newly compiled projection; an old method proof alone cannot select. Ready means only the currently selected prompt version; it does not infer rights verification, formal consistency, content approval, generation authority, release, or human signoff.

The browser keeps only bounded recovery coordinates and hashes. Unknown Draft or selection results recover the original idempotent receipt; they do not create a second prompt, reference pack, or selection transaction. Existing multi-frame PromptIR creation and existing Ready-based editing retain their previous contracts.

## Alternatives considered

**Insert an empty Ready PromptIR before editing.** This would fabricate a predecessor and make the first method-produced content appear already selected. The bootstrap writes Draft first and separates the owner selection.

**Treat every project reference as required.** That would bind off-screen people and props into an establishing shot. Required references are derived from the current frame while all bindings remain exact and fail closed.

**Persist the first prompt in Harness or browser storage.** That would create a second business authority and fail restart recovery. Yimeng remains the sole mutable ledger; Harness only validates, presents, and invokes its commands.

## Consequences

A new scene can enter the existing PromptIR editor through one real, recoverable Draft-to-Ready transition without Provider calls or fabricated approval. Script, frame, profile, selected-reference, materialized-byte, qualification, rights-record, method, or content drift blocks commit or selection. The stricter boundary costs an explicit owner action and leaves actor- or prop-bearing shots blocked until their exact required references exist. Generation, QC, release, and human content acceptance remain separate later operations.
