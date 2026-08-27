# Agent Note: Qingmu Shot River

Status: implemented

English | [中文](2026-08-27-qingmu-shot-river.zh.md)

## Problem

Shot River must carry Yimeng's shot order, rhythm, and current reference bindings through the cockpit and stateless IMAGO method. Reusing the richer request for Hero Frame canvas editing would also change an existing write-contract hash.

## Decision

Yimeng storyboard frame IDs remain the only Shot identities, and `frameNo` remains the order authority. The read adapter normalizes that order; the cockpit shares a transient selected Shot across relationship details, Hero Frame canvas, and PromptIR. It stores no new ordering or selection authority.

The E5-3 method receives duration, original dialogue timing, and current reference availability plus minimal asset lineage. Its only operations are `inspectCanonicalShotRelations` and `inspectShotRiverRhythmAndReferences`. The Host checks the complete projection before issuing the method proof; the browser rejects stale relation fields or inconsistent repeated-element bindings.

E5-3 relation, projection, and selected-Shot hashes use the `qingmu.e5-3-seconds-binary64-hash-projection.v1` schema/subject wrapper. Only the fixed seconds fields become big-endian binary64 hex for hashing. Numeric inputs and outputs remain unchanged, null remains null, and negative zero matches zero. The input-snapshot hash still binds the exact stdin bytes. This isolates Python/JavaScript exponent formatting from the proof without changing the general canonical serializer.

Hero/E5-2 receives an explicitly narrowed ID graph and retains its existing hashes, proposal, preview, and confirmed commit path. Lost-response recovery retains the original revision and Shot coordinates for GET-only receipt retrieval, even after the authority advances to a new revision.

## Alternatives considered

**Persist a second Shot list or sort by ID.** Either would compete with Yimeng's existing identity and frame order. The view derives both from the authority instead.

**Round seconds or alter every canonical hash.** Rounding changes legitimate timing, while a global serializer change would affect unrelated proofs. The tagged seconds-only hash projection is confined to E5-3.

**Pass the rich request into Hero unchanged.** Rhythm and reference fields are read-only inputs, not an expansion of the E5-2 write contract. Explicit narrowing preserves that boundary.

## Consequences

The same selected canonical Shot can be inspected and edited without introducing another database, DAG, or state machine. Missing reference bindings remain visible as missing; they are not fabricated or approved. This slice grants no Provider, Worker, selection execution, creative approval, signoff, or release authority and does not complete the remaining Epic 5 work.
