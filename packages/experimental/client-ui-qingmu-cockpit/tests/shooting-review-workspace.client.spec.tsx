// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import type { YimengTakeVersionStackResponse } from '../src/client/contracts.ts'
import { takeVersionStackFixture } from '../../qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'
import { localHeroUrl, shootingPosterVersion, shootingPrimary, shootingTitle, ShootingReviewWorkspace } from '../src/client/ShootingReviewWorkspace.tsx'
import { AutomaticFrameRequirementsEditor } from '../src/client/AutomaticFrameRequirementsEditor.tsx'
import { takeVersionSelectionRequestFromMarker } from '../src/client/take-version-recovery.ts'

afterEach(cleanup)

const projection = {
  director: { shotRelations: { storyboardRevision: { revisionId: 'storyboard-r1' }, shots: [
    { shotId: 'frame_34b3741b1f0a', frameNo: 6, title: '落日公路', sceneId: 'scene-1', beats: [], dialogueRhythm: { cues: [] } },
    { shotId: 'frame-7', frameNo: 7, title: '车内回望', sceneId: 'scene-1', beats: [], dialogueRhythm: { cues: [] } },
  ] }, heroFrameStoryboards: { shots: [{ shotId: 'frame_34b3741b1f0a', heroFrame: { assetId: 'asset_first_frame_6', browserUrl: `http://127.0.0.1:65269/api/media/media_first_frame_6?expires=1788767261&signature=${'a'.repeat(64)}` } }] } },
} as never

const portFixture = {
  takeVersions: vi.fn(() => new Promise(() => {})),
  takePreview: vi.fn(),
  selectTakeVersion: vi.fn(),
  recoverTakeVersionSelection: vi.fn(),
}
const port = portFixture as never

