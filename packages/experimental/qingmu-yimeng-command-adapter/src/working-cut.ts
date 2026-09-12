/** Editable candidate choices and local MP4 cuts; no formal approval is inferred. */
import type { CreationScope } from './creation.ts'
import type { YimengCommandJsonObject } from './types.ts'

/** Exact source and playback range in one ordered cut. */
export interface WorkingClip {
  readonly frameId: string
  readonly assetId: string
  readonly sha256: string
  readonly inSec: number
  readonly outSec: number
  readonly sourceGainDb?: number
  /** Local source separation before trim/mix. Omission preserves original audio and retry bodies. */
  readonly sourceAudioMode?: 'original' | 'speech_effects' | 'speech'
  /** Static source crop; zoom 1..4, x/y 0..1 across available crop travel. */
  readonly reframe?: { readonly zoom: number; readonly x: number; readonly y: number }
}
/** Independent sound cue placed on the assembled film, across camera cuts. */
export interface WorkingAudioCue {
  readonly assetId: string
  readonly sha256: string
  readonly kind: 'music' | 'ambience' | 'effect' | 'dialogue'
  readonly startSec: number
  readonly inSec: number
  readonly outSec: number
  readonly gainDb: number
  readonly fadeInSec: number
  readonly fadeOutSec: number
  /** Optional relative dB changes; film times strictly increase within this cue. */
  readonly gainPoints?: readonly { readonly timeSec: number; readonly gainDb: number }[]
  /** Optional mono/stereo room IR from this episode's audio library. Dry sound stays; tail extends the cue. */
  readonly space?: { readonly assetId: string; readonly sha256: string; readonly wetDb: number; readonly tailSec: number }
}
/** Recoverable command for one immutable timeline revision and local render. */
export interface WorkingCutCommand {
  readonly requestId: string
  readonly expectedRevision: number
  readonly clips: readonly WorkingClip[]
  readonly audioCues?: readonly WorkingAudioCue[]
  readonly soundPlan?: string
}
/** Model observations tied to one rendered version, never creative acceptance. */
export interface WorkingCutSoundReview {
  readonly state: 'none' | 'pending' | 'complete' | 'failed'
  readonly advisoryOnly: true
  readonly taskId?: string
  readonly model?: string
  readonly summary?: string
  readonly errorCode?: string | null
  readonly transcript?: readonly {
    readonly start_sec: number
    readonly end_sec: number
    readonly speaker: string
    readonly text: string
    readonly delivery: string
  }[]
  readonly checks: readonly {
    readonly kind: string
    readonly status: 'pass' | 'fail' | 'unverified' | 'not_applicable'
    readonly evidence: string
    readonly timeRanges: readonly (readonly [number, number])[]
  }[]
}
/** Current shot choices plus retained MP4 versions. */
export interface WorkingCutState extends CreationScope {
  readonly schema: 'qingmu-working-cut-v1'
  readonly revision: number
  readonly audioSeparation?: { readonly available: boolean; readonly model: string; readonly providerCalls: 0 }
  readonly audioLibrary?: readonly {
    readonly assetId: string
    readonly sha256: string
    readonly name: string
    readonly duration: number
    readonly url: string
    /** Bundled responses are effect inputs, never standalone music cues. */
    readonly usage?: 'impulse_response'
    readonly presetId?: string
    readonly sourceUrl?: string
  }[]
  readonly acousticPresets?: readonly {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly sourceUrl: string
    readonly sha256: string
    readonly duration: number
    readonly license: string
    readonly author: string
  }[]
  readonly shots: readonly {
    readonly frameId: string
    readonly frameNo: number
    readonly title: string
    readonly candidates: readonly {
      readonly assetId: string
      readonly sha256: string
      readonly duration: number
      readonly taskId: string
      readonly url: string
    }[]
  }[]
  readonly cuts: readonly {
    readonly revisionId: string
    readonly version: number
    readonly clips: readonly WorkingClip[]
    readonly audioCues?: readonly WorkingAudioCue[]
    readonly soundPlan?: string
    readonly requestId: string
    readonly taskId: string | null
    readonly status: string
    readonly errorCode: string | null
    readonly assetId: string | null
    readonly sha256: string | null
    readonly url: string
    readonly soundReview?: WorkingCutSoundReview
  }[]
  readonly providerCalls: 0
  readonly humanApprovalChanged: false
}
/** Prepare authenticated fixed-scope working-cut reads and local renders.
 * @param endpoint - Read or render operation.
 * @param value - Untrusted browser payload.
 * @param helpers - Host error factories.
 * @returns Fixed route, validated body and scoped response parser.
 */
export function prepareWorkingCut(endpoint: string, value: unknown, helpers: {
  inputError: (message: string) => Error
  responseError: (message: string) => Error
}): { path: string; method: 'GET' | 'POST'; body: YimengCommandJsonObject | undefined; normalize: (value: unknown) => WorkingCutState } {
  const fail = helpers.inputError
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('working cut object required')
  const raw = value as Record<string, unknown>
  const id = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw fail('working cut scope invalid')
    return v
  }
  const projectId = id(raw.projectId), episodeId = id(raw.episodeId)
  const operation = ({ readWorkingCut: '', renderWorkingCut: '/render', saveWorkingCut: '/save', uploadWorkingCutAudio: '/audio', reviewWorkingCutSound: '/sound-review' } as Record<string, string>)[endpoint]
  if (operation === undefined) throw fail('working cut endpoint invalid')
  const write = operation !== ''
  const fields = write ? ['projectId', 'episodeId', 'command'] : ['projectId', 'episodeId']
  if (Object.keys(raw).some(k => !fields.includes(k))) throw fail('working cut field invalid')
  let body: YimengCommandJsonObject | undefined
  if (write) {
    if (!raw.command || typeof raw.command !== 'object' || Array.isArray(raw.command)) throw fail('working cut command required')
    body = raw.command as YimengCommandJsonObject
  }
  return { path: `/api/qingmu/projects/${projectId}/episodes/${episodeId}/working-cut${operation}`,
    method: write ? 'POST' : 'GET', body,
    normalize: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw helpers.responseError('working cut response invalid')
      const state = value as Record<string, unknown>
      if (state.schema !== 'qingmu-working-cut-v1' || state.projectId !== projectId || state.episodeId !== episodeId
        || !Array.isArray(state.shots) || !Array.isArray(state.cuts) || !Number.isSafeInteger(state.revision)
        || state.providerCalls !== 0 || state.humanApprovalChanged !== false) throw helpers.responseError('working cut response scope invalid')
      return value as WorkingCutState
    } }
}
