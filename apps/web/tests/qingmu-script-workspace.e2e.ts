// Qingmu-only browser regression for bounded script and element-profile ChangeSet paths.
// The assembled Host talks only to a loopback Yimeng double; no model, Provider,
// production service, or persistent business database participates.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'
import { continuityFixture, rebindContinuity } from '../../../packages/experimental/qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import { takeAcceptanceFixture as baseTakeAcceptanceFixture } from '../../../packages/experimental/qingmu-yimeng-read-adapter/tests/take-acceptance-fixture.ts'
import type {
  TakeComment,
  TakeCommentFeed,
  TakeCommentRequest,
  TakeCommentResult,
  TakeCommentSubject,
} from '../../../packages/experimental/qingmu-yimeng-read-adapter/tests/take-comment-fixture.ts'
import type {
  YimengTakeHumanDecision as ReadTakeHumanDecision,
  YimengTakeReviewAuthorityFeedResponse,
  YimengTakeReviewRecommendation as ReadTakeReviewRecommendation,
} from '../../../packages/experimental/qingmu-yimeng-read-adapter/src/types.ts'
import type {
  YimengCreateTakeHumanDecisionRequest,
  YimengCreateTakeReviewRecommendationRequest,
  YimengTakeHumanDecisionResult,
  YimengTakeReviewRecommendationResult,
} from '../../../packages/experimental/qingmu-yimeng-command-adapter/src/types.ts'
import { takeVersionStackFixture as baseTakeVersionStackFixture } from '../../../packages/experimental/qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'
import { videoCandidatesFixture } from '../../../packages/experimental/qingmu-yimeng-read-adapter/tests/selected-video-review-fixture.ts'
import { createShotFindingDouble } from './qingmu-shot-finding-fixture.ts'
import { createReworkRouteDouble } from './qingmu-rework-route-fixture.ts'
import {
  createProductionUnitDouble, PRODUCTION_UNIT_BROWSER_GROUP_ID, PRODUCTION_UNIT_BROWSER_UNIT_ID,
  PRODUCTION_UNIT_BROWSER_RULE_PATHS,
} from './qingmu-production-unit-fixture.ts'
import { createStageSourceDouble, STAGE_SOURCE_BROWSER_RULE_PATHS } from './qingmu-stage-source-fixture.ts'

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
const SHOT_RIVER_FIRST_FRAME_ID = 'frame-z'
const PROMPT_IR_TARGET_ID = `${PROMPT_IR_STORYBOARD_REVISION_ID}:${PROMPT_IR_FRAME_ID}`
const SHOT_RELATION_SOURCE_SHA = '71'.repeat(32)
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
const STORYBOARD_CANVAS_CHANGE_SET_ID = 'changeset-storyboard-canvas-1'
const STORYBOARD_CANVAS_PAYLOAD_SHA = '81'.repeat(32)
const STORYBOARD_CANVAS_HERO_ASSET_ID = 'hero-frame-asset-1'
const STORYBOARD_CANVAS_HERO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAZ7FY0QAAAAASUVORK5CYII=',
  'base64',
)
const STORYBOARD_CANVAS_HERO_MEDIA_SHA = createHash('sha256')
  .update(STORYBOARD_CANVAS_HERO_PNG)
  .digest('hex')
const STORYBOARD_CANVAS_HERO_BINDING_SHA = createHash('sha256').update(JSON.stringify({
  assetId: STORYBOARD_CANVAS_HERO_ASSET_ID,
  mediaSha256: STORYBOARD_CANVAS_HERO_MEDIA_SHA,
  shotId: PROMPT_IR_FRAME_ID,
}), 'utf8').digest('hex')
const STORYBOARD_CANVAS_BASE_REVISION = {
  revisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
  revisionVersion: 1,
  sourceSha256: SHOT_RELATION_SOURCE_SHA,
} as const
const STORYBOARD_CANVAS_AUTHORITATIVE_REVISION = {
  revisionId: 'storyboard-revision-2',
  revisionVersion: 2,
  sourceSha256: '82'.repeat(32),
} as const
const STORYBOARD_CANVAS_CHANGED_PATHS = [
  '$.directorPlan.storyboardCanvas',
  '$.directorPlan.subjectLayout',
  '$.directorPlan.objectAnchors',
  '$.directorPlan.actionTrajectory',
  '$.visualAtoms.storyboardCanvas',
  '$.visualAtoms.subjectLayout',
  '$.visualAtoms.objectAnchors',
  '$.visualAtoms.actionTrajectory',
] as const
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

function isReadOnlyProviderEvidenceRead(request: CapturedYimengRequest): boolean {
  if (request.method !== 'GET') return false
  const pathname = new URL(request.path, 'http://127.0.0.1').pathname
  return pathname === '/api/providers/capability-catalog'
    || pathname === '/api/qingmu/provider-gate-a/control-evidence'
}

interface StoryboardRevisionFixture {
  readonly revisionId: string
  readonly revisionVersion: number
  readonly sourceSha256: string
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
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareUnicodeCodePoints).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('fixture is not canonical JSON')
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function jcsCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${jcsCanonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('fixture is not RFC 8785 JSON')
}

function jcsSha256(value: unknown): string {
  return createHash('sha256').update(jcsCanonicalJson(value), 'utf8').digest('hex')
}

function capabilityCatalogFixture(filtered = false) {
  const snapshot = {
    schema: 'jason.provider-capability-snapshot.v1',
    modelId: 'fake-video-v1',
    providerId: 'fake',
    familyId: 'fake-video',
    displayName: 'Gate A Fake Video',
    enabled: true,
    inputs: { first_frame_url: 'url_optional', prompt: 'string', '😀': 'emoji-key', '\uE000': 'bmp-key' },
    outputs: { video_url: 'url' },
    geometry: { max_duration_sec: 8, max_outputs: 8, min_duration_sec: 2, resolutions: ['720P'] },
    consistency: {
      capabilities: ['video.continuation', 'video.first_frame', 'video.visual'],
      referenceAware: true,
    },
    controls: ['video.continuation', 'video.first_frame', 'video.visual'],
    mutualExclusions: [{
      ruleId: 'fake-first-frame-or-continuation',
      controls: ['video.continuation', 'video.first_frame'],
      maxSelected: 1,
    }],
    cost: { by_resolution: { '720P': 0.6 }, currency: 'CNY', micro_unit: 0.000001, unit: 'second' },
    runtime: { deploymentScope: '', endpoint: '', endpointsByCapability: {}, region: '' },
    compliance: {
      docs: ['test://gate-a-fake'],
      evidenceLevel: 'L2',
      paidDispatchAllowed: false,
      paidDispatchByCapability: {},
      productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    },
    declaration: {
      inputsDeclared: true,
      outputsDeclared: true,
      geometryDeclared: true,
      mutualExclusionsDeclared: true,
      errors: [],
    },
  } as const
  const capabilitySnapshotCanonicalJson = jcsCanonicalJson(snapshot)
  const capabilitySnapshotSha256 = jcsSha256(snapshot)
  const capabilitySnapshotId = `capability-snapshot:sha256:${capabilitySnapshotSha256}`
  const request = filtered
    ? { modelId: 'fake-video-v1', capability: 'video.visual', requestedControls: ['video.visual'], dryRun: true } as const
    : { modelId: null, capability: null, requestedControls: [], dryRun: true } as const
  const items = [{
    capabilitySnapshotId,
    capabilitySnapshotSha256,
    capabilitySnapshotCanonicalJson,
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    snapshot,
    eligibility: filtered
      ? { evaluated: true, eligible: true, errors: [] }
      : { evaluated: false, eligible: false, errors: ['requirements_not_supplied'] },
  }] as const
  const catalogIdentity = {
    schema: 'jason.provider-capability-catalog.v1',
    activeProfile: 'quality',
    items: [{ capabilitySnapshotId, capabilitySnapshotSha256 }],
  } as const
  const catalogSnapshotSha256 = jcsSha256(catalogIdentity)
  const requestSnapshotSha256 = jcsSha256(request)
  const preflightIdentity = {
    schema: 'jason.provider-capability-preflight.v1',
    catalogSnapshotSha256,
    requestSnapshotSha256,
    items: [{ capabilitySnapshotId, eligibility: items[0].eligibility }],
  } as const
  return {
    schema: 'jason.provider-capability-catalog.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    activeProfile: 'quality',
    catalogSnapshotSha256,
    requestSnapshotSha256,
    preflightSnapshotSha256: jcsSha256(preflightIdentity),
    request,
    items,
    providerCalls: 0,
    databaseWrites: 0,
    paidGenerationAuthorized: false,
  } as const
}

function costRehearsalFixture(candidateCount: number) {
  const exactCatalog = capabilityCatalogFixture(true)
  const item = exactCatalog.items[0]
  const subjectIdentity = {
    projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
    frameNumber: 12, frameUpdatedAt: '2026-08-28T01:02:03+00:00', durationMillis: 2500,
  } as const
  const subject = { ...subjectIdentity, subjectSnapshotSha256: jcsSha256(subjectIdentity) }
  const capabilityBinding = {
    modelId: 'fake-video-v1', capability: 'video.visual', requestedControls: ['video.visual'], resolution: '720P',
    catalogSnapshotSha256: exactCatalog.catalogSnapshotSha256,
    requestSnapshotSha256: exactCatalog.requestSnapshotSha256,
    preflightSnapshotSha256: exactCatalog.preflightSnapshotSha256,
    capabilitySnapshotId: item.capabilitySnapshotId,
    capabilitySnapshotSha256: item.capabilitySnapshotSha256,
    eligibility: item.eligibility,
    paidDispatchAllowed: false,
  } as const
  const oneCandidateMicros = 1_500_000
  const maximumCostMicros = oneCandidateMicros * candidateCount
  const microsCny = (value: number) => `${String(Math.floor(value / 1_000_000))}.${String(value % 1_000_000).padStart(6, '0')}`
  const costEstimate = {
    currency: 'CNY', unit: 'second', formula: 'duration_seconds_x_resolution_rate_x_candidates',
    resolution: '720P', rateMicrosPerSecond: 600_000, oneCandidateMicros, candidateCount,
    maximumAllowedCandidateCount: 8, maximumCostMicros,
    oneCandidateCny: microsCny(oneCandidateMicros), maximumCostCny: microsCny(maximumCostMicros),
  } as const
  const budgetWindow = {
    scope: 'global_provider_window', projectQuotaStatus: 'NOT_CONFIGURED', episodeQuotaStatus: 'NOT_CONFIGURED',
    valid: true, errors: [], windowId: 'e6-2-isolated-window', baselineMicros: 0, allowanceMicros: 20_000_000,
    effectiveCapMicros: 20_000_000, lifetimeSpentMicros: 0, windowSpentMicros: 0,
    windowRemainingMicros: 20_000_000,
  } as const
  const reservationRehearsal = {
    status: 'READY_NOT_RESERVED_DRY_RUN', blockers: [], proposedReservationMicros: maximumCostMicros,
    formallyReservedMicros: 0, formalReservationId: null, wouldFitBudget: true,
    remainingIfReservedMicros: budgetWindow.windowRemainingMicros - maximumCostMicros,
    exactAuthorizationRequired: true, formalReservationAllowed: false,
  } as const
  const difference = {
    estimateToProposedReservationMicros: 0, estimateToFormalReservationMicros: maximumCostMicros,
    actualCostMicros: null, actualVsProposedReservationMicros: null, releasedMicros: 0,
    refundMicros: null, actualCostStatus: 'UNAVAILABLE_BEFORE_SUBMIT',
  } as const
  const identity = {
    schema: 'jason.provider-cost-rehearsal-snapshot.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION', mode: 'dry_run', subject,
    capabilityBinding, costEstimate, budgetWindow, reservationRehearsal, difference,
  } as const
  return {
    schema: 'jason.provider-cost-rehearsal.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION', mode: 'dry_run',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1', subject, capabilityBinding, costEstimate,
    budgetWindow, reservationRehearsal, difference, rehearsalSnapshotSha256: jcsSha256(identity),
    providerCalls: 0, databaseWrites: 0, budgetLedgerWrites: 0, taskCreated: false,
    queueEntered: false, submitAttempted: false, pollAttempted: false, downloadAttempted: false,
    webhookRegistered: false, paidGenerationAuthorized: false,
  } as const
}

function gateAControlEvidenceFixture() {
  const environment = {
    database: 'temporary_sqlite', networkEgressAllowed: false, provider: 'scripted_fake',
    productionCredentialsLoaded: false, temporaryDatabaseWrites: true,
  } as const
  const scenarios = [
    { id: 'unauthorized_request_blocked', outcome: 'passed', providerSubmitAttempts: 0, budgetReserved: false },
    {
      id: 'duplicate_ack_replay', outcome: 'passed', providerSubmitAttempts: 1,
      duplicateAckReplays: 1, duplicatePaidSubmissions: 0,
    },
    { id: 'payload_sha_conflict', outcome: 'passed', providerSubmitAttempts: 1, conflictingSubmitAttempts: 0 },
    {
      id: 'submission_unknown_quarantine', outcome: 'passed', providerSubmitAttempts: 1,
      automaticResubmits: 0, workerOutcomes: ['dispatch_state_unknown'],
    },
    {
      id: 'simulated_reconciliation', outcome: 'passed', providerCalls: 0,
      deduplicated: true, simulatedOperatorDecision: true, humanSignoffInferred: false,
    },
    {
      id: 'poll_recovery', outcome: 'passed', providerSubmitAttempts: 1, providerPollAttempts: 2,
      automaticResubmits: 0, workerOutcomes: ['dispatched', 'error', 'ingested', 'technical_quality_passed'],
    },
    {
      id: 'download_timeout_recovery', outcome: 'passed', providerSubmitAttempts: 1,
      providerPollAttempts: 1, downloadAttempts: 2, automaticResubmits: 0,
      workerOutcomes: ['dispatched', 'download_timeout_retry', 'ingested', 'technical_quality_passed'],
    },
    {
      id: 'truncated_download_rejected', outcome: 'passed', providerSubmitAttempts: 1,
      providerPollAttempts: 1, downloadAttempts: 1, truncatedDownloadsAccepted: 0,
    },
  ] as const
  const assertions = {
    externalProviderCalls: 0, productionDatabaseWrites: 0, formalBudgetLedgerWrites: 0,
    duplicatePaidSubmissions: 0, unknownAutomaticResubmits: 0,
    maximumAutomaticSubmitAttemptsPerDispatch: 1, networkEgressAttempts: 0,
    truncatedDownloadsAccepted: 0, reconciliationProviderCalls: 0,
    pollRecoveryResubmits: 0, downloadRecoveryResubmits: 0,
  } as const
  const sourceBindings = [
    { path: 'backend/src/jason/apps/studio/asset_service.py', sha256: '21e90418835691dd045bd5b1b96856359188d6786c6f57a6faafe7efb0e3cbe1' },
    { path: 'backend/src/jason/apps/studio/provider_submission_reconciliation_service.py', sha256: '408aab76af4843b80d9480614e172fcbe365bcf4acc2e8d36265bfd6f9490dc1' },
    { path: 'backend/src/jason/apps/studio/provider_worker_service.py', sha256: '6a14c2962a899abb1da6f73b62f6550d5f4a64aa4d308211cbda405ecb6a13ce' },
    { path: 'backend/src/jason/apps/studio/result_ingest_service.py', sha256: '5dc48b0bd5e6b8f0fc43eb88347712cce45a26c96deac1136a90cdfd6d9fd100' },
    { path: 'backend/src/jason/domain/task_center.py', sha256: 'e87c4272e6538dce68ec427fef1606e7728f0fb7dcd704d03ad4317f6f8e945b' },
    { path: 'backend/src/jason/providers/gate.py', sha256: '9ab0a3ef9251bbda2a33dc5a7fd45e54aa8959b62585d3b82509fa5f8ea75eec' },
    { path: 'backend/src/jason/providers/gate_a_control_evidence.py', sha256: 'cf07777be685213d7ed01b56ed306635069332b348726f3ec15a9909eb71631a' },
    { path: 'backend/src/jason/providers/registry.py', sha256: '3ef264a5c16c1cccbd4757165e3ad39c2417b5a403bff5c4507ba622cb06a6cc' },
    { path: 'scripts/qingmu_gate_a_evidence.py', sha256: '00b5de3ae3b0a27bfc6113a0a1d0909b501041a8a971fbdc64fe2f5bb1c90e49' },
  ] as const
  const identity = {
    schema: 'jason.qingmu-provider-gate-a-control-evidence.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    gateAStatus: 'PASSED_CONTROL_LOGIC_ONLY',
    mode: 'offline_fault_injection',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    environment, scenarios, assertions, sourceBindings,
    externalProviderCalls: 0, productionDatabaseWrites: 0, formalBudgetLedgerWrites: 0,
    simulatedProviderSubmitAttempts: 6, paidGenerationAuthorized: false, humanSignoffInferred: false,
  } as const
  return { ...identity, evidenceSnapshotSha256: jcsSha256(identity) }
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

function shotRelationsFixture(
  revision: number,
  storyboardRevision: StoryboardRevisionFixture = STORYBOARD_CANVAS_BASE_REVISION,
) {
  return {
    schema: 'jason.scene-shot-beat-element-relations.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    storyboardRevision: {
      episodeRevision: revision,
      ...storyboardRevision,
    },
    scenes: [{
      sceneId: 'scene-1',
      name: '旧体育馆走廊',
      profileRevision: 3,
      snapshotSha256: '72'.repeat(32),
    }],
    // Keep transport order deliberately reversed: frameNo is the only Shot River order authority.
    shots: [{
      shotId: PROMPT_IR_FRAME_ID,
      frameNo: 12,
      sceneId: 'scene-1',
      title: '雨夜车站',
      durationSec: 2.5,
      dialogueRhythm: {
        cueCount: 1,
        timedCueCount: 1,
        cues: [{
          schemaVersion: 'dialogue-cue-v2',
          lineId: 'line-frame-1-opening',
          speakerId: 'actor-1',
          verbatimText: '你终于来了。',
          plannedStartSec: 0.5,
          plannedEndSec: 1.5,
          timingVerified: true,
          legacy: false,
        }],
      },
      beats: [{
        beatId: 'beat-frame-1-opening',
        order: 0,
        type: 'action',
        startSec: 0,
        endSec: 2.5,
        actorIds: ['actor-1'],
        propIds: ['prop-1'],
        visualResponsibility: '林青在雨夜车站抬头，银色怀表保持在右手。',
      }],
      elements: [
        {
          elementKind: 'actor',
          elementId: 'actor-1',
          name: '林青',
          profileRevision: 3,
          snapshotSha256: '73'.repeat(32),
          currentReferenceAvailability: 'available',
          currentReference: {
            assetId: 'asset-actor-1-current-reference',
            sha256: '75'.repeat(32),
            lineage: {
              projectId: 'project-1',
              sourceEpisodeId: 'episode-1',
              ownerType: 'actor',
              ownerId: 'actor-1',
              role: 'identity_board',
              generationJobId: 'job-actor-1-current-reference',
              sourceRevisionId: 'revision-actor-1-current-reference',
              formalConsistencyCheckId: 'check-actor-1-current-reference',
            },
          },
        },
        {
          elementKind: 'scene',
          elementId: 'scene-1',
          name: '旧体育馆走廊',
          profileRevision: 3,
          snapshotSha256: '72'.repeat(32),
          currentReferenceAvailability: 'missing',
          currentReference: null,
        },
        {
          elementKind: 'prop',
          elementId: 'prop-1',
          name: '银色怀表',
          profileRevision: 5,
          snapshotSha256: '74'.repeat(32),
          currentReferenceAvailability: 'missing',
          currentReference: null,
        },
      ],
    }, {
      shotId: SHOT_RIVER_FIRST_FRAME_ID,
      frameNo: 7,
      sceneId: 'scene-1',
      title: '走廊空镜',
      durationSec: 1.25,
      dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] },
      beats: [],
      elements: [{
        elementKind: 'scene',
        elementId: 'scene-1',
        name: '旧体育馆走廊',
        profileRevision: 3,
        snapshotSha256: '72'.repeat(32),
        currentReferenceAvailability: 'missing',
        currentReference: null,
      }],
    }],
    valid: true,
    blockers: [],
  } as const
}

