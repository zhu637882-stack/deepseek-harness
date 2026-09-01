# Qingmu director context bridge

English | [中文](README.zh.md)

This private experimental package binds one DSh session to one exact Yimeng `project / episode / scene / shot` and its normalized `contextSnapshotSha256`. The binding is a log-only, whole-value session event, so a restarted session rebuilds the same identity without a second database or ledger.

## Mount interface

`createDirectorContextBridge(readPort)` exposes `enter`, `bindProposal`, `recover`, `current`, and `freshnessRequest`. The read port must use the existing normalized `director-inference/context` adapter path. It must not create a work order, invoke a model, dispatch a Provider, or write Yimeng business state.

`enter` binds or switches the exact four-level object. A switch clears any proposal from the previous object. `bindProposal` accepts only the existing command-adapter replay proposal whose scope and input SHA match the active binding. `freshnessRequest` returns the existing command-adapter freshness coordinates without inventing another contract.

`recover` first folds the durable DSh log, then rereads the current Yimeng context. A changed context SHA appends a new complete binding and clears the old proposal automatically. An unavailable context or model capability preserves the last known binding and returns `manualWorkAllowed: true`; manual editing remains independent.

Async entry and recovery use a per-session generation plus binding-event compare-and-swap. A late result returns `superseded` and cannot overwrite a newer object choice or proposal attachment.

The Cordis plugin registers the `qingmuDirectorContext` session projection for a future Qingmu UI mount. This slice does not modify or auto-load the current cockpit bundle.

## Authority and side effects

Yimeng remains the sole source of business truth. Session events contain only object coordinates, context SHA, and immutable proposal/freshness hashes. They contain no prompt text, reference media, content approval, selection, Ready state, Provider result, fee record, or general chat history. The package performs zero Provider calls and zero Yimeng business writes.

## Model Experience

### Session binding bridge

#### What the model sees

Nothing. The `qingmu-director-context/state` event is log-only and never enters derived model history.

#### Token effect

Zero direct model-token effect.

#### KV Cache effect

Independent. Binding, switching, and recovery do not modify model requests.

## Known Limitations and Deferred Work

- The actual cockpit mounting adapter is intentionally deferred; it must supply the existing read-only context port.
- Proposal method drift remains checked by the existing `checkDirectorProposalFreshness` command path. This bridge automatically handles context-SHA drift and preserves those freshness coordinates.
- No real DeepSeek route, credential, external request, fee, or production canary is enabled by this package.
