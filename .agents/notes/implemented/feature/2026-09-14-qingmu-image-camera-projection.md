# Agent Note: Check the saved image camera

Status: implemented

A real scene draft claimed a daughter was visible while its described camera placed her behind the lens. Another shot called a 44-degree vertical field of view a 46-degree horizontal field. The existing geometry tool accepted only ground-plane cameras with manually supplied horizontal FOV, while generation consumed a three-dimensional imageCamera.

The same tool now accepts imageCamera, aspectRatio and attributed 3D landmarks. Projection follows the existing blockout renderer: z-up coordinates, pitch and roll, and a .05 metre near plane. It derives horizontal FOV and returns normalized image positions, preserving out-of-frame values and refusing to project points before the near plane. The old planar form remains available. Native new-scene and whole-scene guidance copies the intended saved camera into this check and uses separate body and prop endpoints.

## Validation

Focused tests exercise aspect-ratio changes, pitch, roll, overhead views, near-plane points, invalid mixed conventions, and the observed behind-camera mistake without moving the subjects. A shipped-preset test logs the new tool output through the real agent loop with a mocked model; the following model step receives it. This is authored geometry validation, not image analysis, occlusion proof or generated-media approval. Actual layout-renderer comparison and runtime evidence are retained in the project verification directory.
