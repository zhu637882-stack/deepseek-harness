// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ImagoWorksetItem } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { ImagoWorksetMethodResponse, QingmuImagoMethodPort, YimengWorkflowProjection } from '../src/client/contracts.ts'
import { WorksetRecommendation } from '../src/client/WorksetRecommendation.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { unavailableWorksetResponse } from './fixtures/workset-method.client.ts'

const t = (key: QingmuCockpitKey) => zh[key]
const source = (episodeId = 'episode-1') => ({
  schema: 'jason.episode-workflow-projection.v1', projectId: 'project-1', episodeId,
  inputFingerprint: 'fingerprint-1', sourceRevision: { revision: 1 },
  stages: { script: { status: 'complete', canProceed: true, hasData: true } },
}) as unknown as YimengWorkflowProjection

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function adviceResponse(episodeId = 'episode-1'): ImagoWorksetMethodResponse {
  const base = unavailableWorksetResponse('project-1', episodeId)
  const items: readonly ImagoWorksetItem[] = [
    {
      stage_id: 'A0', scope_instance: 'GLOBAL', owner_role: 'A0', status: 'waiting_human',
      blockers: [], prerequisites: { stages: [], locks: [] }, parallel_group: null,
      stable_sort_key: [0, 0, 0, 'GLOBAL'], priority_class: 'human_pending',
      allowed_action: 'review_artifact', contract_sha256: '6'.repeat(64),
    },
    {
      stage_id: 'F', scope_instance: 'LSU-real-fixture', owner_role: 'F', status: 'preflight_ready',
      blockers: [], prerequisites: { stages: [], locks: [] }, parallel_group: 'fixture-parallel',
      stable_sort_key: [2, 0, 21, 'LSU-real-fixture'], priority_class: 'low_cost_preflight',
      allowed_action: 'compile_preflight', contract_sha256: '7'.repeat(64),
    },
  ]
  return {
    ...base,
    projection: {
      ...base.projection,
      work_items: items, legal_work_items: items,
      recommended_order: items.map(({ stage_id, scope_instance }) => ({ stage_id, scope_instance })),
      recommended_item: { stage_id: 'A0', scope_instance: 'GLOBAL', allowed_action: 'review_artifact' },
      availability: { status: 'available', authority_snapshot: 'available', global_scope: 'available', per_lsu_scope: 'available', reason: null },
      blockers: [],
    },
  }
}

