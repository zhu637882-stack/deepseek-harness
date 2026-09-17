# Agent Note: Qingmu director asset-design save and image quote

Status: implemented

English | [中文](2026-09-17-qingmu-director-asset-design-save.zh.md)

## Problem

During pre-production the native director could read the saved episode asset design (`qingmu_read_asset_design`) but could not write one. Character, scene and prop visual contracts were authored elsewhere, and the director's production-design, character-asset, scene-asset and prop-asset skills had no effect on the design that later image generation compiles from. The director also could not see the exact prompt an asset image run would send, so an under-specified identity contract was discovered only after a paid generation.

## Decision

Two tools mount in the same `qingmuYimengRead` injection block as the existing reference-draft tools, during an episode-scoped creative request.

`qingmu_save_asset_design` saves a complete authored design through the existing `saveAssetDesign` command adapter endpoint. The session's creative request fixes the project and episode; the model supplies only `design` and the observed `expectedStateSha256`. Arguments are restricted to those two keys, and the design is validated before any request: only `assets`, `director` and optional `world` keys, a nonempty `assets` array, and per asset a `kind` of actor, scene or prop with non-empty `name`, `imagePrompt` and `visualIdentity`. The backend remains the authority on every other business field, including omitted per-asset fields it preserves. A state conflict rejects the save with an instruction to reread and reapply; a conflicted save wrote nothing. The receipt reports the new state and script hashes and confirms zero provider calls. Saving is not a price confirmation, a paid generation, a media selection, or an approval.

The tool description encodes the content discipline that the image API has no separate negative-prompt channel: `visualIdentity` states the skill's required dimensions in positive prose, `imagePrompt` describes this image's view and state, and `designBasis` records reasoning rather than a drawing list. Prohibitions are never serialized as positive prose, because such wording would itself be scanned.

`qingmu_quote_asset_image` returns the backend's compiled image request for one saved entity as an unpaid dry run: exact final prompt, model, capability, references, estimated price and quote hash. It is a GET with no body and performs no generation. A `compositionReference`, when present, is returned without its `imageUrl` data URL, which can carry megabytes of pixels that must not enter model context. Together the two tools close a verify loop: save a design, quote an entity, inspect the compiled prompt, correct the design, and save again — all before any paid step.

## Alternatives considered

**Adding a negative-prompt field to the tool or design** was rejected because the Writer image submission path deliberately has no negative-prompt channel; wording prohibitions as positive prose would itself be content-scanned. The required discipline lives in the skills and the tool description, and the quote read verifies the compiled result.

**Letting the model supply scope or entity coordinates** was rejected as with every other native tool: scope comes from the consumed creative request, and the quote takes only an entity id that the saved design must contain.

**Adding the tools to the required readiness set** was rejected because the existing `qingmu_read_asset_design` is also not required; asset design remains an optional pre-production stage, not a gate for shot work.

**A separate draft-then-confirm staging flow** was rejected because the command adapter's optimistic state hash already provides exactly-once semantics with a conflict readback, the same pattern the reference-draft save uses.

## Consequences

The director can now own the asset design it later generates from, using the same persistence, conflict and recovery path as the workspace. Under-specified prompts are caught at the zero-cost quote step instead of after payment. The tools change no Writer code, add no generation route, and cannot dispatch a paid run: the quote is a GET, and the paid `generateAssetImage` endpoint is not exposed to the native director.

## Testing

`reference-video-tools-composition.spec.ts` drives both tools through the shipped director preset and the real command adapter against a stateful fake Writer. Saving posts the exact expected state hash and design, reports the new hashes, and never calls generate or quote endpoints; a stale state hash is rejected without a write; injected scope, a missing director object, a missing identity contract, a missing image description and an unknown asset kind each reject before any request; a single-shot binding refuses the save. The quote returns the compiled prompt containing the saved image description and a well-formed quote hash through GET only, and an unknown entity rejects. The native-director example snapshot records the two tools in the shipped preset's scoped tool list.
