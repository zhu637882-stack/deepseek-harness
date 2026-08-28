// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QingmuYimengPort, YimengTakeVersionRequest } from '../src/client/contracts.ts'
import { TakeVersionCompareView } from '../src/client/TakeVersionCompareView.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { writeTakeCommentRecoveryMarker } from '../src/client/take-comment-recovery.ts'
import {
  takeCommentFeed,
  takeCommentRecovery,
  takeCommentResult,
  type TakeCommentFeed,
  type TakeCommentRecovery,
  type TakeCommentRequest,
  type TakeCommentResult,
} from '../../qingmu-yimeng-read-adapter/tests/take-comment-fixture.ts'
import {
  takeVersionSha,
  takeVersionStackFixture,
} from '../../qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'
import { continuitySource } from './fixtures/continuity-method.client.ts'

type BasePort = Pick<QingmuYimengPort,
  'takeVersions' | 'takeAcceptance' | 'takeAcceptanceMethod'
  | 'selectTakeVersion' | 'recoverTakeVersionSelection'>

interface CommentPort {
  takeComments(
    request: YimengTakeVersionRequest,
    signal?: AbortSignal,
  ): Promise<TakeCommentFeed>
  createTakeComment(request: TakeCommentRequest, signal?: AbortSignal): Promise<TakeCommentResult>
  recoverTakeComment(request: TakeCommentRequest, signal?: AbortSignal): Promise<TakeCommentRecovery>
}

type Port = BasePort & CommentPort
type MockPort = {
  readonly [K in keyof Port]: ReturnType<typeof vi.fn<Port[K]>>
}

const t = (key: QingmuCockpitKey) => zh[key]

function scope() {
  const source = continuitySource()
  return { projectId: source.projectId, episodeId: source.episodeId, frameId: 'frame-z' }
}

function markerKey(): string {
  const value = scope()
  return ['qingmu:take-comment-recovery:v1', value.projectId, value.episodeId, value.frameId]
    .map(encodeURIComponent).join(':')
}

function marker(input: TakeCommentRequest) {
  return { schema: 'qingmu.take-comment-recovery-marker.v1' as const, ...input }
}

function stack(selectedTakeId: string | null = 'asset-take-1') {
  const value = takeVersionStackFixture(scope())
  if (selectedTakeId === 'asset-take-1') return value
  const subject = {
    ...value.subject,
    selectedTakeId,
    versions: value.subject.versions.map(version => ({
      ...version,
      isSelected: selectedTakeId === version.takeId,
      selectionStatus: selectedTakeId === version.takeId ? 'Selected' as const
        : version.takeId === 'asset-take-1' ? 'Stale' as const : 'Unselected' as const,
      canAttemptSelection: selectedTakeId === version.takeId ? false : version.canAttemptSelection,
    })),
  }
  return { ...value, subject, stackSnapshotSha256: takeVersionSha(subject) }
}

function makePort(feed: TakeCommentFeed = takeCommentFeed(scope())): MockPort {
  return {
    takeVersions: vi.fn<Port['takeVersions']>().mockResolvedValue(stack()),
    takeAcceptance: vi.fn<Port['takeAcceptance']>().mockRejectedValue(new Error('not needed by comment slice')),
    takeAcceptanceMethod: vi.fn<Port['takeAcceptanceMethod']>()
      .mockRejectedValue(new Error('not needed by comment slice')),
    selectTakeVersion: vi.fn<Port['selectTakeVersion']>(),
    recoverTakeVersionSelection: vi.fn<Port['recoverTakeVersionSelection']>(),
    takeComments: vi.fn<Port['takeComments']>().mockResolvedValue(feed),
    createTakeComment: vi.fn<Port['createTakeComment']>(),
    recoverTakeComment: vi.fn<Port['recoverTakeComment']>(),
  }
}

function props(port: Port) {
  const projection = continuitySource()
  return {
    ...scope(), selectedShotId: 'frame-z', projection, enabled: true, port, t,
  }
}

function pending<T>() {
  let accept: (value: T) => void = () => { throw new Error('promise not initialized') }
  const promise = new Promise<T>((resolve) => { accept = resolve })
  return { promise, resolve: (value: T) => { accept(value) } }
}

