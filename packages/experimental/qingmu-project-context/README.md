# Qingmu project context

English | [中文](README.zh.md)

This private experimental Host plugin binds one live DSh session to an exact Yimeng project, episode, scene, and Shot. The binding stores only coordinates, revision identities, and SHA-256 values in the existing append-only session log. Folding the latest `qingmu/project-context` event restores the current object after a process restart; the package creates no database, project store, Stage ledger, cost ledger, or browser persistence.

The loopback-only `/qingmu-project-context` channel exposes `bind`, `current`, and `suggest`. `bind` reads the normalized Yimeng `workflow` projection and rejects a missing or mismatched Scene or Shot. Binding another Shot appends a whole replacement value. `suggest` rereads the same projection and compares the episode, storyboard, Scene, and Shot revision/SHA identities. Any difference appends a `stale` binding and returns `refresh_required` before the IMAGO method runs; only another explicit `bind` refreshes it.

For a fresh binding, `suggest` requests `directorReplayMethod` from the existing optional IMAGO method adapter and returns a deterministic `text_director_proposal` or `visual_finding` for that Shot. Text uses `qingmu.director-proposal.v1`; visual review uses `qingmu.visual-review-proposal.v1`, matching the selected replay method declaration. The proposal includes the current object, method and context SHA values, explicit differences, and impact scope. It is a proposed change set only: it does not autosave, approve, select, sign off, submit generation, call a model Provider, change budget, or write Yimeng business state. The session log retains only a compact proposal receipt with coordinates and hashes, not project prose or proposal content. Each receipt must match the preceding current binding, and the binding's context SHA is recomputed during restore. An unavailable method returns `method_unavailable` with `manualWorkBlocked: false`.

## Model Experience

None, as this private RPC plugin registers no prompt, schema, tool, result, or provider route.

#### KV Cache effect

None. The package adds no model-facing tokens and makes no provider request.

## Known Limitations and Deferred Work

- No shipped application bundle loads this package yet. A later composition may opt into the Host plugin and its invariant companion without changing launcher or existing runtime routes.
- The deterministic proposals identify bounded review focus; they are not creative acceptance, formal QC, a Yimeng ChangeSet, or an execution request.
- The adapter requires a live DSh session and a readable current Yimeng workflow. Missing source data returns no proposal and does not block manual work.
- Proposal receipts are replay evidence, not a second proposal repository. The caller owns any future user-edited draft and business commit flow.
