# Qingmu OS production cockpit

English | [中文](README.zh.md)

This private experimental Client plugin adds the Qingmu OS production cockpit to the Harness sidebar. It reads Yimeng projections and provides tightly bounded human-operated ChangeSet flows for episode scripts and actor, scene, and prop profiles. It never submits a paid Provider request or records a creative review decision.

## Projection and ChangeSet workflow

The cockpit opens from the sidebar into five tabs: Overview, Script & Assets, Storyboard & Shots, Generation & QC, and Cost & Delivery. It reads `health`, `projects`, `episodes`, `script`, `workflow`, element profiles, and authoritative reference candidates over the loopback-only `/qingmu-yimeng` RPC channel.

The Script & Assets tab formats the authoritative structured script into a draft and exposes one unified actor, environment, and prop workbench. It renders type-specific authoritative fields, a base/current/proposed three-way version comparison, and the seven exact impact groups with their canonical impact hash. Preparing a change creates an immutable ChangeSet and then fetches its server-side preview; neither step mutates the authoritative script or element profile. Commit remains disabled until the preview is committable and the user explicitly confirms the exact diff. For every element kind, the browser accepts only the exact six-field, lowercase-hex IMAGO method attestation and forwards it unchanged with the projection and projection hash. It never reads the attestation key or signs a proof. Conflicts fail closed and require reloading the new authority.

The same workbench reads reference candidates from Yimeng before allowing an explicit candidate choice. Reference selection and repair regeneration each call the real stateless IMAGO reference-asset method, then create a Yimeng ChangeSet and use the existing generic preview and commit path. The Host verifies the reference attestation with `QINGMU_IMAGO_ATTESTATION_KEY` and strips the projection and attestation before calling Yimeng. A recorded selection is not human approval or signoff. Regeneration records intent only: `providerCalls=0`, `workerStarted=false`, no automatic generation, and no automatic selection. After either accepted commit, the client rereads both the authoritative element profile and reference candidates before clearing its marker.

Immediately before a commit `POST`, the browser synchronously stores and reads back a minimal, non-secret, subject-scoped recovery marker in `sessionStorage`. Every marker binds the exact operation; reference markers additionally bind the candidate asset ID and SHA-256. Unrecognized marker versions fail closed. If storage cannot prove the exact marker, no commit is sent. If the dialog, subject, or page goes away after Yimeng accepts the request, the restored workspace offers an explicit read-only receipt query; it never resubmits the commit. A recovered receipt must match the complete marker lineage. The fresh authoritative read must match the subject, revision, and the Host-verified authority hash declared by the receipt before that exact marker is conditionally cleared. Reference operations also require a matching authoritative candidate reread. Failures and mismatches retain the marker and keep new edits locked. The user may explicitly discard only the local marker after a warning; that action neither calls Yimeng nor undoes a server-side commit.

The workflow view accepts only the `jason.episode-workflow-projection.v1` contract produced by the Host adapter. Runtime identity, project and episode scope, source fingerprint, blockers, status facts, and lineage remain visible as a projection; none of those fields becomes a command.

## Explicit saved-script source registration

The existing script workspace can register its saved episode script as a source reference for the current IMAGO screenwriting method. It uses the saved revision and Host-verified complete script SHA, including edit metadata, never the uncommitted draft below. The seven-field source descriptor is distinct from the script content hash. The method is freshly compiled by the existing Host adapter; the browser cannot supply its own rules or sign a proof.

Registration requires current owner capability, matching saved script coordinates, and explicit confirmation. Before one POST, the client stores and reads back an exact ten-field recovery marker containing only coordinates, hashes, compare conditions, and a deterministic key. An uncertain response keeps the marker. Explicit GET-only recovery does not require the current script, method, or write capability; Yimeng still checks current read access and the original actor. A matching receipt conditionally clears only the original marker, then rereads Yimeng. The receipt alone never renders a current binding. Source changes and rule changes are displayed separately; a historical reference does not become current through recovery.

Source registration neither creates a screenplay package or Stage instance nor approves a script, activates a lock, seals a plan, starts rework, or authorizes a Provider call. There is no Stage or Skill selector, new page, ledger, or workflow engine.

## Read-only workset recommendation

Overview asks the Host for a workset using only project and episode IDs. The method adapter rereads the existing Yimeng workflow service, binds the complete normalized projection and revision to SHA-256, and runs the stateless Core compiler. The browser never supplies stage approvals or a compiler snapshot.

The view highlights at most one recommendation and keeps the complete legal workset expandable. Each item carries prerequisites, its responsible role, and an advisory dependency-frontier group. Method definitions, source hashes, rule-file hashes, and the limited dependency-and-lock shadow comparison are separate details. None of these read-only results starts a task or grants execution, payment, or approval authority.

