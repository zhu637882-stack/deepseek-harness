# Continuous sound beds across picture cuts

English | [中文](2026-09-13-qingmu-crossfaded-sound-loop.zh.md)

Short environment recordings should fill a director-chosen scene range without manual duplicate cues or hard source restarts. An optional cue loop retains source trim, target duration and overlap. The existing working-cut route owns validation and immutable versions; the existing local renderer owns execution after optional stem extraction, before convolution, fades, gain envelopes and placement. Source and old-version identities stay unchanged. Nothing loops by default, and no new provider or job system is needed.

The [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#acrossfade) combine the source tail and head using equal-power crossfades, then repeat one buffered period with aloop. A preserved first entrance and sample-based bounds avoid timing drift; filter count stays constant for long beds. Validation rejects invalid overlaps, source changes and film overrun. Sound within the source repeats too; music phrasing and environmental suitability require listening.

Checks cover actual decoded source joins and entrance, API save/recovery/MP4 across picture cuts, source preservation, optional reverb tail, ordinary editor controls, and the shipped native director preset with keyless model playback.
