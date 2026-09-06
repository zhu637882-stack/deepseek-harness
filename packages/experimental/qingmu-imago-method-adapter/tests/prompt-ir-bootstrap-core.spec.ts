/** Opt-in keyless cross-repository proof using the actual configured Core subprocess, never a Provider. */
import { createHash, createHmac } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createImagoMethodHandler } from '../src/index.ts'
import type { ImagoPromptIrBootstrapMethodResponse } from '../src/types.ts'

const coreRoot = process.env.QINGMU_CORE_TEST_ROOT
const key = 'keyless-first-draft-test-attestation-32bytes'
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(name => `${JSON.stringify(name)}:${canonical(object[name])}`).join(',')}}`
}
const sha = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const context = {
  schema: 'jason.qingmu-prompt-ir-bootstrap-context.v1', projectId: 'project-1', episodeId: 'episode-1',
  storyboard: { id: 'revision-1', version: 1, sourceHash: 'a'.repeat(64) },
  frame: { id: 'frame-1', contentSha256: 'b'.repeat(64), title: '雨夜', narrative: '建立空间', visual: '空旷月台',
    action: '缓慢前推', durationSec: 4, dialogueLineIds: [], sceneId: 'scene-1' },
  requiredReferences: [{ role: 'scene', elementKind: 'scene', elementId: 'scene-1', profileRevision: 1,
    profileSnapshotSha256: 'c'.repeat(64), assetId: 'asset-1', assetSha256: 'd'.repeat(64), materializedSha256: 'd'.repeat(64),
    selectionIdentity: 'selection-1', sourceRevisionId: 'source-1', qualificationCheckId: 'check-1',
    qualificationKind: 'local_file_integrity', rightsRecordSha256: 'e'.repeat(64) }],
}
afterEach(() => { vi.unstubAllEnvs() })

it.skipIf(!coreRoot)('compiles authored text and reconstructs exact old/new selection projections with actual Core', async () => {
  vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', key)
  const handler = createImagoMethodHandler({ coreRoot: coreRoot! })
  const request = { context, contextSnapshotSha256: sha(context) }
  async function compile(extra: object = {}) {
    const result = await handler('promptIrBootstrapMethod', { ...request, ...extra }, new AbortController().signal)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('actual compiler failed')
    return result.value as ImagoPromptIrBootstrapMethodResponse
  }
  const legacy = await compile()
  const editable = { ...(legacy.projection.candidate.editableProjection as Record<string, string>), imageGenPrompt: '摄影机在副驾后方，只见驾驶员侧背。' }
  const authored = await compile({ editableProjection: editable })
  expect(authored.projection.candidate.editableProjection).toEqual(editable)
  expect(authored.projection.candidate.subjectArray).toEqual(legacy.projection.candidate.subjectArray)
  expect(authored.projectionSha256).not.toBe(legacy.projectionSha256)
  function challenge(value: ImagoPromptIrBootstrapMethodResponse) {
    const unsigned = { schema: 'jason.qingmu-prompt-ir-bootstrap-selection-challenge.v1', actorId: 'test',
      projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'revision-1', frameId: 'frame-1',
      draftPromptIrId: 'draft-1', draftVersion: 1, draftContentSha256: 'f'.repeat(64), contextSnapshotSha256: sha(context),
      methodProjectionSha256: value.projectionSha256, methodSha256: value.methodAttestation.methodSha256,
      candidateSha256: value.projection.candidate_sha256, nonce: '1'.repeat(64),
      issuedAtUnix: Math.floor(Date.now() / 1000), expiresAtUnix: Math.floor(Date.now() / 1000) + 300 }
    return { ...unsigned, signature: createHmac('sha256', key).update('qingmu.prompt-ir-bootstrap.selection-challenge.v1\0')
      .update(canonical(unsigned)).digest('hex') }
  }
  for (const value of [legacy, authored]) {
    const selected = await compile({ editableProjection: value.projection.candidate.editableProjection,
      selectionChallenge: challenge(value) })
    expect(selected.projectionSha256).toBe(value.projectionSha256)
    expect(selected.selectionFreshnessAttestation?.projectionSha256).toBe(value.projectionSha256)
  }
  expect(await handler('promptIrBootstrapMethod', { ...request, editableProjection: editable, selectionChallenge: challenge(legacy) }, new AbortController().signal))
    .toMatchObject({ ok: false })
}, 15000)
