// Qingmu-only browser regression for bounded script and element-profile ChangeSet paths.
// The assembled Host talks only to a loopback Yimeng double; no model, Provider,
// production service, or persistent business database participates.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const YIMENG_TOKEN = 'qingmu-script-workspace-test-token'
const CHANGE_SET_ID = 'changeset-episode-script-1'
const PAYLOAD_SHA = 'b'.repeat(64)
const SNAPSHOT_SHA = 'a'.repeat(64)
const PREVIEW_SHA = 'c'.repeat(64)
const AUTHORITATIVE_SNAPSHOT_SHA = 'f4c47285580233784e57dc488ddecdb2d950e4e8930a571a78d123b670f1e207'
const RECEIPT_SHA = 'f87f149854a67bc6f4e20905fd2404e9fd9e781ebbfad93666c1df2fb118af5b'
const IDEMPOTENCY_KEY = `qingmu:${CHANGE_SET_ID}:${PAYLOAD_SHA}`
const PROP_CHANGE_SET_ID = 'changeset-prop-profile-1'
const PROP_PAYLOAD_SHA = '7'.repeat(64)
const PROP_PREVIEW_SHA = '8'.repeat(64)
const PROP_REFERENCE_SHA = '9'.repeat(64)
const PROP_IDEMPOTENCY_KEY = `qingmu:element:v4:901eb1d9b9cc01ab20ba965f30018b23198518fd59a65d13cd547a64e931effc:${PROP_PAYLOAD_SHA}`
const PROP_ORIGINAL_PROMPT = '一枚磨损的银色怀表，表盖闭合。'
const PROP_UPDATED_PROMPT = '一枚磨损的银色怀表，表盖有细小裂痕，指针停在午夜十二点。'
const ACTOR_CHANGE_SET_ID = 'changeset-actor-profile-1'
const ACTOR_PAYLOAD_SHA = '1'.repeat(64)
const ACTOR_PREVIEW_SHA = '2'.repeat(64)
const ACTOR_REFERENCE_SHA = '3'.repeat(64)
const ACTOR_IDEMPOTENCY_KEY = `qingmu:element:v4:${createHash('sha256').update(ACTOR_CHANGE_SET_ID, 'utf8').digest('hex')}:${ACTOR_PAYLOAD_SHA}`
const ACTOR_ORIGINAL_IDENTITY = '林青，二十七岁，短黑发，左眉尾有浅疤，深灰风衣。'
const ACTOR_UPDATED_IDENTITY = '林青，二十七岁，短黑发，左眉尾有浅疤，深灰风衣，右手戴旧银戒。'
const SCENE_CHANGE_SET_ID = 'changeset-scene-profile-1'
const SCENE_PAYLOAD_SHA = '4'.repeat(64)
const SCENE_PREVIEW_SHA = '5'.repeat(64)
const SCENE_REFERENCE_SHA = '6'.repeat(64)
const SCENE_ORIGINAL_PROMPT = '雨夜里的旧体育馆走廊，冷白顶灯，湿润水磨石地面。'
const SCENE_UPDATED_PROMPT = '雨夜里的旧体育馆走廊，冷白顶灯间歇闪烁，湿润水磨石地面映出长条反光。'
const REFERENCE_SELECT_CHANGE_SET_ID = 'changeset-scene-reference-select-1'
const REFERENCE_SELECT_PAYLOAD_SHA = 'd'.repeat(64)
const REFERENCE_SELECT_IDEMPOTENCY_KEY = `qingmu:element:v4:${createHash('sha256').update(REFERENCE_SELECT_CHANGE_SET_ID, 'utf8').digest('hex')}:${REFERENCE_SELECT_PAYLOAD_SHA}`
const REFERENCE_REGEN_CHANGE_SET_ID = 'changeset-scene-reference-regeneration-1'
const REFERENCE_REGEN_PAYLOAD_SHA = 'e'.repeat(64)
const REFERENCE_REGEN_IDEMPOTENCY_KEY = `qingmu:element:v4:${createHash('sha256').update(REFERENCE_REGEN_CHANGE_SET_ID, 'utf8').digest('hex')}:${REFERENCE_REGEN_PAYLOAD_SHA}`
const REFERENCE_RIGHTS_CHANGE_SET_ID = 'changeset-prop-reference-rights-1'
const REFERENCE_RIGHTS_PAYLOAD_SHA = '54'.repeat(32)
const REFERENCE_RIGHTS_PREVIEW_SHA = '65'.repeat(32)
const REFERENCE_RIGHTS_IDEMPOTENCY_KEY = `qingmu:element:v4:${createHash('sha256').update(REFERENCE_RIGHTS_CHANGE_SET_ID, 'utf8').digest('hex')}:${REFERENCE_RIGHTS_PAYLOAD_SHA}`
const SCENE_SELECT_ASSET_ID = 'scene-reference-candidate-1'
const SCENE_SELECT_ASSET_SHA = 'ab'.repeat(32)
const SCENE_REPAIR_ASSET_ID = 'scene-reference-rejected-1'
const SCENE_REPAIR_ASSET_SHA = 'cd'.repeat(32)
const SCENE_STALE_ASSET_ID = 'scene-reference-stale-1'
const SCENE_STALE_ASSET_SHA = 'ef'.repeat(32)
const REFERENCE_REPAIR_PROMPT = '保留走廊冷白灯和湿润地面，修复画面边缘断裂与人物残影。'
const PROMPT_IR_STORYBOARD_REVISION_ID = 'storyboard-revision-1'
const PROMPT_IR_FRAME_ID = 'frame-1'
const PROMPT_IR_TARGET_ID = `${PROMPT_IR_STORYBOARD_REVISION_ID}:${PROMPT_IR_FRAME_ID}`
const PROMPT_IR_READY_ID = 'prompt-ir-ready-4'
const PROMPT_IR_DRAFT_ID = 'prompt-ir-draft-5'
const PROMPT_IR_READY_VERSION = 4
const PROMPT_IR_DRAFT_VERSION = 5
const PROMPT_IR_READY_CONTENT_SHA = '31'.repeat(32)
const PROMPT_IR_DRAFT_CONTENT_SHA = '42'.repeat(32)
const PROMPT_IR_CHANGE_SET_ID = 'changeset-prompt-ir-1'
const PROMPT_IR_PAYLOAD_SHA = '53'.repeat(32)
const PROMPT_IR_BASE_EDITABLE = {
  imageGenPrompt: '雨夜车站首帧，林青站在站牌旁。',
  lastFrameImagePrompt: '',
  videoGenPrompt: '镜头缓慢前推，林青抬头看向远处。',
  motionPrompt: '雨丝斜落，风衣衣角轻摆。',
  negativePrompt: '无文字，无水印，不增加人物。',
} as const
const PROMPT_IR_CANDIDATE_EDITABLE = {
  ...PROMPT_IR_BASE_EDITABLE,
  videoGenPrompt: '镜头稳定前推，林青抬头后停住，保持动作连续。',
} as const
const PROMPT_IR_EDIT_IDEMPOTENCY_KEY = `qingmu:prompt-ir:edit:v1:${createHash('sha256').update(PROMPT_IR_CHANGE_SET_ID, 'utf8').digest('hex')}:${PROMPT_IR_PAYLOAD_SHA}`
const PROMPT_IR_SELECTION_IDEMPOTENCY_KEY = `qingmu:prompt-ir:select:v1:${createHash('sha256').update(JSON.stringify([
  'project-1',
  'episode-1',
  PROMPT_IR_STORYBOARD_REVISION_ID,
  PROMPT_IR_FRAME_ID,
  PROMPT_IR_DRAFT_ID,
  PROMPT_IR_DRAFT_VERSION,
  PROMPT_IR_DRAFT_CONTENT_SHA,
]), 'utf8').digest('hex')}`
const IMAGO_ATTESTATION_KEY = 'qingmu-real-host-chromium-attestation-key-测试'
const ORIGINAL_TOKEN = process.env.YIMENG_API_TOKEN
const ORIGINAL_ATTESTATION_KEY = process.env.QINGMU_IMAGO_ATTESTATION_KEY
const IMAGO_CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const QINGMU_OVERLAY = join(REPO_ROOT, 'packages/experimental/qingmu-web/cordis.patch.yml')

function resolveQingmuOverlayEntrypoints(source: string): string {
  const builtEntrypoints = [
    ['@deepseek-ai/dsh-experimental-client-ui-brand-qingmu', 'packages/experimental/client-ui-brand-qingmu/lib/index.js'],
    ['@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter', 'packages/experimental/qingmu-yimeng-read-adapter/lib/index.js'],
    ['@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter', 'packages/experimental/qingmu-imago-method-adapter/lib/index.js'],
    ['@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter', 'packages/experimental/qingmu-yimeng-command-adapter/lib/index.js'],
    ['@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit', 'packages/experimental/client-ui-qingmu-cockpit/lib/index.js'],
  ] as const

  let resolved = source
  for (const [packageName, relativeEntrypoint] of builtEntrypoints) {
    const packageReference = `name: '${packageName}'`
    if (!resolved.includes(packageReference)) {
      throw new Error(`Qingmu overlay no longer references ${packageName}`)
    }
    const entrypointUrl = pathToFileURL(join(REPO_ROOT, relativeEntrypoint)).href
    resolved = resolved.replace(packageReference, `name: ${JSON.stringify(entrypointUrl)}`)
  }
  return resolved
}

async function mountQingmuClientPackage(
  scaffold: WebScaffold,
  packageName: string,
  relativePackageDir: string,
): Promise<void> {
  const moduleLink = join(scaffold.harnessHome, 'profiles', 'node_modules', ...packageName.split('/'))
  await mkdir(dirname(moduleLink), { recursive: true })
  await symlink(join(REPO_ROOT, relativePackageDir), moduleLink, 'dir')
  await scaffold.ctx.loader.create({ name: packageName })
}

const INITIAL_SCRIPT = {
  scenes: [{
    sceneIndex: 1,
    title: '旧走廊',
    actionDescription: '林青走进走廊。',
    dialogues: [],
  }],
}

const PROPOSED_SCRIPT = {
  durationScale: 0.000001,
  scenes: [{
    sceneIndex: 1,
    title: '体育馆走廊',
    actionDescription: '林青走进走廊。',
    dialogues: [],
  }],
}

const AUTHORITATIVE_SCRIPT = {
  ...PROPOSED_SCRIPT,
  editMetadata: {
    editedByUser: true,
    editedAt: '2026-08-26T08:02:00+00:00',
    source: 'qingmu_change_set',
    changeSetId: CHANGE_SET_ID,
    actorUserId: 'owner-1',
  },
}
const INITIAL_SCRIPT_CANONICAL_JSON = '{"scenes":[{"actionDescription":"林青走进走廊。","dialogues":[],"sceneIndex":1,"title":"旧走廊"}]}'
const INITIAL_SCRIPT_SHA256 = '0f9a610878bfed02b8475b394df23c38d13f3b02d134da72932b60e644f1b8ea'
const AUTHORITATIVE_SCRIPT_CANONICAL_JSON = '{"durationScale":1e-06,"editMetadata":{"actorUserId":"owner-1","changeSetId":"changeset-episode-script-1","editedAt":"2026-08-26T08:02:00+00:00","editedByUser":true,"source":"qingmu_change_set"},"scenes":[{"actionDescription":"林青走进走廊。","dialogues":[],"sceneIndex":1,"title":"体育馆走廊"}]}'

interface CapturedYimengRequest {
  readonly method: string
  readonly path: string
  readonly authorization: string | undefined
  readonly idempotencyKey: string | undefined
  readonly cookie: string | undefined
  readonly body: unknown
}

type ElementKind = 'actor' | 'scene' | 'prop'

const ELEMENT_FIXTURES = {
  actor: {
    targetId: 'actor-1',
    name: '林青',
    changeSetId: ACTOR_CHANGE_SET_ID,
    payloadSha256: ACTOR_PAYLOAD_SHA,
    previewSha256: ACTOR_PREVIEW_SHA,
    referenceSha256: ACTOR_REFERENCE_SHA,
    originalValue: ACTOR_ORIGINAL_IDENTITY,
    updatedValue: ACTOR_UPDATED_IDENTITY,
    operation: 'replaceVisualIdentity',
    methodId: 'imago-v6-b2ac-actor-profile',
  },
  scene: {
    targetId: 'scene-1',
    name: '旧体育馆走廊',
    changeSetId: SCENE_CHANGE_SET_ID,
    payloadSha256: SCENE_PAYLOAD_SHA,
    previewSha256: SCENE_PREVIEW_SHA,
    referenceSha256: SCENE_REFERENCE_SHA,
    originalValue: SCENE_ORIGINAL_PROMPT,
    updatedValue: SCENE_UPDATED_PROMPT,
    operation: 'replaceVisualPrompt',
    methodId: 'imago-v6-b2as-scene-profile',
  },
  prop: {
    targetId: 'prop-1',
    name: '银色怀表',
    changeSetId: PROP_CHANGE_SET_ID,
    payloadSha256: PROP_PAYLOAD_SHA,
    previewSha256: PROP_PREVIEW_SHA,
    referenceSha256: PROP_REFERENCE_SHA,
    originalValue: PROP_ORIGINAL_PROMPT,
    updatedValue: PROP_UPDATED_PROMPT,
    operation: 'replaceVisualPrompt',
    methodId: 'imago-v6-b2as-prop-profile',
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareUnicodeCodePoints).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('fixture is not canonical JSON')
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function commandRecoveryVisualBaselineSha256(subject: Record<string, unknown>): string {
  const baseline = (['visualIdentity', 'visualPrompt', 'officialReferenceImageUrl'] as const).map((field) => {
    const value = subject[field]
    const normalized = !Object.prototype.hasOwnProperty.call(subject, field)
      ? ['absent']
      : value === null
        ? ['null']
        : ['string', value]
    return [field, normalized]
  })
  return createHash('sha256').update(JSON.stringify(baseline), 'utf8').digest('hex')
}

function commandRecoveryHumanDecisionsSha256(decisions: readonly Record<string, unknown>[]): string {
  const normalized = decisions.map(decision => JSON.stringify({
    id: decision.id,
    subjectType: decision.subjectType,
    subjectId: decision.subjectId,
    subjectRevision: decision.subjectRevision,
    subjectSha256: decision.subjectSha256,
    decision: decision.decision,
    reason: decision.reason,
    actorId: decision.actorId,
    actorRole: decision.actorRole,
    authSessionId: decision.authSessionId,
    decidedAt: decision.decidedAt,
  })).sort()
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')
}

function unknownReferenceRightsRecord() {
  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: { state: 'unknown', value: null },
    rightsHolder: { state: 'unknown', value: null },
    authorizationScope: { state: 'unknown', values: [] },
    territory: { state: 'unknown', values: [] },
    term: { state: 'unknown', startsAt: null, endsAt: null, perpetual: null },
    restrictions: { state: 'unknown', values: [] },
    contains: {
      realPersonLikeness: 'unknown',
      trademark: 'unknown',
      music: 'unknown',
      font: 'unknown',
      thirdPartyCharacter: 'unknown',
    },
    providerTerms: { state: 'unknown', terms: null, reviewedAt: null },
    modelLicenses: {
      code: { state: 'unknown', value: null },
      weights: { state: 'unknown', value: null },
      outputUse: { state: 'unknown', value: null },
    },
    humanDeclaration: { state: 'unknown', text: null },
    contentCredentials: { state: 'unknown', value: null },
  } as const
}

function recordedReferenceRightsRecord() {
  return {
    ...unknownReferenceRightsRecord(),
    sourceType: { state: 'known', value: 'commissioned' },
    rightsHolder: { state: 'known', value: '青木工作室' },
  } as const
}

type ReferenceRightsState = {
  readonly rightsRecorded: boolean
  readonly rights: ReturnType<typeof unknownReferenceRightsRecord> | ReturnType<typeof recordedReferenceRightsRecord>
}

function elementSubject(
  elementKind: ElementKind,
  revision: number,
  value: string,
  referenceRights: ReferenceRightsState = {
    rightsRecorded: false,
    rights: unknownReferenceRightsRecord(),
  },
) {
  const fixture = ELEMENT_FIXTURES[elementKind]
  const selected = revision === 3
  const common = {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: 'project-1',
    targetType: 'element_profile',
    elementKind,
    profileRevision: revision,
    name: fixture.name,
    officialReferenceImageUrl: selected ? `/media/${elementKind}/${fixture.targetId}.png` : null,
    references: [{
      assetId: `reference-${elementKind}-1`,
      sha256: fixture.referenceSha256,
      selectionStatus: selected ? 'Selected' : 'Stale',
      isSelected: selected,
      ...(elementKind === 'actor'
        ? { role: 'primary' }
        : elementKind === 'scene'
          ? { role: 'environment' }
          : {}),
      rightsRecorded: referenceRights.rightsRecorded,
      rights: referenceRights.rights,
    }],
  } as const
  if (elementKind === 'actor') {
    return { ...common, actorId: fixture.targetId, visualIdentity: value } as const
  }
  if (elementKind === 'scene') {
    return { ...common, sceneId: fixture.targetId, sceneType: 'interior', visualPrompt: value } as const
  }
  return { ...common, propId: fixture.targetId, visualPrompt: value } as const
}

function sceneReferenceSubject(revision: number, selectedReference: boolean) {
  const subject = elementSubject('scene', revision, SCENE_ORIGINAL_PROMPT)
  if (!selectedReference) return subject
  return {
    ...subject,
    officialReferenceImageUrl: `/media/scene/${SCENE_SELECT_ASSET_ID}.png`,
    references: [{
      assetId: SCENE_SELECT_ASSET_ID,
      sha256: SCENE_SELECT_ASSET_SHA,
      selectionStatus: 'Selected',
      isSelected: true,
      role: 'environment',
      rightsRecorded: false,
      rights: unknownReferenceRightsRecord(),
    }],
  } as const
}

function sceneReferenceCandidate(
  assetId: string,
  sha256: string,
  selectionStatus: 'Unselected' | 'Selected' | 'Rejected' | 'Stale',
  isSelected: boolean,
) {
  const selected = selectionStatus === 'Selected' && isSelected
  return {
    assetId,
    sha256,
    materializedSha256: sha256,
    bindingValid: true,
    projectId: 'project-1',
    sourceEpisodeId: 'episode-1',
    ownerType: 'scene',
    ownerId: 'scene-1',
    role: 'scene_reference',
    localPath: `storage/scenes/${assetId}.png`,
    qualityStatus: 'passed',
    selectionStatus,
    isSelected,
    generationJobId: `job-${assetId}`,
    sourceRevisionId: `revision-${assetId}`,
    formalConsistencyCheckId: `check-${assetId}`,
    formalConsistencyPassed: true,
    qualityProjectionSha256: canonicalSha256({ assetId, sha256, quality: 'passed' }),
    decisionKind: selected ? 'referenceSelection' : 'none',
    decisionIdentity: selected ? 'owner-1' : '',
  } as const
}

function sceneReferenceCandidatesFixture(
  profileRevision: number,
  elementSnapshotSha256: string,
  selectedReference: boolean,
) {
  return {
    schema: 'jason.qingmu-reference-asset-candidates.v1',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'scene-1',
    elementKind: 'scene',
    profileRevision,
    elementSnapshotSha256,
    candidates: [
      sceneReferenceCandidate(
        SCENE_SELECT_ASSET_ID,
        SCENE_SELECT_ASSET_SHA,
        selectedReference ? 'Selected' : 'Unselected',
        selectedReference,
      ),
      sceneReferenceCandidate(SCENE_REPAIR_ASSET_ID, SCENE_REPAIR_ASSET_SHA, 'Rejected', false),
      sceneReferenceCandidate(SCENE_STALE_ASSET_ID, SCENE_STALE_ASSET_SHA, 'Stale', false),
    ],
    humanApprovalInferred: false,
  } as const
}

function propReferenceCandidatesFixture(profileRevision: number, elementSnapshotSha256: string) {
  return {
    schema: 'jason.qingmu-reference-asset-candidates.v1',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    profileRevision,
    elementSnapshotSha256,
    candidates: [{
      assetId: 'reference-prop-1',
      sha256: PROP_REFERENCE_SHA,
      materializedSha256: PROP_REFERENCE_SHA,
      bindingValid: true,
      projectId: 'project-1',
      sourceEpisodeId: 'episode-1',
      ownerType: 'prop',
      ownerId: 'prop-1',
      role: 'prop_reference',
      localPath: 'storage/props/reference-prop-1.png',
      qualityStatus: 'passed',
      selectionStatus: 'Stale',
      isSelected: false,
      generationJobId: 'job-reference-prop-1',
      sourceRevisionId: 'revision-reference-prop-1',
      formalConsistencyCheckId: 'check-reference-prop-1',
      formalConsistencyPassed: true,
      qualityProjectionSha256: canonicalSha256({
        assetId: 'reference-prop-1',
        sha256: PROP_REFERENCE_SHA,
        quality: 'passed',
      }),
      decisionKind: 'none',
      decisionIdentity: '',
    }],
    humanApprovalInferred: false,
  } as const
}

function elementImpactFixture(elementKind: ElementKind) {
  return {
    affectedReferenceAssetIds: [`reference-${elementKind}-1`],
    invalidatedApprovalAssetIds: [`approval-${elementKind}-1`],
    affectedDerivedAssetIds: [`derived-${elementKind}-1`],
    affectedReferencePackIds: [`reference-pack-${elementKind}-1`],
    affectedPromptIrIds: [`prompt-ir-${elementKind}-1`],
    affectedStoryboardFrameIds: [`storyboard-frame-${elementKind}-1`],
    unknowns: [`human-review-${elementKind}-1`],
  } as const
}

function elementChangeSetFixture(elementKind: ElementKind, snapshotSha256: string) {
  const fixture = ELEMENT_FIXTURES[elementKind]
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: fixture.changeSetId,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: null,
    targetType: 'element_profile',
    targetId: fixture.targetId,
    baseRevision: 3,
    baseSnapshotSha256: snapshotSha256,
    payloadSha256: fixture.payloadSha256,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: null,
    status: 'proposed',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-26T08:03:00+00:00',
    updatedAt: '2026-08-26T08:03:00+00:00',
  } as const
}

function referenceChangeSetFixture(
  changeSetId: string,
  payloadSha256: string,
  baseRevision: number,
  baseSnapshotSha256: string,
) {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: changeSetId,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: null,
    targetType: 'element_profile',
    targetId: 'scene-1',
    baseRevision,
    baseSnapshotSha256,
    payloadSha256,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: null,
    status: 'proposed',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-27T02:00:00+00:00',
    updatedAt: '2026-08-27T02:00:00+00:00',
  } as const
}

