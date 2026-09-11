import { useEffect, useRef, useState } from 'react'
import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import { usePrivateReferencePreview, type PrivateReferencePreviewPort } from './usePrivateReferencePreview.ts'
import css from './ProjectLibrary.module.css'

/** Project covers reuse owner-scoped reference reads; a preview never adopts an asset. */
export type ProjectCoverPort = Pick<QingmuYimengPort, 'referenceVideoAssets'> & PrivateReferencePreviewPort

/** Show an existing project image when no official cover has been selected. */
export function PrivateProjectCover({ projectId, name, port }: {
  readonly projectId: string
  readonly name: string
  readonly port: ProjectCoverPort
}) {
  const target = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [asset, setAsset] = useState<ReferenceVideoAsset>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100px' })
    if (target.current) observer.observe(target.current)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    void port.referenceVideoAssets({ projectId, page: 1 }, controller.signal).then((result) => {
      if (!controller.signal.aborted && result.projectId === projectId) {
        setAsset(result.items.find(item => item.mediaType === 'reference_image'))
      }
    }).catch(() => { /* Unavailable previews retain the project title card. */ })
    return () => { controller.abort() }
  }, [port, projectId, visible])
  const { preview } = usePrivateReferencePreview(projectId, asset, port, 0)
  const url = asset?.browserUrl || preview?.url
  return <div ref={target} className={css.cover} aria-hidden="true">
    {url && !failed ? <><img src={url} alt="" loading="lazy" onError={() => { setFailed(true) }} />
      <small className={css.previewLabel}>素材预览</small></>
      : <><span>{name.slice(0, 2)}</span><small>青木作品</small></>}
  </div>
}
