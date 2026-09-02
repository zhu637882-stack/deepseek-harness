// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntityDraftHumanReview } from '../src/client/EntityDraftHumanReview.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const state = {
  schema: 'jason.qingmu-entity-draft-human-review-state.v1',
  identity: { naturalPersonId: 'person-owner', state: 'bound' },
  promptIr: { id: 'prompt-ready', version: 2, contentSha256: '1'.repeat(64), status: 'Ready' },
  drafts: [{
    draftId: 'draft-scene', entityType: 'scene', entityId: 'scene-station',
    canonicalName: '雨夜旧车站', status: 'PendingReview', contentSha256: '2'.repeat(64),
    facts: { elementId: 'scene-station', name: '雨夜旧车站', role: 'scene', atmosphere: '夜雨' },
    reference: { assetId: 'asset-station', profileRevision: 4, profileSnapshotSha256: '4'.repeat(64) },
    referencePackId: 'pack-station',
    referencePackSha256: '3'.repeat(64),
    binding: {
      profileRevision: 4, profileSnapshotSha256: '4'.repeat(64),
      referenceBindingSha256: '5'.repeat(64), canonicalAssetId: 'asset-station',
      referenceAssetIds: ['asset-station'],
    },
    review: null,
  }],
}

describe('entity draft natural-person review panel', () => {
  it('logs in cookie-only, shows exact bindings, and sends no browser identity fields', async () => {
    let authenticated = false
    const sent: Record<string, unknown>[] = []
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/api/qingmu/editorial-handoff/human-session') {
        authenticated = true
        return Response.json({ authenticated: true })
      }
      if (url.startsWith('/api/qingmu/entity-draft-human-review/state')) {
        return authenticated ? Response.json(state) : Response.json({ code: 'relogin' }, { status: 401 })
      }
      if (url.startsWith('/api/qingmu/entity-draft-human-review/decision')) {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Response.json({ schema: 'jason.qingmu-entity-draft-human-review-receipt.v1' })
      }
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' })
    render(<EntityDraftHumanReview projectId="project-review" episodeId="episode-review"
      storyboardRevisionId="storyboard-review" frameId="frame-review" promptIrId="prompt-ready" t={key => zh[key]} />)

    await screen.findByLabelText('本人账号')
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText(/person-owner/)
    expect(screen.getAllByText(/雨夜旧车站/).length).toBeGreaterThan(0)
    expect(screen.getByText(new RegExp('1'.repeat(64)))).toBeTruthy()
    expect(screen.getByText(/夜雨/)).toBeTruthy()
    expect(screen.getAllByText(/asset-station/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByLabelText(/我已核对当前 PromptIR/))
    fireEvent.click(screen.getByRole('button', { name: /接受当前实体草稿.*雨夜旧车站/ }))
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]).toEqual({
      decision: 'accepted', note: null, confirmed: true,
      idempotencyKey: 'entity-review-00000000-0000-4000-8000-000000000001',
    })
    expect(JSON.stringify(sent[0])).not.toMatch(/actor|reviewer|person|session/iu)
  })

  it('returns an expired decision session to explicit login without retrying the decision', async () => {
    let decisionCalls = 0
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/qingmu/entity-draft-human-review/state')) return Response.json(state)
      if (url.startsWith('/api/qingmu/entity-draft-human-review/decision')) {
        decisionCalls += 1
        return Response.json({ code: 'entity_draft_review_relogin_required' }, { status: 401 })
      }
      if (url === '/api/qingmu/editorial-handoff/human-session') return Response.json({ authenticated: true })
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000002' })
    render(<EntityDraftHumanReview projectId="project-review" episodeId="episode-review"
      storyboardRevisionId="storyboard-review" frameId="frame-review" promptIrId="prompt-ready" t={key => zh[key]} />)

    await screen.findAllByText(/雨夜旧车站/)
    fireEvent.click(screen.getByLabelText(/我已核对当前 PromptIR/))
    fireEvent.click(screen.getByRole('button', { name: /接受当前实体草稿.*雨夜旧车站/ }))
    await screen.findByLabelText('本人账号')
    expect(decisionCalls).toBe(1)
    fireEvent.change(screen.getByLabelText('本人账号'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('本人密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人会话' }))
    await screen.findByText(/person-owner/)
    expect(decisionCalls).toBe(1)
    expect(screen.getByRole('button', { name: /接受当前实体草稿.*雨夜旧车站/ }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps confirmation and notes isolated per draft', async () => {
    const firstDraft = state.drafts[0]!
    const secondDraft = {
      ...firstDraft, draftId: 'draft-character', entityType: 'character', entityId: 'character-conductor',
      canonicalName: '老站长', facts: { elementId: 'character-conductor', name: '老站长', role: 'character' },
      reference: { ...firstDraft.reference, assetId: 'asset-conductor' },
      binding: { ...firstDraft.binding, canonicalAssetId: 'asset-conductor', referenceAssetIds: ['asset-conductor'] },
    }
    const sentUrls: string[] = []
    const sentBodies: Record<string, unknown>[] = []
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/qingmu/entity-draft-human-review/state')) {
        return Response.json({ ...state, drafts: [firstDraft, secondDraft] })
      }
      if (url.startsWith('/api/qingmu/entity-draft-human-review/decision')) {
        sentUrls.push(url)
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Response.json({ schema: 'jason.qingmu-entity-draft-human-review-receipt.v1' })
      }
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000003' })
    render(<EntityDraftHumanReview projectId="project-review" episodeId="episode-review"
      storyboardRevisionId="storyboard-review" frameId="frame-review" promptIrId="prompt-ready" t={key => zh[key]} />)

    await screen.findAllByText(/雨夜旧车站/)
    fireEvent.change(screen.getByLabelText(/审核备注.*雨夜旧车站/), { target: { value: '只适用于场景 A' } })
    fireEvent.click(screen.getByLabelText(/我已核对当前 PromptIR.*雨夜旧车站/))
    expect(screen.getByRole('button', { name: /接受当前实体草稿.*雨夜旧车站/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /接受当前实体草稿.*老站长/ }).hasAttribute('disabled')).toBe(true)
    expect((screen.getByLabelText(/审核备注.*老站长/) as HTMLTextAreaElement).value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: /接受当前实体草稿.*雨夜旧车站/ }))
    await waitFor(() => { expect(sentBodies).toHaveLength(1) })
    expect(sentUrls[0]).toContain('draftId=draft-scene')
    expect(sentBodies[0]?.note).toBe('只适用于场景 A')
  })
})
