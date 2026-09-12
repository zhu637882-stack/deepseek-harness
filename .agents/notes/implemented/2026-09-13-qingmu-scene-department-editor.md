# Editing complete scene direction

Scene planning exposes authored camera, blocking, performance, lighting, sound, continuity and dialogue delivery as editable text. The existing planning draft, preview, save and receipt recovery own persistence. Editing a value retains unexposed department fields, nested extensions and dialogue source identities; an explicit empty string remains an authored value.

Previously the complete direction was a read-only JSON view next to editable action text. This allowed a visible action correction to leave contradictory camera or continuity instructions downstream. Direct fields support small corrections without a new native model request. Unrecognized structured formats remain visible without conversion or silent replacement.

Focused workspace tests cover initial and saved plans, nested-field preservation, dialogue identity, explicit clearing and recovery after an unknown save result. This editor does not automatically reconcile creative contradictions or revise other shots.
