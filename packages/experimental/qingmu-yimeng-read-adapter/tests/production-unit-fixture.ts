/** Controlled read data; hashes identify fixture content, not a real Core attestation. */
import { createHash } from 'node:crypto'
import type {
  YimengProductionUnitBinding, YimengProductionUnitDefinition, YimengProductionUnitSource,
  YimengProductionUnitsResponse,
} from '../src/types.ts'

export const PRODUCTION_UNIT_REQUEST = { projectId: 'project-unit', episodeId: 'episode-unit' }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (typeof value === 'object' && value !== null) {
    return '{' + Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  }
  const result = JSON.stringify(value)
  if (result === undefined) throw new Error('Fixture value must be JSON')
  return result
}

export function productionUnitSha(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function productionUnitSource(): YimengProductionUnitSource {
  return {
    schema: 'jason.qingmu-production-unit-source.v1', ...PRODUCTION_UNIT_REQUEST,
    groupId: 'group-three', groupNo: 3, title: '  两镜动作衔接\n原文保留。  ',
    groupExecutionPromptSha256: productionUnitSha('Original execution prompt'),
    storyboardRevision: 3,
    shots: [
      { frameId: 'frame-z', frameNo: 7, frameContentSha256: '7'.repeat(64) },
      { frameId: 'frame-1', frameNo: 12, frameContentSha256: 'c'.repeat(64) },
    ],
  }
}

export function productionUnitDefinition(): YimengProductionUnitDefinition {
  return {
    id: 'IMAGO-V6-LSU', version: '6.0.0-draft.2', unitIdPattern: 'LSU[0-9]{2,}', scope: 'per_lsu',
    stages: [
      { stageId: 'B2aVPROD', roleId: 'B2aV', contractSha256: '1'.repeat(64) },
      { stageId: 'D', roleId: 'D', contractSha256: '2'.repeat(64) },
      { stageId: 'DIMG', roleId: 'DIMG', contractSha256: '3'.repeat(64) },
      { stageId: 'E', roleId: 'E', contractSha256: '4'.repeat(64) },
      { stageId: 'F', roleId: 'F', contractSha256: '5'.repeat(64) },
      { stageId: 'LSUQC', roleId: 'LSUQC', contractSha256: '6'.repeat(64) },
    ],
    operation: 'bind_existing_shot_group', planSealingAllowed: false,
    stageApprovalAllowed: false, providerCalls: 0,
  }
}

export function productionUnitBinding(): YimengProductionUnitBinding {
  const source = productionUnitSource()
  return {
    ...PRODUCTION_UNIT_REQUEST, unitId: 'LSU17', groupId: source.groupId, revision: 1, source,
    sourceSnapshotSha256: productionUnitSha(source), methodProjectionSha256: 'a'.repeat(64),
    rulesSha256: 'b'.repeat(64), definition: productionUnitDefinition(), actorId: 'project-owner',
    authSessionId: 'd'.repeat(64), eventId: 'event-unit-17', changeSetId: 'changeset-unit-17',
    createdAt: '2026-08-27T15:30:00+00:00',
  }
}

export function productionUnitsFeed(): YimengProductionUnitsResponse {
  const source = productionUnitSource()
  const binding = productionUnitBinding()
  return {
    schema: 'jason.qingmu-production-unit-feed.v1', ...PRODUCTION_UNIT_REQUEST,
    capabilities: { canBindUnit: true },
    groups: [{
      groupId: source.groupId, subject: source, snapshotSha256: productionUnitSha(source),
      availability: { status: 'available', reason: null },
    }],
    bindings: [{ binding, bindingSha256: productionUnitSha(binding), currentBinding: true }],
    planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false,
  }
}
