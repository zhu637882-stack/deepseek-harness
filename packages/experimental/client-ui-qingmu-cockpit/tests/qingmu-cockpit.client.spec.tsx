// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { YimengHealth, YimengWorkflowProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { QingmuCockpit, type QingmuCockpitProps } from '../src/client/QingmuCockpit.tsx'
import type { QingmuYimengPort } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import {
  createScriptCommitRecoveryMarker,
  readScriptCommitRecoveryMarker,
  writeScriptCommitRecoveryMarker,
} from '../src/client/script-commit-recovery.ts'

const t = ((key: keyof typeof zh) => zh[key]) as QingmuCockpitProps['t']
const neverHook = (() => { throw new Error('cockpit must not read global hooks') }) as never

const HEALTH: YimengHealth = {
  status: 'ok',
  liveness: true,
  runtime: {
    commit: 'runtime-commit',
    dirty: false,
    identitySource: 'release-manifest',
    matchesReleaseManifest: true,
  },
  build: { commit: 'build-commit' },
  hints: null,
}

const WORKFLOW: YimengWorkflowProjection = {
  schema: 'jason.episode-workflow-projection.v1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  sourceRevision: { revision: 'source-1' },
  inputFingerprint: 'fingerprint-1',
  activeTaskId: null,
  status: 'active',
  hasData: true,
  isStale: false,
  qualityPassed: true,
  selected: true,
  canProceed: true,
  stages: {
    script: {
      label: '剧本',
      status: 'approved',
      hasData: true,
      isStale: false,
      qualityPassed: true,
      selected: true,
      canProceed: true,
    },
  },
  stageHandoff: {},
  assets: {
    semanticItems: [{
      assetId: 'character-1',
      type: 'character',
      name: '林青',
      provenance: { reviewAccepted: false, reviewStatus: 'AwaitingHumanReview' },
    }],
  },
  director: {},
  shots: {
    count: 1,
    shotGroupCount: 1,
    segmentCount: 1,
    unresolvedAssetRefCount: 0,
    items: [{ shotId: 'shot-1', name: '雨夜相遇' }],
  },
  video: { candidates: [{ id: 'video-1' }], selected: [], completedCount: 1, qualityPassed: true },
  audio: { candidates: [], selected: [], dialogueLineCount: 2, qualityPassed: false },
  timeline: { hasData: true, selected: false, finalOutputs: [], qualityPassed: false },
  budget: {
    valid: true,
    window_id: 'budget-window-1',
    effective_cap_cny: 100,
    window_spent_cny: 10,
    window_remaining_cny: 90,
  },
  release: { releaseReady: true },
  blockers: [],
  legacy: {},
  interpretation: {
    providerAuthorization: 'not-exposed',
    humanSignoff: 'not-inferred',
    productionReadiness: 'not-inferred',
    statusFacts: ['budget.valid', 'release.releaseReady', 'qualityPassed'],
  },
}

const SCRIPT = {
  found: true,
  projectId: 'project-1',
  episodeId: 'episode-1',
  script: {
    scenes: [{ sceneIndex: 1, title: '旧走廊', actionDescription: '林青走进走廊。', dialogues: [] }],
  },
  scriptSha256: '0f9a610878bfed02b8475b394df23c38d13f3b02d134da72932b60e644f1b8ea',
  revision: 3,
  editedByUser: true,
  updatedAt: '2026-08-26T08:00:00+00:00',
} as const

const PROPOSED_SCRIPT = {
  durationScale: 0.000001,
  scenes: [{ sceneIndex: 1, title: '体育馆走廊', actionDescription: '林青走进走廊。', dialogues: [] }],
} as const

const CHANGE_SET = {
  schema: 'jason.qingmu-change-set.v1',
  id: 'changeset-1',
  workspaceId: null,
  projectId: 'project-1',
  episodeId: 'episode-1',
  targetType: 'episode_script',
  targetId: 'episode-1',
  baseRevision: 3,
  baseSnapshotSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64),
  originKind: 'human',
  actorUserId: 'user-1',
  harnessSessionId: null,
  status: 'proposed',
  authoritativeRevision: null,
  authoritativeSnapshotSha256: null,
  committedByUserId: null,
  committedEventId: null,
  committedAt: null,
  createdAt: '2026-08-26T08:01:00+00:00',
  updatedAt: '2026-08-26T08:01:00+00:00',
} as const

