/** Saved project metadata operations; never creates media or changes creative settings. */
import type { YimengCommandJsonObject } from './types.ts'

/** Edit only the supplied fields of an existing project. */
export interface ProjectUpdateRequest {
  readonly projectId: string
  readonly name?: string
  readonly status?: 'active' | 'archived'
}

/** Prepare the existing owner-checked project update route.
 * @param value - Browser input, limited to display name and archive state.
 * @param helpers - Adapter error factories.
 * @returns Request and a project-scoped response parser.
 */
export function prepareProjectUpdate(value: unknown, helpers: {
  inputError: (message: string) => Error
  responseError: (message: string) => Error
}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw helpers.inputError('项目修改无效')
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some(key => !['projectId', 'name', 'status'].includes(key))
    || typeof raw.projectId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(raw.projectId)) throw helpers.inputError('项目标识无效')
  const projectId = raw.projectId
  const body: { name?: string; status?: 'active' | 'archived' } = {}
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || !raw.name.trim() || Array.from(raw.name.trim()).length > 200) throw helpers.inputError('项目名称需要 1—200 个字符')
    body.name = raw.name.trim()
  }
  if (raw.status !== undefined) {
    if (raw.status !== 'active' && raw.status !== 'archived') throw helpers.inputError('项目状态无效')
    body.status = raw.status
  }
  if (!Object.keys(body).length) throw helpers.inputError('尚未修改项目')
  return {
    path: `/api/projects/${encodeURIComponent(projectId)}`,
    body,
    normalize: (response: unknown): YimengCommandJsonObject => {
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw helpers.responseError('项目保存结果无效')
      const saved = response as YimengCommandJsonObject
      if (saved.id !== projectId || typeof saved.name !== 'string' || typeof saved.status !== 'string'
        || (body.name !== undefined && saved.name !== body.name)
        || (body.status !== undefined && saved.status !== body.status)) throw helpers.responseError('项目保存结果不一致，请刷新核对')
      return saved
    },
  }
}
