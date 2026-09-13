/** Same-origin transport to Writer's existing single-attempt image pipeline. */
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { YimengCommandJsonObject } from './types.ts'

/** Prepare the selected shot's actual image input without submitting a generation.
 * @param value Untrusted native tool input with project, episode, frame and optional working references.
 * @param helpers Existing adapter error factories.
 * @returns The same preview request used by the shooting page, with scope-checked output.
 */
export function prepareShootingFirstFramePreview(value: unknown, helpers: {
  inputError(message: string): Error
  responseError(message: string): Error
}): { path: string; method: 'POST'; body: YimengCommandJsonObject; normalize(value: unknown): unknown } {
  const fail = helpers.inputError
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('first frame preview input required')
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some(key => !['projectId', 'episodeId', 'frameId', 'referenceImages'].includes(key))
    || [raw.projectId, raw.episodeId, raw.frameId].some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) throw fail('first frame preview scope invalid')
  if (raw.referenceImages !== undefined) {
    if (!Array.isArray(raw.referenceImages) || raw.referenceImages.length < 1 || raw.referenceImages.length > 9) throw fail('first frame references require 1..9 images')
    const ids = new Set<string>()
    for (const item of raw.referenceImages) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw fail('first frame reference invalid')
      const ref = item as Record<string, unknown>
      if (Object.keys(ref).sort().join() !== 'assetId,assetSha256,purpose'
        || typeof ref.assetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(ref.assetId)
        || typeof ref.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.assetSha256)
        || typeof ref.purpose !== 'string' || !ref.purpose.trim() || ref.purpose.length > 4000
        || ids.has(ref.assetId)) throw fail('first frame reference identity, SHA or purpose invalid')
      ids.add(ref.assetId)
    }
  }
  const body = { project_id: raw.projectId, episode_id: raw.episodeId, frame_ids: [raw.frameId],
    ...(raw.referenceImages === undefined ? {} : { reference_images: raw.referenceImages }) } as YimengCommandJsonObject
  return { path: '/api/pipeline/first-frames/shooting-preview', method: 'POST', body, normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw helpers.responseError('first frame preview missing')
    const result = value as Record<string, unknown>
    if (result.schema !== 'qingmu.shooting-first-frame-preview.v1' || result.projectId !== raw.projectId
      || result.episodeId !== raw.episodeId || result.frameId !== raw.frameId
      || typeof result.prompt !== 'string' || !result.prompt.trim() || !Array.isArray(result.blockers)
      || [result.preflightId, result.payloadHash].some(sha => typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha))) throw helpers.responseError('first frame preview does not match selected shot')
    return result
  } }
}

/** Register preview, submit and read-only recovery; no retries or authority conversion.
 * @param server Host web server.
 * @param baseUrl Configured Writer base URL.
 * @param fetcher Upstream transport.
 * @param readToken Existing native service credential, never used for human confirmation.
 * @returns Route disposer.
 */
