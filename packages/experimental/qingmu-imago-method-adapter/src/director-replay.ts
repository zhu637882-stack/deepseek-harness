/** Stateless method coordinates for the existing Qingmu three-party integration plan. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ImagoDirectorReplayMethodResponse } from './types.ts'

/** Repository-relative path of the existing Qingmu three-party integration plan. */
export const DIRECTOR_REPLAY_PLAN_PATH =
  'knowledge/methods/qingmu-os-deepseek-harness-director-assets-integration-20260828.md'

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

/**
 * Load one immutable package descriptor; it contains no project or Provider state.
 * @param coreRoot Absolute IMAGO OS Core repository root.
 * @returns A SHA-bound replay method package derived from the existing plan.
 */
export async function loadDirectorReplayMethod(
  coreRoot: string,
): Promise<ImagoDirectorReplayMethodResponse> {
  const sourceBytes = await readFile(join(coreRoot, DIRECTOR_REPLAY_PLAN_PATH))
  const packageBody = {
    schema: 'qingmu.imago-director-replay-method-package.v1' as const,
    version: 'qingmu.director-replay.v1' as const,
    sourceBindings: [{
      path: DIRECTOR_REPLAY_PLAN_PATH,
      sha256: sha256(sourceBytes),
    }] as const,
    integrationCoordinates: ['H2', 'H3-precondition-replay'] as const,
    suggestionTypes: {
      text_director_proposal: { expectedModel: 'deepseek-v4-pro' as const },
      visual_finding: { expectedModel: 'deepseek-v4-flash-vision-exp' as const },
    },
    authority: {
      businessTruth: 'yimeng' as const,
      methodSource: 'imago_os' as const,
      inferenceHost: 'harness_dsh' as const,
      replayOnly: true as const,
      providerCalls: 0 as const,
      maximumCostCny: '0' as const,
      humanDecisionInferred: false as const,
      formalQcInferred: false as const,
      selectionGranted: false as const,
      readyGranted: false as const,
    },
  }
  return {
    ...packageBody,
    methodPackageSha256: sha256(canonicalJson(packageBody)),
  }
}
