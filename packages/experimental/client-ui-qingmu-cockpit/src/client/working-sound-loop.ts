import type { WorkingAudioCue } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

/** Source loops extend the bed before the optional room tail, independent of picture timing. */
export function soundCueDuration(cue: WorkingAudioCue): number {
  return (cue.loop?.durationSec ?? cue.outSec - cue.inSec) + (cue.space?.tailSec ?? 0)
}

/** Match the renderer's sample-based crossfade bounds before enabling save. */
export function validSoundLoop(cue: WorkingAudioCue): boolean {
  if (!cue.loop) return true
  const { durationSec, crossfadeSec } = cue.loop
  const length = cue.outSec - cue.inSec
  return Number.isFinite(durationSec) && Number.isFinite(crossfadeSec)
    && durationSec >= length && durationSec <= 600
    && Math.round(crossfadeSec * 48000) >= 1
    && Math.round(crossfadeSec * 48000) * 2 < Math.round(length * 48000)
}
