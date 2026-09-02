# Agent Note: Keep creative skills as an inert versioned catalog

Status: implemented

English | [中文](2026-09-02-qingmu-creative-skill-catalog.zh.md)

## Problem

Qingmu OS had admitted director-method assets and a Yimeng style-pack library, but no single product-facing contract that creation settings could consume as readable skills. Exposing repository names or files directly would leak source organization into the product, while copying or activating those sources would create a second workflow, license ambiguity, and authority escalation.

## Decision

The experimental `qingmu-creative-skill-catalog` package builds `qingmu.creative-skill-catalog.v1` as pure data. Each card is Chinese, versioned, scope-aware, default-off, and bound to method, content, source, provenance, and license hashes. The six base categories reuse exact admitted IMAGO content through the existing registry and package verifier. Repository identity remains trace-only provenance.

Yimeng style packs enter only as an optional exact-byte projection from the existing authenticated read boundary. Callers provide bytes only; the package ledger fixes source identity, schema, source revision, canonical snapshot SHA, source-content SHA, internal license reference, and read-only usage boundary. It emits a readable visual card but does not copy prompt fragments. Unknown source, license mismatch, duplicate ID, invalid scope, relationship errors, or SHA drift fails closed.

Catalog construction performs no registration, activation, write, Provider call, budget change, or approval. A future creation-settings consumer may display and filter the result, but explicit selection remains under that consumer's existing authority.

## Alternatives considered

**Expose admitted repository and skill filenames.** Rejected because source organization is not a stable product vocabulary and does not describe a reusable method to creators.

**Copy the Yimeng library or add another Harness reader.** Rejected because it would duplicate source authority and carry an unverified licensing and freshness boundary.

**Register every card as an executable skill.** Rejected because catalog visibility is not execution, Provider, approval, or workflow authority.

## Verification

Focused tests cover deterministic output, all six categories, caller-forged Yimeng bytes, unknown sources, disallowed licenses, duplicate IDs, invalid scopes, relationship errors, source-byte drift, trusted content bindings, and immutable output. A live read-only smoke covers the package-pinned Yimeng projection. Package type checking, lint, build, workspace contracts, and documentation synchronization remain the integration gates.

## Consequences

Creation settings now have one deterministic integration interface without a second creative workflow. New methods must first enter an existing admitted source and license authority, then change the catalog version and hashes explicitly. UI wiring and authenticated Yimeng byte acquisition remain separate later slices.
