# Preserve native sound when selecting separated audio

The director sound reference previously recommended stripping model audio by default, despite native dialogue, Foley and ambience sharing that mix. A real advertising trial lost more than 40 dB in several intervals after whole-cut separation. The guidance now retains useful source sound and compares an affected interval before replacement; it does not infer that a generated stem preserves every sound. Intentional silence remains a director decision.

The previous resource edit also left its recorded bundle hash stale. The manifest now matches the adapted file while preserving its upstream hash. The native skill-resource example checks that the complete corrected reference reaches the next model request. No new generation, automatic mix changes or quality approval follows from loading the skill.
