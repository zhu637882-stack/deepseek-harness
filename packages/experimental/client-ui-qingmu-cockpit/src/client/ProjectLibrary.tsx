import { useState } from 'react'
import type { YimengJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import css from './ProjectLibrary.module.css'

const text = (value: unknown): string => typeof value === 'string' ? value : ''

/** The saved project index stays independent of the currently open episode. */
export function ProjectLibrary({ projects, currentProjectId, loading, onOpen, onCreate }: {
  readonly projects: readonly YimengJsonObject[]
  readonly currentProjectId: string
  readonly loading: boolean
  readonly onOpen: (id: string) => void
  readonly onCreate: () => void
}) {
  const [search, setSearch] = useState('')
  const matches = projects.filter(project => `${text(project.name)} ${text(project.theme)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <section className={css.library} aria-label="项目库">
    <header className={css.heading}><div><p>QINGMU STUDIO</p><h1>我的项目</h1><span>每部作品独立保存。创建新作品后，随时回到这里继续之前的项目。</span></div>
      <button type="button" className={css.create} onClick={onCreate} disabled={loading}>＋ 新建作品</button></header>
    <div className={css.toolbar}><label>搜索项目<input type="search" value={search} placeholder="输入项目名称或故事关键词" onChange={(event) => { setSearch(event.target.value) }} /></label><span>{loading ? '正在读取项目…' : `共 ${projects.length} 个项目`}</span></div>
    {!loading && matches.length === 0 && <p role="status">{search ? '没有找到匹配的项目。换个关键词试试。' : '从第一个故事开始，建立你的作品库。'}</p>}
    <div className={css.grid}>{matches.map((project) => {
      const id = text(project.id)
      const name = text(project.name) || text(project.title) || '未命名项目'
      const created = text(project.created_at)
      const date = created ? new Date(created) : undefined
      const dateText = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : ''
      return <article key={id} className={css.card} aria-label={name}>
        <div className={css.cover} aria-hidden="true"><span>{name.slice(0, 2)}</span><small>青木作品</small></div>
        <div className={css.details}><div className={css.title}><h2>{name}</h2>{id === currentProjectId && <span>当前项目</span>}</div>
          <p>{text(project.theme) || '进入项目查看故事、角色、分镜与视频。'}</p>
          <footer><small>{dateText ? `创建于 ${dateText}` : '已保存项目'}</small><button type="button" disabled={loading || !id} onClick={() => { onOpen(id) }} aria-label={`继续创作 ${name}`}>继续创作 →</button></footer>
        </div>
      </article>
    })}</div>
  </section>
}
