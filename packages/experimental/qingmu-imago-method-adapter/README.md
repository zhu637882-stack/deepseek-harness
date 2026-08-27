# Qingmu IMAGO method adapter

English | [中文](README.zh.md)

This private experimental Host plugin compiles current IMAGO OS methods into browser-safe guidance. `elementMethod` covers profile editing, `referenceAssetMethod` covers bounded reference actions and rights guidance, `promptIrMethod` covers provider-neutral PromptIR candidates, `shotRelationMethod` covers the canonical Scene/Shot/Shot-local-Beat/Element graph plus Shot River rhythm and reference bindings, and `heroFrameStoryboardMethod` deterministically compiles one selected Hero Frame and its Shot-local canvas annotations. `worksetMethod` reads a fresh episode workflow and returns current IMAGO stage definitions with explicit authority availability. These input-snapshot methods build their own bounded input in the Host and invoke their reviewed Core compiler with Unicode-code-point-sorted, whitespace-free JSON on stdin. Their compiler's `input_snapshot_sha256` must match the SHA-256 of those exact input bytes.

`shotFindingMethod` and `productionUnitMethod` use their subject hash contracts described below; the older methods' `input_snapshot_sha256` field is not part of these schemas.

## Attestation boundary

Except for the read-only `worksetMethod` and `continuityMethod`, endpoints read `QINGMU_IMAGO_ATTESTATION_KEY` only from the Host process environment. The raw environment string is the HMAC key: it is not trimmed and must contain at least 32 UTF-8 bytes. A missing, empty, or shorter key fails closed before those methods compile. The key is absent from Cordis configuration, compiler child-process environment, browser responses, logs, and error text. The two read-only methods neither require this key nor issue an approval proof.

After validating a current Core projection for an attested method, the Host returns the projection, its SHA-256, and a method-specific proof. The Shot relation proof binds the exact compiler input, target, Host-derived `relationSnapshotSha256`, and selected canonical Shot, using the E5-3 hash projection described below. The Hero Frame Storyboard proof additionally binds the selected Shot SHA, the full Hero Frame lineage binding, the raw-annotation SHA, and the compiled-result SHA. The selected Shot remains the Yimeng storyboard frame ID, and Beat IDs remain local to their parent Shot. The browser may forward a proof but cannot issue or verify it without the server-only key.

The Host derives the relation authority and selected Shot SHAs from the validated Yimeng relation input. For `heroFrameStoryboardMethod`, it also derives the Hero Frame binding and raw-annotation SHAs; the browser cannot supply those authority hashes or a second Shot identity. The Host requires exact target, graph, canvas, deterministic compiled result, source-binding, work-order, legal-work, and authority fields. The method may describe `replaceStoryboardCanvas` through a Yimeng ChangeSet, but this adapter never performs that write and rejects generation, selection, approval, signoff, Provider, or worker receipts. It creates no relation identity, canvas repository, database record, project state, or second state machine.

The Core root remains deployment-specific. A non-blank `config.coreRoot` takes precedence; otherwise `IMAGO_OS_CORE_ROOT` is required. No machine-specific Core path is included in this package.

## Shot River rhythm and reference contract

The E5-3 `shotRelationMethod` request adds authoritative `frameNo`, numeric `durationSec`, original dialogue cues and timing, and each element's current reference availability, asset SHA, and minimal lineage. The Host validates these fields without rounding seconds, trimming dialogue, inventing references, or adding Shot order state. Its work order permits only `inspectCanonicalShotRelations` and `inspectShotRiverRhythmAndReferences`; both are read-only.

Only E5-3 relation, projection, and selected-Shot digests use `qingmu.e5-3-seconds-binary64-hash-projection.v1`: a `schema`/`subject` wrapper replaces the fixed `durationSec`, `plannedStartSec`, and `plannedEndSec` paths with `binary64:<16 big-endian hex digits>` for hashing. `null` remains `null`; negative zero hashes as zero. Actual request and response seconds remain numbers. The input-snapshot SHA still binds the exact numeric stdin bytes, avoiding Python/JavaScript exponent-format differences without changing the general canonical serializer. Hero/E5-2 retains its narrower ID graph and existing hash semantics.

## Read-only IMAGO workset

`worksetMethod` accepts exactly `projectId` and `episodeId`; it accepts no browser-supplied workflow, approval, rules, or command. On every call it resolves the optional `qingmuYimengRead` capability and reuses the configured read adapter's existing `workflow` GET, with its token, timeout, cancellation, scope validation, and response limit. Unloading that read plugin disables the workset and continuity reads; loading it again restores those capabilities without re-registering the other methods.

The Host hashes the complete normalized workflow and complete `sourceRevision`, preserving finite fractional JSON numbers. The legacy `inputFingerprint` is retained as lineage, not used as a sole cache key. The v2 input always reports `authority_snapshot.status: unavailable` with reason `authoritative_stage_evidence_unavailable`: legacy `complete`, selected references, quality checks, and unknown forwarded approval fields do not establish named IMAGO Stage or LSU authority. The response contains the current 23 stage-definition templates, but no synthetic stage instances, legal tasks, recommendation, or completion claim. `availability` and `shadow_comparison` explain why these are unavailable.

