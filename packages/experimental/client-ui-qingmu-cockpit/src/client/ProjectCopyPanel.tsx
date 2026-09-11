import { useEffect, useRef, useState } from 'react'
import type { ProjectCopyPreview, ProjectCopyRequest, ProjectCopyResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './ProjectLibrary.module.css'

export type ProjectCopyPort = Pick<QingmuYimengPort, 'previewProjectCopy' | 'copyProject'>

/** A persisted copy intent survives refresh and ambiguous network responses. */
export function ProjectCopyPanel({ projectId, name, port, onClose, onCreated }: {
  readonly projectId: string
  readonly name: string
  readonly port: ProjectCopyPort
  readonly onClose: () => void
  readonly onCreated: (result: ProjectCopyResult) => Promise<void>
}) {
  const storageKey = `qingmu.project-copy.v1:${projectId}`
  const [preview, setPreview] = useState<ProjectCopyPreview>()
  const [draft, setDraft] = useState(`${name} · 副本`)
  const [pending, setPending] = useState<ProjectCopyRequest>()
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved !== null) {
          const request = JSON.parse(saved) as ProjectCopyRequest
          if (request.sourceProjectId !== projectId || typeof request.name !== 'string' || typeof request.idempotencyKey !== 'string'
            || !/^[a-f0-9]{64}$/.test(request.expectedSourceSha256)) throw new Error('复制恢复记录无法读取，请保留该记录。')
          setPending(request); setDraft(request.name); setReady(true)
          return
        }
        const result = await port.previewProjectCopy({ sourceProjectId: projectId }, controller.signal)
        if (!controller.signal.aborted) { setPreview(result); setReady(true) }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法读取项目。') }
    }
    void load()
    return () => { controller.abort() }
  }, [projectId, port, storageKey])
  const submit = async () => {
    if (lock.current || !ready || (!preview && !pending)) return
    lock.current = true; setBusy(true); setError('')
    const request = pending ?? { sourceProjectId: projectId, name: draft.trim(), expectedSourceSha256: preview?.sourceSha256 ?? '', idempotencyKey: `copy:${crypto.randomUUID()}` }
    try {
      localStorage.setItem(storageKey, JSON.stringify(request))
      setPending(request)
      const result = await port.copyProject(request)
      // Keep the intent until navigation completes, so an interrupted refresh
      // recovers the same server receipt rather than creating another project.
      await onCreated(result)
      localStorage.removeItem(storageKey)
      onClose()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (message.includes('project_copy_source_conflict')) {
        // The server checks receipt replay before its source CAS. This precise
        // conflict proves this intent never committed, so refreshing is safe.
        localStorage.removeItem(storageKey); setPending(undefined); setReady(false)
        try { setPreview(await port.previewProjectCopy({ sourceProjectId: projectId })); setReady(true) }
        catch { /* Keep submission disabled until the next explicit reopen. */ }
        setError('原项目已变化，本次未创建副本。已重新读取来源，请检查后再次复制。')
      } else setError(`复制结果尚未确认。再次点击将恢复同一次操作。${message}`)
    }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className={css.copyPanel} aria-label={`复制项目 ${name}`}>
    <h2>复制创作内容</h2>
    <p>沿用已保存的剧本、人物、场景、道具、素材和导演设计，创建可独立修改的新版本。</p>
    <p>剪辑、生成任务和审核记录保留在原项目。素材共用已有文件，复制不会调用生成模型。</p>
    {preview && <p>{preview.counts.episodes ?? 0} 集 · {preview.counts.storyboard_frames ?? 0} 个镜头 · {preview.counts.assets ?? 0} 份素材</p>}
    <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <label>副本名称<input autoFocus value={draft} disabled={busy || pending !== undefined}
        onChange={(event) => { setDraft(event.target.value) }} /></label>
      {pending && <p role="status">已有复制记录待确认，将继续同一次操作。</p>}
      {error && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.actions}>
        <button type="submit" disabled={busy || !ready || !draft.trim() || Array.from(draft.trim()).length > 200}>{busy ? '正在复制…' : pending ? '恢复复制结果' : '创建独立副本'}</button>
        <button type="button" onClick={onClose} disabled={busy}>关闭</button>
      </div>
    </form>
  </section>
}
