# Qingmu IMAGO method adapter

English | [中文](README.zh.md)

This private experimental Host plugin compiles the current IMAGO OS actor, scene, or prop method into browser-safe guidance. `elementMethod` covers profile editing. `referenceAssetMethod` covers either `selectReferenceAsset` or `requestReferenceRegeneration` for one exact profile revision, profile SHA, candidate asset ID, and asset SHA. Both endpoints construct fixed Yimeng authority in the Host and invoke their reviewed Core compiler with Unicode-code-point-sorted, whitespace-free canonical JSON on stdin. The compiler's `input_snapshot_sha256` must match the SHA-256 of those exact canonical bytes.

## Attestation boundary

Both endpoints read `QINGMU_IMAGO_ATTESTATION_KEY` only from the Host process environment. The raw environment string is the HMAC key: it is not trimmed and must contain at least 32 UTF-8 bytes. A missing, empty, or shorter key fails closed before compilation. The key is absent from Cordis configuration, compiler child-process environment, browser responses, logs, and error text.

After validating the current Core projection, the Host returns the projection, its canonical SHA-256, and a method-specific proof. `qingmu.imago-element-method-attestation.v1` binds the profile subject. `qingmu.imago-reference-asset-method-attestation.v1` instead binds the exact reference-asset target through `targetSha256`; it does not reuse the element proof's `subjectSha256` semantics. The browser may forward either HMAC-SHA-256 proof but cannot issue or verify it without the server-only key.

The reference-asset projection is strictly read-only guidance. The Host requires exact target, source-binding, operation, legal-work, and authority fields, including `providerCalls: 0`, `workerStarted: false`, and `selection_executed: false`. Selecting or requesting regeneration remains a later Yimeng ChangeSet action; this adapter performs neither operation.

The Core root remains deployment-specific. A non-blank `config.coreRoot` takes precedence; otherwise `IMAGO_OS_CORE_ROOT` is required. No machine-specific Core path is included in this package.

## Model Experience

### Private method RPCs

#### What the model sees

Nothing. The `elementMethod` and `referenceAssetMethod` endpoints are private browser RPCs, not model tools, prompt sections, or session events.

#### Token effect

None. The RPC response remains outside model context.

#### KV Cache effect

None. No model-facing tokens are added.

## Known Limitations and Deferred Work

- The slice supports bounded actor, scene, and prop profile guidance plus reference-asset selection or regeneration guidance. PromptIR compilation, actual generation, selection execution, comments, and creative review decisions remain outside this adapter.
- Attestation proves Host validation and exact input binding. It does not grant paid Provider authority, asset selection, human approval, or production-state writes.
- Key rotation and multi-key verification are not part of this bounded slice.
