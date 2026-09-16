// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DirectorContextClientPort, RelayStart, RelayState } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import type { YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { RelayBatchPanel } from '../src/client/RelayBatchPanel.tsx'

function relationsFixture(): YimengShotRelationsProjection {
  const sha = (character: string) => character.repeat(64)
  return {
    schema: 'jason.scene-shot-beat-element-relations.v1', projectId: 'project-1', episodeId: 'episode-1',
    storyboardRevision: { episodeRevision: 1, revisionId: 'rev-1', revisionVersion: 1, sourceSha256: sha('a') },
    scenes: [{ sceneId: 'scene-1', name: '场景一', profileRevision: 1, snapshotSha256: sha('b') }],
    shots: [
      { shotId: 'shot-1', frameNo: 1, sceneId: 'scene-1', title: '开场', durationSec: 5,
        dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] }, beats: [], elements: [] },
      { shotId: 'shot-2', frameNo: 2, sceneId: 'scene-1', title: null, durationSec: 8,
        dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] }, beats: [], elements: [] },
    ],
    valid: true, blockers: [],
  }
}

function runningBatch(): RelayState {
  return {
    version: 1, revision: 1, mode: 'running', reason: null,
    createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z',
    start: {
      batchId: 'batch-1', projectId: 'project-1', episodeId: 'episode-1', instruction: 'Prepare these shots.',
      director: { provider: 'deepseek', model: 'deepseek-chat' },
      shots: ['shot-1', 'shot-2'].map(shotId => ({
        scope: { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId },
        label: shotId, parameters: { duration: 5, resolution: '720P' as const, ratio: '16:9' as const, audio: true, prompt_extend: false },
        retake: false,
      })),
      authorization: {
        authorizationId: 'auth-1', paidConfirmed: true, maxCostCny: '0.300000', maxCandidates: 2,
        expiresAt: '2026-09-16T01:00:00.000Z',
      },
    },
    items: ['shot-1', 'shot-2'].map(shotId => ({
      scope: { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId },
      label: shotId, parameters: { duration: 5, resolution: '720P' as const, ratio: '16:9' as const, audio: true, prompt_extend: false },
      retake: false, phase: 'pending' as const, admissions: [], handoff: null, materialRequests: [],
      submission: null, run: null, preparedAt: null, submittedAt: null, settledAt: null, collectedAt: null, reason: null,
    })),
  }
}