function heroFrameStoryboardsFixture(
  revision: number,
  storyboardRevision: StoryboardRevisionFixture,
  browserUrl: string,
  canvas: Record<string, unknown> | null,
) {
  const shotRelations = shotRelationsFixture(revision, storyboardRevision)
  const heroFrame = {
    assetId: STORYBOARD_CANVAS_HERO_ASSET_ID,
    mediaSha256: STORYBOARD_CANVAS_HERO_MEDIA_SHA,
    browserUrl,
    bindingSha256: STORYBOARD_CANVAS_HERO_BINDING_SHA,
  } as const
  const shot = {
    shotId: PROMPT_IR_FRAME_ID,
    shotSnapshotSha256: storyboardRevision.revisionVersion === 1 ? '83'.repeat(32) : '84'.repeat(32),
    heroFrame,
    canvas,
    blockers: [],
  } as const
  const stableShot = {
    ...shot,
    heroFrame: {
      assetId: heroFrame.assetId,
      mediaSha256: heroFrame.mediaSha256,
      bindingSha256: heroFrame.bindingSha256,
    },
  }
  const firstShot = {
    shotId: SHOT_RIVER_FIRST_FRAME_ID,
    shotSnapshotSha256: storyboardRevision.revisionVersion === 1 ? '85'.repeat(32) : '86'.repeat(32),
    heroFrame: null,
    canvas: null,
    blockers: [],
  } as const
  return {
    schema: 'jason.qingmu-hero-frame-storyboards.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    episodeRevision: revision,
    storyboardRevision,
    shotRelationsSha256: canonicalSha256(shotRelations),
    shots: [shot, firstShot],
    shotsSha256: canonicalSha256([stableShot, firstShot]),
    valid: true,
    blockers: [],
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

type ContinuityMode = 'current' | 'historical' | 'historical-failed' | 'unknown' | 'unavailable' | 'omitted'

function continuityDeltaFixture(
  revision: number,
  storyboardRevision: StoryboardRevisionFixture,
  mode: Exclude<ContinuityMode, 'omitted'>,
) {
  const base = continuityFixture()
  const historical = mode === 'historical' || mode === 'historical-failed'
  const evidenceReady = mode === 'current' || mode === 'historical'
  return rebindContinuity({
    ...base, projectId: 'project-1', episodeId: 'episode-1',
    storyboardRevision: { episodeRevision: revision, ...storyboardRevision },
    availability: mode === 'unavailable' ? 'unavailable' : 'available',
    reason: mode === 'unavailable' ? 'continuity_source_unavailable' : null,
    pairs: mode === 'unavailable' ? [] : base.pairs.map(pair => ({
      ...pair, fromShotId: SHOT_RIVER_FIRST_FRAME_ID, toShotId: PROMPT_IR_FRAME_ID,
      legacyStatus: evidenceReady ? 'passed' : 'blocked', legacyEvidenceReady: evidenceReady,
      bindingStatus: historical ? 'different' : 'current', currentEvidenceReady: mode === 'current',
      currentBinding: historical
        ? { ...pair.currentBinding, tailAssetId: 'tail-e55-new', tailSha256: createHash('sha256').update('replacement-tail').digest('hex') }
        : pair.currentBinding,
      audit: {
        ...pair.audit, passed: mode === 'unknown' ? null : mode !== 'historical-failed',
        dimensions: pair.audit.dimensions.map(item => item.dimension === 'prop' && !evidenceReady
          ? { ...item, result: mode === 'unknown' ? null : false, reason: mode === 'unknown' ? null : '历史检查：怀表位置不符' } : item),
      },
      warnings: historical ? ['current_tail_differs_from_audited_tail'] : mode === 'unknown' ? ['prop_evidence_unavailable'] : [],
    })),
  })
}

function workflowFixture(
  revision: number,
  promptIrSelected = false,
  storyboardRevision: StoryboardRevisionFixture = STORYBOARD_CANVAS_BASE_REVISION,
  heroBrowserUrl = 'http://127.0.0.1/api/qingmu/assets/hero-frame-asset-1/content',
  storyboardCanvas: Record<string, unknown> | null = null,
  continuityMode: ContinuityMode = 'omitted',
) {
  const shotRelations = shotRelationsFixture(revision, storyboardRevision)
  const continuityDelta = continuityMode === 'omitted' ? undefined : continuityDeltaFixture(revision, storyboardRevision, continuityMode)
  return {
    schema: 'jason.episode-workflow-projection.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceRevision: { script: revision },
    inputFingerprint: `fingerprint-${String(revision)}${continuityDelta === undefined ? '' : `:${continuityDelta.snapshotSha256}`}`,
    activeTaskId: null,
    status: 'active',
    hasData: true,
    isStale: false,
    qualityPassed: true,
    selected: true,
    canProceed: true,
    // Untrusted legacy extension: workset compilation must never treat this as stage authority.
    imagoStageApproval: { approved: true, scope: 'GLOBAL', stageId: 'A0' },
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
    director: {
      shotRelations,
      ...(continuityDelta === undefined ? {} : { continuityDelta }),
      heroFrameStoryboards: heroFrameStoryboardsFixture(
        revision,
        storyboardRevision,
        heroBrowserUrl,
        storyboardCanvas,
      ),
    },
    shots: {
      count: 1,
      shotGroupCount: 1,
      segmentCount: 1,
      unresolvedAssetRefCount: 0,
      items: [promptIrWorkflowShot(promptIrSelected)],
    },
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

interface StoryboardCanvasMethodProof {
  readonly canvas: Record<string, unknown>
  readonly methodHeroFrameBindingSha256: string
  readonly methodRawAnnotationsSha256: string
  readonly compiledSha256: string
  readonly projectionSha256: string
}

function validateStoryboardCanvasProposal(
  body: unknown,
  baseSnapshotSha256: string,
): StoryboardCanvasMethodProof {
  const proposal = isRecord(body) ? body : {}
  const expectedKeys = [
    'operation',
    'baseRevision',
    'baseSnapshotSha256',
    'baseCanvasSha256',
    'heroFrameAssetId',
    'heroFrameMediaSha256',
    'heroFrameBindingSha256',
    'methodHeroFrameBindingSha256',
    'methodProjection',
    'methodProjectionSha256',
    'methodAttestation',
    'harnessSessionId',
  ].sort()
  const projection = isRecord(proposal.methodProjection) ? proposal.methodProjection : {}
  const canvasProjection = isRecord(projection.canvas_projection) ? projection.canvas_projection : {}
  const projectedHero = isRecord(canvasProjection.heroFrame) ? canvasProjection.heroFrame : {}
  const attestation = isRecord(proposal.methodAttestation) ? proposal.methodAttestation : {}
  const attestationKeys = [
    'schema',
    'algorithm',
    'projectionSha256',
    'inputSnapshotSha256',
    'targetSha256',
    'relationSnapshotSha256',
    'selectedShotSha256',
    'heroFrameBindingSha256',
    'rawAnnotationsSha256',
    'compiledResultSha256',
    'signature',
  ].sort()
  const annotations = Array.isArray(canvasProjection.rawAnnotations) ? canvasProjection.rawAnnotations : []
  const compiled = isRecord(canvasProjection.compiledResult) ? canvasProjection.compiledResult : {}
  const plainAnnotationsSha256 = canonicalSha256(annotations)
  const projectionSha256 = canonicalSha256(projection)
  if (
    Object.keys(proposal).sort().some((key, index) => key !== expectedKeys[index])
    || Object.keys(proposal).length !== expectedKeys.length
    || Object.keys(attestation).sort().some((key, index) => key !== attestationKeys[index])
    || Object.keys(attestation).length !== attestationKeys.length
    || proposal.operation !== 'replaceStoryboardCanvas'
    || proposal.baseRevision !== STORYBOARD_CANVAS_BASE_REVISION.revisionVersion
    || proposal.baseSnapshotSha256 !== baseSnapshotSha256
    || proposal.baseCanvasSha256 !== null
    || proposal.heroFrameAssetId !== STORYBOARD_CANVAS_HERO_ASSET_ID
    || proposal.heroFrameMediaSha256 !== STORYBOARD_CANVAS_HERO_MEDIA_SHA
    || proposal.heroFrameBindingSha256 !== STORYBOARD_CANVAS_HERO_BINDING_SHA
    || proposal.harnessSessionId !== null
    || projection.schema !== 'qingmu.imago-hero-frame-storyboard-method-projection.v1'
    || canvasProjection.canonicalShotIdSource !== 'yimeng_storyboard_frame_id'
    || canvasProjection.shotId !== PROMPT_IR_FRAME_ID
    || canvasProjection.baseCanvasSha256 !== null
    || projectedHero.assetId !== STORYBOARD_CANVAS_HERO_ASSET_ID
    || projectedHero.mediaSha256 !== STORYBOARD_CANVAS_HERO_MEDIA_SHA
    || typeof projectedHero.bindingSha256 !== 'string'
    || proposal.methodHeroFrameBindingSha256 !== projectedHero.bindingSha256
    || proposal.methodProjectionSha256 !== projectionSha256
    || annotations.length === 0
    || typeof canvasProjection.rawAnnotationsSha256 !== 'string'
    || canvasProjection.rawAnnotationsSha256 === plainAnnotationsSha256
    || typeof canvasProjection.compiledResultSha256 !== 'string'
    || canvasProjection.compiledResultSha256 !== canonicalSha256(compiled)
    || projection.providerCalls !== 0
    || projection.workerStarted !== false
    || projection.selection_executed !== false
    || projection.human_approval_inferred !== false
    || projection.human_signoff_inferred !== false
    || attestation.schema !== 'qingmu.imago-hero-frame-storyboard-method-attestation.v1'
    || attestation.algorithm !== 'hmac-sha256'
    || attestation.projectionSha256 !== projectionSha256
    || attestation.inputSnapshotSha256 !== projection.input_snapshot_sha256
    || attestation.heroFrameBindingSha256 !== projectedHero.bindingSha256
    || attestation.rawAnnotationsSha256 !== canvasProjection.rawAnnotationsSha256
    || attestation.compiledResultSha256 !== canvasProjection.compiledResultSha256
  ) {
    throw new Error('storyboard canvas proposal or IMAGO method lineage mismatch')
  }
  const { signature, ...unsignedAttestation } = attestation
  if (
    typeof signature !== 'string'
    || signature !== createHmac('sha256', IMAGO_ATTESTATION_KEY)
      .update(canonicalJson(unsignedAttestation), 'utf8')
      .digest('hex')
  ) {
    throw new Error('storyboard canvas method attestation signature mismatch')
  }
  return {
    canvas: {
      schema: 'jason.qingmu-storyboard-canvas.v1',
      heroFrameBindingSha256: STORYBOARD_CANVAS_HERO_BINDING_SHA,
      annotations,
      rawAnnotationsSha256: plainAnnotationsSha256,
      compiled,
      compiledSha256: canvasProjection.compiledResultSha256,
    },
    methodHeroFrameBindingSha256: projectedHero.bindingSha256,
    methodRawAnnotationsSha256: canvasProjection.rawAnnotationsSha256,
    compiledSha256: canvasProjection.compiledResultSha256,
    projectionSha256,
  }
}

function storyboardCanvasChangeSetFixture(baseSnapshotSha256: string) {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: STORYBOARD_CANVAS_CHANGE_SET_ID,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'storyboard_frame',
    targetId: PROMPT_IR_FRAME_ID,
    baseRevision: STORYBOARD_CANVAS_BASE_REVISION.revisionVersion,
    baseSnapshotSha256,
    payloadSha256: STORYBOARD_CANVAS_PAYLOAD_SHA,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: null,
    status: 'draft',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-27T11:00:00+00:00',
    updatedAt: '2026-08-27T11:00:00+00:00',
  } as const
}

function storyboardCanvasPreviewFixture(
  baseSnapshotSha256: string,
  proof: StoryboardCanvasMethodProof,
) {
  return {
    schema: 'jason.qingmu-storyboard-canvas-preview.v1',
    changeSetId: STORYBOARD_CANVAS_CHANGE_SET_ID,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'storyboard_frame',
    targetId: PROMPT_IR_FRAME_ID,
    operation: 'replaceStoryboardCanvas',
    storyboardRevision: STORYBOARD_CANVAS_BASE_REVISION,
    baseRevision: STORYBOARD_CANVAS_BASE_REVISION.revisionVersion,
    baseSnapshotSha256,
    payloadSha256: STORYBOARD_CANVAS_PAYLOAD_SHA,
    heroFrame: {
      assetId: STORYBOARD_CANVAS_HERO_ASSET_ID,
      mediaSha256: STORYBOARD_CANVAS_HERO_MEDIA_SHA,
      bindingSha256: STORYBOARD_CANVAS_HERO_BINDING_SHA,
    },
    methodHeroFrameBindingSha256: proof.methodHeroFrameBindingSha256,
    before: null,
    after: proof.canvas,
    changedPaths: STORYBOARD_CANVAS_CHANGED_PATHS,
    providerCalls: 0,
    workerStarted: false,
    selectionExecuted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  } as const
}

function storyboardCanvasCommitReceiptFixture(
  proof: StoryboardCanvasMethodProof,
  authoritativeSnapshotSha256: string,
  idempotencyKey: string,
) {
  return {
    schema: 'jason.qingmu-storyboard-canvas-commit-result.v1',
    changeSetId: STORYBOARD_CANVAS_CHANGE_SET_ID,
    commandReceiptId: 'receipt-storyboard-canvas-1',
    eventId: 'event-storyboard-canvas-1',
    eventType: 'StoryboardCanvasReplaced',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'storyboard_frame',
    targetId: PROMPT_IR_FRAME_ID,
    operation: 'replaceStoryboardCanvas',
    storyboardRevision: {
      base: STORYBOARD_CANVAS_BASE_REVISION,
      authoritative: STORYBOARD_CANVAS_AUTHORITATIVE_REVISION,
    },
    baseRevision: STORYBOARD_CANVAS_BASE_REVISION.revisionVersion,
    authoritativeRevision: STORYBOARD_CANVAS_AUTHORITATIVE_REVISION.revisionVersion,
    authoritativeSnapshotSha256,
    heroFrame: {
      assetId: STORYBOARD_CANVAS_HERO_ASSET_ID,
      mediaSha256: STORYBOARD_CANVAS_HERO_MEDIA_SHA,
      bindingSha256: STORYBOARD_CANVAS_HERO_BINDING_SHA,
    },
    methodHeroFrameBindingSha256: proof.methodHeroFrameBindingSha256,
    rawAnnotationsSha256: proof.canvas.rawAnnotationsSha256,
    methodRawAnnotationsSha256: proof.methodRawAnnotationsSha256,
    compiledSha256: proof.compiledSha256,
    payloadSha256: STORYBOARD_CANVAS_PAYLOAD_SHA,
    idempotencyKey,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    selectionExecuted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T11:02:00+00:00',
  } as const
}

type VideoReviewMode = 'none' | 'accepted' | 'rejected' | 'pending' | 'stale' | 'invalid'
  | 'wrong-subject' | 'wrong-asset-sha' | 'revision-mismatch' | 'unselected-accepted'

function selectedVideoReviewFixture(frameId: string, revision: number, mode: VideoReviewMode): unknown {
  const subject = { projectId: 'project-1', episodeId: 'episode-1', frameId }
  if (mode === 'none') return { ...subject, selectedAssetId: null, items: [] }
  const status = ['wrong-subject', 'wrong-asset-sha', 'revision-mismatch', 'unselected-accepted'].includes(mode) ? 'accepted' : mode
  const root = videoCandidatesFixture(subject, status as 'accepted' | 'rejected' | 'pending' | 'stale' | 'invalid')
  return {
    ...root,
    ...(mode === 'wrong-subject' ? { projectId: 'different-project' } : {}),
    ...(mode === 'unselected-accepted' ? { selectedAssetId: null } : {}),
    items: root.items.map(item => ({
      ...item,
      ...(mode === 'unselected-accepted' ? { isSelected: false } : {}),
      formalReview: item.formalReview === null ? null : {
        ...item.formalReview, storyboardRevision: revision + (mode === 'revision-mismatch' ? 1 : 0),
        ...(mode === 'wrong-asset-sha' ? { assetSha256: 'c'.repeat(64) } : {}),
      },
    })),
  }
}

type TakeVersionStackFixture = ReturnType<typeof baseTakeVersionStackFixture>

function takeVersionStackFixture(
  revision: number,
  selectedTakeId: 'asset-take-1' | 'asset-take-2' = 'asset-take-1',
): TakeVersionStackFixture {
  const base = baseTakeVersionStackFixture({
    projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
  })
  const subject = {
    ...base.subject,
    frameNo: 12,
    storyboardRevision: revision,
    frameContentSha256: 'b'.repeat(64),
    selectionRevision: selectedTakeId === 'asset-take-1' ? 0 : 1,
    selectedTakeId,
    versions: base.subject.versions.map((version) => {
      if (version.takeId === selectedTakeId) {
        return { ...version, selectionStatus: 'Selected', isSelected: true, canAttemptSelection: false }
      }
      if (selectedTakeId === 'asset-take-2' && version.takeId === 'asset-take-1') {
        return { ...version, selectionStatus: 'Stale', isSelected: false, canAttemptSelection: false }
      }
      return { ...version, selectionStatus: 'Unselected', isSelected: false, canAttemptSelection: true }
    }),
  }
  return { ...base, subject, stackSnapshotSha256: jcsSha256(subject) }
}

function takeCommentSubjectFixture(
  revision: number,
  takeId: 'asset-take-1' | 'asset-take-2',
): TakeCommentSubject {
  const stack = takeVersionStackFixture(revision)
  const version = stack.subject.versions.find(candidate => candidate.takeId === takeId)
  if (version === undefined || version.outputSha256 === null || version.durationSec === null) {
    throw new Error('Take comment subject requires a complete version binding')
  }
  return {
    schema: 'jason.qingmu-take-comment-subject.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    frameId: PROMPT_IR_FRAME_ID,
    frameNo: stack.subject.frameNo,
    storyboardRevision: stack.subject.storyboardRevision,
    frameContentSha256: stack.subject.frameContentSha256,
    takeId: version.takeId,
    versionOrdinal: version.versionOrdinal,
    outputSha256: version.outputSha256,
    durationMillis: Math.round(version.durationSec * 1_000),
  }
}

function takeCommentRequestFixture(
  revision: number,
  takeId: 'asset-take-1' | 'asset-take-2',
  anchor: TakeCommentRequest['anchor'],
  body: string,
  idempotencyKey: string,
): TakeCommentRequest {
  const subject = takeCommentSubjectFixture(revision, takeId)
  return {
    projectId: subject.projectId,
    episodeId: subject.episodeId,
    frameId: subject.frameId,
    expectedTakeSubjectSha256: jcsSha256(subject),
    takeId,
    anchor,
    body,
    idempotencyKey,
  }
}

function takeCommentRecordFixture(
  revision: number,
  input: TakeCommentRequest,
  sequence: number,
): TakeComment {
  const subject = takeCommentSubjectFixture(revision, input.takeId as 'asset-take-1' | 'asset-take-2')
  return {
    id: `take-comment-${String(sequence).padStart(4, '0')}`,
    takeId: input.takeId,
    versionOrdinalAtComment: subject.versionOrdinal,
    outputSha256: subject.outputSha256,
    frameBinding: {
      frameId: subject.frameId,
      frameNo: subject.frameNo,
      storyboardRevision: subject.storyboardRevision,
      frameContentSha256: subject.frameContentSha256,
    },
    takeSubjectSha256: input.expectedTakeSubjectSha256,
    anchor: input.anchor,
    body: input.body,
    actorId: 'owner-1',
    actorRole: 'commenter',
    authSessionId: '8'.repeat(64),
    createdAt: `2026-08-28T12:0${String(sequence)}:00.123456+00:00`,
    eventId: `take-comment-event-${String(sequence).padStart(4, '0')}`,
  }
}

function takeCommentResultFixture(
  revision: number,
  input: TakeCommentRequest,
  sequence: number,
): TakeCommentResult {
  return {
    schema: 'jason.qingmu-take-comment-result.v1',
    comment: takeCommentRecordFixture(revision, input, sequence),
    changed: false,
    selectionChanged: false,
    technicalPassChanged: false,
    formalApprovalChanged: false,
    episodeVerificationChanged: false,
    humanSignoffInferred: false,
    providerCalls: 0,
    budgetMutation: false,
  }
}

function takeCommentFeedFixture(
  revision: number,
  persisted: readonly TakeComment[] = [],
): TakeCommentFeed {
  const first = takeCommentSubjectFixture(revision, 'asset-take-1')
  const second = takeCommentSubjectFixture(revision, 'asset-take-2')
  const currentInput = takeCommentRequestFixture(
    revision,
    'asset-take-2',
    { kind: 'timecode', timecodeMillis: 1_250 },
    '当前 Take 的眼神应在这一拍落到左侧角色。',
    'take-comment-existing-current',
  )
  const historicalInput = takeCommentRequestFixture(
    revision,
    'asset-take-1',
    { kind: 'frame', frameNumber: 36 },
    '上一版第 36 帧构图需要调整。',
    'take-comment-existing-historical',
  )
  const historical = takeCommentRecordFixture(revision, historicalInput, 2)
  return {
    schema: 'jason.qingmu-take-comment-feed.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    frameId: PROMPT_IR_FRAME_ID,
    versions: [
      { takeSubject: first, takeSubjectSha256: jcsSha256(first) },
      { takeSubject: second, takeSubjectSha256: jcsSha256(second) },
    ],
    capabilities: { canComment: true },
    comments: [
      { ...takeCommentRecordFixture(revision, currentInput, 1), currentBinding: true },
      {
        ...historical,
        outputSha256: '3'.repeat(64),
        frameBinding: {
          ...historical.frameBinding,
          storyboardRevision: revision - 1,
          frameContentSha256: 'a'.repeat(64),
        },
        takeSubjectSha256: '9'.repeat(64),
        currentBinding: false,
      },
      ...persisted.map(comment => ({ ...comment, currentBinding: true })),
    ],
  }
}

const TAKE_REVIEW_ZERO_IMPACT = {
  changed: false,
  selectionChanged: false,
  technicalPassChanged: false,
  formalApprovalChanged: false,
  episodeVerificationChanged: false,
  humanSignoffInferred: false,
  providerCalls: 0,
  budgetMutation: false,
} as const

function takeReviewRecommendationResultFixture(
  revision: number,
  input: YimengCreateTakeReviewRecommendationRequest,
  sequence: number,
): YimengTakeReviewRecommendationResult {
  if (input.takeId !== 'asset-take-1' && input.takeId !== 'asset-take-2') {
    throw new Error('Reviewer recommendation Take mismatch')
  }
  const takeSubject = takeCommentSubjectFixture(revision, input.takeId)
  return {
    schema: 'jason.qingmu-take-review-recommendation-result.v1',
    recommendation: {
      id: `take-review-recommendation-${String(sequence).padStart(4, '0')}`,
      takeSubject,
      takeSubjectSha256: input.expectedTakeSubjectSha256,
      actorId: 'reviewer-user',
      actorRole: 'reviewer',
      actorNaturalPersonId: 'person-reviewer',
      authSessionId: '8'.repeat(64),
      eventId: `take-review-recommendation-event-${String(sequence).padStart(4, '0')}`,
      recommendation: input.recommendation,
      reason: input.reason,
      recommendedAt: `2026-08-28T12:1${String(sequence)}:00.123456+00:00`,
    },
    decisionRecorded: false,
    recommendationOnly: true,
    ...TAKE_REVIEW_ZERO_IMPACT,
  }
}

function takeHumanDecisionResultFixture(
  revision: number,
  input: YimengCreateTakeHumanDecisionRequest,
  sequence: number,
): YimengTakeHumanDecisionResult {
  if (input.takeId !== 'asset-take-1' && input.takeId !== 'asset-take-2') {
    throw new Error('Approver decision Take mismatch')
  }
  const takeSubject = takeCommentSubjectFixture(revision, input.takeId)
  return {
    schema: 'jason.qingmu-take-human-decision-result.v1',
    decision: {
      decisionId: `take-human-decision-${String(sequence).padStart(4, '0')}`,
      subjectType: 'shot_take',
      subjectId: input.takeId,
      subjectRevision: takeSubject.versionOrdinal,
      subjectSha256: input.expectedTakeSubjectSha256,
      takeSubject,
      takeSubjectSha256: input.expectedTakeSubjectSha256,
      actorId: 'approver-user',
      actorRole: 'approver',
      actorNaturalPersonId: 'person-approver',
      authSessionId: '9'.repeat(64),
      eventId: `take-human-decision-event-${String(sequence).padStart(4, '0')}`,
      decision: input.decision,
      reason: input.reason,
      producerActorId: 'producer-user',
      producerNaturalPersonId: 'person-producer',
      participantNaturalPersonIds: ['person-editor', 'person-producer'],
      decidedAt: `2026-08-28T12:2${String(sequence)}:00.123456+00:00`,
    },
    decisionRecorded: true,
    recommendationOnly: false,
    ...TAKE_REVIEW_ZERO_IMPACT,
  }
}

function takeReviewAuthorityFeedFixture(
  revision: number,
  recommendations: readonly YimengTakeReviewRecommendationResult[] = [],
  decisions: readonly YimengTakeHumanDecisionResult[] = [],
): YimengTakeReviewAuthorityFeedResponse {
  const first = takeCommentSubjectFixture(revision, 'asset-take-1')
  const second = takeCommentSubjectFixture(revision, 'asset-take-2')
  const recommendationHistory: ReadTakeReviewRecommendation[] = recommendations.map(result => ({
    ...result.recommendation,
    currentBinding: true,
  }))
  const decisionHistory: ReadTakeHumanDecision[] = decisions.map(result => ({
    ...result.decision,
    currentBinding: true,
  }))
  return {
    schema: 'jason.qingmu-take-review-authority-feed.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    frameId: PROMPT_IR_FRAME_ID,
    capabilities: { canReview: true, canDecide: true },
    versions: [
      { takeSubject: first, takeSubjectSha256: jcsSha256(first) },
      { takeSubject: second, takeSubjectSha256: jcsSha256(second) },
    ],
    recommendations: recommendationHistory,
    decisions: decisionHistory,
    currentDecision: decisionHistory.at(-1) ?? null,
    boundaries: {
      reviewerRecommendationIsApproval: false,
      decisionMutatesTakeState: false,
      roleOrSessionSwitchCanBypassNaturalPersonSeparation: false,
    },
  }
}

function takeAcceptanceFixture(
  revision: number,
  selectedTakeId: 'asset-take-1' | 'asset-take-2' = 'asset-take-1',
) {
  const request = { projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID }
  const base = baseTakeAcceptanceFixture(request)
  const stack = takeVersionStackFixture(revision, selectedTakeId)
  const version = stack.subject.versions.find(item => item.takeId === selectedTakeId)
  if (version === undefined || version.outputSha256 === null || version.inputHash === null
    || version.durationSec === null) {
    throw new Error('selected Take acceptance fixture requires complete lineage')
  }
  const macroPassed = selectedTakeId === 'asset-take-1'
  const checks = base.evidence.candidateQuality.checks.map(check => check.checkType === 'creative_director_execution'
    ? { ...check, passed: macroPassed }
    : check)
  const evidence = {
    ...base.evidence,
    subject: {
      ...base.evidence.subject,
      frameNo: stack.subject.frameNo,
      storyboardRevision: stack.subject.storyboardRevision,
      frameContentSha256: stack.subject.frameContentSha256,
      selectionRevision: stack.subject.selectionRevision,
      takeId: version.takeId,
      versionOrdinal: version.versionOrdinal,
      outputSha256: version.outputSha256,
      taskId: version.taskId,
      capability: 'video.generate',
      routeKey: version.routeKey,
      provider: version.provider,
      model: version.model,
      inputHash: version.inputHash,
      submitId: version.providerTaskId,
    },
    providerReceipt: {
      ...base.evidence.providerReceipt,
      payloadSha256: version.inputHash,
      providerTaskId: version.providerTaskId,
    },
    technicalReceipt: {
      ...base.evidence.technicalReceipt,
      media: { ...base.evidence.technicalReceipt.media, sha256: version.outputSha256 },
      video: base.evidence.technicalReceipt.video === null ? null : {
        ...base.evidence.technicalReceipt.video,
        durationSeconds: version.durationSec,
        nbFrames: Math.round(version.durationSec * 24),
        videoStreamDurationSeconds: version.durationSec,
        actualAverageFrameRate: 24,
      },
    },
    candidateQuality: {
      ...base.evidence.candidateQuality,
      status: macroPassed ? 'PASS' as const : 'BLOCKED' as const,
      checks,
      failedOrStaleCheckTypes: macroPassed ? [] : ['creative_director_execution'],
    },
  }
  return { ...base, evidence, evidenceSnapshotSha256: jcsSha256(evidence) }
}

function takeVersionSelectionResultFixture(
  request: Record<string, unknown>,
  authoritativeStack: TakeVersionStackFixture['subject'],
  deduplicated = false,
) {
  const idempotencyKey = String(request.idempotencyKey)
  const suffix = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 16)
  return {
    schema: 'jason.qingmu-take-selection-result.v1',
    changeSetId: `changeset-take-${suffix}`,
    commandReceiptId: `receipt-take-${suffix}`,
    eventId: `event-take-${suffix}`,
    eventType: 'TakeVersionSelected',
    projectId: 'project-1',
    episodeId: 'episode-1',
    frameId: PROMPT_IR_FRAME_ID,
    selectedTake: {
      takeId: request.candidateTakeId,
      versionOrdinal: request.candidateVersionOrdinal,
      outputSha256: request.candidateOutputSha256,
    },
    selectionIdentity: {
      actorUserId: 'owner-1',
      actorNaturalPersonId: 'owner-natural-person-1',
      actorRole: 'project_owner_selector',
      authSessionId: createHash('sha256').update(YIMENG_TOKEN, 'utf8').digest('hex'),
    },
    baseStackSnapshotSha256: request.expectedStackSha256,
    authoritativeStack,
    authoritativeStackSnapshotSha256: jcsSha256(authoritativeStack),
    provenanceTaskId: `selection-provenance-${suffix}`,
    taskMutation: {
      created: true,
      kind: 'local_selection_provenance',
      taskId: `selection-provenance-${suffix}`,
    },
    idempotencyKey,
    deduplicated,
    committedAt: '2026-08-28T10:02:00.123456+00:00',
    selectionChanged: true,
    providerCalls: 0,
    paidProviderAuthority: 'not_granted',
    budgetMutation: false,
    humanApprovalInferred: false,
    formalApprovalChanged: false,
  } as const
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
  readonly storyboardCanvasCommitAccepted: Promise<void>
  readonly releaseStoryboardCanvasCommitResponse: () => void
  readonly setContinuityMode: (mode: ContinuityMode) => void
  readonly setVideoReviewMode: (mode: VideoReviewMode) => void
  readonly setTakeSelectedId: (takeId: 'asset-take-1' | 'asset-take-2') => void
  readonly shotFindings: ReturnType<typeof createShotFindingDouble>
  readonly reworkRoutes: ReturnType<typeof createReworkRouteDouble>
  readonly productionUnits: ReturnType<typeof createProductionUnitDouble>
  readonly stageSources: ReturnType<typeof createStageSourceDouble>
}> {
  let revision = 3
  const shotFindings = createShotFindingDouble({
    token: YIMENG_TOKEN, attestationKey: IMAGO_ATTESTATION_KEY, canonicalJson, canonicalSha256,
  })
  const productionUnits = createProductionUnitDouble({
    token: YIMENG_TOKEN, attestationKey: IMAGO_ATTESTATION_KEY, canonicalJson, canonicalSha256,
  })
  const stageSources = createStageSourceDouble({
    token: YIMENG_TOKEN, attestationKey: IMAGO_ATTESTATION_KEY, canonicalJson, canonicalSha256,
  })
  const reworkRoutes = createReworkRouteDouble({
    token: YIMENG_TOKEN,
    attestationKey: IMAGO_ATTESTATION_KEY,
    canonicalJson,
    canonicalSha256,
    getRecordedFindings: () => shotFindings.getRecordedResults(),
  })
  let continuityMode: ContinuityMode = 'omitted'
  let videoReviewMode: VideoReviewMode = 'none'
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
  let storyboardRevision: StoryboardRevisionFixture = STORYBOARD_CANVAS_BASE_REVISION
  let storyboardCanvas: Record<string, unknown> | null = null
  let pendingStoryboardCanvasProof: StoryboardCanvasMethodProof | undefined
  let storyboardCanvasBaseSnapshotSha256: string | undefined
  let persistedStoryboardCanvasReceipt: ReturnType<typeof storyboardCanvasCommitReceiptFixture> | undefined
  let takeSelectedId: 'asset-take-1' | 'asset-take-2' = 'asset-take-1'
  const persistedTakeSelectionReceipts = new Map<
    string,
    ReturnType<typeof takeVersionSelectionResultFixture>
  >()
  const persistedTakeCommentReceipts = new Map<string, TakeCommentResult>()
  const persistedTakeComments: TakeComment[] = []
  const persistedTakeReviewRecommendationReceipts = new Map<
    string,
    YimengTakeReviewRecommendationResult
  >()
  const persistedTakeReviewRecommendations: YimengTakeReviewRecommendationResult[] = []
  const persistedTakeHumanDecisionReceipts = new Map<string, YimengTakeHumanDecisionResult>()
  const persistedTakeHumanDecisions: YimengTakeHumanDecisionResult[] = []
  let publicBaseUrl = ''
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
  let resolveStoryboardCanvasCommitAccepted: (() => void) | undefined
  let resolveStoryboardCanvasCommitResponse: (() => void) | undefined
  const storyboardCanvasCommitAccepted = new Promise<void>((resolve) => {
    resolveStoryboardCanvasCommitAccepted = resolve
  })
  const storyboardCanvasCommitResponseReleased = new Promise<void>((resolve) => {
    resolveStoryboardCanvasCommitResponse = resolve
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
      if (request.method === 'GET' && url.pathname === '/api/providers/capability-catalog') {
        const filtered = url.searchParams.has('model_id')
        json(response, 200, capabilityCatalogFixture(filtered))
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/cost-rehearsal`
      ) {
        json(response, 200, costRehearsalFixture(Number(url.searchParams.get('candidate_count') ?? '0')))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/qingmu/provider-gate-a/control-evidence') {
        json(response, 200, gateAControlEvidenceFixture())
        return
      }
      const takeVersionPath = `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/take-versions`
      if (request.method === 'GET' && url.pathname === takeVersionPath) {
        json(response, 200, takeVersionStackFixture(revision, takeSelectedId))
        return
      }
      if (request.method === 'GET' && url.pathname === `${takeVersionPath}/acceptance`) {
        json(response, 200, takeAcceptanceFixture(revision, takeSelectedId))
        return
      }
      if (request.method === 'POST' && url.pathname === `${takeVersionPath}/selection`) {
        if (!isRecord(body)) throw new Error('take selection body is missing')
        const expectedKeys = [
          'expectedStackSha256', 'expectedSelectedTakeId', 'candidateTakeId',
          'candidateVersionOrdinal', 'candidateOutputSha256', 'idempotencyKey',
        ].sort()
        const currentStack = takeVersionStackFixture(revision, takeSelectedId)
        const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
        const replay = persistedTakeSelectionReceipts.get(key)
        if (replay !== undefined) {
          json(response, 200, { ...replay, deduplicated: true })
          return
        }
        if (
          Object.keys(body).sort().some((field, index) => field !== expectedKeys[index])
          || Object.keys(body).length !== expectedKeys.length
          || request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`
          || request.headers['idempotency-key'] !== key
          || body.expectedStackSha256 !== currentStack.stackSnapshotSha256
          || body.expectedSelectedTakeId !== takeSelectedId
          || body.candidateTakeId !== 'asset-take-2'
          || body.candidateVersionOrdinal !== 2
          || body.candidateOutputSha256 !== '4'.repeat(64)
        ) {
          throw new Error('take selection contract mismatch')
        }
        takeSelectedId = 'asset-take-2'
        const result = takeVersionSelectionResultFixture(
          body,
          takeVersionStackFixture(revision, takeSelectedId).subject,
        )
        persistedTakeSelectionReceipts.set(key, result)
        json(response, 201, result)
        return
      }
      if (request.method === 'GET' && url.pathname === `${takeVersionPath}/selection-command-receipt`) {
        const key = typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : ''
        const result = persistedTakeSelectionReceipts.get(key) ?? null
        const expectedSelectedTakeId = url.searchParams.get('expectedSelectedTakeId')
        json(response, 200, {
          schema: 'jason.qingmu-take-selection-recovery.v1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          frameId: PROMPT_IR_FRAME_ID,
          expectedStackSha256: url.searchParams.get('expectedStackSha256'),
          expectedSelectedTakeId,
          candidateTakeId: url.searchParams.get('candidateTakeId'),
          candidateVersionOrdinal: Number(url.searchParams.get('candidateVersionOrdinal')),
          candidateOutputSha256: url.searchParams.get('candidateOutputSha256'),
          idempotencyKey: key,
          status: result === null ? 'not_found' : 'committed',
          result,
        })
        return
      }
      const takeCommentPath = `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/take-comments`
      if (request.method === 'GET' && url.pathname === takeCommentPath) {
        if (request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`) {
          throw new Error('Take comment read authorization mismatch')
        }
        json(response, 200, takeCommentFeedFixture(revision, persistedTakeComments))
        return
      }
      if (request.method === 'POST' && url.pathname === takeCommentPath) {
        if (!isRecord(body) || !isRecord(body.anchor)) {
          throw new Error('Take comment body is missing')
        }
        const expectedKeys = [
          'expectedTakeSubjectSha256', 'takeId', 'anchor', 'body', 'idempotencyKey',
        ].sort()
        const bodyKeys = Object.keys(body).sort()
        const anchorKeys = Object.keys(body.anchor).sort()
        const validAnchor = body.anchor.kind === 'timecode'
          ? anchorKeys.length === 2
            && anchorKeys[0] === 'kind'
            && anchorKeys[1] === 'timecodeMillis'
            && Number.isInteger(body.anchor.timecodeMillis)
            && Number(body.anchor.timecodeMillis) >= 0
          : body.anchor.kind === 'frame'
            && anchorKeys.length === 2
            && anchorKeys[0] === 'frameNumber'
            && anchorKeys[1] === 'kind'
            && Number.isInteger(body.anchor.frameNumber)
            && Number(body.anchor.frameNumber) >= 1
        const takeId = body.takeId
        if (takeId !== 'asset-take-1' && takeId !== 'asset-take-2') {
          throw new Error('Take comment takeId mismatch')
        }
        const expectedSubject = takeCommentSubjectFixture(revision, takeId)
        const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
        if (
          bodyKeys.length !== expectedKeys.length
          || bodyKeys.some((field, index) => field !== expectedKeys[index])
          || !validAnchor
          || typeof body.expectedTakeSubjectSha256 !== 'string'
          || body.expectedTakeSubjectSha256 !== jcsSha256(expectedSubject)
          || typeof body.body !== 'string'
          || body.body.trim() === ''
          || key === ''
          || request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`
          || request.headers['idempotency-key'] !== key
        ) {
          throw new Error('Take comment command contract mismatch')
        }
        const input: TakeCommentRequest = {
          projectId: 'project-1',
          episodeId: 'episode-1',
          frameId: PROMPT_IR_FRAME_ID,
          expectedTakeSubjectSha256: body.expectedTakeSubjectSha256,
          takeId,
          anchor: body.anchor as TakeCommentRequest['anchor'],
          body: body.body,
          idempotencyKey: key,
        }
        const replay = persistedTakeCommentReceipts.get(key)
        if (replay !== undefined) {
          json(response, 200, replay)
          return
        }
        const result = takeCommentResultFixture(revision, input, persistedTakeComments.length + 3)
        persistedTakeComments.push(result.comment)
        persistedTakeCommentReceipts.set(key, result)
        json(response, 201, result)
        return
      }
      if (request.method === 'GET' && url.pathname === `${takeCommentPath}/command-receipt`) {
        const queryKeys = [...url.searchParams.keys()].sort()
        const expectedQueryKeys = ['expectedTakeSubjectSha256', 'takeId'].sort()
        const key = typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : ''
        const expectedTakeSubjectSha256 = url.searchParams.get('expectedTakeSubjectSha256') ?? ''
        const takeId = url.searchParams.get('takeId') ?? ''
        if (
          queryKeys.length !== expectedQueryKeys.length
          || queryKeys.some((field, index) => field !== expectedQueryKeys[index])
          || key === ''
          || expectedTakeSubjectSha256 === ''
          || takeId === ''
          || request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`
        ) {
          throw new Error('Take comment recovery contract mismatch')
        }
        const result = persistedTakeCommentReceipts.get(key) ?? null
        json(response, 200, {
          schema: 'jason.qingmu-take-comment-recovery.v1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          frameId: PROMPT_IR_FRAME_ID,
          takeId,
          expectedTakeSubjectSha256,
          idempotencyKey: key,
          status: result === null ? 'not_found' : 'committed',
          result,
        })
        return
      }
      const takeReviewPath = `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/take-review-authority`
      if (request.method === 'GET' && url.pathname === takeReviewPath) {
        if (request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`) {
          throw new Error('Take review authority read authorization mismatch')
        }
        json(response, 200, takeReviewAuthorityFeedFixture(
          revision,
          persistedTakeReviewRecommendations,
          persistedTakeHumanDecisions,
        ))
        return
      }
      if (request.method === 'POST' && (
        url.pathname === `${takeReviewPath}/recommendations`
        || url.pathname === `${takeReviewPath}/decisions`
      )) {
        if (!isRecord(body)) throw new Error('Take review authority body is missing')
        const isRecommendation = url.pathname.endsWith('/recommendations')
        const actionField = isRecommendation ? 'recommendation' : 'decision'
        const expectedKeys = [
          'expectedTakeSubjectSha256', 'takeId', actionField, 'reason', 'idempotencyKey',
        ].sort()
        const bodyKeys = Object.keys(body).sort()
        const takeId = body.takeId
        if (takeId !== 'asset-take-1' && takeId !== 'asset-take-2') {
          throw new Error('Take review authority takeId mismatch')
        }
        const expectedSubjectSha256 = jcsSha256(takeCommentSubjectFixture(revision, takeId))
        const action = body[actionField]
        const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
        if (
          bodyKeys.length !== expectedKeys.length
          || bodyKeys.some((field, index) => field !== expectedKeys[index])
          || body.expectedTakeSubjectSha256 !== expectedSubjectSha256
          || (action !== 'approve' && action !== 'reject' && action !== 'request_changes')
          || typeof body.reason !== 'string'
          || body.reason.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '') === ''
          || key === ''
          || request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`
          || request.headers['idempotency-key'] !== key
        ) {
          throw new Error('Take review authority command contract mismatch')
        }
        if (isRecommendation) {
          const replay = persistedTakeReviewRecommendationReceipts.get(key)
          if (replay !== undefined) {
            json(response, 200, replay)
            return
          }
          const input: YimengCreateTakeReviewRecommendationRequest = {
            projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
            expectedTakeSubjectSha256: expectedSubjectSha256,
            takeId,
            recommendation: action,
            reason: body.reason,
            idempotencyKey: key,
          }
          const result = takeReviewRecommendationResultFixture(
            revision,
            input,
            persistedTakeReviewRecommendations.length + 1,
          )
          persistedTakeReviewRecommendations.push(result)
          persistedTakeReviewRecommendationReceipts.set(key, result)
          json(response, 201, result)
          return
        }
        const replay = persistedTakeHumanDecisionReceipts.get(key)
        if (replay !== undefined) {
          json(response, 200, replay)
          return
        }
        const input: YimengCreateTakeHumanDecisionRequest = {
          projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
          expectedTakeSubjectSha256: expectedSubjectSha256,
          takeId,
          decision: action,
          reason: body.reason,
          idempotencyKey: key,
        }
        const result = takeHumanDecisionResultFixture(
          revision,
          input,
          persistedTakeHumanDecisions.length + 1,
        )
        persistedTakeHumanDecisions.push(result)
        persistedTakeHumanDecisionReceipts.set(key, result)
        json(response, 201, result)
        return
      }
      if (request.method === 'GET' && (
        url.pathname === `${takeReviewPath}/recommendations/command-receipt`
        || url.pathname === `${takeReviewPath}/decisions/command-receipt`
      )) {
        const queryKeys = [...url.searchParams.keys()].sort()
        const expectedQueryKeys = ['expectedTakeSubjectSha256', 'takeId'].sort()
        const key = typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : ''
        const expectedTakeSubjectSha256 = url.searchParams.get('expectedTakeSubjectSha256') ?? ''
        const takeId = url.searchParams.get('takeId') ?? ''
        if (
          queryKeys.length !== expectedQueryKeys.length
          || queryKeys.some((field, index) => field !== expectedQueryKeys[index])
          || key === '' || expectedTakeSubjectSha256 === '' || takeId === ''
          || request.headers.authorization !== `Bearer ${YIMENG_TOKEN}`
        ) {
          throw new Error('Take review authority recovery contract mismatch')
        }
        const isRecommendation = url.pathname.includes('/recommendations/')
        const result = isRecommendation
          ? persistedTakeReviewRecommendationReceipts.get(key) ?? null
          : persistedTakeHumanDecisionReceipts.get(key) ?? null
        json(response, 200, {
          schema: 'jason.qingmu-take-review-command-recovery.v1',
          commandType: isRecommendation
            ? 'qingmu.take_review.recommendation.record.v1'
            : 'qingmu.take_human_decision.record.v1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          frameId: PROMPT_IR_FRAME_ID,
          takeId,
          expectedTakeSubjectSha256,
          idempotencyKey: key,
          status: result === null ? 'not_found' : 'committed',
          result,
        })
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/qingmu/assets/${STORYBOARD_CANVAS_HERO_ASSET_ID}/content`
      ) {
        response.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(STORYBOARD_CANVAS_HERO_PNG.byteLength),
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        })
        response.end(STORYBOARD_CANVAS_HERO_PNG)
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
        const workflow = workflowFixture(
          revision,
          promptIrSelected,
          storyboardRevision,
          `${publicBaseUrl}/api/qingmu/assets/${STORYBOARD_CANVAS_HERO_ASSET_ID}/content`,
          storyboardCanvas,
          continuityMode,
        )
        const promptLineage = workflow.shots.items[0]?.promptLineage
        promptIrWorkflowStatuses.push(promptLineage?.status ?? 'missing')
        json(response, 200, workflow)
        return
      }
      if (request.method === 'GET' && (url.pathname === `/api/frames/${PROMPT_IR_FRAME_ID}/video-candidates`
        || url.pathname === `/api/frames/${SHOT_RIVER_FIRST_FRAME_ID}/video-candidates`)) {
        const frameId = url.pathname.split('/')[3]
        if (frameId === undefined) throw new Error('video fixture frame is missing')
        json(response, 200, selectedVideoReviewFixture(frameId, revision, videoReviewMode))
        return
      }
      if (shotFindings.handle(request, response, url, body, revision)) return
      if (productionUnits.handle(request, response, url, body, revision)) return
      if (stageSources.handle(request, response, url, body, {
        revision, contentSha256: revision === 3 ? INITIAL_SCRIPT_SHA256 : AUTHORITATIVE_SNAPSHOT_SHA,
      })) return
      if (reworkRoutes.handle(request, response, url, body)) return
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
            staleReasonCodes: releaseIsCurrent ? [] : ['subject_binding_drift'],
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

      const storyboardCanvasProposalPath = `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${STORYBOARD_CANVAS_BASE_REVISION.revisionId}/frames/${PROMPT_IR_FRAME_ID}/storyboard-canvas/change-sets`
      if (request.method === 'POST' && url.pathname === storyboardCanvasProposalPath) {
        if (
          storyboardRevision.revisionId !== STORYBOARD_CANVAS_BASE_REVISION.revisionId
          || storyboardCanvas !== null
          || pendingStoryboardCanvasProof !== undefined
        ) {
          throw new Error('storyboard canvas proposal was repeated or started from stale authority')
        }
        const baseProjection = heroFrameStoryboardsFixture(
          revision,
          STORYBOARD_CANVAS_BASE_REVISION,
          `${publicBaseUrl}/api/qingmu/assets/${STORYBOARD_CANVAS_HERO_ASSET_ID}/content`,
          null,
        )
        storyboardCanvasBaseSnapshotSha256 = baseProjection.shotsSha256
        pendingStoryboardCanvasProof = validateStoryboardCanvasProposal(body, baseProjection.shotsSha256)
        json(response, 201, {
          schema: 'jason.qingmu-storyboard-canvas-change-set-proposal.v1',
          changeSet: storyboardCanvasChangeSetFixture(baseProjection.shotsSha256),
          nextAction: 'preview',
        })
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === `/api/qingmu/change-sets/${STORYBOARD_CANVAS_CHANGE_SET_ID}:preview`
      ) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'episodeId',
          'storyboardRevisionId',
          'frameId',
          'targetType',
          'targetId',
          'baseRevision',
          'baseSnapshotSha256',
        ].sort()
        if (
          pendingStoryboardCanvasProof === undefined
          || storyboardCanvasBaseSnapshotSha256 === undefined
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.episodeId !== 'episode-1'
          || command.storyboardRevisionId !== STORYBOARD_CANVAS_BASE_REVISION.revisionId
          || command.frameId !== PROMPT_IR_FRAME_ID
          || command.targetType !== 'storyboard_frame'
          || command.targetId !== PROMPT_IR_FRAME_ID
          || command.baseRevision !== STORYBOARD_CANVAS_BASE_REVISION.revisionVersion
          || command.baseSnapshotSha256 !== storyboardCanvasBaseSnapshotSha256
        ) {
          throw new Error('storyboard canvas preview lineage mismatch')
        }
        json(response, 200, storyboardCanvasPreviewFixture(
          storyboardCanvasBaseSnapshotSha256,
          pendingStoryboardCanvasProof,
        ))
        return
      }
      if (
        request.method === 'POST'
        && url.pathname === `/api/qingmu/change-sets/${STORYBOARD_CANVAS_CHANGE_SET_ID}:commit`
      ) {
        const command = isRecord(body) ? body : {}
        const expectedKeys = [
          'projectId',
          'episodeId',
          'storyboardRevisionId',
          'frameId',
          'targetType',
          'targetId',
          'baseRevision',
          'baseSnapshotSha256',
          'idempotencyKey',
          'expectedPayloadSha256',
        ].sort()
        const expectedIdempotencyKey = `qingmu:storyboard-canvas:commit:v1:${createHash('sha256')
          .update(STORYBOARD_CANVAS_CHANGE_SET_ID, 'utf8')
          .digest('hex')}:${STORYBOARD_CANVAS_PAYLOAD_SHA}`
        if (
          pendingStoryboardCanvasProof === undefined
          || storyboardCanvasBaseSnapshotSha256 === undefined
          || persistedStoryboardCanvasReceipt !== undefined
          || Object.keys(command).sort().some((key, index) => key !== expectedKeys[index])
          || Object.keys(command).length !== expectedKeys.length
          || command.projectId !== 'project-1'
          || command.episodeId !== 'episode-1'
          || command.storyboardRevisionId !== STORYBOARD_CANVAS_BASE_REVISION.revisionId
          || command.frameId !== PROMPT_IR_FRAME_ID
          || command.targetType !== 'storyboard_frame'
          || command.targetId !== PROMPT_IR_FRAME_ID
          || command.baseRevision !== STORYBOARD_CANVAS_BASE_REVISION.revisionVersion
          || command.baseSnapshotSha256 !== storyboardCanvasBaseSnapshotSha256
          || command.idempotencyKey !== expectedIdempotencyKey
          || command.expectedPayloadSha256 !== STORYBOARD_CANVAS_PAYLOAD_SHA
        ) {
          throw new Error('storyboard canvas commit lineage mismatch')
        }
        storyboardRevision = STORYBOARD_CANVAS_AUTHORITATIVE_REVISION
        storyboardCanvas = pendingStoryboardCanvasProof.canvas
        const authoritativeProjection = heroFrameStoryboardsFixture(
          revision,
          storyboardRevision,
          `${publicBaseUrl}/api/qingmu/assets/${STORYBOARD_CANVAS_HERO_ASSET_ID}/content`,
          storyboardCanvas,
        )
        persistedStoryboardCanvasReceipt = storyboardCanvasCommitReceiptFixture(
          pendingStoryboardCanvasProof,
          authoritativeProjection.shotsSha256,
          expectedIdempotencyKey,
        )
        resolveStoryboardCanvasCommitAccepted?.()
        await storyboardCanvasCommitResponseReleased
        if (!response.destroyed && !response.writableEnded) json(response, 200, persistedStoryboardCanvasReceipt)
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `${storyboardCanvasProposalPath}/${STORYBOARD_CANVAS_CHANGE_SET_ID}/command-receipt`
      ) {
        const expectedIdempotencyKey = `qingmu:storyboard-canvas:commit:v1:${createHash('sha256')
          .update(STORYBOARD_CANVAS_CHANGE_SET_ID, 'utf8')
          .digest('hex')}:${STORYBOARD_CANVAS_PAYLOAD_SHA}`
        if (
          persistedStoryboardCanvasReceipt === undefined
          || url.search !== ''
          || request.headers['idempotency-key'] !== expectedIdempotencyKey
        ) {
          json(response, 404, { error: 'storyboard canvas receipt not found' })
          return
        }
        json(response, 200, {
          schema: 'jason.qingmu-command-receipt-recovery.v1',
          recovered: true,
          receiptSha256: canonicalSha256(persistedStoryboardCanvasReceipt),
          receipt: persistedStoryboardCanvasReceipt,
        })
        return
      }

      json(response, 404, { error: 'unexpected isolated route' })
    })().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      if (!response.headersSent) json(response, 500, { error: `isolated double failed: ${detail}` })
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
  publicBaseUrl = `http://127.0.0.1:${String(address.port)}`
  return {
    server,
    baseUrl: publicBaseUrl,
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
    storyboardCanvasCommitAccepted,
    releaseStoryboardCanvasCommitResponse: () => resolveStoryboardCanvasCommitResponse?.(),
    setContinuityMode: (mode) => { continuityMode = mode },
    setVideoReviewMode: (mode) => { videoReviewMode = mode },
    setTakeSelectedId: (takeId: 'asset-take-1' | 'asset-take-2') => { takeSelectedId = takeId },
    shotFindings,
    reworkRoutes,
    productionUnits,
    stageSources,
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

async function selectReloadedElement(dialog: Locator, kind: '环境' | '道具'): Promise<void> {
  const actorEditor = dialog.getByRole('textbox', { name: '人物视觉身份定义' })
  await expect.poll(() => actorEditor.inputValue(), { timeout: 15_000 }).toBe(ACTOR_UPDATED_IDENTITY)
  const kindButton = dialog.getByRole('group', { name: '选择人物、环境或道具' })
    .getByRole('button', { name: kind })
  await kindButton.click()
  await expect.poll(() => kindButton.getAttribute('aria-pressed')).toBe('true')
  await expect.poll(() => dialog.getByRole('combobox', { name: '选择人物、环境或道具' }).inputValue())
    .toBe(kind === '环境' ? 'scene-1' : 'prop-1')
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
    let storyboardCanvasCommitAccepted: Promise<void> | undefined
    let releaseStoryboardCanvasCommitResponse: (() => void) | undefined
    let setContinuityMode: ((mode: ContinuityMode) => void) | undefined
    let setVideoReviewMode: ((mode: VideoReviewMode) => void) | undefined
    let setTakeSelectedId: ((takeId: 'asset-take-1' | 'asset-take-2') => void) | undefined
    let shotFindingDouble: ReturnType<typeof createShotFindingDouble> | undefined
    let reworkRouteDouble: ReturnType<typeof createReworkRouteDouble> | undefined
    let productionUnitDouble: ReturnType<typeof createProductionUnitDouble> | undefined
    let stageSourceDouble: ReturnType<typeof createStageSourceDouble> | undefined
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
    const browserConsoleErrors: Array<{ readonly text: string; readonly location: string }> = []
    const failedBrowserRequests: Array<{
      readonly method: string
      readonly path: string
      readonly errorText: string
    }> = []
    let shotRiverBrowserEvidence: Record<string, unknown> | undefined
    let storyboardCanvasBrowserEvidence: Record<string, unknown> | undefined
    let worksetBrowserEvidence: Record<string, unknown> | undefined
    let continuityBrowserEvidence: Record<string, unknown> | undefined
    let selectedVideoReviewBrowserEvidence: Record<string, unknown> | undefined
    let shotFindingBrowserEvidence: Record<string, unknown> | undefined
    let productionUnitBrowserEvidence: Record<string, unknown> | undefined
    let stageSourceBrowserEvidence: Record<string, unknown> | undefined
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
      storyboardCanvasCommitAccepted = yimeng.storyboardCanvasCommitAccepted
      releaseStoryboardCanvasCommitResponse = yimeng.releaseStoryboardCanvasCommitResponse
      setContinuityMode = yimeng.setContinuityMode
      setVideoReviewMode = yimeng.setVideoReviewMode
      const takeSelectionSetter: unknown = yimeng.setTakeSelectedId
      if (typeof takeSelectionSetter !== 'function') {
        throw new TypeError('Take selection fixture setter is missing')
      }
      setTakeSelectedId = takeSelectionSetter as typeof setTakeSelectedId
      shotFindingDouble = yimeng.shotFindings
      reworkRouteDouble = yimeng.reworkRoutes
      productionUnitDouble = yimeng.productionUnits
      stageSourceDouble = yimeng.stageSources
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
        if (!requestPath.startsWith('/qingmu-imago-method/') && ![
          '/qingmu-yimeng/selectedVideoReview', '/qingmu-yimeng/shotFindings',
          '/qingmu-yimeng-command/recordShotFinding', '/qingmu-yimeng-command/recoverShotFinding',
          '/qingmu-yimeng/reworkRouteSource', '/qingmu-yimeng-command/recordReworkRoute',
          '/qingmu-yimeng-command/recoverReworkRoute', '/qingmu-yimeng-command/probeReworkRouteAuthority',
          '/qingmu-yimeng/productionUnits', '/qingmu-yimeng-command/bindProductionUnit',
          '/qingmu-yimeng-command/recoverProductionUnitBinding',
          '/qingmu-yimeng/stageSources', '/qingmu-yimeng-command/bindStageSource',
          '/qingmu-yimeng-command/recoverStageSourceBinding',
          '/qingmu-yimeng/capabilityCatalog', '/qingmu-yimeng/costRehearsal',
          '/qingmu-yimeng/gateAControlEvidence',
          '/qingmu-yimeng/takeVersions', '/qingmu-yimeng/takeAcceptance',
          '/qingmu-yimeng/takeComments',
          '/qingmu-yimeng-command/selectTakeVersion',
          '/qingmu-yimeng-command/recoverTakeVersionSelection',
          '/qingmu-yimeng-command/createTakeComment',
          '/qingmu-yimeng-command/recoverTakeComment',
          '/qingmu-yimeng/takeReviewAuthority',
          '/qingmu-yimeng-command/createTakeReviewRecommendation',
          '/qingmu-yimeng-command/recoverTakeReviewRecommendation',
          '/qingmu-yimeng-command/createTakeHumanDecision',
          '/qingmu-yimeng-command/recoverTakeHumanDecision',
        ].includes(requestPath)) return
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
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const location = message.location()
        browserConsoleErrors.push({
          text: message.text(),
          location: `${location.url ?? ''}:${String(location.lineNumber ?? 0)}:${String(location.columnNumber ?? 0)}`,
        })
      })
      page.on('requestfailed', (request) => {
        failedBrowserRequests.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          errorText: request.failure()?.errorText ?? 'unknown browser request failure',
        })
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
      releaseStoryboardCanvasCommitResponse?.()
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
                expectedStackSha256: body.expectedStackSha256,
                expectedSelectedTakeId: body.expectedSelectedTakeId,
                candidateTakeId: body.candidateTakeId,
                candidateVersionOrdinal: body.candidateVersionOrdinal,
                candidateOutputSha256: body.candidateOutputSha256,
                expectedTakeSubjectSha256: body.expectedTakeSubjectSha256,
                takeId: body.takeId,
                anchor: body.anchor,
                body: body.body,
                idempotencyKey: body.idempotencyKey,
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
              relation: process.env.QINGMU_E5_1_EVIDENCE_SCREENSHOT,
              relationMethod: process.env.QINGMU_E5_1_METHOD_EVIDENCE_SCREENSHOT,
              shotRiver: process.env.QINGMU_E5_3_EVIDENCE_SCREENSHOT,
              storyboardCanvas: process.env.QINGMU_E5_2_CANVAS_EVIDENCE_SCREENSHOT,
              storyboardCanvasMethod: process.env.QINGMU_E5_2_METHOD_EVIDENCE_SCREENSHOT,
              workset: process.env.QINGMU_E5_4_EVIDENCE_SCREENSHOT,
              worksetMobile: process.env.QINGMU_E5_4_MOBILE_EVIDENCE_SCREENSHOT,
              continuity: process.env.QINGMU_E5_5_EVIDENCE_SCREENSHOT,
              continuityMobile: process.env.QINGMU_E5_5_MOBILE_EVIDENCE_SCREENSHOT,
              selectedVideoReview: process.env.QINGMU_E5_5_VIDEO_REVIEW_SCREENSHOT,
              selectedVideoReviewMobile: process.env.QINGMU_E5_5_VIDEO_REVIEW_MOBILE_SCREENSHOT,
              shotFinding: process.env.QINGMU_E5_5_FINDING_SCREENSHOT,
              shotFindingMobile: process.env.QINGMU_E5_5_FINDING_MOBILE_SCREENSHOT,
              reworkPreparation: process.env.QINGMU_E5_5_REWORK_SCREENSHOT,
              reworkPreparationMobile: process.env.QINGMU_E5_5_REWORK_MOBILE_SCREENSHOT,
              reworkPreparationMobileEnd: process.env.QINGMU_E5_5_REWORK_MOBILE_END_SCREENSHOT,
              productionUnit: process.env.QINGMU_E5_5_PRODUCTION_UNIT_SCREENSHOT,
              productionUnitMobile: process.env.QINGMU_E5_5_PRODUCTION_UNIT_MOBILE_SCREENSHOT,
              productionUnitMobileEnd: process.env.QINGMU_E5_5_PRODUCTION_UNIT_MOBILE_END_SCREENSHOT,
              productionUnitFinding: process.env.QINGMU_E5_5_PRODUCTION_UNIT_FINDING_SCREENSHOT,
              stageSource: process.env.QINGMU_E5_5_STAGE_SOURCE_SCREENSHOT,
              stageSourceMobile: process.env.QINGMU_E5_5_STAGE_SOURCE_MOBILE_SCREENSHOT,
              stageSourceHistorical: process.env.QINGMU_E5_5_STAGE_SOURCE_HISTORICAL_SCREENSHOT,
              costRehearsal: process.env.QINGMU_E6_2_COST_SCREENSHOT,
              gateAControlEvidence: process.env.QINGMU_E6_3_GATE_A_SCREENSHOT,
              takeVersionSelection: process.env.QINGMU_E6_4_TAKE_SCREENSHOT,
              takeComments: process.env.QINGMU_E7_1_TAKE_COMMENT_SCREENSHOT,
              script: process.env.QINGMU_EVIDENCE_SCREENSHOT,
              actor: process.env.QINGMU_ACTOR_EVIDENCE_SCREENSHOT,
              scene: process.env.QINGMU_SCENE_EVIDENCE_SCREENSHOT,
              prop: process.env.QINGMU_ASSET_EVIDENCE_SCREENSHOT,
            },
            shotRiver: shotRiverBrowserEvidence,
            storyboardCanvas: storyboardCanvasBrowserEvidence,
            workset: worksetBrowserEvidence,
            continuity: continuityBrowserEvidence,
            selectedVideoReview: selectedVideoReviewBrowserEvidence,
            shotFinding: shotFindingBrowserEvidence,
            productionUnit: productionUnitBrowserEvidence,
            stageSource: stageSourceBrowserEvidence,
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

    it('renders the E6-1 capability snapshots through real Host composition with zero production authority', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e6-1-capability-catalog'))
      const tracePath = process.env.QINGMU_E6_1_TRACE_PATH?.trim()
      if (tracePath) {
        await mkdir(dirname(tracePath), { recursive: true })
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      }
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const capabilityWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/capabilityCatalog')

      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('tab', { name: '生成与质检' }).click()
      const capabilityWire = await (await capabilityWirePromise).json() as unknown
      const capabilityWireRoot = isRecord(capabilityWire) ? capabilityWire : {}
      const capabilityWireResult = isRecord(capabilityWireRoot.result) ? capabilityWireRoot.result : {}
      if (capabilityWireResult.ok !== true) {
        throw new Error(`capability catalog Host response failed: ${JSON.stringify(capabilityWireResult)}`)
      }
      expect(capabilityWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.provider-capability-catalog.v1',
        productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
        providerCalls: 0,
        databaseWrites: 0,
        paidGenerationAuthorized: false,
      } } })

      const region = dialog.getByRole('region', { name: 'Provider 能力目录 · Gate A', exact: true })
      await region.getByText('Gate A Fake Video', { exact: true }).waitFor({ timeout: 20_000 })
      await region.getByText('fake-first-frame-or-continuation', { exact: true }).waitFor()
      await region.getByText('本次读取回执：Provider 调用 0 · 数据库写入 0 · 付费生成授权 否。', { exact: true }).waitFor()
      await region.locator('summary').click()
      const fixture = capabilityCatalogFixture()
      expect(fixture.items[0].capabilitySnapshotSha256).toBe(
        '069ba53a466a04a33ea8c79b8676c5d9e9b1aba39871385098e360d5f995ae77',
      )
      await region.getByText(fixture.items[0].capabilitySnapshotSha256, { exact: true }).waitFor()
      expect(await region.getByRole('button', { name: '重读能力目录', exact: true }).isEnabled()).toBe(true)

      const upstream = capturedRequests.slice(requestStart)
        .filter(request => request.path.startsWith('/api/providers/capability-catalog'))
      expect(upstream).toEqual([expect.objectContaining({
        method: 'GET',
        path: '/api/providers/capability-catalog',
        authorization: `Bearer ${YIMENG_TOKEN}`,
        body: undefined,
      })])
      expect(capturedRequests.slice(requestStart).filter(request => request.method === 'POST')).toEqual([])
      const capabilityRequests = browserRpcRequests.slice(rpcStart)
        .filter(request => request.path === '/qingmu-yimeng/capabilityCatalog')
      expect(capabilityRequests).toHaveLength(1)
      const capabilityRequest = capabilityRequests[0]
      expect(capabilityRequest?.path).toBe('/qingmu-yimeng/capabilityCatalog')
      if (!isRecord(capabilityRequest?.body)) throw new Error('missing capabilityCatalog client request')
      expect(capabilityRequest.body.type).toBe('client-request')
      expect(capabilityRequest.body.method).toBe('capabilityCatalog')
      expect(capabilityRequest.body.payload).toEqual({})
      expect(typeof capabilityRequest.body.rpcId).toBe('string')

      const aria = await captureStableAria(
        page,
        'role=region[name="Provider 能力目录 · Gate A"]',
        scaffold.workspaceCwd,
      )
      const goldenPath = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-capability-catalog/ui.expected.md')
      if (scaffold.mode === 'refresh') await mkdir(dirname(goldenPath), { recursive: true })
      await compareOrRefreshGolden(goldenPath, aria, scaffold.mode)

      const screenshotPath = process.env.QINGMU_E6_1_CAPABILITY_SCREENSHOT?.trim()
      if (screenshotPath) {
        await mkdir(dirname(screenshotPath), { recursive: true })
        await region.getByRole('heading', { name: 'Provider 能力目录 · Gate A', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: screenshotPath })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      expect((await region.getByRole('button', { name: '重读能力目录', exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44)
      await page.setViewportSize({ width: 1680, height: 1100 })
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      if (tracePath) await page.context().tracing.stop({ path: tracePath })
    })

    it('rehearses E6-2 estimate, proposed hold, and difference with no reservation or Provider authority', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e6-2-cost-rehearsal'))
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E6_2_TRACE_PATH?.trim()
      if (tracePath) {
        await mkdir(dirname(tracePath), { recursive: true })
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      }

      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      const river = dialog.getByRole('list', { name: '镜头选择' })
      await river.getByRole('button', { name: /frame-1/ }).click()
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      const catalogRegion = dialog.getByRole('region', { name: 'Provider 能力目录 · Gate A', exact: true })
      await catalogRegion.getByText('Gate A Fake Video', { exact: true }).waitFor({ timeout: 20_000 })
      const region = dialog.getByRole('region', { name: '费用排练 · Gate A', exact: true })
      await region.getByRole('combobox', { name: '候选数量', exact: true }).selectOption('2')
      expect(capturedRequests.filter(request => request.path.includes('/cost-rehearsal')).length).toBe(0)

      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const exactCatalogWirePromise = page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== '/qingmu-yimeng/capabilityCatalog') return false
        try {
          const body = response.request().postDataJSON() as unknown
          return isRecord(body) && isRecord(body.payload) && body.payload.modelId === 'fake-video-v1'
        } catch {
          return false
        }
      })
      const rehearsalWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/costRehearsal').catch(() => undefined)
      await region.getByRole('button', { name: '仅计算费用排练', exact: true }).click()

      const exactCatalogWire = await (await exactCatalogWirePromise).json() as unknown
      const exactCatalogResult = isRecord(exactCatalogWire) && isRecord(exactCatalogWire.result)
        ? exactCatalogWire.result
        : {}
      if (exactCatalogResult.ok !== true) {
        const upstreamTrace = capturedRequests.slice(requestStart).map(request => ({
          method: request.method,
          path: request.path,
        }))
        const rpcTrace = browserRpcRequests.slice(rpcStart)
        throw new Error(`exact capability catalog Host response failed: ${JSON.stringify({
          wire: exactCatalogWire,
          upstreamTrace,
          rpcTrace,
        })}`)
      }
      expect(exactCatalogWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.provider-capability-catalog.v1',
        request: {
          modelId: 'fake-video-v1', capability: 'video.visual', requestedControls: ['video.visual'], dryRun: true,
        },
        providerCalls: 0, databaseWrites: 0, paidGenerationAuthorized: false,
      } } })
      const rehearsalResponse = await rehearsalWirePromise
      if (rehearsalResponse === undefined) throw new Error('cost rehearsal Host response was not observed')
      const rehearsalWire = await rehearsalResponse.json() as unknown
      expect(rehearsalWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.provider-cost-rehearsal.v1', mode: 'dry_run',
        subject: { projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID, durationMillis: 2500 },
        costEstimate: { candidateCount: 2, maximumCostMicros: 3_000_000, maximumCostCny: '3.000000' },
        reservationRehearsal: {
          status: 'READY_NOT_RESERVED_DRY_RUN', proposedReservationMicros: 3_000_000,
          formallyReservedMicros: 0, formalReservationId: null,
          exactAuthorizationRequired: true, formalReservationAllowed: false,
        },
        difference: {
          estimateToProposedReservationMicros: 0, estimateToFormalReservationMicros: 3_000_000,
          actualCostMicros: null, actualCostStatus: 'UNAVAILABLE_BEFORE_SUBMIT',
        },
        providerCalls: 0, databaseWrites: 0, budgetLedgerWrites: 0,
        taskCreated: false, queueEntered: false, submitAttempted: false, pollAttempted: false,
        downloadAttempted: false, webhookRegistered: false, paidGenerationAuthorized: false,
      } } })

      await expect.poll(() => region.getByText('¥3.000000', { exact: true }).count()).toBe(2)
      await region.getByText('¥0.000000', { exact: true }).waitFor()
      await region.getByText('提交前不可用', { exact: true }).waitFor()
      expect(await region.getByText('未配置', { exact: true }).count()).toBe(2)
      await region.getByText(
        '零权限回执：Provider 调用 0 · 数据库写入 0 · 预算账本写入 0 · 正式预留 0 · 未入队 · 未提交 · 未轮询 · 未下载 · 未注册回调 · 付费授权 否。',
        { exact: true },
      ).waitFor()
      await region.locator('summary').click()
      const fixture = costRehearsalFixture(2)
      await region.getByText(fixture.rehearsalSnapshotSha256, { exact: true }).waitFor()

      const allUpstream = capturedRequests.slice(requestStart)
      expect(allUpstream.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
      const upstream = allUpstream.filter(request =>
        request.path.startsWith('/api/providers/capability-catalog?')
        || request.path.includes('/cost-rehearsal?'))
      expect(upstream).toHaveLength(2)
      const catalogRead = upstream.find(request => request.path.startsWith('/api/providers/capability-catalog?'))
      const rehearsalRead = upstream.find(request => request.path.includes('/cost-rehearsal?'))
      expect(catalogRead).toEqual(expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`, cookie: undefined,
      }))
      expect(rehearsalRead).toEqual(expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`, cookie: undefined,
      }))
      const catalogUrl = new URL(catalogRead?.path ?? '', 'http://127.0.0.1')
      expect(Object.fromEntries(catalogUrl.searchParams)).toEqual({
        model_id: 'fake-video-v1', capability: 'video.visual', requested_control: 'video.visual',
      })
      const rehearsalUrl = new URL(rehearsalRead?.path ?? '', 'http://127.0.0.1')
      expect(rehearsalUrl.pathname).toBe(
        `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/cost-rehearsal`,
      )
      expect(Object.fromEntries(rehearsalUrl.searchParams)).toEqual(expect.objectContaining({
        model_id: 'fake-video-v1', capability: 'video.visual', requested_control: 'video.visual',
        resolution: '720P', candidate_count: '2',
      }))
      for (const key of [
        'catalog_snapshot_sha256', 'request_snapshot_sha256', 'preflight_snapshot_sha256',
        'capability_snapshot_sha256',
      ]) expect(rehearsalUrl.searchParams.get(key)).toMatch(/^[0-9a-f]{64}$/)

      const rpc = browserRpcRequests.slice(rpcStart)
      expect(rpc.map(request => request.path)).toEqual([
        '/qingmu-yimeng/capabilityCatalog', '/qingmu-yimeng/costRehearsal',
      ])
      expect(capturedRequests.slice(requestStart).filter(request => request.method === 'POST')).toEqual([])
      expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)

      const aria = await captureStableAria(
        page,
        'role=region[name="费用排练 · Gate A"]',
        scaffold.workspaceCwd,
      )
      const goldenPath = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-cost-rehearsal/ui.expected.md')
      if (scaffold.mode === 'refresh') await mkdir(dirname(goldenPath), { recursive: true })
      await compareOrRefreshGolden(goldenPath, aria, scaffold.mode)
      const screenshotPath = process.env.QINGMU_E6_2_COST_SCREENSHOT?.trim()
      if (screenshotPath) {
        await mkdir(dirname(screenshotPath), { recursive: true })
        await region.getByRole('heading', { name: '费用排练 · Gate A', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: screenshotPath })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      expect((await region.getByRole('button', { name: '仅计算费用排练', exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44)
      await page.setViewportSize({ width: 1680, height: 1100 })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-z/ }).click()
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      if (tracePath) await page.context().tracing.stop({ path: tracePath })
    })

    it('projects E6-3 offline Gate A recovery evidence without submit, reconcile, or production authority', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e6-3-gate-a-control-evidence'))
      const consoleStart = browserConsoleErrors.length
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const tracePath = process.env.QINGMU_E6_3_TRACE_PATH?.trim()
      if (tracePath) {
        await mkdir(dirname(tracePath), { recursive: true })
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      }
      const evidenceWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/gateAControlEvidence')

      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()

      const evidenceWire = await (await evidenceWirePromise).json() as unknown
      expect(evidenceWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.qingmu-provider-gate-a-control-evidence.v1',
        productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
        gateAStatus: 'PASSED_CONTROL_LOGIC_ONLY',
        mode: 'offline_fault_injection',
        assertions: {
          externalProviderCalls: 0, productionDatabaseWrites: 0, formalBudgetLedgerWrites: 0,
          duplicatePaidSubmissions: 0, unknownAutomaticResubmits: 0,
          maximumAutomaticSubmitAttemptsPerDispatch: 1, networkEgressAttempts: 0,
          truncatedDownloadsAccepted: 0, reconciliationProviderCalls: 0,
          pollRecoveryResubmits: 0, downloadRecoveryResubmits: 0,
        },
        externalProviderCalls: 0, productionDatabaseWrites: 0, formalBudgetLedgerWrites: 0,
        simulatedProviderSubmitAttempts: 6, paidGenerationAuthorized: false, humanSignoffInferred: false,
      } } })

      const region = dialog.getByRole('region', { name: '生成安全控制证据 · Gate A', exact: true })
      await region.getByText('已通过（仅离线故障注入）', { exact: true }).waitFor({ timeout: 20_000 })
      await region.getByText('未验证', { exact: true }).waitFor()
      await region.getByText('8/8', { exact: true }).waitFor()
      for (const label of [
        '未授权请求被拦截', '重复确认不重复提交', '载荷 SHA 冲突失败关闭', '提交未知进入隔离',
        '模拟人工对账与去重', '只恢复轮询，不重提任务', '下载超时后只恢复下载', '截断下载被拒绝',
      ]) await region.getByText(label, { exact: true }).waitFor()
      expect(await region.getByText('0', { exact: true }).count()).toBe(6)
      expect(await region.getByRole('button').allTextContents()).toEqual(['重读控制证据'])
      await region.getByText(
        '此证据只证明 Gate A 控制逻辑。它不授权付费生成，不代表真实 Provider 已验证，也不构成人工签收。',
        { exact: true },
      ).waitFor()
      await region.locator('summary').click()
      const fixture = gateAControlEvidenceFixture()
      expect(fixture.evidenceSnapshotSha256).toBe('3b2f11004b63e172885e9bb374b3ecc8500d0c7b05bf3c2f721bd2748f1b5628')
      await region.getByText(fixture.evidenceSnapshotSha256, { exact: true }).waitFor()
      await region.getByText('scripts/qingmu_gate_a_evidence.py', { exact: true }).waitFor()

      const upstream = capturedRequests.slice(requestStart)
        .filter(request => new URL(request.path, 'http://127.0.0.1').pathname === '/api/qingmu/provider-gate-a/control-evidence')
      expect(upstream).toEqual([expect.objectContaining({
        method: 'GET',
        path: '/api/qingmu/provider-gate-a/control-evidence',
        authorization: `Bearer ${YIMENG_TOKEN}`,
        cookie: undefined,
        body: undefined,
      })])
      expect(capturedRequests.slice(requestStart).filter(request => request.method === 'POST')).toEqual([])
      const rpc = browserRpcRequests.slice(rpcStart)
        .filter(request => request.path === '/qingmu-yimeng/gateAControlEvidence')
      expect(rpc).toHaveLength(1)
      if (!isRecord(rpc[0]?.body)) throw new Error('missing gateAControlEvidence client request')
      expect(rpc[0].body.type).toBe('client-request')
      expect(rpc[0].body.method).toBe('gateAControlEvidence')
      expect(rpc[0].body.payload).toEqual({})
      expect(typeof rpc[0].body.rpcId).toBe('string')
      expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)

      const aria = await captureStableAria(
        page,
        'role=region[name="生成安全控制证据 · Gate A"]',
        scaffold.workspaceCwd,
      )
      const goldenPath = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-gate-a-control-evidence/ui.expected.md')
      if (scaffold.mode === 'refresh') await mkdir(dirname(goldenPath), { recursive: true })
      await compareOrRefreshGolden(goldenPath, aria, scaffold.mode)
      const screenshotPath = process.env.QINGMU_E6_3_GATE_A_SCREENSHOT?.trim()
      if (screenshotPath) {
        await mkdir(dirname(screenshotPath), { recursive: true })
        await region.getByRole('heading', { name: '生成安全控制证据 · Gate A', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: screenshotPath })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      expect((await region.getByRole('button', { name: '重读控制证据', exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44)
      await page.setViewportSize({ width: 1680, height: 1100 })
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      if (tracePath) await page.context().tracing.stop({ path: tracePath })
    })

    it('compares and selects one Take while E6-5 acceptance stays read-only and unverified for paid production', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e6-5-take-acceptance'))
      const consoleStart = browserConsoleErrors.length
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const tracePath = process.env.QINGMU_E6_4_TAKE_TRACE_PATH?.trim()
      if (tracePath) {
        await mkdir(dirname(tracePath), { recursive: true })
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      }

      await page.evaluate(() => {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('qingmu:take-version-selection-recovery:v1:')) sessionStorage.removeItem(key)
        }
      })
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-1/ }).click()
      const firstStackWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/takeVersions')
      const firstAcceptanceWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/takeAcceptance')
      const firstMethodWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/takeAcceptanceMethod')
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      const firstStackWire = await (await firstStackWirePromise).json() as unknown
      expect(firstStackWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.qingmu-take-version-stack.v1',
        subject: {
          projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
          frameNo: 12, storyboardRevision: 3, selectionRevision: 0,
          selectedTakeId: 'asset-take-1',
        },
        capabilities: { canCompare: true, canSelect: true },
        boundaries: {
          takeIdAuthority: 'yimeng.assets.id', versionOrdinalPersistence: false,
          selectedIsApproval: false, formalApprovalChanged: false, providerAuthority: 'not_granted',
        },
      } } })
      const firstAcceptanceWire = await (await firstAcceptanceWirePromise).json() as unknown
      expect(firstAcceptanceWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.qingmu-take-acceptance-evidence.v1',
        productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
        evidence: {
          subject: { takeId: 'asset-take-1', selectionRevision: 0, selectionStatus: 'Selected' },
          providerReceipt: {
            status: 'bounded_local', evidenceMode: 'bounded_local',
            actualProviderReceiptVerified: false, requestDryRun: true,
          },
          technicalReceipt: {
            status: 'PASS', fullVideoDecode: { required: true, status: 'PASS', returncode: 0 },
            video: { actualAverageFrameRate: 24, rFrameRate: '24/1', nominalRFrameRateIsActual: false },
          },
          candidateQuality: { status: 'PASS', failedOrStaleCheckTypes: [] },
        },
        boundaries: {
          readOnly: true, selectedIsApproval: false, providerCalls: 0, databaseWrites: 0,
          paidProviderAuthority: 'not_granted', gateBCompleted: false,
        },
      } } })
      const firstMethodWire = await (await firstMethodWirePromise).json() as unknown
      expect(firstMethodWire).toMatchObject({ result: { ok: true, value: {
        schema: 'qingmu.imago-take-acceptance-method-adapter-result.v1',
        projection: {
          schema: 'qingmu.imago-take-acceptance-method.v1',
          subject: { takeId: 'asset-take-1', selectionRevision: 0 },
          definition: { mode: 'READ_ONLY_STATELESS_PROJECTION' },
          evaluation: {
            technicalReceiptStatus: 'PASS', fullVideoDecodeStatus: 'PASS',
            macroQc: { status: 'PASS' }, microQc: { status: 'PASS' },
            providerReceipt: {
              status: 'bounded_local', evidenceMode: 'bounded_local', actualProviderReceiptVerified: false,
            },
            productionVerificationStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
            formalAcceptanceAllowed: false, selectedIsApproval: false, gateBCompleted: false,
          },
        },
      } } })

      const region = dialog.getByRole('region', { name: 'Take 版本栈与双栏比较', exact: true })
      await region.getByText('Selected ≠ Approval：选择只决定当前 Take，不改变正式审核或人工签收。', {
        exact: true,
      }).waitFor({ timeout: 20_000 })
      expect(await region.getByRole('region', { name: 'Take 双栏比较', exact: true })
        .getByRole('article').count()).toBe(2)
      await region.getByText('5.25s', { exact: true }).waitFor()
      await region.getByText('¥0.000001', { exact: true }).waitFor()
      await region.getByText('identity_continuity', { exact: true }).waitFor()
      const acceptanceRegion = dialog.getByRole('region', { name: '当前已选 Take 的验收证据', exact: true })
      await expect.poll(async () => await acceptanceRegion.locator(':scope > header strong').textContent())
        .toBe('UNVERIFIED_FOR_PAID_PRODUCTION')
      await acceptanceRegion.getByText(
        'UNVERIFIED_FOR_PAID_PRODUCTION · Selected ≠ Approved · Gate B 未完成 · 未推断人工签收',
        { exact: true },
      ).waitFor()
      expect(await acceptanceRegion.getByText('PASS', { exact: true }).count()).toBe(4)
      const providerCard = acceptanceRegion.getByRole('article').filter({ hasText: 'Provider 回执' })
      await expect.poll(async () => await providerCard.locator(':scope > header strong').textContent())
        .toBe('bounded_local')
      await providerCard.getByRole('definition').filter({ hasText: 'bounded_local' }).waitFor()
      await providerCard.getByText('否', { exact: true }).waitFor()
      await acceptanceRegion.getByText('24', { exact: true }).waitFor()
      await acceptanceRegion.getByText('24/1 · 仅标称，不作为实际帧率', { exact: true }).waitFor()
      const acceptanceProof = acceptanceRegion.locator(':scope > details')
      await acceptanceProof.locator('summary').click()
      await acceptanceRegion.getByText('asset-take-1', { exact: true }).waitFor()
      expect(await region.locator('video, audio, img, iframe, source, a[href]').count()).toBe(0)
      expect(await region.getByRole('button', { name: /^(批准|要求返修)$/ }).count()).toBe(0)
      for (const detail of await region.locator('article details').all()) await detail.locator('summary').click()
      await region.getByText('provider-task-1', { exact: true }).waitFor()
      await region.getByText('provider-task-2', { exact: true }).waitFor()
      await region.getByText('wan2.1-i2v-plus', { exact: true }).first().waitFor()
      await region.getByText('4'.repeat(64), { exact: true }).waitFor()

      const selectionWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/selectTakeVersion')
      const secondAcceptanceWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/takeAcceptance')
      const secondMethodWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/takeAcceptanceMethod')
      await region.getByRole('button', { name: '选择为当前 Take（不等于批准）', exact: true }).click()
      const selectionWire = await (await selectionWirePromise).json() as unknown
      expect(selectionWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.qingmu-take-selection-result.v1',
        eventType: 'TakeVersionSelected',
        projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
        selectedTake: { takeId: 'asset-take-2', versionOrdinal: 2, outputSha256: '4'.repeat(64) },
        selectionIdentity: {
          actorUserId: 'owner-1', actorNaturalPersonId: 'owner-natural-person-1',
          actorRole: 'project_owner_selector',
        },
        authoritativeStack: { selectedTakeId: 'asset-take-2', selectionRevision: 1 },
        taskMutation: { created: true, kind: 'local_selection_provenance' },
        selectionChanged: true, providerCalls: 0, paidProviderAuthority: 'not_granted',
        budgetMutation: false, humanApprovalInferred: false, formalApprovalChanged: false,
      } } })
      await region.getByText('已选择当前 Take，并已开始权威回读；这不等于批准。', { exact: true }).waitFor()
      await region.getByRole('button', { name: 'v2 · 当前已选', exact: true }).waitFor()
      await region.getByText(/易梦选择回执/).waitFor()
      const secondAcceptanceWire = await (await secondAcceptanceWirePromise).json() as unknown
      expect(secondAcceptanceWire).toMatchObject({ result: { ok: true, value: {
        productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
        evidence: {
          subject: { takeId: 'asset-take-2', selectionRevision: 1, selectionStatus: 'Selected' },
          providerReceipt: {
            status: 'bounded_local', evidenceMode: 'bounded_local', actualProviderReceiptVerified: false,
          },
          technicalReceipt: { status: 'PASS', fullVideoDecode: { status: 'PASS' } },
          candidateQuality: { status: 'BLOCKED', failedOrStaleCheckTypes: ['creative_director_execution'] },
        },
      } } })
      const secondMethodWire = await (await secondMethodWirePromise).json() as unknown
      expect(secondMethodWire).toMatchObject({ result: { ok: true, value: { projection: {
        subject: { takeId: 'asset-take-2', selectionRevision: 1 },
        evaluation: {
          technicalReceiptStatus: 'PASS', fullVideoDecodeStatus: 'PASS',
          macroQc: { status: 'BLOCKED' }, microQc: { status: 'PASS' },
          providerReceipt: {
            status: 'bounded_local', evidenceMode: 'bounded_local', actualProviderReceiptVerified: false,
          },
          localControlStatus: 'BLOCKED',
          productionVerificationStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
          formalAcceptanceAllowed: false, selectedIsApproval: false, gateBCompleted: false,
        },
      } } } })
      await expect.poll(async () => await acceptanceRegion.getByText('BLOCKED', { exact: true }).count()).toBe(1)
      expect(await acceptanceRegion.getByText('PASS', { exact: true }).count()).toBe(3)
      if ((await acceptanceProof.getAttribute('open')) === null) await acceptanceProof.locator('summary').click()
      await acceptanceRegion.getByText('asset-take-2', { exact: true }).waitFor()
      await expect.poll(async () => await providerCard.locator(':scope > header strong').textContent())
        .toBe('bounded_local')
      await providerCard.getByText('否', { exact: true }).waitFor()

      const takePath = `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/take-versions`
      await expect.poll(() => capturedRequests.slice(requestStart)
        .filter(request => new URL(request.path, 'http://127.0.0.1').pathname.startsWith(takePath)).length)
        .toBe(9)
      const upstream = capturedRequests.slice(requestStart)
        .filter(request => new URL(request.path, 'http://127.0.0.1').pathname.startsWith(takePath))
      const stackReads = upstream.filter(request => request.method === 'GET'
        && new URL(request.path, 'http://127.0.0.1').pathname === takePath)
      const acceptanceReads = upstream.filter(request => request.method === 'GET'
        && new URL(request.path, 'http://127.0.0.1').pathname === `${takePath}/acceptance`)
      const selectionPosts = upstream.filter(request => request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === `${takePath}/selection`)
      expect(stackReads).toHaveLength(2)
      expect(acceptanceReads).toHaveLength(6)
      expect(selectionPosts).toHaveLength(1)
      const selectionPost = selectionPosts[0]
      expect(selectionPost).toEqual(expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`, cookie: undefined,
      }))
      expect(selectionPost?.idempotencyKey).toMatch(/^qingmu:take-select:v1:/)
      if (!isRecord(selectionPost?.body)) throw new Error('Take selection POST body missing')
      expect(Object.keys(selectionPost.body).sort()).toEqual([
        'expectedStackSha256', 'expectedSelectedTakeId', 'candidateTakeId',
        'candidateVersionOrdinal', 'candidateOutputSha256', 'idempotencyKey',
      ].sort())
      expect(selectionPost.body).toMatchObject({
        expectedSelectedTakeId: 'asset-take-1', candidateTakeId: 'asset-take-2',
        candidateVersionOrdinal: 2, candidateOutputSha256: '4'.repeat(64),
      })
      expect(selectionPost.body.expectedStackSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(selectionPost.body.idempotencyKey).toBe(selectionPost.idempotencyKey)
      expect(JSON.stringify(selectionPost.body)).not.toMatch(/actor|session|approv|provider|budget/i)
      expect(upstream.filter(request => request.path.includes('selection-command-receipt'))).toEqual([])

      const rpc = browserRpcRequests.slice(rpcStart)
        .filter(request => /takeVersions|takeAcceptance|selectTakeVersion|recoverTakeVersionSelection/.test(request.path))
      expect(rpc.filter(request => request.path === '/qingmu-yimeng/takeVersions')).toHaveLength(2)
      expect(rpc.filter(request => request.path === '/qingmu-yimeng/takeAcceptance')).toHaveLength(2)
      expect(rpc.filter(request => request.path === '/qingmu-imago-method/takeAcceptanceMethod')).toHaveLength(2)
      expect(rpc.filter(request => request.path === '/qingmu-yimeng-command/selectTakeVersion')).toHaveLength(1)
      expect(rpc.filter(request => request.path === '/qingmu-yimeng-command/recoverTakeVersionSelection')).toHaveLength(0)
      for (const readRpc of rpc.filter(request => /takeVersions|takeAcceptance/.test(request.path))) {
        if (!isRecord(readRpc.body) || !isRecord(readRpc.body.payload)) {
          throw new Error('Take read browser request missing')
        }
        expect(readRpc.body.payload).toEqual({
          projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
        })
      }
      const commandRpc = rpc.find(request => request.path === '/qingmu-yimeng-command/selectTakeVersion')
      if (!isRecord(commandRpc?.body) || !isRecord(commandRpc.body.payload)) {
        throw new Error('Take selection browser command missing')
      }
      expect(Object.keys(commandRpc.body.payload).sort()).toEqual([
        'projectId', 'episodeId', 'frameId', 'expectedStackSha256', 'expectedSelectedTakeId',
        'candidateTakeId', 'candidateVersionOrdinal', 'candidateOutputSha256', 'idempotencyKey',
      ].sort())
      expect(JSON.stringify(commandRpc)).not.toMatch(/owner-natural-person|authSession|Bearer|approval/i)
      expect(capturedRequests.slice(requestStart)
        .filter(request => request.method === 'POST' && request !== selectionPost)).toEqual([])
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:take-version-selection-recovery:v1:')))).toEqual([])
      expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)

      const aria = await captureStableAria(
        page,
        'role=region[name="Take 版本栈与双栏比较"]',
        scaffold.workspaceCwd,
      )
      const goldenPath = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-take-version-select/ui.expected.md')
      if (scaffold.mode === 'refresh') await mkdir(dirname(goldenPath), { recursive: true })
      await compareOrRefreshGolden(goldenPath, aria, scaffold.mode)
      const screenshotPath = process.env.QINGMU_E6_4_TAKE_SCREENSHOT?.trim()
      if (screenshotPath) {
        await mkdir(dirname(screenshotPath), { recursive: true })
        await region.getByRole('heading', { name: 'Take 版本栈与双栏比较', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: screenshotPath })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      expect((await region.getByRole('button', { name: '重读 Take 与验收证据', exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44)
      expect((await region.getByRole('button', { name: '选择为当前 Take（不等于批准）', exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44)
      await page.setViewportSize({ width: 844, height: 390 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      await page.setViewportSize({ width: 1680, height: 1100 })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-z/ }).click()
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      if (tracePath) await page.context().tracing.stop({ path: tracePath })
    })

    it('adds and recovers one E7-1 ordinary Take comment without changing any review authority', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e7-1-take-comment'))
      if (setTakeSelectedId === undefined) throw new Error('Take selection fixture control is missing')
      const tracePath = process.env.QINGMU_E7_1_TAKE_COMMENT_TRACE_PATH?.trim()
      if (tracePath) {
        await mkdir(dirname(tracePath), { recursive: true })
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      }
      setTakeSelectedId('asset-take-2')
      const consoleStart = browserConsoleErrors.length
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const markerStorageKey = [
        'qingmu:take-comment-recovery:v1', 'project-1', 'episode-1', PROMPT_IR_FRAME_ID,
      ].map(encodeURIComponent).join(':')
      await page.setViewportSize({ width: 1680, height: 1100 })
      await page.evaluate((key) => { sessionStorage.removeItem(key) }, markerStorageKey)

      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-1/ }).click()
      const feedWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/takeComments')
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      const feedWire = await (await feedWirePromise).json() as {
        result: { ok: boolean; value: TakeCommentFeed }
      }
      expect(feedWire.result.ok).toBe(true)
      const feed = feedWire.result.value
      expect(Object.keys(feed).sort()).toEqual([
        'schema', 'projectId', 'episodeId', 'frameId', 'versions', 'capabilities', 'comments',
      ].sort())
      expect(feed).toMatchObject({
        schema: 'jason.qingmu-take-comment-feed.v1',
        projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
        capabilities: { canComment: true },
      })
      expect(feed.versions).toHaveLength(2)
      for (const version of feed.versions) {
        expect(Object.keys(version.takeSubject).sort()).toEqual([
          'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
          'frameContentSha256', 'takeId', 'versionOrdinal', 'outputSha256', 'durationMillis',
        ].sort())
        expect(version.takeSubjectSha256).toBe(jcsSha256(version.takeSubject))
      }
      expect(JSON.stringify(feed)).not.toMatch(
        /selectedTakeId|selectionRevision|selectionStatus|isSelected|findings|decisions|approvals/iu,
      )

      const comments = dialog.getByRole('region', { name: '普通评论', exact: true })
      await comments.getByText('当前 Take 的眼神应在这一拍落到左侧角色。', { exact: true })
        .waitFor({ timeout: 20_000 })
      await comments.getByText('上一版第 36 帧构图需要调整。', { exact: true }).waitFor()
      expect(await comments.getByText('当前绑定', { exact: true }).count()).toBeGreaterThanOrEqual(1)
      expect(await comments.getByText('历史', { exact: true }).count()).toBeGreaterThanOrEqual(1)
      expect(await comments.locator('video, audio, iframe, source, track').count()).toBe(0)
      expect(await comments.getByRole('button', { name: /批准|approve|技术\s*pass/iu }).count()).toBe(0)
      expect(await comments.getByText(/^PASS$/iu).count()).toBe(0)

      const versionSelector = comments.getByRole('combobox', { name: 'Take 版本', exact: true })
      expect(await versionSelector.inputValue()).toBe('asset-take-2')
      await versionSelector.selectOption('asset-take-1')
      expect(await versionSelector.inputValue()).toBe('asset-take-1')
      await versionSelector.selectOption('asset-take-2')
      await comments.getByRole('radio', { name: '帧号', exact: true }).click()
      await comments.getByLabel('帧号', { exact: true }).fill('48')
      await comments.getByLabel('评论内容', { exact: true }).fill('第 48 帧右侧留白需要略微收紧。')
      const createWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/createTakeComment')
      await comments.getByRole('button', { name: '提交评论', exact: true }).click()
      const createWire = await (await createWirePromise).json() as {
        result: { ok: boolean; value: TakeCommentResult }
      }
      expect(createWire.result.ok).toBe(true)
      const result = createWire.result.value
      expect(Object.keys(result).sort()).toEqual([
        'schema', 'comment', 'changed', 'selectionChanged', 'technicalPassChanged',
        'formalApprovalChanged', 'episodeVerificationChanged', 'humanSignoffInferred',
        'providerCalls', 'budgetMutation',
      ].sort())
      expect(result).toMatchObject({
        schema: 'jason.qingmu-take-comment-result.v1',
        changed: false,
        selectionChanged: false,
        technicalPassChanged: false,
        formalApprovalChanged: false,
        episodeVerificationChanged: false,
        humanSignoffInferred: false,
        providerCalls: 0,
        budgetMutation: false,
        comment: {
          takeId: 'asset-take-2', versionOrdinalAtComment: 2,
          outputSha256: '4'.repeat(64), actorRole: 'commenter',
          anchor: { kind: 'frame', frameNumber: 48 },
          body: '第 48 帧右侧留白需要略微收紧。',
        },
      })
      expect(result).not.toHaveProperty('idempotencyKey')
      await comments.getByText('评论已提交', { exact: true }).waitFor()
      await comments.getByText('第 48 帧右侧留白需要略微收紧。', { exact: true }).waitFor()

      const commentPath = `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/take-comments`
      await expect.poll(() => capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === commentPath).length).toBe(1)
      const commentPost = capturedRequests.slice(requestStart).find(request =>
        request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === commentPath)
      if (!isRecord(commentPost?.body)) throw new Error('Take comment POST body missing')
      expect(commentPost).toEqual(expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`, cookie: undefined,
      }))
      expect(commentPost.idempotencyKey).toMatch(/^qingmu:take-comment:v1:[0-9a-f]{64}$/u)
      expect(Object.keys(commentPost.body).sort()).toEqual([
        'expectedTakeSubjectSha256', 'takeId', 'anchor', 'body', 'idempotencyKey',
      ].sort())
      expect(commentPost.body).toEqual({
        expectedTakeSubjectSha256: jcsSha256(takeCommentSubjectFixture(3, 'asset-take-2')),
        takeId: 'asset-take-2',
        anchor: { kind: 'frame', frameNumber: 48 },
        body: '第 48 帧右侧留白需要略微收紧。',
        idempotencyKey: commentPost.idempotencyKey,
      })
      expect(JSON.stringify(commentPost.body)).not.toMatch(
        /projectId|episodeId|frameId|selection|technical|approv|verification|signoff|provider|budget/iu,
      )

      const marker = {
        schema: 'qingmu.take-comment-recovery-marker.v1',
        projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
        ...commentPost.body,
      }
      await page.evaluate(({ key, value }) => {
        sessionStorage.setItem(key, JSON.stringify(value))
      }, { key: markerStorageKey, value: marker })
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      const recoveryWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/recoverTakeComment')
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      const recoveryWire = await (await recoveryWirePromise).json() as {
        result: { ok: boolean; value: { status: string; result: TakeCommentResult | null } }
      }
      expect(recoveryWire).toMatchObject({ result: { ok: true, value: {
        schema: 'jason.qingmu-take-comment-recovery.v1',
        projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
        takeId: 'asset-take-2',
        expectedTakeSubjectSha256: commentPost.body.expectedTakeSubjectSha256,
        idempotencyKey: commentPost.idempotencyKey,
        status: 'committed',
        result,
      } } })
      const recoveredComments = dialog.getByRole('region', { name: '普通评论', exact: true })
      await recoveredComments.getByText('评论已提交', { exact: true }).waitFor()
      expect(await page.evaluate(key => sessionStorage.getItem(key), markerStorageKey)).toBeNull()
      const screenshotPath = process.env.QINGMU_E7_1_TAKE_COMMENT_SCREENSHOT?.trim()
      if (screenshotPath) {
        await mkdir(dirname(screenshotPath), { recursive: true })
        await recoveredComments.getByText('第 48 帧右侧留白需要略微收紧。', { exact: true })
          .scrollIntoViewIfNeeded()
        await page.screenshot({ path: screenshotPath })
      }

      const upstream = capturedRequests.slice(requestStart).filter(request =>
        new URL(request.path, 'http://127.0.0.1').pathname.startsWith(commentPath))
      const commentReads = upstream.filter(request => request.method === 'GET'
        && new URL(request.path, 'http://127.0.0.1').pathname === commentPath)
      const commentPosts = upstream.filter(request => request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === commentPath)
      const recoveryReads = upstream.filter(request => request.method === 'GET'
        && new URL(request.path, 'http://127.0.0.1').pathname === `${commentPath}/command-receipt`)
      expect(commentReads).toHaveLength(4)
      expect(commentPosts).toHaveLength(1)
      expect(recoveryReads).toHaveLength(1)
      const recoveryRead = recoveryReads[0]
      expect(recoveryRead).toEqual(expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`,
        idempotencyKey: commentPost.idempotencyKey,
        body: undefined,
        cookie: undefined,
      }))
      const recoveryUrl = new URL(recoveryRead?.path ?? '', 'http://127.0.0.1')
      expect([...recoveryUrl.searchParams.keys()].sort()).toEqual([
        'expectedTakeSubjectSha256', 'takeId',
      ])
      expect(recoveryUrl.searchParams.get('expectedTakeSubjectSha256'))
        .toBe(commentPost.body.expectedTakeSubjectSha256)
      expect(recoveryUrl.searchParams.get('takeId')).toBe('asset-take-2')

      const rpc = browserRpcRequests.slice(rpcStart).filter(request =>
        /takeComments|createTakeComment|recoverTakeComment/.test(request.path))
      expect(rpc.filter(request => request.path === '/qingmu-yimeng/takeComments')).toHaveLength(4)
      expect(rpc.filter(request => request.path === '/qingmu-yimeng-command/createTakeComment')).toHaveLength(1)
      expect(rpc.filter(request => request.path === '/qingmu-yimeng-command/recoverTakeComment')).toHaveLength(1)
      const commandRpc = rpc.find(request => request.path === '/qingmu-yimeng-command/createTakeComment')
      const recoveryRpc = rpc.find(request => request.path === '/qingmu-yimeng-command/recoverTakeComment')
      if (!isRecord(commandRpc?.body) || !isRecord(commandRpc.body.payload)
        || !isRecord(recoveryRpc?.body) || !isRecord(recoveryRpc.body.payload)) {
        throw new Error('Take comment browser request missing')
      }
      expect(commandRpc.body.payload).toEqual(recoveryRpc.body.payload)
      expect(Object.keys(commandRpc.body.payload).sort()).toEqual([
        'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
        'takeId', 'anchor', 'body', 'idempotencyKey',
      ].sort())
      expect(JSON.stringify([commandRpc, recoveryRpc])).not.toMatch(
        /Bearer|authSession|actorId|actorRole|approval/iu,
      )
      expect(capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname.endsWith('/take-versions/selection')))
        .toEqual([])
      expect(capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST' && /approval|technical-pass|episode-verification|signoff/iu.test(request.path)))
        .toEqual([])
      expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)

      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      expect(await recoveredComments.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      expect((await recoveredComments.getByRole('button', { name: '提交评论', exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44)
      await page.setViewportSize({ width: 1680, height: 1100 })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-z/ }).click()
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      if (tracePath) await page.context().tracing.stop({ path: tracePath })
    })

    it('keeps E7-2 Reviewer advice and Approver decisions separate through the real Host', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e7-2-take-review-authority'))
      if (setTakeSelectedId === undefined) throw new Error('Take selection fixture control is missing')
      setTakeSelectedId('asset-take-1')
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const recommendationMarkerKey = [
        'qingmu:take-review-recommendation-recovery:v1',
        'project-1', 'episode-1', PROMPT_IR_FRAME_ID,
      ].map(encodeURIComponent).join(':')
      const decisionMarkerKey = [
        'qingmu:take-human-decision-recovery:v1',
        'project-1', 'episode-1', PROMPT_IR_FRAME_ID,
      ].map(encodeURIComponent).join(':')
      await page.evaluate(({ recommendationKey, decisionKey }) => {
        sessionStorage.removeItem(recommendationKey)
        sessionStorage.removeItem(decisionKey)
      }, { recommendationKey: recommendationMarkerKey, decisionKey: decisionMarkerKey })

      await page.setViewportSize({ width: 1680, height: 1100 })
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-1/ }).click()
      const initialFeedWire = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng/takeReviewAuthority')
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      expect((await (await initialFeedWire).json() as { result: { ok: boolean } }).result.ok).toBe(true)

      const reviewer = dialog.getByRole('region', { name: 'Reviewer 建议（非批准）', exact: true })
      const approver = dialog.getByRole('region', { name: 'Approver 决定', exact: true })
      await reviewer.getByText('Reviewer 建议历史', { exact: true }).waitFor({ timeout: 20_000 })
      const reviewerTake = reviewer.getByRole('combobox', { name: '精确 Take 版本', exact: true })
      const approverTake = approver.getByRole('combobox', { name: '精确 Take 版本', exact: true })
      expect(await reviewerTake.inputValue()).toBe('asset-take-1')
      expect(await approverTake.inputValue()).toBe('asset-take-1')
      await reviewerTake.selectOption('asset-take-2')
      expect(await reviewerTake.inputValue()).toBe('asset-take-2')
      expect(await approverTake.inputValue()).toBe('asset-take-1')

      await reviewer.getByLabel('理由', { exact: true }).fill('第二版表演节奏更完整，建议要求返修。')
      const recommendationWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/createTakeReviewRecommendation')
      await reviewer.getByRole('button', { name: '提交 Reviewer 建议（非批准）', exact: true }).click()
      const recommendationWire = await (await recommendationWirePromise).json() as {
        result: { ok: boolean; value: YimengTakeReviewRecommendationResult }
      }
      expect(recommendationWire.result).toMatchObject({
        ok: true,
        value: {
          schema: 'jason.qingmu-take-review-recommendation-result.v1',
          decisionRecorded: false,
          recommendationOnly: true,
          changed: false,
          formalApprovalChanged: false,
          recommendation: {
            takeSubject: { takeId: 'asset-take-2' },
            actorRole: 'reviewer',
            actorNaturalPersonId: 'person-reviewer',
          },
        },
      })
      await reviewer.getByText('Reviewer 建议已记录；正式批准状态未改变。', { exact: true }).waitFor()

      await approver.getByLabel('理由', { exact: true }).fill('第一版精确 Take 可以记录正式通过决定。')
      const decisionWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/createTakeHumanDecision')
      await approver.getByRole('button', { name: '记录 Approver 正式决定', exact: true }).click()
      const decisionWire = await (await decisionWirePromise).json() as {
        result: { ok: boolean; value: YimengTakeHumanDecisionResult }
      }
      expect(decisionWire.result).toMatchObject({
        ok: true,
        value: {
          schema: 'jason.qingmu-take-human-decision-result.v1',
          decisionRecorded: true,
          recommendationOnly: false,
          changed: false,
          formalApprovalChanged: false,
          decision: {
            subjectId: 'asset-take-1',
            actorRole: 'approver',
            actorNaturalPersonId: 'person-approver',
            producerNaturalPersonId: 'person-producer',
            participantNaturalPersonIds: ['person-editor', 'person-producer'],
          },
        },
      })
      await approver.getByText('Approver 正式决定事件已记录；Take 状态未被修改。', { exact: true }).waitFor()
      await reviewer.getByText('操作自然人: person-reviewer', { exact: true }).waitFor()
      await approver.getByText('操作自然人: person-approver', { exact: true }).waitFor()
      await approver.getByText(/生成请求自然人: person-producer · 自然人独立校验通过/u).waitFor()

      const takeReviewPath = `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/take-review-authority`
      const recommendationPosts = capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === `${takeReviewPath}/recommendations`)
      const decisionPosts = capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === `${takeReviewPath}/decisions`)
      expect(recommendationPosts).toHaveLength(1)
      expect(decisionPosts).toHaveLength(1)
      const recommendationPost = recommendationPosts[0]
      const decisionPost = decisionPosts[0]
      if (!isRecord(recommendationPost?.body) || !isRecord(decisionPost?.body)) {
        throw new Error('Take review authority POST bodies missing')
      }
      expect(Object.keys(recommendationPost.body).sort()).toEqual([
        'expectedTakeSubjectSha256', 'takeId', 'recommendation', 'reason', 'idempotencyKey',
      ].sort())
      expect(Object.keys(decisionPost.body).sort()).toEqual([
        'expectedTakeSubjectSha256', 'takeId', 'decision', 'reason', 'idempotencyKey',
      ].sort())
      for (const post of [recommendationPost, decisionPost]) {
        expect(post).toEqual(expect.objectContaining({
          authorization: `Bearer ${YIMENG_TOKEN}`,
          cookie: undefined,
        }))
      }
      expect(JSON.stringify([recommendationPost.body, decisionPost.body])).not.toMatch(
        /actor|role|person|session|recommendedAt|decidedAt/iu,
      )

      const unresolvedDecision = {
        schema: 'qingmu.take-human-decision-recovery-marker.v1',
        projectId: 'project-1', episodeId: 'episode-1', frameId: PROMPT_IR_FRAME_ID,
        expectedTakeSubjectSha256: jcsSha256(takeCommentSubjectFixture(3, 'asset-take-2')),
        takeId: 'asset-take-2',
        decision: 'reject',
        reason: '原始未决正式拒绝。',
        idempotencyKey: `qingmu:take-human-decision:v1:${'d'.repeat(64)}`,
      }
      await page.evaluate(({ key, marker }) => {
        sessionStorage.setItem(key, JSON.stringify(marker))
      }, { key: decisionMarkerKey, marker: unresolvedDecision })
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      const recoveryWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/recoverTakeHumanDecision')
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      const recoveryWire = await (await recoveryWirePromise).json() as {
        result: {
          ok: boolean
          value: {
            status: string
            takeId: string
            expectedTakeSubjectSha256: string
            idempotencyKey: string
          }
        }
      }
      expect(recoveryWire.result.ok).toBe(true)
      expect(recoveryWire.result.value.status).toBe('not_found')
      expect(recoveryWire.result.value.takeId).toBe('asset-take-2')
      expect(recoveryWire.result.value.expectedTakeSubjectSha256)
        .toBe(unresolvedDecision.expectedTakeSubjectSha256)
      expect(recoveryWire.result.value.idempotencyKey).toBe(unresolvedDecision.idempotencyKey)

      const recoveredReviewer = dialog.getByRole('region', {
        name: 'Reviewer 建议（非批准）', exact: true,
      })
      const recoveredApprover = dialog.getByRole('region', { name: 'Approver 决定', exact: true })
      await recoveredApprover.getByText(/已锁定原坐标，只允许回执恢复/u).waitFor()
      expect(await recoveredApprover.getByRole('button', {
        name: '记录 Approver 正式决定', exact: true,
      }).isDisabled()).toBe(true)
      expect(await recoveredReviewer.getByRole('button', {
        name: '提交 Reviewer 建议（非批准）', exact: true,
      }).isDisabled()).toBe(false)
      await recoveredReviewer.getByRole('combobox', {
        name: '精确 Take 版本', exact: true,
      }).selectOption('asset-take-2')
      expect(await recoveredReviewer.getByRole('combobox', {
        name: '精确 Take 版本', exact: true,
      }).inputValue()).toBe('asset-take-2')
      await recoveredApprover.getByRole('form', { name: 'Approver 正式决定表单', exact: true })
        .evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
      expect(capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST'
        && new URL(request.path, 'http://127.0.0.1').pathname === `${takeReviewPath}/decisions`))
        .toHaveLength(1)
      expect(await page.evaluate(key => sessionStorage.getItem(key), decisionMarkerKey)).not.toBeNull()
      expect(await page.evaluate(key => sessionStorage.getItem(key), recommendationMarkerKey)).toBeNull()

      const recoveryReads = capturedRequests.slice(requestStart).filter(request =>
        request.method === 'GET'
        && new URL(request.path, 'http://127.0.0.1').pathname
          === `${takeReviewPath}/decisions/command-receipt`)
      expect(recoveryReads).toHaveLength(1)
      const recoveryRead = recoveryReads[0]
      expect(recoveryRead).toEqual(expect.objectContaining({
        authorization: `Bearer ${YIMENG_TOKEN}`,
        idempotencyKey: unresolvedDecision.idempotencyKey,
        body: undefined,
        cookie: undefined,
      }))
      const recoveryUrl = new URL(recoveryRead?.path ?? '', 'http://127.0.0.1')
      expect([...recoveryUrl.searchParams.keys()].sort()).toEqual([
        'expectedTakeSubjectSha256', 'takeId',
      ])
      expect(recoveryUrl.searchParams.get('expectedTakeSubjectSha256'))
        .toBe(unresolvedDecision.expectedTakeSubjectSha256)
      expect(recoveryUrl.searchParams.get('takeId')).toBe('asset-take-2')

      const rpc = browserRpcRequests.slice(rpcStart).filter(request =>
        /takeReviewAuthority|TakeReviewRecommendation|TakeHumanDecision/u.test(request.path))
      expect(rpc.filter(request =>
        request.path === '/qingmu-yimeng-command/createTakeReviewRecommendation')).toHaveLength(1)
      expect(rpc.filter(request =>
        request.path === '/qingmu-yimeng-command/createTakeHumanDecision')).toHaveLength(1)
      expect(rpc.filter(request =>
        request.path === '/qingmu-yimeng-command/recoverTakeHumanDecision')).toHaveLength(1)
      expect(JSON.stringify(rpc)).not.toMatch(/Bearer|actorId|actorRole|actorNaturalPersonId|authSessionId/iu)
      expect(capturedRequests.slice(requestStart).filter(request =>
        request.method === 'POST'
        && /selection|technical-pass|episode-verification|signoff|provider|budget/iu.test(request.path)))
        .toEqual([])
      expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)

      await dialog.getByRole('tab', { name: '分镜与镜头', exact: true }).click()
      await dialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-z/ }).click()
      await dialog.getByRole('tab', { name: '总览', exact: true }).click()
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      await page.evaluate((key) => { sessionStorage.removeItem(key) }, decisionMarkerKey)
    })

    it('compiles the E5-4 read-only workset through the real Host and Core without inventing stage authority', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e5-4-workset'))
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E5_4_TRACE_PATH?.trim()
      if (tracePath !== undefined && tracePath !== '') {
        await page.context().tracing.start({ screenshots: true, snapshots: true })
      }
      const worksetWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/worksetMethod')
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const workset = dialog.getByRole('region', { name: '推荐下一步' })
      await workset.getByText('阶段与 LSU 权威证据尚未接入，暂不推荐生产任务。', { exact: true }).waitFor({ timeout: 20_000 })
      const wire = await (await worksetWirePromise).json() as unknown
      const root = isRecord(wire) ? wire : {}
      const result = isRecord(root.result) ? root.result : {}
      const value = isRecord(result.value) ? result.value : {}
      const projection = isRecord(value.projection) ? value.projection : {}
      expect(result.ok).toBe(true)
      expect(value.schema).toBe('qingmu.imago-workset-method-adapter-result.v1')
      expect(projection).toEqual(expect.objectContaining({
        schema: 'qingmu.imago-workset.v2',
        work_items: [], legal_work_items: [], recommended_order: [], recommended_item: null,
        project_state_persisted: false, human_approval_inferred: false,
        formal_activation_allowed: false, paid_provider_authority: 'not_granted',
      }))
      expect(projection.stage_definitions).toHaveLength(23)
      expect(projection.availability).toEqual({
        status: 'unavailable', authority_snapshot: 'unavailable', global_scope: 'unavailable',
        per_lsu_scope: 'unavailable', reason: 'authoritative_stage_evidence_unavailable',
      })
      expect(projection.shadow_comparison).toEqual(expect.objectContaining({
        status: 'unavailable', activation_allowed: false, execution_equivalence_claimed: false, comparisons: [],
      }))
      const ruleBindings = isRecord(projection.rule_bindings) ? projection.rule_bindings : {}
      const expectedRulePaths = [
        'pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json',
        'pipeline/v6-stage-contracts.json', 'pipeline/workflow-spec.v6.production-beta.json',
        'scripts/compile_qingmu_imago_workset.py', 'scripts/compile_qingmu_imago_workset_v2.py',
        'scripts/imago_v6_draft_ctl.py',
      ]
      expect(Object.keys(ruleBindings).sort()).toEqual([...expectedRulePaths].sort())
      if (IMAGO_CORE_ROOT === undefined) throw new Error('Core root is required for workset evidence')
      for (const rulePath of expectedRulePaths) {
        expect(ruleBindings[rulePath]).toBe(createHash('sha256').update(await readFile(join(IMAGO_CORE_ROOT, rulePath))).digest('hex'))
      }
      expect(projection.rules_sha256).toBe(canonicalSha256(ruleBindings))
      expect(projection.source_projection_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(projection.input_snapshot_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(await dialog.getByRole('heading', { name: '易梦业务状态' }).count()).toBe(1)
      expect(await workset.getByRole('article').count()).toBe(0)
      await expectNoVisibleTechnicalBrand(page)

      const desktopPath = process.env.QINGMU_E5_4_EVIDENCE_SCREENSHOT?.trim()
      if (desktopPath !== undefined && desktopPath !== '') {
        await mkdir(dirname(desktopPath), { recursive: true })
        await page.screenshot({ path: desktopPath, fullPage: true })
      }
      await workset.locator('summary').filter({ hasText: '完整合法工作集 · 0' }).click()
      await workset.getByText('没有可放行的工作项。规则定义不等于当前任务。', { exact: true }).waitFor()
      await workset.locator('summary').filter({ hasText: '方法规则定义 · 23' }).click()
      expect(await workset.locator('ul li').count()).toBeGreaterThanOrEqual(23)
      await workset.locator('summary').filter({ hasText: '来源与规则证据' }).click()
      await workset.getByText(String(projection.rules_sha256), { exact: true }).waitFor()
      const refreshWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/worksetMethod')
      await workset.getByRole('button', { name: '重编只读建议' }).click()
      const refreshedWire = await (await refreshWirePromise).json() as unknown
      expect(isRecord(refreshedWire) ? refreshedWire.result : undefined).toEqual(result)
      await workset.getByText('阶段与 LSU 权威证据尚未接入，暂不推荐生产任务。', { exact: true }).waitFor()

      await page.setViewportSize({ width: 390, height: 844 })
      const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      expect(mobileOverflow).toBe(false)
      const refreshBox = await workset.getByRole('button', { name: '重编只读建议' }).boundingBox()
      expect(refreshBox?.height).toBeGreaterThanOrEqual(44)
      const mobilePath = process.env.QINGMU_E5_4_MOBILE_EVIDENCE_SCREENSHOT?.trim()
      if (mobilePath !== undefined && mobilePath !== '') {
        await mkdir(dirname(mobilePath), { recursive: true })
        await page.screenshot({ path: mobilePath, fullPage: true })
      }
      await page.setViewportSize({ width: 1680, height: 1100 })
      const requests = capturedRequests.slice(requestStart)
      expect(requests.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
      expect(requests.filter(request => request.path === '/api/episodes/episode-1/workflow-projection').length).toBeGreaterThanOrEqual(3)
      const methodRequests = browserRpcRequests.slice(rpcStart).filter(request => request.path === '/qingmu-imago-method/worksetMethod')
      expect(methodRequests).toHaveLength(2)
      for (const request of methodRequests) {
        expect(isRecord(request.body) ? request.body.payload : undefined).toEqual({ projectId: 'project-1', episodeId: 'episode-1' })
      }
      expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      expect(await page.content()).not.toContain(IMAGO_ATTESTATION_KEY)
      worksetBrowserEvidence = {
        schema: 'qingmu.e5-4-workset-browser-evidence.v1',
        stageDefinitionCount: 23, workItemCount: 0, legalWorkItemCount: 0, recommendedItem: null,
        authorityStatus: 'unavailable', rulesSha256: projection.rules_sha256, ruleBindings,
        sourceProjectionSha256: projection.source_projection_sha256, inputSnapshotSha256: projection.input_snapshot_sha256,
        deterministicRecompile: true, legacyGreenDidNotGrantApproval: true, ignoredUntrustedStageApproval: true,
        methodRequestCount: methodRequests.length, yimengGetOnly: true, yimengRequestCount: requests.length,
        mobileOverflow, refreshControlHeight: refreshBox?.height,
        projectStatePersisted: false, paidProviderCalls: 0, humanApprovalInferred: false,
        consoleErrors: browserConsoleErrors.slice(consoleStart), pageErrors: tripwire.pageErrors,
      }
      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      if (tracePath !== undefined && tracePath !== '') {
        await mkdir(dirname(tracePath), { recursive: true })
        await page.context().tracing.stop({ path: tracePath })
      }
    }, 120_000)

    it('binds E5-5 continuity to the shared Shot and distinguishes current, historical, and missing evidence in Chromium', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e5-5-continuity'))
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E5_5_TRACE_PATH?.trim()
      if (tracePath) await page.context().tracing.start({ screenshots: true, snapshots: true })
      const nextWire = () => page.waitForResponse(response => new URL(response.url()).pathname === '/qingmu-imago-method/continuityMethod')
      const readProjection = async (wire: ReturnType<typeof nextWire>) => {
        const raw = await (await wire).json() as unknown
        const result = isRecord(raw) && isRecord(raw.result) ? raw.result : {}
        const value = isRecord(result.value) ? result.value : {}
        expect(result.ok).toBe(true)
        expect(value.schema).toBe('qingmu.imago-continuity-method-adapter-result.v1')
        if (!isRecord(value.projection)) throw new Error('missing continuity projection')
        return value.projection
      }
      if (setContinuityMode === undefined) throw new Error('continuity fixture control missing')
      setContinuityMode('current')
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const initialWire = nextWire()
      await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
      const continuity = dialog.getByRole('region', { name: '镜头连续性', exact: true })
      const river = dialog.getByRole('list', { name: '镜头选择' })
      const scenarios: Record<string, unknown>[] = []
      try {
        const current = await readProjection(initialWire)
        await continuity.getByText('当前选中链有匹配的检查证据', { exact: true }).waitFor({ timeout: 20_000 })
        expect(current.selected_shot).toEqual({ shotId: SHOT_RIVER_FIRST_FRAME_ID, frameNo: 7 })
        expect(current.continuity_snapshot_sha256).toBe(continuityDeltaFixture(3, STORYBOARD_CANVAS_BASE_REVISION, 'current').snapshotSha256)
        const pairs = isRecord(current.adjacent_pairs) ? current.adjacent_pairs : {}
        expect(pairs.incoming).toBeNull()
        expect(pairs.outgoing).toEqual(expect.objectContaining({ legacyEvidenceReady: true, currentEvidenceReady: true, bindingStatus: 'current' }))
        expect(current.candidate_findings).toEqual([])
        expect(current.lock_definitions).toHaveLength(6)
        expect(current.rework_propagation).toHaveLength(5)
        expect(current.lock_authority).toEqual({ status: 'unavailable', reason: 'authoritative_lock_instances_unavailable', instances: [] })
        expect(current).toEqual(expect.objectContaining({
          read_only: true, provider_calls: 0, task_mutation: false, budget_mutation: false,
          human_signoff_inferred: false, project_state_persisted: false, formal_activation_allowed: false,
        }))
        const ruleBindings = isRecord(current.rule_bindings) ? current.rule_bindings : {}
        const rulePaths = [
          'pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json', 'pipeline/v6-stage-contracts.json',
          'pipeline/role-capability-spec.v6.json', 'pipeline/workflow-spec.v6.production-beta.json',
          'pipeline/v6-lsuqc-completion-routing-policy.json', 'agents/c5-execution-director/AGENTS.md',
          'skill-package/imago-c5-execution-storyboard/SKILL.md',
          'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md',
          'agents/lsu-dailies-qc/AGENTS.md', 'skill-package/imago-lsu-dailies-qc/SKILL.md',
          'skill-package/imago-lsu-dailies-qc/references/lsu-dailies-standard.md',
          'scripts/compile_qingmu_continuity_method.py', 'scripts/compile_qingmu_element_method.py',
        ]
        expect(Object.keys(ruleBindings).sort()).toEqual([...rulePaths].sort())
        if (IMAGO_CORE_ROOT === undefined) throw new Error('Core root is required for continuity evidence')
        for (const path of rulePaths) {
          expect(ruleBindings[path]).toBe(createHash('sha256').update(await readFile(join(IMAGO_CORE_ROOT, path))).digest('hex'))
        }
        expect(current.rules_sha256).toBe(canonicalSha256(ruleBindings))
        scenarios.push({ name: 'current', projection: current })

        const selectedWire = nextWire()
        await river.getByRole('button', { name: /frame-1/ }).click()
        const selected = await readProjection(selectedWire)
        expect(selected.selected_shot).toEqual({ shotId: PROMPT_IR_FRAME_ID, frameNo: 12 })
        const selectedPairs = isRecord(selected.adjacent_pairs) ? selected.adjacent_pairs : {}
        expect(selectedPairs.incoming).toEqual(pairs.outgoing)
        expect(selectedPairs.outgoing).toBeNull()
        await continuity.getByRole('article', { name: '前镜头 → 当前镜头' }).getByText('7 → 12', { exact: true }).waitFor()
        expect(await continuity.getByRole('button').allTextContents()).toEqual(['重读连续性证据'])
        await continuity.locator('summary').filter({ hasText: '锁与返修规则 · 6' }).click()
        await continuity.getByText('项目锁实例尚未接入。下面只展示当前方法定义，不代表已锁定，也不会执行失效或返修。', { exact: true }).waitFor()
        await continuity.locator('summary').filter({ hasText: '锁与返修规则 · 6' }).click()
        const desktopPath = process.env.QINGMU_E5_5_EVIDENCE_SCREENSHOT?.trim()
        if (desktopPath) {
          await mkdir(dirname(desktopPath), { recursive: true })
          await continuity.getByRole('heading', { name: '镜头连续性', exact: true }).scrollIntoViewIfNeeded()
          await continuity.evaluate((element) => { element.scrollIntoView({ block: 'start' }) })
          await page.screenshot({ path: desktopPath })
        }

        const reload = async (mode: ContinuityMode) => {
          setContinuityMode?.(mode)
          const wire = nextWire()
          await dialog.getByRole('button', { name: '刷新只读投影', exact: true }).click()
          const projection = await readProjection(wire)
          await expect.poll(() => continuity.getByText('正在核对相邻镜头与当前规则…', { exact: true }).count()).toBe(0)
          scenarios.push({ name: mode, projection })
          return projection
        }
        const historical = await reload('historical')
        await continuity.getByText('历史检查对应另一组资产', { exact: true }).waitFor()
        const historicalPairs = isRecord(historical.adjacent_pairs) ? historical.adjacent_pairs : {}
        expect(historicalPairs.incoming).toEqual(expect.objectContaining({
          legacyEvidenceReady: true, currentEvidenceReady: false, bindingStatus: 'different',
        }))
        expect(historicalPairs.outgoing).toBeNull()
        expect(await continuity.getByText('当前选中链有匹配的检查证据', { exact: true }).count()).toBe(0)
        const failed = await reload('historical-failed')
        expect(failed.candidate_findings).toEqual([{
          from_shot_id: SHOT_RIVER_FIRST_FRAME_ID, to_shot_id: PROMPT_IR_FRAME_ID, dimension: 'prop', reason: '历史检查：怀表位置不符',
          check_id: 'check-e55', evidence_ref: 'test-evidence:e55', evidence_scope: 'historical',
          severity: null, earliest_owner: null, timecode: null, attribution: 'pending', formal_finding: false,
        }])
        await continuity.getByText('道具 · 历史资产', { exact: true }).waitFor()
        await continuity.getByText('待人工归因 · 未创建返修任务', { exact: true }).waitFor()
        await page.setViewportSize({ width: 390, height: 844 })
        const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const cardOverflow = await continuity.evaluate(element => element.scrollWidth > element.clientWidth)
        expect(mobileOverflow).toBe(false)
        expect(cardOverflow).toBe(false)
        const refreshBox = await continuity.getByRole('button', { name: '重读连续性证据' }).boundingBox()
        expect(refreshBox?.height).toBeGreaterThanOrEqual(44)
        const mobilePath = process.env.QINGMU_E5_5_MOBILE_EVIDENCE_SCREENSHOT?.trim()
        if (mobilePath) {
          await mkdir(dirname(mobilePath), { recursive: true })
          await continuity.getByText('道具 · 历史资产', { exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: mobilePath })
        }
        await page.setViewportSize({ width: 1680, height: 1100 })

        const unknown = await reload('unknown')
        expect(unknown.candidate_findings).toEqual([])
        await continuity.getByRole('row', { name: '道具 缺少记录', exact: true }).waitFor()
        expect(await continuity.getByRole('list', { name: '待归因的问题线索', exact: true }).count()).toBe(0)
        for (const mode of ['unavailable', 'omitted'] as const) {
          const unavailable = await reload(mode)
          expect(unavailable.availability).toEqual({
            status: 'unavailable', reason: mode === 'omitted' ? 'continuity_evidence_unavailable' : 'continuity_source_unavailable',
          })
          expect(unavailable.continuity_snapshot_sha256).toBe(mode === 'omitted'
            ? null : continuityDeltaFixture(3, STORYBOARD_CANVAS_BASE_REVISION, mode).snapshotSha256)
          await continuity.getByText('易梦尚未提供可绑定的连续性证据；不能据此判断通过或失败。', { exact: true }).waitFor()
          expect(await continuity.getByRole('article').count()).toBe(0)
        }
        await reload('current')
        const firstAgainWire = nextWire()
        await river.getByRole('button', { name: /frame-z/ }).click()
        await readProjection(firstAgainWire)
        await continuity.getByRole('article', { name: '当前镜头 → 后镜头' }).getByText('7 → 12', { exact: true }).waitFor()
        await expectNoVisibleTechnicalBrand(page)
        const requests = capturedRequests.slice(requestStart)
        expect(requests.length).toBeGreaterThan(0)
        expect(requests.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
        const methodRequests = browserRpcRequests.slice(rpcStart).filter(request => request.path === '/qingmu-imago-method/continuityMethod')
        expect(methodRequests.length).toBeGreaterThanOrEqual(9)
        for (const request of methodRequests) {
          const payload = isRecord(request.body) ? request.body.payload : undefined
          const subject = isRecord(payload) ? payload : {}
          expect(Object.keys(subject).sort()).toEqual(['episodeId', 'projectId', 'selectedShotId'])
          expect(subject.projectId).toBe('project-1')
          expect(subject.episodeId).toBe('episode-1')
          expect([SHOT_RIVER_FIRST_FRAME_ID, PROMPT_IR_FRAME_ID]).toContain(subject.selectedShotId)
        }
        expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
        expect(tripwire.pageErrors).toEqual([])
        continuityBrowserEvidence = {
          schema: 'qingmu.e5-5-continuity-browser-evidence.v1', scenarios, ruleBindings, rulesSha256: current.rules_sha256,
          sharedShotSelection: true, historicalPassDidNotApproveCurrent: true, unknownDimensionNotFailure: true,
          methodRequests, yimengGetOnly: true, yimengRequestCount: requests.length,
          mobileOverflow, cardOverflow, refreshControlHeight: refreshBox?.height,
          lockInstanceCount: 0, formalFindingCount: 0, providerCalls: 0, humanSignoffInferred: false,
          consoleErrors: browserConsoleErrors.slice(consoleStart), pageErrors: tripwire.pageErrors,
        }
      } finally {
        setContinuityMode('omitted')
        await page.setViewportSize({ width: 1680, height: 1100 })
        // Restore the entry tab so the next case does not mount a method against the retained Shot snapshot.
        await dialog.getByRole('tab', { name: '总览', exact: true }).click()
        await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
        if (tracePath) { await mkdir(dirname(tracePath), { recursive: true }); await page.context().tracing.stop({ path: tracePath }) }
      }
    }, 120_000)

    it('reads E5-5 selected video reviews on the shared Shot without promoting stale or unselected records in Chromium', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e5-5-video-review'))
      if (setVideoReviewMode === undefined) throw new Error('video review fixture control missing')
      const setMode = setVideoReviewMode
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E5_5_VIDEO_REVIEW_TRACE_PATH?.trim()
      if (tracePath) await page.context().tracing.start({ screenshots: true, snapshots: true })
      const nextWire = () => page.waitForResponse(response => new URL(response.url()).pathname === '/qingmu-yimeng/selectedVideoReview')
      const readWire = async (wire: ReturnType<typeof nextWire>) => {
        const response = await wire
        expect(response.status()).toBe(200)
        const raw = await response.json() as unknown
        if (!isRecord(raw) || !isRecord(raw.result)) throw new Error('video review carrier missing')
        return raw.result
      }
      setMode('rejected')
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const firstWire = nextWire()
      await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
      const panel = dialog.getByRole('region', { name: '当前选中视频审核', exact: true })
      const river = dialog.getByRole('list', { name: '镜头选择' })
      const scenarios: Record<string, unknown>[] = []
      try {
        const first = await readWire(firstWire)
        expect(first).toMatchObject({ ok: true, value: { frameId: SHOT_RIVER_FIRST_FRAME_ID,
          selectedAssetId: `video-${SHOT_RIVER_FIRST_FRAME_ID}`, selected: { formalReviewStatus: 'rejected' } } })
        await panel.getByText('易梦记录：已退回', { exact: true }).waitFor()
        expect(await panel.getByRole('button').allTextContents()).toEqual(['重读视频审核'])
        expect(await panel.locator('video, img, audio, a').count()).toBe(0)
        await panel.getByText('0 s', { exact: true }).waitFor()
        await panel.getByText('1.25 s', { exact: true }).waitFor()
        await panel.getByText('时间点未提供', { exact: true }).waitFor()
        await panel.getByText('开场怀表位置与上一镜不符。', { exact: true }).waitFor()
        scenarios.push({ name: 'original-rejection', result: first })

        const secondWire = nextWire()
        await river.getByRole('button', { name: /frame-1/ }).click()
        const second = await readWire(secondWire)
        expect(second).toMatchObject({ ok: true, value: { frameId: PROMPT_IR_FRAME_ID,
          selectedAssetId: `video-${PROMPT_IR_FRAME_ID}` } })
        await panel.getByText('video-frame-1', { exact: true }).waitFor()
        expect(await panel.getByText('video-frame-z', { exact: true }).count()).toBe(0)
        scenarios.push({ name: 'shared-shot-change', result: second })
        const desktopPath = process.env.QINGMU_E5_5_VIDEO_REVIEW_SCREENSHOT?.trim()
        if (desktopPath) {
          await mkdir(dirname(desktopPath), { recursive: true })
          await panel.evaluate((element) => { element.scrollIntoView({ block: 'start' }) })
          await page.screenshot({ path: desktopPath })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const cardOverflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth)
        expect(mobileOverflow).toBe(false)
        expect(cardOverflow).toBe(false)
        const refreshBox = await panel.getByRole('button', { name: '重读视频审核' }).boundingBox()
        expect(refreshBox?.height).toBeGreaterThanOrEqual(44)
        const mobilePath = process.env.QINGMU_E5_5_VIDEO_REVIEW_MOBILE_SCREENSHOT?.trim()
        if (mobilePath) {
          await mkdir(dirname(mobilePath), { recursive: true })
          await panel.getByRole('heading', { name: '原审核缺陷 · 3', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: mobilePath })
        }
        await page.setViewportSize({ width: 1680, height: 1100 })

        const reload = async (mode: VideoReviewMode) => {
          setMode(mode)
          const wire = nextWire()
          await panel.getByRole('button', { name: '重读视频审核' }).click()
          const result = await readWire(wire)
          await expect.poll(() => panel.getByText('正在读取当前选中视频的审核记录…', { exact: true }).count()).toBe(0)
          scenarios.push({ name: mode, result })
          return result
        }
        await reload('accepted')
        await panel.getByText('易梦记录：已通过', { exact: true }).waitFor()
        for (const [mode, label] of [
          ['pending', '待人工审核'], ['stale', '审核已失效'], ['invalid', '审核不可用'],
        ] as const) {
          const result = await reload(mode)
          expect(result).toMatchObject({ ok: true, value: { selected: { formalReviewStatus: mode, formalReview: null } } })
          await panel.getByText(label, { exact: true }).waitFor()
          expect(await panel.getByText('易梦记录：已通过', { exact: true }).count()).toBe(0)
          expect(await panel.getByRole('list', { name: '原审核缺陷', exact: true }).count()).toBe(0)
        }
        await panel.getByText('当前文件或审核证据不可用。下方 SHA 可能是资产表旧值，不代表当前字节已验证。', { exact: true }).waitFor()
        for (const mode of ['wrong-subject', 'wrong-asset-sha', 'revision-mismatch'] as const) {
          const result = await reload(mode)
          expect(result.ok).toBe(mode === 'revision-mismatch')
          await panel.getByRole('alert').waitFor()
          expect(await panel.getByText('易梦记录：已通过', { exact: true }).count()).toBe(0)
          expect(await panel.getByText('video-frame-1', { exact: true }).count()).toBe(0)
        }
        for (const mode of ['none', 'unselected-accepted'] as const) {
          const result = await reload(mode)
          expect(result).toMatchObject({ ok: true, value: { selectedAssetId: null, selected: null } })
          await panel.getByText('易梦尚未为这个镜头选中视频；不会自动选用其他已通过的候选。', { exact: true }).waitFor()
          expect(await panel.getByText('易梦记录：已通过', { exact: true }).count()).toBe(0)
        }
        await reload('rejected')
        const firstAgainWire = nextWire()
        await river.getByRole('button', { name: /frame-z/ }).click()
        await readWire(firstAgainWire)
        await panel.getByText('video-frame-z', { exact: true }).waitFor()
        await expectNoVisibleTechnicalBrand(page)
        const requests = capturedRequests.slice(requestStart)
        expect(requests.length).toBeGreaterThan(0)
        expect(requests.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
        const readRequests = browserRpcRequests.slice(rpcStart).filter(request => request.path === '/qingmu-yimeng/selectedVideoReview')
        expect(readRequests.length).toBeGreaterThanOrEqual(13)
        for (const request of readRequests) {
          const payload = isRecord(request.body) ? request.body.payload : undefined
          const subject = isRecord(payload) ? payload : {}
          expect(Object.keys(subject).sort()).toEqual(['episodeId', 'frameId', 'projectId'])
          expect(subject.projectId).toBe('project-1')
          expect(subject.episodeId).toBe('episode-1')
          expect([SHOT_RIVER_FIRST_FRAME_ID, PROMPT_IR_FRAME_ID]).toContain(subject.frameId)
        }
        expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
        expect(tripwire.pageErrors).toEqual([])
        selectedVideoReviewBrowserEvidence = {
          schema: 'qingmu.e5-5-selected-video-review-browser-evidence.v1', scenarios, readRequests,
          sharedShotSelection: true, staleReviewNotAccepted: true, unselectedReviewNotPromoted: true,
          originalTimecodes: [0, 1.25, null], mediaElementCount: 0,
          yimengGetOnly: true, yimengRequestCount: requests.length,
          mobileOverflow, cardOverflow, refreshControlHeight: refreshBox?.height,
          formalFindingCount: 0, providerCalls: 0, humanSignoffInferred: false,
          consoleErrors: browserConsoleErrors.slice(consoleStart), pageErrors: tripwire.pageErrors,
        }
      } finally {
        setMode('none')
        await page.setViewportSize({ width: 1680, height: 1100 })
        await dialog.getByRole('tab', { name: '总览', exact: true }).click()
        await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
        if (tracePath) { await mkdir(dirname(tracePath), { recursive: true }); await page.context().tracing.stop({ path: tracePath }) }
      }
    }, 120_000)

    it('records a bound E5-5 Finding, records and recovers its bounded route, and recovers a Finding receipt in Chromium', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e5-5-finding'))
      if (shotFindingDouble === undefined || reworkRouteDouble === undefined || setVideoReviewMode === undefined) {
        throw new Error('Finding or bounded-route fixture controls missing')
      }
      const controls = shotFindingDouble
      const routeControls = reworkRouteDouble
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E5_5_FINDING_TRACE_PATH?.trim()
      if (tracePath) await page.context().tracing.start({ screenshots: true, snapshots: true })
      const nextWire = (path: string, frameId: string) => page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== path) return false
        const body = response.request().postDataJSON() as unknown
        return isRecord(body) && isRecord(body.payload) && body.payload.projectId === 'project-1'
          && body.payload.episodeId === 'episode-1' && body.payload.frameId === frameId
      })
      const readWire = async (wire: ReturnType<typeof nextWire>) => {
        const response = await wire
        expect(response.status()).toBe(200)
        const raw = await response.json() as unknown
        if (!isRecord(raw) || !isRecord(raw.result)) throw new Error('Finding carrier missing')
        return raw.result
      }
      const markers = () => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => decodeURIComponent(key).startsWith('qingmu:shot-finding-recovery:v1:'))
        .map(key => ({ key, value: sessionStorage.getItem(key) })))
      const routeMarkers = () => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => decodeURIComponent(key).startsWith('qingmu:rework-route-recovery:v1:'))
        .map(key => ({ key, value: sessionStorage.getItem(key) })))
      controls.setMode('available')
      setVideoReviewMode('pending')
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const firstMethodWire = nextWire('/qingmu-imago-method/shotFindingMethod', SHOT_RIVER_FIRST_FRAME_ID)
      await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
      const panel = dialog.getByRole('region', { name: '镜头问题记录', exact: true })
      const river = dialog.getByRole('list', { name: '镜头选择' })
      try {
        const firstMethod = await readWire(firstMethodWire)
        expect(firstMethod).toMatchObject({ ok: true, value: { projection: {
          subject: { frameId: SHOT_RIVER_FIRST_FRAME_ID, frameNo: 7, storyboardRevision: 3 },
          definition: { statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false },
        } } })
        await panel.getByRole('combobox', { name: '最早责任岗位', exact: true }).waitFor()
        expect(await panel.getByRole('combobox', { name: '最早责任岗位', exact: true }).inputValue()).toBe('')
        expect(await panel.getByRole('combobox', { name: '严重度', exact: true }).inputValue()).toBe('')
        expect(await panel.getByRole('button', { name: '记录问题', exact: true }).isDisabled()).toBe(true)
        const fillFinding = async (frameId: string, observation: string) => {
          const finding = {
            timecode: ' 00:00:01.250 ', observation,
            evidenceRefs: [`asset://video-${frameId}#t=1.25`, `asset://video-${frameId}#t=1.25`],
            earliestOwner: 'F', ownerReason: '当前视频动作与已确认输入不符。', severity: 'MAJOR',
            suggestion: '复查动作连续性并保留怀表位置。', reworkScope: '仅复查本镜头，不自动返修或生成。',
          }
          await panel.getByLabel('时间点或时间范围', { exact: true }).fill(finding.timecode)
          await panel.getByLabel('观察到的问题', { exact: true }).fill(finding.observation)
          await panel.getByLabel('证据引用', { exact: true }).fill(finding.evidenceRefs.join('\n'))
          await panel.getByRole('combobox', { name: '最早责任岗位', exact: true }).selectOption({ label: '视频生产' })
          await panel.getByLabel('责任归因依据', { exact: true }).fill(finding.ownerReason)
          await panel.getByRole('combobox', { name: '严重度', exact: true }).selectOption(finding.severity)
          await panel.getByLabel('建议', { exact: true }).fill(finding.suggestion)
          await panel.getByLabel('建议返修范围', { exact: true }).fill(finding.reworkScope)
          return finding
        }
        const firstFinding = await fillFinding(SHOT_RIVER_FIRST_FRAME_ID, '空镜中怀表位置出现不连续变化。')
        const desktopPath = process.env.QINGMU_E5_5_FINDING_SCREENSHOT?.trim()
        if (desktopPath) {
          await mkdir(dirname(desktopPath), { recursive: true })
          await panel.evaluate((element) => { element.scrollIntoView({ block: 'start' }) })
          await page.screenshot({ path: desktopPath })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const cardOverflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth)
        const recordBox = await panel.getByRole('button', { name: '记录问题', exact: true }).boundingBox()
        expect(mobileOverflow).toBe(false)
        expect(cardOverflow).toBe(false)
        expect(recordBox?.height).toBeGreaterThanOrEqual(44)
        const mobilePath = process.env.QINGMU_E5_5_FINDING_MOBILE_SCREENSHOT?.trim()
        if (mobilePath) {
          await mkdir(dirname(mobilePath), { recursive: true })
          await panel.getByRole('combobox', { name: '最早责任岗位', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: mobilePath })
        }
        await page.setViewportSize({ width: 1680, height: 1100 })
        const firstRecordWire = nextWire('/qingmu-yimeng-command/recordShotFinding', SHOT_RIVER_FIRST_FRAME_ID)
        await panel.getByRole('button', { name: '记录问题', exact: true }).click()
        const firstRecord = await readWire(firstRecordWire)
        expect(firstRecord).toMatchObject({ ok: true, value: { finding: firstFinding,
          changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false } })
        await panel.getByText('问题已记录；未批准视频，也未执行返修。', { exact: true }).waitFor()
        await panel.getByRole('list', { name: '问题历史', exact: true }).getByText(firstFinding.observation, { exact: true }).waitFor()
        await panel.getByRole('combobox', { name: '最早责任岗位', exact: true }).waitFor()
        expect(await markers()).toEqual([])
        const preparationRequestStart = capturedRequests.length
        const preparationRpcStart = browserRpcRequests.length
        const firstDetails = panel.getByRole('list', { name: '问题历史', exact: true })
          .getByRole('listitem').filter({ has: page.getByText(firstFinding.observation, { exact: true }) }).locator('details')
        expect(capturedRequests.slice(preparationRequestStart).filter(request => request.path.includes('/rework-route/'))).toEqual([])
        expect(browserRpcRequests.slice(preparationRpcStart).filter(request => /reworkRoute/.test(request.path))).toEqual([])
        await firstDetails.locator('summary').click()
        const preparation = firstDetails.getByRole('region', { name: '返修准备 · 有界路线', exact: true })
        await preparation.waitFor()
        await preparation.getByText('当前尚无路线记录。', { exact: true }).waitFor()
        expect(await preparation.getByText('原记录与当前选中素材一致', { exact: true }).count()).toBe(1)
        expect(await preparation.getByText('视频生产 · 按制作单元', { exact: true }).count()).toBe(1)
        expect(await preparation.getByText('与记录时一致', { exact: true }).count()).toBe(1)
        expect(await preparation.getByText('当前读合同未提供', { exact: true }).count()).toBe(4)
        expect(await preparation.getByText('未知，不能按责任岗位推断', { exact: true }).count()).toBe(1)
        expect(await preparation.getByText('只记录当前 Finding 的有界路线；不执行返修、不建任务、不关闭问题、不改素材、阶段或锁，也不调用 Provider。', { exact: true }).count()).toBe(1)
        expect(await preparation.getByText('LSU07', { exact: true }).count()).toBe(1)
        expect(await preparation.getByText('PRODUCTION_BLUEPRINT_LOCK · C5F', { exact: true }).count()).toBe(1)
        const routeRecordButton = preparation.getByRole('button', { name: '只记录有界路线', exact: true })
        expect(await routeRecordButton.isEnabled()).toBe(true)
        const unrecordedPreparationAria = await captureStableAria(page, 'role=region[name="返修准备 · 有界路线"]', scaffold.workspaceCwd)
        const routeActionRequestStart = capturedRequests.length
        const routeActionRpcStart = browserRpcRequests.length
        routeControls.loseNextRecordResponse()
        const uncertainRouteWire = nextWire('/qingmu-yimeng-command/recordReworkRoute', SHOT_RIVER_FIRST_FRAME_ID)
        await routeRecordButton.click()
        expect(await readWire(uncertainRouteWire)).toMatchObject({ ok: false })
        await preparation.getByText('路线记录结果未知；请只读恢复原回执，不要重复发送。', { exact: true }).waitFor()
        const retainedRouteMarkers = await routeMarkers()
        expect(retainedRouteMarkers).toHaveLength(1)
        const retainedRoute = retainedRouteMarkers[0]
        if (retainedRoute?.value === null || retainedRoute?.value === undefined) throw new Error('Route intent was not retained')
        const routeIntent: unknown = JSON.parse(retainedRoute.value)
        if (!isRecord(routeIntent)) throw new Error('Route intent is not an object')
        expect(Object.keys(routeIntent)).toHaveLength(9)
        expect(routeIntent.frameId).toBe(SHOT_RIVER_FIRST_FRAME_ID)
        expect(routeIntent.findingId).toBe(controls.getRecordedResults()[0]?.finding.id)
        expect(retainedRoute.value).not.toContain(firstFinding.observation)
        expect(retainedRoute.value).not.toContain('signature')
        const recoverRouteButton = preparation.getByRole('button', { name: '只读恢复原路线回执', exact: true })
        const recoveredRouteWire = nextWire('/qingmu-yimeng-command/recoverReworkRoute', SHOT_RIVER_FIRST_FRAME_ID)
        await recoverRouteButton.click()
        const recoveredRoute = await readWire(recoveredRouteWire)
        expect(recoveredRoute).toMatchObject({ ok: true, value: {
          found: true,
          projectId: 'project-1',
          episodeId: 'episode-1',
          findingId: routeIntent.findingId,
          expectedSubjectSha256: routeIntent.expectedSubjectSha256,
          expectedRouteRevision: 0,
          expectedRouteSha256: null,
          idempotencyKey: routeIntent.idempotencyKey,
          result: {
            routeRecorded: true, findingClosed: false, selectionChanged: false,
            stageDecisionChanged: false, lockInvalidated: false, taskCreated: false,
            providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
          },
        } })
        await preparation.getByText('路线回执已核验，并已重新回读当前权威；未执行返修。', { exact: true }).waitFor()
        await preparation.getByText('权威回读：当前路线已记录；尚未执行返修。', { exact: true }).waitFor()
        await expect.poll(routeMarkers).toEqual([])
        const recordedRoutes = routeControls.getRecordedResults()
        expect(recordedRoutes).toHaveLength(1)
        expect(recordedRoutes[0]).toMatchObject({
          route: {
            findingId: routeIntent.findingId,
            revision: 1,
            subject: { productionUnit: { unitId: 'LSU07' } },
          },
          routeRecorded: true, findingClosed: false, selectionChanged: false,
          stageDecisionChanged: false, lockInvalidated: false, taskCreated: false,
          providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
        })
        const routeActionRequests = capturedRequests.slice(routeActionRequestStart)
        const routeRecordPosts = routeActionRequests.filter(request => request.method === 'POST' && request.path.endsWith('/rework-route/routes'))
        const routeRecoveryGets = routeActionRequests.filter(request => request.method === 'GET' && request.path.includes('/rework-route/route-command-receipt?'))
        const routeProbePosts = routeActionRequests.filter(request => request.method === 'POST' && request.path.endsWith('/rework-route/authority-probe'))
        expect(routeRecordPosts).toHaveLength(1)
        expect(routeRecoveryGets).toHaveLength(1)
        expect(routeRecoveryGets[0]?.body).toBeUndefined()
        expect(routeProbePosts.length).toBeGreaterThanOrEqual(1)
        const routeActionRpc = browserRpcRequests.slice(routeActionRpcStart).filter(request => /reworkRoute/i.test(request.path))
        expect(routeActionRpc.filter(request => request.path.endsWith('/recordReworkRoute'))).toHaveLength(1)
        expect(routeActionRpc.filter(request => request.path.endsWith('/recoverReworkRoute'))).toHaveLength(1)
        expect(routeActionRequests.filter(request => (
          /provider|worker|generate|approval|select|task|close-finding|execute-rework/i.test(request.path)
        ))).toEqual([])
        const currentPreparationAria = await captureStableAria(page, 'role=region[name="返修准备 · 有界路线"]', scaffold.workspaceCwd)
        const preparationDesktopPath = process.env.QINGMU_E5_5_REWORK_SCREENSHOT?.trim()
        if (preparationDesktopPath) {
          await mkdir(dirname(preparationDesktopPath), { recursive: true })
          await preparation.getByRole('heading', { name: '返修准备 · 有界路线', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: preparationDesktopPath })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        const preparationMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const preparationCardOverflow = await preparation.evaluate(element => element.scrollWidth > element.clientWidth)
        const detailsControlHeight = (await firstDetails.locator('summary').boundingBox())?.height
        expect(preparationMobileOverflow).toBe(false)
        expect(preparationCardOverflow).toBe(false)
        expect(detailsControlHeight).toBeGreaterThanOrEqual(44)
        expect((await preparation.getByRole('button', { name: '当前路线已记录', exact: true }).boundingBox())?.height)
          .toBeGreaterThanOrEqual(44)
        // The outer evidence <dd> owns the complete route control and is
        // intentionally taller than the mobile scroll port. Verify the
        // visible leaf fields, not that structural container.
        const preparationMobileFields = await preparation.locator('h5, dt, dd:not(:has(div, dl, p)), p').all()
        for (const field of preparationMobileFields) {
          await field.scrollIntoViewIfNeeded()
          const fieldLabel = await field.innerText()
          expect(await field.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
          }), `mobile route field should be unobscured: ${JSON.stringify(fieldLabel)}`).toBe(true)
        }
        // The region is taller than the mobile dialog's scroll port. Capture
        // actual viewport positions, not a clipped tall element screenshot.
        const preparationMobilePath = process.env.QINGMU_E5_5_REWORK_MOBILE_SCREENSHOT?.trim()
        if (preparationMobilePath) {
          await mkdir(dirname(preparationMobilePath), { recursive: true })
          await preparation.getByRole('heading', { name: '返修准备 · 有界路线', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: preparationMobilePath })
        }
        const preparationMobileEndPath = process.env.QINGMU_E5_5_REWORK_MOBILE_END_SCREENSHOT?.trim()
        if (preparationMobileEndPath) {
          await mkdir(dirname(preparationMobileEndPath), { recursive: true })
          await preparation.locator('p').last().scrollIntoViewIfNeeded()
          await page.screenshot({ path: preparationMobileEndPath })
        }
        await page.setViewportSize({ width: 1680, height: 1100 })
        expect(capturedRequests.slice(preparationRequestStart).some(request => request.path.includes('/rework-route/source?'))).toBe(true)
        expect(browserRpcRequests.slice(preparationRpcStart).some(request => request.path.endsWith('/reworkRouteMethod'))).toBe(true)
        expect(await markers()).toEqual([])
        expect(await routeMarkers()).toEqual([])
        const secondMethodWire = nextWire('/qingmu-imago-method/shotFindingMethod', PROMPT_IR_FRAME_ID)
        await river.getByRole('button', { name: /frame-1/ }).click()
        expect(await readWire(secondMethodWire)).toMatchObject({ ok: true, value: { projection: {
          subject: { frameId: PROMPT_IR_FRAME_ID, frameNo: 12, storyboardRevision: 3 },
        } } })
        await panel.getByRole('combobox', { name: '最早责任岗位', exact: true }).waitFor()
        expect(await panel.getByText(firstFinding.observation, { exact: true }).count()).toBe(0)
        expect(await panel.getByRole('region', { name: '返修准备 · 有界路线', exact: true }).count()).toBe(0)
        const secondFinding = await fillFinding(PROMPT_IR_FRAME_ID, '人物转身时怀表短暂消失。')
        controls.loseNextRecordResponse()
        const uncertainWire = nextWire('/qingmu-yimeng-command/recordShotFinding', PROMPT_IR_FRAME_ID)
        await panel.getByRole('button', { name: '记录问题', exact: true }).click()
        expect(await readWire(uncertainWire)).toMatchObject({ ok: false })
        await panel.getByRole('button', { name: '只读恢复原回执', exact: true }).waitFor()
        const retainedMarkers = await markers()
        expect(retainedMarkers).toHaveLength(1)
        const retained = retainedMarkers[0]
        if (retained?.value === null || retained?.value === undefined) throw new Error('Finding intent was not retained')
        const intent: unknown = JSON.parse(retained.value)
        if (!isRecord(intent)) throw new Error('Finding intent is not an object')
        expect(Object.keys(intent)).toHaveLength(8)
        expect(intent.frameId).toBe(PROMPT_IR_FRAME_ID)
        expect(retained.value).not.toContain(secondFinding.observation)
        expect(retained.value).not.toContain('signature')

        controls.setMode('unavailable')
        controls.setRecoveryVisible(false)
        await page.reload()
        await page.getByRole('button', { name: '青木制作台' }).click()
        await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
        await river.getByRole('button', { name: /frame-1/ }).click()
        const recoverButton = panel.getByRole('button', { name: '只读恢复原回执', exact: true })
        await recoverButton.waitFor()
        const recoveryStart = capturedRequests.length
        const notFoundWire = nextWire('/qingmu-yimeng-command/recoverShotFinding', PROMPT_IR_FRAME_ID)
        await recoverButton.click()
        expect(await readWire(notFoundWire)).toMatchObject({ ok: true, value: { status: 'not_found', result: null,
          frameId: PROMPT_IR_FRAME_ID, expectedSubjectSha256: intent.expectedSubjectSha256, idempotencyKey: intent.idempotencyKey } })
        expect(await markers()).toEqual(retainedMarkers)
        controls.setRecoveryVisible(true)
        await expect.poll(() => recoverButton.isDisabled()).toBe(false)
        const recoveredWire = nextWire('/qingmu-yimeng-command/recoverShotFinding', PROMPT_IR_FRAME_ID)
        await recoverButton.click()
        const recovered = await readWire(recoveredWire)
        expect(recovered).toMatchObject({ ok: true, value: { status: 'committed', frameId: PROMPT_IR_FRAME_ID,
          expectedSubjectSha256: intent.expectedSubjectSha256, idempotencyKey: intent.idempotencyKey,
          result: { finding: secondFinding, changed: false, reworkExecuted: false, humanSignoffInferred: false } } })
        await expect.poll(markers).toEqual([])
        await panel.getByRole('list', { name: '问题历史', exact: true }).getByText(secondFinding.observation, { exact: true }).waitFor()
        expect(await panel.getByRole('button', { name: '记录问题', exact: true }).count()).toBe(0)
        const unavailablePreparationRequestStart = capturedRequests.length
        const unavailablePreparationRpcStart = browserRpcRequests.length
        const recoveredDetails = panel.getByRole('list', { name: '问题历史', exact: true })
          .getByRole('listitem').filter({ has: page.getByText(secondFinding.observation, { exact: true }) }).locator('details')
        await recoveredDetails.locator('summary').click()
        const unavailablePreparation = recoveredDetails.getByRole('region', { name: '返修准备 · 有界路线', exact: true })
        await unavailablePreparation.waitFor()
        expect(await unavailablePreparation.getByText('当前素材不可核验', { exact: true }).count()).toBe(1)
        expect(await unavailablePreparation.getByText('当前方法未提供匹配岗位，保留原归因', { exact: true }).count()).toBe(1)
        expect(await unavailablePreparation.getByText('当前规则不可核验', { exact: true }).count()).toBe(1)
        expect(await unavailablePreparation.getByText('当前读合同未提供', { exact: true }).count()).toBe(4)
        await unavailablePreparation.getByText(
          '历史素材上的 Finding 只读；禁止记录当前路线。', { exact: true },
        ).waitFor()
        expect(await unavailablePreparation.locator('button, a, input, select, textarea').count()).toBe(0)
        const unavailablePreparationAria = await captureStableAria(page, 'role=region[name="返修准备 · 有界路线"]', scaffold.workspaceCwd)
        const preparationGoldenPath = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-shot-finding-rework/ui.expected.md')
        if (scaffold.mode === 'refresh') await mkdir(dirname(preparationGoldenPath), { recursive: true })
        await compareOrRefreshGolden(preparationGoldenPath, `## Current binding before route\n\n${unrecordedPreparationAria}\n\n## Current binding after recovered route\n\n${currentPreparationAria}\n\n## Historical Finding with current media unavailable\n\n${unavailablePreparationAria}`, scaffold.mode)
        expect(capturedRequests.length - unavailablePreparationRequestStart).toBe(0)
        expect(browserRpcRequests.length - unavailablePreparationRpcStart).toBe(0)
        expect(await markers()).toEqual([])
        expect(await routeMarkers()).toEqual([])
        const recoveryRequests = capturedRequests.slice(recoveryStart)
        expect(recoveryRequests.length).toBeGreaterThanOrEqual(2)
        expect(recoveryRequests.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
        const requests = capturedRequests.slice(requestStart)
        const posts = requests.filter(request => request.method === 'POST')
        const findingPosts = posts.filter(request => /\/frames\/(?:frame-z|frame-1)\/findings$/u.test(request.path))
        expect(findingPosts).toHaveLength(2)
        expect(findingPosts.map(request => request.path)).toEqual([
          `/api/qingmu/projects/project-1/episodes/episode-1/frames/${SHOT_RIVER_FIRST_FRAME_ID}/findings`,
          `/api/qingmu/projects/project-1/episodes/episode-1/frames/${PROMPT_IR_FRAME_ID}/findings`,
        ])
        expect(findingPosts[0]?.body).toMatchObject({ finding: firstFinding })
        expect(findingPosts[1]?.body).toMatchObject({ finding: secondFinding, idempotencyKey: intent.idempotencyKey })
        expect(posts.filter(request => request.path.endsWith('/rework-route/routes'))).toHaveLength(1)
        expect(requests.filter(request => (
          /provider|worker|generate|approval|select|task|close-finding|execute-rework/i.test(request.path)
        ))).toEqual([])
        const recorded = controls.getRecordedResults()
        expect(recorded).toHaveLength(2)
        expect(recorded[0]?.finding.id).not.toBe(recorded[1]?.finding.id)
        const findingRpc = browserRpcRequests.slice(rpcStart)
          .filter(request => /shotFindings|shotFindingMethod|recordShotFinding|recoverShotFinding/.test(request.path))
        const readRpc = findingRpc.filter(request => /shotFindings|shotFindingMethod/.test(request.path))
        expect(readRpc.some(request => request.path.endsWith('/shotFindings'))).toBe(true)
        expect(readRpc.some(request => request.path.endsWith('/shotFindingMethod'))).toBe(true)
        for (const request of readRpc) {
          const payload = isRecord(request.body) ? request.body.payload : undefined
          if (!isRecord(payload)) throw new Error('Finding read coordinates missing')
          expect(Object.keys(payload).sort()).toEqual(['episodeId', 'frameId', 'projectId'])
          expect(payload.projectId).toBe('project-1')
          expect(payload.episodeId).toBe('episode-1')
          expect([SHOT_RIVER_FIRST_FRAME_ID, PROMPT_IR_FRAME_ID]).toContain(payload.frameId)
        }
        expect(findingRpc.filter(request => request.path.endsWith('/recordShotFinding'))).toHaveLength(2)
        expect(findingRpc.filter(request => request.path.endsWith('/recoverShotFinding'))).toHaveLength(2)
        expect(JSON.stringify(findingRpc)).not.toContain(YIMENG_TOKEN)
        expect(JSON.stringify(findingRpc)).not.toContain(IMAGO_ATTESTATION_KEY)
        expect(await panel.locator('video, img, audio, a').count()).toBe(0)
        expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
        expect(tripwire.pageErrors).toEqual([])
        await expectNoVisibleTechnicalBrand(page)
        shotFindingBrowserEvidence = {
          schema: 'qingmu.e5-5-shot-finding-browser-evidence.v1', firstMethod, firstRecord, recovered,
          recorded, findingRpc, findingPostCount: findingPosts.length, recoveryGetOnly: true, recoveryRequestCount: recoveryRequests.length,
          lostResponseRetainedAcrossReload: true, notFoundRetainedMarker: true, recoveryWithoutCurrentMedia: true,
          duplicateEvidencePreserved: true, sharedShotSelection: true, automaticPostRetryCount: 0,
          mobileOverflow, cardOverflow, recordControlHeight: recordBox?.height, mediaElementCount: 0,
          reworkPreparation: {
            unrecordedPreparationAria, currentPreparationAria, unavailablePreparationAria,
            collapsedAdditionalUpstreamRequests: 0, collapsedAdditionalRpcRequests: 0,
            routeRecordPostCount: routeRecordPosts.length, routeRecoveryGetCount: routeRecoveryGets.length,
            routeProbePostCount: routeProbePosts.length, recordedRoutes, lostResponseRecoveredGetOnly: true,
            sourceSwitchHidesPreparation: true, historicalAdditionalUpstreamRequests: 0,
            historicalAdditionalRpcRequests: 0, requiredEvidenceUnprovided: 4,
            currentInteractiveControlCount: 1, historicalInteractiveControlCount: 0,
            mobileOverflow: preparationMobileOverflow, cardOverflow: preparationCardOverflow, detailsControlHeight,
            mobileUnobscuredFieldCount: preparationMobileFields.length,
          },
          providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false,
          consoleErrors: browserConsoleErrors.slice(consoleStart), pageErrors: tripwire.pageErrors,
        }
      } finally {
        controls.setMode('unavailable')
        controls.setRecoveryVisible(true)
        setVideoReviewMode('none')
        await page.setViewportSize({ width: 1680, height: 1100 })
        await dialog.getByRole('tab', { name: '总览', exact: true }).click()
        await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
        if (tracePath) { await mkdir(dirname(tracePath), { recursive: true }); await page.context().tracing.stop({ path: tracePath }) }
      }
    }, 120_000)

    it('registers an explicit production-unit scope and recovers its lost response without resubmitting in Chromium', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-production-unit'))
      if (productionUnitDouble === undefined || shotFindingDouble === undefined || setVideoReviewMode === undefined
        || IMAGO_CORE_ROOT === undefined || IMAGO_CORE_ROOT === '') throw new Error('Production-unit fixture controls missing')
      const units = productionUnitDouble
      const findings = shotFindingDouble
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E5_5_PRODUCTION_UNIT_TRACE_PATH?.trim()
      if (tracePath) await page.context().tracing.start({ screenshots: true, snapshots: true })
      const nextWire = (path: string, coordinates: { groupId?: string; frameId?: string } = {}) => page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== path) return false
        const body = response.request().postDataJSON() as unknown
        if (!isRecord(body) || !isRecord(body.payload)) return false
        const payload = body.payload
        return payload.projectId === 'project-1' && payload.episodeId === 'episode-1'
          && Object.entries(coordinates).every(([key, value]) => payload[key] === value)
      })
      const readWire = async (wire: ReturnType<typeof nextWire>) => {
        const response = await wire
        expect(response.status()).toBe(200)
        const raw = await response.json() as unknown
        if (!isRecord(raw) || !isRecord(raw.result)) throw new Error('Production-unit RPC carrier missing')
        return raw.result
      }
      const markers = () => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => decodeURIComponent(key).startsWith('qingmu:production-unit-recovery:v1:'))
        .map(key => ({ key, value: sessionStorage.getItem(key) })))
      units.setMode('available')
      findings.setMode('available')
      setVideoReviewMode('pending')
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const initialRead = nextWire('/qingmu-yimeng/productionUnits')
      await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
      const panel = dialog.getByRole('region', { name: '制作单元范围登记', exact: true })
      const river = dialog.getByRole('list', { name: '镜头选择' })
      const groupCoordinates = { groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID }
      const unitBase = '/api/qingmu/projects/project-1/episodes/episode-1/production-units'
      const bindingPath = `${unitBase}/${PRODUCTION_UNIT_BROWSER_UNIT_ID}/binding`
      try {
        const initialFeed = await readWire(initialRead)
        expect(initialFeed).toMatchObject({ ok: true, value: { bindings: [], groups: [{
          groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID, subject: { groupNo: 3, storyboardRevision: 3,
            shots: [{ frameId: SHOT_RIVER_FIRST_FRAME_ID, frameNo: 7 }, { frameId: PROMPT_IR_FRAME_ID, frameNo: 12 }] },
        }], planSealed: false, humanSignoffInferred: false, reworkExecuted: false, providerCalls: 0 } })
        const group = panel.getByRole('combobox', { name: '已有镜头组', exact: true })
        await group.waitFor()
        expect(await group.inputValue()).toBe('')
        expect(browserRpcRequests.slice(rpcStart).filter(request => request.path.endsWith('/productionUnitMethod'))).toEqual([])
        expect(await markers()).toEqual([])
        const methodWire = nextWire('/qingmu-imago-method/productionUnitMethod', groupCoordinates)
        await group.selectOption(PRODUCTION_UNIT_BROWSER_GROUP_ID)
        const method = await readWire(methodWire)
        expect(method.ok).toBe(true)
        if (!isRecord(method.value) || !isRecord(method.value.projection)) throw new Error('Real Core unit method missing')
        const projection = method.value.projection
        expect(projection.subject).toEqual(units.getFeed(3).groups[0]?.subject)
        expect(projection.definition).toMatchObject({ operation: 'bind_existing_shot_group',
          planSealingAllowed: false, stageApprovalAllowed: false, providerCalls: 0 })
        expect(method.value.projectionSha256).toBe(canonicalSha256(projection))
        if (!isRecord(projection.ruleBindings)) throw new Error('Unit rule bindings missing')
        expect(Object.keys(projection.ruleBindings).sort()).toEqual([...PRODUCTION_UNIT_BROWSER_RULE_PATHS].sort())
        for (const path of PRODUCTION_UNIT_BROWSER_RULE_PATHS) {
          expect(projection.ruleBindings[path]).toBe(createHash('sha256').update(await readFile(join(IMAGO_CORE_ROOT, path))).digest('hex'))
        }
        const unitId = panel.getByRole('textbox', { name: '制作单元 ID', exact: true })
        expect(await unitId.inputValue()).toBe('')
        await unitId.fill(PRODUCTION_UNIT_BROWSER_UNIT_ID)
        const confirm = panel.getByRole('checkbox', { name: '我确认仅登记所示镜头范围，不作审批或计划封存。', exact: true })
        expect(await confirm.isChecked()).toBe(false)
        const bind = panel.getByRole('button', { name: '确认登记范围', exact: true })
        expect(await bind.isDisabled()).toBe(true)
        await confirm.check()
        await expect.poll(() => bind.isDisabled()).toBe(false)
        const bindControlHeight = (await bind.boundingBox())?.height
        expect(bindControlHeight).toBeGreaterThanOrEqual(44)
        units.loseNextBindingResponse()
        const lostWire = nextWire('/qingmu-yimeng-command/bindProductionUnit', groupCoordinates)
        await bind.click()
        expect(await readWire(lostWire)).toMatchObject({ ok: false })
        await panel.getByText('登记结果未知。请查询原回执，不要重复提交。', { exact: true }).waitFor()
        const retainedMarkers = await markers()
        expect(retainedMarkers).toHaveLength(1)
        const retained = retainedMarkers[0]
        if (retained?.value === null || retained?.value === undefined) throw new Error('Unit recovery intent missing')
        const intent: unknown = JSON.parse(retained.value)
        if (!isRecord(intent)) throw new Error('Unit recovery intent must be an object')
        expect(Object.keys(intent).sort()).toEqual(['schema', 'projectId', 'episodeId', 'groupId', 'unitId',
          'expectedSubjectSha256', 'expectedBindingRevision', 'expectedBindingSha256',
          'methodProjectionSha256', 'rulesSha256', 'idempotencyKey'].sort())
        expect(intent).toMatchObject({ projectId: 'project-1', episodeId: 'episode-1', groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID,
          unitId: PRODUCTION_UNIT_BROWSER_UNIT_ID, expectedSubjectSha256: projection.subjectSnapshotSha256,
          methodProjectionSha256: method.value.projectionSha256, rulesSha256: projection.rulesSha256 })
        expect(Object.hasOwn(intent, 'methodProjection')).toBe(false)
        expect(retained.value).not.toMatch(/signature|authSession|owner-fixture/)
        expect(retained.value).not.toContain(YIMENG_TOKEN)
        expect(retained.value).not.toContain(IMAGO_ATTESTATION_KEY)
        expect(capturedRequests.slice(requestStart).filter(request => request.path === bindingPath && request.method === 'POST')).toHaveLength(1)

        // The source becomes unreadable before a real page reload. Recovery must
        // still use the original frozen coordinates and must not resubmit.
        units.setMode('unavailable')
        const recoveryStart = capturedRequests.length
        await page.reload()
        await page.getByRole('button', { name: '青木制作台' }).click()
        const unavailableRead = nextWire('/qingmu-yimeng/productionUnits')
        await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
        expect(await readWire(unavailableRead)).toMatchObject({ ok: true, value: {
          groups: [{ subject: null, snapshotSha256: null, availability: { status: 'unavailable' } }],
          bindings: [{ currentBinding: false }],
        } })
        expect(await markers()).toEqual(retainedMarkers)
        const recover = panel.getByRole('button', { name: '查询原登记回执', exact: true })
        await recover.waitFor()
        const recoveryWire = nextWire('/qingmu-yimeng-command/recoverProductionUnitBinding', groupCoordinates)
        const recoveredFeedWire = nextWire('/qingmu-yimeng/productionUnits')
        await recover.click()
        const recovered = await readWire(recoveryWire)
        expect(recovered).toMatchObject({ ok: true, value: { found: true,
          projectId: 'project-1', episodeId: 'episode-1', groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID,
          unitId: PRODUCTION_UNIT_BROWSER_UNIT_ID, expectedSubjectSha256: intent.expectedSubjectSha256,
          idempotencyKey: intent.idempotencyKey, result: { binding: { revision: 1 }, ...{
            planSealed: false, humanSignoffInferred: false, reworkExecuted: false, providerCalls: 0,
          } },
        } })
        expect(await readWire(recoveredFeedWire)).toMatchObject({ ok: true, value: {
          groups: [{ subject: null, snapshotSha256: null, availability: { status: 'unavailable' } }],
          bindings: [{ currentBinding: false }],
        } })
        await expect.poll(markers).toEqual([])
        const recoveryRequests = capturedRequests.slice(recoveryStart)
        expect(recoveryRequests.length).toBeGreaterThan(0)
        expect(recoveryRequests.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
        const receipts = recoveryRequests.filter(request => request.path.startsWith(`${bindingPath}/command-receipt?`))
        expect(receipts).toHaveLength(1)
        const receiptRequest = receipts[0]
        if (receiptRequest === undefined) throw new Error('Original unit receipt GET was not observed')
        const receiptQuery = new URL(receiptRequest.path, 'http://127.0.0.1').searchParams
        expect([...receiptQuery.keys()].sort()).toEqual(['expectedSubjectSha256', 'groupId'])
        expect(receiptQuery.get('groupId')).toBe(PRODUCTION_UNIT_BROWSER_GROUP_ID)
        expect(receiptQuery.get('expectedSubjectSha256')).toBe(intent.expectedSubjectSha256)
        expect(receiptRequest.idempotencyKey).toBe(intent.idempotencyKey)

        units.setMode('available')
        const currentRead = nextWire('/qingmu-yimeng/productionUnits')
        await panel.getByRole('button', { name: '刷新单元范围', exact: true }).click()
        const currentFeed = await readWire(currentRead)
        expect(currentFeed).toMatchObject({ ok: true, value: { bindings: [{ currentBinding: true,
          binding: { unitId: PRODUCTION_UNIT_BROWSER_UNIT_ID, groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID,
            revision: 1, source: { storyboardRevision: 3 } } }] } })
        await panel.getByText('范围来源当前一致', { exact: true }).waitFor()
        const desktopPath = process.env.QINGMU_E5_5_PRODUCTION_UNIT_SCREENSHOT?.trim()
        if (desktopPath) {
          await mkdir(dirname(desktopPath), { recursive: true })
          await panel.getByRole('heading', { name: '制作单元范围登记', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: desktopPath })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const panelOverflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth)
        expect(mobileOverflow).toBe(false)
        expect(panelOverflow).toBe(false)
        const refreshControlHeight = (await panel.getByRole('button', { name: '刷新单元范围', exact: true }).boundingBox())?.height
        expect(refreshControlHeight).toBeGreaterThanOrEqual(44)
        const mobilePath = process.env.QINGMU_E5_5_PRODUCTION_UNIT_MOBILE_SCREENSHOT?.trim()
        if (mobilePath) {
          await mkdir(dirname(mobilePath), { recursive: true })
          await panel.getByRole('heading', { name: '制作单元范围登记', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: mobilePath })
        }
        const mobileEndPath = process.env.QINGMU_E5_5_PRODUCTION_UNIT_MOBILE_END_SCREENSHOT?.trim()
        if (mobileEndPath) {
          await mkdir(dirname(mobileEndPath), { recursive: true })
          await panel.getByText('范围来源当前一致', { exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: mobileEndPath })
        }
        await page.setViewportSize({ width: 1680, height: 1100 })

        // A separate explicit Finding POST makes this scenario independently
        // runnable. It is counted separately from the one unit binding POST.
        const findingPanel = dialog.getByRole('region', { name: '镜头问题记录', exact: true })
        await findingPanel.getByRole('combobox', { name: '最早责任岗位', exact: true }).waitFor()
        const observation = '范围登记回读后，核对怀表动作连续性。'
        await findingPanel.getByLabel('时间点或时间范围', { exact: true }).fill('00:00:01.250')
        await findingPanel.getByLabel('观察到的问题', { exact: true }).fill(observation)
        await findingPanel.getByLabel('证据引用', { exact: true }).fill(`asset://video-${SHOT_RIVER_FIRST_FRAME_ID}#t=1.25`)
        await findingPanel.getByRole('combobox', { name: '最早责任岗位', exact: true }).selectOption({ label: '视频生产' })
        await findingPanel.getByLabel('责任归因依据', { exact: true }).fill('仅以当前视频动作与镜头来源作核对。')
        await findingPanel.getByRole('combobox', { name: '严重度', exact: true }).selectOption('MINOR')
        await findingPanel.getByLabel('建议', { exact: true }).fill('由原岗位核对，不自动执行。')
        await findingPanel.getByLabel('建议返修范围', { exact: true }).fill('仅本镜头。')
        const findingWire = nextWire('/qingmu-yimeng-command/recordShotFinding', { frameId: SHOT_RIVER_FIRST_FRAME_ID })
        await findingPanel.getByRole('button', { name: '记录问题', exact: true }).click()
        const recordedFinding = await readWire(findingWire)
        expect(recordedFinding).toMatchObject({ ok: true, value: {
          finding: { observation,
            subject: { frameId: SHOT_RIVER_FIRST_FRAME_ID, frameNo: 7, storyboardRevision: 3, frameContentSha256: 'b'.repeat(64) } },
          changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false,
        } })
        const details = findingPanel.getByRole('list', { name: '问题历史', exact: true })
          .getByRole('listitem').filter({ has: page.getByText(observation, { exact: true }) }).locator('details')
        await details.locator('summary').click()
        const unitEvidence = details.locator('dl > div').filter({ has: page.getByText('制作单元范围绑定', { exact: true }) })
        await unitEvidence.getByText(PRODUCTION_UNIT_BROWSER_UNIT_ID, { exact: true }).waitFor()
        expect(await unitEvidence.innerText()).toContain('当前范围绑定')
        expect(await unitEvidence.innerText()).toContain('不证明计划已封存、实例已建立或返修已获准')
        expect(await unitEvidence.locator('button, a, input, select').count()).toBe(0)
        const findingScreenshot = process.env.QINGMU_E5_5_PRODUCTION_UNIT_FINDING_SCREENSHOT?.trim()
        if (findingScreenshot) {
          await mkdir(dirname(findingScreenshot), { recursive: true })
          await unitEvidence.scrollIntoViewIfNeeded()
          await page.screenshot({ path: findingScreenshot })
        }
        const secondFindingRead = nextWire('/qingmu-yimeng/shotFindings', { frameId: PROMPT_IR_FRAME_ID })
        await river.getByRole('button', { name: /frame-1/ }).click()
        expect(await readWire(secondFindingRead)).toMatchObject({ ok: true, value: { frameId: PROMPT_IR_FRAME_ID } })
        expect(await findingPanel.getByText(observation, { exact: true }).count()).toBe(0)
        expect(await markers()).toEqual([])
        const requests = capturedRequests.slice(requestStart)
        const unitPosts = requests.filter(request => request.method === 'POST' && request.path === bindingPath)
        const findingPosts = requests.filter(request => request.method === 'POST' && request.path.endsWith('/findings'))
        expect(unitPosts).toHaveLength(1)
        expect(findingPosts).toHaveLength(1)
        expect(requests.filter(request => request.method === 'POST')).toHaveLength(2)
        const postBody = unitPosts[0]?.body
        if (!isRecord(postBody)) throw new Error('Unit binding POST body missing')
        expect(Object.keys(postBody).sort()).toEqual(['groupId', 'expectedSubjectSha256', 'expectedBindingRevision',
          'expectedBindingSha256', 'methodProjection', 'methodProjectionSha256', 'methodAttestation', 'idempotencyKey'].sort())
        expect(postBody).toMatchObject({ groupId: PRODUCTION_UNIT_BROWSER_GROUP_ID, expectedBindingRevision: 0,
          expectedBindingSha256: null, expectedSubjectSha256: intent.expectedSubjectSha256, idempotencyKey: intent.idempotencyKey })
        const unitRpc = browserRpcRequests.slice(rpcStart)
          .filter(request => /productionUnits|productionUnitMethod|bindProductionUnit|recoverProductionUnitBinding/.test(request.path))
        expect(unitRpc.filter(request => request.path.endsWith('/bindProductionUnit'))).toHaveLength(1)
        expect(unitRpc.filter(request => request.path.endsWith('/recoverProductionUnitBinding'))).toHaveLength(1)
        expect(unitRpc.some(request => request.path.endsWith('/productionUnits'))).toBe(true)
        expect(unitRpc.some(request => request.path.endsWith('/productionUnitMethod'))).toBe(true)
        for (const request of unitRpc.filter(request => /productionUnits|productionUnitMethod/.test(request.path))) {
          const payload = isRecord(request.body) ? request.body.payload : undefined
          if (!isRecord(payload)) throw new Error('Unit read coordinates missing')
          expect(Object.keys(payload).sort()).toEqual(request.path.endsWith('/productionUnits')
            ? ['episodeId', 'projectId'] : ['episodeId', 'groupId', 'projectId'])
        }
        expect(JSON.stringify(unitRpc)).not.toContain(YIMENG_TOKEN)
        expect(JSON.stringify(unitRpc)).not.toContain(IMAGO_ATTESTATION_KEY)
        expect(requests.filter(request => /provider|worker|generate|approval|select/i.test(request.path))).toEqual([])
        expect(units.getContractErrors()).toEqual([])
        expect(await panel.locator('video, img, audio, a').count()).toBe(0)
        expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
        expect(tripwire.pageErrors).toEqual([])
        await expectNoVisibleTechnicalBrand(page)
        productionUnitBrowserEvidence = {
          schema: 'qingmu.e5-5-production-unit-browser-evidence.v1', method, currentFeed, recovered, recordedFinding,
          unitRpc, unitPostCount: unitPosts.length, findingPostCount: findingPosts.length,
          recoveryReceiptGetCount: receipts.length, recoveryWindowGetCount: recoveryRequests.length,
          recoveryGetOnly: true, originalCoordinatesPreserved: true, lostResponseRetainedAcrossReload: true,
          recoveryWithoutCurrentSource: true, finalMarkerCount: (await markers()).length, automaticPostRetryCount: 0,
          ruleBindingCount: PRODUCTION_UNIT_BROWSER_RULE_PATHS.length, ruleRawShaVerified: true,
          groupNo: 3, explicitUnitId: PRODUCTION_UNIT_BROWSER_UNIT_ID, frameIds: [SHOT_RIVER_FIRST_FRAME_ID, PROMPT_IR_FRAME_ID],
          frameNos: [7, 12], storyboardRevision: 3, findingMatchedFrameContentSha256: 'b'.repeat(64),
          mobileOverflow, panelOverflow, bindControlHeight, refreshControlHeight,
          providerCalls: 0, planSealed: false, humanSignoffInferred: false, reworkExecuted: false,
          consoleErrors: browserConsoleErrors.slice(consoleStart), pageErrors: tripwire.pageErrors,
        }
      } finally {
        units.setMode('disabled')
        findings.setMode('unavailable')
        setVideoReviewMode('none')
        await page.setViewportSize({ width: 1680, height: 1100 })
        await dialog.getByRole('tab', { name: '总览', exact: true }).click()
        await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
        if (tracePath) {
          await mkdir(dirname(tracePath), { recursive: true })
          await page.context().tracing.stop({ path: tracePath })
        }
      }
    }, 120_000)

    it('renders and selects the canonical E5-3 Shot River through Yimeng, IMAGO, and Chromium', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e5-1-shot-relations'))
      const methodRequestStart = browserRpcRequests.length
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('tab', { name: '分镜与镜头' }).click()

      const shotRiver = dialog.getByRole('list', { name: '镜头选择' })
      const firstShotCard = shotRiver.getByRole('button', { name: /frame-z/ })
      const selectedShotCard = shotRiver.getByRole('button', { name: /frame-1/ })
      await firstShotCard.waitFor({ timeout: 15_000 })
      await selectedShotCard.waitFor({ timeout: 15_000 })
      const shotCards = shotRiver.getByRole('button')
      expect(await shotCards.allTextContents()).toEqual([
        '07走廊空镜frame-z1.25 秒0 句 · 0 已定时0/1 参考已绑定',
        '12雨夜车站frame-12.5 秒1 句 · 1 已定时1/3 参考已绑定',
      ])
      await firstShotCard.click()
      await expect.poll(() => browserRpcRequests.slice(methodRequestStart).filter(request =>
        request.path === '/qingmu-imago-method/shotRelationMethod'
        && isRecord(request.body)
        && isRecord(request.body.payload)
        && request.body.payload.selectedShotId === SHOT_RIVER_FIRST_FRAME_ID).length, { timeout: 20_000 }).toBe(1)
      const method = dialog.getByRole('region', { name: 'IMAGO 镜头关系方法' })
      await method.getByText('Scene / Shot / Beat / Element 关系检查', { exact: true }).waitFor({ timeout: 20_000 })
      const selectedMethodWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/shotRelationMethod')
      await selectedShotCard.click()
      const selectedMethodWire = await selectedMethodWirePromise
      const selectedMethodRpc = await selectedMethodWire.json() as unknown
      const selectedMethodRoot = isRecord(selectedMethodRpc) ? selectedMethodRpc : {}
      const selectedMethodResult = isRecord(selectedMethodRoot.result) ? selectedMethodRoot.result : {}
      const selectedMethodValue = isRecord(selectedMethodResult.value) ? selectedMethodResult.value : {}
      const selectedMethodProjection = isRecord(selectedMethodValue.projection) ? selectedMethodValue.projection : {}
      expect(selectedMethodResult.ok).toBe(true)
      expect(selectedMethodProjection).toEqual(expect.objectContaining({
        project_state_persisted: false,
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      }))
      await expect.poll(() => browserRpcRequests.slice(methodRequestStart).filter(request =>
        request.path === '/qingmu-imago-method/shotRelationMethod'
        && isRecord(request.body)
        && isRecord(request.body.payload)
        && request.body.payload.selectedShotId === PROMPT_IR_FRAME_ID).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
      await dialog.getByText('beat-frame-1-opening', { exact: true }).waitFor()
      await dialog.getByText('actor-1', { exact: true }).waitFor()
      await dialog.getByText('prop-1', { exact: true }).waitFor()
      await method.getByText('Scene / Shot / Beat / Element 关系检查', { exact: true }).waitFor({ timeout: 20_000 })
      await method.getByText('只读 · 零执行', { exact: true }).waitFor()
      await method.getByText('字段帮助', { exact: true }).waitFor()
      await method.getByText('检查清单', { exact: true }).waitFor()
      await method.getByText(
        'inspectCanonicalShotRelations · inspectShotRiverRhythmAndReferences',
        { exact: true },
      ).waitFor()

      const methodWire = browserRpcRequests.slice(methodRequestStart).findLast(request =>
        request.path === '/qingmu-imago-method/shotRelationMethod'
        && isRecord(request.body)
        && isRecord(request.body.payload)
        && request.body.payload.selectedShotId === PROMPT_IR_FRAME_ID)
      expect(methodWire).toBeDefined()
      if (methodWire === undefined || !isRecord(methodWire.body) || !isRecord(methodWire.body.payload)) {
        throw new Error('browser did not expose the bounded E5-3 shot-relation IMAGO request')
      }
      expect(methodWire.body.method).toBe('shotRelationMethod')
      expect(methodWire.body.payload).toEqual({
        projectId: 'project-1',
        episodeId: 'episode-1',
        episodeRevision: 3,
        storyboardRevisionId: PROMPT_IR_STORYBOARD_REVISION_ID,
        storyboardRevisionVersion: 1,
        storyboardSourceSha256: SHOT_RELATION_SOURCE_SHA,
        selectedShotId: PROMPT_IR_FRAME_ID,
        scenes: [{
          sceneId: 'scene-1',
          profileRevision: 3,
          snapshotSha256: '72'.repeat(32),
          elementIds: ['scene-1', 'actor-1', 'prop-1'],
        }],
        shots: [{
          shotId: SHOT_RIVER_FIRST_FRAME_ID,
          sceneId: 'scene-1',
          frameNo: 7,
          durationSec: 1.25,
          dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] },
          elementIds: ['scene-1'],
          beats: [],
        }, {
          shotId: PROMPT_IR_FRAME_ID,
          sceneId: 'scene-1',
          frameNo: 12,
          durationSec: 2.5,
          dialogueRhythm: {
            cueCount: 1,
            timedCueCount: 1,
            cues: [{
              schemaVersion: 'dialogue-cue-v2', lineId: 'line-frame-1-opening', speakerId: 'actor-1',
              verbatimText: '你终于来了。', plannedStartSec: 0.5, plannedEndSec: 1.5,
              timingVerified: true, legacy: false,
            }],
          },
          elementIds: ['actor-1', 'scene-1', 'prop-1'],
          beats: [{ beatId: 'beat-frame-1-opening', elementIds: ['actor-1', 'prop-1'] }],
        }],
        elements: [
          {
            elementId: 'scene-1', elementKind: 'scene', profileRevision: 3, snapshotSha256: '72'.repeat(32),
            currentReferenceAvailability: 'missing', currentReference: null,
          },
          {
            elementId: 'actor-1', elementKind: 'actor', profileRevision: 3, snapshotSha256: '73'.repeat(32),
            currentReferenceAvailability: 'available',
            currentReference: {
              assetId: 'asset-actor-1-current-reference', sha256: '75'.repeat(32),
              lineage: {
                projectId: 'project-1', sourceEpisodeId: 'episode-1', ownerType: 'actor', ownerId: 'actor-1',
                role: 'identity_board', generationJobId: 'job-actor-1-current-reference',
                sourceRevisionId: 'revision-actor-1-current-reference',
                formalConsistencyCheckId: 'check-actor-1-current-reference',
              },
            },
          },
          {
            elementId: 'prop-1', elementKind: 'prop', profileRevision: 5, snapshotSha256: '74'.repeat(32),
            currentReferenceAvailability: 'missing', currentReference: null,
          },
        ],
      })

      shotRiverBrowserEvidence = {
        schema: 'qingmu.e5-3-shot-river-browser-evidence.v1',
        renderedShotOrder: [SHOT_RIVER_FIRST_FRAME_ID, PROMPT_IR_FRAME_ID],
        frameNumbers: [7, 12],
        selectedShotId: PROMPT_IR_FRAME_ID,
        durationSec: 2.5,
        dialogueCueCount: 1,
        currentReferenceAssetId: 'asset-actor-1-current-reference',
        methodOperations: ['inspectCanonicalShotRelations', 'inspectShotRiverRhythmAndReferences'],
        methodProjectionSha256: selectedMethodValue.projectionSha256,
        projectStatePersisted: selectedMethodProjection.project_state_persisted,
        providerCalls: selectedMethodProjection.providerCalls,
        workerStarted: selectedMethodProjection.workerStarted,
        selectionExecuted: selectedMethodProjection.selection_executed,
        humanApprovalInferred: selectedMethodProjection.human_approval_inferred,
        humanSignoffInferred: selectedMethodProjection.human_signoff_inferred,
      }

      const evidencePath = process.env.QINGMU_E5_1_EVIDENCE_SCREENSHOT?.trim()
      if (evidencePath !== undefined && evidencePath !== '') {
        await mkdir(dirname(evidencePath), { recursive: true })
        await page.screenshot({ path: evidencePath, fullPage: true })
      }
      const methodEvidencePath = process.env.QINGMU_E5_1_METHOD_EVIDENCE_SCREENSHOT?.trim()
      if (methodEvidencePath !== undefined && methodEvidencePath !== '') {
        await method.scrollIntoViewIfNeeded()
        await mkdir(dirname(methodEvidencePath), { recursive: true })
        await page.screenshot({ path: methodEvidencePath, fullPage: true })
      }
      const shotRiverEvidencePath = process.env.QINGMU_E5_3_EVIDENCE_SCREENSHOT?.trim()
      if (shotRiverEvidencePath !== undefined && shotRiverEvidencePath !== '') {
        await shotRiver.scrollIntoViewIfNeeded()
        await mkdir(dirname(shotRiverEvidencePath), { recursive: true })
        await page.screenshot({ path: shotRiverEvidencePath, fullPage: true })
      }

      await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      const frameSelect = dialog.getByRole('combobox', { name: '故事板帧' })
      await frameSelect.waitFor({ timeout: 15_000 })
      expect(await frameSelect.inputValue()).toBe(PROMPT_IR_FRAME_ID)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])

      await dialog.getByRole('button', { name: '关闭青木制作驾驶舱' }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    }, 60_000)

    it('recovers a committed receipt after the response is lost to a same-tab reload without resubmitting', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-script-workspace'))
      const initialScriptReadCount = scriptReadRevisions.length
      const requestStart = capturedRequests.length
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

      expect(capturedRequests.slice(requestStart).filter(request => request.path.includes('/command-receipt'))).toEqual([])
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
      expect(capturedRequests.slice(requestStart).filter(request => request.path.includes('/command-receipt'))).toEqual([])
      await recoveredDialog.getByRole('button', { name: '查询并恢复原回执' }).click()

      await recoveredDialog.getByRole('heading', { name: '已恢复原始提交回执' })
        .waitFor({ timeout: 10_000 })
      await expect.poll(() => recoveredEditor.inputValue(), { timeout: 10_000 })
        .toBe(JSON.stringify(PROPOSED_SCRIPT, null, 2))
      await expect.poll(
        () => scriptReadRevisions.slice(initialScriptReadCount),
        { timeout: 10_000 },
      ).toEqual([3, 4, 4])
      expect(await recoveredDialog.getByText('receipt-1').count()).toBe(1)
      expect(await recoveredDialog.getByText('event-1').count()).toBe(1)
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:script-commit-recovery:v1:')))).toEqual([])

      const commands = capturedRequests.slice(requestStart).filter(request => request.method === 'POST')
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

      const recoveryRequests = capturedRequests.slice(requestStart).filter(request => request.path.includes('/command-receipt'))
      expect(recoveryRequests).toHaveLength(1)
      expect(recoveryRequests[0]).toMatchObject({
        method: 'GET',
        path: `/api/qingmu/projects/project-1/episodes/episode-1/change-sets/${CHANGE_SET_ID}/command-receipt`,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: undefined,
      })

      const health = capturedRequests.find(request => request.path === '/api/health')
      expect(health?.authorization).toBeUndefined()
      const heroMediaPath = `/api/qingmu/assets/${STORYBOARD_CANVAS_HERO_ASSET_ID}/content`
      const heroMediaRequests = capturedRequests.filter(request => request.path === heroMediaPath)
      expect(heroMediaRequests.length).toBeGreaterThan(0)
      expect(heroMediaRequests.every(request =>
        request.authorization === undefined && request.cookie === undefined)).toBe(true)
      const protectedRequests = capturedRequests.filter(request =>
        request.path !== '/api/health' && request.path !== heroMediaPath)
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
      await selectReloadedElement(recoveredDialog, '道具')

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
      await selectReloadedElement(recoveredDialog, '道具')
      const recoveredPropEditor = recoveredDialog.getByRole('textbox', { name: '环境／道具视觉提示词' })
      await expect.poll(() => recoveredPropEditor.inputValue(), { timeout: 15_000 }).toBe(PROP_UPDATED_PROMPT)
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
      expect(capturedRequests.filter(request =>
        !isReadOnlyProviderEvidenceRead(request) && /provider|worker/i.test(request.path))).toEqual([])
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
      await selectReloadedElement(recoveredDialog, '道具')

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
      expect(capturedRequests.filter(request =>
        !isReadOnlyProviderEvidenceRead(request) && /provider|worker/i.test(request.path))).toEqual([])
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
      await selectReloadedElement(recoveredDialog, '环境')
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
      expect(capturedRequests.filter(request => !isReadOnlyProviderEvidenceRead(request)
        && /(?:provider|worker|generate|generation-job)/i.test(request.path))).toEqual([])
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
      const openSelectedPromptIr = async (currentDialog: Locator): Promise<void> => {
        await currentDialog.getByRole('tab', { name: '分镜与镜头' }).click()
        await currentDialog.locator(`[data-shot-id="${SHOT_RIVER_FIRST_FRAME_ID}"]`).waitFor()
        await currentDialog.getByRole('region', { name: 'IMAGO 镜头关系方法' })
          .getByText('Scene / Shot / Beat / Element 关系检查', { exact: true }).waitFor({ timeout: 20_000 })
        const selectedRelationResponse = page.waitForResponse(response =>
          new URL(response.url()).pathname === '/qingmu-imago-method/shotRelationMethod')
        await currentDialog.getByRole('list', { name: '镜头选择' })
          .getByRole('button', { name: /frame-1/ }).click()
        await (await selectedRelationResponse).finished()
        await currentDialog.locator(`[data-shot-id="${PROMPT_IR_FRAME_ID}"]`).waitFor()
        await currentDialog.getByRole('tab', { name: '剧本与资产' }).click()
        await expect.poll(() => currentDialog.getByRole('combobox', { name: '故事板帧' }).inputValue())
          .toBe(PROMPT_IR_FRAME_ID)
      }

      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const initialEnterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await initialEnterButton.isVisible()) await initialEnterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByLabel('安全边界').getByText('EP1 · 雨夜').waitFor({ timeout: 15_000 })
      await openSelectedPromptIr(dialog)
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
      await openSelectedPromptIr(editRecoveryDialog)
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
      await openSelectedPromptIr(selectionRecoveryDialog)
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
      expect(capturedRequests.filter(request => !isReadOnlyProviderEvidenceRead(request)
        && /(?:provider|worker|generate|generation-job)/i.test(request.path))).toEqual([])
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    }, 120_000)

    it('edits the second E5-3 Shot through E5-2 Hero Canvas and recovers once with the old revision coordinates', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-e5-2-storyboard-canvas'))
      const proposalPath = `/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/${STORYBOARD_CANVAS_BASE_REVISION.revisionId}/frames/${PROMPT_IR_FRAME_ID}/storyboard-canvas/change-sets`
      const previewPath = `/api/qingmu/change-sets/${STORYBOARD_CANVAS_CHANGE_SET_ID}:preview`
      const commitPath = `/api/qingmu/change-sets/${STORYBOARD_CANVAS_CHANGE_SET_ID}:commit`
      const recoveryPath = `${proposalPath}/${STORYBOARD_CANVAS_CHANGE_SET_ID}/command-receipt`
      const workflowPath = '/api/episodes/episode-1/workflow-projection'
      const methodRequestStart = browserRpcRequests.length
      const workflowReadStart = capturedRequests.filter(request => request.path === workflowPath).length

      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const initialEnterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await initialEnterButton.isVisible()) await initialEnterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('tab', { name: '分镜与镜头' }).click()
      const shotRiver = dialog.getByRole('list', { name: '镜头选择' })
      await shotRiver.getByRole('button', { name: /frame-z/ }).click()
      await dialog.locator(`[data-shot-id="${SHOT_RIVER_FIRST_FRAME_ID}"]`).waitFor()
      await dialog.getByRole('region', { name: 'IMAGO 镜头关系方法' })
        .getByText('Scene / Shot / Beat / Element 关系检查', { exact: true }).waitFor({ timeout: 20_000 })
      const selectedRelationWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/shotRelationMethod')
      await shotRiver.getByRole('button', { name: /frame-1/ }).click()
      await (await selectedRelationWirePromise).finished()
      await dialog.locator(`[data-shot-id="${PROMPT_IR_FRAME_ID}"]`).waitFor({ timeout: 15_000 })
      expect(await shotRiver.getByRole('button').nth(1).getAttribute('aria-pressed')).toBe('true')
      const canvas = dialog.getByRole('region', { name: 'Hero Frame 故事板画布' })
      const canvasSvg = canvas.getByRole('img', { name: '已选 Hero Frame 与故事板标注画布' })
      await canvasSvg.waitFor({ timeout: 20_000 })
      const heroUrl = await canvasSvg.locator('image').getAttribute('href')
      expect(heroUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/qingmu\/assets\/hero-frame-asset-1\/content$/)
      if (heroUrl === null) throw new Error('E5-2 Hero Frame did not expose its loopback image URL')
      const decodedHero = await page.evaluate(async (source) => {
        const image = new Image()
        image.src = source
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, heroUrl)
      expect(decodedHero).toEqual({ width: 2, height: 2 })
      const browserConsoleErrorStart = browserConsoleErrors.length
      const failedBrowserRequestStart = failedBrowserRequests.length

      await canvas.getByRole('spinbutton', { name: '点 1 X' }).fill('1300')
      await canvas.getByRole('button', { name: '添加标注' }).click()
      const canvasEvidencePath = process.env.QINGMU_E5_2_CANVAS_EVIDENCE_SCREENSHOT?.trim()
      if (canvasEvidencePath !== undefined && canvasEvidencePath !== '') {
        await canvas.scrollIntoViewIfNeeded()
        await mkdir(dirname(canvasEvidencePath), { recursive: true })
        await page.screenshot({ path: canvasEvidencePath, fullPage: true })
      }

      await canvas.getByRole('button', { name: '运行 IMAGO 结构检查' }).click()
      await canvas.getByText('机器结构检查已通过（不是创意批准）', { exact: true }).waitFor({ timeout: 30_000 })
      const methodEvidencePath = process.env.QINGMU_E5_2_METHOD_EVIDENCE_SCREENSHOT?.trim()
      if (methodEvidencePath !== undefined && methodEvidencePath !== '') {
        await canvas.getByText('机器结构检查已通过（不是创意批准）', { exact: true }).scrollIntoViewIfNeeded()
        await mkdir(dirname(methodEvidencePath), { recursive: true })
        await page.screenshot({ path: methodEvidencePath, fullPage: true })
      }

      const methodWire = browserRpcRequests.slice(methodRequestStart).find(request =>
        request.path === '/qingmu-imago-method/heroFrameStoryboardMethod')
      expect(methodWire).toBeDefined()
      if (methodWire === undefined || !isRecord(methodWire.body) || !isRecord(methodWire.body.payload)) {
        throw new Error('browser did not expose the bounded E5-2 Hero Frame IMAGO request')
      }
      const methodPayload = methodWire.body.payload
      expect(methodWire.body.method).toBe('heroFrameStoryboardMethod')
      expect(methodPayload.selectedShotId).toBe(PROMPT_IR_FRAME_ID)
      expect(methodPayload.shots).toEqual([
        { shotId: SHOT_RIVER_FIRST_FRAME_ID, sceneId: 'scene-1', elementIds: ['scene-1'], beats: [] },
        {
          shotId: PROMPT_IR_FRAME_ID, sceneId: 'scene-1', elementIds: ['actor-1', 'scene-1', 'prop-1'],
          beats: [{ beatId: 'beat-frame-1-opening', elementIds: ['actor-1', 'prop-1'] }],
        },
      ])
      expect(methodPayload.elements).toEqual([
        { elementId: 'scene-1', elementKind: 'scene', profileRevision: 3, snapshotSha256: '72'.repeat(32) },
        { elementId: 'actor-1', elementKind: 'actor', profileRevision: 3, snapshotSha256: '73'.repeat(32) },
        { elementId: 'prop-1', elementKind: 'prop', profileRevision: 5, snapshotSha256: '74'.repeat(32) },
      ])
      expect(methodPayload.heroFrame).toEqual({
        assetId: STORYBOARD_CANVAS_HERO_ASSET_ID,
        mediaSha256: STORYBOARD_CANVAS_HERO_MEDIA_SHA,
      })
      expect(methodPayload.canvas).toEqual(expect.objectContaining({ baseCanvasSha256: null }))
      const methodCanvas = isRecord(methodPayload.canvas) ? methodPayload.canvas : {}
      const methodAnnotations = Array.isArray(methodCanvas.annotations) ? methodCanvas.annotations : []
      expect(methodAnnotations).toHaveLength(1)
      expect(methodAnnotations[0]).toEqual(expect.objectContaining({
        kind: 'subject_region',
        elementRef: { elementKind: 'actor', elementId: 'actor-1' },
        points: [{ x: 1300, y: 2500 }, { x: 7500, y: 7500 }],
      }))

      const previewWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/previewStoryboardCanvas')
      await canvas.getByRole('button', { name: '创建提案并读取技术预览' }).click()
      const previewWire = await previewWirePromise
      const previewRpc = await previewWire.json() as unknown
      const previewRpcRoot = isRecord(previewRpc) ? previewRpc : {}
      const previewRpcResult = isRecord(previewRpcRoot.result) ? previewRpcRoot.result : {}
      const previewValue = isRecord(previewRpcResult.value) ? previewRpcResult.value : {}
      expect(previewRpcResult.ok).toBe(true)
      expect(previewValue).toEqual(expect.objectContaining({
        schema: 'jason.qingmu-storyboard-canvas-preview.v1',
        providerCalls: 0,
        workerStarted: false,
        selectionExecuted: false,
        humanApprovalInferred: false,
        humanSignoff: false,
      }))
      await canvas.getByText('技术预览', { exact: true }).waitFor({ timeout: 20_000 })

      const proposalRequest = capturedRequests.find(request => request.path === proposalPath)
      if (proposalRequest === undefined || !isRecord(proposalRequest.body)) {
        throw new Error('E5-2 proposal did not reach the loopback Yimeng authority')
      }
      const proposalProjection = isRecord(proposalRequest.body.methodProjection)
        ? proposalRequest.body.methodProjection
        : {}
      const canvasProjection = isRecord(proposalProjection.canvas_projection)
        ? proposalProjection.canvas_projection
        : {}
      const rawAnnotations = Array.isArray(canvasProjection.rawAnnotations) ? canvasProjection.rawAnnotations : []
      const plainRawAnnotationsSha256 = canonicalSha256(rawAnnotations)
      const methodRawAnnotationsSha256 = canvasProjection.rawAnnotationsSha256
      expect(methodRawAnnotationsSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(methodRawAnnotationsSha256).not.toBe(plainRawAnnotationsSha256)
      expect(proposalRequest.body.heroFrameBindingSha256).toBe(STORYBOARD_CANVAS_HERO_BINDING_SHA)
      expect(proposalRequest.body.methodHeroFrameBindingSha256).not.toBe(STORYBOARD_CANVAS_HERO_BINDING_SHA)

      const commitButton = canvas.getByRole('button', { name: '提交权威画布' })
      expect(await commitButton.isDisabled()).toBe(true)
      await canvas.getByRole('checkbox', { name: '我确认把此技术预览提交到易梦权威画布' }).check()
      await commitButton.click()
      if (storyboardCanvasCommitAccepted === undefined) {
        throw new Error('isolated storyboard canvas commit gate was not initialized')
      }
      await storyboardCanvasCommitAccepted
      expect(capturedRequests.filter(request => request.path === commitPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([])
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:storyboard-canvas-commit-recovery:v1:')))).toEqual([
        `qingmu:storyboard-canvas-commit-recovery:v1:project-1:episode-1:${PROMPT_IR_FRAME_ID}`,
      ])

      await page.reload({ waitUntil: 'load' })
      releaseStoryboardCanvasCommitResponse?.()
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const recoveryEnterButton = page.getByRole('button', { name: '进入青木 OS' })
      if (await recoveryEnterButton.isVisible()) await recoveryEnterButton.click()
      await page.getByRole('button', { name: '青木制作台' }).click()
      const recoveryDialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await recoveryDialog.waitFor({ timeout: 10_000 })
      await recoveryDialog.getByRole('tab', { name: '分镜与镜头' }).click()
      await recoveryDialog.getByRole('region', { name: 'IMAGO 镜头关系方法' })
        .getByText('Scene / Shot / Beat / Element 关系检查', { exact: true }).waitFor({ timeout: 20_000 })
      const recoveryRelationWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-imago-method/shotRelationMethod')
      await recoveryDialog.getByRole('list', { name: '镜头选择' }).getByRole('button', { name: /frame-1/ }).click()
      await (await recoveryRelationWirePromise).finished()
      const recoveryCanvas = recoveryDialog.getByRole('region', { name: 'Hero Frame 故事板画布' })
      const recoveryButton = recoveryCanvas.getByRole('button', { name: '恢复原提交回执' })
      await recoveryButton.waitFor({ timeout: 20_000 })
      const recoveryWirePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/qingmu-yimeng-command/recoverStoryboardCanvasCommit')
      await recoveryButton.click()
      const recoveryWire = await recoveryWirePromise
      const recoveryRpc = await recoveryWire.json() as unknown
      const recoveryRpcRoot = isRecord(recoveryRpc) ? recoveryRpc : {}
      const recoveryRpcResult = isRecord(recoveryRpcRoot.result) ? recoveryRpcRoot.result : {}
      const recoveryValue = isRecord(recoveryRpcResult.value) ? recoveryRpcResult.value : {}
      const recoveredReceipt = isRecord(recoveryValue.receipt) ? recoveryValue.receipt : {}
      expect(recoveryRpcResult.ok).toBe(true)
      expect(recoveredReceipt.targetId).toBe(PROMPT_IR_FRAME_ID)
      expect(recoveredReceipt.rawAnnotationsSha256).toBe(plainRawAnnotationsSha256)
      expect(recoveredReceipt.methodRawAnnotationsSha256).toBe(methodRawAnnotationsSha256)
      expect(recoveredReceipt.rawAnnotationsSha256).not.toBe(recoveredReceipt.methodRawAnnotationsSha256)
      expect(recoveredReceipt.providerCalls).toBe(0)
      expect(recoveredReceipt.workerStarted).toBe(false)
      expect(recoveredReceipt.selectionExecuted).toBe(false)
      expect(recoveredReceipt.humanApprovalInferred).toBe(false)
      expect(recoveredReceipt.humanSignoff).toBe(false)
      await recoveryCanvas.getByText('权威画布已提交并完成回执恢复与刷新', { exact: true })
        .waitFor({ timeout: 20_000 })

      expect(capturedRequests.filter(request => request.path === proposalPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === previewPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === commitPath)).toHaveLength(1)
      expect(capturedRequests.filter(request => request.path === recoveryPath)).toEqual([
        expect.objectContaining({ method: 'GET', body: undefined }),
      ])
      const recoveryRequest = capturedRequests.find(request => request.path === recoveryPath)
      expect(recoveryRequest?.idempotencyKey).toBe(recoveredReceipt.idempotencyKey)
      expect(capturedRequests.filter(request => request.path === workflowPath).length)
        .toBeGreaterThan(workflowReadStart + 1)
      expect(await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('qingmu:storyboard-canvas-commit-recovery:v1:')))).toEqual([])
      expect(capturedRequests.filter(request => !isReadOnlyProviderEvidenceRead(request)
        && /(?:provider|worker|generate|generation-job)/i.test(request.path))).toEqual([])
      expect(await page.locator('html').innerHTML()).not.toContain(IMAGO_ATTESTATION_KEY)
      expect(await page.content()).not.toContain(YIMENG_TOKEN)
      await expectNoVisibleTechnicalBrand(page)

      const e5ConsoleErrors = browserConsoleErrors.slice(browserConsoleErrorStart)
      const e5FailedRequests = failedBrowserRequests.slice(failedBrowserRequestStart)
      const unexpectedFailedRequests = e5FailedRequests.filter(request => !(
        /(?:ABORTED|aborted|cancelled)/.test(request.errorText)
        && (
          (request.method === 'GET' && request.path === '/plugins/events')
          || (
            request.method === 'POST'
            && (
              request.path === '/qingmu-yimeng-command/commitStoryboardCanvas'
              // Leaving Overview after the intentional reload cancels its read-only advice request.
              || request.path === '/qingmu-imago-method/worksetMethod'
            )
          )
        )
      ))
      expect(e5ConsoleErrors).toEqual([])
      expect(unexpectedFailedRequests).toEqual([])
      expect(e5FailedRequests.filter(request => request.path === '/plugins/events').length).toBeLessThanOrEqual(1)
      expect(e5FailedRequests.filter(request =>
        request.path === '/qingmu-yimeng-command/commitStoryboardCanvas').length).toBeLessThanOrEqual(1)
      expect(e5FailedRequests.filter(request =>
        request.path === '/qingmu-imago-method/worksetMethod').length).toBeLessThanOrEqual(1)
      expect(e5FailedRequests.length).toBeLessThanOrEqual(3)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])

      storyboardCanvasBrowserEvidence = {
        schema: 'qingmu.e5-2-storyboard-canvas-browser-evidence.v1',
        shotRiverOrder: [SHOT_RIVER_FIRST_FRAME_ID, PROMPT_IR_FRAME_ID],
        selectedFrameNo: 12,
        frameId: PROMPT_IR_FRAME_ID,
        heroFrame: {
          assetId: STORYBOARD_CANVAS_HERO_ASSET_ID,
          mediaSha256: STORYBOARD_CANVAS_HERO_MEDIA_SHA,
          browserUrl: heroUrl,
          decodedWidth: decodedHero.width,
          decodedHeight: decodedHero.height,
        },
        editInput: { mechanism: 'numeric-input-and-button', point1X: 1300 },
        methodProjectionSha256: proposalRequest.body.methodProjectionSha256,
        plainRawAnnotationsSha256,
        methodRawAnnotationsSha256,
        hashesDistinct: true,
        proposalPostCount: capturedRequests.filter(request => request.path === proposalPath).length,
        previewPostCount: capturedRequests.filter(request => request.path === previewPath).length,
        commitPostCount: capturedRequests.filter(request => request.path === commitPath).length,
        recoveryMethod: recoveryRequest?.method,
        recoveryStoryboardRevisionId: STORYBOARD_CANVAS_BASE_REVISION.revisionId,
        authoritativeStoryboardRevisionId: STORYBOARD_CANVAS_AUTHORITATIVE_REVISION.revisionId,
        providerCalls: 0,
        workerStarted: false,
        selectionExecuted: false,
        humanApprovalInferred: false,
        humanSignoff: false,
        consoleErrors: e5ConsoleErrors,
        pageErrors: tripwire.pageErrors,
        failedRequests: e5FailedRequests,
        unexpectedFailedRequests,
      }
    }, 180_000)

    it('registers only the saved screenplay source and recovers its original receipt after source loss in Chromium', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-qingmu-stage-source'))
      if (stageSourceDouble === undefined || IMAGO_CORE_ROOT === undefined || IMAGO_CORE_ROOT === '') {
        throw new Error('Stage-source fixture controls missing')
      }
      const sources = stageSourceDouble
      const requestStart = capturedRequests.length
      const rpcStart = browserRpcRequests.length
      const consoleStart = browserConsoleErrors.length
      const tracePath = process.env.QINGMU_E5_5_STAGE_SOURCE_TRACE_PATH?.trim()
      if (tracePath) await page.context().tracing.start({ screenshots: true, snapshots: true })
      const nextWire = (path: string) => page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== path) return false
        const body = response.request().postDataJSON() as unknown
        if (!isRecord(body) || !isRecord(body.payload)) return false
        return body.payload.projectId === 'project-1' && body.payload.episodeId === 'episode-1'
      })
      const readWire = async (wire: ReturnType<typeof nextWire>) => {
        const response = await wire
        expect(response.status()).toBe(200)
        const raw = await response.json() as unknown
        if (!isRecord(raw) || !isRecord(raw.result)) throw new Error('Stage-source RPC carrier missing')
        return raw.result
      }
      const markers = () => page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => decodeURIComponent(key).startsWith('qingmu:stage-source-recovery:v1:'))
        .map(key => ({ key, value: sessionStorage.getItem(key) })))
      const base = '/api/qingmu/projects/project-1/episodes/episode-1/stage-sources'
      const bindingPath = `${base}/A1S/binding`
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const panel = dialog.getByRole('region', { name: '编剧方法的剧本来源', exact: true })
      sources.setMode('available')
      if (!await dialog.isVisible()) await page.getByRole('button', { name: '青木制作台' }).click()
      const initialRead = nextWire('/qingmu-yimeng/stageSources')
      const scriptRead = nextWire('/qingmu-yimeng/script')
      const methodRead = nextWire('/qingmu-imago-method/stageSourceMethod')
      await dialog.getByRole('tab', { name: '剧本与资产' }).click()
      try {
        const initialFeed = await readWire(initialRead)
        const script = await readWire(scriptRead)
        const method = await readWire(methodRead)
        expect(initialFeed.ok).toBe(true)
        expect(script.ok).toBe(true)
        expect(method.ok).toBe(true)
        if (!isRecord(initialFeed.value) || !isRecord(initialFeed.value.source) || !isRecord(script.value)
          || !isRecord(method.value) || !isRecord(method.value.projection)) throw new Error('Saved script source missing')
        const source = initialFeed.value.source
        const projection = method.value.projection
        expect(source).toEqual({ schema: 'jason.qingmu-stage-source.v1', projectId: 'project-1', episodeId: 'episode-1',
          sourceType: 'episode_script', sourceId: 'episode-1', revision: script.value.revision, contentSha256: script.value.scriptSha256 })
        expect(projection.subject).toEqual(source)
        expect(projection.subjectSnapshotSha256).toBe(canonicalSha256(source))
        expect(projection.definition).toMatchObject({ sourceUsage: 'source_reference_only',
          operation: 'bind_existing_episode_script_source', stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 })
        expect(method.value.projectionSha256).toBe(canonicalSha256(projection))
        if (!isRecord(projection.ruleBindings)) throw new Error('Source rule bindings missing')
        expect(Object.keys(projection.ruleBindings).sort()).toEqual([...STAGE_SOURCE_BROWSER_RULE_PATHS].sort())
        for (const path of STAGE_SOURCE_BROWSER_RULE_PATHS) {
          expect(projection.ruleBindings[path]).toBe(createHash('sha256').update(await readFile(join(IMAGO_CORE_ROOT, path))).digest('hex'))
        }
        const confirm = panel.getByRole('checkbox')
        await confirm.waitFor()
        expect(await confirm.isChecked()).toBe(false)
        const bind = panel.getByRole('button', { name: '确认登记剧本来源', exact: true })
        expect(await bind.isDisabled()).toBe(true)
        expect(await markers()).toEqual([])
        expect(capturedRequests.slice(requestStart).filter(request => request.method === 'POST')).toEqual([])
        const unsavedTitle = '尚未提交的来源回归草稿'
        await dialog.getByRole('textbox', { name: '结构化剧本 JSON', exact: true }).fill(JSON.stringify({
          scenes: [{ sceneIndex: 1, title: unsavedTitle, actionDescription: '这段改动仍是草稿。', dialogues: [] }],
        }))
        await confirm.check()
        await expect.poll(() => bind.isDisabled()).toBe(false)
        const bindControlHeight = (await bind.boundingBox())?.height
        expect(bindControlHeight).toBeGreaterThanOrEqual(44)
        sources.loseNextBindingResponse()
        const lostRead = nextWire('/qingmu-yimeng-command/bindStageSource')
        await bind.click()
        expect(await readWire(lostRead)).toMatchObject({ ok: false })
        await panel.getByText('来源登记未确认成功；若保留了恢复标记，请只查询原回执，不要重复提交。', { exact: true }).waitFor()
        const retainedMarkers = await markers()
        expect(retainedMarkers).toHaveLength(1)
        const retained = retainedMarkers[0]
        if (retained?.value === null || retained?.value === undefined) throw new Error('Source recovery intent missing')
        const intent: unknown = JSON.parse(retained.value)
        if (!isRecord(intent)) throw new Error('Source recovery intent must be an object')
        expect(Object.keys(intent).sort()).toEqual(['schema', 'projectId', 'episodeId', 'stageId', 'expectedSubjectSha256',
          'expectedBindingRevision', 'expectedBindingSha256', 'methodProjectionSha256', 'rulesSha256', 'idempotencyKey'].sort())
        expect(intent).toMatchObject({ projectId: 'project-1', episodeId: 'episode-1', stageId: 'A1S',
          expectedBindingRevision: 0, expectedBindingSha256: null, expectedSubjectSha256: projection.subjectSnapshotSha256,
          methodProjectionSha256: method.value.projectionSha256, rulesSha256: projection.rulesSha256 })
        expect(retained.value).not.toMatch(/signature|authSession|owner-fixture|methodAttestation/)
        expect(retained.value).not.toContain(YIMENG_TOKEN)
        expect(retained.value).not.toContain(IMAGO_ATTESTATION_KEY)
        expect(retained.value).not.toContain(unsavedTitle)
        const original = sources.getLatest()
        expect(original?.binding.source).toEqual(source)
        expect(original?.binding.bindingRevision).toBe(1)
        expect(await panel.getByText('当前已保存版本的来源已登记；未据此审核剧本。', { exact: true }).count()).toBe(0)

        sources.setMode('unavailable')
        const recoveryStart = capturedRequests.length
        const recoveryRpcStart = browserRpcRequests.length
        await page.reload()
        await page.getByRole('button', { name: '青木制作台' }).click()
        const unavailableRead = nextWire('/qingmu-yimeng/stageSources')
        await dialog.getByRole('tab', { name: '剧本与资产' }).click()
        expect(await readWire(unavailableRead)).toMatchObject({ ok: true, value: {
          source: null, subjectSnapshotSha256: null, latestBinding: original, currentBinding: null,
        } })
        expect(await markers()).toEqual(retainedMarkers)
        const recoveryRead = nextWire('/qingmu-yimeng-command/recoverStageSourceBinding')
        const recoveredFeedRead = nextWire('/qingmu-yimeng/stageSources')
        await panel.getByRole('button', { name: '查询原来源登记回执', exact: true }).click()
        const recovered = await readWire(recoveryRead)
        expect(recovered).toEqual({ ok: true, value: { schema: 'jason.qingmu-stage-source-recovery.v1', receipt: original } })
        expect(await readWire(recoveredFeedRead)).toMatchObject({ ok: true,
          value: { source: null, currentBinding: null, latestBinding: original } })
        await expect.poll(markers).toEqual([])
        await panel.getByText('旧来源登记保留；不适用于当前已保存剧本。', { exact: true }).waitFor()
        await panel.getByText('当前方法规则尚未核实；不据此判定旧登记有效。', { exact: true }).waitFor()
        const recoveryRequests = capturedRequests.slice(recoveryStart)
        expect(recoveryRequests.length).toBeGreaterThan(0)
        expect(recoveryRequests.every(request => request.method === 'GET' && request.body === undefined)).toBe(true)
        const receipts = recoveryRequests.filter(request => request.path.startsWith(`${bindingPath}/command-receipt?`))
        expect(receipts).toHaveLength(1)
        const receiptRequest = receipts[0]
        if (receiptRequest === undefined) throw new Error('Source original GET not observed')
        const query = new URL(receiptRequest.path, 'http://127.0.0.1').searchParams
        expect([...query.keys()]).toEqual(['expectedSubjectSha256'])
        expect(query.get('expectedSubjectSha256')).toBe(intent.expectedSubjectSha256)
        expect(receiptRequest.idempotencyKey).toBe(intent.idempotencyKey)
        expect(browserRpcRequests.slice(recoveryRpcStart).filter(request => request.path.endsWith('/stageSourceMethod'))).toEqual([])
        const historicalAria = await captureStableAria(page, 'role=region[name="编剧方法的剧本来源"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-stage-source-recovery/ui.expected.md'),
          historicalAria, scaffold.mode)
        const historicalPath = process.env.QINGMU_E5_5_STAGE_SOURCE_HISTORICAL_SCREENSHOT?.trim()
        if (historicalPath) {
          await mkdir(dirname(historicalPath), { recursive: true })
          await panel.getByRole('heading', { name: '编剧方法的剧本来源', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: historicalPath })
        }
        sources.setMode('available')
        const currentRead = nextWire('/qingmu-yimeng/stageSources')
        await panel.getByRole('button', { name: '重读剧本来源', exact: true }).click()
        const currentFeed = await readWire(currentRead)
        expect(currentFeed).toMatchObject({ ok: true, value: { source, latestBinding: original, currentBinding: original } })
        await panel.getByText('当前已保存版本的来源已登记；未据此审核剧本。', { exact: true }).waitFor()
        await panel.getByText('已登记方法与本次读取的规则一致。', { exact: true }).waitFor()
        expect(await panel.getByRole('checkbox').count()).toBe(0)
        const desktopPath = process.env.QINGMU_E5_5_STAGE_SOURCE_SCREENSHOT?.trim()
        if (desktopPath) {
          await mkdir(dirname(desktopPath), { recursive: true })
          await panel.getByRole('heading', { name: '编剧方法的剧本来源', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: desktopPath })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const panelOverflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth)
        expect(mobileOverflow).toBe(false)
        expect(panelOverflow).toBe(false)
        const refreshControlHeight = (await panel.getByRole('button', { name: '重读剧本来源', exact: true }).boundingBox())?.height
        expect(refreshControlHeight).toBeGreaterThanOrEqual(44)
        const mobilePath = process.env.QINGMU_E5_5_STAGE_SOURCE_MOBILE_SCREENSHOT?.trim()
        if (mobilePath) {
          await mkdir(dirname(mobilePath), { recursive: true })
          await panel.getByText('当前已保存版本的来源已登记；未据此审核剧本。', { exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: mobilePath })
        }
        sources.setMode('drifted')
        const driftRead = nextWire('/qingmu-yimeng/stageSources')
        await panel.getByRole('button', { name: '重读剧本来源', exact: true }).click()
        expect(await readWire(driftRead)).toMatchObject({ ok: true, value: { currentBinding: null, latestBinding: original,
          source: { ...source, contentSha256: 'c'.repeat(64) } } })
        await panel.getByText('旧来源登记保留；不适用于当前已保存剧本。', { exact: true }).waitFor()
        expect(await panel.getByRole('checkbox').count()).toBe(0)
        const requests = capturedRequests.slice(requestStart)
        const posts = requests.filter(request => request.method === 'POST')
        expect(posts).toHaveLength(1)
        expect(posts[0]?.path).toBe(bindingPath)
        const post = posts[0]?.body
        if (!isRecord(post)) throw new Error('Source binding POST body missing')
        expect(Object.keys(post).sort()).toEqual(['expectedSubjectSha256', 'expectedBindingRevision', 'expectedBindingSha256',
          'methodProjection', 'methodProjectionSha256', 'methodAttestation', 'idempotencyKey'].sort())
        expect(post).toMatchObject({ expectedSubjectSha256: intent.expectedSubjectSha256, expectedBindingRevision: 0,
          expectedBindingSha256: null, methodProjection: projection, idempotencyKey: intent.idempotencyKey })
        expect(JSON.stringify(post)).not.toContain(unsavedTitle)
        const sourceRpc = browserRpcRequests.slice(rpcStart)
          .filter(request => /stageSources|stageSourceMethod|bindStageSource|recoverStageSourceBinding/.test(request.path))
        expect(sourceRpc.filter(request => request.path.endsWith('/bindStageSource'))).toHaveLength(1)
        expect(sourceRpc.filter(request => request.path.endsWith('/recoverStageSourceBinding'))).toHaveLength(1)
        for (const request of sourceRpc.filter(request => /stageSources|stageSourceMethod/.test(request.path))) {
          const payload = isRecord(request.body) ? request.body.payload : undefined
          if (!isRecord(payload)) throw new Error('Source read coordinates missing')
          expect(Object.keys(payload).sort()).toEqual(request.path.endsWith('/stageSources')
            ? ['episodeId', 'projectId'] : ['episodeId', 'projectId', 'stageId'])
        }
        expect(JSON.stringify(sourceRpc)).not.toContain(YIMENG_TOKEN)
        expect(JSON.stringify(sourceRpc)).not.toContain(IMAGO_ATTESTATION_KEY)
        expect(requests.filter(request => /provider|worker|generate|approval|select/i.test(request.path))).toEqual([])
        expect(sources.getContractErrors()).toEqual([])
        expect(browserConsoleErrors.slice(consoleStart)).toEqual([])
        expect(tripwire.pageErrors).toEqual([])
        expect(await markers()).toEqual([])
        await expectNoVisibleTechnicalBrand(page)
        stageSourceBrowserEvidence = { schema: 'qingmu.e5-5-stage-source-browser-evidence.v1', source, method, recovered, currentFeed,
          sourceRpc, bindingPostCount: posts.length, recoveryReceiptGetCount: receipts.length,
          recoveryWindowGetCount: recoveryRequests.length,
          savedScriptOnly: true, unsavedDraftIgnored: true, recoveryGetOnly: true, sourceLossRecoveryVerified: true,
          contentOnlyDriftInvalidatesCurrent: true, finalMarkerCount: (await markers()).length, automaticPostRetryCount: 0,
          ruleBindingCount: STAGE_SOURCE_BROWSER_RULE_PATHS.length, ruleRawShaVerified: true,
          mobileOverflow, panelOverflow, bindControlHeight, refreshControlHeight, providerCalls: 0,
          stageArtifactCreated: false, stageApprovalGranted: false, lockActivated: false, planSealed: false,
          humanSignoffInferred: false, reworkExecuted: false,
          consoleErrors: browserConsoleErrors.slice(consoleStart), pageErrors: tripwire.pageErrors }
      } finally {
        sources.setMode('unavailable')
        await page.setViewportSize({ width: 1680, height: 1100 })
        if (tracePath) {
          await mkdir(dirname(tracePath), { recursive: true })
          await page.context().tracing.stop({ path: tracePath })
        }
      }
    }, 120_000)
  },
)
