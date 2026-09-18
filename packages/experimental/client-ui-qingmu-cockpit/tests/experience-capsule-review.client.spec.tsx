// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExperienceCapsuleReview } from '../src/client/ExperienceCapsuleReview.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const REVIEW_PATH = '/api/qingmu/experience-capsule-review'
const PROMOTE_PATH = `${REVIEW_PATH}/promote`

const readyState = {
  schema: 'qingmu-experience-capsule-review-v1', renderLimit: 12, injectedCount: 1,
  queue: [
    { id: 'SELF-01', symptom: '镜头穿帮', rule: '先核对场景陈设', submittedAt: '2026-09-17T10:00:00Z', alreadyApproved: false },
    { id: 'SELF-02', symptom: '', rule: '静音锁写双唇闭合', alreadyApproved: true },
  ],
  active: [
    { id: 'EXP-01', symptom: '旧症状', rule: '既有规则', stages: ['storyboard'], injected: true },
    { id: 'SELF-00', symptom: '', rule: '全阶段规则', stages: [], injected: false },
  ],
}

const emptyState = { schema: 'qingmu-experience-capsule-review-v1', renderLimit: 12, injectedCount: 0, queue: [], active: [] }

/** How the double answers one route: a JSON reply, a rejection, or a promise the test owns. */
type Outcome =
  | { readonly kind: 'json'; readonly body: unknown; readonly status: number }
  | { readonly kind: 'throw'; readonly cause: unknown }
  | { readonly kind: 'defer' }

interface Deferred { readonly resolve: (response: Response) => void; readonly reject: (cause: unknown) => void }

const json = (body: unknown, status = 200): Outcome => ({ kind: 'json', body, status })

interface Harness {
  /** Bodies the panel POSTed to the promote route. */
  readonly sent: Record<string, unknown>[]
  /** Every URL the panel requested, in order. */
  readonly paths: string[]
  /** Deferred replies the test resolves itself, in request order. */
  readonly pending: Deferred[]
  readonly review: (outcome: Outcome) => void
  readonly promote: (outcome: Outcome) => void
}

/** The URL the panel actually requested. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

async function respond(outcome: Outcome, pending: Deferred[]): Promise<Response> {
  if (outcome.kind === 'throw') throw outcome.cause
  if (outcome.kind === 'defer') {
    return new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }) })
  }
  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status, headers: { 'content-type': 'application/json' },
  })
}

/** Fetch double: the panel sends no identity field, relying on same-origin credentials. */
function harness(review: Outcome = json(readyState), promote: Outcome = json(readyState)): Harness {
  const sent: Record<string, unknown>[] = []
  const paths: string[] = []
  const pending: Deferred[] = []
  let reviewOutcome = review
  let promoteOutcome = promote
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = requestUrl(input)
    paths.push(url)
    expect(init?.credentials).toBe('same-origin')
    expect(init?.cache).toBe('no-store')
    if (url === PROMOTE_PATH) {
      expect(init?.method).toBe('POST')
      sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as Record<string, unknown>)
      return respond(promoteOutcome, pending)
    }
    if (url === REVIEW_PATH) {
      expect(init?.method).toBe('GET')
      return respond(reviewOutcome, pending)
    }
    throw new Error(`unexpected request ${url}`)
  }))
  return {
    sent, paths, pending,
    review: (outcome: Outcome) => { reviewOutcome = outcome },
    promote: (outcome: Outcome) => { promoteOutcome = outcome },
  }
}

function panel() {
  return render(<ExperienceCapsuleReview t={key => zh[key]} />)
}

const tick = (id: string): void => { fireEvent.click(screen.getByLabelText(`勾选胶囊 ${id}`)) }
const promoteButton = () => screen.getByRole('button', { name: '晋升所选胶囊' })
const refreshButton = () => screen.getByRole('button', { name: '重新读取' })

async function loaded(): Promise<void> {
  await screen.findByText(/先核对场景陈设/)
}

async function alertText(): Promise<string> {
  const alert = await screen.findByRole('alert')
  return alert.textContent ?? ''
}

