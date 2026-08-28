# Agent Note: Qingmu selected Take acceptance evidence

Status: implemented

English | [中文](2026-08-28-qingmu-take-acceptance-evidence.zh.md)

## Problem

A selected Take and a locally decodable file do not prove that the Provider submission is real, the creative checks are current, or formal production acceptance has occurred. Treating one of those facts as the others would create a second approval authority in Harness and could promote dry-run or stale evidence.

## Decision

Yimeng owns one read-only acceptance evidence object for the current selected Take. Harness accepts only project, episode, and frame coordinates, reads that object before and after compilation, validates its RFC 8785 digest, and forwards no path, URL, or raw Provider response. IMAGO compiles a stateless method from that exact evidence and seven fixed current rule files.

The method keeps three evidence layers separate: strict full-video decoding and frame-count-derived actual average rate, macro and micro QC from current Yimeng checks, and the Provider outbox receipt. Nominal frame rate is not actual rate. Dialogue audio QC is conditional on Yimeng's declared required check set. The inactive reference-overlay document supplies reviewed QC dimensions but remains inactive.

Harness reconstructs the definition, evaluation, source hashes, and rule digest independently. It reads evidence and rules again after compilation and fails closed on drift. A Host-only HMAC binds the validated projection. The response always states that paid production is unverified, Selected is not Approval, Gate B is incomplete, and formal acceptance is unavailable.

## Alternatives considered

**Infer acceptance from the selected asset or strict decode.** Those facts prove identity and local readability only; they do not prove a real Provider receipt, current creative QC, or human approval.

**Copy Provider and QC facts into a Harness database.** That would create a second business truth and a synchronization problem. Fresh Yimeng reads preserve the existing authority boundary.

**Activate the reference-overlay policy to use its QC dimensions.** The current policy is explicitly inactive. The method verifies its reviewed dimensions without changing activation or routing state.

**Expose a Gate B or approval command with the evidence view.** This slice has no authenticated human decision or Provider-specific completion contract. The method remains read-only and non-approving.

## Consequences

The same comparison surface shows whether local decode, macro QC, micro QC, and Provider evidence are independently satisfied without overstating production readiness. The browser recomputes evidence, rule-binding, and projection hashes and checks the selected Take lineage plus Host attestation coordinates; drift closes only the acceptance region, so comparison remains available. Evidence and rule drift, forged compiler fields, missing capabilities, cancellation, and missing signing keys fail closed. The extra reads and subprocess add bounded local latency. Formal Gate B, human signoff, paid dispatch, writes, and reference-overlay activation remain outside this method.