The fixed `scripts/compile_qingmu_imago_workset_v2.py` compiler returns `qingmu.imago-workset.v2` inside `qingmu.imago-workset-method-adapter-result.v1`. The Host independently hashes seven local rule files, checks the exact `rule_bindings` map and its `rules_sha256`, and binds the exact input bytes, episode subject, source projection, and non-execution flags. Those files are `pipeline/imago-os-current.json`, `pipeline/workflow-channel-registry.json`, `pipeline/v6-stage-contracts.json`, `pipeline/workflow-spec.v6.production-beta.json`, `scripts/compile_qingmu_imago_workset.py`, `scripts/compile_qingmu_imago_workset_v2.py`, and `scripts/imago_v6_draft_ctl.py`. Core remains the owner of definitions, dependencies, and ordering; Harness stores no second DAG or project state.

Compiler processes receive no environment variable whose name contains `key`, `token`, `secret`, or `password`, case-insensitively. The shared runner bounds stdout and stderr at 5 MiB each and rejects timeouts, malformed output, and unsuccessful exits without returning stderr. Workset cancellation waits for the killed child to close before returning. The workset provides no execution, paid dispatch, or human-signoff endpoint.

## Read-only Shot continuity

`continuityMethod` accepts exactly `projectId`, `episodeId`, and the canonical `selectedShotId`. It freshly reads the same configured workflow, binds the full source and revision, and runs `scripts/compile_qingmu_continuity_method.py` with exact stdin-byte hashing. The Host independently rehashes 14 fixed Core files after compilation: current machine rules, C5 and LSUQC methods and references, and both compiler sources. Lock definitions and rework propagation must match the actual workflow rule bytes.

The response separates current materialized asset binding from the original audit declaration. An old check may legitimately pass for a different tail asset; it cannot establish current selected-chain readiness. Missing dimensions remain unknown, not failures. Only explicitly false dimensions become candidate Findings, with severity, earliest owner, and timecode left null. Candidates do not create formal Findings, tasks, or review decisions. Six lock definitions do not imply project lock instances: `lock_authority` remains unavailable. Both unavailable and legacy-omitted continuity sources remain visibly unavailable. Cancellation waits for the compiler child to close; this endpoint performs no writes or Provider calls.

## Bound Shot Finding method

`shotFindingMethod` accepts exactly the three Yimeng IDs: `projectId`, `episodeId`, and canonical `frameId`. It reads a fresh `shotFindings` feed through the optional configured read capability; no browser subject, Owner, or severity enters Core. It runs `scripts/compile_qingmu_shot_finding_method.py` and independently rehashes 18 fixed current sources. Current workflow, stage contracts, role definitions, literal QC Owner rules, provider-neutral review policy, and the implementation plan must agree. Only active workflow Owners are offered; compatibility-only Owners are excluded.

The projection binds the canonical current subject SHA, all eight required fields, three severities, active Owner options, rule hashes, and the fixed `OPEN`/no-approval/no-rework boundary. This schema uses `subjectSnapshotSha256` rather than the older `input_snapshot_sha256`. The Host signs only those validated method coordinates with the existing server-only HMAC key. The method does not record a Finding or infer attribution, approval, task creation, asset selection, or paid generation. Missing media, unplugged reads, unavailable rules, changed source bytes, or a missing signing key disable this method without disabling unrelated methods.

## Production-unit binding method

`productionUnitMethod` accepts exactly `projectId`, `episodeId`, and `groupId`. It resolves the optional configured reader's `productionUnits` GET before and after compilation and compares only the requested available group's source. Unavailable unrelated groups, historical bindings, and `canBindUnit: false` do not supply or invalidate that source. Browser-supplied snapshots, rules, and unit IDs are rejected. The backend transaction remains the final authority for membership and binding CAS.

The fixed `scripts/compile_qingmu_production_unit_method.py` receives only `schema`, `subject`, and `snapshotSha256`, bounded to 1 MiB. The Host preserves original IDs and titles, validates safe integers and ordered unique member Shots, and rechecks the source SHA. It independently verifies the active pointer and registry, stage contract hashes, and the current six per-unit methods against the workflow loop. Its nine fixed raw rule hashes cover the seven workset sources plus `scripts/compile_qingmu_element_method.py` and this compiler; all must remain unchanged across compilation.

The response is `qingmu.imago-production-unit-method-adapter-result.v1` with `projection`, `projectionSha256`, and `methodAttestation`, signed with the existing Host-only key. It allocates no unit ID, records no binding, seals no plan, approves no stage, and calls no Provider. Missing or changed source/rules, invalid compiler output, an unplugged reader, or an unavailable key fail closed. Cancellation waits for the killed child to close. Tests may inject `readProductionUnits` and `runProductionUnitCompiler` through `createImagoMethodHandler`; no new configuration or model-visible surface is added.

## Model Experience

### Private method RPCs

#### What the model sees

Nothing. Endpoints such as `shotRelationMethod` and `worksetMethod` are private browser RPCs, not model tools, prompt sections, or session events.

#### Token effect

None. The RPC response remains outside model context.

#### KV Cache effect

None. No model-facing tokens are added.

## Known Limitations and Deferred Work

- Shot relations accept only the bounded ID graph, rhythm, and reference bindings; Hero Frame Storyboard accepts its existing graph, lineage, and normalized integer annotations. Title editing, actual generation, selection execution, ChangeSet commit, comments, and creative review decisions remain outside this adapter.
- Attestation proves Host validation and exact input binding. It does not grant paid Provider authority, asset selection, human approval, or production-state writes.
- Key rotation and multi-key verification are not part of this bounded slice.
- Workset templates are not approved business stages. Named Stage/LSU authority must be supplied by a future explicit business contract before actual legal-work recommendations or shadow comparisons can be shown; no legacy status fallback is used.
