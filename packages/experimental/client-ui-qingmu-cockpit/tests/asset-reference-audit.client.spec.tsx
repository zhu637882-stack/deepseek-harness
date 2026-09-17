// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetReferenceAudit } from '../src/client/AssetReferenceAudit.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const QUOTE_PATH = '/api/qingmu/asset-reference-audit/quote'
const START_PATH = '/api/qingmu/asset-reference-audit/start'
const LOGIN_PATH = '/api/qingmu/editorial-handoff/human-session'
const SOURCE_LOCK = 'a'.repeat(64)
const CALL_PLAN = 'b'.repeat(64)
const CONFIRMATION = '确认对当前1张候选图执行正式画面质检；预计¥0.2500，本批封顶¥0.2750。'

const readyQuote = {
  schema: 'asset-reference-audit-preflight-v1', quoteReady: true, projectId: 'project-audit',
  episodeId: 'episode-audit', targetStage: 'asset_reference_audit',
  phaseLabel: '候选参考图正式质检', auditMode: 'new_candidates', imageRegeneration: false,
  manifest: [{
    assetId: 'asset-scene-1', assetSha256: 'c'.repeat(64), ownerType: 'scene', ownerId: 'scene-1',
    role: 'scene_reference', label: '御书房', auditMode: 'new_candidates', originalCheckId: null,
    rubricSha256: 'd'.repeat(64), imageRegeneration: false, capability: 'vision.audit',
    routeKey: 'b4_5.consistency', provider: 'dashscope', model: 'qwen3.7-plus-2026-05-26',
    estimatedCny: 0.25, pricingVerified: true, quoteAllowed: true,
    requestHash: 'e'.repeat(64), idempotencyKey: `asset-audit:${'e'.repeat(64)}`,
  }],
  callCount: 1, estimatedCny: 0.25, authorizationCapCny: 0.275,
  sourceLockHash: SOURCE_LOCK, callPlanHash: CALL_PLAN,
  expiresAt: '2026-09-18T12:00:00+00:00', confirmationText: CONFIRMATION,
  validationErrors: [], readOnly: true, providerCalls: 0, taskMutation: false,
  budgetMutation: false, preflightId: 'preflight-1',
}

const blockedQuote = {
  ...readyQuote, quoteReady: false, manifest: [], callCount: 0, estimatedCny: 0,
  authorizationCapCny: 0, validationErrors: ['asset-scene-1:public_provider_media_url_missing'],
}

