import type { QingmuYimengPort } from './contracts.ts'
import type { DirectorContextClientPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'

/** Exact project and episode selected by the outer Yimeng workspace. */
export interface QingmuEntryScope {
  readonly projectId: string
  readonly episodeId: string
}

const entryId = (value: string | null): string | null => value !== null
  && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value) ? value : null

/**
 * Decode the outer Yimeng workspace handoff.
 *
 * @param href Browser location containing the optional embedded handoff.
 * @returns The exact scope, null for an invalid embedded handoff, or undefined for standalone Host use.
 */
export function parseQingmuEntryScope(href: string): QingmuEntryScope | null | undefined {
  const url = new URL(href)
  if (url.searchParams.get('qingmuEmbedded') !== '1') return undefined
  const projectId = entryId(url.searchParams.get('qingmuProjectId'))
  const episodeId = entryId(url.searchParams.get('qingmuEpisodeId'))
  return projectId !== null && episodeId !== null ? { projectId, episodeId } : null
}

/** Dependencies injected into the Qingmu cockpit's sidebar slot occupant. */
export interface QingmuCockpitFace {
  readonly port: QingmuYimengPort
  readonly directorBridge: DirectorContextClientPort
  /** Undefined is the standalone Host; null is an invalid embedded handoff. */
  readonly entryScope?: QingmuEntryScope | null
}
