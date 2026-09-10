# Native shooting and voice entry

Status: implemented

The shooting Generate Video button incorrectly opened the legacy PromptIR bootstrap instead of the working precise-reference generation workspace. Route that action to SceneReferenceWorkspace with the selected canonical shot and its existing unsaved-change handling. Keep explicit first-frame actions separate.

Add character voice audition quotation, confirmed generation and original-task recovery through Writer audio.voice_design. The backend validates actor ownership and the current design/quote; confirmed requests share existing task idempotency and budget handling. Validated preview bytes are registered as reusable audio assets by their original task.

Validation: focused asset design/voice browser tests, command adapter routing tests and Writer native queue/materialization tests. Runtime and full-film creative review are tracked separately in the implementation checkpoint.