function props(port: Pick<QingmuImagoMethodPort, 'worksetMethod'>, projection = source()) {
  return { projectId: 'project-1', episodeId: projection.episodeId, projection, enabled: true, port, t }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('WorksetRecommendation', () => {
  it('requires a selected source before requesting any method', () => {
    const port = { worksetMethod: vi.fn() }
    render(<WorksetRecommendation {...props(port)} projection={undefined} />)
    expect(port.worksetMethod).not.toHaveBeenCalled()
    expect(screen.getByText(zh.recommendedChoose)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.worksetRefresh }).hasAttribute('disabled')).toBe(true)
  })

  it('does not claim to be loading when the parent source is disabled or has failed', () => {
    const port = { worksetMethod: vi.fn() }
    render(<WorksetRecommendation {...props(port)} enabled={false} />)
    expect(port.worksetMethod).not.toHaveBeenCalled()
    expect(screen.queryByText(zh.worksetLoading)).toBeNull()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByRole('button', { name: zh.worksetRefresh }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps legacy business green separate from unavailable stage and LSU authority', async () => {
    const port = { worksetMethod: vi.fn(async () => unavailableWorksetResponse()) }
    render(<WorksetRecommendation {...props(port)} />)
    expect(await screen.findByText(zh.worksetUnavailable)).toBeTruthy()
    expect(port.worksetMethod).toHaveBeenCalledWith({ projectId: 'project-1', episodeId: 'episode-1' }, expect.any(AbortSignal))
    expect(screen.queryByRole('article')).toBeNull()
    fireEvent.click(screen.getByText(`${zh.worksetLegal} · 0`))
    expect(screen.getByText(zh.worksetNoLegal)).toBeTruthy()
    fireEvent.click(screen.getByText(`${zh.worksetDefinitions} · 2`))
    expect(screen.getByText(zh.worksetDefinitionsBoundary)).toBeTruthy()
    expect(screen.getByText('视频任务')).toBeTruthy()
    fireEvent.click(screen.getByText(zh.worksetEvidence))
    expect(screen.getByText('2'.repeat(64))).toBeTruthy()
    expect(screen.getByText('5'.repeat(64))).toBeTruthy()
    expect(screen.getByText(zh.worksetShadowUnavailable)).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('shows one recommendation and expands the complete ordered legal set without running it', async () => {
    const port = { worksetMethod: vi.fn(async () => adviceResponse()) }
    render(<WorksetRecommendation {...props(port)} />)
    const recommended = await screen.findByRole('article', { name: zh.recommended })
    expect(within(recommended).getByRole('heading', { name: '资料确认' })).toBeTruthy()
    expect(within(recommended).getByText(zh.worksetHumanPriority)).toBeTruthy()
    expect(within(recommended).getByText(zh.worksetAdviceOnly)).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.click(screen.getByText(`${zh.worksetLegal} · 2`))
    const legalList = screen.getByRole('list', { name: zh.worksetLegal })
    expect(within(legalList).getAllByRole('listitem').map(item => item.querySelector('h4')?.textContent)).toEqual(['资料确认', '视频任务'])
    expect(screen.getByText('fixture-parallel')).toBeTruthy()
    expect(port.worksetMethod).toHaveBeenCalledTimes(1)
  })

  it('invalidates old advice on a same-fingerprint source refresh and fails closed on error', async () => {
    const next = deferred<ImagoWorksetMethodResponse>()
    const port = { worksetMethod: vi.fn().mockResolvedValueOnce(adviceResponse()).mockReturnValueOnce(next.promise) }
    const initial = props(port)
    const view = render(<WorksetRecommendation {...initial} />)
    await screen.findByRole('article', { name: zh.recommended })
    view.rerender(<WorksetRecommendation {...initial} projection={{ ...initial.projection, stages: {} }} />)
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText(zh.worksetLoading)).toBeTruthy()
    await act(async () => { next.reject(new Error('read-only source unavailable')) })
    expect(screen.getByRole('alert').textContent).toContain('read-only source unavailable')
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('aborts a previous scope and ignores a late reply even when the transport ignores abort', async () => {
    const old = deferred<ImagoWorksetMethodResponse>()
    const port = { worksetMethod: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(unavailableWorksetResponse('project-1', 'episode-2')) }
    const view = render(<WorksetRecommendation {...props(port)} />)
    const oldSignal = port.worksetMethod.mock.calls[0]?.[1] as AbortSignal
    view.rerender(<WorksetRecommendation {...props(port, source('episode-2'))} />)
    await screen.findByText(zh.worksetUnavailable)
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { old.resolve(adviceResponse()) })
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText(zh.worksetUnavailable)).toBeTruthy()
  })

  it('clears the previous recommendation immediately during manual recompilation', async () => {
    const next = deferred<ImagoWorksetMethodResponse>()
    const port = { worksetMethod: vi.fn().mockResolvedValueOnce(adviceResponse()).mockReturnValueOnce(next.promise) }
    render(<WorksetRecommendation {...props(port)} />)
    await screen.findByRole('article', { name: zh.recommended })
    fireEvent.click(screen.getByRole('button', { name: zh.worksetRefresh }))
    expect(screen.queryByRole('article')).toBeNull()
    await act(async () => { next.resolve(unavailableWorksetResponse()) })
    expect(screen.getByText(zh.worksetUnavailable)).toBeTruthy()
  })

  it.each(['wrong_scope', 'activation', 'orphan_recommendation', 'unavailable_with_items'] as const)(
    'rejects %s without showing prior or fabricated advice', async (kind) => {
      const valid = adviceResponse()
      const invalid = {
        ...valid,
        projection: {
          ...valid.projection,
          ...(kind === 'wrong_scope' ? { subject: { ...valid.projection.subject, episode_id: 'another-episode' } } : {}),
          ...(kind === 'activation' ? { formal_activation_allowed: true } : {}),
          ...(kind === 'orphan_recommendation' ? { recommended_item: { stage_id: 'UNKNOWN', scope_instance: 'GLOBAL', allowed_action: 'prepare_work_order' } } : {}),
          ...(kind === 'unavailable_with_items' ? { availability: unavailableWorksetResponse().projection.availability } : {}),
        },
      } as ImagoWorksetMethodResponse
      render(<WorksetRecommendation {...props({ worksetMethod: vi.fn(async () => invalid) })} />)
      expect((await screen.findByRole('alert')).textContent).toContain(zh.worksetInvalid)
      expect(screen.queryByRole('article')).toBeNull()
    },
  )

  it('cancels on close and compiles fresh evidence on reopening', async () => {
    const pending = deferred<ImagoWorksetMethodResponse>()
    const port = { worksetMethod: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(unavailableWorksetResponse()) }
    const initial = props(port)
    const view = render(<WorksetRecommendation {...initial} />)
    const signal = port.worksetMethod.mock.calls[0]?.[1] as AbortSignal
    view.rerender(<WorksetRecommendation {...initial} enabled={false} />)
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText(zh.worksetLoading)).toBeNull()
    await act(async () => { pending.resolve(adviceResponse()) })
    expect(screen.queryByRole('article')).toBeNull()
    view.rerender(<WorksetRecommendation {...initial} />)
    await waitFor(() => { expect(port.worksetMethod).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(zh.worksetUnavailable)).toBeTruthy()
  })
})
