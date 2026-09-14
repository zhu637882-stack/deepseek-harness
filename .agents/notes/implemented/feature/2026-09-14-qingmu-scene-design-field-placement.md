# Agent Note: Native scene design field placement

Status: implemented

A completed native scene draft placed `selfContainedImagePrompt` on each shot rather than inside `directorPlan`. Downstream shot projection consumes the nested setting, so adopting an otherwise valid draft could silently lose it. The final JSON example omitted the flag despite the preceding instructions requiring it.

The example now includes the nested flag. Adoption rejects shot-level `selfContainedImagePrompt`, `imageCamera`, `imageObjectStates` and `generationContext` before replacing cards. The original candidate remains available for local correction. Correctly nested settings pass through unchanged. Existing source, dialogue and camera validation remains active.

## Validation

Focused component checks cover all four misplaced settings, candidate retention, no model resend and a valid nested setting. The native request snapshot records the corrected example. This repair does not establish that a generated image follows the authored geometry; the rejected rain-scene candidates remain unselected.
