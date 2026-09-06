# Qingmu director context bridge

English | [中文](README.zh.md)

This private experimental package binds one DSh session to one exact Yimeng `project / episode / scene / shot` and its normalized `contextSnapshotSha256`. The binding is a log-only, whole-value session event, so a restarted session rebuilds the same identity without a second database or ledger.

## Mount interface

`createDirectorContextBridge(readPort)` exposes `enter`, `clear`, `bindProposal`, `recover`, `current`, and `freshnessRequest`. The read port must use the existing normalized `director-inference/context` adapter path. It must not create a work order, invoke a model, dispatch a Provider, or write Yimeng business state.

`enter` binds or switches the exact four-level object. Once the Host accepts a non-aborted entry for a different object, it appends a null binding event before I/O, clearing the previous object and proposal. Pending, failed or cancelled reads then cannot expose the old shot to native tools; cold replay remains unbound until a successful entry. Unavailable entry returns `changed: true` if it cleared the previous binding. An already-aborted entry performs no read or log mutation. `bindProposal` accepts only the existing command-adapter replay proposal whose scope and input SHA match the active binding. `freshnessRequest` returns the existing command-adapter freshness coordinates without inventing another contract.

Browser entry supplies a new `ownerId` for each view binding. `clear(session, scope, ownerId)` compares the active owner and scope before clearing or cancelling a pending entry; late cleanup cannot clear a newer view, including one on the same shot. Ownerless native refresh preserves a same-scope browser owner, while ownerless entry to another object revokes it. The owner is a runtime-only cleanup lease, not authentication or business authority.

`recover` first folds the durable DSh log, then rereads the current Yimeng context. A changed context SHA appends a new complete binding and clears the old proposal automatically. An unavailable context or model capability preserves the last known binding and returns `manualWorkAllowed: true`; manual editing remains independent.

Async entry and recovery use a per-session generation plus binding-event compare-and-swap. A late result returns `superseded` and cannot overwrite a newer object choice or proposal attachment. Unbound recovery and rejected proposal attachment do not cancel a pending entry. The projection state remains nullable version 1; updated event readers must ship together before null events are produced.

The Cordis plugin registers the `qingmuDirectorContext` session projection and a loopback-only browser facade. The Qingmu bundle mounts it before the cockpit. The workspace binds legacy planning shots or the selected canonical automatic-storyboard shot to the same current session; canonical binding does not enable legacy saves. The facade never exposes the underlying Host command handler, token, Provider payload, or permit.

`readNativeDirectorReadiness({ sessionId })` inspects the attached session's live agent and scoped tool registry without resuming it or loading a preset. It reports mounted, missing-tools, inactive or unavailable; neither the recorded preset label nor a successful shot binding can establish tool presence. The result is a point-in-time registration check, not execution, model availability, Writer health or creative approval. Missing optional native services preserve the binding facade.

## Authority and side effects

Yimeng remains the sole source of business truth. Binding events contain only object coordinates, context SHA, and immutable proposal/freshness hashes. They contain no prompt text, reference media, content approval, selection, Ready state, Provider result, fee record, or general chat history. The optional model tools below do store creative context and method text in ordinary tool-result events. The package performs zero Provider calls and zero Yimeng business writes.

## Native director read tools

The opt-in `@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools` plugin mounts inside a Qingmu agent or preset scope, not the Host root. It requires `tools`, `qingmuYimengCommand`, and `qingmuImagoMethod`. Mounting the existing binding plugin alone does not enable these tools, and this source change does not update the production preset.

- `qingmu_read_bound_context({})` reads the actual normalized Writer context for the session's bound object. The model cannot supply another project, shot, or session.
- `qingmu_get_imago_method({ capability })` reads current IMAGO instruction text for `director_development` or `shot_design`. For C5, follow a required `additionalReferences` entry with `{ capability: 'shot_design', resourceId: 'rough_final_feedback' }`; a listed hash is not proof that its text was read.

Each call refreshes the binding before returning content. A changed context SHA invalidates a pending proposal; an object switch during either read rejects the late result. Missing context, missing methods, and cancellation do not generate replacement content or block manual editing. There is no proposal-adoption, business-write, approval, or generation tool in this entry.

When the scoped consumer also has `qingmuYimengRead`, it registers `qingmu_read_prompt_draft` and `qingmu_propose_prompt_edit`. The read loads the current Ready/draft prompt, bound context, and full C5 instructions including required supplementary references. The suggestion replaces one of the existing five prompt fields, using a receipt from a successfully paired native tool call/result. The Host rechecks the source before returning a suggestion. It never accepts a model-authored baseline or a legacy replay work order.

