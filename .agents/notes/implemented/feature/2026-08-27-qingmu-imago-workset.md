# Agent Note: Qingmu stateless workset recommendation

Status: implemented

English | [中文](2026-08-27-qingmu-imago-workset.zh.md)

## Problem

The cockpit needs one useful next-step recommendation without hiding legitimate parallel work. Yimeng's ordinary workflow completion flags do not establish IMAGO stage approval, and the current projection does not identify authoritative LSU instances. Treating those flags or method definitions as ready tasks would fabricate authority.

## Decision

The read adapter provides its existing configured handler as the optional `qingmuYimengRead` service. Each `/qingmu-imago-method/worksetMethod` request accepts only project and episode IDs and resolves that service afresh. Missing or unloaded service disables this read capability without disabling the other IMAGO methods or introducing a second upstream configuration.

The private interface-typed handler is explicitly assigned to the read adapter README in `SERVICE_WALK_EXEMPTIONS`; it is not an undocumented public subsystem service or a model-facing tool.

The Host hashes the complete normalized workflow separately from its source revision, supplies an explicit unavailable-authority snapshot, and runs `compile_qingmu_imago_workset_v2.py` over stdin. It independently verifies the exact input bytes, subject, seven local rule-file hashes, and non-executing output boundary. Credentials are excluded from compiler processes. A source fingerprint alone is insufficient because business status can change without changing that fingerprint.

The Core contract carries every legal item, its blockers and prerequisites, responsible role, advisory dependency-frontier group, deterministic sort key, and one recommendation. Its available-authority branch is exercised with fixtures; the current Host accepts only an unavailable projection with no task instances or recommendation. The 23 stage definitions are method templates, not project tasks. Shadow comparison uses only pure dependency-and-lock functions; it never calls a stateful controller or claims execution equivalence.

Overview separates business status from method advice, highlights at most one recommendation, and keeps legal items, templates, and hash evidence expandable. Request-local projection identity and cancellation invalidate stale advice on refresh, subject changes, closure, and source failure. This is a read-only capability, not a task launcher.

## Alternatives considered

**Derive approval or LSU scope from ordinary business flags.** Those fields do not carry stage artifact, source, lock, or authenticated review evidence. The adapter exposes missing authority instead of inventing it.

**Accept the browser's snapshot or reuse only its fingerprint.** Either would allow stale or caller-supplied state to drive advice. The Host rereads its existing configured authority and binds the entire normalized projection.

**Invoke the stateful controller as a shadow check.** Its ordinary entrypoints can reconcile project state. The compiler limits comparison to pure dependency-and-lock functions and explicitly denies formal activation.

## Consequences

The cockpit gains traceable method advice without another database, project DAG, or approval authority. The current integration truthfully shows unavailable advice until Yimeng exports the required authority. Core fixture success does not establish production readiness. No workset request writes business data, calls a paid Provider, starts a Worker, or signs off content.
