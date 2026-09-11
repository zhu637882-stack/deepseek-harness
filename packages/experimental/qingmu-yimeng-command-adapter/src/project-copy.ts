/** Independent creative copies; media bytes retain their original provenance. */
import { createHash } from 'node:crypto'

/** A stable, owner-scoped source snapshot for one copy operation. */
export interface ProjectCopyPreview {
  readonly schema: 'qingmu.project-copy-preview.v1'
  readonly sourceProjectId: string
  readonly sourceName: string
  readonly sourceSha256: string
  readonly counts: Readonly<Record<string, number>>
}
/** Persist this exact request before submitting; reuse it after a lost response. */
export interface ProjectCopyRequest {
  readonly sourceProjectId: string
  readonly name: string
  readonly expectedSourceSha256: string
  readonly idempotencyKey: string
}
/** A copy receipt identifies a new editable project, never a new media generation. */
export interface ProjectCopyResult {
  readonly schema: 'qingmu.project-copy-result.v1'
  readonly sourceProjectId: string
  readonly projectId: string
  readonly name: string
  readonly episodeIds: readonly string[]
  readonly idempotencyKey: string
  readonly requestSha256: string
}

/** Validate copy commands and bind replies to the requested source and intent.
 * @param endpoint - Preview, create, or receipt recovery.
 * @param value - Untrusted browser command.
 * @param helpers - Existing adapter validation and canonical encoding.
 * @returns One HTTP request and its scoped reply parser.
 */
export function prepareProjectCopy(endpoint: string, value: unknown, helpers: {
  inputError: (message: string) => Error
  responseError: (message: string) => Error
  canonicalJson: (value: unknown, field: string) => string
}) {
  const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
  const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v)
  const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  const raw = object(value)
  const preview = endpoint === 'previewProjectCopy', create = endpoint === 'copyProject'
  if (!preview && !create && endpoint !== 'recoverProjectCopy') throw helpers.inputError('复制操作无效')
  const keys = preview ? ['sourceProjectId'] : create ? ['sourceProjectId', 'name', 'expectedSourceSha256', 'idempotencyKey'] : ['idempotencyKey', 'requestSha256']
  if (!raw || Object.keys(raw).length !== keys.length || keys.some(k => !(k in raw))
    || ((preview || create) && !id(raw.sourceProjectId))
    || (!preview && (typeof raw.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(raw.idempotencyKey)))
    || (create && (typeof raw.name !== 'string' || !raw.name.trim() || raw.name !== raw.name.trim() || Array.from(raw.name).length > 200 || /[\u0000-\u001f]/.test(raw.name) || !sha(raw.expectedSourceSha256)))
    || (!create && !preview && !sha(raw.requestSha256))) throw helpers.inputError('项目复制参数无效')
  const requestSha = create ? createHash('sha256').update(helpers.canonicalJson({ sourceProjectId: raw.sourceProjectId, name: raw.name, expectedSourceSha256: raw.expectedSourceSha256 }, 'project copy')).digest('hex') : raw.requestSha256
  return {
    method: create ? 'POST' as const : 'GET' as const,
    path: '/api/qingmu/project-copies' + (preview ? `/preview?sourceProjectId=${encodeURIComponent(String(raw.sourceProjectId))}` : create ? '' : `/receipt?idempotencyKey=${encodeURIComponent(String(raw.idempotencyKey))}&requestSha256=${String(raw.requestSha256)}`),
    body: create ? raw : undefined,
    normalize: (response: unknown): ProjectCopyPreview | ProjectCopyResult => {
      const saved = object(response)
      if (!saved || saved.providerCalls !== 0 || saved.stageStarted !== false || saved.approvalGranted !== false) throw helpers.responseError('复制结果无效')
      if (preview) {
        const counts = object(saved.counts)
        if (saved.schema !== 'qingmu.project-copy-preview.v1' || saved.sourceProjectId !== raw.sourceProjectId
          || typeof saved.sourceName !== 'string' || !sha(saved.sourceSha256) || !counts
          || Object.values(counts).some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)) throw helpers.responseError('项目复制预览不匹配')
        return saved as unknown as ProjectCopyPreview
      }
      if (saved.schema !== 'qingmu.project-copy-result.v1' || saved.idempotencyKey !== raw.idempotencyKey || saved.requestSha256 !== requestSha
        || !id(saved.projectId) || !id(saved.sourceProjectId) || saved.projectId === saved.sourceProjectId
        || typeof saved.name !== 'string' || !Array.isArray(saved.episodeIds) || !saved.episodeIds.every(id)
        || new Set(saved.episodeIds).size !== saved.episodeIds.length
        || (create && (saved.sourceProjectId !== raw.sourceProjectId || saved.name !== raw.name))) throw helpers.responseError('项目复制回执不匹配，请恢复原操作')
      return saved as unknown as ProjectCopyResult
    },
  }
}