const AUTHORITATIVE_SCRIPT = {
  ...PROPOSED_SCRIPT,
  editMetadata: {
    editedByUser: true,
    editedAt: '2026-08-26T08:02:00+00:00',
    source: 'qingmu_change_set',
    changeSetId: CHANGE_SET.id,
    actorUserId: CHANGE_SET.actorUserId,
  },
} as const
const AUTHORITATIVE_SCRIPT_SHA256 = '03ac515dab97399dacf1d2413c096553698e100b38cc17affe68b1fff9c2bab2'

const PREVIEW = {
  schema: 'jason.qingmu-change-set-preview.v1',
  changeSet: CHANGE_SET,
  baseScript: SCRIPT.script,
  proposedScript: PROPOSED_SCRIPT,
  authoritativeCurrentScript: SCRIPT.script,
  changeSetId: CHANGE_SET.id,
  payloadSha256: CHANGE_SET.payloadSha256,
  baseRevision: 3,
  authoritativeRevision: 3,
  changed: true,
  changedPaths: ['$.scenes[0].title'],
  authoritativeChangedPaths: [],
  revisionConflict: false,
  baseSnapshotConflict: false,
  canCommit: true,
  invalidatedStages: ['assets', 'director', 'shots', 'video', 'audio', 'timeline'],
  preflight: { valid: true },
  references: [],
  previewSha256: 'c'.repeat(64),
} as const

const COMMIT = {
  schema: 'jason.qingmu-episode-script-commit-result.v1',
  changeSetId: CHANGE_SET.id,
  commandReceiptId: 'receipt-1',
  eventId: 'event-1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  baseRevision: 3,
  authoritativeRevision: 4,
  authoritativeSnapshotSha256: AUTHORITATIVE_SCRIPT_SHA256,
  payloadSha256: CHANGE_SET.payloadSha256,
  idempotencyKey: `qingmu:${CHANGE_SET.id}:${CHANGE_SET.payloadSha256}`,
  changed: true,
  invalidatedStages: PREVIEW.invalidatedStages,
  deduplicated: false,
  committedAt: '2026-08-26T08:02:00+00:00',
} as const

const RECOVERY = {
  schema: 'jason.qingmu-command-receipt-recovery.v1',
  recovered: true,
  receiptSha256: 'e'.repeat(64),
  receipt: COMMIT,
} as const

const ACTOR_PROFILE = {
  schema: 'jason.qingmu-element-profile-subject-read.v2',
  subject: {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: 'project-1',
    targetType: 'element_profile',
    elementKind: 'actor',
    actorId: 'character-1',
    profileRevision: 2,
    name: '林青',
    visualIdentity: '二十八岁女刑警，利落短发，深蓝防水外套。',
    officialReferenceImageUrl: null,
    references: [],
  },
  snapshotSha256: '8'.repeat(64),
} as const

function actorMethod(request: {
  readonly projectId: string
  readonly targetId: string
  readonly elementKind: 'actor' | 'scene' | 'prop'
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}) {
  return {
    schema: 'qingmu.imago-element-method-adapter-result.v1',
    projectionSha256: '9'.repeat(64),
    projection: {
      schema: 'qingmu.imago-element-method-projection.v1',
      input_snapshot_sha256: 'a'.repeat(64),
      subject: {
        project_id: request.projectId,
        target_type: 'element_profile',
        target_id: request.targetId,
        element_kind: request.elementKind,
        scope_type: 'project',
        scope_id: request.projectId,
        base_revision: request.baseRevision,
        base_snapshot_sha256: request.baseSnapshotSha256,
      },
      method_definition: {},
      source_bindings: [],
      field_hints: [],
      checklist: [],
      work_order_projection: {},
      review_card: { title: '人物资料审核', hard_vetoes: [] },
      legal_work_set: {},
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      paid_provider_authority: 'not_granted',
      human_approval_inferred: false,
      selection_authority: 'not_granted',
    },
    methodAttestation: {
      schema: 'qingmu.imago-element-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: '9'.repeat(64),
      inputSnapshotSha256: 'a'.repeat(64),
      subjectSha256: 'b'.repeat(64),
      signature: 'c'.repeat(64),
    },
  } as const
}

