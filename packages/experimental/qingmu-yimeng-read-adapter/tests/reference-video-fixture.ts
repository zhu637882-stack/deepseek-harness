import { createHash } from 'node:crypto'
import type { ReferenceVideoPreviewRequest } from '../src/reference-video-types.ts'
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const v = value as Record<string, unknown>
  return `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${canonical(v[key])}`).join(',')}}`
}
export const request: ReferenceVideoPreviewRequest = {
  projectId: 'p', frameId: 'f', model: 'wan3.0-video',
  bindings: [
    { bindingToken: 'lin', assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '林予' },
    { bindingToken: 'voice', assetId: 'asset_voice', assetSha256: 'b'.repeat(64), label: '林予音色' },
    { bindingToken: 'cafe', assetId: 'asset_cafe', assetSha256: 'c'.repeat(64), label: '咖啡馆' },
  ],
  promptParts: [{ bindingToken: 'lin' }, { text: '在' }, { bindingToken: 'cafe' }, { text: '说：“图1也是原对白，不能改。”' }],
  parameters: { duration: 8, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false },
}
const body = {
  model: request.model, input: { prompt: '图1在图2说：“图1也是原对白，不能改。”', media: [
    { type: 'reference_image', url: 'https://owned.test/lin' },
    { type: 'reference_audio', url: 'https://owned.test/voice' },
    { type: 'reference_image', url: 'https://owned.test/cafe' },
  ] }, parameters: { ...request.parameters, watermark: false },
}
export const response = {
  schema: 'jason.reference-video-request-preview.v1', projectId: 'p', frameId: 'f', body,
  referenceMapping: request.bindings.map((binding, index) => ({ ...binding, mediaIndex: index,
    mediaType: body.input.media[index]!.type, alias: ['图1', '音频1', '图2'][index] })),
  requestBodySha256: createHash('sha256').update(canonical(body)).digest('hex'), sourceSha256: 'f'.repeat(64),
  readOnly: true, providerCalls: 0, databaseWrites: 0, submissionReady: false, referenceAudioDurationSec: 2,
  remainingChecks: ['source_revalidation_at_dispatch', 'provider_media_reachability', 'generation_authorization'],
}

const { projectId: _projectId, ...savedRequest } = request
export const savedDraft = {
  schema: 'jason.reference-video-draft.v1', projectId: 'p', frameId: 'f', frameSha256: 'e'.repeat(64),
  draft: { revision: 1, frameSha256: 'e'.repeat(64), requestSha256: createHash('sha256').update(canonical(savedRequest)).digest('hex'),
    request: savedRequest, savedAt: '2026-09-09T12:00:00Z' },
  mediaTypes: { lin: 'reference_image', voice: 'reference_audio', cafe: 'reference_image' },
  providerCalls: 0, generationQueued: false,
}
