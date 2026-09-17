// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoryboardHumanReview } from '../src/client/StoryboardHumanReview.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const STATE_PATH = '/api/qingmu/storyboard-human-review/state'
const ACCEPT_PATH = '/api/qingmu/storyboard-human-review/accept'
const LOGIN_PATH = '/api/qingmu/editorial-handoff/human-session'
const SET_DIGEST = 'c'.repeat(64)

function frame(frameId: string, frameNo: number, title: string, digest: string) {
  return {
    frameId, frameNo, title, durationSec: 4.5, imagePromptCn: '夜雨中的旧车站',
    frameDigest: digest, accepted: false, status: 'pending',
    blockerCode: 'storyboard_human_review_required', review: null,
  }
}

const pendingState = {
  version: 'storyboard-preproduction-human-review-v1',
  projectId: 'project-review', episodeId: 'episode-review', storyboardRevision: 7,
  frameSetDigest: SET_DIGEST, totalCount: 2, acceptedCount: 0, accepted: false,
  blockerCode: 'storyboard_human_review_required',
  items: [frame('frame-1', 1, '雨夜旧车站', 'a'.repeat(64)), frame('frame-2', 2, '站台尽头', 'b'.repeat(64))],
  providerCalls: 0, budgetMutation: false,
}

const acceptedState = {
  ...pendingState,
  acceptedCount: 2, accepted: true, blockerCode: null,
  items: pendingState.items.map(item => ({ ...item, accepted: true, status: 'accepted', blockerCode: null })),
}

/** The URL the panel actually requested. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** The request body, which the panel always sends as a JSON string. */
function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

interface Harness {
  readonly sent: Record<string, unknown>[]
  readonly accept: (body: unknown, status?: number) => void
  readonly state: (body: unknown, status?: number) => void
}

