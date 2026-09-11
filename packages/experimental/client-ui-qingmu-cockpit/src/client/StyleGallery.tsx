import { useState } from 'react'
import type { CreationOptions } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import css from './CreationWorkspace.module.css'

/** The cards and quick selector share the same persisted, authoritative style ID. */
export function StyleGallery({ styles, value, disabled, onChange }: {
  styles: CreationOptions['visualStyles']
  value: string
  disabled: boolean
  onChange: (id: string) => void
}) {
  const [group, setGroup] = useState('all')
  const [query, setQuery] = useState('')
  const groups: readonly (readonly [string, string])[] = [['all', '全部'],
    ...new Map(styles.map(style => [style.group, style.groupLabel])).entries()]
  const filtered = styles.filter(style => (group === 'all' || style.group === group)
    && `${style.label} ${style.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = styles.find(style => style.id === value)
  return <section className={css.styleGallery} aria-label="画风图片墙">
    <label>基础画风<select aria-label="基础画风" value={value} disabled={disabled} onChange={(event) => { onChange(event.target.value) }}>
      <option value="">浏览下方图片，选择画风</option>
      {styles.map(style => <option key={style.id} value={style.id}>{style.groupLabel} · {style.label}</option>)}
    </select></label>
    <div className={css.styleFilters} role="group" aria-label="画风分类">
      {groups.map(([id, label]) => <button key={id} type="button" aria-pressed={group === id}
        onClick={() => { setGroup(id) }}>{label}</button>)}
    </div>
    <label className={css.styleSearch}>搜索画风<input type="search" value={query}
      onChange={(event) => { setQuery(event.target.value) }} placeholder="名称或关键词，如水彩、胶片、3D" /></label>
    <small aria-live="polite">{selected ? `已选：${selected.label}。` : '尚未选择画风。'}当前显示 {filtered.length} / {styles.length} 种</small>
    <div className={css.styleGrid} role="group" aria-label="可选画风">
      {filtered.map(style => <button key={style.id} type="button" className={css.styleCard}
        disabled={disabled} aria-label={`选择画风：${style.label}`} aria-pressed={value === style.id}
        onClick={() => { onChange(style.id) }}>
        {style.previewUrl ? <img src={style.previewUrl} alt={`${style.label} 画风缩略图`} width={160} height={120} loading="lazy" />
          : <span className={css.stylePlaceholder}>暂无预览</span>}
        <span>{style.label}{value === style.id && <strong aria-hidden="true"> ✓</strong>}</span>
      </button>)}
      {filtered.length === 0 && <p>没有匹配的画风，请调整关键词或分类。</p>}
    </div>
    <small>图片展示画风示例。基础画风确定媒介与美术质感；风格包补充全片设计，具体拍法由导演决定。</small>
  </section>
}