function makePort(overrides: Partial<QingmuYimengPort> = {}): QingmuYimengPort {
  return {
    health: vi.fn(async () => HEALTH),
    projects: vi.fn(async () => ({
      items: [{ id: 'project-1', name: '青木样片' }],
      pagination: { page: 1, pageSize: 100, pages: 1, total: 1 },
    })),
    episodes: vi.fn(async () => ({
      items: [{ id: 'episode-1', projectId: 'project-1', episodeNumber: 1, name: '雨夜' }],
    })),
    elementProfile: vi.fn(async () => ACTOR_PROFILE),
    referenceCandidates: vi.fn(async (request: Parameters<QingmuYimengPort['referenceCandidates']>[0]) => ({
      schema: 'jason.qingmu-reference-asset-candidates.v1',
      projectId: request.projectId,
      targetType: 'element_profile',
      targetId: request.targetId,
      elementKind: request.elementKind,
      profileRevision: 2,
      elementSnapshotSha256: ACTOR_PROFILE.snapshotSha256,
      candidates: [],
      humanApprovalInferred: false,
    } as const)),
    reviewEvents: vi.fn(async (request: Parameters<QingmuYimengPort['reviewEvents']>[0]) => ({
      schema: 'jason.qingmu-element-review-feed.v1',
      projectId: request.projectId,
      elementKind: request.elementKind,
      targetId: request.targetId,
      subject: {
        type: 'element_profile',
        id: request.targetId,
        revision: 2,
        sha256: ACTOR_PROFILE.snapshotSha256,
      },
      capabilities: { canComment: true, canDecide: true },
      comments: [],
      decisions: [],
      currentDecision: null,
    } as const)),
    referenceRightsExceptionReleases: vi.fn(async (
      request: Parameters<QingmuYimengPort['referenceRightsExceptionReleases']>[0],
    ) => ({
      schema: 'jason.qingmu-reference-rights-exception-release-feed.v1',
      projectId: request.projectId,
      elementKind: request.elementKind,
      targetId: request.targetId,
      subject: {
        type: 'element_profile',
        id: request.targetId,
        revision: 2,
        sha256: ACTOR_PROFILE.snapshotSha256,
      },
      capabilities: {
        canRelease: false,
        blockedReasonCode: 'reference_rights_unavailable',
        blockedReason: '当前没有可绑定的参考资产权利记录',
        requiresRecentAuthentication: true,
      },
      releases: [],
      currentReleases: [],
    } as const)),
    elementMethod: vi.fn(async (request: Parameters<QingmuYimengPort['elementMethod']>[0]) => actorMethod(request)),
    referenceAssetMethod: vi.fn(async () => { throw new Error('reference method is not part of this fixture') }),
    script: vi.fn(async () => SCRIPT),
    promptIr: vi.fn(async () => { throw new Error('PromptIR read is not part of this fixture') }),
    promptIrMethod: vi.fn(async () => { throw new Error('PromptIR method is not part of this fixture') }),
    workflow: vi.fn(async () => WORKFLOW),
    proposeElementProfile: vi.fn(async () => { throw new Error('element proposal is not part of this fixture') }),
    proposeReferenceAsset: vi.fn(async () => { throw new Error('reference proposal is not part of this fixture') }),
    previewElementProfile: vi.fn(async () => { throw new Error('element preview is not part of this fixture') }),
    commitElementProfile: vi.fn(async () => { throw new Error('element commit is not part of this fixture') }),
    recoverElementProfileCommit: vi.fn(async () => { throw new Error('element recovery is not part of this fixture') }),
    createComment: vi.fn(async () => { throw new Error('comment is not part of this fixture') }),
    createHumanDecision: vi.fn(async () => { throw new Error('HumanDecision is not part of this fixture') }),
    createReferenceRightsExceptionRelease: vi.fn(async () => {
      throw new Error('reference-rights exception release is not part of this fixture')
    }),
    recoverReferenceRightsExceptionRelease: vi.fn(async () => {
      throw new Error('reference-rights exception recovery is not part of this fixture')
    }),
    proposeScript: vi.fn(async () => ({
      schema: 'jason.qingmu-change-set-proposal.v1',
      changeSet: CHANGE_SET,
      nextAction: 'preview',
    } as const)),
    previewScript: vi.fn(async () => PREVIEW),
    commitScript: vi.fn(async () => COMMIT),
    recoverScriptCommit: vi.fn(async () => RECOVERY),
    proposePromptIr: vi.fn(async () => { throw new Error('PromptIR proposal is not part of this fixture') }),
    previewPromptIr: vi.fn(async () => { throw new Error('PromptIR preview is not part of this fixture') }),
    commitPromptIrEdit: vi.fn(async () => { throw new Error('PromptIR edit commit is not part of this fixture') }),
    recoverPromptIrEditCommit: vi.fn(async () => { throw new Error('PromptIR edit recovery is not part of this fixture') }),
    selectPromptIr: vi.fn(async () => { throw new Error('PromptIR selection is not part of this fixture') }),
    recoverPromptIrSelection: vi.fn(async () => { throw new Error('PromptIR selection recovery is not part of this fixture') }),
    ...overrides,
  }
}

