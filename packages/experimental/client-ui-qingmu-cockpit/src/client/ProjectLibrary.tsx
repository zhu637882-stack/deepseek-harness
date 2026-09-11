import { useRef, useState } from 'react'
import type { YimengJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ProjectUpdateRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import css from './ProjectLibrary.module.css'
import { PrivateProjectCover, type ProjectCoverPort } from './PrivateProjectCover.tsx'
import { ProjectCopyPanel, type ProjectCopyPort } from './ProjectCopyPanel.tsx'
import type { ProjectCopyResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const text = (value: unknown): string => typeof value === 'string' ? value : ''

function ProjectCover({ url, name }: { readonly url: string; readonly name: string }) {
  const [failed, setFailed] = useState(false)
  const usable = /^(https?:\/\/|\/[^/])/.test(url)
  return <div className={css.cover} aria-hidden="true">
    {usable && !failed ? <img src={url} alt="" loading="lazy" onError={() => { setFailed(true) }} />
      : <><span>{name.slice(0, 2)}</span><small>青木作品</small></>}
  </div>
}

/** The saved project index stays independent of the currently open episode. */
export function ProjectLibrary({ projects, currentProjectId, loading, onOpen, onCreate, onUpdate, mediaPort, copyPort, onCopied }: {
  readonly projects: readonly YimengJsonObject[]
  readonly currentProjectId: string
  readonly loading: boolean
  readonly onOpen: (id: string) => void
  readonly onCreate: () => void
  readonly onUpdate: (request: ProjectUpdateRequest) => Promise<void>
  readonly mediaPort?: ProjectCoverPort
  readonly copyPort?: ProjectCopyPort
  readonly onCopied?: (result: ProjectCopyResult) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active')
  const [editing, setEditing] = useState(''), [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const lock = useRef(false)
  const [copying, setCopying] = useState<{ id: string; name: string }>()
  const matches = projects.filter(project => (filter === 'all' || (text(project.status) === 'archived') === (filter === 'archived'))
    && `${text(project.name)} ${text(project.theme)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const save = async (request: ProjectUpdateRequest) => {
    if (lock.current) return
    lock.current = true; setSaving(request.projectId); setError(''); setNotice('')
    try {
      await onUpdate(request)
      setEditing('')
      setNotice(request.status === 'archived' ? '项目已归档，素材保留，可在“已归档”中恢复。'
        : request.status === 'active' ? '项目已恢复，可在“创作中”继续。' : '项目名称已保存。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请刷新后重试。') }
    finally { lock.current = false; setSaving('') }
  }
  return <section className={css.library} aria-label="项目库">
    <header className={css.heading}><div><p>QINGMU STUDIO</p><h1>我的项目</h1><span>每部作品独立保存。创建新作品后，随时回到这里继续之前的项目。</span></div>
      <button type="button" className={css.create} onClick={onCreate} disabled={loading}>＋ 新建作品</button></header>
    <div className={css.toolbar}><label>搜索项目<input type="search" value={search} placeholder="输入项目名称或故事关键词" onChange={(event) => { setSearch(event.target.value) }} /></label><span>{loading ? '正在读取项目…' : `共 ${projects.length} 个项目`}</span></div>
    <div className={css.filters} role="group" aria-label="项目状态">{([['active', '创作中'], ['archived', '已归档'], ['all', '全部']] as const).map(([id, label]) =>
      <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setEditing('') }} disabled={saving !== ''}>{label}</button>)}</div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className={css.error}>{error}</p>}
    {copying && copyPort && onCopied && <ProjectCopyPanel key={copying.id} projectId={copying.id} name={copying.name} port={copyPort}
      onClose={() => { setCopying(undefined) }} onCreated={onCopied} />}
    {!loading && matches.length === 0 && <p role="status">{search ? '没有找到匹配的项目。换个关键词试试。' : filter === 'archived' ? '暂无归档项目。' : projects.length ? '这里暂时没有项目，可查看“全部”或新建作品。' : '从第一个故事开始，建立你的作品库。'}</p>}
    <div className={css.grid}>{matches.map((project) => {
      const id = text(project.id)
      const name = text(project.name) || text(project.title) || '未命名项目'
      const archived = text(project.status) === 'archived'
      const editable = project.canEdit !== false
      const created = text(project.created_at)
      const date = created ? new Date(created) : undefined
      const dateText = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : ''
      return <article key={id} className={css.card} aria-label={name}>
        {mediaPort && !text(project.thumbnail_url)
          ? <PrivateProjectCover projectId={id} name={name} port={mediaPort} />
          : <ProjectCover key={text(project.thumbnail_url)} url={text(project.thumbnail_url)} name={name} />}
        <div className={css.details}><div className={css.title}><h2>{name}</h2>
          {archived ? <span>已归档</span> : id === currentProjectId && <span>当前项目</span>}</div>
        <p>{text(project.theme) || '进入项目查看故事、角色、分镜与视频。'}</p>
        <footer><small>{dateText ? `创建于 ${dateText}` : '已保存项目'}</small><button type="button" disabled={loading || !id} onClick={() => { onOpen(id) }} aria-label={`继续创作 ${name}`}>继续创作 →</button></footer>
        {editable && <div className={css.actions}>
          {editing === id ? <form onSubmit={(event) => {
            event.preventDefault()
            if (nameDraft.trim() && Array.from(nameDraft.trim()).length <= 200) void save({ projectId: id, name: nameDraft })
          }}>
            <label>项目名称<input autoFocus value={nameDraft} disabled={saving !== ''} onChange={(event) => {
              setNameDraft(event.target.value)
            }}
            onKeyDown={(event) => { if (event.key === 'Escape' && !saving) setEditing('') }} /></label>
            <button type="submit" disabled={loading || saving !== '' || !nameDraft.trim() || Array.from(nameDraft.trim()).length > 200}>{saving === id ? '保存中…' : '保存名称'}</button>
            <button type="button" disabled={saving !== ''} onClick={() => { setEditing('') }}>取消</button>
          </form> : <><button type="button" disabled={loading || saving !== ''} aria-label={`重命名 ${name}`} onClick={() => { setEditing(id); setNameDraft(name); setError('') }}>重命名</button>
            {copyPort && onCopied && <button type="button" disabled={loading || saving !== '' || copying !== undefined} aria-label={`复制 ${name}`} onClick={() => { setCopying({ id, name }) }}>复制项目</button>}
            <button type="button" disabled={loading || saving !== ''} aria-label={`${archived ? '恢复' : '归档'} ${name}`} onClick={() => { void save({ projectId: id, status: archived ? 'active' : 'archived' }) }}>{saving === id ? '保存中…' : archived ? '恢复项目' : '归档'}</button></>}
        </div>}
        </div>
      </article>
    })}</div>
  </section>
}