function storedMarker(): Record<string, unknown> | null {
  const serialized = sessionStorage.getItem(markerKey())
  return serialized === null ? null : JSON.parse(serialized) as Record<string, unknown>
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Take ordinary comments', () => {
  it('defaults to the selected Take, renders current and historical bindings, and exposes no approval action', async () => {
    const port = makePort()
    render(<TakeVersionCompareView {...props(port)} />)

    const region = await screen.findByRole('region', { name: '普通评论' })
    expect(port.takeComments).toHaveBeenCalledExactlyOnceWith(scope(), expect.any(AbortSignal))
    expect(within(region).getByRole<HTMLSelectElement>('combobox', { name: 'Take 版本' }).value)
      .toBe('asset-take-1')
    expect(within(region).getByText('当前绑定')).toBeTruthy()
    expect(within(region).getByText('历史')).toBeTruthy()
    expect(within(region).getByText('眼神应在这一拍落到左侧角色。')).toBeTruthy()
    expect(within(region).getByText('上一版第 36 帧构图需要调整。')).toBeTruthy()
    expect(within(region).queryByRole('button', { name: /批准|approve|技术\s*pass/i })).toBeNull()
    expect(within(region).queryByText(/^PASS$/i)).toBeNull()
    expect(region.querySelector('video, audio, source, track')).toBeNull()
  })

  it('falls back to the first version without changing selection and supports both labelled anchor modes', async () => {
    const port = makePort()
    port.takeVersions.mockResolvedValue(stack(null))
    render(<TakeVersionCompareView {...props(port)} />)

    const region = await screen.findByRole('region', { name: '普通评论' })
    const version = within(region).getByRole<HTMLSelectElement>('combobox', { name: 'Take 版本' })
    expect(version.value).toBe('asset-take-1')
    fireEvent.change(version, { target: { value: 'asset-take-2' } })
    expect(version.value).toBe('asset-take-2')

    expect(within(region).getByRole<HTMLInputElement>('radio', { name: '时间码' }).checked).toBe(true)
    expect(within(region).getByLabelText('时间码（毫秒）')).toBeTruthy()
    expect(within(region).getByText('范围：0–5500 毫秒')).toBeTruthy()
    fireEvent.click(within(region).getByRole('radio', { name: '帧号' }))
    expect(within(region).getByRole<HTMLInputElement>('radio', { name: '帧号' }).checked).toBe(true)
    expect(within(region).getByLabelText('帧号')).toBeTruthy()
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
  })

  it('shows inline validation and disables submission for invalid, busy, or read-only forms', async () => {
    const readOnly = { ...takeCommentFeed(scope()), capabilities: { canComment: false } }
    const port = makePort(readOnly)
    const { unmount } = render(<TakeVersionCompareView {...props(port)} />)
    let region = await screen.findByRole('region', { name: '普通评论' })
    expect(within(region).getByRole('button', { name: '提交评论' }).hasAttribute('disabled')).toBe(true)
    expect(within(region).getByText('当前身份不能发表评论')).toBeTruthy()
    unmount()

    const writable = makePort()
    render(<TakeVersionCompareView {...props(writable)} />)
    region = await screen.findByRole('region', { name: '普通评论' })
    const submit = within(region).getByRole('button', { name: '提交评论' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(region).getByLabelText('时间码（毫秒）'), { target: { value: '5251' } })
    fireEvent.change(within(region).getByLabelText('评论内容'), { target: { value: '   ' } })
    fireEvent.click(submit)
    expect(within(region).getByText('时间码必须在 0–5250 毫秒之间').getAttribute('role')).toBe('alert')
    expect(within(region).getByText('请输入评论内容').getAttribute('role')).toBe('alert')
    expect(writable.createTakeComment).not.toHaveBeenCalled()
  })

  it('stores the full intent before one POST, disables while loading, clears on success, and rereads the feed', async () => {
    const initial = takeCommentFeed(scope())
    const port = makePort(initial)
    port.takeComments.mockResolvedValue(initial)
    const deferred = pending<TakeCommentResult>()
    port.createTakeComment.mockImplementation(async (input) => {
      expect(storedMarker()).toEqual(marker(input))
      return await deferred.promise
    })
    render(<TakeVersionCompareView {...props(port)} />)

    const region = await screen.findByRole('region', { name: '普通评论' })
    fireEvent.change(within(region).getByRole('combobox', { name: 'Take 版本' }), {
      target: { value: 'asset-take-2' },
    })
    fireEvent.click(within(region).getByRole('radio', { name: '帧号' }))
    fireEvent.change(within(region).getByLabelText('帧号'), { target: { value: '36' } })
    fireEvent.change(within(region).getByLabelText('评论内容'), { target: { value: '第二版第 36 帧需要收紧构图。' } })
    const submit = within(region).getByRole('button', { name: '提交评论' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    await waitFor(() => { expect(port.createTakeComment).toHaveBeenCalledOnce() })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(within(region).getByRole('status').textContent).toContain('正在提交评论…')
    const input = port.createTakeComment.mock.calls[0]?.[0]
    if (input === undefined) throw new Error('comment request missing')
    expect(input).toEqual({
      ...scope(),
      expectedTakeSubjectSha256: initial.versions[1]?.takeSubjectSha256,
      takeId: 'asset-take-2',
      anchor: { kind: 'frame', frameNumber: 36 },
      body: '第二版第 36 帧需要收紧构图。',
      idempotencyKey: input.idempotencyKey,
    })
    expect(input.idempotencyKey).toMatch(/^qingmu:take-comment:v1:[0-9a-f]{64}$/u)

    await act(async () => { deferred.resolve(takeCommentResult(input)) })
    expect((await within(region).findByText('评论已提交')).getAttribute('role')).toBe('status')
    await waitFor(() => { expect(port.takeComments).toHaveBeenCalledTimes(2) })
    expect(sessionStorage.getItem(markerKey())).toBeNull()
    expect(port.recoverTakeComment).not.toHaveBeenCalled()
  })

  it('locks the original coordinate after a missing receipt across a second click and reload', async () => {
    const port = makePort()
    port.createTakeComment.mockRejectedValue(new Error('connection dropped'))
    port.recoverTakeComment.mockImplementation(async input => takeCommentRecovery(input, false))
    const firstRender = render(<TakeVersionCompareView {...props(port)} />)

    const region = await screen.findByRole('region', { name: '普通评论' })
    fireEvent.change(within(region).getByLabelText('时间码（毫秒）'), { target: { value: '1250' } })
    fireEvent.change(within(region).getByLabelText('评论内容'), { target: { value: '等待恢复的评论' } })
    fireEvent.click(within(region).getByRole('button', { name: '提交评论' }))

    expect((await within(region).findByText('评论提交结果未知')).getAttribute('role')).toBe('alert')
    expect(port.createTakeComment).toHaveBeenCalledOnce()
    expect(port.recoverTakeComment).toHaveBeenCalledOnce()
    expect(port.recoverTakeComment.mock.calls[0]?.[0]).toEqual(port.createTakeComment.mock.calls[0]?.[0])
    const originalMarker = sessionStorage.getItem(markerKey())
    expect(originalMarker).not.toBeNull()
    expect(storedMarker()).toEqual(marker(port.createTakeComment.mock.calls[0]![0]))

    const submit = within(region).getByRole('button', { name: '提交评论' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(submit)
    expect(port.createTakeComment).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(markerKey())).toBe(originalMarker)

    firstRender.unmount()
    render(<TakeVersionCompareView {...props(port)} />)
    const reloadedRegion = await screen.findByRole('region', { name: '普通评论' })
    expect((await within(reloadedRegion).findByText('评论提交结果未知')).getAttribute('role')).toBe('alert')
    expect(port.recoverTakeComment).toHaveBeenCalledTimes(2)
    expect(port.recoverTakeComment.mock.calls[1]?.[0]).toEqual(port.createTakeComment.mock.calls[0]?.[0])
    expect(port.createTakeComment).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(markerKey())).toBe(originalMarker)
    fireEvent.click(within(reloadedRegion).getByRole('button', { name: '提交评论' }))
    expect(port.createTakeComment).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(markerKey())).toBe(originalMarker)
  })

  it('refuses to overwrite an unresolved recovery marker', () => {
    const first: TakeCommentRequest = {
      ...scope(), expectedTakeSubjectSha256: takeCommentFeed(scope()).versions[0]!.takeSubjectSha256,
      takeId: 'asset-take-1', anchor: { kind: 'frame', frameNumber: 36 },
      body: '原始未决评论', idempotencyKey: `qingmu:take-comment:v1:${'c'.repeat(64)}`,
    }
    const replacement: TakeCommentRequest = {
      ...first, body: '不得覆盖的评论', idempotencyKey: `qingmu:take-comment:v1:${'d'.repeat(64)}`,
    }
    expect(writeTakeCommentRecoveryMarker(marker(first))).toBe(true)
    expect(writeTakeCommentRecoveryMarker(marker(replacement))).toBe(false)
    expect(storedMarker()).toEqual(marker(first))
  })

  it('recovers a committed marker on mount, verifies the original body and anchor, and clears without POST', async () => {
    const input: TakeCommentRequest = {
      ...scope(), expectedTakeSubjectSha256: takeCommentFeed(scope()).versions[0]!.takeSubjectSha256,
      takeId: 'asset-take-1', anchor: { kind: 'timecode', timecodeMillis: 1_250 },
      body: '挂起后恢复的评论', idempotencyKey: `qingmu:take-comment:v1:${'a'.repeat(64)}`,
    }
    sessionStorage.setItem(markerKey(), JSON.stringify(marker(input)))
    const port = makePort()
    port.recoverTakeComment.mockResolvedValue(takeCommentRecovery(input, true))
    render(<TakeVersionCompareView {...props(port)} />)

    const region = await screen.findByRole('region', { name: '普通评论' })
    expect((await within(region).findByText('评论已提交')).getAttribute('role')).toBe('status')
    expect(port.recoverTakeComment).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
    expect(port.createTakeComment).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(markerKey())).toBeNull()
    await waitFor(() => { expect(port.takeComments).toHaveBeenCalledTimes(2) })
  })

  it('keeps the marker and fails closed when a recovered receipt differs from the original request', async () => {
    const input: TakeCommentRequest = {
      ...scope(), expectedTakeSubjectSha256: takeCommentFeed(scope()).versions[0]!.takeSubjectSha256,
      takeId: 'asset-take-1', anchor: { kind: 'frame', frameNumber: 36 },
      body: '原评论', idempotencyKey: `qingmu:take-comment:v1:${'b'.repeat(64)}`,
    }
    sessionStorage.setItem(markerKey(), JSON.stringify(marker(input)))
    const drift = takeCommentRecovery(input, true)
    if (drift.result === null) throw new Error('fixture result missing')
    Object.assign(drift.result, { comment: { ...drift.result.comment, body: '被替换的评论' } })
    const port = makePort()
    port.recoverTakeComment.mockResolvedValue(drift)
    render(<TakeVersionCompareView {...props(port)} />)

    const region = await screen.findByRole('region', { name: '普通评论' })
    expect((await within(region).findByText('评论恢复回执不匹配')).getAttribute('role')).toBe('alert')
    expect(storedMarker()).toEqual(marker(input))
    expect(port.createTakeComment).not.toHaveBeenCalled()
  })

  it('uses the durable comment id as the list key when a new comment is inserted', async () => {
    const first = takeCommentFeed(scope())
    const second = {
      ...first,
      comments: [
        {
          ...first.comments[0]!, id: 'take-comment-new', eventId: 'take-comment-event-new',
          body: '新插入的评论', createdAt: '2026-08-28T10:04:00.123456+00:00',
        },
        ...first.comments,
      ],
    }
    const port = makePort(first)
    port.takeComments.mockResolvedValueOnce(first).mockResolvedValue(second)
    render(<TakeVersionCompareView {...props(port)} />)
    const historicalText = await screen.findByText('上一版第 36 帧构图需要调整。')
    const historicalNode = historicalText.closest('li, article')
    expect(historicalNode).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh.takeVersionRefresh }))
    expect(await screen.findByText('新插入的评论')).toBeTruthy()
    const refreshed = screen.getByText('上一版第 36 帧构图需要调整。').closest('li, article')
    expect(refreshed).toBe(historicalNode)
  })
})
