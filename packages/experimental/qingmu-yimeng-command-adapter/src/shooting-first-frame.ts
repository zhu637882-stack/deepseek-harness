/** Same-origin transport to Writer's existing single-attempt image pipeline. */
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'

/** Register preview, submit and read-only recovery; no retries or authority conversion.
 * @param server Host web server.
 * @param baseUrl Configured Writer base URL.
 * @param fetcher Upstream transport.
 * @returns Route disposer.
 */
export function registerShootingFirstFrame(server: WebServer, baseUrl: string, fetcher: typeof fetch = globalThis.fetch): () => void {
  const routes = { preview: 'shooting-preview', submit: '', state: 'shooting-state', review: '', confirm: '', 'video-state': '', 'video-resume': '' } as const
  const disposers = Object.entries(routes).map(([operation, suffix]) => server.register({
    kind: 'exact', path: `/api/qingmu/shooting-first-frame/${operation}`, handler: async (req, res) => {
      res.setHeader('cache-control', 'private, no-store')
      res.setHeader('content-type', 'application/json; charset=utf-8')
      const end = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)) }
      const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('jason_token='))
      if (!isTrustedApiRequest(req, []) || req.headers.authorization || !cookie) { end(401, { detail: '请恢复青木登录会话' }); return }
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
            if (size > 8192) throw new Error('request_too_large')
            parts.push(bytes)
          }
          const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
          const keys = ['project_id', 'episode_id', 'frame_ids', ...(operation === 'submit' ? ['candidate_request_id', 'shooting_preflight_id', 'shooting_payload_hash'] : operation === 'confirm' ? ['expected_frame_digest', 'idempotency_key'] : operation === 'video-resume' ? ['scene_id', 'task_id'] : operation === 'preview' && value?.candidate_request_id !== undefined ? ['candidate_request_id'] : [])]
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
        const headers = new Headers({ cookie, accept: 'application/json', origin: upstream.origin, 'content-type': 'application/json' })
        const response = await fetcher(upstream, { method: req.method, headers, redirect: 'error', signal: AbortSignal.timeout(60_000), ...(body === undefined ? {} : { body }) })
        const text = await response.text()
        if (Buffer.byteLength(text) > 512 * 1024) throw new Error('response_too_large')
        const result = JSON.parse(text) as { candidate?: { browserUrl?: unknown } }
        if (response.ok && result.candidate) {
          const path = result.candidate.browserUrl
          if (typeof path !== 'string' || !/^\/api\/media\/[A-Za-z0-9_-]+$/.test(path)) throw new Error('invalid_candidate_media')
          result.candidate.browserUrl = new URL(path, upstream.origin).href
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