describe('ShootingReviewWorkspace', () => {
  it.each([
    { canAttemptSelection: false, lineageComplete: true, allowed: false },
    { canAttemptSelection: true, lineageComplete: false, allowed: false },
    { canAttemptSelection: false, lineageComplete: false, allowed: false },
    { canAttemptSelection: true, lineageComplete: true, allowed: true },
  ])('requires candidate eligibility as well as playable output: %j', async ({ canAttemptSelection, lineageComplete, allowed }) => {
    localStorage.clear(); sessionStorage.clear()
    const candidate = { takeId: 'video-candidate', versionOrdinal: 1, outputAssetId: 'asset-video',
      outputSha256: 'b'.repeat(64), outputBindingStatus: 'verified', qualityStatus: 'pending',
      isSelected: false, selectionStatus: 'Unselected', canAttemptSelection, lineageComplete,
      blockers: [], source: 'reference', durationSec: 8 }
    const takePreview = vi.fn(() => new Promise(() => {}))
    const selectTakeVersion = vi.fn()
    const scopedPort = { takePreview, selectTakeVersion, recoverTakeVersionSelection: vi.fn(),
      takeVersions: vi.fn(async ({ frameId }: { frameId: string }) => ({
        subject: { projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId,
          selectedTakeId: null, versions: [candidate] },
        capabilities: { canSelect: true }, stackSnapshotSha256: 'a'.repeat(64),
      })) }
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集"
      projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()}
      directorAssistant={null} port={scopedPort as never} t={key => key} />)
    await waitFor(() => { expect(takePreview).toHaveBeenCalled() })
    expect(Boolean(screen.queryByRole('button', { name: '采用这条视频' }))).toBe(allowed)
    expect(selectTakeVersion).not.toHaveBeenCalled()
  })

  it('never substitutes a historical candidate for the selected video poster', () => {
    const older = { takeId:'old', outputSha256:'a'.repeat(64), outputBindingStatus:'verified' }
    const selected = { takeId:'chosen', outputSha256:'b'.repeat(64), outputBindingStatus:'verified' }
    expect(shootingPosterVersion({ subject: { selectedTakeId:'chosen', versions:[older, selected] } } as never)).toBe(selected)
    expect(shootingPosterVersion({ subject: { selectedTakeId:'missing', versions:[older] } } as never)).toBeUndefined()
    expect(shootingPosterVersion({ subject: { selectedTakeId:null, versions:[older] } } as never)).toBe(older)
  })

  it('unmounts the old requirements editor immediately when changing the selected shot', async () => {
    let changingShot = false
    const save = vi.fn()
    const read = vi.fn(() => changingShot ? new Promise(() => {}) : Promise.resolve({
      projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', canonicalStoryboard: null,
      frameRequirements: [{ id: 'frame_34b3741b1f0a', imagePromptCn: '第一镜已保存要求' }, { id: 'frame-7', imagePromptCn: '第二镜要求' }],
    }))
    const props = { projectName: '落日公路', episodeName: '第 1 集', projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9',
      projection, onSelectShotId: vi.fn(), onNavigate: vi.fn(), directorAssistant: null, t: (key: string) => key,
      port: { ...portFixture, readScenePlanning: read, saveScenePlanning: save, recoverScenePlanning: vi.fn() } as never }
    const view = render(<ShootingReviewWorkspace {...props} selectedShotId="frame_34b3741b1f0a" />)
    await screen.findByDisplayValue('第一镜已保存要求')
    changingShot = true
    view.rerender(<ShootingReviewWorkspace {...props} selectedShotId="frame-7" />)
    expect(screen.queryByDisplayValue('第一镜已保存要求')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存当前要求' })).toBeNull()
    expect(screen.getByText('正在读取本镜首帧要求…')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })
  it('selects one primary action from real material state', () => {
    expect(shootingPrimary(false, false, false)).toBe('first-frame')
    expect(shootingPrimary(true, false, false)).toBe('select-frame')
    expect(shootingPrimary(true, true, false)).toBe('video')
    expect(shootingPrimary(true, true, true)).toBeUndefined()
  })
  it('uses storyboard prose instead of generic numbered titles', () => {
    expect(shootingTitle('镜头 4', { id: 'f4', frameNo: 4, title: '镜头 4', imagePromptCn: '', blocking: '双手稳握方向盘；看见女主' })).toBe('双手稳握方向盘')
    expect(shootingTitle('雨中相遇', undefined)).toBe('雨中相遇')
  })
  it('edits action and camera independently and preserves both on reload', async () => {
    localStorage.clear()
    const props = { projectId:'project_cd5eabc7582b', episodeId:'episode_cd4ffe357df9', shotId:'frame_34b3741b1f0a', onCommitted:async () => undefined,
      port: { readScenePlanning: vi.fn(async () => ({ projectId:'project_cd5eabc7582b', episodeId:'episode_cd4ffe357df9', scriptRevision:1, scriptSha256:'a'.repeat(64), canonicalStoryboard:{ revision:1,sourceHash:'b'.repeat(64),shots:[{ id:'frame_34b3741b1f0a',imagePromptCn:'原始画面',blocking:'双手握盘',cameraAngle:'平视' }] } })), saveScenePlanning:vi.fn(), recoverScenePlanning:vi.fn() } as never }
    const view = render(<AutomaticFrameRequirementsEditor {...props} />)
    await screen.findByDisplayValue('双手握盘')
    fireEvent.change(screen.getByRole('textbox',{ name:'动作' }),{ target:{ value:'缓慢抬头' } })
    expect((screen.getByRole('textbox',{ name:'机位' }) as HTMLInputElement).value).toBe('平视')
    fireEvent.change(screen.getByRole('textbox',{ name:'机位' }),{ target:{ value:'驾驶员视点' } })
    view.unmount(); render(<AutomaticFrameRequirementsEditor {...props} />)
    expect(await screen.findByDisplayValue('缓慢抬头')).toBeTruthy()
    expect(screen.getByDisplayValue('驾驶员视点')).toBeTruthy()
    expect(screen.getByDisplayValue('原始画面')).toBeTruthy()
  })
  it('closes only the enlarged viewer on Escape and restores its trigger focus', () => {
    const parentClose = vi.fn()
    document.addEventListener('keydown', parentClose)
    try {
      render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection} selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()} directorAssistant={null} port={port} t={key => key} />)
      fireEvent.load(screen.getByAltText('镜 6 已选首帧'))
      const trigger=screen.getByRole('button', { name: '放大画面' })
      fireEvent.click(trigger)
      fireEvent.keyDown(screen.getByRole('dialog', { name:'放大画面' }),{ key:'Escape' })
      expect(screen.queryByRole('dialog', { name:'放大画面' })).toBeNull()
      expect(parentClose).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger)
    } finally { document.removeEventListener('keydown',parentClose) }
  })
  it('loads only signed local media matching the projected asset', () => {
    const valid = `http://127.0.0.1:65269/api/media/media_first_frame_6?expires=1788767261&signature=${'a'.repeat(64)}`
    expect(localHeroUrl(valid, 'asset_first_frame_6')).toBe(valid)
    for (const bad of [valid.replace('media_first_frame_6', 'media_other'), valid.split('?')[0], valid + '#hash', valid + '&signature=duplicate', valid.replace('http://', 'http://user:pass@'), valid.replace('127.0.0.1', 'remote.example')]) {
      expect(localHeroUrl(bad, 'asset_first_frame_6')).toBeUndefined()
    }
  })
  it('browses candidates without changing the selected Shot and keeps adoption explicit', () => {
    const onSelectShotId = vi.fn()
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={onSelectShotId} onNavigate={vi.fn()} directorAssistant={<p>导演助手</p>} port={port} t={key => key} testState="pending-review" />)
    expect(onSelectShotId).not.toHaveBeenCalled()
    expect(screen.getByText(/单击候选只切换中区媒体，不会改变选用/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '候选不可采用' })).toBeNull()
    expect(screen.getByText('已选首帧')).toBeTruthy()
  })

  it('blocks first-frame generation until this exact shot has a saved requirement', async () => {
    const onNavigate = vi.fn()
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={onNavigate} directorAssistant={null} port={port} t={key => key} />)
    const returnButtons = await screen.findAllByRole('button', { name: '返回分镜核对要求' })
    const returnButton = returnButtons[0]
    if (returnButton === undefined) throw new Error('Missing storyboard return action')
    expect(screen.queryByRole('button', { name: '生成首帧' })).toBeNull()
    fireEvent.click(returnButton)
    expect(onNavigate).toHaveBeenCalledWith('shots')
  })

  it('uses the application-shell storyboard return instead of the legacy shooting destination', async () => {
    const onNavigate = vi.fn()
    const onReturnToStoryboard = vi.fn()
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={onNavigate} onReturnToStoryboard={onReturnToStoryboard}
      directorAssistant={null} port={port} t={key => key} />)
    const button = (await screen.findAllByRole('button', { name: '返回分镜核对要求' }))[0]
    if (button === undefined) throw new Error('Missing storyboard return action')
    fireEvent.click(button)
    expect(onReturnToStoryboard).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('does not carry a prior shot requirement into the next shot', async () => {
    const readyOnlyPort = {
      takeVersions: vi.fn(() => new Promise(() => {})), takePreview: vi.fn(),
      selectTakeVersion: vi.fn(), recoverTakeVersionSelection: vi.fn(),
      readScenePlanning: vi.fn(async () => ({
        projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', scriptRevision: 1, scriptSha256: 'a'.repeat(64),
        canonicalStoryboard: { revision: 1, sourceHash: 'b'.repeat(64), shots: [{ id: 'frame_34b3741b1f0a', imagePromptCn: '仅首镜已保存要求' }] },
      })), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    } as never
    const view = render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()} directorAssistant={null} port={readyOnlyPort} t={key => key} />)
    expect(await screen.findByRole('button', { name: '重新生成首帧' })).toBeTruthy()
    view.rerender(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame-7" onSelectShotId={vi.fn()} onNavigate={vi.fn()} directorAssistant={null} port={readyOnlyPort} t={key => key} />)
    expect(screen.queryByRole('button', { name: '重新生成首帧' })).toBeNull()
    expect(screen.queryByRole('button', { name: '生成首帧' })).toBeNull()
    expect((await screen.findAllByRole('button', { name: '返回分镜核对要求' })).length).toBeGreaterThan(0)
  })

  it('changes the active Shot only through the Shot list and switches to the native assistant', () => {
    const onSelectShotId = vi.fn()
    const view = render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={onSelectShotId} onNavigate={vi.fn()} directorAssistant={<p>导演助手已连接</p>} port={port} t={key => key} testState="failed" />)
    fireEvent.click(within(view.container.querySelector('[aria-label="镜头列表"]') as HTMLElement).getByRole('button', { name: /镜 7.*车内回望/i }))
    expect(onSelectShotId).toHaveBeenCalledWith('frame-7')
    fireEvent.click(screen.getByRole('button', { name: '原生导演助手' }))
    expect(screen.getByText('导演助手已连接')).toBeTruthy()
  })

  it.each(['normal', 'generating', 'failed', 'pending-review'] as const)('renders the isolated %s state', (testState) => {
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()} directorAssistant={null} port={port} t={key => key} testState={testState} />)
    expect(document.querySelector(`[data-state="${testState}"]`)).toBeTruthy()
  })

  it('restores an unsent first-frame draft only for its own shot', async () => {
    localStorage.setItem('qingmu.scene-planning.v1:project_cd5eabc7582b:episode_cd4ffe357df9:automatic-frame:frame_34b3741b1f0a', JSON.stringify({ shotId: 'frame_34b3741b1f0a', imagePromptCn: '本地未提交首帧要求' }))
    render(<AutomaticFrameRequirementsEditor projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" shotId="frame_34b3741b1f0a" onCommitted={async () => undefined} port={{
      readScenePlanning: vi.fn(async () => ({ projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', scriptRevision: 1, scriptSha256: 'a'.repeat(64), canonicalStoryboard: { revision: 1, sourceHash: 'b'.repeat(64), shots: [{ id: 'frame_34b3741b1f0a', imagePromptCn: '服务端要求' }] } })),
      saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    } as never} />)
    expect(await screen.findByDisplayValue('本地未提交首帧要求')).toBeTruthy()
  })

  it('does not display a pending receipt under different draft text', async () => {
    localStorage.setItem('qingmu.scene-planning.v1:project_cd5eabc7582b:episode_cd4ffe357df9:automatic-frame:frame_34b3741b1f0a', JSON.stringify({ shotId: 'frame_34b3741b1f0a', imagePromptCn: '不同外层文案', pending: { projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', idempotencyKey: 'pending-key-123', request: { action: 'edit_automatic', shotId: 'frame_34b3741b1f0a', imagePromptCn: '回执原文', expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64), expectedStoryboardRevision: 1, expectedStoryboardSha256: 'b'.repeat(64) } } }))
    render(<AutomaticFrameRequirementsEditor projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" shotId="frame_34b3741b1f0a" onCommitted={async () => undefined} port={{ readScenePlanning: vi.fn(async () => ({ projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', scriptRevision: 1, scriptSha256: 'a'.repeat(64), canonicalStoryboard: { revision: 1, sourceHash: 'b'.repeat(64), shots: [{ id: 'frame_34b3741b1f0a', imagePromptCn: '服务端要求' }] } })), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() } as never} />)
    expect(await screen.findByDisplayValue('服务端要求')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '读取同一保存回执' })).toBeNull()
  })

  it('strips recovery metadata before adapter selection DTO', () => {
    const request = takeVersionSelectionRequestFromMarker({ schema: 'qingmu.take-version-selection-recovery-marker.v1', projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId: 'frame_34b3741b1f0a', expectedStackSha256: 'a'.repeat(64), expectedSelectedTakeId: null, candidateTakeId: 'take-1', candidateVersionOrdinal: 1, candidateOutputSha256: 'b'.repeat(64), idempotencyKey: 'qingmu:take-select:v1:12345678' })
    expect(request).not.toHaveProperty('schema')
    expect(Object.keys(request)).toHaveLength(9)
  })

  it.each([undefined, null, { action: 'edit_requirements', imagePromptCn: null }])('ignores malformed local pending data without blocking the saved shot: %j', async (request) => {
    const scope = { projectId: 'project-malformed', episodeId: 'episode-malformed', shotId: 'frame-malformed' }
    localStorage.setItem(`qingmu.scene-planning.v1:${scope.projectId}:${scope.episodeId}:automatic-frame:${scope.shotId}`,
      JSON.stringify({ shotId: scope.shotId, imagePromptCn: '损坏的本地草稿', pending: { ...scope, request } }))
    render(<AutomaticFrameRequirementsEditor {...scope} onCommitted={async () => undefined} port={{
      readScenePlanning: vi.fn(async () => ({ ...scope, canonicalStoryboard: null,
        frameRequirements: [{ id: scope.shotId, imagePromptCn: '服务器已保存的画面' }] })),
      saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    } as never} />)
    expect(await screen.findByDisplayValue('服务器已保存的画面')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '查看原保存结果' })).toBeNull()
  })

  it('keeps an empty real candidate list neutral instead of calling it failed', async () => {
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection} selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()} directorAssistant={null} t={key => key} port={{ takePreview: vi.fn(), selectTakeVersion: vi.fn(), recoverTakeVersionSelection: vi.fn(), takeVersions: vi.fn(async () => ({ subject: { projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId: 'frame_34b3741b1f0a', selectedTakeId: null, versions: [] }, capabilities: { canSelect: false }, stackSnapshotSha256: 'a'.repeat(64) })) } as never} />)
    await waitFor(() => expect(document.querySelector('[data-state="pending-review"]')).toBeTruthy())
  })

  it('shows an imported local video in the existing candidate rail but never offers it for adoption', async () => {
    const candidate = { takeId: 'asset_localvideo_0123456789abcdef0123456789abcdef', versionOrdinal: 1,
      outputAssetId: 'asset_localvideo_0123456789abcdef0123456789abcdef', outputSha256: 'b'.repeat(64),
      outputBindingStatus: 'verified', qualityStatus: 'pending', isSelected: false, selectionStatus: 'Unselected',
      canAttemptSelection: false, lineageComplete: false, blockers: ['local_source_unverified'], source: 'local',
      originalFileName: 'libtv-shot-01.mp4', durationSec: 8 }
    const scopedPort = { takePreview: vi.fn(() => new Promise(() => {})), selectTakeVersion: vi.fn(),
      recoverTakeVersionSelection: vi.fn(), uploadLocalVideoCandidate: vi.fn(), recoverLocalVideoCandidate: vi.fn(),
      takeVersions: vi.fn(async ({ frameId }: { frameId: string }) => ({
        subject: { projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId,
          selectedTakeId: null, versions: [candidate] }, capabilities: { canSelect: true }, stackSnapshotSha256: 'a'.repeat(64),
      })) }
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集"
      projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()}
      directorAssistant={null} port={scopedPort as never} t={key => key} />)
    await screen.findByText('本地导入视频')
    expect(screen.getByText('libtv-shot-01.mp4')).toBeTruthy()
    expect(screen.getByText('本地导入，来源待核实，暂不可采用')).toBeTruthy()
    expect(screen.getByText('本地导入候选来源待核实，仅供本镜对比，暂不可采用。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '采用这条视频' })).toBeNull()
  })

  it('does not let an old initial Take read overwrite a newer local-import refresh', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const bytes = Uint8Array.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
    const file = new File([bytes], 'libtv-shot-01.mp4', { type: 'video/mp4' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) })
    let resolveInitial!: (value: YimengTakeVersionStackResponse) => void
    const initial = new Promise<YimengTakeVersionStackResponse>((resolve) => { resolveInitial = resolve })
    const base = takeVersionStackFixture({ projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId: 'frame_34b3741b1f0a' })
    const old = { ...base.subject.versions[0]!, takeId: 'old-take', outputAssetId: 'old-asset', outputSha256: 'a'.repeat(64),
      canAttemptSelection: false, lineageComplete: false, blockers: ['local_source_unverified'], source: 'local' as const, originalFileName: 'old-initial.mp4' }
    const fresh = { ...old, takeId: 'asset_localvideo_0123456789abcdef0123456789abcdef', outputAssetId: 'asset_localvideo_0123456789abcdef0123456789abcdef',
      outputSha256: 'b'.repeat(64), originalFileName: 'libtv-shot-01.mp4' }
    const oldStack: YimengTakeVersionStackResponse = {
      ...base,
      subject: { ...base.subject, selectedTakeId: null, versions: [old] },
    }
    const freshStack: YimengTakeVersionStackResponse = {
      ...base,
      subject: { ...base.subject, selectedTakeId: null, versions: [fresh] },
    }
    let uploaded = false
    let reads = 0
    const takeVersions = vi.fn(async ({ frameId }: { frameId: string }) => {
      reads += 1
      if (!uploaded) return initial
      return { ...freshStack, subject: { ...freshStack.subject, frameId } }
    })
    const scopedPort = {
      takeVersions,
      takePreview: vi.fn(),
      selectTakeVersion: vi.fn(),
      recoverTakeVersionSelection: vi.fn(),
      recoverLocalVideoCandidate: vi.fn(),
      uploadLocalVideoCandidate: vi.fn(async (request: {
        readonly idempotencyKey: string
        readonly originalFileName: string
        readonly contentBase64: string
      }) => {
        uploaded = true
        const inputSha256 = createHash('sha256').update(Buffer.from(request.contentBase64, 'base64')).digest('hex')
        const requestSha256 = createHash('sha256').update(JSON.stringify({ contentSha256: inputSha256,
          episodeId: 'episode_cd4ffe357df9', frameId: 'frame_34b3741b1f0a', originalFileName: request.originalFileName,
          sourceDeclaration: 'local_file_unverified' })).digest('hex')
        return { schema: 'jason.qingmu-local-video-candidate.v1', projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId: 'frame_34b3741b1f0a',
          assetId: fresh.takeId, takeId: fresh.takeId, idempotencyKey: request.idempotencyKey, requestSha256,
          originalFileName: request.originalFileName, byteSize: bytes.byteLength, mimeType: 'video/mp4', inputSha256, materializedSha256: inputSha256,
          durationSec: 8, width: 1280, height: 720, hasAudio: true, sourceDeclaration: 'local_file_unverified', rightsStatus: 'not_recorded',
          selectionStatus: 'Unselected', isSelected: false, providerCalls: 0, generationQueued: false }
      }) }
    const view = render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集"
      projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()}
      directorAssistant={null} port={scopedPort as never} t={key => key} />)
    const input = view.container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: '导入本镜候选' }))
    await screen.findByText('本地导入视频')
    await act(async () => { resolveInitial(oldStack) })
    expect(screen.queryByText('old-initial.mp4')).toBeNull()
    expect(screen.getByText('本地导入视频')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

it('saves missing imported frame requirements and recovers only the original intent', async () => {
  localStorage.clear()
  const scope = { projectId: 'project-planned', episodeId: 'episode-planned', shotId: 'frame-planned' }
  const original = { ...scope, schema: 'jason.qingmu-scene-planning-state.v1', scriptRevision: 1, scriptSha256: 'a'.repeat(64),
    storyboard: { id: 'revision-1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' }, canonicalStoryboard: null,
    frameRequirements: [{ id: scope.shotId, frameNo: 1, title: '相遇', imagePromptCn: '', blocking: '', cameraAngle: '' }] }
  const onStatus = vi.fn()
  const read = vi.fn().mockResolvedValue(original)
  const save = vi.fn().mockRejectedValue(new Error('lost response'))
  const recover = vi.fn().mockImplementation(async (pending) => {
    read.mockResolvedValue({ ...original,
      storyboard: { ...original.storyboard, version: 2, sourceHash: 'c'.repeat(64) },
      frameRequirements: [{ ...original.frameRequirements[0], imagePromptCn: pending.request.imagePromptCn }],
    })
    return { ...scope, action: 'edit_requirements', idempotencyKey: pending.idempotencyKey, providerCalls: 0,
      stageStarted: false, approvalGranted: false, storyboard: { version: 2, sourceHash: 'c'.repeat(64) } }
  })
  const props = { ...scope, port: { readScenePlanning: read, saveScenePlanning: save, recoverScenePlanning: recover },
    onCommitted: vi.fn(async () => undefined), onRequirementStatusChange: onStatus }
  const view = render(<AutomaticFrameRequirementsEditor {...props} />)
  await screen.findByRole('textbox', { name: '画面要求' })
  await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith('missing'))
  fireEvent.change(screen.getByRole('textbox', { name: '画面要求' }), { target: { value: '林予在左，陈远在右，录音笔置于桌面。' } })
  expect(onStatus).toHaveBeenLastCalledWith('missing')
  fireEvent.click(screen.getByRole('button', { name: '保存当前要求' }))
  await screen.findByRole('button', { name: '查看原保存结果' })
  const pending = save.mock.calls[0]?.[0]
  expect(pending.request).toMatchObject({ action: 'edit_requirements', shotId: scope.shotId, expectedStoryboardRevision: 1 })
  view.unmount()
  render(<AutomaticFrameRequirementsEditor {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看原保存结果' }))
  await screen.findByText('当前要求已保存')
  expect(recover).toHaveBeenCalledWith(pending)
  expect(save).toHaveBeenCalledOnce()
  await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith('ready'))
  cleanup()
})

it.each(['current', 'script-drift', 'scope-drift', 'read-failed', 'unknown-receipt'])(
  'recovers a rejected requirements intent safely: %s', async (outcome) => {
    localStorage.clear()
    const scope = { projectId: 'project-conflict', episodeId: 'episode-conflict', shotId: 'frame-conflict' }
    const original = { ...scope, scriptRevision: 1, scriptSha256: 'a'.repeat(64), canonicalStoryboard: null,
      storyboard: { id: 'revision-1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
      frameRequirements: [{ id: scope.shotId, frameNo: 1, title: '相遇', imagePromptCn: '原画面', blocking: '', cameraAngle: '' }] }
    const latest = { ...original, storyboard: { ...original.storyboard, version: 2, sourceHash: 'c'.repeat(64) },
      frameRequirements: [{ ...original.frameRequirements[0], imagePromptCn: '另一位编辑已保存的画面' }] }
    const read = vi.fn().mockResolvedValueOnce(original)
    if (outcome === 'read-failed') read.mockRejectedValue(new Error('network unavailable'))
    else read.mockResolvedValue({ ...latest,
      ...(outcome === 'script-drift' ? { scriptRevision: 2 } : {}),
      ...(outcome === 'scope-drift' ? { projectId: 'different-project' } : {}),
    })
    const save = vi.fn().mockRejectedValue(new Error('HTTP 409: planning_storyboard_conflict'))
    const recover = vi.fn().mockRejectedValue(new Error(outcome === 'unknown-receipt' ? 'HTTP 404: proxy unavailable' : 'HTTP 404: planning_receipt_not_found'))
    render(<AutomaticFrameRequirementsEditor {...scope} onCommitted={async () => undefined}
      port={{ readScenePlanning: read, saveScenePlanning: save, recoverScenePlanning: recover }} />)
    const input = await screen.findByRole('textbox', { name: '画面要求' })
    fireEvent.change(input, { target: { value: '保留我的画面草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存当前要求' }))
    await screen.findByRole('alert')
    const originalIntent = save.mock.calls[0]?.[0]
    fireEvent.click(screen.getByRole('button', { name: '查看原保存结果' }))
    await waitFor(() => expect(recover).toHaveBeenCalledWith(originalIntent))
    await waitFor(() => expect((screen.getByRole('button', { name: '查看原保存结果' }) as HTMLButtonElement).disabled).toBe(false))
    expect(save).toHaveBeenCalledOnce()
    expect((input as HTMLTextAreaElement).value).toBe('保留我的画面草稿')
    if (outcome === 'current') {
      expect(screen.getByText(/另一位编辑已保存的画面/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '保留草稿，按最新版本继续编辑' }))
      expect((input as HTMLTextAreaElement).disabled).toBe(false)
      expect(save).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: '保存当前要求' }))
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
      const nextIntent = save.mock.calls[1]?.[0]
      expect(nextIntent.idempotencyKey).not.toBe(originalIntent.idempotencyKey)
      expect(nextIntent.request).toMatchObject({ expectedStoryboardRevision: 2, expectedStoryboardSha256: 'c'.repeat(64), imagePromptCn: '保留我的画面草稿' })
    } else {
      expect((input as HTMLTextAreaElement).disabled).toBe(true)
      expect(screen.queryByRole('button', { name: '保留草稿，按最新版本继续编辑' })).toBeNull()
      expect(screen.queryByRole('button', { name: '保存当前要求' })).toBeNull()
    }
    cleanup()
  },
)