describe('experience capsule review panel', () => {
  it('reads the queue on mount and promotes nothing on its own', async () => {
    const gate = harness()
    panel()
    await loaded()
    expect(gate.paths).toEqual([REVIEW_PATH])
    expect(gate.sent).toEqual([])
    expect(screen.getByText(/待审: 2 · 已入库: 2 · 本次注入: 1\/12/)).toBeTruthy()
    expect(screen.getAllByText(/2026-09-17T10:00:00Z/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/已入库（同 id 再晋升会覆盖旧条）/).length).toBeGreaterThan(0)
    // A queued capsule is an explicit tick, so the decision button starts inert.
    expect(promoteButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('EXP-01')).toBeTruthy()
    expect(screen.getByText('SELF-00')).toBeTruthy()
    expect(screen.getByText(/生效阶段: storyboard · 在注入范围内/)).toBeTruthy()
    expect(screen.getByText(/生效阶段: 全部阶段 · 超出注入上限，本次不注入/)).toBeTruthy()
    expect(screen.getAllByText(/全阶段规则/).length).toBeGreaterThan(0)
  })

  it('keeps the promote button inert until a tick exists and drops it again on untick', async () => {
    harness()
    panel()
    await loaded()
    tick('SELF-01')
    expect(promoteButton().hasAttribute('disabled')).toBe(false)
    tick('SELF-01')
    expect(promoteButton().hasAttribute('disabled')).toBe(true)
  })

  it('renders nothing at all on a deployment without a capsule runtime root', async () => {
    harness(json({ code: 'experience_capsule_review_runtime_root_unconfigured' }, 503))
    const { container } = panel()
    await waitFor(() => { expect(container.firstChild).toBeNull() })
    expect(screen.queryByRole('button', { name: '晋升所选胶囊' })).toBeNull()
  })

  it('names an empty queue and an empty store instead of guessing', async () => {
    harness(json(emptyState))
    panel()
    await screen.findByText('当前没有待审胶囊。')
    expect(screen.getByText('已入库胶囊为空。')).toBeTruthy()
    expect(promoteButton().hasAttribute('disabled')).toBe(true)
  })

  it('reports a store failure under its own code and an unusable body under the panel default', async () => {
    const gate = harness(json({ code: 'experience_capsule_review_store_unavailable' }, 503))
    panel()
    expect(await alertText()).toContain('experience_capsule_review_store_unavailable')
    gate.review(json({ schema: 'something-else' }))
    fireEvent.click(refreshButton())
    expect(await alertText()).toContain('experience_capsule_review_state_failed')
  })

  it('refuses to read a field off a body that is not a JSON object', async () => {
    const gate = harness(json([]))
    panel()
    expect(await alertText()).toContain('invalid response')
    gate.review(json(null))
    fireEvent.click(refreshButton())
    expect(await alertText()).toContain('invalid response')
    gate.review(json(3))
    fireEvent.click(refreshButton())
    expect(await alertText()).toContain('invalid response')
  })

  it('reports a read that never answered without blaming a field', async () => {
    harness({ kind: 'throw', cause: 'network down' })
    panel()
    expect(await alertText()).toContain('network down')
  })

  it('says it is reading until the first reply lands', async () => {
    harness({ kind: 'defer' })
    panel()
    await screen.findByText('正在读取胶囊队列…')
  })

  it('promotes only what the operator ticked and echoes the receipt', async () => {
    const gate = harness(json(readyState), json({
      ...readyState, promoted: ['SELF-01'],
      queue: [readyState.queue[1]!], active: [{ id: 'SELF-01', symptom: '镜头穿帮', rule: '先核对场景陈设', stages: [], injected: true }, ...readyState.active],
    }))
    panel()
    await loaded()
    tick('SELF-01')
    tick('SELF-02')
    tick('SELF-02')
    fireEvent.click(promoteButton())
    await screen.findByText(/已晋升: SELF-01/)
    expect(gate.sent).toEqual([{ confirmed: true, ids: ['SELF-01'] }])
    // The decision is spent: nothing stays ticked, so a second promotion needs a new tick.
    expect(promoteButton().hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/2026-09-17T10:00:00Z/)).toBeNull()
  })

  it('clears the ticks and re-reads the queue when the promotion is refused', async () => {
    const gate = harness(json(readyState), json({ code: 'experience_capsule_review_ids_not_queued', ids: ['SELF-01'] }, 409))
    panel()
    await loaded()
    tick('SELF-01')
    fireEvent.click(promoteButton())
    expect(await alertText()).toContain('experience_capsule_review_ids_not_queued')
    expect(gate.paths).toEqual([REVIEW_PATH, PROMOTE_PATH, REVIEW_PATH])
    expect(promoteButton().hasAttribute('disabled')).toBe(true)
  })

  it('keeps the promotion refusal when the recovery read fails too', async () => {
    const gate = harness(json(readyState), json({}, 500))
    panel()
    await loaded()
    tick('SELF-01')
    fireEvent.click(promoteButton())
    expect(await alertText()).toContain('experience_capsule_review_promote_failed')
    // The reload is attempted and its own failure is swallowed, not shown.
    gate.review(json({ code: 'experience_capsule_review_store_unavailable' }, 503))
    fireEvent.click(refreshButton())
    expect(await alertText()).toContain('experience_capsule_review_store_unavailable')
  })

  it('reports a promotion whose request never answered', async () => {
    harness(json(readyState), { kind: 'throw', cause: 'upstream gone' })
    panel()
    await loaded()
    tick('SELF-01')
    fireEvent.click(promoteButton())
    expect(await alertText()).toContain('upstream gone')
    // The outcome is unknown, so the tick survives: promoting the same id again
    // supersedes that capsule, and dropping the tick would hide a pending decision.
    expect(promoteButton().hasAttribute('disabled')).toBe(false)
  })

  it('reports a forbidden promotion without offering a login', async () => {
    const gate = harness(json(readyState), json({ code: 'experience_capsule_review_forbidden' }, 403))
    panel()
    await loaded()
    tick('SELF-01')
    fireEvent.click(promoteButton())
    expect(await alertText()).toContain('experience_capsule_review_forbidden')
    // The fence is request-shape only, so a 403 is reported, never signed into: no
    // credential form appears, the refusal re-reads the queue and spends the tick.
    expect(screen.queryByLabelText('本人账号')).toBeNull()
    expect(screen.queryByLabelText('本人密码')).toBeNull()
    expect(gate.paths).toEqual([REVIEW_PATH, PROMOTE_PATH, REVIEW_PATH])
    expect(promoteButton().hasAttribute('disabled')).toBe(true)
  })

  it('re-reads on demand and clears the error a stale reply caused', async () => {
    const gate = harness(json({ code: 'experience_capsule_review_store_unavailable' }, 503))
    panel()
    expect(await alertText()).toContain('experience_capsule_review_store_unavailable')
    gate.review(json(readyState))
    fireEvent.click(refreshButton())
    await loaded()
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('reports a re-read that never answered', async () => {
    const gate = harness(json(readyState))
    panel()
    await loaded()
    gate.review({ kind: 'throw', cause: 'read timed out' })
    fireEvent.click(refreshButton())
    expect(await alertText()).toContain('read timed out')
  })

  it('drops a stale read instead of overwriting the newer one', async () => {
    const gate = harness({ kind: 'defer' })
    panel()
    // The mount read is still in flight when a refresh supersedes it.
    await waitFor(() => { expect(gate.pending).toHaveLength(1) })
    gate.review(json(readyState))
    fireEvent.click(refreshButton())
    await waitFor(() => { expect(gate.paths.filter(path => path === REVIEW_PATH)).toHaveLength(2) })
    await loaded()
    gate.pending[0]!.resolve(new Response(JSON.stringify({
      ...readyState, queue: [{ id: 'STALE-01', symptom: '过期队列', rule: '不该出现', alreadyApproved: false }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await waitFor(() => { expect(screen.queryByText(/不该出现/)).toBeNull() })
    expect(screen.getAllByText(/先核对场景陈设/).length).toBeGreaterThan(0)
  })

  it('drops an in-flight read when the panel goes away', async () => {
    const gate = harness({ kind: 'defer' })
    const { unmount } = panel()
    await waitFor(() => { expect(gate.pending).toHaveLength(1) })
    unmount()
    gate.pending[0]!.reject(new Error('aborted read'))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })
})
