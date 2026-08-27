/** Synthetic sealed records for boundary tests; current Core is exercised separately. */
import { createHash } from 'node:crypto'
import type {
  YimengStageSource, YimengStageSourceDefinition, YimengStageSourceResult, YimengStageSourcesResponse,
} from '../src/types.ts'

export const STAGE_SOURCE_IDS = { projectId: 'source-project', episodeId: 'source-episode' }
export const STAGE_SOURCE_FLAGS = { stageArtifactCreated: false, stageApprovalGranted: false, lockActivated: false,
  planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const

export function sourceCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sourceCanonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${sourceCanonical(item)}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('fixture must be JSON')
  return encoded
}
export function sourceSha(value: unknown): string { return createHash('sha256').update(sourceCanonical(value), 'utf8').digest('hex') }
export function stageSource(): YimengStageSource {
  return { schema: 'jason.qingmu-stage-source.v1', ...STAGE_SOURCE_IDS, sourceType: 'episode_script',
    sourceId: STAGE_SOURCE_IDS.episodeId, revision: 3, contentSha256: 'a'.repeat(64) }
}
export function stageSourceDefinition(): YimengStageSourceDefinition {
  return { id: 'IMAGO-V6-A1S-SOURCE', version: 'fixture-current', stageId: 'A1S', roleId: 'A1S', scope: 'global',
    contractSha256: 'b'.repeat(64), artifactKind: 'SCREENPLAY_PACKAGE', canonicalOutput: 'inputs/screenplay-package.json',
    sourceType: 'episode_script', sourceUsage: 'source_reference_only', operation: 'bind_existing_episode_script_source',
    stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 }
}
export function stageSourceResult(source = stageSource(), revision = 1): YimengStageSourceResult {
  const binding = { schema: 'jason.qingmu-stage-source-binding.v1' as const, projectId: source.projectId, episodeId: source.episodeId,
    changeSetId: 'source-change', stageId: 'A1S' as const, source, subjectSnapshotSha256: sourceSha(source),
    definition: stageSourceDefinition(), methodProjectionSha256: 'c'.repeat(64), rulesSha256: 'd'.repeat(64),
    bindingRevision: revision, actorId: 'fixture-owner', authSessionId: 'e'.repeat(64), createdAt: '2026-08-28T01:00:00.123456+00:00',
    ...STAGE_SOURCE_FLAGS }
  return { schema: 'jason.qingmu-stage-source-result.v1', binding, bindingSha256: sourceSha(binding),
    receiptId: 'source-receipt', outboxEventId: 'source-event' }
}
export function stageSourcesFeed(
  source: YimengStageSource | null = stageSource(), latest: YimengStageSourceResult | null = null,
): YimengStageSourcesResponse {
  const ids = source ?? latest?.binding ?? STAGE_SOURCE_IDS
  return { schema: 'jason.qingmu-stage-source-feed.v1', projectId: ids.projectId, episodeId: ids.episodeId, stageId: 'A1S', canBind: true,
    source, subjectSnapshotSha256: source === null ? null : sourceSha(source), unavailableReason: source === null ? 'episode_script_missing' : null,
    bindingRevision: latest?.binding.bindingRevision ?? 0, bindingSha256: latest?.bindingSha256 ?? null, latestBinding: latest,
    currentBinding: latest !== null && source !== null && latest.binding.subjectSnapshotSha256 === sourceSha(source) ? latest : null }
}
export function sourceObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('fixture object missing')
  return value as Record<string, unknown>
}
export function mutateSource(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let item = sourceObject(value)
  for (const key of keys.slice(0, -1)) item = sourceObject(item[key])
  const key = keys.at(-1)
  if (key === undefined) throw new Error('fixture path missing')
  if (replacement === undefined) Reflect.deleteProperty(item, key)
  else item[key] = replacement
}