function mount(port: QingmuYimengPort) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  return render(
    <QingmuCockpit wide port={port} t={t} useSessions={neverHook} useWorkspaces={neverHook} />,
    { container: root },
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('QingmuCockpit journey', () => {
  it('opens the five-tab projection, states authority boundaries, and restores trigger focus on close', async () => {
    const workflow = vi.fn(async () => WORKFLOW)
    const port = makePort({ workflow })
    mount(port)
    const trigger = screen.getByRole('button', { name: zh.trigger })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: zh.title })
    await waitFor(() => {
      expect(workflow).toHaveBeenCalledWith(
        { projectId: 'project-1', episodeId: 'episode-1' },
        expect.any(AbortSignal),
      )
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByText(zh.truthBoundaryBody)).toBeTruthy()
    expect(within(dialog).getByText('jason.episode-workflow-projection.v1')).toBeTruthy()
    const projectSelect = within(dialog).getByRole('combobox', { name: zh.project })
    expect(projectSelect).toBeInstanceOf(HTMLSelectElement)
    if (!(projectSelect instanceof HTMLSelectElement)) throw new Error('project selector should be a select')
    expect(projectSelect.value).toBe('project-1')

    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual([
      zh.tabOverview,
      zh.tabAssets,
      zh.tabShots,
      zh.tabGeneration,
      zh.tabDelivery,
    ])
    expect(within(dialog).getByRole('heading', { name: zh.stages })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    expect(within(dialog).getAllByText('林青').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getByText(zh.humanPending)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabShots }))
    expect(within(dialog).getByText('雨夜相遇')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabGeneration }))
    expect(within(dialog).getByRole('heading', { name: zh.generationTitle })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabDelivery }))
    expect(within(dialog).getByText(zh.budgetDisclaimer)).toBeTruthy()
    expect(within(dialog).getByText(zh.releaseDisclaimer)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: zh.close }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: zh.title })).toBeNull() })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows Host-only token recovery when protected reads fail before projection', async () => {
    const projects = vi.fn(async () => {
      throw new Error('unauthorized: YIMENG_API_TOKEN is not configured in the Host environment')
    })
    const episodes = vi.fn(async () => ({ items: [] }))
    const workflow = vi.fn(async () => WORKFLOW)
    const port = makePort({ projects, episodes, workflow })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('YIMENG_API_TOKEN')
    expect(alert.textContent).toContain(zh.errorRecovery)
    expect(alert.textContent).toContain('令牌不会进入浏览器界面')
    expect(episodes).not.toHaveBeenCalled()
    expect(workflow).not.toHaveBeenCalled()
  })

  it('previews an immutable script ChangeSet and commits only after explicit confirmation', async () => {
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce({
        ...SCRIPT,
        script: AUTHORITATIVE_SCRIPT,
        scriptSha256: AUTHORITATIVE_SCRIPT_SHA256,
        revision: 4,
        updatedAt: COMMIT.committedAt,
      })
    const proposeScript = vi.fn(async () => ({
      schema: 'jason.qingmu-change-set-proposal.v1' as const,
      changeSet: CHANGE_SET,
      nextAction: 'preview' as const,
    }))
    const previewScript = vi.fn(async () => PREVIEW)
    const commitScript = vi.fn(async () => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
      return COMMIT
    })
    const workflow = vi.fn(async () => WORKFLOW)
    const port = makePort({ script, proposeScript, previewScript, commitScript, workflow })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    await waitFor(() => { expect(workflow).toHaveBeenCalledTimes(1) })

    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    await waitFor(() => {
      expect(script).toHaveBeenCalledWith(
        { projectId: 'project-1', episodeId: 'episode-1' },
        expect.any(AbortSignal),
      )
    })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript, null, 2) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    await waitFor(() => {
      expect(proposeScript).toHaveBeenCalledWith({
        projectId: 'project-1',
        episodeId: 'episode-1',
        script: PREVIEW.proposedScript,
        baseRevision: 3,
      }, expect.any(AbortSignal))
      expect(previewScript).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          episodeId: 'episode-1',
          changeSetId: CHANGE_SET.id,
          baseRevision: 3,
        },
        expect.any(AbortSignal),
      )
    })
    expect(await within(dialog).findByText('$.scenes[0].title')).toBeTruthy()

    const commitButton = within(dialog).getByRole('button', { name: zh.commitScript }) as HTMLButtonElement
    expect(commitButton.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: zh.commitConfirmLabel }))
    expect(commitButton.disabled).toBe(false)
    fireEvent.click(commitButton)

    await waitFor(() => {
      expect(commitScript).toHaveBeenCalledWith({
        projectId: 'project-1',
        episodeId: 'episode-1',
        changeSetId: CHANGE_SET.id,
        baseRevision: 3,
        idempotencyKey: `qingmu:${CHANGE_SET.id}:${CHANGE_SET.payloadSha256}`,
        expectedPayloadSha256: CHANGE_SET.payloadSha256,
      }, expect.any(AbortSignal))
    })
    expect(await within(dialog).findByRole('heading', { name: zh.commitSucceeded })).toBeTruthy()
    expect(within(dialog).getByText(COMMIT.commandReceiptId)).toBeTruthy()
    expect(within(dialog).getByText(COMMIT.eventId)).toBeTruthy()
    await waitFor(() => {
      expect(script).toHaveBeenCalledTimes(2)
      expect(workflow).toHaveBeenCalledTimes(2)
    })
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
  })

  it('fails closed when the preview reports an authority conflict', async () => {
    const conflict = {
      ...PREVIEW,
      authoritativeRevision: 4,
      revisionConflict: true,
      canCommit: false,
    }
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ previewScript: vi.fn(async () => conflict), commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    expect(await within(dialog).findByText(zh.conflictTitle)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('fails closed when the preview contains a different proposed script', async () => {
    const mismatchedPreview = {
      ...PREVIEW,
      proposedScript: { scenes: [{ title: '被错配的另一份剧本' }] },
    }
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ previewScript: vi.fn(async () => mismatchedPreview), commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('拟提交内容不一致')
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('fails closed when the preview belongs to a different episode subject', async () => {
    const mismatchedPreview = {
      ...PREVIEW,
      changeSet: {
        ...CHANGE_SET,
        episodeId: 'episode-2',
        targetId: 'episode-2',
      },
    }
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ previewScript: vi.fn(async () => mismatchedPreview), commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('预览血缘')
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('rejects a commit receipt whose base revision is not the confirmed preview base', async () => {
    const script = vi.fn(async () => SCRIPT)
    const commitScript = vi.fn(async () => ({ ...COMMIT, baseRevision: 2 }))
    const port = makePort({ script, commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    const commitButton = within(dialog).getByRole('button', { name: zh.commitScript })
    fireEvent.click(checkbox)
    fireEvent.click(commitButton)

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('提交回执与本次 ChangeSet 血缘不一致')
    expect(within(dialog).queryByRole('heading', { name: zh.commitSucceeded })).toBeNull()
    expect(within(dialog).getByRole('heading', { name: zh.receiptRecoveryTitle })).toBeTruthy()
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(script).toHaveBeenCalledOnce()
  })

  it('keeps the confirmed snapshot when the post-commit reread has a stale revision', async () => {
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce({ ...SCRIPT, revision: 5, updatedAt: COMMIT.committedAt })
    const port = makePort({ script })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    fireEvent.click(checkbox)
    fireEvent.click(within(dialog).getByRole('button', { name: zh.commitScript }))

    expect(await within(dialog).findByRole('heading', { name: zh.commitSucceeded })).toBeTruthy()
    expect(await within(dialog).findByText(/剧本版本与提交回执不一致/)).toBeTruthy()
    const revisionLabels = within(dialog).getAllByText(zh.scriptRevision)
    expect(revisionLabels[0]?.nextElementSibling?.textContent).toBe('3')
    expect(script).toHaveBeenCalledTimes(2)
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
  })

  it('retains a recovery marker and prevents commit resubmission after a commit response failure', async () => {
    const commitScript = vi.fn(async () => { throw new Error('isolated commit failure') })
    const port = makePort({ commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))

    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    const commitButton = within(dialog).getByRole('button', { name: zh.commitScript })
    if (!(checkbox instanceof HTMLInputElement) || !(commitButton instanceof HTMLButtonElement)) {
      throw new Error('commit controls should use native form elements')
    }
    fireEvent.click(checkbox)
    fireEvent.click(commitButton)

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('isolated commit failure')
    expect(within(dialog).getByRole('heading', { name: zh.receiptRecoveryTitle })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(commitScript).toHaveBeenCalledOnce()
  })

  it('does not submit when the recovery marker cannot be written and read back', async () => {
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))
    const checkbox = await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel })
    fireEvent.click(checkbox)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError')
    })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.commitScript }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(zh.receiptRecoveryStorageFailed)
    expect(commitScript).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('recovers an accepted commit after closing the modal without resubmitting it', async () => {
    let commitStarted = () => {}
    const started = new Promise<void>((resolve) => { commitStarted = resolve })
    const committedScript = {
      ...SCRIPT,
      script: AUTHORITATIVE_SCRIPT,
      scriptSha256: AUTHORITATIVE_SCRIPT_SHA256,
      revision: 4,
      updatedAt: COMMIT.committedAt,
    }
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce(committedScript)
      .mockResolvedValueOnce(committedScript)
    const commitScript = vi.fn<QingmuYimengPort['commitScript']>((_request, signal) => new Promise<typeof COMMIT>((_resolve, reject) => {
      commitStarted()
      signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    }))
    const recoverScriptCommit = vi.fn(async () => RECOVERY)
    const port = makePort({ script, commitScript, recoverScriptCommit })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    let dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const editor = await within(dialog).findByRole('textbox', { name: zh.scriptDraftLabel })
    fireEvent.change(editor, { target: { value: JSON.stringify(PREVIEW.proposedScript) } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.preparePreview }))
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: zh.commitConfirmLabel }))
    fireEvent.click(within(dialog).getByRole('button', { name: zh.commitScript }))
    await started
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')

    fireEvent.click(within(dialog).getByRole('button', { name: zh.close }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: zh.title })).toBeNull() })
    expect(commitScript).toHaveBeenCalledOnce()
    expect(recoverScriptCommit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const recoverButton = await within(dialog).findByRole('button', { name: zh.recoverReceipt })
    expect(within(dialog).queryByRole('button', { name: zh.commitScript })).toBeNull()
    fireEvent.click(recoverButton)

    expect(await within(dialog).findByRole('heading', { name: zh.receiptRecovered })).toBeTruthy()
    expect(committedScript.script.editMetadata.source).toBe('qingmu_change_set')
    expect(committedScript.script.durationScale).toBe(0.000001)
    expect(within(dialog).getByText(COMMIT.commandReceiptId)).toBeTruthy()
    expect(recoverScriptCommit).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    }, expect.any(AbortSignal))
    expect(commitScript).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
    })
  })

  it('retains a failed recovery until the user explicitly discards only the local marker', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const commitScript = vi.fn(async () => COMMIT)
    const recoverScriptCommit = vi.fn(async () => { throw new Error('receipt not found') })
    const port = makePort({ commitScript, recoverScriptCommit })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    const recoverButton = await within(dialog).findByRole('button', { name: zh.recoverReceipt })
    fireEvent.click(recoverButton)

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('receipt not found')
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    const editor = within(dialog).getByRole('textbox', { name: zh.scriptDraftLabel })
    expect(editor).toBeInstanceOf(HTMLTextAreaElement)
    expect((editor as HTMLTextAreaElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: zh.discardRecoveryMarker }))
    await waitFor(() => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
    })
    expect((editor as HTMLTextAreaElement).disabled).toBe(false)
    expect(commitScript).not.toHaveBeenCalled()
    expect(recoverScriptCommit).toHaveBeenCalledOnce()
  })

  it('fails closed on recovered receipt lineage mismatch and retains the marker', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const recoverScriptCommit = vi.fn<QingmuYimengPort['recoverScriptCommit']>(async () => ({
      ...RECOVERY,
      receipt: { ...COMMIT, payloadSha256: 'f'.repeat(64) },
    }))
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ recoverScriptCommit, commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    fireEvent.click(await within(dialog).findByRole('button', { name: zh.recoverReceipt }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('提交回执与本次 ChangeSet 血缘不一致')
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(commitScript).not.toHaveBeenCalled()
  })

  it('retains the marker when a recovered receipt revision matches but the authoritative script hash does not', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const wrongAuthoritativeScript = {
      ...SCRIPT,
      script: { scenes: [{ sceneIndex: 1, title: '同修订号但内容已被替换', dialogues: [] }] },
      scriptSha256: 'd'.repeat(64),
      revision: COMMIT.authoritativeRevision,
      updatedAt: COMMIT.committedAt,
    }
    const script = vi.fn()
      .mockResolvedValueOnce(SCRIPT)
      .mockResolvedValueOnce(wrongAuthoritativeScript)
    const recoverScriptCommit = vi.fn(async () => RECOVERY)
    const commitScript = vi.fn(async () => COMMIT)
    const port = makePort({ script, recoverScriptCommit, commitScript })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    fireEvent.click(await within(dialog).findByRole('button', { name: zh.recoverReceipt }))

    expect(await within(dialog).findByText(/权威剧本内容哈希与提交回执不一致/)).toBeTruthy()
    expect(readScriptCommitRecoveryMarker('project-1', 'episode-1').status).toBe('ready')
    expect(commitScript).not.toHaveBeenCalled()
    expect(recoverScriptCommit).toHaveBeenCalledOnce()
  })

  it('allows explicit subject-scoped discard of an invalid marker without calling Yimeng', async () => {
    const marker = createScriptCommitRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      changeSetId: CHANGE_SET.id,
      baseRevision: 3,
      idempotencyKey: COMMIT.idempotencyKey,
      expectedPayloadSha256: CHANGE_SET.payloadSha256,
    })
    expect(writeScriptCommitRecoveryMarker(marker)).toBe(true)
    const key = sessionStorage.key(0)
    if (key === null) throw new Error('recovery marker key should exist')
    sessionStorage.setItem(key, '{"schema":"tampered"}')
    const commitScript = vi.fn(async () => COMMIT)
    const recoverScriptCommit = vi.fn(async () => RECOVERY)
    const port = makePort({ commitScript, recoverScriptCommit })
    mount(port)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.title })
    fireEvent.click(within(dialog).getByRole('tab', { name: zh.tabAssets }))
    expect(await within(dialog).findByText(zh.receiptRecoveryInvalidTitle)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: zh.discardRecoveryMarker }))
    await waitFor(() => {
      expect(readScriptCommitRecoveryMarker('project-1', 'episode-1')).toEqual({ status: 'none' })
    })
    expect(commitScript).not.toHaveBeenCalled()
    expect(recoverScriptCommit).not.toHaveBeenCalled()
  })
})
