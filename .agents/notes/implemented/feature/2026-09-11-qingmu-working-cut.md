# Qingmu working cuts

The five-stage delivery page exposes ordered candidate choices, source trims, local MP4 rendering and retained versions. It uses the existing Writer editing projects, immutable timeline revisions and TimelineRenderWorker. The candidate mode is explicit, scoped to completed reference-video assets in the current project and episode, and cannot become a formal ExportProject result. Input and output hashes remain in native records. No separate editor storage or media-generation provider is introduced.

A render command binds the expected revision and a request ID. Duplicate recovery returns the same render task; source mismatch, invalid trims, foreign ownership and concurrent revisions are rejected. The client retains uncertain requests and refreshes task state without another paid call. Existing formal review remains available as a supporting panel.

Reference drafts now load automatically on a clean opening; late responses cannot overwrite edits. Refreshing workflow state rereads the current Take stack while preserving the browsed version when it still exists. Validation covers real local FFmpeg output, ownership, hashes, trims, recovery, and the browser sequence.

The shooting page leads directly to working cuts without impersonating a human-review identity. The reference editor can copy the complete current director text into the actual editable prompt while retaining existing dialogue and stable reference tokens; repeat clicks do not duplicate it.

Director-authored gain points belong to independent cues in assembled-film time. They survive save, reopen and native tool reads and compile through the existing FFmpeg volume filter; dB interpolation preserves intentional reductions and recoveries across shot boundaries. This avoids inferring dialogue from a source mix containing traffic or music. Original audio remains under its separate explicit gain, and no source separation or acoustic repair is implied. Verification includes the shipped director preset transcript, UI recovery, invalid timing rejection and frequency measurements on a real FFmpeg render with concurrent source audio and ambience.