The current Yimeng workflow does not export authoritative IMAGO stage evidence or LSU instances. The Host therefore returns an unavailable workset with zero task instances and no recommendation; the 23 method definitions are templates, not 23 ready tasks. Ordinary Yimeng business status remains separate and cannot substitute for approval. Refreshes, scope changes, closure, and source-read failures invalidate old advice even when the source fingerprint is unchanged.

## Shot River and shared Shot selection

The Storyboard & Shots tab renders Shot River in authoritative `frameNo` order, not lexicographic ID or input-array order. Each card shows duration, dialogue and timed-cue counts, and current reference bindings. Selecting a card uses the existing Yimeng storyboard frame ID across relation details, Hero Frame canvas, and PromptIR. Selection is transient React state; it adds no second Shot identity, ordering store, or business write.

The read-only IMAGO method receives the complete E5-3 rhythm and reference fields. The browser rejects a response whose target, relation snapshot fields, safety flags, or two fixed read operations no longer match the request. Repeated elements must have identical profile and current-reference lineage. Hero/E5-2 explicitly receives only its existing narrower graph, preserving the canvas method and ChangeSet hash contract.

Canvas editing continues through IMAGO structural checks, Yimeng proposal and preview, and explicit commit confirmation. If the response is lost, recovery uses the original storyboard revision and selected Shot coordinates for a GET-only receipt query; it neither selects another Shot nor repeats the commit. A newer authoritative revision does not rewrite those recovery coordinates.

## Read-only continuity panel

The same selected Shot drives incoming/outgoing continuity cards through the Host's three-ID `continuityMethod`. The panel distinguishes current selected assets, historical audit bindings, and missing evidence; it never labels missing records as failed checks. Explicitly failed dimensions are displayed as pending-attribution candidates, not formal Findings or automatic rework. Lock definitions and propagation rules are expandable, with project lock instances explicitly unavailable.

There is only a reload control in this panel. Source-object changes, refreshes, Shot changes, closure, and read errors hide old evidence immediately; cancellation plus response identity checks prevent late results from a previous Shot from becoming visible. The panel does not expose Skill or Stage selection, persist a second project state, sign off content, or create a Provider job.

## Selected video review on the same Shot

The shared Shot also drives a metadata-only view of Yimeng's current selected video review. Original accepted, rejected, pending, stale, and invalid states remain distinct. Defect types, notes, and exact available timecodes are retained without inventing severity, ownership, authenticated reviewer roles, or review timestamps. The existing record is not independent Qingmu or IMAGO signoff.

The view checks the response's three IDs, asset/SHA binding, read-only markers, and review revision against the visible episode's storyboard revision. Shot, projection, port, refresh, closure, and source changes invalidate old responses. The only action is reload; there are no media elements, external links, selection controls, or approval commands. A missing selected asset stays missing even when another candidate is accepted.

## Explicit production-unit scope registration

The same Shot workspace reads existing Yimeng shot groups and their current or historical unit bindings. The user must select an existing group, enter an explicit unit ID, and confirm the displayed scope. A group's existing unit ID cannot be reassigned. Available groups must match the visible storyboard revision and canonical Shot IDs and display numbers; the workflow projection does not expose frame-content hashes, so the client does not invent them. The method comes from the existing IMAGO adapter, and a binding uses the existing command adapter with source SHA and binding-revision/SHA compare-and-swap.

Before one binding POST, the browser stores and reads back an exact eleven-field, episode-scoped recovery marker containing only original coordinates, hashes, compare conditions, and a deterministic idempotency key. An uncertain response retains the marker and blocks new registration. Explicit recovery queries the original receipt even when the current group, Shot, or method is unavailable. Only a verified matching receipt permits conditional marker removal and a fresh Yimeng feed read; the receipt itself never creates a displayed binding row. Local discard cannot undo a transaction, and re-entering the same intent preserves its key.

Scope registration does not seal a plan, create a production instance, approve a stage, release a lock, execute rework, or call a Provider. The panel adds no second runtime, ledger, or workflow.

## Human-recorded issues on the same Shot

The shared Shot has a Finding panel with eight explicit fields: timecode, observation, evidence references, earliest responsible role, attribution reason, severity, suggestion, and suggested rework scope. IMAGO supplies the current field and role contract; the user supplies every value, with no default owner or severity. Only Yimeng's explicit reviewer capability permits recording. A Finding is an OPEN issue bound to the selected video's asset hash, frame content, and storyboard revision. It is not an approval, selection, or rework command.

The browser verifies the feed and method against the current Shot before enabling the form. The Host validates the method proof; Yimeng rechecks the current subject and records the Finding and receipt atomically in its existing transaction ledger. Refresh invalidates old requests; Shot or subject changes discard the in-memory draft. Historical records remain readable when current media or the method plugin is unavailable, without rebinding them to the current asset.

