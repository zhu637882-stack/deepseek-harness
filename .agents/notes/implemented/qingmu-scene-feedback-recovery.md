# Scene feedback returns to shared design

Whole-scene source problems need an actionable route back to upstream design. A rejection message alone leaves users copying details out of a long candidate and losing their revision instructions when they navigate.

The existing candidate composer exposes a local inspection slot. Scene coordination renders its current unresolved feedback there and stores a per-scene, project/episode-scoped handoff only when the user follows the asset link. The asset page can append that feedback to retained instructions and return to the storyboard. Source hashes distinguish old feedback from the current script and asset design; feedback remains a proposal to inspect, not authoritative facts or an automatic revision. Non-asset concerns remain visible for their corresponding authoring page.

The flow keeps native results, adoption checks, existing frame saves and media unchanged. It adds no backend queue, model call, source approval or automatic regeneration. Its browser-local scope matches existing candidate recovery; cross-device recovery is not promised. Focused tests cover scoped handoff, retained instructions, old-source notices and unchanged adoption rejection; the live browser case covers navigation, reload and return to the original native draft.
