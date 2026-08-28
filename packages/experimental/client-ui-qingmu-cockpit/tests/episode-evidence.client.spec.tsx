// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EpisodeEvidenceLedger, type EpisodeEvidencePort } from '../src/client/EpisodeEvidenceLedger.tsx'
import type { YimengEpisodeEvidenceLedgerResponse, YimengEpisodeVerificationResponse } from '../src/client/contracts.ts'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'

const SCOPE = { projectId: 'project-e75', episodeId: 'episode-e75' }
const SHA = 'a'.repeat(64)
const t = (key: QingmuCockpitKey) => zh[key]

function ledger(sha = SHA): YimengEpisodeEvidenceLedgerResponse {
  return {
    schema: 'jason.qingmu-episode-evidence-ledger.v1', ...SCOPE, sourceSnapshotSha256: sha,
    source: { schema: 'jason.qingmu-episode-evidence-source.v1', ...SCOPE, verificationInputsSha256: 'b'.repeat(64), frames: [] },
  }
}

function verified(): YimengEpisodeVerificationResponse {
  return {
    schema: 'jason.qingmu-episode-verification.v1', ...SCOPE, sourceSnapshotSha256: SHA,
    verifiedAt: '2026-08-29T00:00:00Z', verificationSha256: 'c'.repeat(64),
    verification: {
      project_id: SCOPE.projectId, episode_id: SCOPE.episodeId, ok: false,
      errors: ['missing_video'], warnings: [], technical_errors: ['missing_video'], creative_errors: [],
      technical_ok: false, creative_ok: true, frame_count: 1, video_asset_count: 0,
      raw_video_asset_count: 0, unverified_video_asset_count: 0, duplicate_video_asset_count: 0,
      video_frame_coverage_count: 0, missing_video_frame_nos: [1], dialogue_asr_required_count: 0,
      dialogue_asr_verified_count: 0, final_delivery_profile: null, final_count: 0,
    },
  }
}

function port() {
  return {
    evidenceLedger: vi.fn<EpisodeEvidencePort['evidenceLedger']>().mockResolvedValue(ledger()),
    verifyEpisode: vi.fn<EpisodeEvidencePort['verifyEpisode']>().mockResolvedValue(verified()),
  }
}

function mount(api = port()) {
  return { api, ...render(<EpisodeEvidenceLedger {...SCOPE} enabled port={api} projection={undefined} t={t} />) }
}

async function load(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: zh.evidenceLoad }))
  await waitFor(() =>{  expect(screen.getByRole('button', { name: zh.evidenceVerify }).hasAttribute('disabled')).toBe(false) })
}

afterEach(cleanup)

describe('episode evidence read-only panel', () => {
  it('does not fetch or probe on mount; explicit read does not verify', async () => {
    const { api } = mount()
    expect(api.evidenceLedger).not.toHaveBeenCalled()
    expect(api.verifyEpisode).not.toHaveBeenCalled()
    expect(screen.getByText(zh.evidenceUnverified)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.evidenceVerify }).hasAttribute('disabled')).toBe(true)
    await load()
    expect(api.evidenceLedger).toHaveBeenCalledTimes(1)
    expect(api.verifyEpisode).not.toHaveBeenCalled()
  })

  it('preserves the canonical false report and checks the source after verification', async () => {
    const { api } = mount()
    await load()
    fireEvent.click(screen.getByRole('button', { name: zh.evidenceVerify }))
    await waitFor(() =>{  expect(screen.getByLabelText(zh.evidenceRawReport)).toBeTruthy() })
    expect(JSON.parse(screen.getByLabelText(zh.evidenceRawReport).textContent ?? '{}')).toEqual(verified().verification)
    expect(api.verifyEpisode).toHaveBeenCalledWith({ ...SCOPE, sourceSnapshotSha256: SHA }, expect.any(AbortSignal))
    expect(api.evidenceLedger).toHaveBeenCalledTimes(2)
    expect(screen.getByText(zh.evidenceSignoff)).toBeTruthy()
    expect(screen.getByText(zh.evidencePointInTime)).toBeTruthy()
  })

  it('drops the completed report when the post-probe source drifted', async () => {
    const api = port()
    api.evidenceLedger.mockResolvedValueOnce(ledger()).mockResolvedValueOnce(ledger('d'.repeat(64)))
    mount(api)
    await load()
    fireEvent.click(screen.getByRole('button', { name: zh.evidenceVerify }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toBe(zh.evidenceStale) })
    expect(screen.queryByLabelText(zh.evidenceRawReport)).toBeNull()
  })

  it('rejects a verification bound to another episode', async () => {
    const api = port()
    api.verifyEpisode.mockResolvedValue({ ...verified(), episodeId: 'wrong-episode' })
    mount(api)
    await load()
    fireEvent.click(screen.getByRole('button', { name: zh.evidenceVerify }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toBe(zh.evidenceStale) })
    expect(api.evidenceLedger).toHaveBeenCalledTimes(1)
  })

  it('retires old results before a refresh and never restores them after a failed read', async () => {
    const { api } = mount()
    await load()
    fireEvent.click(screen.getByRole('button', { name: zh.evidenceVerify }))
    await waitFor(() =>{  expect(screen.getByLabelText(zh.evidenceRawReport)).toBeTruthy() })
    api.evidenceLedger.mockRejectedValue(new Error('forbidden'))
    fireEvent.click(screen.getByRole('button', { name: zh.evidenceRefresh }))
    expect(screen.queryByLabelText(zh.evidenceRawReport)).toBeNull()
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toBe(zh.evidenceError) })
    expect(screen.getByRole('button', { name: zh.evidenceVerify }).hasAttribute('disabled')).toBe(true)
  })

  it('blocks repeated clicks and ignores late completion after scope changes', async () => {
    const api = port()
    let finish!: (value: YimengEpisodeVerificationResponse) => void
    api.verifyEpisode.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = mount(api)
    await load()
    const button = screen.getByRole('button', { name: zh.evidenceVerify })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(api.verifyEpisode).toHaveBeenCalledTimes(1)
    const signal = api.verifyEpisode.mock.calls[0]?.[1]
    view.rerender(<EpisodeEvidenceLedger {...SCOPE} episodeId="other" enabled port={api} projection={undefined} t={t} />)
    expect(signal?.aborted).toBe(true)
    finish(verified())
    await waitFor(() =>{  expect(screen.queryByLabelText(zh.evidenceRawReport)).toBeNull() })
    expect(screen.getByText(zh.evidenceUnverified)).toBeTruthy()
  })

  it.each([
    ['EPISODE_VERIFICATION_TIMEOUT', 'evidenceTimeout'],
    ['EPISODE_VERIFICATION_BUSY', 'evidenceBusy'],
    ['EPISODE_PROBE_UNAVAILABLE', 'evidenceProbeUnavailable'],
  ] as const)('explains %s without retaining any pass', async (code, key) => {
    const api = port()
    api.verifyEpisode.mockRejectedValue(new Error(code))
    mount(api)
    await load()
    fireEvent.click(screen.getByRole('button', { name: zh.evidenceVerify }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toBe(zh[key]) })
    expect(screen.queryByLabelText(zh.evidenceRawReport)).toBeNull()
  })
})