`readNativeDraftProposal` is a read-only loopback facade for the latest logged native suggestion. It rechecks Writer context, prompt baseline, methods and session binding, distinguishing current, stale, unavailable and absent results. Suggestions contain only source coordinates, receipt ID, original/replacement text and rationale; context and method bodies remain in the original read result. The cockpit compares original and suggested text and explicitly adopts into an unsaved draft, rechecking freshness and preserving manual edits. Existing method checking, preview, save and authoritative Writer reread stay separate. No scene-planning save, approval, generation, additional database or queue is introduced. One-field suggestions require an existing Ready PromptIR; first-Draft bootstrap remains in its existing workspace.

`maxOutputBytes` defaults to 262144 UTF-8 bytes for each complete JSON response. Oversized responses fail without truncation. The IMAGO source loader has separate 128 KiB per-file and 512 KiB package limits: an admissible source package can still exceed this consumer's response limit. Configure the Host limit explicitly or use the fixed follow-up resource; never silently shorten the method.

For a frame with neither Draft nor Ready, `qingmu_read_first_draft` reads current bootstrap prerequisites and full C5 methods. `qingmu_propose_first_draft` accepts the logged receipt, all five editable fields and a reason; it rereads sources and rejects existing prompts, scope drift or invented receipts. `readNativeFirstDraftProposal` returns the latest current suggestion to the same session and scope. Adoption edits only the director workspace's local first draft; the existing bootstrap compiler and Writer save/select path own persistence. The tools never set references, status or approval authority. Readiness checks require these two tools alongside the four existing ones.

The tools return lossless JSON through the native tool registry. They add no system-prompt injection, second event log, business database, or separate agent loop. The current context is textual evidence, not a pixel-level image review or a claim that the full screenplay is available.

Run the [keyless example](examples/model-tools-keyless.ts) from the Harness root with `node --import tsx packages/experimental/qingmu-director-context-bridge/examples/model-tools-keyless.ts`. It loads the shipped Qingmu director preset through Loader, creates a memory-only native session, and runs the real agent loop against scripted external responses. The snapshot includes the actual persona, scoped tools, durable event format and method text in the next model request. It makes no network or paid Provider request; the separate composition test also verifies cold restoration.

## Model Experience

### Session binding bridge

#### What the model sees

Nothing. The `qingmu-director-context/state` event is log-only and never enters derived model history.

#### Token effect

Zero direct model-token effect.

#### KV Cache effect

Independent. Binding, switching, and recovery do not modify model requests.

### Native read tools

#### What the model sees

The context and method tool schemas, plus the two prompt-suggestion tools when the PromptIR reader is available. Tool results persist in the existing session log and enter the next model request. Standalone method reads require separate follow-up references; prompt-draft reads include all required C5 references. Suggestion results carry compact source coordinates, not repeated method or context bodies.

#### Token effect

Only an opted-in agent receives the schemas; each requested context or method body adds model input tokens. No source text is automatically appended to every system prompt.

#### KV Cache effect

New results append to conversation history. Changed context or method text changes that suffix; the plugin does not rewrite earlier messages or inject unstable system-prompt content.

## Known Limitations and Deferred Work

The opt-in `tests/native-first-draft-connected.spec.ts` connects the shipped native preset to actual Writer HTTP/SQLite and the actual Core compiler over disposable synthetic data. Set `QINGMU_WRITER_TEST_ROOT` and `QINGMU_CORE_TEST_ROOT` to the corresponding checkouts, then run `node node_modules/vitest/vitest.mjs run packages/experimental/qingmu-director-context-bridge/tests/native-first-draft-connected.spec.ts`. Writer needs its `.venv/bin/python` test dependencies. Add `QINGMU_CONNECTED_BROWSER=1` for the actual bootstrap component's adopt/edit/save/recover/select/reload path; this also requires Python Playwright and an installed Chrome (`QINGMU_BROWSER_CHANNEL` may override the channel). External model replies remain scripted. The test uses synthetic authentication, no production data or credentials, zero generation tasks, and no content signoff; owned processes and temporary data are removed on exit. The browser shell forwards real business handlers but does not load the complete production Host or outer Writer page.

- Runtime-only owners do not survive a Host restart. A persisted successful binding still recovers under existing session semantics, while a persisted null stays unbound. A surviving browser must re-enter to acquire a new cleanup lease. Offline or rejected cleanup cannot guarantee detachment; the UI reports an unconfirmed clear when still mounted without a newer binding.
- Native composition and isolated real Writer persistence are verified with a Loader preset and scripted model transport. This is not evidence of production activation, full Host/browser transport, real-model creative quality or generation.
- Legacy replay proposal drift remains checked by `checkDirectorProposalFreshness`; native prompt suggestions use their recorded read receipts and the read-only facade instead.
- No real DeepSeek route, credential, external request, fee, or production canary is enabled by this package.