/** The URL the panel actually requested. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

interface Harness {
  readonly sent: Record<string, unknown>[]
  readonly paths: string[]
  readonly quote: (body: unknown, status?: number) => void
  readonly start: (body: unknown, status?: number) => void
}

/** Cookie-only fetch double: both audit routes stay 401 until the human logs in. */
function harness(): Harness {
  let authenticated = true
  let quoteBody: unknown = readyQuote
  let quoteStatus = 200
  let startBody: unknown = {
    accepted: true,
    task: { id: 'task-1', local_status: 'queued', capability: 'workflow.asset_reference_batch' },
  }
  let startStatus = 200
  const sent: Record<string, unknown>[] = []
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = requestUrl(input)
    paths.push(url)
    if (url === LOGIN_PATH) { authenticated = true; return Response.json({ authenticated: true }) }
    if (url.startsWith(QUOTE_PATH) || url.startsWith(START_PATH)) {
      expect(init?.credentials).toBe('same-origin')
      expect(init?.cache).toBe('no-store')
      if (!authenticated) {
        return Response.json({ code: 'asset_reference_audit_relogin_required' }, { status: 401 })
      }
      const body = url.startsWith(QUOTE_PATH) ? quoteBody : startBody
      const status = url.startsWith(QUOTE_PATH) ? quoteStatus : startStatus
      sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as Record<string, unknown>)
      return new Response(JSON.stringify(body), {
        status, headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected request ${url}`)
  }))
  return {
    sent,
    paths,
    quote: (body: unknown, status = 200) => { quoteBody = body; quoteStatus = status },
    start: (body: unknown, status = 200) => { startBody = body; startStatus = status },
  }
}

function panel(episodeId = 'episode-audit') {
  return render(<AssetReferenceAudit projectId="project-audit" episodeId={episodeId} t={key => zh[key]} />)
}

const quoteButton = () => screen.getByRole('button', { name: '取报价（免费）' })
const startButton = () => screen.getByRole('button', { name: '开始付费质检' })

async function getQuote(): Promise<void> {
  fireEvent.click(quoteButton())
  await screen.findByText(/报价成立/)
}

function tick(): void {
  fireEvent.click(screen.getByLabelText(/我已逐张看过上面的清单/))
}

describe('asset reference audit panel', () => {
  it('requests nothing until the operator asks for a quote', () => {
    const gate = harness()
    panel()
    expect(gate.paths).toEqual([])
    expect(screen.queryByRole('button', { name: '开始付费质检' })).toBeNull()
  })

  it('quotes the whole episode and shows the price the operator is about to authorize', async () => {
    const gate = harness()
    panel()
    await getQuote()
    expect(gate.paths[0]).toBe(`${QUOTE_PATH}?projectId=project-audit&episodeId=episode-audit`)
    expect(gate.sent[0]).toEqual({ auditMode: 'new_candidates', assetIds: [] })
    expect(screen.getAllByText(/¥0\.2500/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/¥0\.2750/).length).toBeGreaterThan(0)
    expect(screen.getByText(/从未质检/)).toBeTruthy()
    expect(startButton().hasAttribute('disabled')).toBe(true)
  })

  it('starts only after the tick and echoes the Writer confirmation text verbatim', async () => {
    const gate = harness()
    panel()
    await getQuote()
    tick()
    fireEvent.click(startButton())
    const receipt = await screen.findByText(/task-1/)
    expect(receipt.textContent).toContain('已入队批次任务')
    expect(gate.sent[1]).toEqual({
      confirmed: true, preflightId: 'preflight-1', sourceLockHash: SOURCE_LOCK,
      callPlanHash: CALL_PLAN, confirmationText: CONFIRMATION,
      auditMode: 'new_candidates', assetIds: [],
    })
    // The consumed quote is gone, so the panel cannot start a second batch on its own.
    expect(screen.queryByRole('button', { name: '开始付费质检' })).toBeNull()
  })

  it('drops the tick and the quote when the start outcome is unknown', async () => {
    const gate = harness()
    gate.start({ detail: 'upstream_unavailable' }, 502)
    panel()
    await getQuote()
    tick()
    fireEvent.click(startButton())
    await screen.findByRole('alert')
    expect(screen.getByText(/开始结果未知/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '开始付费质检' })).toBeNull()
    expect(gate.sent.filter(body => body.confirmed === true)).toHaveLength(1)
  })

  it('offers no start when the quote is blocked and shows the per-image reason', async () => {
    harness().quote(blockedQuote)
    panel()
    fireEvent.click(quoteButton())
    await screen.findByText(/报价被阻断/)
    expect(screen.getByText('asset-scene-1:public_provider_media_url_missing')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '开始付费质检' })).toBeNull()
  })

  it('discards a quote when the operator switches audit mode', async () => {
    const gate = harness()
    panel()
    await getQuote()
    fireEvent.click(screen.getByLabelText(/人物视图规则复核/))
    expect(screen.queryByText(/报价成立/)).toBeNull()
    expect(screen.queryByRole('button', { name: '开始付费质检' })).toBeNull()
    fireEvent.click(quoteButton())
    await screen.findByText(/报价成立/)
    expect(gate.sent[1]).toEqual({ auditMode: 'rule_reaudit', assetIds: [] })
  })

  it('explains a Writer rejection with its own reason code', async () => {
    harness().quote(
      { code: 'asset_reference_audit_quote_rejected', reason: 'asset_reference_audit_preflight_expired' }, 409)
    panel()
    fireEvent.click(quoteButton())
    await screen.findByRole('alert')
    expect(screen.getByText(/报价已过期：请重新取报价。/)).toBeTruthy()
  })

  it('signs in on a session expiry and then quotes', async () => {
    const gate = harness()
    gate.quote({ code: 'asset_reference_audit_relogin_required' }, 401)
    panel()
    fireEvent.click(quoteButton())
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await waitForElementToBeRemoved(() => screen.queryByLabelText('本人密码'))
    gate.quote(readyQuote)
    fireEvent.click(quoteButton())
    await screen.findByText(/报价成立/)
    expect(gate.sent.at(-1)).toEqual({ auditMode: 'new_candidates', assetIds: [] })
  })
})
