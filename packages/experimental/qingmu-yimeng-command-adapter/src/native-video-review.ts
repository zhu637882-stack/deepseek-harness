import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { jsonUpstream, type FirstFrameSelectionCommandDependencies } from './first-frame-selection.ts'

/** Register candidate review submission and read-only recovery under the authenticated local Host. */
export function registerNativeVideoReview(webServer: WebServer, dependencies: FirstFrameSelectionCommandDependencies): () => void {
  return webServer.register({ kind: 'exact', path: '/api/qingmu/native-video-review', handler: async (req, res) => {
    const reply = (status: number, value: unknown): void => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(value))
    }
    const params = new URL(req.url ?? '', 'http://127.0.0.1').searchParams
    const keys = ['episodeId', 'frameId', 'assetId', 'sha256']
    const ids = keys.slice(0, 3).map(key => params.get(key) ?? '')
    const digest = params.get('sha256') ?? ''
    if (!['GET', 'POST'].includes(req.method ?? '') || !isTrustedApiRequest(req, [])
      || req.headers.authorization !== undefined || [...params.keys()].some(key => !keys.includes(key))
      || keys.some(key => params.getAll(key).length !== 1)
      || ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(id)) || !/^[a-f0-9]{64}$/u.test(digest)) {
      reply(400, { code: 'native_video_review_request_invalid' }); return
    }
    const [episode, frame, asset] = ids as [string, string, string]
    const upstream = new URL(`/api/episodes/${encodeURIComponent(episode)}/frames/${encodeURIComponent(frame)}/native-video-reviews`, dependencies.baseUrl)
    const write = req.method === 'POST'
    if (!write) { upstream.searchParams.set('asset_id', asset); upstream.searchParams.set('expected_sha256', digest) }
    const result = await jsonUpstream(dependencies, req, upstream, write
      ? { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ materialized_asset_id: asset, expected_video_sha256: digest }) }
      : { method: 'GET' }, write)
    if (result === undefined) { reply(502, { code: 'native_video_review_response_unavailable' }); return }
    if (!result.response.ok) { reply(result.response.status, { code: 'native_video_review_failed' }); return }
    reply(200, result.value)
  } })
}