/** Cookie-only fetch double: the state route stays 401 until the human logs in. */
function harness(): Harness {
  let authenticated = false
  let stateBody: unknown = pendingState
  let stateStatus = 200
  let acceptBody: unknown = {
    acceptedCount: 2, totalCount: 2, frameSetDigest: SET_DIGEST,
    items: [{ frameId: 'frame-1', checkId: 'check-1' }, { frameId: 'frame-2', checkId: 'check-2' }],
    providerCalls: 0, budgetMutation: false,
  }
  let acceptStatus = 200
  const sent: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = requestUrl(input)
    if (url === LOGIN_PATH) { authenticated = true; return Response.json({ authenticated: true }) }
    if (url.startsWith(STATE_PATH)) {
      return authenticated
        ? new Response(JSON.stringify(stateBody), { status: stateStatus, headers: { 'content-type': 'application/json' } })
        : Response.json({ code: 'storyboard_human_review_relogin_required' }, { status: 401 })
    }
    if (url.startsWith(ACCEPT_PATH)) {
      expect(init?.credentials).toBe('same-origin')
      expect(init?.cache).toBe('no-store')
      sent.push(JSON.parse(requestBody(init)) as Record<string, unknown>)
      return new Response(JSON.stringify(acceptBody), {
        status: acceptStatus, headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected request ${url}`)
  }))
  return {
    sent,
    accept: (body: unknown, status = 200) => { acceptBody = body; acceptStatus = status },
    state: (body: unknown, status = 200) => { stateBody = body; stateStatus = status },
  }
}

/** Distinct UUIDs, so a reused key can only come from the component holding onto it. */
function uuids(): void {
  let index = 0
  vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-00000000000${String(++index)}` })
}

function panel() {
  return render(<StoryboardHumanReview episodeId="episode-review" t={key => zh[key]} />)
}

async function signIn(): Promise<void> {
  await screen.findByLabelText('本人账号')
  fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
  fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
  await screen.findByText('整集待人工接受')
}

function fillDecision(note = '确认整集当前分镜'): void {
  fireEvent.change(screen.getByLabelText('整集接受备注（必填）'), { target: { value: note } })
  const tick = screen.getByLabelText(/我已逐帧核对当前分镜帧集合/) as HTMLInputElement
  if (!tick.checked) fireEvent.click(tick)
}

const acceptButton = () => screen.getByRole('button', { name: '接受整集当前分镜' })

describe('storyboard pre-production human review panel', () => {
  it('logs in cookie-only, shows the exact gate facts, and accepts only on an explicit decision', async () => {
    const gate = harness()
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    // No decision was made yet, so nothing may have been submitted.
    expect(gate.sent).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '接受整集当前分镜' })).toBeNull()
    await signIn()

    expect(screen.getByText('已接受帧数: 0/2')).toBeTruthy()
    expect(screen.getByText('当前阻塞码: storyboard_human_review_required')).toBeTruthy()
    expect(screen.getByText('分镜修订号: 7')).toBeTruthy()
    expect(screen.getByText(new RegExp(SET_DIGEST))).toBeTruthy()
    expect(screen.getAllByText(/雨夜旧车站/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/站台尽头/).length).toBeGreaterThan(0)
    expect(screen.getByText(new RegExp('a'.repeat(64)))).toBeTruthy()
    expect(screen.getByText(new RegExp('b'.repeat(64)))).toBeTruthy()
    expect(screen.getAllByText(/时长（秒） 4.5/).length).toBe(2)

    // Neither a tick alone nor a note alone is a decision.
    const tick = screen.getByLabelText(/我已逐帧核对当前分镜帧集合/)
    const noteInput = screen.getByLabelText('整集接受备注（必填）')
    expect(acceptButton().hasAttribute('disabled')).toBe(true)
    fireEvent.click(tick)
    expect(acceptButton().hasAttribute('disabled')).toBe(true)
    fireEvent.change(noteInput, { target: { value: '确认整集' } })
    expect(acceptButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(tick)
    expect(acceptButton().hasAttribute('disabled')).toBe(true)
    fireEvent.click(tick)
    fireEvent.change(noteInput, { target: { value: '   ' } })
    expect(acceptButton().hasAttribute('disabled')).toBe(true)
    expect(gate.sent).toHaveLength(0)

    // Once the receipt lands, the Writer's own re-read reports the gate cleared.
    gate.state(acceptedState)
    fillDecision('确认整集当前分镜与提示词')
    expect(acceptButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(acceptButton())
    await waitFor(() => { expect(gate.sent).toHaveLength(1) })
    expect(gate.sent[0]).toEqual({
      expectedFrameSetDigest: SET_DIGEST,
      items: [
        { frameId: 'frame-1', expectedFrameDigest: 'a'.repeat(64) },
        { frameId: 'frame-2', expectedFrameDigest: 'b'.repeat(64) },
      ],
      note: '确认整集当前分镜与提示词',
      idempotencyKey: 'storyboard-review-00000000-0000-4000-8000-000000000001',
      confirmed: true,
    })
    expect(JSON.stringify(gate.sent[0])).not.toMatch(/actor|reviewer|person|session|authorization|cookie/iu)
    await screen.findByText('整集已接受')
    expect(screen.queryByRole('button', { name: '接受整集当前分镜' })).toBeNull()
  })

  it('re-reads a state that reports the gate already passed and offers no accept control', async () => {
    const gate = harness()
    gate.state(acceptedState)
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText('整集已接受')
    expect(screen.getByText('已接受帧数: 2/2')).toBeTruthy()
    expect(screen.getByText('当前阻塞码: —')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '接受整集当前分镜' })).toBeNull()
    expect(screen.queryByLabelText('整集接受备注（必填）')).toBeNull()
    expect(gate.sent).toHaveLength(0)
  })

  it('says an episode without storyboard frames has nothing to review yet', async () => {
    const gate = harness()
    gate.state({ ...pendingState, totalCount: 0, items: [], frameSetDigest: 'd'.repeat(64) })
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText(/当前剧集还没有可审核的分镜帧/)
    expect(screen.getByText('整集待人工接受')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '接受整集当前分镜' })).toBeNull()
    expect(gate.sent).toHaveLength(0)
  })

  it('returns an expired decision session to explicit login without retrying the acceptance', async () => {
    const gate = harness()
    gate.accept({ code: 'storyboard_human_review_relogin_required' }, 401)
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText('整集待人工接受')
    fillDecision()
    fireEvent.click(acceptButton())
    await screen.findByText(/分镜预生产人工审核未完成: storyboard_human_review_relogin_required/)
    expect(gate.sent).toHaveLength(1)
    // The login form is back, and the decision must be typed and ticked again.
    await screen.findByLabelText('本人密码')
    expect(screen.queryByRole('button', { name: '接受整集当前分镜' })).toBeNull()
  })

  it('keeps one idempotency key across an unknown outcome and never accepts implicitly', async () => {
    const gate = harness()
    gate.accept({ code: 'storyboard_human_review_accept_unknown' }, 502)
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText('整集待人工接受')
    fillDecision('确认整集当前分镜')
    fireEvent.click(acceptButton())
    await screen.findByText(/结果未知/)
    expect(gate.sent).toHaveLength(1)

    // The tick was dropped, so the panel cannot resubmit on its own.
    expect(acceptButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('整集接受备注（必填）').value)
      .toBe('确认整集当前分镜')
    fireEvent.click(screen.getByLabelText(/我已逐帧核对当前分镜帧集合/))
    fireEvent.click(acceptButton())
    await waitFor(() => { expect(gate.sent).toHaveLength(2) })
    expect(gate.sent[1]?.idempotencyKey).toBe(gate.sent[0]?.idempotencyKey)
    expect(gate.sent[1]?.note).toBe(gate.sent[0]?.note)

    // Once the state confirms the acceptance, the control disappears.
    gate.accept({
      acceptedCount: 2, totalCount: 2, frameSetDigest: SET_DIGEST,
      items: [{ frameId: 'frame-1', checkId: 'check-1' }, { frameId: 'frame-2', checkId: 'check-2' }],
      providerCalls: 0, budgetMutation: false,
    })
    gate.state(acceptedState)
    fireEvent.click(screen.getByLabelText(/我已逐帧核对当前分镜帧集合/))
    fireEvent.click(acceptButton())
    await screen.findByText('整集已接受')
    expect(gate.sent).toHaveLength(3)
    expect(gate.sent[2]?.idempotencyKey).toBe(gate.sent[0]?.idempotencyKey)
  })

  it('explains a definitive Writer rejection and starts the next attempt from a fresh key', async () => {
    const gate = harness()
    gate.accept({
      code: 'storyboard_human_review_accept_rejected',
      reason: 'storyboard_human_review_frame_set_changed',
    }, 409)
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText('整集待人工接受')
    fillDecision()
    fireEvent.click(acceptButton())
    await screen.findByText(/分镜帧集合已变化：请重新读取后再逐帧核对。/)
    expect(screen.getByText(/storyboard_human_review_accept_rejected/)).toBeTruthy()
    expect(gate.sent).toHaveLength(1)
    // The note and the tick were cleared, so a retry is a fresh human decision.
    expect(screen.getByLabelText('整集接受备注（必填）').value).toBe('')
    expect(acceptButton().hasAttribute('disabled')).toBe(true)

    gate.accept({
      acceptedCount: 2, totalCount: 2, frameSetDigest: SET_DIGEST,
      items: [{ frameId: 'frame-1', checkId: 'check-1' }, { frameId: 'frame-2', checkId: 'check-2' }],
      providerCalls: 0, budgetMutation: false,
    })
    gate.state(acceptedState)
    fillDecision('重新核对后确认整集')
    fireEvent.click(acceptButton())
    await waitFor(() => { expect(gate.sent).toHaveLength(2) })
    expect(gate.sent[1]?.idempotencyKey).not.toBe(gate.sent[0]?.idempotencyKey)
    await screen.findByText('整集已接受')
  })

  it('shows an unexplained rejection code verbatim instead of inventing a reason', async () => {
    const gate = harness()
    gate.accept({
      code: 'storyboard_human_review_accept_rejected',
      reason: 'storyboard_human_review_some_future_code',
    }, 409)
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText('整集待人工接受')
    fillDecision()
    fireEvent.click(acceptButton())
    await screen.findByText(/storyboard_human_review_some_future_code/)
    expect(gate.sent).toHaveLength(1)
  })

  it('surfaces a state the bridge refused rather than showing an empty gate as passable', async () => {
    const gate = harness()
    gate.state({ code: 'storyboard_human_review_state_invalid' }, 409)
    uuids()
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText(/分镜预生产人工审核未完成: storyboard_human_review_state_invalid/)
    expect(screen.queryByRole('button', { name: '接受整集当前分镜' })).toBeNull()
    expect(gate.sent).toHaveLength(0)
  })

  it('reports a failed login without exposing the credential', async () => {
    uuids()
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      if (url === LOGIN_PATH) return Response.json({ code: 'login_failed' }, { status: 401 })
      if (url.startsWith(STATE_PATH)) {
        return Response.json({ code: 'storyboard_human_review_relogin_required' }, { status: 401 })
      }
      throw new Error(`unexpected request ${url}`)
    }))
    panel()
    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText(/分镜预生产人工审核未完成: storyboard_human_review_login_failed/)
    expect(screen.queryByText(/hunter2/)).toBeNull()
  })
})
