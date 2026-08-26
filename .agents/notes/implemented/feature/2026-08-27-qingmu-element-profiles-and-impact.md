# Agent Note: Qingmu element profiles and exact impact

Status: implemented

English | [中文](2026-08-27-qingmu-element-profiles-and-impact.zh.md)

## Problem

The first Qingmu asset slice could edit only props. Treating actor and scene support as client-side aliases would leave Yimeng without authoritative revisions for those subjects, let unknown impact fields cross package boundaries, and create a second interpretation of which references and derived work became stale.

## Decision

Yimeng owns one `element_profile` ChangeSet contract for the existing actor, scene, and prop records. Product “environment” maps to the existing Yimeng `scene`; no new element identifier, database, or state machine is introduced. Actor changes bind `actorId`, `visualIdentity`, and `replaceVisualIdentity`. Scene and prop changes bind `sceneId` or `propId`, `visualPrompt`, and `replaceVisualPrompt`. Each subject has a Yimeng-owned `profile_revision`, canonical snapshot hash, immutable proposal, server preview, double optimistic comparison against revision and snapshot, idempotent commit receipt, audit journal, and outbox event.

The impact result is one closed seven-array record: affected reference assets, invalidated approved assets, affected derived assets, affected reference packs, affected PromptIR records, affected storyboard frames, and explicit unknowns. Yimeng computes and canonically hashes that record when proposing, recomputes it inside commit, and rejects any mismatch before mutation. A successful changed commit updates the authoritative profile and revision, clears stale selected references, and invalidates discovered dependencies in the same transaction. Harness adapters reject missing or additional impact fields and revalidate the canonical impact hash, so neither browser nor Host invents a broader or narrower impact interpretation.

The stateless IMAGO adapter compiles the current B2aC actor method or B2aS scene/prop method for the exact Yimeng snapshot. All three kinds reuse the server-only HMAC proof defined by the [prop method attestation decision](2026-08-26-qingmu-prop-method-attestation.md); the projection is guidance and preflight evidence, not mutation, selection, generation, paid-provider, or human-approval authority. The Qingmu workbench renders actor, environment, and prop as one product surface with type-specific fields, base/current/proposed comparison, the seven impact groups, an explicit human commit confirmation, and subject-scoped read-only receipt recovery. It does not expose a Skill-package chooser, internal stage identifier, or second workflow graph.

The command and recovery mechanics remain the bounded Host-to-Yimeng design established by the [script ChangeSet workbench](2026-08-26-qingmu-script-changeset-workbench.md). Harness executes the local plugin path, Yimeng remains the sole business and mutation authority, IMAGO supplies method projections, and only an authenticated Yimeng actor can create or commit the authoritative ChangeSet.

## Alternatives considered

**Create Qingmu-specific actor and environment tables.** That would duplicate Yimeng identifiers, revisions, selections, and invalidation state. Reusing the existing Yimeng records preserves one production truth.

**Send one generic JSON patch for every element.** A permissive patch would allow the element kind, operation, and authoritative field to drift. The discriminated request types and server validation make each legal mapping explicit and reject all others.

**Calculate impact in the browser.** The browser cannot observe every authoritative reference or commit-time race. Yimeng computes impact from its transaction snapshot, while Harness only validates and displays the exact result.

**Automatically regenerate or select assets after commit.** A profile edit does not grant cost, generation, selection, or content-signoff authority. The commit invalidates affected work and leaves those later decisions explicit.

## Verification

Focused Core compiler, Harness adapter, cockpit, and Yimeng transaction tests cover all three element mappings, strict method and HMAC lineage, exact seven-field impact validation, revision and snapshot conflicts, commit-time impact tampering, idempotent receipt recovery, authoritative reread, and dependency invalidation. An assembled Qingmu Profile journey uses the actual Core compiler and real Chromium to exercise the human-operated actor and environment flows while retaining the existing prop recovery path. These checks use isolated databases and local doubles only; they do not migrate the formal database, dispatch a Provider, deploy production, or record human creative approval.

## Consequences

Actor, environment, and prop definitions now share one auditable editing model without creating shadow business state. The closed impact record makes known invalidations reviewable and preserves an explicit unknown bucket instead of implying complete discovery. The price is a stricter cross-repository contract: adding another element kind or impact category requires coordinated Yimeng, Core, Host, UI, and test updates. PromptIR editing, rights exceptions, comments and review decisions, regeneration, selection, and Phase 3 completion remain separate work.
