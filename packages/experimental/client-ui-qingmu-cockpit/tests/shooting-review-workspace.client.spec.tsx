// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localHeroUrl, shootingPrimary, shootingTitle, ShootingReviewWorkspace } from '../src/client/ShootingReviewWorkspace.tsx'
import { AutomaticFrameRequirementsEditor } from '../src/client/AutomaticFrameRequirementsEditor.tsx'
import { takeVersionSelectionRequestFromMarker } from '../src/client/take-version-recovery.ts'

const projection = {
  director: { shotRelations: { storyboardRevision: { revisionId: 'storyboard-r1' }, shots: [
    { shotId: 'frame_34b3741b1f0a', frameNo: 6, title: '落日公路', sceneId: 'scene-1', beats: [], dialogueRhythm: { cues: [] } },
    { shotId: 'frame-7', frameNo: 7, title: '车内回望', sceneId: 'scene-1', beats: [], dialogueRhythm: { cues: [] } },
  ] }, heroFrameStoryboards: { shots: [{ shotId: 'frame_34b3741b1f0a', heroFrame: { assetId: 'asset_first_frame_6', browserUrl: `http://127.0.0.1:65269/api/media/media_first_frame_6?expires=1788767261&signature=${'a'.repeat(64)}` } }] } },
} as never

const port = {
  takeVersions: vi.fn(() => new Promise(() => {})),
  takePreview: vi.fn(),
  selectTakeVersion: vi.fn(),
  recoverTakeVersionSelection: vi.fn(),
} as never

describe('ShootingReviewWorkspace', () => {
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
  afterEach(cleanup)
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

  it('keeps an empty real candidate list neutral instead of calling it failed', async () => {
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection} selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} onNavigate={vi.fn()} directorAssistant={null} t={key => key} port={{ takePreview: vi.fn(), selectTakeVersion: vi.fn(), recoverTakeVersionSelection: vi.fn(), takeVersions: vi.fn(async () => ({ subject: { projectId: 'project_cd5eabc7582b', episodeId: 'episode_cd4ffe357df9', frameId: 'frame_34b3741b1f0a', selectedTakeId: null, versions: [] }, capabilities: { canSelect: false }, stackSnapshotSha256: 'a'.repeat(64) })) } as never} />)
    await waitFor(() => expect(document.querySelector('[data-state="pending-review"]')).toBeTruthy())
  })
})