function referenceRightsChangeSetFixture(baseSnapshotSha256: string) {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: REFERENCE_RIGHTS_CHANGE_SET_ID,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: null,
    targetType: 'element_profile',
    targetId: 'prop-1',
    baseRevision: 4,
    baseSnapshotSha256,
    payloadSha256: REFERENCE_RIGHTS_PAYLOAD_SHA,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: null,
    status: 'proposed',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-27T11:00:00+00:00',
    updatedAt: '2026-08-27T11:00:00+00:00',
  } as const
}

function referenceCommitReceiptFixture(
  operation: 'selectReferenceAsset' | 'requestReferenceRegeneration',
  authoritativeSnapshotSha256: string,
  idempotencyKey: string,
) {
  const selecting = operation === 'selectReferenceAsset'
  return {
    schema: 'jason.qingmu-reference-asset-commit-result.v1',
    changeSetId: selecting ? REFERENCE_SELECT_CHANGE_SET_ID : REFERENCE_REGEN_CHANGE_SET_ID,
    commandReceiptId: selecting ? 'receipt-scene-reference-select-1' : 'receipt-scene-reference-regeneration-1',
    eventId: selecting ? 'event-scene-reference-select-1' : 'event-scene-reference-regeneration-1',
    eventType: selecting ? 'ReferenceAssetSelected' : 'ReferenceRegenerationRequested',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'scene-1',
    elementKind: 'scene',
    operation,
    candidateAssetId: selecting ? SCENE_SELECT_ASSET_ID : SCENE_REPAIR_ASSET_ID,
    candidateAssetSha256: selecting ? SCENE_SELECT_ASSET_SHA : SCENE_REPAIR_ASSET_SHA,
    baseRevision: selecting ? 3 : 4,
    authoritativeRevision: selecting ? 4 : 5,
    authoritativeSnapshotSha256,
    payloadSha256: selecting ? REFERENCE_SELECT_PAYLOAD_SHA : REFERENCE_REGEN_PAYLOAD_SHA,
    idempotencyKey,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    deduplicated: false,
    committedAt: '2026-08-27T02:01:00+00:00',
  } as const
}

function elementCommitReceiptFixture(
  elementKind: 'actor' | 'prop',
  snapshotSha256: string,
  idempotencyKey: string,
) {
  const fixture = ELEMENT_FIXTURES[elementKind]
  const impactAnalysis = elementImpactFixture(elementKind)
  return {
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId: fixture.changeSetId,
    commandReceiptId: `receipt-${elementKind}-1`,
    eventId: `event-${elementKind}-1`,
    eventType: 'ReferenceInvalidated',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: fixture.targetId,
    elementKind,
    operation: fixture.operation,
    baseRevision: 3,
    authoritativeRevision: 4,
    authoritativeSnapshotSha256: snapshotSha256,
    payloadSha256: fixture.payloadSha256,
    idempotencyKey,
    changed: true,
    referenceInvalidated: true,
    impactAnalysis,
    impactSha256: canonicalSha256(impactAnalysis),
    deduplicated: false,
    committedAt: '2026-08-26T08:04:00+00:00',
  } as const
}

function referenceRightsCommitReceiptFixture(authoritativeSnapshotSha256: string) {
  const impactAnalysis = elementImpactFixture('prop')
  return {
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId: REFERENCE_RIGHTS_CHANGE_SET_ID,
    commandReceiptId: 'receipt-prop-reference-rights-1',
    eventId: 'event-prop-reference-rights-1',
    eventType: 'ReferenceInvalidated',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation: 'replaceReferenceRights',
    referenceAssetId: 'reference-prop-1',
    referenceAssetSha256: PROP_REFERENCE_SHA,
    baseRevision: 4,
    authoritativeRevision: 5,
    authoritativeSnapshotSha256,
    payloadSha256: REFERENCE_RIGHTS_PAYLOAD_SHA,
    idempotencyKey: REFERENCE_RIGHTS_IDEMPOTENCY_KEY,
    changed: true,
    referenceInvalidated: true,
    impactAnalysis,
    impactSha256: canonicalSha256(impactAnalysis),
    deduplicated: false,
    committedAt: '2026-08-27T11:01:00+00:00',
  } as const
}

function propSubject(revision: number, prompt: string, referenceRights?: ReferenceRightsState) {
  return elementSubject('prop', revision, prompt, referenceRights) as Extract<
    ReturnType<typeof elementSubject>,
    { readonly propId: string }
  >
}

function propCommitReceiptFixture(snapshotSha256: string) {
  return elementCommitReceiptFixture('prop', snapshotSha256, PROP_IDEMPOTENCY_KEY)
}

function changeSetFixture() {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: CHANGE_SET_ID,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'episode_script',
    targetId: 'episode-1',
    baseRevision: 3,
    baseSnapshotSha256: SNAPSHOT_SHA,
    payloadSha256: PAYLOAD_SHA,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: null,
    status: 'proposed',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-26T08:01:00+00:00',
    updatedAt: '2026-08-26T08:01:00+00:00',
  }
}

function commitReceiptFixture(idempotencyKey: string) {
  return {
    schema: 'jason.qingmu-episode-script-commit-result.v1',
    changeSetId: CHANGE_SET_ID,
    commandReceiptId: 'receipt-1',
    eventId: 'event-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    baseRevision: 3,
    authoritativeRevision: 4,
    authoritativeSnapshotSha256: AUTHORITATIVE_SNAPSHOT_SHA,
    payloadSha256: PAYLOAD_SHA,
    idempotencyKey,
    changed: true,
    invalidatedStages: ['assets', 'director', 'shots', 'video', 'audio', 'timeline'],
    deduplicated: false,
    committedAt: '2026-08-26T08:02:00+00:00',
  }
}

function promptIrSubject(selected: boolean) {
  return {
    schema: 'jason.qingmu-prompt-ir-subject.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    storyboardRevisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
    frameId: PROMPT_IR_FRAME_ID,
    promptIrId: selected ? PROMPT_IR_DRAFT_ID : PROMPT_IR_READY_ID,
    promptIrVersion: selected ? PROMPT_IR_DRAFT_VERSION : PROMPT_IR_READY_VERSION,
    promptIrContentSha256: selected ? PROMPT_IR_DRAFT_CONTENT_SHA : PROMPT_IR_READY_CONTENT_SHA,
    status: 'Ready',
    editableProjection: selected ? PROMPT_IR_CANDIDATE_EDITABLE : PROMPT_IR_BASE_EDITABLE,
  } as const
}

function promptIrReadFixture(selected: boolean) {
  const subject = promptIrSubject(selected)
  return {
    schema: 'jason.qingmu-prompt-ir-subject-read.v1',
    subject,
    baseRevision: subject.promptIrVersion,
    baseSnapshotSha256: canonicalSha256(subject),
  } as const
}

function promptIrWorkflowShot(selected: boolean) {
  const subject = promptIrSubject(selected)
  return {
    shotId: 'shot-1',
    name: '雨夜车站',
    frameId: PROMPT_IR_FRAME_ID,
    promptLineage: {
      storyboardRevisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
      id: subject.promptIrId,
      version: subject.promptIrVersion,
      contentSha256: subject.promptIrContentSha256,
      status: 'Ready',
    },
  } as const
}

function promptIrChangeSetFixture() {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: PROMPT_IR_CHANGE_SET_ID,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    baseRevision: PROMPT_IR_READY_VERSION,
    baseSnapshotSha256: canonicalSha256(promptIrSubject(false)),
    payloadSha256: PROMPT_IR_PAYLOAD_SHA,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: null,
    status: 'Proposed',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-27T10:00:00+00:00',
    updatedAt: '2026-08-27T10:00:00+00:00',
  } as const
}

function promptIrPreviewFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-preview.v1',
    changeSetId: PROMPT_IR_CHANGE_SET_ID,
    target: {
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboardRevisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
      frameId: PROMPT_IR_FRAME_ID,
      targetId: PROMPT_IR_TARGET_ID,
    },
    basePromptIr: {
      id: PROMPT_IR_READY_ID,
      version: PROMPT_IR_READY_VERSION,
      contentSha256: PROMPT_IR_READY_CONTENT_SHA,
      status: 'Ready',
      editableProjection: PROMPT_IR_BASE_EDITABLE,
    },
    candidatePromptIr: {
      id: PROMPT_IR_DRAFT_ID,
      version: PROMPT_IR_DRAFT_VERSION,
      contentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: PROMPT_IR_CANDIDATE_EDITABLE,
    },
    promptDiff: {
      changed: true,
      changedPaths: ['$.videoGenPrompt'],
      before: PROMPT_IR_BASE_EDITABLE,
      after: PROMPT_IR_CANDIDATE_EDITABLE,
    },
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  } as const
}

function promptIrEditReceiptFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-edit-commit-result.v1',
    changeSetId: PROMPT_IR_CHANGE_SET_ID,
    commandReceiptId: 'receipt-prompt-ir-edit-1',
    eventId: 'event-prompt-ir-edit-1',
    eventType: 'PromptIrDraftCommitted',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    storyboardRevisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
    frameId: PROMPT_IR_FRAME_ID,
    promptIr: {
      id: PROMPT_IR_DRAFT_ID,
      version: PROMPT_IR_DRAFT_VERSION,
      contentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: PROMPT_IR_CANDIDATE_EDITABLE,
    },
    previousReadyPromptIr: {
      id: PROMPT_IR_READY_ID,
      version: PROMPT_IR_READY_VERSION,
      contentSha256: PROMPT_IR_READY_CONTENT_SHA,
      status: 'Ready',
    },
    payloadSha256: PROMPT_IR_PAYLOAD_SHA,
    idempotencyKey: PROMPT_IR_EDIT_IDEMPOTENCY_KEY,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T10:01:00+00:00',
  } as const
}

function promptIrSelectionReceiptFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-selection-result.v1',
    changeSetId: 'changeset-prompt-ir-selection-1',
    commandReceiptId: 'receipt-prompt-ir-selection-1',
    eventId: 'event-prompt-ir-selection-1',
    eventType: 'PromptIrSelected',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    storyboardRevisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
    frameId: PROMPT_IR_FRAME_ID,
    selectedPromptIr: {
      id: PROMPT_IR_DRAFT_ID,
      version: PROMPT_IR_DRAFT_VERSION,
      contentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
      status: 'Ready',
      editableProjection: PROMPT_IR_CANDIDATE_EDITABLE,
    },
    stalePromptIrIds: [PROMPT_IR_READY_ID],
    idempotencyKey: PROMPT_IR_SELECTION_IDEMPOTENCY_KEY,
    changed: true,
    providerCall: false,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T10:02:00+00:00',
  } as const
}

function promptIrRecoveryEnvelope(receipt: unknown) {
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: canonicalSha256(receipt),
    receipt,
  } as const
}

