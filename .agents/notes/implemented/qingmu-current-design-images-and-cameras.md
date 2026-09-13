# Current design images and executable shot cameras

The episode designer previously read current text but had to choose pixels separately from all historical candidates. A real whole-scene draft selected competing old room images instead of the saved design reference, then described replacement cameras only in prose. The existing frame save would preserve the old executable camera.

The asset-design tool now reuses the draft-image attachment path for exact saved references, deduplicating bytes while retaining every current use. Catalog metadata remains available; missing images remain explicit. No image selection or additional model call occurs. A scene with an authored layout requires each proposed shot to state an executable imageCamera or an intentional null. Other creative fields remain extensible, and video movement is independent of the starting camera.

Focused assembled-tool tests cover exact, stale and missing references with no business writes. UI tests cover missing/invalid camera rejection, explicit cameras, opt-out and unchanged motion. Actual generated continuity and creative source reconciliation still require visual review.

Initial scene design uses the same camera guidance and validation as existing-scene coordination. Completed new-scene revisions also start from fresh current sources, while interrupted work retains its recovery session. Missing cameras cannot enter new shot cards silently; explicit opt-out remains available.

Completed candidates also retain local edits against the exact native result identity. This lets the same screenplay, asset and scene workflow revise a reviewed draft without repeated model calls. Original output and source checks remain intact.
