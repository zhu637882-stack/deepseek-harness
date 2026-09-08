# AGENTS.md — Web client stack

Applies to `packages/client/*` and `apps/web`. These rules supplement the repo and package `AGENTS.md` files. Keep this file to non-negotiable browser-stack constraints; detailed rationale and setup procedures live in the linked notes.

Read only when relevant:

- Slot composition, props, stores, or plugin structure: [slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) and [web client architecture](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md).
- Browser dependencies, dynamic rows, or bundling: [shared modules and the module graph](#shared-modules-and-the-module-graph) and `packages/client/web/src/platform.ts`.
- Conversation rendering: [Conversation Node cookbook](../../docs/cookbook/adding-a-conversation-node.md).
- Styling: [web styling](../../docs/web-styling.md).
- Test selection: [GUI testing system](../../.agents/notes/implemented/process/2026-07-20-gui-testing-system.md) and [repo testing policy](../../docs/testing.md).

Client packages use `@deepseek-ai/dsh-client-<name>`.

## Composition, props, and reactive state

- Compose UI only with `ctx.slots.register({ name, children?, store?, inject? }, Component)`. The shell alone renders `root`; do not add a parallel composition API.
- `children` is both declaration and authorization. A component may render exactly the slots declared by its registration. Slot names follow `<domain>.<entry>.<hole>`.
- Derive component props from the four shares: `PropsRuntime`, `PropsRenderSlots`, `PropsStore`, and the inject face. Do not retype or duplicate a derived share.
- Framework hooks are `useSession`, `useSessions`, `useWorkspaces`, `useStore`, `renderSlot`, plus renderer-bound `use<Name>` hooks. Business code does not create subscription hooks or selectors as prop values.
- Route changing data by ownership: parent-owned data through owner props; component-private data through local state; cross-entry or remount-surviving interaction state through a registered store. Derived data stays derived.
- Store factories are exported `createXXXStore()` functions. Read through `props.useStore`; mutate only through declared `props.actions`. Production creates store handles inside `apply`; tests may create them directly.
- `inject` returns plain JSON-compatible data and callbacks closed over the declared dependencies. Registrant-private observables use the reserved `hooks` compartment and never reach components as source objects.
- Render code may read external mutable state only through framework hooks. No business-component `useSyncExternalStore`, manual subscribe wiring, snapshot mirroring, service imports, React context access, or direct `ctx` access.
- Observable source identity is stable, and `getSnapshot` returns the same reference until the value changes. A publisher that rebuilds a value republishes it in the same operation.

## Layering

Knowledge flows one way:

1. `runtime` owns connections, sessions, event accumulation, reconnect state, and bare observable stores. It imports no React.
2. `ui-renderer` owns ctx-to-React integration, slot rendering, providers, and hook binding.
3. Feature packages under `src/client/` are presentation over the four prop shares.

Business session/frame/connection data remains in the object layer; registered stores carry viewing and interaction state only. `rpcId` is minted by the initiator and echoed by the responder. `notifyNow` is for direct user-gesture echo, structural updates use batched `markDirty`, and visible streaming uses cumulative `markFrameDirty`.

Presentation choices do not enter the session log. Model-visible inputs still require reconstructable session events under the repo-wide rule.

## Public exports

- A client plugin exports only Loader-required `apply` / `inject` / `Config`, shared types, and store factories needed for type projection. Components, helpers, constants, and store handles stay internal.
- Tests import same-package internals directly; do not widen public API for tests.
- Cross-plugin symbol imports are forbidden by default. Use slots or ctx services; if neither represents the relationship, stop and settle the architecture instead of adding a convenience export.

## Shared modules and the module graph

[`verify-client-packages`](../../scripts/verify-client-packages.ts) is the machine owner and may repair unambiguous manifest drift with `--fix`.

- Cordis stays in matching peer and dev dependencies. Internal dynamic relationships are peer plus dev; test-only internal dependencies are dev-only. Static client inputs are dev-only for dynamic consumers. Ordinary bundled implementation libraries stay in `dependencies`.
- Browser and Node build faces decide externality independently. Published payloads must cover every relative runtime import and emitted asset.
- Dynamic bundles receive the shared baseline from `web/src/platform.ts`. Use `dsh.client.external` only for a non-baseline value import requiring shared module identity; type-only imports create no request. Every request needs a dynamic-row or platform supplier, and synchronous request cycles are invalid.
- Cordis service `inject`, module-table `external`, and manifest `dsh.client.inject` are different edges. Module requests must be satisfiable before Cordis can order activation; do not use one declaration as a substitute for another.
- Client code may statically read only public `DSH_CLIENT_*` build values. Choices that must change after build use runtime configuration.

## Conversation Nodes

- A Chat feature registers one `ConversationNodeDefinition` and its keyed renderer. Do not add feature switches or folds to `Session`, `SessionManager`, or a central dispatcher.
- `match(event)` reads only that event. Multi-event contexts carry or derive one stable business id; `update` folds one match and remains deterministic by log sequence.
- Append and render hot paths do not scan the full event window, contexts, or node list. Accumulate in node state and publish same-turn facts through `buildLocationData()`.

## Package and presentation conventions

- One UI feature is one plugin package. Multi-domain packages share only an explicit contract layer; sibling domains do not import one another, and `apply.ts` is the cross-domain assembly point.
- Register into another package's slot with `ctx.slots.inject(name, () => ctx.slots.register(...))`; do not rely on apply order.
- Shared `--dsw-*` tokens and global styles live in `ui-theme`; features use semantic aliases through CSS Modules and `clsx`. No literal colors, Tailwind, or parallel component library. Product copy is Chinese; code comments are English.
- Client source remains inside the per-file coverage gate. Component tests assert user-visible behavior with realistic props or a driven fixture, not class names, hook internals, or render counts. Use per-file `// @vitest-environment jsdom` when needed.
- Non-trivial changes follow the repo-wide Agent Note and model-visible snapshot rules. Do not create notes or snapshots for mechanical/local edits that do not meet those triggers.

## Verification ladder

Run the narrowest rung that proves the changed surface; do not repeat a passing rung when code and inputs are unchanged.

1. Focused package or component test while iterating.
2. Any GUI code change: `pnpm run test:gui`.
3. Changes to assembled browser behavior, visible conversation/UI output, Vite, web server, connection handling, or SSE: additionally `DSH_SNAPSHOT=replay pnpm run test:web`.
4. Documentation or public API changes: relevant package checks plus `pnpm run doc-sync`.
5. Published artifacts or package graph changes: relevant build/hygiene gates selected by [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md).

Use snapshot refresh/record only for an intentional output change and the required authorization. CI owns exhaustive platform coverage. If an unrelated baseline is red, report it; do not silently fix or ignore it.

For a new client package, follow [the package cookbook](../../docs/cookbook/adding-a-package.md) and the slot/module references above, then let `verify-client-packages` prove the manifest, aggregate, bundle, and publication surfaces. Do not duplicate the full checklist here.
