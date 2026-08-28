# Agent Note: Qingmu static director asset admission

Status: implemented

English | [中文](2026-08-29-qingmu-static-director-assets.zh.md)

## Problem

Director templates and isolated modules need reusable source identities without importing another project's business state, execution policy, or approval authority.

## Decision

The [method adapter](../../../../packages/experimental/qingmu-imago-method-adapter/README.md) owns one static registry and stage-to-file candidate map. Eight selected repository snapshots retain their license, admission limitations, modification records, and file digests. The registry pins each complete provenance ledger; package verification rejects extra files, symbolic links, ledger drift, and content drift. Reading one file first verifies the complete package.

The merge retains source commits `cdc619af16`, `c7a3d578de`, and `c787bef97f` and the mainline E7-3/E7-4 history. Imported asset bytes are unchanged from that source branch. The generated [inventory](../../../../packages/experimental/qingmu-imago-method-adapter/DIRECTOR_ASSET_SBOM.json) and [notices](../../../../THIRD_PARTY_NOTICES.md) disclose the admitted scope; ArcReel's application is excluded and its selected skills retain their separate MIT license.

## Alternatives considered

**Reimplement the asset collection:** rejected because the source branch already supplies a pinned, testable collection and records its limitations.

**Activate the upstream workflows:** rejected because static admission provides neither isolation nor authority to execute tools, call Providers, mutate business state, or approve media.

## Consequences

The asset tests exercise admission, complete-ledger validation, content drift, stage mapping, and inert file loading. The inventory and notices have freshness tests. Asset text is not inserted into model context or the running UI, so this change introduces no model-visible transcript or browser behavior.

Execution remains inactive. The local asset root must be stable during a read; these checks do not resist concurrent filesystem replacement or replace a process sandbox. BlueFish's placeholder behavior, runtime isolation, work-order activation, Storyboard adapters, and creative-quality evaluation remain separate work. Current Take review, QC, lifecycle, and human-signoff authorities are unchanged.
