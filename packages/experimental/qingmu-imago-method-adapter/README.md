# Qingmu IMAGO method adapter

English | [中文](README.zh.md)

This private experimental Host plugin compiles current IMAGO OS methods into browser-safe guidance. `elementMethod` covers profile editing, `referenceAssetMethod` covers bounded reference actions and rights guidance, `promptIrMethod` covers provider-neutral PromptIR candidates, `shotRelationMethod` covers one canonical Scene/Shot/Shot-local-Beat/Element ID graph, and `heroFrameStoryboardMethod` deterministically compiles one selected Hero Frame and its Shot-local canvas annotations. Every endpoint constructs fixed Yimeng authority in the Host and invokes its reviewed Core compiler with Unicode-code-point-sorted, whitespace-free canonical JSON on stdin. The compiler's `input_snapshot_sha256` must match the SHA-256 of those exact canonical bytes.

## Attestation boundary

All endpoints read `QINGMU_IMAGO_ATTESTATION_KEY` only from the Host process environment. The raw environment string is the HMAC key: it is not trimmed and must contain at least 32 UTF-8 bytes. A missing, empty, or shorter key fails closed before compilation. The key is absent from Cordis configuration, compiler child-process environment, browser responses, logs, and error text.

After validating the current Core projection, the Host returns the projection, its canonical SHA-256, and a method-specific proof. The Shot relation proof binds the exact compiler input, target, Host-derived `relationSnapshotSha256`, and selected canonical Shot. The Hero Frame Storyboard proof additionally binds the selected Shot SHA, the full Hero Frame lineage binding, the raw-annotation SHA, and the compiled-result SHA. The selected Shot remains the Yimeng storyboard frame ID, and Beat IDs remain local to their parent Shot. The browser may forward a proof but cannot issue or verify it without the server-only key.

The Host derives the relation authority and selected Shot SHAs from the exact Yimeng ID graph. For `heroFrameStoryboardMethod`, it also derives the Hero Frame binding and raw-annotation SHAs; the browser cannot supply those authority hashes or a second Shot identity. The Host requires exact target, graph, canvas, deterministic compiled result, source-binding, work-order, legal-work, and authority fields. The method may describe `replaceStoryboardCanvas` through a Yimeng ChangeSet, but this adapter never performs that write and rejects generation, selection, approval, signoff, Provider, or worker receipts. It creates no relation identity, canvas repository, database record, project state, or second state machine.

The Core root remains deployment-specific. A non-blank `config.coreRoot` takes precedence; otherwise `IMAGO_OS_CORE_ROOT` is required. No machine-specific Core path is included in this package.

## Model Experience

### Private method RPCs

#### What the model sees

Nothing. These endpoints are private browser RPCs, not model tools, prompt sections, or session events.

#### Token effect

None. The RPC response remains outside model context.

#### KV Cache effect

None. No model-facing tokens are added.

## Known Limitations and Deferred Work

- The Shot relation and Hero Frame Storyboard slices accept only compiler-ready IDs, lineage, and normalized integer annotations. Display metadata, Shot River rhythm, actual generation, selection execution, ChangeSet commit, comments, and creative review decisions remain outside this adapter.
- Attestation proves Host validation and exact input binding. It does not grant paid Provider authority, asset selection, human approval, or production-state writes.
- Key rotation and multi-key verification are not part of this bounded slice.
