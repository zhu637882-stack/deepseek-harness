# Independent video sound on the assembled cut

English | [中文](2026-09-13-qingmu-independent-video-sound.zh.md)

Generated scene sound must be reusable beyond its picture boundary. Qingmu exposes retained episode videos and completed rendered cuts as independent cue sources, while keeping imported audio separate. The existing working-cut API, immutable revision and local RenderTimeline worker own timing, optional Bandit stem extraction, cache integrity and recovery; no second job system or paid service is added.

Cues may use the full mix, speech, speech/effects, effects or music. Effects still combine ambience and Foley. Sources keep their project, episode and byte identities; unavailable or changed sources fail. Picture clips support explicit silent mode without inference. Completed cut sound keeps its original timing when used independently; subsequent picture edits require checking alignment. Rendered cuts cannot become picture candidates through this sound path. Existing requests omit the new field and retain their identities. Formal editing authorization is unchanged.

Validation covers waveform continuity across two picture cuts, source timing, component cache reuse, missing runtime, invalid scope/hash/IR, and browser save/reopen. Generated sound still requires listening; extraction cannot guarantee artifact-free isolation.
