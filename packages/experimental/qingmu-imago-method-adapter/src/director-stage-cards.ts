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
import { directorAssetEntry } from './director-assets/registry.ts'
import type { ImagoMethodJsonObject } from './types.ts'

/** Guidance-only list of admitted director cards for one requested stage. */
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

/** Provenance-verified inert text content for one admitted director card. */
export interface DirectorStageCardContentResponse {
  readonly schema: 'qingmu.imago-director-stage-card-content.v1'
  readonly repoId: string
  readonly path: string
  readonly kind: string
  readonly content: string
  readonly contentSha256: string
  readonly authority: DirectorStageCardsResponse['authority']
}

/** Exact verified asset identity used by a PromptIR field mapping. */
export interface DirectorStageCardBinding extends ImagoMethodJsonObject {
  readonly kind: 'director_method_card'
  readonly stage_id: 'D' | 'E'
  readonly repo_id: string
  readonly repository_commit: string
  readonly path: string
  readonly sha256: string
  readonly provenance_sha256: string
}

const packageAssetsRoot = join(dirname(fileURLToPath(import.meta.url)), '../assets')

/**
 * List admitted cards for one stage; unknown stages return an explicit empty set.
 * @param stageId - candidate IMAGO stage identifier.
 * @returns guidance-only card identities registered for that stage.
 */
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

/**
 * Serve one card's inert content after provenance verification; fails closed.
 * @param repoId - admitted director asset repository ID.
 * @param path - admitted card path within the repository snapshot.
 * @returns provenance-verified text and its content SHA-256.
 */
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

/**
 * Bind one D/E method card only after verifying its stage registration and asset provenance.
 * @param stageId - exact PromptIR-producing stage.
 * @param repoId - admitted director asset repository ID.
 * @param path - admitted method-card path.
 * @returns immutable card, repository, and provenance identities for projection hashing.
 */
export async function loadDirectorStageCardBinding(
  stageId: 'D' | 'E',
  repoId: string,
  path: string,
): Promise<DirectorStageCardBinding> {
  const card = DIRECTOR_STAGE_CARDS.find(item => item.repoId === repoId && item.path === path)
  if (card === undefined || card.kind !== 'method_card' || !card.stageIds.includes(stageId)) {
    throw new Error('director_stage_card_mapping_mismatch')
  }
  const content = await loadDirectorStageCard(repoId, path)
  const entry = directorAssetEntry(repoId)
  return {
    kind: 'director_method_card',
    stage_id: stageId,
    repo_id: repoId,
    repository_commit: entry.commit,
    path,
    sha256: content.contentSha256,
    provenance_sha256: entry.provenanceSha256,
  }
}
