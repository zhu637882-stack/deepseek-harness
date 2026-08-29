# Agent Note: Controlled director replay suggestions

Status: implemented

English | [中文](2026-08-29-qingmu-controlled-director-replay.zh.md)

## Problem

The saved scene-planning workspace needs a real proposal seam before any paid DeepSeek canary. A model-shaped response must not become a second workflow, business store, quality decision, reference selection, or automatic edit.

## Decision

The Host loads a SHA-bound method package from the existing Qingmu three-party integration plan. IMAGO declares only proposal capabilities, output schemas, and limits. Yimeng alone returns an authenticated, read-only context snapshot and a content-addressed replay work order for one exact project, episode, scene, and shot. Harness/DSh then produces a deterministic local fixture with input/output SHA, zero calls, zero cost, and advisory-only authority; replay carries no Provider or model route.

The director workspace requests a proposal only after an explicit click and labels it as a non-model replay suggestion while showing original value, proposed value, and impact. Adopting an item changes only the existing local scene-planning draft. Before the established preview and human-confirmed save, the Host performs a zero-cost freshness check over the original context, method, work-order, prompt, proposal, and output SHA. It never executes inference a second time. A user can retain the words as an ordinary manual draft if the replay seam is unavailable.

A separate, versioned paid-capable contract is Yimeng-owned and disabled by default. It can only issue a Provider/model/pricing-bound work order through Yimeng's existing generation task, ProviderGate, reservation, durable submission outbox, acknowledgement/unknown, and reconciliation chain. The Host executes only a signed permit with one attempt and zero adapter retries; ambiguous results stop as `submission_unknown`.

## Alternatives considered

**A second director database or workflow.** This would compete with Yimeng's canonical objects, transaction journal, ProviderGate, fees, and human decisions. The replay seam therefore persists no proposal state and writes only through the existing planning command.

**A direct model-to-save action.** A proposal never commits itself. The existing preview, explicit confirmation, CAS, ChangeSet, outbox, and receipt recovery remain the only write path.

**Calling DeepSeek during this slice.** No production route, model registration, credential, network Provider, or budget is bound. Fake transport proves the inactive contract and receipt shape, not model quality.

## Consequences

The slice maps to H2's bounded UI vertical and the replay precondition for H3. Real DeepSeek text/vision pricing and budget binding, legal reference qualification, PromptIR readiness, Alibaba execution, visual comparison, and human content acceptance remain separate work.
