/** Stage-scoped director method-card serving from the admitted asset ledger.
 * Guidance-only: cards supply text and module references with zero execution
 * authority; content is served strictly after per-file provenance verification. */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  DIRECTOR_STAGE_CARDS,
  directorStageCards,
  loadDirectorAssetFile,
} from './director-assets/assembly.ts'

export interface DirectorStageCardsResponse {
  readonly schema: 'qingmu.imago-director-stage-cards.v1'
  readonly stageId: string
  readonly cards: readonly {
    readonly repoId: string
    readonly path: string
    readonly kind: string
    readonly stageIds: readonly string[]
  }[]
  readonly authority: {
    readonly businessTruth: 'yimeng'
    readonly methodSource: 'imago_os'
    readonly guidanceOnly: true
    readonly providerCalls: 0
    readonly maximumCostCny: '0'
    readonly humanDecisionInferred: false
    readonly selectionGranted: false
    readonly runtimeExecution: false
  }
}

export interface DirectorStageCardContentResponse {
  readonly schema: 'qingmu.imago-director-stage-card-content.v1'
  readonly repoId: string
  readonly path: string
  readonly kind: string
  readonly content: string
  readonly contentSha256: string
  readonly authority: DirectorStageCardsResponse['authority']
}

const packageAssetsRoot = join(dirname(fileURLToPath(import.meta.url)), '../assets')

/** Served cards for one stage; unknown stages return an explicit empty set. */
export function loadDirectorStageCards(stageId: string): DirectorStageCardsResponse {
  return {
    schema: 'qingmu.imago-director-stage-cards.v1',
    stageId,
    cards: directorStageCards(stageId).map(card => ({
      repoId: card.repoId,
      path: card.path,
      kind: card.kind,
      stageIds: card.stageIds,
    })),
    authority: {
      businessTruth: 'yimeng',
      methodSource: 'imago_os',
      guidanceOnly: true,
      providerCalls: 0,
      maximumCostCny: '0',
      humanDecisionInferred: false,
      selectionGranted: false,
      runtimeExecution: false,
    },
  }
}

/** Serve one card's content after provenance verification; fails closed. */
export async function loadDirectorStageCard(
  repoId: string,
  path: string,
): Promise<DirectorStageCardContentResponse> {
  const card = DIRECTOR_STAGE_CARDS.find(item => item.repoId === repoId && item.path === path)
  if (card === undefined) throw new Error('director_stage_card_not_registered')
  const content = await loadDirectorAssetFile(packageAssetsRoot, repoId, path)
  return {
    schema: 'qingmu.imago-director-stage-card-content.v1',
    repoId,
    path,
    kind: card.kind,
    content,
    contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    authority: {
      businessTruth: 'yimeng',
      methodSource: 'imago_os',
      guidanceOnly: true,
      providerCalls: 0,
      maximumCostCny: '0',
      humanDecisionInferred: false,
      selectionGranted: false,
      runtimeExecution: false,
    },
  }
}
