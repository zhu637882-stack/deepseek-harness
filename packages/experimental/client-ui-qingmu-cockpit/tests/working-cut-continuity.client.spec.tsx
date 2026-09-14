// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkingCutSoundReview } from '../src/client/WorkingCutSoundReview.tsx'
afterEach(cleanup)
it('seeks both sides of a cut and retains unknown observations without approving the film', () => {
  const seek = vi.fn(), review = vi.fn()
  render(<WorkingCutSoundReview busy={false} changed={false} onSeek={seek} onReview={review}
    review={{ state: 'complete', advisoryOnly: true, checks: [], transcript: [], transitions: [{
      cutIndex: 1, atSec: 8, fromFrameId: 'f1', toFrameId: 'f2', checks: [
        { kind: 'space', status: 'fail', evidence: '庭院切为室内，没有过渡', timeRanges: [[7, 8], [8, 9]] },
        { kind: 'voice', status: 'unverified', evidence: '', timeRanges: [] },
      ],
    }] }} />)
  expect(screen.getByText(/1 项问题 \/ 1 项待确认/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '连看这个连接处' }))
  expect(seek).toHaveBeenLastCalledWith(6)
  fireEvent.click(screen.getByRole('button', { name: '0:08.0—0:09.0 回看' }))
  expect(seek).toHaveBeenLastCalledWith(8)
  expect(screen.getByText('角色音色 · 尚未确认')).toBeTruthy()
  expect(review).not.toHaveBeenCalled()
})
it('does not upgrade an old sound report or submit a new check on page load', () => {
  const review = vi.fn()
  render(<WorkingCutSoundReview busy={false} changed={false} onSeek={vi.fn()} onReview={review}
    review={{ state: 'complete', methodChanged: true, advisoryOnly: true, checks: [], transcript: [] }} />)
  expect(screen.getByText(/旧版声音报告/)).toBeTruthy()
  expect(screen.queryByLabelText('前后镜连续性报告')).toBeNull()
  expect(review).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '检查此版连续性与声音' }))
  expect(review).toHaveBeenCalledOnce()
})