function workflowFixture(revision: number, promptIrSelected = false) {
  return {
    schema: 'jason.episode-workflow-projection.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceRevision: { script: revision },
    inputFingerprint: `fingerprint-${String(revision)}`,
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
      semanticItems: [
        {
          assetId: 'actor-1',
          projectId: 'project-1',
          type: 'character',
          name: '林青',
          provenance: { reviewAccepted: false, reviewStatus: 'Stale' },
        },
        {
          assetId: 'scene-1',
          projectId: 'project-1',
          type: 'environment',
          name: '旧体育馆走廊',
          provenance: { reviewAccepted: false, reviewStatus: 'Stale' },
        },
        {
          assetId: 'prop-1',
          projectId: 'project-1',
          type: 'prop',
          name: '银色怀表',
          provenance: { reviewAccepted: false, reviewStatus: 'Stale' },
        },
      ],
    },
    director: {},
    shots: { items: [promptIrWorkflowShot(promptIrSelected)] },
    video: {},
    audio: {},
    timeline: {},
    budget: { valid: true },
    release: { releaseReady: false },
    blockers: [],
    legacy: {},
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = ''
  request.setEncoding('utf8')
  for await (const chunk of request) body += String(chunk)
  return body === '' ? undefined : JSON.parse(body) as unknown
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function validateElementProposal(body: unknown, elementKind: ElementKind): string {
  const proposal = isRecord(body) ? body : {}
  const fixture = ELEMENT_FIXTURES[elementKind]
  const methodProjection = isRecord(proposal.methodProjection) ? proposal.methodProjection : {}
  const methodSubject = isRecord(methodProjection.subject) ? methodProjection.subject : {}
  const methodDefinition = isRecord(methodProjection.method_definition) ? methodProjection.method_definition : {}
  const usesExpectedValue = elementKind === 'actor'
    ? proposal.visualIdentity === fixture.updatedValue && proposal.visualPrompt === undefined
    : proposal.visualPrompt === fixture.updatedValue && proposal.visualIdentity === undefined
  if (
    proposal.elementKind !== elementKind
    || proposal.operation !== fixture.operation
    || !usesExpectedValue
    || typeof proposal.methodProjectionSha256 !== 'string'
    || !isRecord(proposal.methodProjection)
    || !isRecord(proposal.methodAttestation)
    || methodProjection.schema !== 'qingmu.imago-element-method-projection.v1'
    || methodDefinition.id !== fixture.methodId
    || methodSubject.project_id !== 'project-1'
    || methodSubject.target_type !== 'element_profile'
    || methodSubject.target_id !== fixture.targetId
    || methodSubject.element_kind !== elementKind
    || methodSubject.scope_type !== 'project'
    || methodSubject.scope_id !== 'project-1'
  ) {
    throw new Error(`${elementKind} proposal omitted its bounded canonical method projection`)
  }
  const attestation = proposal.methodAttestation
  const attestationKeys = [
    'schema',
    'algorithm',
    'projectionSha256',
    'inputSnapshotSha256',
    'subjectSha256',
    'signature',
  ]
  if (
    Object.keys(attestation).length !== attestationKeys.length
    || Object.keys(attestation).some(key => !attestationKeys.includes(key))
    || attestation.schema !== 'qingmu.imago-element-method-attestation.v1'
    || attestation.algorithm !== 'hmac-sha256'
    || attestation.projectionSha256 !== canonicalSha256(proposal.methodProjection)
    || attestation.projectionSha256 !== proposal.methodProjectionSha256
    || attestation.inputSnapshotSha256 !== methodProjection.input_snapshot_sha256
    || attestation.subjectSha256 !== canonicalSha256(methodSubject)
  ) {
    throw new Error(`${elementKind} proposal method attestation lineage mismatch`)
  }
  const { signature, ...unsignedAttestation } = attestation
  if (
    typeof signature !== 'string'
    || signature !== createHmac('sha256', IMAGO_ATTESTATION_KEY)
      .update(canonicalJson(unsignedAttestation), 'utf8')
      .digest('hex')
  ) {
    throw new Error(`${elementKind} proposal method attestation signature mismatch`)
  }
  return proposal.methodProjectionSha256
}

function validateReferenceRightsMethodProof(
  proposal: Record<string, unknown>,
  baseSubject: ReturnType<typeof propSubject>,
): string {
  const methodProjection = isRecord(proposal.methodProjection) ? proposal.methodProjection : {}
  const methodSubject = isRecord(methodProjection.subject) ? methodProjection.subject : {}
  const methodDefinition = isRecord(methodProjection.method_definition) ? methodProjection.method_definition : {}
  const methodAttestation = isRecord(proposal.methodAttestation) ? proposal.methodAttestation : {}
  const projectionKeys = [
    'schema',
    'input_snapshot_sha256',
    'subject',
    'method_definition',
    'source_bindings',
    'field_hints',
    'checklist',
    'work_order_projection',
    'review_card',
    'legal_work_set',
    'authority_snapshot_attestation',
    'project_state_persisted',
    'paid_provider_authority',
    'human_approval_inferred',
    'selection_authority',
  ].sort()
  const subjectKeys = [
    'project_id',
    'target_type',
    'target_id',
    'element_kind',
    'scope_type',
    'scope_id',
    'base_revision',
    'base_snapshot_sha256',
  ].sort()
  const attestationKeys = [
    'schema',
    'algorithm',
    'projectionSha256',
    'inputSnapshotSha256',
    'subjectSha256',
    'signature',
  ].sort()
  const methodProjectionSha256 = canonicalSha256(methodProjection)
  if (
    Object.keys(methodProjection).sort().some((key, index) => key !== projectionKeys[index])
    || Object.keys(methodProjection).length !== projectionKeys.length
    || Object.keys(methodSubject).sort().some((key, index) => key !== subjectKeys[index])
    || Object.keys(methodSubject).length !== subjectKeys.length
    || Object.keys(methodAttestation).sort().some((key, index) => key !== attestationKeys[index])
    || Object.keys(methodAttestation).length !== attestationKeys.length
    || methodProjection.schema !== 'qingmu.imago-element-method-projection.v1'
    || methodDefinition.id !== 'imago-v6-reference-rights-record'
    || methodDefinition.version !== 1
    || methodSubject.project_id !== 'project-1'
    || methodSubject.target_type !== 'element_profile'
    || methodSubject.target_id !== 'prop-1'
    || methodSubject.element_kind !== 'prop'
    || methodSubject.scope_type !== 'project'
    || methodSubject.scope_id !== 'project-1'
    || methodSubject.base_revision !== 4
    || methodSubject.base_snapshot_sha256 !== canonicalSha256(baseSubject)
    || proposal.methodProjectionSha256 !== methodProjectionSha256
    || methodAttestation.schema !== 'qingmu.imago-element-method-attestation.v1'
    || methodAttestation.algorithm !== 'hmac-sha256'
    || methodAttestation.projectionSha256 !== methodProjectionSha256
    || methodAttestation.inputSnapshotSha256 !== methodProjection.input_snapshot_sha256
    || methodAttestation.subjectSha256 !== canonicalSha256(methodSubject)
  ) {
    throw new Error('reference rights proposal method proof lineage mismatch')
  }
  const { signature, ...unsignedAttestation } = methodAttestation
  if (
    typeof signature !== 'string'
    || signature !== createHmac('sha256', IMAGO_ATTESTATION_KEY)
      .update(canonicalJson(unsignedAttestation), 'utf8')
      .digest('hex')
  ) {
    throw new Error('reference rights proposal method attestation signature mismatch')
  }
  return methodProjectionSha256
}

async function startYimengDouble(
  captured: CapturedYimengRequest[],
  scriptReadRevisions: number[],
  actorReadRevisions: number[],
  sceneReadRevisions: number[],
  propReadRevisions: number[],
  propReadSubjects: Array<ReturnType<typeof propSubject>>,
  propReviewDecisionReads: Array<Array<Record<string, unknown>>>,
  sceneReferenceCandidateReads: ReturnType<typeof sceneReferenceCandidatesFixture>[],
  propReferenceCandidateReads: ReturnType<typeof propReferenceCandidatesFixture>[],
  promptIrWorkflowStatuses: string[],
  referenceRightsMethodProjectionSha256: Promise<string>,
): Promise<{
  readonly server: Server
  readonly baseUrl: string
  readonly commitAccepted: Promise<void>
  readonly releaseCommitResponse: () => void
  readonly actorCommitAccepted: Promise<void>
  readonly releaseActorCommitResponse: () => void
  readonly propCommitAccepted: Promise<void>
  readonly releasePropCommitResponse: () => void
  readonly referenceRightsCommitAccepted: Promise<void>
  readonly releaseReferenceRightsCommitResponse: () => void
  readonly referenceRightsExceptionReleaseAccepted: Promise<void>
  readonly releaseReferenceRightsExceptionReleaseResponse: () => void
  readonly referenceCommitAccepted: Promise<void>
  readonly releaseReferenceCommitResponse: () => void
  readonly referenceRegenerationCommitAccepted: Promise<void>
  readonly releaseReferenceRegenerationCommitResponse: () => void
  readonly promptIrEditAccepted: Promise<void>
  readonly releasePromptIrEditResponse: () => void
  readonly promptIrSelectionAccepted: Promise<void>
  readonly releasePromptIrSelectionResponse: () => void
}> {
  let revision = 3
  let authoritativeScript: Record<string, unknown> = INITIAL_SCRIPT
  let persistedReceipt: ReturnType<typeof commitReceiptFixture> | undefined
  let actorRevision = 3
  let actorIdentity = ACTOR_ORIGINAL_IDENTITY
  let actorMethodProjectionSha256: string | undefined
  let persistedActorReceipt: ReturnType<typeof elementCommitReceiptFixture> | undefined
  let sceneRevision = 3
  const scenePrompt = SCENE_ORIGINAL_PROMPT
  let sceneReferenceSelected = false
  let sceneMethodProjectionSha256: string | undefined
  let propRevision = 3
  let propPrompt = PROP_ORIGINAL_PROMPT
  let propRightsRecorded = false
  let propRights: ReferenceRightsState['rights'] = unknownReferenceRightsRecord()
  const currentPropRights = (): ReferenceRightsState => ({
    rightsRecorded: propRightsRecorded,
    rights: propRights,
  })
  const currentPropSubject = () => propSubject(propRevision, propPrompt, currentPropRights())
  let propMethodProjectionSha256: string | undefined
  let persistedPropReceipt: ReturnType<typeof propCommitReceiptFixture> | undefined
  let persistedReferenceRightsReceipt: ReturnType<typeof referenceRightsCommitReceiptFixture> | undefined
  let persistedReferenceRightsExceptionResult: Record<string, unknown> | undefined
  let persistedReferenceRightsExceptionIdempotencyKey: string | undefined
  let promptIrDraftCommitted = false
  let promptIrSelected = false
  let persistedPromptIrEditReceipt: ReturnType<typeof promptIrEditReceiptFixture> | undefined
  let persistedPromptIrSelectionReceipt: ReturnType<typeof promptIrSelectionReceiptFixture> | undefined
  const reviewComments: Record<ElementKind, Array<Record<string, unknown>>> = { actor: [], scene: [], prop: [] }
  const reviewDecisions: Record<ElementKind, Array<Record<string, unknown>>> = { actor: [], scene: [], prop: [] }
  let resolveCommitAccepted: (() => void) | undefined
  let resolveCommitResponse: (() => void) | undefined
  const commitAccepted = new Promise<void>((resolve) => {
    resolveCommitAccepted = resolve
  })
  const commitResponseReleased = new Promise<void>((resolve) => {
    resolveCommitResponse = resolve
  })
  let resolveActorCommitAccepted: (() => void) | undefined
  let resolveActorCommitResponse: (() => void) | undefined
  const actorCommitAccepted = new Promise<void>((resolve) => {
    resolveActorCommitAccepted = resolve
  })
  const actorCommitResponseReleased = new Promise<void>((resolve) => {
    resolveActorCommitResponse = resolve
  })
  let resolvePropCommitAccepted: (() => void) | undefined
  let resolvePropCommitResponse: (() => void) | undefined
  const propCommitAccepted = new Promise<void>((resolve) => {
    resolvePropCommitAccepted = resolve
  })
  const propCommitResponseReleased = new Promise<void>((resolve) => {
    resolvePropCommitResponse = resolve
  })
  let resolveReferenceRightsCommitAccepted: (() => void) | undefined
  let resolveReferenceRightsCommitResponse: (() => void) | undefined
  const referenceRightsCommitAccepted = new Promise<void>((resolve) => {
    resolveReferenceRightsCommitAccepted = resolve
  })
  const referenceRightsCommitResponseReleased = new Promise<void>((resolve) => {
    resolveReferenceRightsCommitResponse = resolve
  })
  let resolveReferenceRightsExceptionReleaseAccepted: (() => void) | undefined
  let resolveReferenceRightsExceptionReleaseResponse: (() => void) | undefined
  const referenceRightsExceptionReleaseAccepted = new Promise<void>((resolve) => {
    resolveReferenceRightsExceptionReleaseAccepted = resolve
  })
  const referenceRightsExceptionReleaseResponseReleased = new Promise<void>((resolve) => {
    resolveReferenceRightsExceptionReleaseResponse = resolve
  })
  let persistedReferenceReceipt: ReturnType<typeof referenceCommitReceiptFixture> | undefined
  let resolveReferenceCommitAccepted: (() => void) | undefined
  let resolveReferenceCommitResponse: (() => void) | undefined
  const referenceCommitAccepted = new Promise<void>((resolve) => {
    resolveReferenceCommitAccepted = resolve
  })
  const referenceCommitResponseReleased = new Promise<void>((resolve) => {
    resolveReferenceCommitResponse = resolve
  })
  let resolveReferenceRegenerationCommitAccepted: (() => void) | undefined
  let resolveReferenceRegenerationCommitResponse: (() => void) | undefined
  const referenceRegenerationCommitAccepted = new Promise<void>((resolve) => {
    resolveReferenceRegenerationCommitAccepted = resolve
  })
  const referenceRegenerationCommitResponseReleased = new Promise<void>((resolve) => {
    resolveReferenceRegenerationCommitResponse = resolve
  })
  let resolvePromptIrEditAccepted: (() => void) | undefined
  let resolvePromptIrEditResponse: (() => void) | undefined
  const promptIrEditAccepted = new Promise<void>((resolve) => {
    resolvePromptIrEditAccepted = resolve
  })
  const promptIrEditResponseReleased = new Promise<void>((resolve) => {
    resolvePromptIrEditResponse = resolve
  })
  let resolvePromptIrSelectionAccepted: (() => void) | undefined
  let resolvePromptIrSelectionResponse: (() => void) | undefined
  const promptIrSelectionAccepted = new Promise<void>((resolve) => {
    resolvePromptIrSelectionAccepted = resolve
  })
  const promptIrSelectionResponseReleased = new Promise<void>((resolve) => {
    resolvePromptIrSelectionResponse = resolve
  })
  const server = createServer((request, response) => {
    void (async () => {
      const body = request.method === 'POST' ? await readJsonBody(request) : undefined
      const path = request.url ?? ''
      const url = new URL(path, 'http://127.0.0.1')
      captured.push({
        method: request.method ?? '',
        path,
        authorization: request.headers.authorization,
        idempotencyKey: typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined,
        cookie: request.headers.cookie,
        body,
      })

      if (request.method === 'GET' && url.pathname === '/api/health') {
        json(response, 200, {
          status: 'ok',
          runtime: {
            commit: 'runtime-test-commit',
            dirty: false,
            identitySource: 'isolated-e2e',
            matchesReleaseManifest: true,
          },
          build: { commit: 'build-test-commit' },
          hints: { scope: 'loopback double' },
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        json(response, 200, {
          items: [{ id: 'project-1', name: '青木样片' }],
          total: 1,
          page: 1,
          page_size: 100,
          pages: 1,
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/projects/project-1/episodes') {
        json(response, 200, {
          items: [{ id: 'episode-1', project_id: 'project-1', episodeNumber: 1, name: '雨夜' }],
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/episodes/episode-1/workflow-projection') {
        const workflow = workflowFixture(revision, promptIrSelected)
        const promptLineage = workflow.shots.items[0]?.promptLineage
        promptIrWorkflowStatuses.push(promptLineage?.status ?? 'missing')
        json(response, 200, workflow)
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${PROMPT_IR_STORYBOARD_REVISION_ID}/frames/${PROMPT_IR_FRAME_ID}/prompt-ir`
      ) {
        json(response, 200, promptIrReadFixture(promptIrSelected))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/episodes/episode-1/script') {
        scriptReadRevisions.push(revision)
        json(response, 200, {
          found: true,
          projectId: 'project-1',
          episodeId: 'episode-1',
          script: authoritativeScript,
          scriptCanonicalJson: revision === 3
            ? INITIAL_SCRIPT_CANONICAL_JSON
            : AUTHORITATIVE_SCRIPT_CANONICAL_JSON,
          scriptSha256: revision === 3 ? INITIAL_SCRIPT_SHA256 : AUTHORITATIVE_SNAPSHOT_SHA,
          revision,
          editedByUser: true,
          updatedAt: revision === 3 ? '2026-08-26T08:00:00+00:00' : '2026-08-26T08:02:00+00:00',
        })
        return
      }
      const elementReadMatch = /^\/api\/qingmu\/projects\/project-1\/elements\/(actor|scene|prop)\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && elementReadMatch !== null) {
        const elementKind = elementReadMatch[1] as ElementKind
        const fixture = ELEMENT_FIXTURES[elementKind]
        if (elementReadMatch[2] !== fixture.targetId) throw new Error('element read target mismatch')
        const [elementRevision, elementValue, readRevisions] = elementKind === 'actor'
          ? [actorRevision, actorIdentity, actorReadRevisions] as const
          : elementKind === 'scene'
            ? [sceneRevision, scenePrompt, sceneReadRevisions] as const
            : [propRevision, propPrompt, propReadRevisions] as const
        readRevisions.push(elementRevision)
        const subject = elementKind === 'scene'
          ? sceneReferenceSubject(elementRevision, sceneReferenceSelected)
          : elementKind === 'prop'
            ? currentPropSubject()
            : elementSubject(elementKind, elementRevision, elementValue)
        if (elementKind === 'prop') propReadSubjects.push(subject as ReturnType<typeof propSubject>)
        const canonicalSnapshot = canonicalJson(subject)
        json(response, 200, {
          schema: 'jason.qingmu-element-profile-subject-read.v2',
          subject,
          canonicalSnapshot,
          snapshotSha256: createHash('sha256').update(canonicalSnapshot, 'utf8').digest('hex'),
        })
        return
      }
      const referenceCandidatesMatch = /^\/api\/qingmu\/projects\/project-1\/elements\/(actor|scene|prop)\/([^/]+)\/reference-candidates$/
        .exec(url.pathname)
      if (request.method === 'GET' && referenceCandidatesMatch !== null) {
        const elementKind = referenceCandidatesMatch[1] as ElementKind
        const fixture = ELEMENT_FIXTURES[elementKind]
        if (referenceCandidatesMatch[2] !== fixture.targetId) throw new Error('reference candidates target mismatch')
        const [elementRevision, subject] = elementKind === 'actor'
          ? [actorRevision, elementSubject('actor', actorRevision, actorIdentity)] as const
          : elementKind === 'scene'
            ? [sceneRevision, sceneReferenceSubject(sceneRevision, sceneReferenceSelected)] as const
            : [propRevision, currentPropSubject()] as const
        const elementSnapshotSha256 = canonicalSha256(subject)
        if (elementKind === 'scene') {
          const candidateResponse = sceneReferenceCandidatesFixture(
            elementRevision,
            elementSnapshotSha256,
            sceneReferenceSelected,
          )
          sceneReferenceCandidateReads.push(candidateResponse)
          json(response, 200, candidateResponse)
        } else if (elementKind === 'prop') {
          const candidateResponse = propReferenceCandidatesFixture(elementRevision, elementSnapshotSha256)
          propReferenceCandidateReads.push(candidateResponse)
          json(response, 200, candidateResponse)
        } else {
          json(response, 200, {
            schema: 'jason.qingmu-reference-asset-candidates.v1',
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: fixture.targetId,
            elementKind,
            profileRevision: elementRevision,
            elementSnapshotSha256,
            candidates: [],
            humanApprovalInferred: false,
          })
        }
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === '/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases'
      ) {
        const subject = currentPropSubject()
        const subjectSha256 = canonicalSha256(subject)
        const currentReference = subject.references[0]
        const release = isRecord(persistedReferenceRightsExceptionResult?.release)
          ? persistedReferenceRightsExceptionResult.release
          : undefined
        const releaseScope = isRecord(release?.scope) ? release.scope : undefined
        const releaseIsCurrent = release !== undefined
          && release.subjectRevision === propRevision
          && release.subjectSha256 === subjectSha256
          && releaseScope?.referenceAssetId === currentReference?.assetId
          && releaseScope?.referenceAssetSha256 === currentReference?.sha256
          && releaseScope?.rightsRecordSha256 === canonicalSha256(currentReference?.rights)
        const projectedRelease = release === undefined
          ? undefined
          : {
            ...release,
            stale: !releaseIsCurrent,
            staleReasonCodes: releaseIsCurrent ? [] : ['subject_revision_changed'],
          }
        json(response, 200, {
          schema: 'jason.qingmu-reference-rights-exception-release-feed.v1',
          projectId: 'project-1',
          elementKind: 'prop',
          targetId: 'prop-1',
          subject: {
            type: 'element_profile',
            id: 'prop-1',
            revision: propRevision,
            sha256: subjectSha256,
          },
          capabilities: {
            canRelease: true,
            blockedReasonCode: null,
            blockedReason: null,
            requiresRecentAuthentication: true,
          },
          releases: projectedRelease === undefined ? [] : [projectedRelease],
          currentReleases: projectedRelease === undefined || !releaseIsCurrent ? [] : [projectedRelease],
        })
        return
      }
      const reviewEventsMatch = /^\/api\/qingmu\/projects\/project-1\/elements\/(actor|scene|prop)\/([^/]+)\/review-events$/
        .exec(url.pathname)
      if (request.method === 'GET' && reviewEventsMatch !== null) {
        const elementKind = reviewEventsMatch[1] as ElementKind
        const fixture = ELEMENT_FIXTURES[elementKind]
        if (reviewEventsMatch[2] !== fixture.targetId) throw new Error('review events target mismatch')
        const [elementRevision, subject] = elementKind === 'actor'
          ? [actorRevision, elementSubject('actor', actorRevision, actorIdentity)] as const
          : elementKind === 'scene'
            ? [sceneRevision, sceneReferenceSubject(sceneRevision, sceneReferenceSelected)] as const
            : [propRevision, currentPropSubject()] as const
        const subjectSha256 = canonicalSha256(subject)
        if (elementKind === 'prop') {
          propReviewDecisionReads.push(reviewDecisions.prop.map(decision => ({ ...decision })))
        }
        const currentDecision = [...reviewDecisions[elementKind]].reverse().find(decision =>
          decision.subjectId === fixture.targetId
          && decision.subjectRevision === elementRevision
          && decision.subjectSha256 === subjectSha256) ?? null
        json(response, 200, {
          schema: 'jason.qingmu-element-review-feed.v1',
          projectId: 'project-1',
          elementKind,
          targetId: fixture.targetId,
          subject: {
            type: 'element_profile',
            id: fixture.targetId,
            revision: elementRevision,
            sha256: subjectSha256,
          },
          capabilities: { canComment: true, canDecide: true },
          comments: reviewComments[elementKind],
          decisions: reviewDecisions[elementKind],
          currentDecision,
        })
        return
      }
      const reviewCommandMatch = /^\/api\/qingmu\/projects\/project-1\/elements\/(actor|scene|prop)\/([^/]+)\/(comments|human-decisions)$/
        .exec(url.pathname)
      if (request.method === 'POST' && reviewCommandMatch !== null) {
        const elementKind = reviewCommandMatch[1] as ElementKind
        const fixture = ELEMENT_FIXTURES[elementKind]
        const commandKind = reviewCommandMatch[3]
        if (reviewCommandMatch[2] !== fixture.targetId) throw new Error('review command target mismatch')
        const [elementRevision, subject] = elementKind === 'actor'
          ? [actorRevision, elementSubject('actor', actorRevision, actorIdentity)] as const
          : elementKind === 'scene'
            ? [sceneRevision, sceneReferenceSubject(sceneRevision, sceneReferenceSelected)] as const
            : [propRevision, currentPropSubject()] as const
        const subjectSha256 = canonicalSha256(subject)
        const command = isRecord(body) ? body : {}
        const expectedKeys = commandKind === 'comments'
          ? ['expectedSubjectRevision', 'expectedSubjectSha256', 'body', 'idempotencyKey']
          : ['expectedSubjectRevision', 'expectedSubjectSha256', 'decision', 'reason', 'idempotencyKey']
        if (
          Object.keys(command).length !== expectedKeys.length
          || Object.keys(command).some(key => !expectedKeys.includes(key))
          || command.expectedSubjectRevision !== elementRevision
          || command.expectedSubjectSha256 !== subjectSha256
          || typeof command.idempotencyKey !== 'string'
          || command.idempotencyKey.trim() === ''
        ) {
          throw new Error('review command lineage or browser identity boundary mismatch')
        }
        if (commandKind === 'comments') {
          if (typeof command.body !== 'string' || command.body.trim() === '') {
            throw new Error('comment body mismatch')
          }
          const comment = {
            id: `comment-${String(reviewComments[elementKind].length + 1)}`,
            subjectType: 'element_profile',
            subjectId: fixture.targetId,
            subjectRevision: elementRevision,
            subjectSha256,
            body: command.body,
            actorId: 'commenter-e2e',
            actorRole: 'commenter',
            authSessionId: 'server-session-comment-e2e',
            createdAt: '2026-08-27T09:00:00+00:00',
          } as const
          reviewComments[elementKind].push(comment)
          json(response, 201, { schema: 'jason.qingmu-element-comment-result.v1', comment })
          return
        }
        if (
          (command.decision !== 'approve' && command.decision !== 'reject' && command.decision !== 'request_changes')
          || typeof command.reason !== 'string'
          || command.reason.trim() === ''
        ) {
          throw new Error('HumanDecision body mismatch')
        }
        const decision = {
          id: `decision-${String(reviewDecisions[elementKind].length + 1)}`,
          subjectType: 'element_profile',
          subjectId: fixture.targetId,
          subjectRevision: elementRevision,
          subjectSha256,
          decision: command.decision,
          reason: command.reason,
          actorId: 'approver-e2e',
          actorRole: 'approver',
          authSessionId: 'server-session-decision-e2e',
          decidedAt: '2026-08-27T09:01:00+00:00',
        } as const
        reviewDecisions[elementKind].push(decision)
        json(response, 201, { schema: 'jason.qingmu-element-human-decision-result.v1', decision })
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${PROMPT_IR_STORYBOARD_REVISION_ID}/frames/${PROMPT_IR_FRAME_ID}/prompt-ir/change-sets`
      ) {
        const proposal = isRecord(body) ? body : {}
        const expectedKeys = [
          'basePromptIrId',
          'baseVersion',
          'baseContentSha256',
          'replacements',
        ].sort()
        const replacements = isRecord(proposal.replacements) ? proposal.replacements : {}
        if (
          promptIrDraftCommitted
          || Object.keys(proposal).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(proposal).length !== expectedKeys.length
          || proposal.basePromptIrId !== PROMPT_IR_READY_ID
          || proposal.baseVersion !== PROMPT_IR_READY_VERSION
          || proposal.baseContentSha256 !== PROMPT_IR_READY_CONTENT_SHA
          || Object.keys(replacements).length !== 1
          || replacements.videoGenPrompt !== PROMPT_IR_CANDIDATE_EDITABLE.videoGenPrompt
        ) {
          throw new Error('PromptIR proposal lineage mismatch')
        }
        json(response, 201, {
          schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1',
          changeSet: promptIrChangeSetFixture(),
          nextAction: 'preview',
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/qingmu/episodes/episode-1/script/change-sets') {
        json(response, 201, {
          schema: 'jason.qingmu-change-set-proposal.v1',
          changeSet: changeSetFixture(),
          nextAction: 'preview',
        })
        return
      }
      const elementProposalMatch = /^\/api\/qingmu\/projects\/project-1\/elements\/(actor|scene|prop)\/([^/]+)\/change-sets$/
        .exec(url.pathname)
      if (
        request.method === 'POST'
        && elementProposalMatch !== null
        && (!isRecord(body) || body.operation !== 'replaceReferenceRights')
      ) {
        const elementKind = elementProposalMatch[1] as ElementKind
        const fixture = ELEMENT_FIXTURES[elementKind]
        if (elementProposalMatch[2] !== fixture.targetId) throw new Error('element proposal target mismatch')
        const methodProjectionSha256 = validateElementProposal(body, elementKind)
        if (elementKind === 'actor') actorMethodProjectionSha256 = methodProjectionSha256
        else if (elementKind === 'scene') sceneMethodProjectionSha256 = methodProjectionSha256
        else propMethodProjectionSha256 = methodProjectionSha256
        const baseSnapshotSha256 = canonicalSha256(elementSubject(elementKind, 3, fixture.originalValue))
        json(response, 201, {
          schema: 'jason.qingmu-change-set-proposal.v1',
          changeSet: elementChangeSetFixture(elementKind, baseSnapshotSha256),
          nextAction: 'preview',
        })
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === '/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets'
      ) {
        const proposal = isRecord(body) ? body : {}
        const expectedKeys = [
          'elementKind',
          'operation',
          'referenceAssetId',
          'referenceAssetSha256',
          'rights',
          'baseRevision',
          'baseSnapshotSha256',
          'methodProjection',
          'methodProjectionSha256',
          'methodAttestation',
        ].sort()
        const baseSubject = currentPropSubject()
        const methodProjectionSha256 = validateReferenceRightsMethodProof(proposal, baseSubject)
        if (
          propRevision !== 4
          || propRightsRecorded
          || Object.keys(proposal).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(proposal).length !== expectedKeys.length
          || proposal.elementKind !== 'prop'
          || proposal.operation !== 'replaceReferenceRights'
          || proposal.referenceAssetId !== 'reference-prop-1'
          || proposal.referenceAssetSha256 !== PROP_REFERENCE_SHA
          || !isRecord(proposal.rights)
          || canonicalJson(proposal.rights) !== canonicalJson(recordedReferenceRightsRecord())
          || proposal.baseRevision !== 4
          || proposal.baseSnapshotSha256 !== canonicalSha256(baseSubject)
        ) {
          throw new Error('reference rights proposal lineage mismatch')
        }
        if (methodProjectionSha256 !== await referenceRightsMethodProjectionSha256) {
          throw new Error('reference rights proposal did not transport the browser-observed IMAGO proof')
        }
        json(response, 201, {
          schema: 'jason.qingmu-change-set-proposal.v1',
          changeSet: referenceRightsChangeSetFixture(canonicalSha256(baseSubject)),
          nextAction: 'preview',
        })
        return
      }
      const referenceProposalMatch = /^\/api\/qingmu\/projects\/project-1\/elements\/scene\/scene-1\/reference-change-sets$/
        .exec(url.pathname)
      if (request.method === 'POST' && referenceProposalMatch !== null) {
        const proposal = isRecord(body) ? body : {}
        const operation = proposal.operation
        const selecting = operation === 'selectReferenceAsset'
        const regenerating = operation === 'requestReferenceRegeneration'
        const expectedAssetId = selecting ? SCENE_SELECT_ASSET_ID : SCENE_REPAIR_ASSET_ID
        const expectedAssetSha256 = selecting ? SCENE_SELECT_ASSET_SHA : SCENE_REPAIR_ASSET_SHA
        const currentSubject = sceneReferenceSubject(sceneRevision, sceneReferenceSelected)
        const expectedKeys = [
          'elementKind',
          'operation',
          'candidateAssetId',
          'candidateAssetSha256',
          'baseRevision',
          'baseSnapshotSha256',
          ...(regenerating ? ['repairPrompt'] : []),
        ].sort()
        if (
          (!selecting && !regenerating)
          || Object.keys(proposal).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(proposal).length !== expectedKeys.length
          || proposal.elementKind !== 'scene'
          || proposal.candidateAssetId !== expectedAssetId
          || proposal.candidateAssetSha256 !== expectedAssetSha256
          || proposal.baseRevision !== sceneRevision
          || proposal.baseSnapshotSha256 !== canonicalSha256(currentSubject)
          || (selecting && proposal.repairPrompt !== undefined)
          || (regenerating && proposal.repairPrompt !== REFERENCE_REPAIR_PROMPT)
          || proposal.methodProjection !== undefined
          || proposal.methodAttestation !== undefined
        ) {
          throw new Error('reference proposal lineage mismatch')
        }
        const changeSetId = selecting ? REFERENCE_SELECT_CHANGE_SET_ID : REFERENCE_REGEN_CHANGE_SET_ID
        const payloadSha256 = selecting ? REFERENCE_SELECT_PAYLOAD_SHA : REFERENCE_REGEN_PAYLOAD_SHA
        json(response, 201, {
          schema: 'jason.qingmu-change-set-proposal.v1',
          changeSet: referenceChangeSetFixture(
            changeSetId,
            payloadSha256,
            sceneRevision,
            canonicalSha256(currentSubject),
          ),
          nextAction: 'preview',
        })
        return
      }
      if (request.method === 'POST' && url.pathname === `/api/qingmu/change-sets/${PROMPT_IR_CHANGE_SET_ID}:preview`) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'episodeId',
          'targetType',
          'targetId',
          'storyboardRevisionId',
          'frameId',
          'basePromptIrId',
          'baseRevision',
          'baseSnapshotSha256',
        ].sort()
        if (
          Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.episodeId !== 'episode-1'
          || command.targetType !== 'prompt_ir'
          || command.targetId !== PROMPT_IR_TARGET_ID
          || command.storyboardRevisionId !== PROMPT_IR_STORYBOARD_REVISION_ID
          || command.frameId !== PROMPT_IR_FRAME_ID
          || command.basePromptIrId !== PROMPT_IR_READY_ID
          || command.baseRevision !== PROMPT_IR_READY_VERSION
          || command.baseSnapshotSha256 !== canonicalSha256(promptIrSubject(false))
        ) {
          throw new Error('PromptIR preview lineage mismatch')
        }
        json(response, 200, promptIrPreviewFixture())
        return
      }
      if (request.method === 'POST' && url.pathname === `/api/qingmu/change-sets/${CHANGE_SET_ID}:preview`) {
        json(response, 200, {
          schema: 'jason.qingmu-change-set-preview.v1',
          changeSet: changeSetFixture(),
          baseScript: INITIAL_SCRIPT,
          proposedScript: PROPOSED_SCRIPT,
          authoritativeCurrentScript: authoritativeScript,
          changeSetId: CHANGE_SET_ID,
          payloadSha256: PAYLOAD_SHA,
          baseRevision: 3,
          authoritativeRevision: revision,
          changed: true,
          changedPaths: ['$.scenes[0].title'],
          authoritativeChangedPaths: [],
          revisionConflict: false,
          baseSnapshotConflict: false,
          canCommit: true,
          invalidatedStages: ['assets', 'director', 'shots', 'video', 'audio', 'timeline'],
          preflight: { valid: true },
          references: [],
          previewSha256: PREVIEW_SHA,
        })
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === `/api/qingmu/change-sets/${REFERENCE_RIGHTS_CHANGE_SET_ID}:preview`
      ) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'targetType',
          'targetId',
          'elementKind',
          'episodeId',
          'baseRevision',
          'baseSnapshotSha256',
        ].sort()
        const baseSubject = currentPropSubject()
        if (
          propRevision !== 4
          || propRightsRecorded
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.targetType !== 'element_profile'
          || command.targetId !== 'prop-1'
          || command.elementKind !== 'prop'
          || command.episodeId !== null
          || command.baseRevision !== 4
          || command.baseSnapshotSha256 !== canonicalSha256(baseSubject)
        ) {
          throw new Error('reference rights preview lineage mismatch')
        }
        const impactAnalysis = elementImpactFixture('prop')
        json(response, 200, {
          schema: 'jason.qingmu-change-set-preview.v1',
          changeSet: referenceRightsChangeSetFixture(canonicalSha256(baseSubject)),
          baseSubject,
          authoritativeCurrentSubject: baseSubject,
          changeSetId: REFERENCE_RIGHTS_CHANGE_SET_ID,
          payloadSha256: REFERENCE_RIGHTS_PAYLOAD_SHA,
          projectId: 'project-1',
          targetType: 'element_profile',
          targetId: 'prop-1',
          elementKind: 'prop',
          operation: 'replaceReferenceRights',
          referenceAssetId: 'reference-prop-1',
          referenceAssetSha256: PROP_REFERENCE_SHA,
          proposedReferenceRights: recordedReferenceRightsRecord(),
          baseRevision: 4,
          authoritativeRevision: 4,
          baseSnapshotSha256: canonicalSha256(baseSubject),
          authoritativeSnapshotSha256: canonicalSha256(baseSubject),
          changed: true,
          authoritativeChanged: false,
          revisionConflict: false,
          baseSnapshotConflict: false,
          impactConflict: false,
          canCommit: true,
          referenceInvalidationExpected: true,
          impactAnalysis,
          impactSha256: canonicalSha256(impactAnalysis),
          preflight: {
            status: 'pass',
            costGate: 'not_granted',
            selectionAuthority: 'not_granted',
            humanApprovalInferred: false,
          },
          references: [{ kind: 'human_note', id: 'rights-review-e2e' }],
          methodProjectionSha256: await referenceRightsMethodProjectionSha256,
          previewSha256: REFERENCE_RIGHTS_PREVIEW_SHA,
        })
        return
      }
      const elementPreviewKind = (['actor', 'scene', 'prop'] as const).find(elementKind =>
        url.pathname === `/api/qingmu/change-sets/${ELEMENT_FIXTURES[elementKind].changeSetId}:preview`)
      if (request.method === 'POST' && elementPreviewKind !== undefined) {
        const fixture = ELEMENT_FIXTURES[elementPreviewKind]
        const [authoritativeRevision, authoritativeValue, methodProjectionSha256] = elementPreviewKind === 'actor'
          ? [actorRevision, actorIdentity, actorMethodProjectionSha256] as const
          : elementPreviewKind === 'scene'
            ? [sceneRevision, scenePrompt, sceneMethodProjectionSha256] as const
            : [propRevision, propPrompt, propMethodProjectionSha256] as const
        if (methodProjectionSha256 === undefined) throw new Error(`${elementPreviewKind} preview ran before proposal`)
        const baseSubject = elementSubject(elementPreviewKind, 3, fixture.originalValue)
        const currentSubject = elementSubject(elementPreviewKind, authoritativeRevision, authoritativeValue)
        const baseSnapshotSha256 = canonicalSha256(baseSubject)
        const impactAnalysis = elementImpactFixture(elementPreviewKind)
        json(response, 200, {
          schema: 'jason.qingmu-change-set-preview.v1',
          changeSet: elementChangeSetFixture(elementPreviewKind, baseSnapshotSha256),
          baseSubject,
          ...(elementPreviewKind === 'actor'
            ? { proposedVisualIdentity: fixture.updatedValue }
            : { proposedVisualPrompt: fixture.updatedValue }),
          authoritativeCurrentSubject: currentSubject,
          changeSetId: fixture.changeSetId,
          payloadSha256: fixture.payloadSha256,
          projectId: 'project-1',
          targetType: 'element_profile',
          targetId: fixture.targetId,
          elementKind: elementPreviewKind,
          operation: fixture.operation,
          baseRevision: 3,
          authoritativeRevision,
          baseSnapshotSha256,
          authoritativeSnapshotSha256: canonicalSha256(currentSubject),
          changed: true,
          authoritativeChanged: false,
          revisionConflict: false,
          baseSnapshotConflict: false,
          canCommit: true,
          referenceInvalidationExpected: true,
          impactAnalysis,
          impactSha256: canonicalSha256(impactAnalysis),
          preflight: {
            status: 'pass',
            costGate: 'not_granted',
            selectionAuthority: 'not_granted',
            humanApprovalInferred: false,
          },
          references: currentSubject.references,
          methodProjectionSha256,
          previewSha256: fixture.previewSha256,
        })
        return
      }
      const referencePreviewOperation = url.pathname === `/api/qingmu/change-sets/${REFERENCE_SELECT_CHANGE_SET_ID}:preview`
        ? 'selectReferenceAsset'
        : url.pathname === `/api/qingmu/change-sets/${REFERENCE_REGEN_CHANGE_SET_ID}:preview`
          ? 'requestReferenceRegeneration'
          : undefined
      if (request.method === 'POST' && referencePreviewOperation !== undefined) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'targetType',
          'targetId',
          'elementKind',
          'episodeId',
          'baseRevision',
          'baseSnapshotSha256',
        ].sort()
        const currentSubject = sceneReferenceSubject(sceneRevision, sceneReferenceSelected)
        if (
          Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.targetType !== 'element_profile'
          || command.targetId !== 'scene-1'
          || command.elementKind !== 'scene'
          || command.episodeId !== null
          || command.baseRevision !== sceneRevision
          || command.baseSnapshotSha256 !== canonicalSha256(currentSubject)
          || command.operation !== undefined
          || command.candidateAssetId !== undefined
          || command.candidateAssetSha256 !== undefined
        ) {
          throw new Error('reference preview lineage mismatch')
        }
        const selecting = referencePreviewOperation === 'selectReferenceAsset'
        json(response, 200, {
          schema: 'jason.qingmu-reference-asset-preview.v1',
          changeSetId: selecting ? REFERENCE_SELECT_CHANGE_SET_ID : REFERENCE_REGEN_CHANGE_SET_ID,
          projectId: 'project-1',
          targetType: 'element_profile',
          targetId: 'scene-1',
          elementKind: 'scene',
          operation: referencePreviewOperation,
          candidateAssetId: selecting ? SCENE_SELECT_ASSET_ID : SCENE_REPAIR_ASSET_ID,
          candidateAssetSha256: selecting ? SCENE_SELECT_ASSET_SHA : SCENE_REPAIR_ASSET_SHA,
          candidateDrift: false,
          canCommit: true,
          providerCalls: 0,
          workerStarted: false,
          humanApprovalInferred: false,
        })
        return
      }
      if (request.method === 'POST' && url.pathname === `/api/qingmu/change-sets/${PROMPT_IR_CHANGE_SET_ID}:commit`) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'episodeId',
          'targetType',
          'targetId',
          'storyboardRevisionId',
          'frameId',
          'basePromptIrId',
          'baseRevision',
          'baseSnapshotSha256',
          'idempotencyKey',
          'expectedPayloadSha256',
        ].sort()
        if (
          promptIrDraftCommitted
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.episodeId !== 'episode-1'
          || command.targetType !== 'prompt_ir'
          || command.targetId !== PROMPT_IR_TARGET_ID
          || command.storyboardRevisionId !== PROMPT_IR_STORYBOARD_REVISION_ID
          || command.frameId !== PROMPT_IR_FRAME_ID
          || command.basePromptIrId !== PROMPT_IR_READY_ID
          || command.baseRevision !== PROMPT_IR_READY_VERSION
          || command.baseSnapshotSha256 !== canonicalSha256(promptIrSubject(false))
          || command.idempotencyKey !== PROMPT_IR_EDIT_IDEMPOTENCY_KEY
          || command.expectedPayloadSha256 !== PROMPT_IR_PAYLOAD_SHA
        ) {
          throw new Error('PromptIR edit commit lineage mismatch')
        }
        promptIrDraftCommitted = true
        persistedPromptIrEditReceipt = promptIrEditReceiptFixture()
        resolvePromptIrEditAccepted?.()
        await promptIrEditResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, persistedPromptIrEditReceipt)
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${PROMPT_IR_STORYBOARD_REVISION_ID}/frames/${PROMPT_IR_FRAME_ID}/prompt-ir:select`
      ) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'draftPromptIrId',
          'draftVersion',
          'draftContentSha256',
          'idempotencyKey',
        ].sort()
        if (
          !promptIrDraftCommitted
          || promptIrSelected
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.draftPromptIrId !== PROMPT_IR_DRAFT_ID
          || command.draftVersion !== PROMPT_IR_DRAFT_VERSION
          || command.draftContentSha256 !== PROMPT_IR_DRAFT_CONTENT_SHA
          || command.idempotencyKey !== PROMPT_IR_SELECTION_IDEMPOTENCY_KEY
        ) {
          throw new Error('PromptIR selection lineage mismatch')
        }
        promptIrSelected = true
        persistedPromptIrSelectionReceipt = promptIrSelectionReceiptFixture()
        resolvePromptIrSelectionAccepted?.()
        await promptIrSelectionResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, persistedPromptIrSelectionReceipt)
        return
      }
      if (request.method === 'POST' && url.pathname === `/api/qingmu/change-sets/${CHANGE_SET_ID}:commit`) {
        const command = isRecord(body) ? body : {}
        if (typeof command.idempotencyKey !== 'string') {
          throw new Error('commit command omitted idempotencyKey')
        }
        revision = 4
        authoritativeScript = AUTHORITATIVE_SCRIPT
        persistedReceipt = commitReceiptFixture(command.idempotencyKey)
        resolveCommitAccepted?.()
        await commitResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, persistedReceipt)
        return
      }
      if (request.method === 'POST' && url.pathname === `/api/qingmu/change-sets/${REFERENCE_SELECT_CHANGE_SET_ID}:commit`) {
        const command = isRecord(body) ? body : {}
        const baseSubject = sceneReferenceSubject(3, false)
        const expectedKeys = [
          'projectId',
          'targetType',
          'targetId',
          'elementKind',
          'episodeId',
          'baseRevision',
          'baseSnapshotSha256',
          'idempotencyKey',
          'expectedPayloadSha256',
        ].sort()
        if (
          Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.targetType !== 'element_profile'
          || command.targetId !== 'scene-1'
          || command.elementKind !== 'scene'
          || command.episodeId !== null
          || command.baseRevision !== 3
          || command.baseSnapshotSha256 !== canonicalSha256(baseSubject)
          || command.idempotencyKey !== REFERENCE_SELECT_IDEMPOTENCY_KEY
          || command.expectedPayloadSha256 !== REFERENCE_SELECT_PAYLOAD_SHA
          || command.operation !== undefined
          || command.candidateAssetId !== undefined
          || command.candidateAssetSha256 !== undefined
        ) {
          throw new Error('reference selection commit lineage mismatch')
        }
        sceneRevision = 4
        sceneReferenceSelected = true
        persistedReferenceReceipt = referenceCommitReceiptFixture(
          'selectReferenceAsset',
          canonicalSha256(sceneReferenceSubject(sceneRevision, sceneReferenceSelected)),
          REFERENCE_SELECT_IDEMPOTENCY_KEY,
        )
        resolveReferenceCommitAccepted?.()
        await referenceCommitResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, persistedReferenceReceipt)
        return
      }
      if (request.method === 'POST' && url.pathname === `/api/qingmu/change-sets/${REFERENCE_REGEN_CHANGE_SET_ID}:commit`) {
        const command = isRecord(body) ? body : {}
        const baseSubject = sceneReferenceSubject(4, true)
        const expectedKeys = [
          'projectId',
          'targetType',
          'targetId',
          'elementKind',
          'episodeId',
          'baseRevision',
          'baseSnapshotSha256',
          'idempotencyKey',
          'expectedPayloadSha256',
        ].sort()
        if (
          Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.targetType !== 'element_profile'
          || command.targetId !== 'scene-1'
          || command.elementKind !== 'scene'
          || command.episodeId !== null
          || command.baseRevision !== 4
          || command.baseSnapshotSha256 !== canonicalSha256(baseSubject)
          || command.idempotencyKey !== REFERENCE_REGEN_IDEMPOTENCY_KEY
          || command.expectedPayloadSha256 !== REFERENCE_REGEN_PAYLOAD_SHA
          || command.operation !== undefined
          || command.candidateAssetId !== undefined
          || command.candidateAssetSha256 !== undefined
        ) {
          throw new Error('reference regeneration commit lineage mismatch')
        }
        sceneRevision = 5
        const receipt = referenceCommitReceiptFixture(
          'requestReferenceRegeneration',
          canonicalSha256(sceneReferenceSubject(sceneRevision, sceneReferenceSelected)),
          REFERENCE_REGEN_IDEMPOTENCY_KEY,
        )
        resolveReferenceRegenerationCommitAccepted?.()
        await referenceRegenerationCommitResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, receipt)
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === '/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases'
      ) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = ['expectedSubjectRevision', 'expectedSubjectSha256', 'scope', 'reason'].sort()
        const scope = isRecord(command.scope) ? command.scope : {}
        const expectedScopeKeys = [
          'kind',
          'referenceAssetId',
          'referenceAssetSha256',
          'rightsRecordSha256',
          'rightsFields',
        ].sort()
        const subject = currentPropSubject()
        const subjectSha256 = canonicalSha256(subject)
        const reference = subject.references[0]
        const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined
        if (
          propRevision !== 5
          || !propRightsRecorded
          || persistedReferenceRightsExceptionResult !== undefined
          || url.search !== ''
          || Object.keys(command).length !== expectedKeys.length
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || command.expectedSubjectRevision !== 5
          || command.expectedSubjectSha256 !== subjectSha256
          || command.reason !== '项目法律顾问已核对当前素材的有限范围。'
          || Object.keys(scope).length !== expectedScopeKeys.length
          || Object.keys(scope).sort().some((key, index) => key !== expectedScopeKeys[index])
          || scope.kind !== 'reference_rights'
          || scope.referenceAssetId !== reference?.assetId
          || scope.referenceAssetSha256 !== reference?.sha256
          || scope.rightsRecordSha256 !== canonicalSha256(reference?.rights)
          || canonicalJson(scope.rightsFields) !== canonicalJson(['sourceType', 'rightsHolder'])
          || idempotencyKey === undefined
          || !/^qingmu:rights-exception:v1:[0-9a-f]{64}$/.test(idempotencyKey)
        ) {
          throw new Error('reference rights exception release browser boundary or lineage mismatch')
        }
        persistedReferenceRightsExceptionIdempotencyKey = idempotencyKey
        persistedReferenceRightsExceptionResult = {
          schema: 'jason.qingmu-reference-rights-exception-release-result.v1',
          changeSetId: 'changeset-rights-exception-e2e-1',
          commandReceiptId: 'command-receipt-rights-exception-e2e-1',
          eventId: 'event-rights-exception-e2e-1',
          payloadSha256: 'e7'.repeat(32),
          release: {
            id: 'rights-exception-release-e2e-1',
            decision: 'exception_release',
            subjectType: 'element_profile',
            subjectId: 'prop-1',
            subjectRevision: 5,
            subjectSha256,
            scope,
            actorId: 'approver-e2e-1',
            actorRole: 'approver',
            actorNaturalPersonId: 'natural-person-approver-e2e-1',
            producerActorId: 'producer-e2e-1',
            producerNaturalPersonId: 'natural-person-producer-e2e-1',
            assetProducerActorId: 'asset-producer-e2e-1',
            assetProducerNaturalPersonId: 'natural-person-asset-producer-e2e-1',
            assetProducerTaskId: 'asset-producer-task-e2e-1',
            assetProducerTaskRequestSha256: 'd6'.repeat(32),
            authSessionId: 'recent-auth-session-e2e-1',
            reason: command.reason,
            releasedAt: '2026-08-27T10:15:00+08:00',
          },
          changed: false,
          providerCalls: 0,
          selectionAuthority: 'not_granted',
          humanApprovalInferred: false,
        }
        resolveReferenceRightsExceptionReleaseAccepted?.()
        await referenceRightsExceptionReleaseResponseReleased
        if (!response.destroyed && !response.writableEnded) {
          json(response, 201, persistedReferenceRightsExceptionResult)
        }
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === `/api/qingmu/change-sets/${REFERENCE_RIGHTS_CHANGE_SET_ID}:commit`
      ) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'targetType',
          'targetId',
          'elementKind',
          'episodeId',
          'baseRevision',
          'baseSnapshotSha256',
          'idempotencyKey',
          'expectedPayloadSha256',
        ].sort()
        const baseSubject = currentPropSubject()
        if (
          propRevision !== 4
          || propRightsRecorded
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.targetType !== 'element_profile'
          || command.targetId !== 'prop-1'
          || command.elementKind !== 'prop'
          || command.episodeId !== null
          || command.baseRevision !== 4
          || command.baseSnapshotSha256 !== canonicalSha256(baseSubject)
          || command.idempotencyKey !== REFERENCE_RIGHTS_IDEMPOTENCY_KEY
          || command.expectedPayloadSha256 !== REFERENCE_RIGHTS_PAYLOAD_SHA
        ) {
          throw new Error('reference rights commit lineage mismatch')
        }
        propRevision = 5
        propRightsRecorded = true
        propRights = recordedReferenceRightsRecord()
        persistedReferenceRightsReceipt = referenceRightsCommitReceiptFixture(canonicalSha256(currentPropSubject()))
        resolveReferenceRightsCommitAccepted?.()
        await referenceRightsCommitResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, persistedReferenceRightsReceipt)
        return
      }
      const elementCommitKind = (['actor', 'prop'] as const).find(elementKind =>
        url.pathname === `/api/qingmu/change-sets/${ELEMENT_FIXTURES[elementKind].changeSetId}:commit`)
      if (request.method === 'POST' && elementCommitKind !== undefined) {
        const command = isRecord(body) ? body : {}
        const fixture = ELEMENT_FIXTURES[elementCommitKind]
        const expectedIdempotencyKey = elementCommitKind === 'actor' ? ACTOR_IDEMPOTENCY_KEY : PROP_IDEMPOTENCY_KEY
        if (
          command.idempotencyKey !== expectedIdempotencyKey
          || command.expectedPayloadSha256 !== fixture.payloadSha256
          || command.episodeId !== null
        ) {
          throw new Error(`${elementCommitKind} commit lineage mismatch`)
        }
        if (elementCommitKind === 'actor') {
          actorRevision = 4
          actorIdentity = ACTOR_UPDATED_IDENTITY
          persistedActorReceipt = elementCommitReceiptFixture(
            'actor',
            canonicalSha256(elementSubject('actor', actorRevision, actorIdentity)),
            expectedIdempotencyKey,
          )
          resolveActorCommitAccepted?.()
          await actorCommitResponseReleased
          if (!response.destroyed && !response.writableEnded) json(response, 200, persistedActorReceipt)
        } else {
          propRevision = 4
          propPrompt = PROP_UPDATED_PROMPT
          persistedPropReceipt = propCommitReceiptFixture(canonicalSha256(currentPropSubject()))
          resolvePropCommitAccepted?.()
          await propCommitResponseReleased
          if (!response.destroyed && !response.writableEnded) json(response, 200, persistedPropReceipt)
        }
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${PROMPT_IR_STORYBOARD_REVISION_ID}/frames/${PROMPT_IR_FRAME_ID}/prompt-ir/change-sets/${PROMPT_IR_CHANGE_SET_ID}/command-receipt`
      ) {
        if (
          persistedPromptIrEditReceipt === undefined
          || url.search !== ''
          || request.headers['idempotency-key'] !== PROMPT_IR_EDIT_IDEMPOTENCY_KEY
        ) {
          json(response, 404, { error: 'PromptIR edit receipt not found' })
          return
        }
        json(response, 200, promptIrRecoveryEnvelope(persistedPromptIrEditReceipt))
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${PROMPT_IR_STORYBOARD_REVISION_ID}/frames/${PROMPT_IR_FRAME_ID}/prompt-ir/selection-command-receipt`
      ) {
        if (
          persistedPromptIrSelectionReceipt === undefined
          || url.search !== ''
          || request.headers['idempotency-key'] !== PROMPT_IR_SELECTION_IDEMPOTENCY_KEY
        ) {
          json(response, 404, { error: 'PromptIR selection receipt not found' })
          return
        }
        json(response, 200, promptIrRecoveryEnvelope(persistedPromptIrSelectionReceipt))
        return
      }
      if (
        request.method === 'GET'
        && path === `/api/qingmu/projects/project-1/episodes/episode-1/change-sets/${CHANGE_SET_ID}/command-receipt`
      ) {
        if (persistedReceipt === undefined) {
          json(response, 404, { error: 'receipt not found' })
          return
        }
        json(response, 200, {
          schema: 'jason.qingmu-command-receipt-recovery.v1',
          recovered: true,
          receiptSha256: RECEIPT_SHA,
          receipt: persistedReceipt,
        })
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === '/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases/command-receipt'
      ) {
        if (
          persistedReferenceRightsExceptionResult === undefined
          || persistedReferenceRightsExceptionIdempotencyKey === undefined
          || url.search !== ''
          || request.headers['idempotency-key'] !== persistedReferenceRightsExceptionIdempotencyKey
        ) {
          json(response, 404, { error: 'reference rights exception release receipt not found' })
          return
        }
        json(response, 200, {
          schema: 'jason.qingmu-command-receipt-recovery.v1',
          recovered: true,
          receiptSha256: canonicalSha256(persistedReferenceRightsExceptionResult),
          receipt: persistedReferenceRightsExceptionResult,
        })
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets/${REFERENCE_RIGHTS_CHANGE_SET_ID}/command-receipt`
      ) {
        if (
          persistedReferenceRightsReceipt === undefined
          || url.search !== ''
          || request.headers['idempotency-key'] !== REFERENCE_RIGHTS_IDEMPOTENCY_KEY
        ) {
          json(response, 404, { error: 'reference rights receipt not found' })
          return
        }
        json(response, 200, {
          schema: 'jason.qingmu-command-receipt-recovery.v1',
          recovered: true,
          receiptSha256: canonicalSha256(persistedReferenceRightsReceipt),
          receipt: persistedReferenceRightsReceipt,
        })
        return
      }
      const elementRecoveryKind = (['actor', 'prop'] as const).find((elementKind) => {
        const fixture = ELEMENT_FIXTURES[elementKind]
        return path === `/api/qingmu/projects/project-1/elements/${elementKind}/${fixture.targetId}/change-sets/${fixture.changeSetId}/command-receipt`
      })
      if (request.method === 'GET' && elementRecoveryKind !== undefined) {
        const receipt = elementRecoveryKind === 'actor' ? persistedActorReceipt : persistedPropReceipt
        if (receipt === undefined) {
          json(response, 404, { error: 'receipt not found' })
          return
        }
        json(response, 200, {
          schema: 'jason.qingmu-command-receipt-recovery.v1',
          recovered: true,
          receiptSha256: canonicalSha256(receipt),
          receipt,
        })
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/projects/project-1/elements/scene/scene-1/change-sets/${REFERENCE_SELECT_CHANGE_SET_ID}/command-receipt`
      ) {
        if (
          persistedReferenceReceipt === undefined
          || url.search !== ''
          || request.headers['idempotency-key'] !== REFERENCE_SELECT_IDEMPOTENCY_KEY
        ) {
          json(response, 404, { error: 'reference receipt not found' })
          return
        }
        json(response, 200, {
          schema: 'jason.qingmu-command-receipt-recovery.v1',
          recovered: true,
          receiptSha256: canonicalSha256(persistedReferenceReceipt),
          receipt: persistedReferenceReceipt,
        })
        return
      }

      json(response, 404, { error: 'unexpected isolated route' })
    })().catch(() => {
      if (!response.headersSent) json(response, 500, { error: 'isolated double failed' })
      else response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('isolated Yimeng double did not bind a TCP port')
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${String((address).port)}`,
    commitAccepted,
    releaseCommitResponse: () => resolveCommitResponse?.(),
    actorCommitAccepted,
    releaseActorCommitResponse: () => resolveActorCommitResponse?.(),
    propCommitAccepted,
    releasePropCommitResponse: () => resolvePropCommitResponse?.(),
    referenceRightsCommitAccepted,
    releaseReferenceRightsCommitResponse: () => resolveReferenceRightsCommitResponse?.(),
    referenceRightsExceptionReleaseAccepted,
    releaseReferenceRightsExceptionReleaseResponse: () => resolveReferenceRightsExceptionReleaseResponse?.(),
    referenceCommitAccepted,
    releaseReferenceCommitResponse: () => resolveReferenceCommitResponse?.(),
    referenceRegenerationCommitAccepted,
    releaseReferenceRegenerationCommitResponse: () => resolveReferenceRegenerationCommitResponse?.(),
    promptIrEditAccepted,
    releasePromptIrEditResponse: () => resolvePromptIrEditResponse?.(),
    promptIrSelectionAccepted,
    releasePromptIrSelectionResponse: () => resolvePromptIrSelectionResponse?.(),
  }
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

function restoreToken(): void {
  if (ORIGINAL_TOKEN === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
  else process.env.YIMENG_API_TOKEN = ORIGINAL_TOKEN
}

function restoreAttestationKey(): void {
  if (ORIGINAL_ATTESTATION_KEY === undefined) Reflect.deleteProperty(process.env, 'QINGMU_IMAGO_ATTESTATION_KEY')
  else process.env.QINGMU_IMAGO_ATTESTATION_KEY = ORIGINAL_ATTESTATION_KEY
}

async function expectNoVisibleTechnicalBrand(page: Page): Promise<void> {
  expect(await page.locator('body').innerText()).not.toMatch(/(?:DeepSeek|Harness|Skill|Stage|V6|技能包)/i)
}

describe.skipIf(
  process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu'
  || IMAGO_CORE_ROOT === undefined
  || IMAGO_CORE_ROOT === '',
)(
  'web e2e: Qingmu episode script ChangeSet workspace',
  () => {
    let scaffold: WebScaffold
    let browser: Browser
    let page: Page
    let tripwire: ReturnType<typeof watchConsole>
    let yimengServer: Server | undefined
    let overlayRoot: string | undefined
    let commitAccepted: Promise<void> | undefined
    let releaseCommitResponse: (() => void) | undefined
    let actorCommitAccepted: Promise<void> | undefined
    let releaseActorCommitResponse: (() => void) | undefined
    let propCommitAccepted: Promise<void> | undefined
    let releasePropCommitResponse: (() => void) | undefined
    let referenceRightsCommitAccepted: Promise<void> | undefined
    let releaseReferenceRightsCommitResponse: (() => void) | undefined
    let referenceRightsExceptionReleaseAccepted: Promise<void> | undefined
    let releaseReferenceRightsExceptionReleaseResponse: (() => void) | undefined
    let referenceCommitAccepted: Promise<void> | undefined
    let releaseReferenceCommitResponse: (() => void) | undefined
    let referenceRegenerationCommitAccepted: Promise<void> | undefined
    let releaseReferenceRegenerationCommitResponse: (() => void) | undefined
    let promptIrEditAccepted: Promise<void> | undefined
    let releasePromptIrEditResponse: (() => void) | undefined
    let promptIrSelectionAccepted: Promise<void> | undefined
    let releasePromptIrSelectionResponse: (() => void) | undefined
    const capturedRequests: CapturedYimengRequest[] = []
    const scriptReadRevisions: number[] = []
    const actorReadRevisions: number[] = []
    const sceneReadRevisions: number[] = []
    const propReadRevisions: number[] = []
    const propReadSubjects: Array<ReturnType<typeof propSubject>> = []
    const propReviewDecisionReads: Array<Array<Record<string, unknown>>> = []
    const sceneReferenceCandidateReads: ReturnType<typeof sceneReferenceCandidatesFixture>[] = []
    const propReferenceCandidateReads: ReturnType<typeof propReferenceCandidatesFixture>[] = []
    const promptIrWorkflowStatuses: string[] = []
    const browserRpcRequests: Array<{ readonly path: string; readonly body: unknown }> = []
    let resolveReferenceRightsMethodProjectionSha256: ((sha256: string) => void) | undefined
    const referenceRightsMethodProjectionSha256 = new Promise<string>((resolve) => {
      resolveReferenceRightsMethodProjectionSha256 = resolve
    })

    beforeAll(async () => {
      if (IMAGO_CORE_ROOT === undefined || IMAGO_CORE_ROOT === '') {
        throw new Error('Qingmu browser integration requires IMAGO_OS_CORE_ROOT')
      }
      process.env.YIMENG_API_TOKEN = YIMENG_TOKEN
      process.env.QINGMU_IMAGO_ATTESTATION_KEY = IMAGO_ATTESTATION_KEY
      const yimeng = await startYimengDouble(
        capturedRequests,
        scriptReadRevisions,
        actorReadRevisions,
        sceneReadRevisions,
        propReadRevisions,
        propReadSubjects,
        propReviewDecisionReads,
        sceneReferenceCandidateReads,
        propReferenceCandidateReads,
        promptIrWorkflowStatuses,
        referenceRightsMethodProjectionSha256,
      )
      yimengServer = yimeng.server
      commitAccepted = yimeng.commitAccepted
      releaseCommitResponse = yimeng.releaseCommitResponse
      actorCommitAccepted = yimeng.actorCommitAccepted
      releaseActorCommitResponse = yimeng.releaseActorCommitResponse
      propCommitAccepted = yimeng.propCommitAccepted
      releasePropCommitResponse = yimeng.releasePropCommitResponse
      referenceRightsCommitAccepted = yimeng.referenceRightsCommitAccepted
      releaseReferenceRightsCommitResponse = yimeng.releaseReferenceRightsCommitResponse
      referenceRightsExceptionReleaseAccepted = yimeng.referenceRightsExceptionReleaseAccepted
      releaseReferenceRightsExceptionReleaseResponse = yimeng.releaseReferenceRightsExceptionReleaseResponse
      referenceCommitAccepted = yimeng.referenceCommitAccepted
      releaseReferenceCommitResponse = yimeng.releaseReferenceCommitResponse
      referenceRegenerationCommitAccepted = yimeng.referenceRegenerationCommitAccepted
      releaseReferenceRegenerationCommitResponse = yimeng.releaseReferenceRegenerationCommitResponse
      promptIrEditAccepted = yimeng.promptIrEditAccepted
      releasePromptIrEditResponse = yimeng.releasePromptIrEditResponse
      promptIrSelectionAccepted = yimeng.promptIrSelectionAccepted
      releasePromptIrSelectionResponse = yimeng.releasePromptIrSelectionResponse
      overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-qingmu-script-e2e-'))
      const overlayPath = join(overlayRoot, 'qingmu-script.overlay.yml')
      const qingmuOverlay = resolveQingmuOverlayEntrypoints(await readFile(QINGMU_OVERLAY, 'utf8'))
      const integrationOverlay = `${qingmuOverlay.trimEnd()}\n\n`
        + `- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(yimeng.baseUrl)}\n    timeoutMs: 5000\n\n`
        + `- id: qingmu-yimeng-command-adapter\n  config:\n    baseUrl: ${JSON.stringify(yimeng.baseUrl)}\n    timeoutMs: 5000\n`
      expect(integrationOverlay).not.toContain('coreRoot:')
      expect(integrationOverlay).not.toContain('QINGMU_IMAGO_ATTESTATION_KEY')
      expect(integrationOverlay).not.toContain(IMAGO_ATTESTATION_KEY)
      await writeFile(overlayPath, integrationOverlay)

      scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath })
      await mountQingmuClientPackage(
        scaffold,
        '@deepseek-ai/dsh-experimental-client-ui-brand-qingmu',
        'packages/experimental/client-ui-brand-qingmu',
      )
      await mountQingmuClientPackage(
        scaffold,
        '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit',
        'packages/experimental/client-ui-qingmu-cockpit',
      )
      await scaffold.ctx.loader.await()
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
      page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, locale: ZH_BROWSER_LOCALE })
      page.on('request', (request) => {
        const requestPath = new URL(request.url()).pathname
        if (requestPath !== '/qingmu-imago-method/referenceAssetMethod') return
        browserRpcRequests.push({ path: requestPath, body: request.postDataJSON() as unknown })
      })
      page.on('response', (response) => {
        if (new URL(response.url()).pathname !== '/qingmu-imago-method/referenceAssetMethod') return
        void response.json().then((wire: unknown) => {
          const root = isRecord(wire) ? wire : {}
          const result = isRecord(root.result) ? root.result : {}
          const value = isRecord(result.value) ? result.value : {}
          if (
            result.ok === true
            && value.schema === 'qingmu.imago-element-method-adapter-result.v1'
            && typeof value.projectionSha256 === 'string'
          ) {
            resolveReferenceRightsMethodProjectionSha256?.(value.projectionSha256)
          }
        }).catch(() => undefined)
      })
      tripwire = watchConsole(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      try {
        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-qingmu-bootstrap')
        const bodyText = await page.locator('body').innerText().catch(() => '')
        throw new Error(`Qingmu bootstrap did not render its frame: ${JSON.stringify({
          url: page.url(),
          bodyText: bodyText.slice(0, 2_000),
          ...tripwire,
        })}`, { cause: error })
      }
      await page.getByRole('button', { name: '进入青木 OS' }).click()
    }, 120_000)

    afterAll(async () => {
      const failures: unknown[] = []
      releaseCommitResponse?.()
      releaseActorCommitResponse?.()
      releasePropCommitResponse?.()
      releaseReferenceRightsCommitResponse?.()
      releaseReferenceCommitResponse?.()
      releaseReferenceRegenerationCommitResponse?.()
      releasePromptIrEditResponse?.()
      releasePromptIrSelectionResponse?.()
      const requestEvidencePath = process.env.QINGMU_REQUEST_EVIDENCE_PATH?.trim()
      if (requestEvidencePath !== undefined && requestEvidencePath !== '') {
        await (async () => {
          await mkdir(dirname(requestEvidencePath), { recursive: true })
          const evidence = capturedRequests.map((request) => {
            const body = isRecord(request.body) ? request.body : undefined
            const projection = body === undefined || !isRecord(body.methodProjection)
              ? undefined
              : body.methodProjection
            const methodDefinition = projection === undefined || !isRecord(projection.method_definition)
              ? undefined
              : projection.method_definition
            return {
              method: request.method,
              path: request.path,
              idempotencyKey: request.idempotencyKey,
              body: body === undefined ? undefined : {
                targetType: body.targetType,
                targetId: body.targetId,
                elementKind: body.elementKind,
                operation: body.operation,
                changeSetId: body.changeSetId,
                baseRevision: body.baseRevision,
                methodId: methodDefinition?.id,
              },
            }
          })
          await writeFile(requestEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
        })().catch((error: unknown) => failures.push(error))
      }
      const runEvidencePath = process.env.QINGMU_RUN_EVIDENCE_PATH?.trim()
      if (runEvidencePath !== undefined && runEvidencePath !== '') {
        await (async () => {
          if (IMAGO_CORE_ROOT === undefined || IMAGO_CORE_ROOT === '') {
            throw new Error('Qingmu run evidence requires IMAGO_OS_CORE_ROOT')
          }
          const activeRuntimeBundlePath = join(IMAGO_CORE_ROOT, 'pipeline/v6-active-runtime-bundle.json')
          const activeRuntimeBundle = JSON.parse(await readFile(activeRuntimeBundlePath, 'utf8')) as unknown
          if (!isRecord(activeRuntimeBundle)
            || typeof activeRuntimeBundle.bundle_sha256 !== 'string'
            || !/^[0-9a-f]{64}$/.test(activeRuntimeBundle.bundle_sha256)) {
            throw new Error('IMAGO active runtime bundle did not expose a canonical bundle_sha256')
          }
          const evidence = {
            schema: 'qingmu.browser-run-evidence.v1',
            browser: 'chromium',
            pageUrl: scaffold?.baseUrl,
            coreRoot: IMAGO_CORE_ROOT,
            coreActiveRuntimeBundlePath: activeRuntimeBundlePath,
            coreActiveRuntimeBundleSha256: activeRuntimeBundle.bundle_sha256,
            requestCount: capturedRequests.length,
            screenshots: {
              script: process.env.QINGMU_EVIDENCE_SCREENSHOT,
              actor: process.env.QINGMU_ACTOR_EVIDENCE_SCREENSHOT,
              scene: process.env.QINGMU_SCENE_EVIDENCE_SCREENSHOT,
              prop: process.env.QINGMU_ASSET_EVIDENCE_SCREENSHOT,
            },
          }
          await mkdir(dirname(runEvidencePath), { recursive: true })
          await writeFile(runEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
        })().catch((error: unknown) => failures.push(error))
      }
      await browser?.close().catch((error: unknown) => failures.push(error))
      await scaffold?.close().catch((error: unknown) => failures.push(error))
      await closeServer(yimengServer).catch((error: unknown) => failures.push(error))
      if (overlayRoot !== undefined) {
        await rm(overlayRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      }
      restoreToken()
      restoreAttestationKey()
      if (failures.length > 0) throw new AggregateError(failures, 'Qingmu script e2e cleanup failed')
    })

    it('recovers a committed receipt after the response is lost to a same-tab reload without resubmitting', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-script-workspace'))
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })

      await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      const editor = dialog.getByRole('textbox', { name: '结构化剧本 JSON' })
      await expect.poll(() => editor.inputValue(), { timeout: 10_000 })
        .toContain('旧走廊')
      await editor.fill(JSON.stringify(PROPOSED_SCRIPT, null, 2))
      await dialog.getByRole('button', { name: '生成变更预览' }).click()

      await dialog.getByText('$.scenes[0].title').waitFor({ timeout: 10_000 })
      const commitButton = dialog.getByRole('button', { name: '确认提交剧本' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request => request.path.endsWith(':commit'))).toEqual([])

      await dialog.getByRole('checkbox', {
        name: '我已核对本次差异，并确认提交此 ChangeSet 到易梦权威剧本；此勾选仅防误触，不代表身份授权或内容签收。',
      }).check()
      expect(await commitButton.isEnabled()).toBe(true)
      await commitButton.click()

      if (commitAccepted === undefined) throw new Error('isolated commit gate was not initialized')
      await commitAccepted
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:script-commit-recovery:v1:')).length), { timeout: 10_000 })
        .toBe(1)

      expect(capturedRequests.filter(request => request.path.includes('/command-receipt'))).toEqual([])
      await page.reload({ waitUntil: 'load' })
      releaseCommitResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const enterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await enterButton.isVisible()) await enterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveredDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveredDialog.waitFor({ timeout: 10_000 })
      await recoveredDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await recoveredDialog.getByRole('tab', { name: '剧本与资产' }).click()

      const recoveredEditor = recoveredDialog.getByRole('textbox', { name: '结构化剧本 JSON' })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 10_000 })
        .toBe(JSON.stringify(PROPOSED_SCRIPT, null, 2))
      expect(await recoveredEditor.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request => request.path.includes('/command-receipt'))).toEqual([])
      await recoveredDialog.getByRole('button', { name: '查询并恢复原回执' }).click()

      await recoveredDialog.getByRole('heading', { name: '已恢复原始提交回执' })
        .waitFor({ timeout: 10_000 })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 10_000 })
        .toBe(JSON.stringify(PROPOSED_SCRIPT, null, 2))
      await expect.poll(() => [...scriptReadRevisions], { timeout: 10_000 }).toEqual([3, 4, 4])
      expect(await recoveredDialog.getByText('receipt-1').count()).toBe(1)
      expect(await recoveredDialog.getByText('event-1').count()).toBe(1)
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:script-commit-recovery:v1:')))).toEqual([])

      const commands = capturedRequests.filter(request => request.method === 'POST')
      expect(commands.map(request => request.path)).toEqual([
        '/api/qingmu/episodes/episode-1/script/change-sets',
        `/api/qingmu/change-sets/${CHANGE_SET_ID}:preview`,
        `/api/qingmu/change-sets/${CHANGE_SET_ID}:commit`,
      ])
      expect(commands[0]?.body).toEqual({
        projectId: 'project-1',
        script: PROPOSED_SCRIPT,
        baseRevision: 3,
      })
      expect(commands[1]?.body).toEqual({
        projectId: 'project-1',
        episodeId: 'episode-1',
        baseRevision: 3,
      })
      expect(commands[2]?.body).toEqual({
        projectId: 'project-1',
        episodeId: 'episode-1',
        baseRevision: 3,
        idempotencyKey: IDEMPOTENCY_KEY,
        expectedPayloadSha256: PAYLOAD_SHA,
      })

      const recoveryRequests = capturedRequests.filter(request => request.path.includes('/command-receipt'))
      expect(recoveryRequests).toHaveLength(1)
      expect(recoveryRequests[0]).toMatchObject({
        method: 'GET',
        path: `/api/qingmu/projects/project-1/episodes/episode-1/change-sets/${CHANGE_SET_ID}/command-receipt`,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: undefined,
      })

      const health = capturedRequests.find(request => request.path === '/api/health')
      expect(health?.authorization).toBeUndefined()
      const protectedRequests = capturedRequests.filter(request => request.path !== '/api/health')
      expect(protectedRequests.length).toBeGreaterThan(0)
      expect(protectedRequests.every(request => request.authorization === `Bearer ${YIMENG_TOKEN}`)).toBe(true)
      expect(capturedRequests.every(request => request.cookie === undefined)).toBe(true)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])

      const evidencePath = process.env.QINGMU_EVIDENCE_SCREENSHOT?.trim()
      if (evidencePath !== undefined && evidencePath !== '') {
        await mkdir(dirname(evidencePath), { recursive: true })
        await page.screenshot({ path: evidencePath, fullPage: true })
      }
    }, 60_000)

    it('runs the actor identity through real Host adapters and GET-only receipt recovery', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-actor-workbench'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      if (!(await dialog.isVisible())) {
        await page.getByRole('button', { name: '青木制作台' }).click()
        await dialog.waitFor({ timeout: 10_000 })
        await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      }
      const kindSwitch = dialog.getByRole('group', { name: '选择人物、环境或道具' })
      await kindSwitch.getByRole('button', { name: '人物' }).click()

      const editor = dialog.getByRole('textbox', { name: '人物视觉身份定义' })
      await expect.poll(() => editor.inputValue(), { timeout: 15_000 }).toBe(ACTOR_ORIGINAL_IDENTITY)
      await dialog.getByText('专业方法提示').waitFor({ timeout: 15_000 })
      await dialog.getByText('提交前检查清单').waitFor({ timeout: 15_000 })
      await expectNoVisibleTechnicalBrand(page)
      await editor.fill(ACTOR_UPDATED_IDENTITY)
      await dialog.getByRole('button', { name: '生成元素变更预览' }).click()

      const preview = dialog.getByRole('region', { name: '元素 ChangeSet 预览' })
      await preview.getByText('提案基线版本').waitFor({ timeout: 10_000 })
      await preview.getByText('当前权威版本', { exact: true }).waitFor()
      await preview.getByText('拟提交版本', { exact: true }).waitFor()
      expect(await preview.getByText(ACTOR_ORIGINAL_IDENTITY, { exact: true }).count()).toBe(2)
      expect(await preview.getByText(ACTOR_UPDATED_IDENTITY, { exact: true }).count()).toBe(1)
      await preview.getByText(canonicalSha256(elementImpactFixture('actor')), { exact: true }).waitFor()
      const impact = preview.getByRole('region', { name: '参考资产影响' })
      for (const [label, value] of [
        ['受影响的参考资产', 'reference-actor-1'],
        ['将失效的素材批准', 'approval-actor-1'],
        ['受影响的衍生素材', 'derived-actor-1'],
        ['受影响的参考包', 'reference-pack-actor-1'],
        ['受影响的 PromptIR', 'prompt-ir-actor-1'],
        ['受影响的故事板帧', 'storyboard-frame-actor-1'],
        ['仍待人工判断', 'human-review-actor-1'],
      ] as const) {
        await impact.getByText(label, { exact: true }).waitFor()
        await impact.getByText(value, { exact: true }).waitFor()
      }
      const commitButton = dialog.getByRole('button', { name: '确认提交元素资料' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request =>
        request.path === `/api/qingmu/change-sets/${ACTOR_CHANGE_SET_ID}:commit`)).toEqual([])
      await dialog.getByRole('checkbox', {
        name: '我已核对元素资料差异和影响分析，并确认提交此 ChangeSet；这不代表素材审美签收，也不授权付费生成。',
      }).check()
      expect(await commitButton.isEnabled()).toBe(true)

      const evidencePath = process.env.QINGMU_ACTOR_EVIDENCE_SCREENSHOT?.trim()
      if (evidencePath !== undefined && evidencePath !== '') {
        await mkdir(dirname(evidencePath), { recursive: true })
        await page.screenshot({ path: evidencePath, fullPage: true })
      }
      await commitButton.click()

      if (actorCommitAccepted === undefined) throw new Error('isolated actor commit gate was not initialized')
      await actorCommitAccepted
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:')).length), { timeout: 10_000 })
        .toBe(1)

      const recoveryPath = `/api/qingmu/projects/project-1/elements/actor/actor-1/change-sets/${ACTOR_CHANGE_SET_ID}/command-receipt`
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      await page.reload({ waitUntil: 'load' })
      releaseActorCommitResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const enterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await enterButton.isVisible()) await enterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveredDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveredDialog.waitFor({ timeout: 10_000 })
      await recoveredDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await recoveredDialog.getByRole('tab', { name: '剧本与资产' }).click()

      const recoveredEditor = recoveredDialog.getByRole('textbox', { name: '人物视觉身份定义' })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 15_000 }).toBe(ACTOR_UPDATED_IDENTITY)
      expect(await recoveredEditor.isDisabled()).toBe(true)
      await recoveredDialog.getByRole('button', { name: '查询并恢复原回执' }).click()
      await expect.poll(() => capturedRequests.filter(request => request.path === recoveryPath).length, {
        timeout: 10_000,
      }).toBe(1)
      await recoveredDialog.getByRole('heading', { name: '已恢复原始提交回执' }).waitFor({ timeout: 10_000 })
      await expect.poll(() => actorReadRevisions.slice(-2), { timeout: 10_000 }).toEqual([4, 4])
      expect(actorReadRevisions).toContain(3)
      expect(await recoveredDialog.getByText('receipt-actor-1').count()).toBe(1)
      expect(await recoveredDialog.getByText('event-actor-1').count()).toBe(1)
      expect(await recoveredDialog.getByText(canonicalSha256(elementImpactFixture('actor')), { exact: true }).count()).toBe(1)
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:'))), {
        timeout: 15_000,
      }).toEqual([])

      const actorCommands = capturedRequests.filter(request => request.method === 'POST' && (
        request.path.includes('/elements/actor/actor-1/')
        || (isRecord(request.body) && request.body.elementKind === 'actor')
      ))
      expect(actorCommands.map(request => request.path)).toEqual([
        '/api/qingmu/projects/project-1/elements/actor/actor-1/change-sets',
        `/api/qingmu/change-sets/${ACTOR_CHANGE_SET_ID}:preview`,
        `/api/qingmu/change-sets/${ACTOR_CHANGE_SET_ID}:commit`,
      ])
      const proposalBody = actorCommands[0]?.body
      if (!isRecord(proposalBody) || !isRecord(proposalBody.methodProjection)) {
        throw new Error('captured actor proposal did not include a method projection')
      }
      expect(proposalBody).toMatchObject({
        elementKind: 'actor',
        operation: 'replaceVisualIdentity',
        visualIdentity: ACTOR_UPDATED_IDENTITY,
        baseRevision: 3,
        baseSnapshotSha256: canonicalSha256(elementSubject('actor', 3, ACTOR_ORIGINAL_IDENTITY)),
      })
      expect(proposalBody.visualPrompt).toBeUndefined()
      expect(proposalBody.methodProjection).toMatchObject({
        method_definition: { id: 'imago-v6-b2ac-actor-profile' },
        project_state_persisted: false,
        paid_provider_authority: 'not_granted',
        selection_authority: 'not_granted',
        human_approval_inferred: false,
      })
      expect(actorCommands[1]?.body).toMatchObject({
        targetId: 'actor-1',
        elementKind: 'actor',
        baseRevision: 3,
      })
      expect(actorCommands[2]?.body).toMatchObject({
        targetId: 'actor-1',
        elementKind: 'actor',
        idempotencyKey: ACTOR_IDEMPOTENCY_KEY,
        expectedPayloadSha256: ACTOR_PAYLOAD_SHA,
      })
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([
        expect.objectContaining({
          method: 'GET',
          idempotencyKey: ACTOR_IDEMPOTENCY_KEY,
          body: undefined,
        }),
      ])
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 60_000)

    it('switches to the environment and previews its canonical method and seven impact groups without committing', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-scene-workbench'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const kindSwitch = dialog.getByRole('group', { name: '选择人物、环境或道具' })
      await kindSwitch.getByRole('button', { name: '环境' }).click()
      expect(await kindSwitch.getByRole('button', { name: '环境' }).getAttribute('aria-pressed')).toBe('true')

      const editor = dialog.getByRole('textbox', { name: '环境／道具视觉提示词' })
      await expect.poll(() => editor.inputValue(), { timeout: 15_000 }).toBe(SCENE_ORIGINAL_PROMPT)
      await editor.fill(SCENE_UPDATED_PROMPT)
      await dialog.getByRole('button', { name: '生成元素变更预览' }).click()
      const preview = dialog.getByRole('region', { name: '元素 ChangeSet 预览' })
      await preview.getByText('提案基线版本').waitFor({ timeout: 10_000 })
      await preview.getByText('当前权威版本', { exact: true }).waitFor()
      await preview.getByText('拟提交版本', { exact: true }).waitFor()
      expect(await preview.getByText(SCENE_ORIGINAL_PROMPT, { exact: true }).count()).toBe(2)
      expect(await preview.getByText(SCENE_UPDATED_PROMPT, { exact: true }).count()).toBe(1)
      await preview.getByText(canonicalSha256(elementImpactFixture('scene')), { exact: true }).waitFor()
      const impact = preview.getByRole('region', { name: '参考资产影响' })
      for (const [label, value] of [
        ['受影响的参考资产', 'reference-scene-1'],
        ['将失效的素材批准', 'approval-scene-1'],
        ['受影响的衍生素材', 'derived-scene-1'],
        ['受影响的参考包', 'reference-pack-scene-1'],
        ['受影响的 PromptIR', 'prompt-ir-scene-1'],
        ['受影响的故事板帧', 'storyboard-frame-scene-1'],
        ['仍待人工判断', 'human-review-scene-1'],
      ] as const) {
        await impact.getByText(label, { exact: true }).waitFor()
        await impact.getByText(value, { exact: true }).waitFor()
      }
      const commitButton = dialog.getByRole('button', { name: '确认提交元素资料' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request =>
        request.path === `/api/qingmu/change-sets/${SCENE_CHANGE_SET_ID}:commit`)).toEqual([])
      const confirm = dialog.getByRole('checkbox', {
        name: '我已核对元素资料差异和影响分析，并确认提交此 ChangeSet；这不代表素材审美签收，也不授权付费生成。',
      })
      await confirm.check()
      expect(await commitButton.isEnabled()).toBe(true)

      const evidencePath = process.env.QINGMU_SCENE_EVIDENCE_SCREENSHOT?.trim()
      if (evidencePath !== undefined && evidencePath !== '') {
        await mkdir(dirname(evidencePath), { recursive: true })
        await page.screenshot({ path: evidencePath, fullPage: true })
      }
      await confirm.uncheck()
      expect(await commitButton.isDisabled()).toBe(true)

      const sceneCommands = capturedRequests.filter(request => request.method === 'POST' && (
        request.path.includes('/elements/scene/scene-1/')
        || (isRecord(request.body) && request.body.elementKind === 'scene')
      ))
      expect(sceneCommands.map(request => request.path)).toEqual([
        '/api/qingmu/projects/project-1/elements/scene/scene-1/change-sets',
        `/api/qingmu/change-sets/${SCENE_CHANGE_SET_ID}:preview`,
      ])
      const proposalBody = sceneCommands[0]?.body
      if (!isRecord(proposalBody) || !isRecord(proposalBody.methodProjection)) {
        throw new Error('captured scene proposal did not include a method projection')
      }
      expect(proposalBody).toMatchObject({
        elementKind: 'scene',
        operation: 'replaceVisualPrompt',
        visualPrompt: SCENE_UPDATED_PROMPT,
        baseRevision: 3,
        baseSnapshotSha256: canonicalSha256(elementSubject('scene', 3, SCENE_ORIGINAL_PROMPT)),
      })
      expect(proposalBody.visualIdentity).toBeUndefined()
      expect(proposalBody.methodProjection).toMatchObject({
        method_definition: { id: 'imago-v6-b2as-scene-profile' },
        project_state_persisted: false,
        paid_provider_authority: 'not_granted',
        selection_authority: 'not_granted',
        human_approval_inferred: false,
      })
      expect(sceneReadRevisions).toContain(3)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 60_000)

    it('runs the prop profile through real Host adapters and GET-only receipt recovery', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-prop-workbench'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      if (!(await dialog.isVisible())) {
        await page.getByRole('button', { name: '青木制作台' }).click()
        await dialog.waitFor({ timeout: 10_000 })
        await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      }
      await dialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()

      const editor = dialog.getByRole('textbox', { name: '环境／道具视觉提示词' })
      await expect.poll(() => editor.inputValue(), { timeout: 15_000 }).toBe(PROP_ORIGINAL_PROMPT)
      await dialog.getByText('专业方法提示').waitFor({ timeout: 15_000 })
      await dialog.getByText('提交前检查清单').waitFor({ timeout: 15_000 })
      await editor.fill(PROP_UPDATED_PROMPT)
      await dialog.getByRole('button', { name: '生成元素变更预览' }).click()

      await dialog.getByText('提交后会将现有正式参考标为过期，需重新生成或重选。')
        .waitFor({ timeout: 10_000 })
      const preview = dialog.getByRole('region', { name: '元素 ChangeSet 预览' })
      await preview.getByText('提案基线版本', { exact: true }).waitFor({ timeout: 10_000 })
      await preview.getByText('当前权威版本', { exact: true }).waitFor()
      await preview.getByText('拟提交版本', { exact: true }).waitFor()
      expect(await preview.getByText(PROP_ORIGINAL_PROMPT, { exact: true }).count()).toBe(2)
      expect(await preview.getByText(PROP_UPDATED_PROMPT, { exact: true }).count()).toBe(1)
      await preview.getByText(canonicalSha256(elementImpactFixture('prop')), { exact: true }).waitFor()
      const impact = preview.getByRole('region', { name: '参考资产影响' })
      for (const [label, value] of [
        ['受影响的参考资产', 'reference-prop-1'],
        ['将失效的素材批准', 'approval-prop-1'],
        ['受影响的衍生素材', 'derived-prop-1'],
        ['受影响的参考包', 'reference-pack-prop-1'],
        ['受影响的 PromptIR', 'prompt-ir-prop-1'],
        ['受影响的故事板帧', 'storyboard-frame-prop-1'],
        ['仍待人工判断', 'human-review-prop-1'],
      ] as const) {
        await impact.getByText(label, { exact: true }).waitFor()
        await impact.getByText(value, { exact: true }).waitFor()
      }
      const commitButton = dialog.getByRole('button', { name: '确认提交元素资料' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request =>
        request.path === `/api/qingmu/change-sets/${PROP_CHANGE_SET_ID}:commit`)).toEqual([])

      await dialog.getByRole('checkbox', {
        name: '我已核对元素资料差异和影响分析，并确认提交此 ChangeSet；这不代表素材审美签收，也不授权付费生成。',
      }).check()
      expect(await commitButton.isEnabled()).toBe(true)
      await commitButton.click()

      if (propCommitAccepted === undefined) throw new Error('isolated prop commit gate was not initialized')
      await propCommitAccepted
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:')).length), { timeout: 10_000 })
        .toBe(1)

      const recoveryPath = `/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets/${PROP_CHANGE_SET_ID}/command-receipt`
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      await page.reload({ waitUntil: 'load' })
      releasePropCommitResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const enterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await enterButton.isVisible()) await enterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveredDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveredDialog.waitFor({ timeout: 10_000 })
      await recoveredDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await recoveredDialog.getByRole('tab', { name: '剧本与资产' }).click()
      await recoveredDialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()

      const recoveredEditor = recoveredDialog.getByRole('textbox', { name: '环境／道具视觉提示词' })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 15_000 }).toBe(PROP_UPDATED_PROMPT)
      expect(await recoveredEditor.isDisabled()).toBe(true)
      await recoveredDialog.getByRole('button', { name: '查询并恢复原回执' }).click()
      await expect.poll(() => capturedRequests.filter(request => request.path === recoveryPath).length, {
        timeout: 10_000,
      }).toBe(1)
      const recoveredHeading = recoveredDialog.getByRole('heading', { name: '已恢复原始提交回执' })
      await expect.poll(async () => ({
        recovered: await recoveredHeading.count(),
        alerts: await recoveredDialog.getByRole('alert').allTextContents(),
      }), { timeout: 10_000 }).toEqual({ recovered: 1, alerts: [] })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 10_000 }).toBe(PROP_UPDATED_PROMPT)
      await expect.poll(() => propReadRevisions.slice(-2), { timeout: 10_000 }).toEqual([4, 4])
      expect(propReadRevisions).toContain(3)
      expect(await recoveredDialog.getByText('receipt-prop-1').count()).toBe(1)
      expect(await recoveredDialog.getByText('event-prop-1').count()).toBe(1)
      expect(await recoveredDialog.getByText(canonicalSha256(elementImpactFixture('prop')), { exact: true }).count()).toBe(1)
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:'))), {
        timeout: 15_000,
      }).toEqual([])

      const propCommands = capturedRequests.filter(request => request.method === 'POST' && (
        request.path.includes('/elements/prop/prop-1/')
        || (isRecord(request.body) && request.body.elementKind === 'prop')
      ))
      expect(propCommands.map(request => request.path)).toEqual([
        '/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets',
        `/api/qingmu/change-sets/${PROP_CHANGE_SET_ID}:preview`,
        `/api/qingmu/change-sets/${PROP_CHANGE_SET_ID}:commit`,
      ])
      const proposalBody = propCommands[0]?.body
      expect(isRecord(proposalBody)).toBe(true)
      if (!isRecord(proposalBody) || !isRecord(proposalBody.methodProjection) || !isRecord(proposalBody.methodAttestation)) {
        throw new Error('captured prop proposal did not include a method projection attestation')
      }
      expect(proposalBody).toMatchObject({
        elementKind: 'prop',
        operation: 'replaceVisualPrompt',
        visualPrompt: PROP_UPDATED_PROMPT,
        baseRevision: 3,
        baseSnapshotSha256: canonicalSha256(propSubject(3, PROP_ORIGINAL_PROMPT)),
      })
      expect(proposalBody.methodProjection).toMatchObject({
        method_definition: { id: 'imago-v6-b2as-prop-profile' },
        project_state_persisted: false,
        paid_provider_authority: 'not_granted',
        selection_authority: 'not_granted',
        human_approval_inferred: false,
      })
      expect(proposalBody.methodAttestation).toMatchObject({
        schema: 'qingmu.imago-element-method-attestation.v1',
        algorithm: 'hmac-sha256',
        projectionSha256: proposalBody.methodProjectionSha256,
        inputSnapshotSha256: proposalBody.methodProjection.input_snapshot_sha256,
        subjectSha256: canonicalSha256(proposalBody.methodProjection.subject),
      })
      expect(proposalBody.methodAttestation.signature).toMatch(/^[0-9a-f]{64}$/)
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(propCommands[1]?.body).toMatchObject({
        projectId: 'project-1',
        targetType: 'element_profile',
        targetId: 'prop-1',
        elementKind: 'prop',
        episodeId: null,
        baseRevision: 3,
      })
      expect(propCommands[2]?.body).toMatchObject({
        projectId: 'project-1',
        targetType: 'element_profile',
        targetId: 'prop-1',
        elementKind: 'prop',
        episodeId: null,
        baseRevision: 3,
        idempotencyKey: PROP_IDEMPOTENCY_KEY,
        expectedPayloadSha256: PROP_PAYLOAD_SHA,
      })

      const recoveryRequests = capturedRequests.filter(request => request.path === recoveryPath)
      expect(recoveryRequests).toHaveLength(1)
      expect(recoveryRequests[0]).toMatchObject({
        method: 'GET',
        idempotencyKey: PROP_IDEMPOTENCY_KEY,
        body: undefined,
      })
      expect(capturedRequests.every(request => request.cookie === undefined)).toBe(true)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])

      const evidencePath = process.env.QINGMU_ASSET_EVIDENCE_SCREENSHOT?.trim()
      if (evidencePath !== undefined && evidencePath !== '') {
        await mkdir(dirname(evidencePath), { recursive: true })
        await page.screenshot({ path: evidencePath, fullPage: true })
      }
    }, 60_000)

    it('records a Comment and a formal HumanDecision through separate Host contracts', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-review-events'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      if (!(await dialog.isVisible())) {
        await page.getByRole('button', { name: '青木制作台' }).click()
        await dialog.waitFor({ timeout: 10_000 })
        await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      }
      await dialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()
      const review = dialog.getByRole('region', { name: '评论与正式人工决定' })
      await review.waitFor({ timeout: 15_000 })
      const reviewPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/review-events'
      const commentPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/comments'
      const decisionPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/human-decisions'
      const reviewReadsBefore = capturedRequests.filter(request => request.path === reviewPath).length
      const commentText = '怀表裂痕需要在后续特写中保持一致。'
      await review.getByRole('textbox', { name: '评论内容' }).fill(commentText)
      await review.getByRole('button', { name: '提交评论' }).click()

      await review.getByText('评论已记录；参考素材选择状态和正式人工决定均未改变。', { exact: true })
        .waitFor({ timeout: 10_000 })
      await review.getByText(commentText, { exact: true }).waitFor()
      await review.getByText('当前元素版本没有有效的正式人工决定。', { exact: true }).waitFor()
      await expect.poll(() => capturedRequests.filter(request => request.path === reviewPath).length)
        .toBe(reviewReadsBefore + 1)

      const decisionReason = '当前版本的怀表造型可以进入下一环节。'
      await review.getByRole('combobox', { name: '决定' }).selectOption('approve')
      await review.getByRole('textbox', { name: '决定理由' }).fill(decisionReason)
      await review.getByRole('button', { name: '提交正式人工决定' }).click()

      await review.getByText('正式人工决定已绑定当前元素版本。', { exact: true }).waitFor({ timeout: 10_000 })
      await expect.poll(() => review.getByText(decisionReason, { exact: true }).count()).toBe(2)
      await review.getByText(/approver-e2e · 当前有效/).waitFor()
      await expect.poll(() => capturedRequests.filter(request => request.path === reviewPath).length)
        .toBe(reviewReadsBefore + 2)

      const commentRequests = capturedRequests.filter(request => request.method === 'POST' && request.path === commentPath)
      const decisionRequests = capturedRequests.filter(request => request.method === 'POST' && request.path === decisionPath)
      expect(commentRequests).toHaveLength(1)
      expect(decisionRequests).toHaveLength(1)
      const commentBody = commentRequests[0]?.body
      const decisionBody = decisionRequests[0]?.body
      expect(commentBody).toEqual({
        expectedSubjectRevision: 4,
        expectedSubjectSha256: canonicalSha256(propSubject(4, PROP_UPDATED_PROMPT)),
        body: commentText,
        idempotencyKey: expect.stringMatching(/^qingmu:element-review:comment:/),
      })
      expect(decisionBody).toEqual({
        expectedSubjectRevision: 4,
        expectedSubjectSha256: canonicalSha256(propSubject(4, PROP_UPDATED_PROMPT)),
        decision: 'approve',
        reason: decisionReason,
        idempotencyKey: expect.stringMatching(/^qingmu:element-review:decision:/),
      })
      for (const requestBody of [commentBody, decisionBody]) {
        expect(requestBody).not.toHaveProperty('actorId')
        expect(requestBody).not.toHaveProperty('actorRole')
        expect(requestBody).not.toHaveProperty('authSessionId')
      }
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 60_000)

    it('records reference rights through explicit confirmation and lost-response GET-only recovery', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-reference-rights'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()
      const reference = dialog.getByRole('region', { name: '参考素材选择与返修' })
      await reference.waitFor({ timeout: 15_000 })

      const baselineSubject = propSubject(4, PROP_UPDATED_PROMPT)
      await expect.poll(() => propReadSubjects.at(-1), { timeout: 15_000 }).toEqual(baselineSubject)
      await expect.poll(() => propReferenceCandidateReads.at(-1), { timeout: 15_000 }).toEqual(
        propReferenceCandidatesFixture(4, canonicalSha256(baselineSubject)),
      )
      const baselineDecisions = propReviewDecisionReads.at(-1)?.map(decision => ({ ...decision }))
      expect(baselineDecisions).toHaveLength(1)
      if (baselineDecisions === undefined) throw new Error('pre-commit HumanDecision baseline was not loaded')
      const decisionPostPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/human-decisions'
      const decisionPostsBefore = capturedRequests.filter(request => (
        request.method === 'POST' && request.path === decisionPostPath
      )).length

      await reference.getByRole('button', { name: '维护参考素材权利' }).click()
      const rightsReference = reference.getByRole('radio', { name: /reference-prop-1/ })
      await rightsReference.waitFor({ timeout: 15_000 })
      await rightsReference.check()
      const editor = reference.getByRole('group', { name: '结构化权利记录' })
      const sourceType = editor.locator('label').filter({ hasText: '来源类型' }).first()
      await sourceType.getByRole('combobox', { name: '信息状态' }).selectOption('known')
      await sourceType.getByRole('textbox', { name: '来源类型 · 内容' }).fill('commissioned')
      const rightsHolder = editor.locator('label').filter({ hasText: '权利人' }).first()
      await rightsHolder.getByRole('combobox', { name: '信息状态' }).selectOption('known')
      await rightsHolder.getByRole('textbox', { name: '权利人 · 内容' }).fill('青木工作室')

      const proposalPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets'
      const rightsProposalRequests = () => capturedRequests.filter(request => (
        request.path === proposalPath
        && isRecord(request.body)
        && request.body.operation === 'replaceReferenceRights'
      ))
      const previewPath = `/api/qingmu/change-sets/${REFERENCE_RIGHTS_CHANGE_SET_ID}:preview`
      const commitPath = `/api/qingmu/change-sets/${REFERENCE_RIGHTS_CHANGE_SET_ID}:commit`
      const recoveryPath = `/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets/${REFERENCE_RIGHTS_CHANGE_SET_ID}/command-receipt`
      expect(rightsProposalRequests()).toEqual([])
      expect(capturedRequests.filter(request => request.path === commitPath)).toEqual([])
      await reference.getByRole('button', { name: '生成权利变更预览' }).click()

      const preview = dialog.getByRole('region', { name: '参考素材权利 ChangeSet 预览' })
      await preview.getByText(REFERENCE_RIGHTS_CHANGE_SET_ID, { exact: true }).waitFor({ timeout: 20_000 })
      await preview.getByText(`reference-prop-1:${PROP_REFERENCE_SHA}`, { exact: true }).waitFor()
      await preview.getByText('commissioned', { exact: true }).waitFor()
      await preview.getByText('青木工作室', { exact: true }).waitFor()
      await preview.getByText(
        '本次权利变更必须保持该素材的 selectionStatus 与 isSelected 不变。',
        { exact: true },
      ).waitFor()
      const commitButton = preview.getByRole('button', { name: '确认提交权利记录' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request => request.path === commitPath)).toEqual([])

      const rightsRpcWire = browserRpcRequests
        .map(request => isRecord(request.body) ? request.body : {})
        .find(wire => isRecord(wire.payload) && wire.payload.operation === 'replaceReferenceRights')
      expect(rightsRpcWire).toBeDefined()
      if (rightsRpcWire === undefined || !isRecord(rightsRpcWire.payload)) {
        throw new Error('browser did not expose the bounded reference-rights IMAGO request')
      }
      expect(Object.keys(rightsRpcWire).sort()).toEqual(['method', 'payload', 'rpcId', 'type'])
      expect(rightsRpcWire.type).toBe('client-request')
      expect(rightsRpcWire.method).toBe('referenceAssetMethod')
      expect(typeof rightsRpcWire.rpcId).toBe('string')
      expect(Object.keys(rightsRpcWire.payload).sort()).toEqual([
        'elementId',
        'elementKind',
        'operation',
        'profileRevision',
        'projectId',
        'snapshotSha256',
      ])
      expect(rightsRpcWire.payload).toEqual({
        projectId: 'project-1',
        elementKind: 'prop',
        elementId: 'prop-1',
        profileRevision: 4,
        snapshotSha256: canonicalSha256(baselineSubject),
        operation: 'replaceReferenceRights',
      })
      expect(rightsRpcWire.payload).not.toHaveProperty('referenceAssetId')
      expect(rightsRpcWire.payload).not.toHaveProperty('referenceAssetSha256')
      expect(rightsRpcWire.payload).not.toHaveProperty('rights')

      await preview.getByRole('checkbox', {
        name: '我已核对完整权利记录、素材 ID/SHA 和影响分析，并确认提交此 ChangeSet；机器提示不构成批准或签收。',
      }).check()
      expect(await commitButton.isEnabled()).toBe(true)
      await commitButton.click()

      if (referenceRightsCommitAccepted === undefined) {
        throw new Error('isolated reference rights commit gate was not initialized')
      }
      await referenceRightsCommitAccepted
      const rightsMarkers = await page.evaluate(() => Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith('qingmu:command-commit-recovery:v4:'))
        .map(([key, value]) => ({ key, marker: JSON.parse(String(value)) as unknown })))
      expect(rightsMarkers).toEqual([{
        key: 'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-1',
        marker: {
          schema: 'qingmu.command-commit-recovery-marker.v4',
          projectId: 'project-1',
          targetType: 'element_profile',
          elementKind: 'prop',
          targetId: 'prop-1',
          changeSetId: REFERENCE_RIGHTS_CHANGE_SET_ID,
          baseRevision: 4,
          baseSnapshotSha256: canonicalSha256(baselineSubject),
          payloadSha256: REFERENCE_RIGHTS_PAYLOAD_SHA,
          idempotencyKey: REFERENCE_RIGHTS_IDEMPOTENCY_KEY,
          operation: 'replaceReferenceRights',
          referenceAssetId: 'reference-prop-1',
          referenceAssetSha256: PROP_REFERENCE_SHA,
          referenceRightsSha256: canonicalSha256(recordedReferenceRightsRecord()),
          preCommitVisualBaselineSha256: commandRecoveryVisualBaselineSha256(baselineSubject),
          preCommitHumanDecisionsSha256: commandRecoveryHumanDecisionsSha256(baselineDecisions),
          selectionStatus: 'Stale',
          isSelected: false,
        },
      }])
      const serializedMarker = JSON.stringify(rightsMarkers)
      expect(isRecord(rightsMarkers[0]?.marker) ? rightsMarkers[0]?.marker : {}).not.toHaveProperty('rights')
      expect(serializedMarker).not.toContain('commissioned')
      expect(serializedMarker).not.toContain('青木工作室')
      expect(serializedMarker).not.toContain(YIMENG_TOKEN)
      expect(serializedMarker).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(serializedMarker).not.toContain('methodProjection')
      expect(serializedMarker).not.toContain('methodAttestation')
      expect(serializedMarker).not.toContain('signature')
      expect(serializedMarker).not.toContain('proof')
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      expect(capturedRequests.filter(request => request.path === commitPath)).toHaveLength(1)

      await page.reload({ waitUntil: 'load' })
      releaseReferenceRightsCommitResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const enterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await enterButton.isVisible()) await enterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveredDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveredDialog.waitFor({ timeout: 10_000 })
      await recoveredDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await recoveredDialog.getByRole('tab', { name: '剧本与资产' }).click()
      await recoveredDialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      const propReadsBeforeRecovery = propReadSubjects.length
      await recoveredDialog.getByRole('button', { name: '查询并恢复原回执' }).click()
      await recoveredDialog.getByRole('heading', { name: '已恢复原始提交回执' }).waitFor({ timeout: 20_000 })
      await expect.poll(() => propReadSubjects.length, { timeout: 15_000 }).toBe(propReadsBeforeRecovery + 1)

      const recordedRights = recordedReferenceRightsRecord()
      const expectedPostSubject = propSubject(5, PROP_UPDATED_PROMPT, {
        rightsRecorded: true,
        rights: recordedRights,
      })
      await expect.poll(() => propReadSubjects.at(-1), { timeout: 15_000 }).toEqual(expectedPostSubject)
      const postSubject = propReadSubjects.at(-1)
      if (postSubject === undefined) throw new Error('reference rights recovery did not reread the prop subject')
      const baselineReference = baselineSubject.references[0]
      const postReference = postSubject.references[0]
      expect(postReference).toMatchObject({
        assetId: baselineReference?.assetId,
        sha256: baselineReference?.sha256,
        selectionStatus: baselineReference?.selectionStatus,
        isSelected: baselineReference?.isSelected,
        rightsRecorded: true,
        rights: recordedRights,
      })
      expect(canonicalSha256(postReference?.rights)).toBe(canonicalSha256(recordedRights))
      expect(postSubject.visualPrompt).toBe(baselineSubject.visualPrompt)
      expect(postSubject.officialReferenceImageUrl).toBe(baselineSubject.officialReferenceImageUrl)
      expect(postSubject).not.toHaveProperty('visualIdentity')

      await expect.poll(() => propReferenceCandidateReads.at(-1), { timeout: 15_000 }).toEqual(
        propReferenceCandidatesFixture(5, canonicalSha256(expectedPostSubject)),
      )
      const postCandidate = propReferenceCandidateReads.at(-1)?.candidates[0]
      const baselineCandidate = propReferenceCandidatesFixture(4, canonicalSha256(baselineSubject)).candidates[0]
      expect(postCandidate).toMatchObject({
        assetId: baselineCandidate.assetId,
        sha256: baselineCandidate.sha256,
        selectionStatus: baselineCandidate.selectionStatus,
        isSelected: baselineCandidate.isSelected,
        decisionKind: baselineCandidate.decisionKind,
        decisionIdentity: baselineCandidate.decisionIdentity,
      })
      await expect.poll(() => propReviewDecisionReads.at(-1), { timeout: 15_000 }).toEqual(baselineDecisions)
      expect(capturedRequests.filter(request => (
        request.method === 'POST' && request.path === decisionPostPath
      ))).toHaveLength(decisionPostsBefore)
      await recoveredDialog.getByText('当前版本的怀表造型可以进入下一环节。', { exact: true }).waitFor()

      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:'))), {
        timeout: 15_000,
      }).toEqual([])
      expect(capturedRequests.filter(request => request.path === commitPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([
        expect.objectContaining({
          method: 'GET',
          idempotencyKey: REFERENCE_RIGHTS_IDEMPOTENCY_KEY,
          body: undefined,
        }),
      ])
      const proposalRequests = rightsProposalRequests()
      expect(proposalRequests).toHaveLength(1)
      const proposalBody = isRecord(proposalRequests[0]?.body) ? proposalRequests[0].body : {}
      expect(Object.keys(proposalBody).sort()).toEqual([
        'elementKind',
        'operation',
        'referenceAssetId',
        'referenceAssetSha256',
        'rights',
        'baseRevision',
        'baseSnapshotSha256',
        'methodProjection',
        'methodProjectionSha256',
        'methodAttestation',
      ].sort())
      expect(proposalRequests).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            elementKind: 'prop',
            operation: 'replaceReferenceRights',
            referenceAssetId: 'reference-prop-1',
            referenceAssetSha256: PROP_REFERENCE_SHA,
            rights: recordedRights,
            baseRevision: 4,
            baseSnapshotSha256: canonicalSha256(baselineSubject),
          }),
        }),
      ])
      expect(validateReferenceRightsMethodProof(proposalBody, baselineSubject)).toBe(
        await referenceRightsMethodProjectionSha256,
      )
      expect(capturedRequests.filter(request => request.path === previewPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: 'prop-1',
            elementKind: 'prop',
            episodeId: null,
            baseRevision: 4,
            baseSnapshotSha256: canonicalSha256(baselineSubject),
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === commitPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: 'prop-1',
            elementKind: 'prop',
            episodeId: null,
            baseRevision: 4,
            baseSnapshotSha256: canonicalSha256(baselineSubject),
            idempotencyKey: REFERENCE_RIGHTS_IDEMPOTENCY_KEY,
            expectedPayloadSha256: REFERENCE_RIGHTS_PAYLOAD_SHA,
          },
        }),
      ])
      expect(capturedRequests.filter(request => /provider|worker/i.test(request.path))).toEqual([])
      expect(capturedRequests.every(request => request.cookie === undefined)).toBe(true)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      expect(await page.content()).not.toContain(IMAGO_ATTESTATION_KEY)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 60_000)

    it('records a bounded rights exception through lost-response GET-only recovery without mutating business truth', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-reference-rights-exception-release'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()

      const recordedRights = recordedReferenceRightsRecord()
      const baselineSubject = propSubject(5, PROP_UPDATED_PROMPT, {
        rightsRecorded: true,
        rights: recordedRights,
      })
      const baselineSubjectSha256 = canonicalSha256(baselineSubject)
      const baselineCandidates = propReferenceCandidatesFixture(5, baselineSubjectSha256)
      await expect.poll(() => propReadSubjects.at(-1), { timeout: 15_000 }).toEqual(baselineSubject)
      await expect.poll(() => propReferenceCandidateReads.at(-1), { timeout: 15_000 }).toEqual(baselineCandidates)
      const baselineDecisions = propReviewDecisionReads.at(-1)?.map(decision => ({ ...decision }))
      if (baselineDecisions === undefined) throw new Error('exception release HumanDecision baseline was not loaded')

      const feedPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases'
      const recoveryPath = `${feedPath}/command-receipt`
      const decisionPostPath = '/api/qingmu/projects/project-1/elements/prop/prop-1/human-decisions'
      const decisionPostsBefore = capturedRequests.filter(request => (
        request.method === 'POST' && request.path === decisionPostPath
      )).length
      const exceptionRegion = dialog.getByRole('region', { name: '参考素材权利异常放行' })
      await exceptionRegion.waitFor({ timeout: 15_000 })
      await exceptionRegion.getByText(
        '这是权利记录与普通人工决定之外的第三条独立通道。异常放行只覆盖所勾选的精确素材、权利记录 SHA 与字段；它不授予 Provider 调用、费用、素材选择、发布、普通审批或人工签收。',
        { exact: true },
      ).waitFor()
      const exceptionReference = exceptionRegion.getByRole('radio', { name: /reference-prop-1/ })
      expect(await exceptionReference.isEnabled()).toBe(true)
      await exceptionReference.check()
      await exceptionRegion.getByRole('checkbox', { name: '来源类型' }).check()
      await exceptionRegion.getByRole('checkbox', { name: '权利人' }).check()
      const submittedReason = '  项目法律顾问已核对当前素材的有限范围。  '
      const normalizedReason = submittedReason.trim()
      await exceptionRegion.getByRole('textbox', { name: '异常放行理由' }).fill(submittedReason)
      const confirmation = exceptionRegion.getByRole('checkbox', {
        name: '我已逐项核对当前元素版本、素材 ID/SHA、权利记录 SHA、所勾选字段和理由，并明确确认本次异常放行；此确认不授予 Provider、费用、选择、发布、普通审批或人工签收。',
      })
      expect(await confirmation.isEnabled()).toBe(true)
      await confirmation.check()
      const submit = exceptionRegion.getByRole('button', { name: '确认记录异常放行' })
      expect(await submit.isEnabled()).toBe(true)
      await submit.click()

      if (referenceRightsExceptionReleaseAccepted === undefined) {
        throw new Error('isolated reference rights exception release gate was not initialized')
      }
      await referenceRightsExceptionReleaseAccepted
      const scope = {
        kind: 'reference_rights',
        referenceAssetId: 'reference-prop-1',
        referenceAssetSha256: PROP_REFERENCE_SHA,
        rightsRecordSha256: canonicalSha256(recordedRights),
        rightsFields: ['sourceType', 'rightsHolder'],
      } as const
      const markerInput = {
        projectId: 'project-1',
        elementKind: 'prop',
        targetId: 'prop-1',
        expectedSubjectRevision: 5,
        expectedSubjectSha256: baselineSubjectSha256,
        referenceAssetId: scope.referenceAssetId,
        referenceAssetSha256: scope.referenceAssetSha256,
        rightsRecordSha256: scope.rightsRecordSha256,
        reasonSha256: canonicalSha256(normalizedReason),
        scopeSha256: canonicalSha256(scope),
      } as const
      const expectedIdempotencyKey = `qingmu:rights-exception:v1:${canonicalSha256([
        ['projectId', markerInput.projectId],
        ['elementKind', markerInput.elementKind],
        ['targetId', markerInput.targetId],
        ['expectedSubjectRevision', markerInput.expectedSubjectRevision],
        ['expectedSubjectSha256', markerInput.expectedSubjectSha256],
        ['referenceAssetId', markerInput.referenceAssetId],
        ['referenceAssetSha256', markerInput.referenceAssetSha256],
        ['rightsRecordSha256', markerInput.rightsRecordSha256],
        ['reasonSha256', markerInput.reasonSha256],
        ['scopeSha256', markerInput.scopeSha256],
      ])}`
      const markers = await page.evaluate(() => Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith('qingmu:reference-rights-exception-release-recovery:v1:'))
        .map(([key, value]) => ({ key, marker: JSON.parse(String(value)) as unknown })))
      expect(markers).toEqual([{
        key: 'qingmu:reference-rights-exception-release-recovery:v1:project-1:prop:prop-1',
        marker: { ...markerInput, idempotencyKey: expectedIdempotencyKey },
      }])
      const serializedMarker = JSON.stringify(markers)
      for (const forbidden of [
        normalizedReason,
        'rightsFields',
        'sourceType',
        'rightsHolder',
        'actorId',
        'actorRole',
        'naturalPerson',
        'authSessionId',
        'releasedAt',
        'decision',
        YIMENG_TOKEN,
        IMAGO_ATTESTATION_KEY,
      ]) expect(serializedMarker).not.toContain(forbidden)

      const postRequests = () => capturedRequests.filter(request => (
        request.method === 'POST' && request.path === feedPath
      ))
      expect(postRequests()).toEqual([expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`,
        idempotencyKey: expectedIdempotencyKey,
        cookie: undefined,
        body: {
          expectedSubjectRevision: 5,
          expectedSubjectSha256: baselineSubjectSha256,
          scope,
          reason: normalizedReason,
        },
      })])
      const firstPostRequest = postRequests()[0]
      const postBody = firstPostRequest !== undefined && isRecord(firstPostRequest.body)
        ? firstPostRequest.body
        : {}
      expect(Object.keys(postBody).sort()).toEqual([
        'expectedSubjectRevision', 'expectedSubjectSha256', 'scope', 'reason',
      ].sort())
      for (const forbidden of [
        'actorId', 'actorRole', 'actorNaturalPersonId', 'authSessionId', 'releasedAt', 'decision',
      ]) expect(postBody).not.toHaveProperty(forbidden)
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])

      const exceptionMethodWire = browserRpcRequests
        .map(request => isRecord(request.body) ? request.body : {})
        .find(wire => isRecord(wire.payload)
          && wire.payload.operation === 'recordReferenceRightsExceptionRelease')
      expect(exceptionMethodWire).toBeDefined()
      if (exceptionMethodWire === undefined || !isRecord(exceptionMethodWire.payload)) {
        throw new Error('browser did not expose the bounded exception-release IMAGO request')
      }
      expect(exceptionMethodWire.payload).toEqual({
        projectId: 'project-1',
        elementKind: 'prop',
        elementId: 'prop-1',
        profileRevision: 5,
        snapshotSha256: baselineSubjectSha256,
        operation: 'recordReferenceRightsExceptionRelease',
      })
      for (const forbidden of ['reason', 'scope', 'rights', 'rightsFields', 'decision', 'actorId']) {
        expect(exceptionMethodWire.payload).not.toHaveProperty(forbidden)
      }

      await page.reload({ waitUntil: 'load' })
      releaseReferenceRightsExceptionReleaseResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const enterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await enterButton.isVisible()) await enterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveredDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveredDialog.waitFor({ timeout: 10_000 })
      await recoveredDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await recoveredDialog.getByRole('tab', { name: '剧本与资产' }).click()
      await recoveredDialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '道具' }).click()

      const recoveryDock = recoveredDialog.getByRole('region', { name: '存在待恢复的异常放行回执' })
      await recoveryDock.waitFor({ timeout: 15_000 })
      await recoveryDock.getByText(
        '恢复严格使用 GET + 原 Idempotency-Key，无请求正文、无 Cookie、无 POST fallback；任何对象或摘要漂移都不会显示成功。',
        { exact: true },
      ).waitFor()
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      expect(postRequests()).toHaveLength(1)
      await expect.poll(() => propReadSubjects.at(-1), { timeout: 15_000 }).toEqual(baselineSubject)
      await expect.poll(() => propReferenceCandidateReads.at(-1), { timeout: 15_000 }).toEqual(baselineCandidates)
      await expect.poll(() => propReviewDecisionReads.at(-1), { timeout: 15_000 }).toEqual(baselineDecisions)
      const feedReadsBeforeRecovery = capturedRequests.filter(request => (
        request.method === 'GET' && request.path === feedPath
      )).length
      await recoveryDock.getByRole('button', { name: '仅 GET 查询原始回执' }).click()

      const recoveredReceipt = recoveredDialog.getByRole('region', { name: '异常放行已由权威 GET 精确对账' })
      await recoveredReceipt.getByRole('heading', {
        name: '原异常放行回执已通过 GET 恢复并精确对账',
      }).waitFor({ timeout: 20_000 })
      await expect.poll(() => capturedRequests.filter(request => (
        request.method === 'GET' && request.path === feedPath
      )).length, { timeout: 15_000 }).toBe(feedReadsBeforeRecovery + 1)
      expect(postRequests()).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([
        expect.objectContaining({
          method: 'GET',
          idempotencyKey: expectedIdempotencyKey,
          cookie: undefined,
          body: undefined,
        }),
      ])
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:reference-rights-exception-release-recovery:v1:'))), {
        timeout: 15_000,
      }).toEqual([])

      expect(propReadSubjects.at(-1)).toEqual(baselineSubject)
      expect(propReferenceCandidateReads.at(-1)).toEqual(baselineCandidates)
      expect(propReviewDecisionReads.at(-1)).toEqual(baselineDecisions)
      expect(capturedRequests.filter(request => (
        request.method === 'POST' && request.path === decisionPostPath
      ))).toHaveLength(decisionPostsBefore)
      const refreshedExceptionRegion = recoveredDialog.getByRole('region', { name: '参考素材权利异常放行' })
      await refreshedExceptionRegion.getByText(normalizedReason, { exact: true }).waitFor()
      await refreshedExceptionRegion.getByText(
        'approver-e2e-1 · natural-person-approver-e2e-1',
        { exact: true },
      ).waitFor()
      await refreshedExceptionRegion.getByText(
        'producer-e2e-1 · natural-person-producer-e2e-1',
        { exact: true },
      ).waitFor()
      await refreshedExceptionRegion.getByText(
        'asset-producer-e2e-1 · natural-person-asset-producer-e2e-1',
        { exact: true },
      ).waitFor()
      await refreshedExceptionRegion.getByText('recent-auth-session-e2e-1', { exact: true }).waitFor()
      await refreshedExceptionRegion.locator('strong').filter({ hasText: '当前有效' }).waitFor()
      expect(capturedRequests.filter(request => /provider|worker/i.test(request.path))).toEqual([])
      expect(capturedRequests.every(request => request.cookie === undefined)).toBe(true)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      expect(await page.content()).not.toContain(IMAGO_ATTESTATION_KEY)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 60_000)

    it('selects an authoritative reference through lost-response GET-only recovery and rereads both authorities', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-reference-selection'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '环境' }).click()
      const reference = dialog.getByRole('region', { name: '参考素材选择与返修' })
      await reference.getByRole('button', { name: '选择参考素材', exact: true }).click()
      const selectable = reference.getByRole('radio', { name: new RegExp(SCENE_SELECT_ASSET_ID) })
      const rejected = reference.getByRole('radio', { name: new RegExp(SCENE_REPAIR_ASSET_ID) })
      const stale = reference.getByRole('radio', { name: new RegExp(SCENE_STALE_ASSET_ID) })
      await selectable.waitFor({ timeout: 15_000 })
      expect(await selectable.isEnabled()).toBe(true)
      expect(await rejected.isDisabled()).toBe(true)
      expect(await stale.isDisabled()).toBe(true)
      await reference.getByText('已驳回／已撤销', { exact: true }).waitFor()
      await reference.getByText('已过期', { exact: true }).waitFor()
      expect(await selectable.isChecked()).toBe(false)
      await selectable.check()

      const selectionProposalPath = '/api/qingmu/projects/project-1/elements/scene/scene-1/reference-change-sets'
      const selectionPreviewPath = `/api/qingmu/change-sets/${REFERENCE_SELECT_CHANGE_SET_ID}:preview`
      const selectionCommitPath = `/api/qingmu/change-sets/${REFERENCE_SELECT_CHANGE_SET_ID}:commit`
      const selectionRecoveryPath = `/api/qingmu/projects/project-1/elements/scene/scene-1/change-sets/${REFERENCE_SELECT_CHANGE_SET_ID}/command-receipt`
      const candidateReadPath = '/api/qingmu/projects/project-1/elements/scene/scene-1/reference-candidates'
      expect(capturedRequests.filter(request => request.path === selectionProposalPath)).toEqual([])
      await reference.getByRole('button', { name: '预览参考素材选择' }).click()

      const preview = dialog.getByRole('region', { name: '参考素材 ChangeSet 预览' })
      await preview.getByText(REFERENCE_SELECT_CHANGE_SET_ID, { exact: true }).waitFor({ timeout: 20_000 })
      await preview.getByText(SCENE_SELECT_ASSET_ID, { exact: true }).waitFor()
      await preview.getByText(SCENE_SELECT_ASSET_SHA, { exact: true }).waitFor()
      await preview.getByText('候选 ID 与 SHA 仍绑定当前易梦权威读取。', { exact: true }).waitFor()
      await preview.getByText('本次方法与预览确认 Provider 调用为 0、Worker 未启动、选择未自动执行。', { exact: true }).waitFor()
      await preview.getByText('已选择只表示记录选择意图，不等于人工批准、审美签收或付费授权。', { exact: true }).waitFor()
      const commitButton = preview.getByRole('button', { name: '确认记录参考素材选择' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request => request.path === selectionCommitPath)).toEqual([])
      await preview.getByRole('checkbox', {
        name: '我确认提交这个参考素材选择 ChangeSet；已选择不等于人工签收。',
      }).check()
      expect(await commitButton.isEnabled()).toBe(true)
      await commitButton.click()

      if (referenceCommitAccepted === undefined) throw new Error('isolated reference selection commit gate was not initialized')
      await referenceCommitAccepted
      const selectionMarkers = await page.evaluate(() => Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith('qingmu:command-commit-recovery:v4:'))
        .map(([key, value]) => ({ key, marker: JSON.parse(String(value)) as unknown })))
      expect(selectionMarkers).toEqual([{
        key: 'qingmu:command-commit-recovery:v4:project-1:element_profile:scene:scene-1',
        marker: {
          schema: 'qingmu.command-commit-recovery-marker.v4',
          projectId: 'project-1',
          targetType: 'element_profile',
          elementKind: 'scene',
          targetId: 'scene-1',
          changeSetId: REFERENCE_SELECT_CHANGE_SET_ID,
          baseRevision: 3,
          baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(3, false)),
          payloadSha256: REFERENCE_SELECT_PAYLOAD_SHA,
          idempotencyKey: REFERENCE_SELECT_IDEMPOTENCY_KEY,
          operation: 'selectReferenceAsset',
          candidateAssetId: SCENE_SELECT_ASSET_ID,
          candidateAssetSha256: SCENE_SELECT_ASSET_SHA,
        },
      }])
      expect(capturedRequests.filter(request => request.path === selectionRecoveryPath)).toEqual([])

      await page.reload({ waitUntil: 'load' })
      releaseReferenceCommitResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const enterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await enterButton.isVisible()) await enterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveredDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveredDialog.waitFor({ timeout: 10_000 })
      await recoveredDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await recoveredDialog.getByRole('tab', { name: '剧本与资产' }).click()
      await recoveredDialog.getByRole('group', { name: '选择人物、环境或道具' })
        .getByRole('button', { name: '环境' }).click()
      const recoveredEditor = recoveredDialog.getByRole('textbox', { name: '环境／道具视觉提示词' })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 15_000 }).toBe(SCENE_ORIGINAL_PROMPT)
      expect(await recoveredEditor.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request => request.path === selectionRecoveryPath)).toEqual([])
      const sceneReadsBeforeRecovery = sceneReadRevisions.length
      const candidateReadsBeforeRecovery = capturedRequests.filter(request => request.path === candidateReadPath).length
      await recoveredDialog.getByRole('button', { name: '查询并恢复原回执' }).click()
      await recoveredDialog.getByRole('heading', { name: '已恢复原始提交回执' }).waitFor({ timeout: 20_000 })
      await expect.poll(() => sceneReadRevisions.length, { timeout: 15_000 }).toBe(sceneReadsBeforeRecovery + 1)
      await expect.poll(
        () => capturedRequests.filter(request => request.path === candidateReadPath).length,
        { timeout: 15_000 },
      ).toBe(candidateReadsBeforeRecovery + 1)
      expect(sceneReadRevisions.at(-1)).toBe(4)
      const selectionPostCandidates = sceneReferenceCandidateReads.at(-1)
      expect(selectionPostCandidates).toMatchObject({
        profileRevision: 4,
        elementSnapshotSha256: canonicalSha256(sceneReferenceSubject(4, true)),
      })
      expect(selectionPostCandidates?.candidates.find(candidate => (
        candidate.assetId === SCENE_SELECT_ASSET_ID
        && candidate.sha256 === SCENE_SELECT_ASSET_SHA
      ))).toMatchObject({
        assetId: SCENE_SELECT_ASSET_ID,
        sha256: SCENE_SELECT_ASSET_SHA,
        materializedSha256: SCENE_SELECT_ASSET_SHA,
        bindingValid: true,
        selectionStatus: 'Selected',
        isSelected: true,
        decisionKind: 'referenceSelection',
        decisionIdentity: 'owner-1',
      })
      const recoveredReference = recoveredDialog.getByRole('region', { name: '参考素材选择与返修' })
      await recoveredReference.getByText('已选择（未签收）', { exact: true }).waitFor({ timeout: 15_000 })
      const selectedAfterRecovery = recoveredReference.getByRole('radio', { name: new RegExp(SCENE_SELECT_ASSET_ID) })
      expect(await selectedAfterRecovery.isDisabled()).toBe(true)
      expect(await recoveredDialog.getByText('receipt-scene-reference-select-1', { exact: true }).count()).toBe(1)
      expect(await recoveredDialog.getByText('event-scene-reference-select-1', { exact: true }).count()).toBe(1)
      expect(await recoveredDialog.getByText('本次方法与预览确认 Provider 调用为 0、Worker 未启动、选择未自动执行。', { exact: true }).count()).toBe(1)
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:'))), {
        timeout: 15_000,
      }).toEqual([])

      expect(capturedRequests.filter(request => request.path === selectionProposalPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            elementKind: 'scene',
            operation: 'selectReferenceAsset',
            candidateAssetId: SCENE_SELECT_ASSET_ID,
            candidateAssetSha256: SCENE_SELECT_ASSET_SHA,
            baseRevision: 3,
            baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(3, false)),
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === selectionPreviewPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: 'scene-1',
            elementKind: 'scene',
            episodeId: null,
            baseRevision: 3,
            baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(3, false)),
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === selectionCommitPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: 'scene-1',
            elementKind: 'scene',
            episodeId: null,
            baseRevision: 3,
            baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(3, false)),
            idempotencyKey: REFERENCE_SELECT_IDEMPOTENCY_KEY,
            expectedPayloadSha256: REFERENCE_SELECT_PAYLOAD_SHA,
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === selectionRecoveryPath)).toEqual([
        expect.objectContaining({
          method: 'GET',
          path: selectionRecoveryPath,
          idempotencyKey: REFERENCE_SELECT_IDEMPOTENCY_KEY,
          body: undefined,
        }),
      ])
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 120_000)

    it('records regeneration intent only after explicit confirmation and rereads both authorities with zero execution', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-reference-regeneration'))
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const reference = dialog.getByRole('region', { name: '参考素材选择与返修' })
      await reference.getByRole('button', { name: '请求返修重生成', exact: true }).click()
      const rejected = reference.getByRole('radio', { name: new RegExp(SCENE_REPAIR_ASSET_ID) })
      const stale = reference.getByRole('radio', { name: new RegExp(SCENE_STALE_ASSET_ID) })
      await rejected.waitFor({ timeout: 15_000 })
      expect(await rejected.isEnabled()).toBe(true)
      expect(await stale.isDisabled()).toBe(true)
      await rejected.check()
      await reference.getByRole('textbox', { name: '参考素材返修词' }).fill(REFERENCE_REPAIR_PROMPT)

      const proposalPath = '/api/qingmu/projects/project-1/elements/scene/scene-1/reference-change-sets'
      const previewPath = `/api/qingmu/change-sets/${REFERENCE_REGEN_CHANGE_SET_ID}:preview`
      const commitPath = `/api/qingmu/change-sets/${REFERENCE_REGEN_CHANGE_SET_ID}:commit`
      const recoveryPath = `/api/qingmu/projects/project-1/elements/scene/scene-1/change-sets/${REFERENCE_REGEN_CHANGE_SET_ID}/command-receipt`
      const candidateReadPath = '/api/qingmu/projects/project-1/elements/scene/scene-1/reference-candidates'
      await reference.getByRole('button', { name: '预览返修请求' }).click()
      const preview = dialog.getByRole('region', { name: '参考素材 ChangeSet 预览' })
      await preview.getByText(REFERENCE_REGEN_CHANGE_SET_ID, { exact: true }).waitFor({ timeout: 20_000 })
      await preview.getByText(SCENE_REPAIR_ASSET_ID, { exact: true }).waitFor()
      await preview.getByText(SCENE_REPAIR_ASSET_SHA, { exact: true }).waitFor()
      await preview.getByText('这是返修意图记录：不会自动生成、不会自动选择，也不会取得付费授权。', { exact: true }).waitFor()
      await preview.getByText('本次方法与预览确认 Provider 调用为 0、Worker 未启动、选择未自动执行。', { exact: true }).waitFor()
      const commitButton = preview.getByRole('button', { name: '确认记录返修请求' })
      expect(await commitButton.isDisabled()).toBe(true)
      expect(capturedRequests.filter(request => request.path === commitPath)).toEqual([])
      await preview.getByRole('checkbox', {
        name: '我确认提交这个返修意图 ChangeSet；它不会自动生成或自动选择素材。',
      }).check()
      expect(await commitButton.isEnabled()).toBe(true)
      const sceneReadsBeforeCommit = sceneReadRevisions.length
      const candidateReadsBeforeCommit = capturedRequests.filter(request => request.path === candidateReadPath).length
      await commitButton.click()

      if (referenceRegenerationCommitAccepted === undefined) {
        throw new Error('isolated reference regeneration commit gate was not initialized')
      }
      await referenceRegenerationCommitAccepted
      const regenerationMarkers = await page.evaluate(() => Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith('qingmu:command-commit-recovery:v4:'))
        .map(([key, value]) => ({ key, marker: JSON.parse(String(value)) as unknown })))
      expect(regenerationMarkers).toEqual([{
        key: 'qingmu:command-commit-recovery:v4:project-1:element_profile:scene:scene-1',
        marker: {
          schema: 'qingmu.command-commit-recovery-marker.v4',
          projectId: 'project-1',
          targetType: 'element_profile',
          elementKind: 'scene',
          targetId: 'scene-1',
          changeSetId: REFERENCE_REGEN_CHANGE_SET_ID,
          baseRevision: 4,
          baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(4, true)),
          payloadSha256: REFERENCE_REGEN_PAYLOAD_SHA,
          idempotencyKey: REFERENCE_REGEN_IDEMPOTENCY_KEY,
          operation: 'requestReferenceRegeneration',
          candidateAssetId: SCENE_REPAIR_ASSET_ID,
          candidateAssetSha256: SCENE_REPAIR_ASSET_SHA,
        },
      }])
      expect(sceneReadRevisions).toHaveLength(sceneReadsBeforeCommit)
      expect(capturedRequests.filter(request => request.path === candidateReadPath)).toHaveLength(candidateReadsBeforeCommit)
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      releaseReferenceRegenerationCommitResponse?.()

      await dialog.getByRole('heading', {
        name: '返修请求已记录；Provider 调用为 0，Worker 未启动。',
      }).waitFor({ timeout: 20_000 })
      await expect.poll(() => sceneReadRevisions.length, { timeout: 20_000 }).toBe(sceneReadsBeforeCommit + 1)
      await expect.poll(
        () => capturedRequests.filter(request => request.path === candidateReadPath).length,
        { timeout: 20_000 },
      ).toBe(candidateReadsBeforeCommit + 1)
      expect(sceneReadRevisions.at(-1)).toBe(5)
      const regenerationPostCandidates = sceneReferenceCandidateReads.at(-1)
      expect(regenerationPostCandidates).toMatchObject({
        profileRevision: 5,
        elementSnapshotSha256: canonicalSha256(sceneReferenceSubject(5, true)),
      })
      expect(regenerationPostCandidates?.candidates.find(candidate => (
        candidate.assetId === SCENE_REPAIR_ASSET_ID
        && candidate.sha256 === SCENE_REPAIR_ASSET_SHA
      ))).toMatchObject({
        assetId: SCENE_REPAIR_ASSET_ID,
        sha256: SCENE_REPAIR_ASSET_SHA,
        materializedSha256: SCENE_REPAIR_ASSET_SHA,
        bindingValid: true,
        selectionStatus: 'Rejected',
        isSelected: false,
        decisionKind: 'none',
        decisionIdentity: '',
      })
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:command-commit-recovery:v4:'))), {
        timeout: 20_000,
      }).toEqual([])
      await reference.getByText('已选择（未签收）', { exact: true }).waitFor({ timeout: 15_000 })
      expect(await dialog.getByText('receipt-scene-reference-regeneration-1', { exact: true }).count()).toBe(1)
      expect(await dialog.getByText('event-scene-reference-regeneration-1', { exact: true }).count()).toBe(1)
      expect(await dialog.getByText('本次方法与预览确认 Provider 调用为 0、Worker 未启动、选择未自动执行。', { exact: true }).count()).toBe(1)

      const referenceProposals = capturedRequests.filter(request => request.path === proposalPath)
      expect(referenceProposals.at(-1)).toEqual(expect.objectContaining({
        method: 'POST',
        body: {
          elementKind: 'scene',
          operation: 'requestReferenceRegeneration',
          candidateAssetId: SCENE_REPAIR_ASSET_ID,
          candidateAssetSha256: SCENE_REPAIR_ASSET_SHA,
          baseRevision: 4,
          baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(4, true)),
          repairPrompt: REFERENCE_REPAIR_PROMPT,
        },
      }))
      expect(capturedRequests.filter(request => request.path === previewPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: 'scene-1',
            elementKind: 'scene',
            episodeId: null,
            baseRevision: 4,
            baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(4, true)),
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === commitPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            projectId: 'project-1',
            targetType: 'element_profile',
            targetId: 'scene-1',
            elementKind: 'scene',
            episodeId: null,
            baseRevision: 4,
            baseSnapshotSha256: canonicalSha256(sceneReferenceSubject(4, true)),
            idempotencyKey: REFERENCE_REGEN_IDEMPOTENCY_KEY,
            expectedPayloadSha256: REFERENCE_REGEN_PAYLOAD_SHA,
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      expect(capturedRequests.filter(request => /(?:provider|worker|generate|generation-job)/i.test(request.path))).toEqual([])
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 120_000)

    it('connects the Ready PromptIR edit and separate selection pipeline with GET-only recovery', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-prompt-ir-vertical'))
      const readyReadPath = `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${PROMPT_IR_STORYBOARD_REVISION_ID}/frames/${PROMPT_IR_FRAME_ID}/prompt-ir`
      const proposalPath = `${readyReadPath}/change-sets`
      const previewPath = `/api/qingmu/change-sets/${PROMPT_IR_CHANGE_SET_ID}:preview`
      const editCommitPath = `/api/qingmu/change-sets/${PROMPT_IR_CHANGE_SET_ID}:commit`
      const editRecoveryPath = `${proposalPath}/${PROMPT_IR_CHANGE_SET_ID}/command-receipt`
      const selectionPath = `${readyReadPath}:select`
      const selectionRecoveryPath = `${readyReadPath}/selection-command-receipt`
      const workflowStatusStart = promptIrWorkflowStatuses.length

      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const initialEnterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await initialEnterButton.isVisible()) await initialEnterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      const workspace = dialog.getByRole('region', { name: 'PromptIR 五字段变更台' })
      const editor = workspace.getByRole('textbox', { name: 'PromptIR 五字段 JSON' })
      await expect.poll(() => editor.inputValue(), { timeout: 15_000 })
        .toBe(JSON.stringify(PROMPT_IR_BASE_EDITABLE, null, 2))
      await editor.fill(JSON.stringify(PROMPT_IR_CANDIDATE_EDITABLE, null, 2))
      await workspace.getByRole('button', { name: '先运行 IMAGO 方法检查' }).click()

      const method = workspace.getByRole('region', { name: 'IMAGO PromptIR 方法检查' })
      await method.waitFor({ timeout: 30_000 })
      await method.getByText('/editableProjection/videoGenPrompt', { exact: true }).waitFor()
      await method.getByText('Provider 调用为 0，Worker 未启动，未自动选择，也未推断人工批准或签收。', {
        exact: true,
      }).waitFor()
      expect(capturedRequests.filter(request => request.path === proposalPath)).toEqual([])
      await method.getByRole('button', { name: '生成 PromptIR ChangeSet 预览' }).click()

      const preview = workspace.getByRole('region', { name: 'PromptIR ChangeSet 预览' })
      await preview.getByText(PROMPT_IR_CHANGE_SET_ID, { exact: true }).waitFor({ timeout: 20_000 })
      await preview.getByText(PROMPT_IR_DRAFT_ID, { exact: true }).waitFor()
      await preview.getByText('$.videoGenPrompt', { exact: true }).waitFor()
      await preview.getByText('本次编辑提交只创建 Draft，并保留原 Ready；不会自动选择。', { exact: true }).waitFor()
      const editButton = preview.getByRole('button', { name: '确认提交 PromptIR Draft' })
      expect(await editButton.isDisabled()).toBe(true)
      await preview.getByRole('checkbox', {
        name: '我已核对五字段差异，确认把这次编辑提交为 Draft；这不是批准、签收或选择 Ready。',
      }).check()
      await editButton.click()

      if (promptIrEditAccepted === undefined) throw new Error('isolated PromptIR edit gate was not initialized')
      await promptIrEditAccepted
      expect(capturedRequests.filter(request => request.path === editCommitPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === editRecoveryPath)).toEqual([])
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:prompt-ir-edit-recovery:v1:')))).toEqual([
        `qingmu:prompt-ir-edit-recovery:v1:project-1:episode-1:${PROMPT_IR_STORYBOARD_REVISION_ID}:${PROMPT_IR_FRAME_ID}`,
      ])

      await page.reload({ waitUntil: 'load' })
      releasePromptIrEditResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const editRecoveryEnterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await editRecoveryEnterButton.isVisible()) await editRecoveryEnterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const editRecoveryDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await editRecoveryDialog.waitFor({ timeout: 10_000 })
      await editRecoveryDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await editRecoveryDialog.getByRole('tab', { name: '剧本与资产' }).click()
      const editRecoveryWorkspace = editRecoveryDialog.getByRole('region', { name: 'PromptIR 五字段变更台' })
      const recoveredEditor = editRecoveryWorkspace.getByRole('textbox', { name: 'PromptIR 五字段 JSON' })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 15_000 })
        .toBe(JSON.stringify(PROMPT_IR_BASE_EDITABLE, null, 2))
      expect(await recoveredEditor.isDisabled()).toBe(true)
      await editRecoveryWorkspace.getByRole('button', { name: '只查询原编辑回执' }).click()
      await editRecoveryWorkspace.getByRole('heading', { name: 'PromptIR 编辑事件已生成 Draft' })
        .waitFor({ timeout: 20_000 })
      await editRecoveryWorkspace.getByText(PROMPT_IR_DRAFT_ID, { exact: true }).waitFor()
      expect(capturedRequests.filter(request => request.path === editCommitPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === editRecoveryPath)).toEqual([
        expect.objectContaining({
          method: 'GET',
          idempotencyKey: PROMPT_IR_EDIT_IDEMPOTENCY_KEY,
          body: undefined,
        }),
      ])
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:prompt-ir-edit-recovery:v1:')))).toHaveLength(1)

      await editRecoveryWorkspace.getByRole('checkbox', {
        name: '我另行确认把这个精确 Draft 选择为新的 Ready；这是选择事件，不是批准或签收。',
      }).check()
      const selectionButton = editRecoveryWorkspace.getByRole('button', { name: '确认选择为 Ready' })
      await selectionButton.click()
      if (promptIrSelectionAccepted === undefined) throw new Error('isolated PromptIR selection gate was not initialized')
      await promptIrSelectionAccepted
      expect(capturedRequests.filter(request => request.path === selectionPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === selectionRecoveryPath)).toEqual([])
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:prompt-ir-selection-recovery:v1:')))).toHaveLength(1)

      await page.reload({ waitUntil: 'load' })
      releasePromptIrSelectionResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const selectionRecoveryEnterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await selectionRecoveryEnterButton.isVisible()) await selectionRecoveryEnterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const selectionRecoveryDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await selectionRecoveryDialog.waitFor({ timeout: 10_000 })
      await selectionRecoveryDialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await selectionRecoveryDialog.getByRole('tab', { name: '剧本与资产' }).click()
      const selectionRecoveryWorkspace = selectionRecoveryDialog.getByRole('region', { name: 'PromptIR 五字段变更台' })
      const readyReadsBeforeSelectionRecovery = capturedRequests.filter(request => request.path === readyReadPath).length
      await selectionRecoveryWorkspace.getByRole('button', { name: '只查询原选择回执' }).click()
      await expect.poll(
        () => capturedRequests.filter(request => request.path === readyReadPath).length,
        { timeout: 20_000 },
      ).toBe(readyReadsBeforeSelectionRecovery + 1)
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:prompt-ir-'))), { timeout: 20_000 }).toEqual([])

      expect(capturedRequests.filter(request => request.path === proposalPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            basePromptIrId: PROMPT_IR_READY_ID,
            baseVersion: PROMPT_IR_READY_VERSION,
            baseContentSha256: PROMPT_IR_READY_CONTENT_SHA,
            replacements: { videoGenPrompt: PROMPT_IR_CANDIDATE_EDITABLE.videoGenPrompt },
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === previewPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === editCommitPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === selectionPath)).toEqual([
        expect.objectContaining({
          method: 'POST',
          body: {
            draftPromptIrId: PROMPT_IR_DRAFT_ID,
            draftVersion: PROMPT_IR_DRAFT_VERSION,
            draftContentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
            idempotencyKey: PROMPT_IR_SELECTION_IDEMPOTENCY_KEY,
          },
        }),
      ])
      expect(capturedRequests.filter(request => request.path === selectionRecoveryPath)).toEqual([
        expect.objectContaining({
          method: 'GET',
          idempotencyKey: PROMPT_IR_SELECTION_IDEMPOTENCY_KEY,
          body: undefined,
        }),
      ])
      const workflowStatuses = promptIrWorkflowStatuses.slice(workflowStatusStart)
      expect(workflowStatuses.length).toBeGreaterThan(0)
      expect(workflowStatuses.every(status => status === 'Ready')).toBe(true)
      expect(capturedRequests.filter(request => /(?:provider|worker|generate|generation-job)/i.test(request.path))).toEqual([])
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 120_000)
  },
)