export function registerShootingFirstFrame(
  server: WebServer, baseUrl: string, fetcher: typeof fetch = globalThis.fetch,
  readToken: () => string | undefined = () => undefined,
): () => void {
  const routes = { preview: 'shooting-preview', submit: '', state: 'shooting-state', review: '', confirm: '', 'video-state': '', 'video-resume': '' } as const
  const disposers = Object.entries(routes).map(([operation, suffix]) => server.register({
    kind: 'exact', path: `/api/qingmu/shooting-first-frame/${operation}`, handler: async (req, res) => {
      res.setHeader('cache-control', 'private, no-store')
      res.setHeader('content-type', 'application/json; charset=utf-8')
      const end = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)) }
      if (!isTrustedApiRequest(req, []) || req.headers.authorization !== undefined) { end(401, { detail: '请恢复青木登录会话' }); return }
      const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('jason_token='))
      if (cookie !== undefined && (cookie.length <= 'jason_token='.length || cookie.length > 8192 || /[\r\n]/.test(cookie))) {
        end(401, { detail: '请恢复青木登录会话' }); return
      }
      if (operation === 'confirm' && cookie === undefined) {
        end(401, { detail: '请登录本人账户后确认当前分镜', code: 'storyboard_human_session_required' }); return
      }
      const read = operation === 'state' || operation === 'review' || operation === 'video-state'
      if (req.method !== (read ? 'GET' : 'POST')) { end(405, { detail: 'method_not_allowed' }); return }
      const incoming = new URL(req.url ?? '', 'http://localhost')
      const upstream = new URL(`/api/pipeline/first-frames${suffix ? `/${suffix}` : ''}`, baseUrl)
      if (read) {
        const keys = ['project_id', 'episode_id', 'frame_id', ...(operation === 'state' ? ['request_id'] : operation === 'video-state' ? ['scene_id'] : [])]
        if ([...incoming.searchParams.keys()].length !== keys.length || keys.some(key => incoming.searchParams.getAll(key).length !== 1
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(incoming.searchParams.get(key) ?? ''))) { end(400, { detail: 'invalid_scope' }); return }
        if (operation === 'review') upstream.pathname = `/api/episodes/${incoming.searchParams.get('episode_id')}/storyboard-frames/${incoming.searchParams.get('frame_id')}/human-review`
        else if (operation === 'video-state') upstream.pathname = `/api/qingmu/projects/${incoming.searchParams.get('project_id')}/episodes/${incoming.searchParams.get('episode_id')}/scenes/${incoming.searchParams.get('scene_id')}/shots/${incoming.searchParams.get('frame_id')}/production-takes/execution`
        else upstream.search = incoming.search
      } else if (incoming.search) { end(400, { detail: 'unexpected_query' }); return }
      let body: string | undefined
      try {
        if (!read) {
          const parts: Buffer[] = []; let size = 0
          for await (const chunk of req) {
            const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length
            if (size > 64 * 1024) throw new Error('request_too_large')
            parts.push(bytes)
          }
          const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
          const keys = ['project_id', 'episode_id', 'frame_ids', ...(operation === 'preview' && value?.reference_images !== undefined ? ['reference_images'] : []), ...(operation === 'submit' ? ['candidate_request_id', 'shooting_preflight_id', 'shooting_payload_hash'] : operation === 'confirm' ? ['expected_frame_digest', 'idempotency_key'] : operation === 'video-resume' ? ['scene_id', 'task_id'] : operation === 'preview' && value?.candidate_request_id !== undefined ? ['candidate_request_id'] : [])]
          if (!value || Object.keys(value).sort().join() !== keys.sort().join() || !Array.isArray(value.frame_ids) || value.frame_ids.length !== 1) throw new Error('invalid_request')
          if (operation === 'video-resume') {
            if ([value.project_id, value.episode_id, value.frame_ids[0], value.scene_id, value.task_id].some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) throw new Error('invalid_execution_scope')
            upstream.pathname = `/api/qingmu/projects/${String(value.project_id)}/episodes/${String(value.episode_id)}/scenes/${String(value.scene_id)}/shots/${String(value.frame_ids[0])}/production-takes/execution`
            body = JSON.stringify({ taskId: value.task_id })
          } else if (operation === 'confirm') {
            const ids = [value.project_id, value.episode_id, value.frame_ids[0]]
            if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))
              || typeof value.expected_frame_digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.expected_frame_digest)
              || typeof value.idempotency_key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotency_key)) throw new Error('invalid_review_binding')
            upstream.pathname = `/api/episodes/${value.episode_id}/storyboard-frames/${value.frame_ids[0]}/human-review`
            upstream.search = '?single_frame=true'
            body = JSON.stringify({ expected_frame_digest: value.expected_frame_digest, idempotency_key: value.idempotency_key, decision: 'accepted' })
          } else body = JSON.stringify(value)
        }
        const headers = new Headers({ accept: 'application/json', origin: upstream.origin, 'content-type': 'application/json' })
        let serviceToken: string | undefined
        if (cookie !== undefined) headers.set('cookie', cookie)
        else {
          serviceToken = readToken()?.trim()
          if (!serviceToken || /[\r\n]/.test(serviceToken)) { end(401, { detail: '请恢复青木登录会话' }); return }
          headers.set('authorization', `Bearer ${serviceToken}`)
        }
        const response = await fetcher(upstream, { method: req.method, headers, redirect: 'error', signal: AbortSignal.timeout(60_000), ...(body === undefined ? {} : { body }) })
        const text = await response.text()
        if (Buffer.byteLength(text) > 512 * 1024) throw new Error('response_too_large')
        if (serviceToken && text.includes(serviceToken)) throw new Error('credential_in_response')
        const result = JSON.parse(text) as { candidate?: { browserUrl?: unknown } }
        if (response.ok && result.candidate) {
          const path = result.candidate.browserUrl
          if (typeof path !== 'string' || !path.startsWith('/api/media/')) throw new Error('invalid_candidate_media')
          const media = new URL(path, upstream.origin)
          if (media.origin !== upstream.origin || !/^\/api\/media\/[A-Za-z0-9_-]+$/.test(media.pathname)
            || media.username || media.password || media.hash
            || [...media.searchParams.keys()].sort().join(',') !== 'expires,signature'
            || !/^\d+$/.test(media.searchParams.get('expires') ?? '')
            || !/^[a-f0-9]{64}$/.test(media.searchParams.get('signature') ?? '')) throw new Error('invalid_candidate_media')
          result.candidate.browserUrl = media.href
        }
        end(response.status, result)
      } catch {
        // A submit timeout is indeterminate. The client may only GET its original request ID.
        end(502, { detail: operation === 'submit' ? '提交结果待核对；只读取原任务，不重新提交' : '当前请求未完成' })
      }
    },
  }))
  return () => { for (const dispose of disposers) dispose() }
}