function bridge(overrides: Partial<DirectorContextClientPort> = {}): DirectorContextClientPort {
  return {
    clear: vi.fn(async () => ({ status: 'cleared' as const, state: null, changed: true, manualWorkAllowed: true as const })),
    enter: vi.fn(async () => { throw new Error('enter is not part of this fixture') }),
    recover: vi.fn(async () => ({ status: 'unbound' as const, manualWorkAllowed: true as const })),
    bindProposal: vi.fn(async () => { throw new Error('bindProposal is not part of this fixture') }),
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RelayBatchPanel', () => {
  it('renders nothing when the facade lacks relay endpoints', () => {
    const { container } = render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge()} />)
    expect(container.innerHTML).toBe('')
  })

  it('reports the empty state when no relay batch exists', async () => {
    const readRelayBatch = vi.fn(async () => null)
    render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge({
      readRelayBatch,
      advanceRelayBatch: vi.fn(), completeRelayBatch: vi.fn(), closeRelayBatch: vi.fn(), recoverRelayBatch: vi.fn(),
    })} />)
    expect(await screen.findByText('当前没有接力批次。')).toBeDefined()
    expect(readRelayBatch).toHaveBeenCalledWith('session-1')
  })

  it('pauses a running batch through advanceRelayBatch', async () => {
    const paused: RelayState = { ...runningBatch(), revision: 2, mode: 'paused' }
    const advanceRelayBatch = vi.fn(async () => ({ state: paused }))
    render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge({
      readRelayBatch: vi.fn(async () => runningBatch()),
      advanceRelayBatch,
      completeRelayBatch: vi.fn(), closeRelayBatch: vi.fn(), recoverRelayBatch: vi.fn(),
    })} />)
    const pause = await screen.findByRole('button', { name: '暂停等待准入' }) as HTMLButtonElement
    expect(pause.disabled).toBe(false)
    fireEvent.click(pause)
    await waitFor(() => { expect(advanceRelayBatch).toHaveBeenCalledWith('session-1') })
    expect(await screen.findByText(/已暂停，等待导演准入/)).toBeDefined()
  })

  it('closes a batch only with a reason and sends it trimmed', async () => {
    const closed: RelayState = { ...runningBatch(), revision: 2, mode: 'closed', reason: '计划变更' }
    const closeRelayBatch = vi.fn(async (_sessionId: string, _reason: string) => ({ state: closed }))
    render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge({
      readRelayBatch: vi.fn(async () => runningBatch()),
      advanceRelayBatch: vi.fn(), completeRelayBatch: vi.fn(), closeRelayBatch, recoverRelayBatch: vi.fn(),
    })} />)
    const close = await screen.findByRole('button', { name: '关闭批次' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('关闭原因'), { target: { value: '  计划变更  ' } })
    expect(close.disabled).toBe(false)
    fireEvent.click(close)
    await waitFor(() => { expect(closeRelayBatch).toHaveBeenCalledWith('session-1', '计划变更') })
    expect(await screen.findByText(/已关闭/)).toBeDefined()
  })

  it('completes a batch through completeRelayBatch', async () => {
    const completed: RelayState = { ...runningBatch(), revision: 2, mode: 'completed' }
    const completeRelayBatch = vi.fn(async () => ({ state: completed }))
    render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge({
      readRelayBatch: vi.fn(async () => runningBatch()),
      advanceRelayBatch: vi.fn(), completeRelayBatch, closeRelayBatch: vi.fn(), recoverRelayBatch: vi.fn(),
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: '完成批次' }))
    await waitFor(() => { expect(completeRelayBatch).toHaveBeenCalledWith('session-1') })
    expect(await screen.findByText(/已完成/)).toBeDefined()
  })

  it('recovers the Host lease and reports the outcome', async () => {
    const recoverRelayBatch = vi.fn(async () => ({ state: runningBatch(), recovered: true }))
    render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge({
      readRelayBatch: vi.fn(async () => runningBatch()),
      advanceRelayBatch: vi.fn(), completeRelayBatch: vi.fn(), closeRelayBatch: vi.fn(), recoverRelayBatch,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复 Host 租约' }))
    expect(await screen.findByText('已恢复本批次的 Host 租约。')).toBeDefined()
    expect(recoverRelayBatch).toHaveBeenCalledWith('session-1')
  })

  it('surfaces read failures as alerts', async () => {
    render(<RelayBatchPanel sessionId="session-1" directorBridge={bridge({
      readRelayBatch: vi.fn(async () => { throw new Error('rpc unavailable') }),
      advanceRelayBatch: vi.fn(), completeRelayBatch: vi.fn(), closeRelayBatch: vi.fn(), recoverRelayBatch: vi.fn(),
    })} />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/rpc unavailable/)).toBeDefined()
  })

  it('creates a batch only after instruction and explicit paid confirmation, mapping shots and authorization', async () => {
    const startRelayBatch = vi.fn(async (_sessionId: string, _input: RelayStart) => ({ state: runningBatch() }))
    render(<RelayBatchPanel sessionId="session-1" relations={relationsFixture()} directorBridge={bridge({
      readRelayBatch: vi.fn(async () => null), startRelayBatch,
      advanceRelayBatch: vi.fn(), completeRelayBatch: vi.fn(), closeRelayBatch: vi.fn(), recoverRelayBatch: vi.fn(),
    })} />)
    const create = await screen.findByRole('button', { name: '创建接力批次' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: /镜1 · 开场/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /镜2 · 未命名/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('本批指令'), { target: { value: '按当前导演设计准备这两镜。' } })
    expect(create.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认/ }))
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    await waitFor(() => { expect(startRelayBatch).toHaveBeenCalledOnce() })
    const [calledSession, input] = startRelayBatch.mock.calls[0] as unknown as [string, RelayStart]
    expect(calledSession).toBe('session-1')
    expect(input.batchId).toMatch(/^batch_/u)
    expect(input.projectId).toBe('project-1')
    expect(input.episodeId).toBe('episode-1')
    expect(input.instruction).toBe('按当前导演设计准备这两镜。')
    expect(input.director).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(input.observer).toEqual({ provider: 'qingmu-vision', model: 'qwen3.8-flash' })
    expect(input.shots).toHaveLength(2)
    expect(input.shots[0]).toEqual({
      scope: { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-1' },
      label: '镜1 · 开场',
      parameters: { duration: 5, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false },
      retake: false,
    })
    expect(input.authorization).toMatchObject({
      paidConfirmed: true, maxCostCny: '1.000000', maxCandidates: 2,
    })
    expect(Date.parse(input.authorization.expiresAt)).toBeGreaterThan(Date.now())
    expect(await screen.findByText(/运行中/)).toBeDefined()
  })

  it('keeps creation disabled for a zero cost cap and counts only selected shots', async () => {
    const startRelayBatch = vi.fn(async (_sessionId: string, _input: RelayStart) => ({ state: runningBatch() }))
    render(<RelayBatchPanel sessionId="session-1" relations={relationsFixture()} directorBridge={bridge({
      readRelayBatch: vi.fn(async () => null), startRelayBatch,
      advanceRelayBatch: vi.fn(), completeRelayBatch: vi.fn(), closeRelayBatch: vi.fn(), recoverRelayBatch: vi.fn(),
    })} />)
    const create = await screen.findByRole('button', { name: '创建接力批次' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('本批指令'), { target: { value: '只准备第二镜。' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认/ }))
    fireEvent.change(screen.getByLabelText('费用上限'), { target: { value: '0' } })
    expect(create.disabled).toBe(true)
    expect(screen.getByText(/费用上限需为大于 0 的金额/)).toBeDefined()
    fireEvent.change(screen.getByLabelText('费用上限'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /镜1 · 开场/ }))
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    await waitFor(() => { expect(startRelayBatch).toHaveBeenCalledOnce() })
    const input = (startRelayBatch.mock.calls[0] as unknown as [string, RelayStart])[1]
    expect(input.shots).toHaveLength(1)
    expect(input.shots[0]?.scope.shotId).toBe('shot-2')
    expect(input.authorization.maxCandidates).toBe(1)
    expect(input.authorization.maxCostCny).toBe('0.5')
  })
})
