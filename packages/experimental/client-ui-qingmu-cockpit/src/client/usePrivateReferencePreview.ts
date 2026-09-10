import { useEffect, useState } from 'react'
import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'

/** These ports only read byte-bound local references for scoped image previews or explicit audio playback. */
export type PrivateReferencePreviewPort = Pick<QingmuYimengPort, 'readLocalReferenceCandidateContent'>
  & Partial<Pick<QingmuYimengPort, 'readLocalVoiceCandidateContent'>>

/** One shared private-preview lifecycle for the library and shot reference desk. */
export function usePrivateReferencePreview(projectId: string, asset: ReferenceVideoAsset | undefined,
  port: PrivateReferencePreviewPort, retry: number) {
  const [state, setState] = useState<{ identity: string; url?: string; failed?: boolean }>()
  const identity = asset === undefined ? '' : `${projectId}:${asset.assetId}:${asset.assetSha256}`
  const available = asset?.browserUrl === '' && (asset.localReferenceScope !== undefined || asset.localVoiceScope !== undefined)
  useEffect(() => {
    setState(undefined)
    if (!available) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    const load = async () => {
      try {
        const base = { projectId, assetId: asset.assetId, expectedSha256: asset.assetSha256 }
        const result = asset.mediaType === 'reference_audio' && asset.localVoiceScope !== undefined
          ? await port.readLocalVoiceCandidateContent?.({ ...base, elementKind: 'actor', targetId: asset.localVoiceScope.targetId }, controller.signal)
          : asset.localReferenceScope !== undefined
            ? await port.readLocalReferenceCandidateContent({ ...base, ...asset.localReferenceScope }, controller.signal)
            : undefined
        if (controller.signal.aborted) return
        if (result === undefined) throw new Error('private_reference_unavailable')
        if (asset.mediaType === 'reference_audio') {
          const binary = atob(result.contentBase64)
          const bytes = Uint8Array.from(binary, value => value.charCodeAt(0))
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
          setState({ identity, url: objectUrl })
        } else setState({ identity, url: `data:${result.mimeType};base64,${result.contentBase64}` })
      } catch {
        if (!controller.signal.aborted) setState({ identity, failed: true })
      }
    }
    void load()
    return () => { controller.abort(); if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl) }
  }, [asset?.assetId, asset?.assetSha256, asset?.browserUrl, asset?.mediaType,
    asset?.localReferenceScope?.elementKind, asset?.localReferenceScope?.targetId, asset?.localVoiceScope?.targetId,
    available, identity, port, projectId, retry])
  return { available, preview: state?.identity === identity ? state : undefined }
}