Each record's existing details retain the read-only rework-preparation evidence: the exact owner match and scope from the validated Finding method, the original-versus-current rule comparison, and the matching current or historical production-unit binding. Stage instances, unit instances in a sealed plan, approval-lock instances, and an independent formal decision remain explicitly unavailable from that read contract; this does not prove that they do not exist. A changed lock is not inferred from the owner.

Collapsed Finding rows make no route call. Explicitly opening the details mounts a Finding-scoped bounded route control; only a current OPEN Finding on the current selected video and unit may load or record a route. It reads a fresh IMAGO Method plus Yimeng source and a separate read-only authority probe, and requires the sealed plan, current rule chain, lock chain, permission, exact subject coordinates, and current route-head CAS to agree. Historical Findings remain read-only: they do not load current Method/source/probe or record a new route. If an old recovery marker exists, they may only query that original receipt and settle the marker.

One explicit action may issue exactly one route-record command POST with the original subject/head CAS and deterministic idempotency key; the Host recomputes and validates the Method. A route-record POST is distinct from the read-only authority-probe POST. An uncertain route-record result can only be recovered through a GET-only lookup using the original CAS and key, with no route-record repost and no fresh Method substituted into recovery. Once a matching receipt is confirmed, its marker is conditionally cleared before an independent fresh Method/source/probe read. The receipt itself is never displayed as current authority; if that fresh chain is unavailable, the UI reports confirmed receipt but unverifiable current authority.

This control records only the bounded route. It does not execute rework, close the Finding, create a task, change selection, stage, or lock state, call a Provider, or infer human signoff.

Separately, before the single Finding-record POST, the client stores and reads back an exact eight-field, non-secret recovery marker. It contains hashes and original operation coordinates, not free-text evidence, credentials, or the method signature. An uncertain response offers an explicit GET-only lookup of that original receipt, including after a page reload or when current media becomes unavailable. A missing or mismatched receipt retains the marker; recovery never resubmits the record or rewrites its subject. Clearing the local marker is a separate warned action and cannot undo a server record. Recording a Finding does not execute rework or infer human signoff.

## Security boundary

`YIMENG_API_TOKEN` and `QINGMU_IMAGO_ATTESTATION_KEY` belong only to Qingmu Host processes. The browser plugin does not read environment variables, `localStorage`, `JWT_SECRET`, or cookies, and it never receives or renders either secret. Its only persistence is the bounded non-secret receipt-recovery marker in the current tab's `sessionStorage`. Read and command channels are separate Host plugins, both limited to loopback upstreams. If the token is absent, the cockpit shows a recovery instruction to configure the Host and restart the local instance.

## Three independent authorities

- Harness execution authority permits only the local runtime or engineering action explicitly granted to it.
- A valid budget, remaining balance, `releaseReady`, or `qualityPassed` status does not authorize a paid Provider call.
- Human acceptance belongs to a verifiable authenticated human review; the cockpit does not approve assets, prompts, first frames, generated media, or final delivery.

## Model Experience

### Browser projection

#### What the model sees

Nothing. The `jason.episode-workflow-projection.v1` projection remains in the browser UI; this Client plugin registers no prompt, tool schema, tool result, or other model-visible context.

#### Token effect

Zero direct token effect because the projection remains in the browser UI.

#### KV Cache effect

Independent. Opening, refreshing, or closing the cockpit does not change a model request or its reusable prefix.

## Known Limitations and Deferred Work

- The bounded workbenches and Shot River do not declare all of Phase 3 or Epic 5 complete. Paid generation, automatic selection or approval, agent signoff, and production release remain outside these local flows.
- Workset compilation does not create missing Yimeng stage or LSU authority. The Core's available-authority branch has fixture coverage; the current Host integration deliberately exposes only the unavailable branch.
- Receipt recovery lasts only for the current tab's `sessionStorage` lifetime. Explicitly discarding the local marker cannot prove or reverse the server-side outcome.
- For scripts, the browser does not reproduce Python canonical JSON. The Host verifies Yimeng's exact canonical bytes and exposes only `scriptSha256`; a missing or mismatched verified hash keeps the script-edit recovery marker locked. Finding, production-unit, and source-reference contracts separately permit only well-formed strings and safe integer numbers and use explicit Unicode-key canonicalization for their bounded JSON hashes; this algorithm does not extend to arbitrary script JSON.
- Anonymous health proves liveness only; it does not prove production readiness or release identity unless the returned fields explicitly do so.
- `releaseReady` is neither `verify_episode` success nor final human signoff.
- The plugin requires the Qingmu build composition plus the private Host read and command adapters on the same local Harness runtime.
