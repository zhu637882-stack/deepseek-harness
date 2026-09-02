# Agent Note: PromptIR entity-draft natural-person review

Status: implemented

English | [中文](2026-09-02-qingmu-prompt-ir-entity-draft-human-review.zh.md)

## Problem

A Ready PromptIR can depend on entity drafts whose facts and reference bindings still require a creator's content judgment. Treating structural PromptIR selection, machine checks, a bearer-authenticated command, or a generation-task association as that judgment would let automation confer human authority. A browser-side status would also be lost across Writer restart and could drift from the exact PromptIR, profile, and reference-pack sources it purported to accept.

## Decision

Yimeng is the sole authority for each PromptIR-associated entity-draft decision. Its read model binds a current Ready PromptIR and storyboard frame to the draft content SHA, current element-profile revision and snapshot SHA, current selected-reference identity, and reference-pack SHA. Only one owner-bound natural-person identity may proceed. Acceptance or rejection requires a recent same-origin cookie session, an explicit confirmation, and a short-lived intent proof tied to the exact request, source binding, user, natural person, and browser session. The Writer rechecks the complete binding inside the atomic update; drift, expiry, session change, concurrent decisions, and proof replay fail closed.

The Host exposes dedicated same-origin browser routes that forward only the `jason_token` cookie. It rejects bearer headers and caller-supplied actor, reviewer, natural-person, or session identity. An unknown write result uses the immutable idempotency key and request SHA for GET-only receipt recovery. The cockpit displays the exact bound PromptIR, draft, profile, selected reference, and pack hashes before the human can decide.

The decision updates only the associated `entity_drafts` record and embeds immutable review evidence. It emits no outbox event, mutates no generation task, starts no worker, and calls no Provider. A generation task may be associated with the Ready PromptIR only through the canonical `generation_job_prompt_irs` relation; that association is not execution or review authority. Existing public entity-draft review rejects PromptIR-associated drafts so it cannot bypass this route.

## Alternatives considered

**Use the existing bearer-authenticated entity-draft review endpoint.** Bearer credentials can be held by automation and do not prove a recent natural-person browser action. PromptIR-associated drafts require the cookie-only intent path, while unrelated legacy drafts retain their existing behavior.

**Store the decision in Harness or browser state.** That would create a second business authority and would not survive a Writer restart as canonical evidence. Harness presents and transports the intent; Yimeng persists and recovers it.

**Infer acceptance from Ready PromptIR selection or generation-task creation.** Those records express prompt-version choice and work scheduling, not review of entity facts and references. They remain independent and cannot synthesize the human decision.

## Consequences

An accepted current entity draft can satisfy the existing first-frame reference blocker without creating or executing generation work. The stricter path costs a fresh login when the cookie is absent or older than fifteen minutes, one explicit confirmation per decision, and failure on any source drift. Rejection is durable evidence but grants no downstream authority. This capability does not approve prompts, media, episodes, releases, Provider spend, or deployment.
