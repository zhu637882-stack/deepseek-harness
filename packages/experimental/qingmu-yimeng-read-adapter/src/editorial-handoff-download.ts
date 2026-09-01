/** Same-origin Host download bridge for the authenticated Writer OTIO package. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const DOWNLOAD_PATH = '/api/qingmu/editorial-handoff/download'
const STATUS_PATH = '/api/qingmu/editorial-handoff/download-status'
const IMPORT_PATH = '/api/qingmu/editorial-handoff/import'
const IMPORT_STATUS_PATH = '/api/qingmu/editorial-handoff/import-status'
const MASTER_PATH = '/api/qingmu/editorial-handoff/master-preflight'
const MASTER_STATUS_PATH = '/api/qingmu/editorial-handoff/master-preflight-status'
const CANDIDATE_PATH = '/api/qingmu/editorial-handoff/returned-master-candidate'
const CANDIDATE_STATUS_PATH = '/api/qingmu/editorial-handoff/returned-master-candidate-status'
const CANDIDATE_LIST_PATH = '/api/qingmu/editorial-handoff/returned-master-candidates'
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const REQUEST_ID = /^[a-f0-9-]{16,80}$/
const CAPABILITY = /^[a-f0-9]{64}$/
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024
const MAX_MASTER_BYTES = 32 * 1024 * 1024 * 1024
const STATUS_TTL_MS = 24 * 60 * 60_000
const EDITORIAL_IMPORT_DOMAIN = 'qingmu-editorial-handoff-import.v1'
const EDITORIAL_MASTER_DOMAIN = 'qingmu-editorial-master-preflight.v1'
const EDITORIAL_MASTER_CANDIDATE_DOMAIN = 'qingmu-editorial-master-candidate-commit.v1'

interface DownloadBinding {
  readonly authenticatedUserId: string
  readonly projectId: string
  readonly episodeId: string
  readonly sourceSnapshotSha256: string
  readonly projectionSha256: string
  readonly requestId: string
}

type BrowserDownloadBinding = Omit<DownloadBinding, 'authenticatedUserId'>

type DownloadStatus =
  | { readonly state: 'authorized'; readonly createdAt: number }
  | { readonly state: 'running'; readonly createdAt: number }
  | { readonly state: 'succeeded'; readonly createdAt: number; readonly sha256: string; readonly size: number }
  | { readonly state: 'failed'; readonly createdAt: number; readonly errorCode: string }

interface PersistedDownload extends DownloadBinding {
  readonly capabilitySha256: string
  readonly status: DownloadStatus
}

interface ImportBinding extends Omit<DownloadBinding, 'requestId'> {
  readonly requestId: string
  readonly downloadRequestId: string
  readonly packageSha256: string
  readonly packageSize: number
}

type ImportStatus =
  | { readonly state: 'authorized'; readonly createdAt: number }
  | { readonly state: 'running'; readonly createdAt: number }
  | { readonly state: 'succeeded'; readonly createdAt: number; readonly result: EditorialHandoffImportResult }
  | { readonly state: 'failed'; readonly createdAt: number; readonly errorCode: string }

interface PersistedImport extends ImportBinding {
  readonly capabilitySha256: string
  readonly status: ImportStatus
}

interface MasterBinding extends Omit<ImportBinding, 'requestId'> {
  readonly requestId: string
  readonly importRequestId: string
}

type MasterStatus =
  | { readonly state: 'authorized'; readonly createdAt: number }
  | { readonly state: 'running'; readonly createdAt: number }
  | { readonly state: 'succeeded'; readonly createdAt: number; readonly result: EditorialMasterPreflightResult }
  | { readonly state: 'failed'; readonly createdAt: number; readonly errorCode: string }

interface PersistedMaster extends MasterBinding {
  /** Stable receipt lineage; unlike requestId it is not rotated with browser recovery capability. */
  readonly receiptRequestId: string
  readonly capabilitySha256: string
  readonly status: MasterStatus
}

interface CandidateBinding extends Omit<MasterBinding, 'requestId'> {
  readonly requestId: string
  readonly preflightRequestId: string
  readonly preflightSha256: string
  readonly masterSha256: string
  readonly masterSize: number
  readonly mimeType: 'video/mp4' | 'video/quicktime' | 'video/webm'
}

type CandidateStatus =
  | { readonly state: 'authorized'; readonly createdAt: number }
  | { readonly state: 'running'; readonly createdAt: number }
  | { readonly state: 'unknown'; readonly createdAt: number; readonly errorCode: string }
  | { readonly state: 'succeeded'; readonly createdAt: number; readonly result: EditorialMasterCandidateResult }
  | { readonly state: 'failed'; readonly createdAt: number; readonly errorCode: string }

interface PersistedCandidate extends CandidateBinding {
  readonly capabilitySha256: string
  readonly status: CandidateStatus
}

/** One-use Host capability for reselecting an exact successful download. */
export interface EditorialHandoffImportAccess {
  readonly requestId: string
  readonly capability: string
}

/** One-use Host capability for a returned-master preflight bound to one verified import receipt. */
export interface EditorialMasterPreflightAccess {
  readonly requestId: string
  readonly capability: string
}

/** One-use Host capability for explicitly saving the exact successful preflight bytes. */
export interface EditorialMasterCandidateAccess {
  readonly requestId: string
  readonly capability: string
}

/** Strict read-only Writer result for one local returned-master technical preflight. */
export interface EditorialMasterPreflightResult {
  readonly schema: 'jason.qingmu-editorial-master-preflight.v1'
  readonly preflightSha256: string
  readonly projectId: string
  readonly episodeId: string
  readonly binding: {
    readonly sourceSnapshotSha256: string
    readonly projectionSha256: string
    readonly downloadRequestId: string
    readonly importRequestId: string
    readonly packageSha256: string
    readonly packageSize: number
  }
  readonly master: {
    readonly sha256: string
    readonly size: number
    readonly mimeType: string | null
    readonly container: string | null
    readonly formatName: string | null
    readonly durationSec: number | null
    readonly width: number | null
    readonly height: number | null
    readonly fps: number | null
    readonly videoStreams: readonly Record<string, unknown>[]
    readonly audioStreams: readonly Record<string, unknown>[]
    readonly blockers: readonly string[]
  }
  readonly checks: {
    readonly currentAuthorityMatches: true
    readonly packageReceiptBound: true
    readonly containerVerified: boolean
    readonly probeSucceeded: boolean
  }
  readonly blockers: readonly string[]
  readonly unresolved: readonly string[]
  readonly readOnly: true
  readonly businessMutations: 0
  readonly providerCalls: 0
  readonly boundaries: {
    readonly nleOpened: false
    readonly editorConsumed: false
    readonly formalReturnRecorded: false
    readonly releaseReady: false
    readonly humanSignoffInferred: false
  }
}

/** Strict Writer receipt for one unselected returned-master candidate. */
export interface EditorialMasterCandidateResult {
  readonly schema: 'jason.qingmu-returned-master-candidate-result.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly assetId: string
  readonly storageKey: string
  readonly masterSha256: string
  readonly materializedSha256: string
  readonly byteSize: number
  readonly mimeType: 'video/mp4' | 'video/quicktime' | 'video/webm'
  readonly durationSec: number
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly packageSha256: string
  readonly sourceSnapshotSha256: string
  readonly projectionSha256: string
  readonly downloadRequestId: string
  readonly importRequestId: string
  readonly preflightRequestId: string
  readonly preflightSha256: string
  readonly qualityStatus: 'pending'
  readonly selectionStatus: 'Unselected'
  readonly isSelected: false
  readonly approved: false
  readonly published: false
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly commandReceiptId: string
  readonly changeSetId: string
  readonly eventId: string
  readonly savedAt: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
  readonly selectionGranted: false
  readonly releaseGranted: false
  readonly humanSignoffInferred: false
}

/** Strict read-only Writer result exposed as an editorial consumption preview. */
export interface EditorialHandoffImportResult {
  readonly schema: 'jason.qingmu-editorial-package-consumption-preview.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly packageSha256: string
  readonly packageSize: number
  readonly receiptMatch: true
  readonly internalValidity: true
  readonly currentAuthority: {
    readonly matches: boolean
    readonly sourceSnapshotSha256: string | null
    readonly projectionSha256: string | null
    readonly errorCode: string | null
  }
  readonly packageBinding: {
    readonly sourceSnapshotSha256: string
    readonly projectionSha256: string
  }
  readonly preview: {
    readonly tracks: readonly { readonly name: string; readonly kind: string; readonly clipCount: number }[]
    readonly orderedShots: readonly Record<string, unknown>[]
    readonly media: readonly { readonly kind: string; readonly path: string; readonly size: number; readonly sha256: string }[]
    readonly unresolved: readonly Record<string, unknown>[]
  }
  readonly readOnly: true
  readonly businessMutations: 0
  readonly providerCalls: 0
  readonly boundaries: {
    readonly nleOpened: false
    readonly productionComplete: false
    readonly releaseReady: false
    readonly humanSignoffInferred: false
  }
}

/** Browser-visible, narrowly bound capability issued only with an authenticated read projection. */
export interface EditorialHandoffDownloadAccess {
  readonly requestId: string
  readonly capability: string
  readonly importAccess?: EditorialHandoffImportAccess
}

/** Durable Host-side capability and terminal-status store; it contains no Writer token. */
export class EditorialHandoffDownloadAuthorizer {
  readonly #entries = new Map<string, PersistedDownload>()
  readonly #imports = new Map<string, PersistedImport>()
  readonly #masters = new Map<string, PersistedMaster>()
  readonly #candidates = new Map<string, PersistedCandidate>()

  public constructor(private readonly stateFile: string) {
    this.#load()
    this.#loadImports()
    this.#loadMasters()
    this.#loadCandidates()
  }

  /**
   * Issue one capability bound to the exact current handoff projection.
   * @param binding - Authenticated project, episode, source, and projection identity.
   * @returns A one-use browser capability whose clear value is not persisted.
   */
  public issue(binding: Omit<DownloadBinding, 'requestId'>): EditorialHandoffDownloadAccess {
    this.#sweep()
    const importAccess = this.#issueImportForBinding(binding)
    const requestId = randomUUID()
    const capability = randomBytes(32).toString('hex')
    this.#entries.set(requestId, {
      ...binding,
      requestId,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: { state: 'authorized', createdAt: Date.now() },
    })
    this.#persist()
    return { requestId, capability, ...(importAccess === undefined ? {} : { importAccess }) }
  }

  /**
   * Read a capability's current status without changing it.
   * @param binding - Exact projection and request identity.
   * @param capability - Clear one-use capability returned by `issue`.
   * @returns Current status, or undefined when authentication or binding fails.
   */
  public status(binding: DownloadBinding, capability: string): DownloadStatus | undefined {
    this.#sweep()
    const entry = this.#authenticated(binding, capability)
    return entry?.status
  }

  /**
   * Atomically consume an authorized capability before any Writer request.
   * @param binding - Exact projection and request identity.
   * @param capability - Clear one-use capability returned by `issue`.
   * @returns True only for the first authenticated start.
   */
  public start(binding: DownloadBinding, capability: string): boolean {
    this.#sweep()
    const entry = this.#authenticated(binding, capability)
    if (entry?.status.state !== 'authorized') return false
    this.#entries.set(binding.requestId, {
      ...entry,
      status: { state: 'running', createdAt: entry.status.createdAt },
    })
    this.#persist()
    return true
  }

  /**
   * Persist a terminal result for later status recovery.
   * @param binding - Exact projection and request identity.
   * @param status - Verified success facts or a stable failure code.
   */
  public finish(binding: DownloadBinding, status: Extract<DownloadStatus, { state: 'succeeded' | 'failed' }>): void {
    const entry = this.#entries.get(binding.requestId)
    if (entry === undefined || !sameBinding(entry, binding)) return
    this.#entries.set(binding.requestId, { ...entry, status })
    this.#persist()
  }

  /**
   * Issue an import capability from one authenticated successful download terminal.
   * @param binding - Exact authenticated download identity and source coordinates.
   * @param capability - Clear download capability whose hash is persisted by Host.
   * @returns A new one-use import capability, or undefined before download success.
   */
  public issueImport(binding: DownloadBinding, capability: string): EditorialHandoffImportAccess | undefined {
    this.#sweep()
    const entry = this.#authenticated(binding, capability)
    return entry?.status.state === 'succeeded' ? this.#createImport(entry) : undefined
  }

  /**
   * Atomically consume an import capability before reading browser bytes.
   * @param authenticatedUserId - Current Writer-authenticated user identity.
   * @param projectId - Current project scope.
   * @param episodeId - Current episode scope.
   * @param requestId - Import request identity.
   * @param capability - Clear one-use import capability.
   * @returns Immutable expected package binding, or undefined on mismatch or reuse.
   */
  public startImport(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): ImportBinding | undefined {
    this.#sweep()
    const entry = this.#authenticatedImport(authenticatedUserId, projectId, episodeId, requestId, capability)
    if (entry?.status.state !== 'authorized') return undefined
    this.#imports.set(requestId, { ...entry, status: { state: 'running', createdAt: entry.status.createdAt } })
    this.#persistImports()
    const { capabilitySha256: _capabilitySha256, status: _status, ...binding } = entry
    return binding
  }

  /**
   * Read an import's status without creating or resending verification work.
   * @param authenticatedUserId - Current Writer-authenticated user identity.
   * @param projectId - Current project scope.
   * @param episodeId - Current episode scope.
   * @param requestId - Import request identity.
   * @param capability - Clear import capability.
   * @returns Current import status, or undefined when authentication or binding fails.
   */
  public importStatus(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): ImportStatus | undefined {
    this.#sweep()
    return this.#authenticatedImport(authenticatedUserId, projectId, episodeId, requestId, capability)?.status
  }

  /**
   * Persist one terminal import result for refresh and restart recovery.
   * @param binding - Immutable package and authority binding returned by `startImport`.
   * @param status - Strict Writer success result or stable failure code.
   */
  public finishImport(
    binding: ImportBinding,
    status: Extract<ImportStatus, { state: 'succeeded' | 'failed' }>,
  ): void {
    const entry = this.#imports.get(binding.requestId)
    if (entry === undefined || !sameImportBinding(entry, binding)) return
    this.#imports.set(binding.requestId, { ...entry, status })
    this.#persistImports()
  }

  /**
   * Issue or rotate one canonical returned-master capability from a successful import receipt.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project that owns the successful import receipt.
   * @param episodeId - Episode that owns the successful import receipt.
   * @param importRequestId - Canonical package-import request identifier.
   * @param importCapability - Secret capability paired with the import request.
   * @returns A rotated preflight capability, or `undefined` when the receipt is not eligible.
   */
  public issueMaster(
    authenticatedUserId: string, projectId: string, episodeId: string,
    importRequestId: string, importCapability: string,
  ): EditorialMasterPreflightAccess | undefined {
    this.#sweep()
    const source = this.#authenticatedImport(
      authenticatedUserId, projectId, episodeId, importRequestId, importCapability,
    )
    if (source?.status.state !== 'succeeded') return undefined
    const recovered = [...this.#masters.values()].find(entry => sameMasterReceipt(entry, source))
    if (recovered?.status.state === 'running') return undefined
    if (recovered !== undefined) return this.#rotateMaster(recovered)
    const requestId = randomUUID()
    const capability = randomBytes(32).toString('hex')
    this.#masters.set(requestId, {
      authenticatedUserId: source.authenticatedUserId,
      projectId: source.projectId,
      episodeId: source.episodeId,
      sourceSnapshotSha256: source.sourceSnapshotSha256,
      projectionSha256: source.projectionSha256,
      requestId,
      receiptRequestId: requestId,
      downloadRequestId: source.downloadRequestId,
      importRequestId: source.requestId,
      packageSha256: source.packageSha256,
      packageSize: source.packageSize,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: { state: 'authorized', createdAt: Date.now() },
    })
    this.#persistMasters()
    return { requestId, capability }
  }

  /**
   * Atomically consume one returned-master capability before reading browser bytes.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project bound to the capability.
   * @param episodeId - Episode bound to the capability.
   * @param requestId - Returned-master preflight request identifier.
   * @param capability - Secret capability paired with the preflight request.
   * @returns Immutable receipt binding, or `undefined` when consumption is not allowed.
   */
  public startMaster(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): MasterBinding | undefined {
    this.#sweep()
    const entry = this.#authenticatedMaster(authenticatedUserId, projectId, episodeId, requestId, capability)
    if (entry?.status.state !== 'authorized') return undefined
    this.#masters.set(requestId, { ...entry, status: { state: 'running', createdAt: entry.status.createdAt } })
    this.#persistMasters()
    const {
      capabilitySha256: _capabilitySha256,
      receiptRequestId: _receiptRequestId,
      status: _status,
      ...binding
    } = entry
    return binding
  }

  /**
   * Read canonical returned-master preflight state without resending bytes.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project bound to the capability.
   * @param episodeId - Episode bound to the capability.
   * @param requestId - Returned-master preflight request identifier.
   * @param capability - Secret capability paired with the preflight request.
   * @returns Canonical preflight state, or `undefined` when the scope is not authorized.
   */
  public masterStatus(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): MasterStatus | undefined {
    this.#sweep()
    return this.#authenticatedMaster(authenticatedUserId, projectId, episodeId, requestId, capability)?.status
  }

  /**
   * Persist one terminal returned-master result for refresh and restart recovery.
   * @param binding - Immutable receipt and authority binding returned by `startMaster`.
   * @param status - Strict Writer success result or stable failure code.
   */
  public finishMaster(
    binding: MasterBinding,
    status: Extract<MasterStatus, { state: 'succeeded' | 'failed' }>,
  ): void {
    const entry = this.#masters.get(binding.requestId)
    if (entry === undefined || !sameMasterBinding(entry, binding)) return
    this.#masters.set(binding.requestId, { ...entry, status })
    this.#persistMasters()
  }

  /**
   * Issue a separate one-use save capability only for one blocker-free preflight.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project bound to the preflight.
   * @param episodeId - Episode bound to the preflight.
   * @param preflightRequestId - Returned-master preflight access identifier.
   * @param preflightCapability - Secret capability paired with the preflight access.
   * @returns Stable candidate access, or `undefined` when the preflight cannot authorize a save.
   */
  public issueCandidate(
    authenticatedUserId: string, projectId: string, episodeId: string,
    preflightRequestId: string, preflightCapability: string,
  ): EditorialMasterCandidateAccess | undefined {
    this.#sweep()
    const master = this.#authenticatedMaster(
      authenticatedUserId, projectId, episodeId, preflightRequestId, preflightCapability,
    )
    if (master?.status.state !== 'succeeded') return undefined
    const result = master.status.result
    if (result.blockers.length > 0 || result.master.mimeType === null
      || result.master.durationSec === null || result.master.width === null
      || result.master.height === null || result.master.fps === null) return undefined
    const requestId = createHash('sha256').update([
      'qingmu-returned-master-candidate.v1', authenticatedUserId, projectId, episodeId,
      master.receiptRequestId, result.preflightSha256, result.master.sha256,
    ].join('\n')).digest('hex')
    const recovered = this.#candidates.get(requestId)
    if (recovered?.status.state === 'running') return undefined
    // Derive the child capability from the already authenticated preflight
    // capability so polling/recovering the same successful preflight returns
    // the same child authority instead of silently invalidating the value the
    // browser already holds. A rotated preflight capability still rotates this
    // child authority, and only the Host ever performs the derivation.
    const capability = createHmac('sha256', Buffer.from(preflightCapability, 'utf8'))
      .update(`qingmu-returned-master-candidate-capability.v1\n${requestId}`)
      .digest('hex')
    const binding: CandidateBinding = {
      authenticatedUserId, projectId, episodeId,
      sourceSnapshotSha256: master.sourceSnapshotSha256,
      projectionSha256: master.projectionSha256,
      requestId, downloadRequestId: master.downloadRequestId,
      importRequestId: master.importRequestId, preflightRequestId: master.receiptRequestId,
      packageSha256: master.packageSha256, packageSize: master.packageSize,
      preflightSha256: result.preflightSha256,
      masterSha256: result.master.sha256, masterSize: result.master.size,
      mimeType: result.master.mimeType as CandidateBinding['mimeType'],
    }
    this.#candidates.set(requestId, {
      ...binding,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: recovered?.status.state === 'failed'
        ? { state: 'authorized', createdAt: Date.now() }
        : recovered?.status ?? { state: 'authorized', createdAt: Date.now() },
    })
    this.#persistCandidates()
    return { requestId, capability }
  }

  /**
   * Atomically consume one candidate capability before sending the stored master once.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project bound to the candidate.
   * @param episodeId - Episode bound to the candidate.
   * @param requestId - Stable candidate receipt identifier.
   * @param capability - Secret capability paired with the candidate request.
   * @returns Immutable candidate binding, or `undefined` when consumption is not allowed.
   */
  public startCandidate(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): CandidateBinding | undefined {
    this.#sweep()
    const entry = this.#authenticatedCandidate(
      authenticatedUserId, projectId, episodeId, requestId, capability,
    )
    if (entry?.status.state !== 'authorized') return undefined
    this.#candidates.set(requestId, {
      ...entry, status: { state: 'running', createdAt: entry.status.createdAt },
    })
    this.#persistCandidates()
    const { capabilitySha256: _capabilitySha256, status: _status, ...binding } = entry
    return binding
  }

  /**
   * Read candidate submission state without resending the master bytes.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project bound to the candidate.
   * @param episodeId - Episode bound to the candidate.
   * @param requestId - Stable candidate receipt identifier.
   * @param capability - Secret capability paired with the candidate request.
   * @returns Canonical candidate state, or `undefined` when the scope is not authorized.
   */
  public candidateStatus(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): CandidateStatus | undefined {
    this.#sweep()
    return this.#authenticatedCandidate(
      authenticatedUserId, projectId, episodeId, requestId, capability,
    )?.status
  }

  /**
   * Return the immutable persisted binding for read-only receipt recovery.
   * @param authenticatedUserId - Current Writer-authenticated user identifier.
   * @param projectId - Project bound to the candidate.
   * @param episodeId - Episode bound to the candidate.
   * @param requestId - Stable candidate receipt identifier.
   * @param capability - Secret capability paired with the candidate request.
   * @returns Immutable candidate binding, or `undefined` when the scope is not authorized.
   */
  public candidateBinding(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): CandidateBinding | undefined {
    this.#sweep()
    const entry = this.#authenticatedCandidate(
      authenticatedUserId, projectId, episodeId, requestId, capability,
    )
    if (entry === undefined) return undefined
    const { capabilitySha256: _capabilitySha256, status: _status, ...binding } = entry
    return binding
  }

  /**
   * Persist one terminal or ambiguous candidate outcome for restart-safe recovery.
   * @param binding - Immutable candidate binding returned by `startCandidate`.
   * @param status - Strict Writer result, stable failure, or ambiguous submission state.
   */
  public finishCandidate(
    binding: CandidateBinding,
    status: Extract<CandidateStatus, { state: 'succeeded' | 'failed' | 'unknown' }>,
  ): void {
    const entry = this.#candidates.get(binding.requestId)
    if (entry === undefined || !sameCandidateBinding(entry, binding)) return
    this.#candidates.set(binding.requestId, { ...entry, status })
    this.#persistCandidates()
  }

  #rotateMaster(recovered: PersistedMaster): EditorialMasterPreflightAccess {
    const requestId = randomUUID()
    const capability = randomBytes(32).toString('hex')
    this.#masters.delete(recovered.requestId)
    this.#masters.set(requestId, {
      ...recovered,
      requestId,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: recovered.status.state === 'failed'
        ? { state: 'authorized', createdAt: Date.now() }
        : recovered.status,
    })
    this.#persistMasters()
    return { requestId, capability }
  }

  #issueImportForBinding(binding: Omit<DownloadBinding, 'requestId'>): EditorialHandoffImportAccess | undefined {
    const succeeded = [...this.#entries.values()].filter(entry => entry.status.state === 'succeeded'
      && sameProjectionBinding(entry, binding)).sort((left, right) => right.status.createdAt - left.status.createdAt)[0]
    return succeeded === undefined ? undefined : this.#createImport(succeeded)
  }

  #rotateImport(recovered: PersistedImport): EditorialHandoffImportAccess {
    const requestId = randomUUID()
    const capability = randomBytes(32).toString('hex')
    this.#imports.delete(recovered.requestId)
    this.#imports.set(requestId, {
      ...recovered,
      requestId,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: recovered.status.state === 'failed'
        ? { state: 'authorized', createdAt: Date.now() }
        : recovered.status,
    })
    this.#persistImports()
    return { requestId, capability }
  }

  #createImport(download: PersistedDownload): EditorialHandoffImportAccess | undefined {
    if (download.status.state !== 'succeeded') throw new Error('editorial handoff: import source is not terminal')
    const terminal = download.status
    const recovered = [...this.#imports.values()].find(entry => sameImportReceipt(entry, download))
    if (recovered?.status.state === 'running') return undefined
    if (recovered !== undefined) return this.#rotateImport(recovered)
    const requestId = randomUUID()
    const capability = randomBytes(32).toString('hex')
    this.#imports.set(requestId, {
      authenticatedUserId: download.authenticatedUserId,
      projectId: download.projectId,
      episodeId: download.episodeId,
      sourceSnapshotSha256: download.sourceSnapshotSha256,
      projectionSha256: download.projectionSha256,
      requestId,
      downloadRequestId: download.requestId,
      packageSha256: terminal.sha256,
      packageSize: terminal.size,
      capabilitySha256: createHash('sha256').update(capability).digest('hex'),
      status: { state: 'authorized', createdAt: Date.now() },
    })
    this.#persistImports()
    return { requestId, capability }
  }

  #authenticatedImport(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): PersistedImport | undefined {
    if (!REQUEST_ID.test(requestId) || !CAPABILITY.test(capability)) return undefined
    const entry = this.#imports.get(requestId)
    if (entry === undefined || entry.authenticatedUserId !== authenticatedUserId
      || entry.projectId !== projectId || entry.episodeId !== episodeId) return undefined
    const actual = Buffer.from(createHash('sha256').update(capability).digest('hex'))
    const expected = Buffer.from(entry.capabilitySha256)
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? entry : undefined
  }

  #authenticatedMaster(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): PersistedMaster | undefined {
    if (!REQUEST_ID.test(requestId) || !CAPABILITY.test(capability)) return undefined
    const entry = this.#masters.get(requestId)
    if (entry === undefined || entry.authenticatedUserId !== authenticatedUserId
      || entry.projectId !== projectId || entry.episodeId !== episodeId) return undefined
    const actual = Buffer.from(createHash('sha256').update(capability).digest('hex'))
    const expected = Buffer.from(entry.capabilitySha256)
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? entry : undefined
  }

  #authenticatedCandidate(
    authenticatedUserId: string, projectId: string, episodeId: string,
    requestId: string, capability: string,
  ): PersistedCandidate | undefined {
    if (!REQUEST_ID.test(requestId) || !CAPABILITY.test(capability)) return undefined
    const entry = this.#candidates.get(requestId)
    if (entry === undefined || entry.authenticatedUserId !== authenticatedUserId
      || entry.projectId !== projectId || entry.episodeId !== episodeId) return undefined
    const actual = Buffer.from(createHash('sha256').update(capability).digest('hex'))
    const expected = Buffer.from(entry.capabilitySha256)
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? entry : undefined
  }

  #authenticated(binding: DownloadBinding, capability: string): PersistedDownload | undefined {
    if (!CAPABILITY.test(capability)) return undefined
    const entry = this.#entries.get(binding.requestId)
    if (entry === undefined || !sameBinding(entry, binding)) return undefined
    const actual = Buffer.from(createHash('sha256').update(capability).digest('hex'))
    const expected = Buffer.from(entry.capabilitySha256)
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? entry : undefined
  }

  #sweep(): void {
    const threshold = Date.now() - STATUS_TTL_MS
    let downloadsChanged = false
    let importsChanged = false
    let mastersChanged = false
    let candidatesChanged = false
    for (const [id, entry] of this.#entries) {
      if (entry.status.createdAt < threshold) {
        this.#entries.delete(id)
        downloadsChanged = true
      }
    }
    for (const [id, entry] of this.#imports) {
      if (entry.status.createdAt < threshold) {
        this.#imports.delete(id)
        importsChanged = true
      }
    }
    for (const [id, entry] of this.#masters) {
      if (entry.status.createdAt < threshold) {
        this.#masters.delete(id)
        mastersChanged = true
      }
    }
    for (const [id, entry] of this.#candidates) {
      if (entry.status.createdAt < threshold) {
        this.#candidates.delete(id)
        candidatesChanged = true
      }
    }
    if (downloadsChanged) this.#persist()
    if (importsChanged) this.#persistImports()
    if (mastersChanged) this.#persistMasters()
    if (candidatesChanged) this.#persistCandidates()
  }

  #load(): void {
    if (!existsSync(this.stateFile)) return
    const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error('editorial handoff: download state is invalid')
    let recoveredRunning = false
    for (const value of raw as unknown[]) {
      if (!validPersisted(value)) throw new Error('editorial handoff: download state is invalid')
      if (value.status.state === 'running') {
        recoveredRunning = true
        this.#entries.set(value.requestId, { ...value, status: {
          state: 'failed', createdAt: Date.now(), errorCode: 'host_restarted',
        } })
      } else {
        this.#entries.set(value.requestId, value)
      }
    }
    if (recoveredRunning) this.#persist()
    this.#sweep()
  }

  #persist(): void {
    const parent = dirname(this.stateFile)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const temporary = `${this.stateFile}.${process.pid.toString()}.${randomUUID()}.tmp`
    const descriptor = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(descriptor, JSON.stringify([...this.#entries.values()]), 'utf8')
    } finally {
      closeSync(descriptor)
    }
    renameSync(temporary, this.stateFile)
    chmodSync(this.stateFile, 0o600)
  }

  #loadImports(): void {
    const importFile = `${this.stateFile}.imports`
    if (!existsSync(importFile)) return
    const raw = JSON.parse(readFileSync(importFile, 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error('editorial handoff: import state is invalid')
    let recoveredRunning = false
    let compacted = false
    const canonical = new Map<string, PersistedImport>()
    for (const value of raw) {
      if (!validPersistedImport(value)) throw new Error('editorial handoff: import state is invalid')
      let recovered = value
      if (value.status.state === 'running') {
        recoveredRunning = true
        recovered = { ...value, status: {
          state: 'failed', createdAt: Date.now(), errorCode: 'host_restarted',
        } }
      }
      const identity = packageReceiptIdentity(recovered)
      const previous = canonical.get(identity)
      if (previous !== undefined) compacted = true
      if (previous === undefined || preferImport(recovered, previous)) canonical.set(identity, recovered)
    }
    for (const value of canonical.values()) this.#imports.set(value.requestId, value)
    if (recoveredRunning || compacted) this.#persistImports()
    this.#sweep()
  }

  #persistImports(): void {
    const importFile = `${this.stateFile}.imports`
    const parent = dirname(importFile)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const temporary = `${importFile}.${process.pid.toString()}.${randomUUID()}.tmp`
    const descriptor = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(descriptor, JSON.stringify([...this.#imports.values()]), 'utf8') } finally { closeSync(descriptor) }
    renameSync(temporary, importFile)
    chmodSync(importFile, 0o600)
  }

  #loadMasters(): void {
    const masterFile = `${this.stateFile}.masters`
    if (!existsSync(masterFile)) return
    const raw = JSON.parse(readFileSync(masterFile, 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error('editorial handoff: master state is invalid')
    let changed = false
    const canonical = new Map<string, PersistedMaster>()
    for (const value of raw) {
      const item = typeof value === 'object' && value !== null
        ? value as Record<string, unknown> : undefined
      const migrated = item !== undefined && item.receiptRequestId === undefined
        && typeof item.requestId === 'string'
        ? { ...item, receiptRequestId: item.requestId } : value
      if (!validPersistedMaster(migrated)) throw new Error('editorial handoff: master state is invalid')
      const recovered = migrated.status.state === 'running'
        ? { ...migrated, status: { state: 'failed' as const, createdAt: Date.now(), errorCode: 'host_restarted' } }
        : migrated
      if (recovered !== value) changed = true
      const identity = packageReceiptIdentity(recovered)
      const previous = canonical.get(identity)
      if (previous !== undefined) changed = true
      if (previous === undefined || preferMaster(recovered, previous)) canonical.set(identity, recovered)
    }
    for (const value of canonical.values()) this.#masters.set(value.requestId, value)
    if (changed) this.#persistMasters()
    this.#sweep()
  }

  #persistMasters(): void {
    const masterFile = `${this.stateFile}.masters`
    const parent = dirname(masterFile)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const temporary = `${masterFile}.${process.pid.toString()}.${randomUUID()}.tmp`
    const descriptor = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(descriptor, JSON.stringify([...this.#masters.values()]), 'utf8') } finally { closeSync(descriptor) }
    renameSync(temporary, masterFile)
    chmodSync(masterFile, 0o600)
  }

  #loadCandidates(): void {
    const candidateFile = `${this.stateFile}.candidates`
    if (!existsSync(candidateFile)) return
    const raw = JSON.parse(readFileSync(candidateFile, 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error('editorial handoff: candidate state is invalid')
    let changed = false
    for (const value of raw) {
      if (!validPersistedCandidate(value)) throw new Error('editorial handoff: candidate state is invalid')
      const recovered = value.status.state === 'running'
        ? { ...value, status: {
          state: 'unknown' as const, createdAt: Date.now(), errorCode: 'host_restarted_after_commit_start',
        } }
        : value
      if (recovered !== value) changed = true
      const previous = this.#candidates.get(recovered.requestId)
      if (previous === undefined || recovered.status.createdAt >= previous.status.createdAt) {
        this.#candidates.set(recovered.requestId, recovered)
      }
    }
    if (changed) this.#persistCandidates()
    this.#sweep()
  }

  #persistCandidates(): void {
    const candidateFile = `${this.stateFile}.candidates`
    const parent = dirname(candidateFile)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const temporary = `${candidateFile}.${process.pid.toString()}.${randomUUID()}.tmp`
    const descriptor = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(descriptor, JSON.stringify([...this.#candidates.values()]), 'utf8') } finally { closeSync(descriptor) }
    renameSync(temporary, candidateFile)
    chmodSync(candidateFile, 0o600)
  }
}

/** Private dependencies supplied by the Host process for Writer package downloads. */
export interface EditorialHandoffDownloadDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
  readonly readToken: () => string | undefined
  readonly readEditorialHandoffKey: () => string | undefined
  readonly authorizer: EditorialHandoffDownloadAuthorizer
  readonly temporaryRoot?: string
}

function editorialImportHeaders(binding: ImportBinding, path: string, key: string): Record<string, string> | undefined {
  if (Buffer.byteLength(key) < 32) return undefined
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomBytes(24).toString('base64url')
  const message = [
    EDITORIAL_IMPORT_DOMAIN,
    'POST',
    path,
    binding.packageSha256,
    String(binding.packageSize),
    binding.authenticatedUserId,
    binding.projectId,
    binding.episodeId,
    binding.sourceSnapshotSha256,
    binding.projectionSha256,
    binding.downloadRequestId,
    binding.requestId,
    timestamp,
    nonce,
  ].join('\n')
  return {
    'x-qingmu-download-request-id': binding.downloadRequestId,
    'x-qingmu-import-request-id': binding.requestId,
    'x-qingmu-editorial-timestamp': timestamp,
    'x-qingmu-editorial-nonce': nonce,
    'x-qingmu-editorial-signature': createHmac('sha256', key).update(message).digest('hex'),
  }
}

function editorialMasterHeaders(
  binding: MasterBinding, path: string, key: string, masterSha256: string, masterSize: number,
): Record<string, string> | undefined {
  if (Buffer.byteLength(key) < 32) return undefined
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomBytes(24).toString('base64url')
  const message = [
    EDITORIAL_MASTER_DOMAIN, 'POST', path, masterSha256, String(masterSize),
    binding.packageSha256, String(binding.packageSize), binding.authenticatedUserId,
    binding.projectId, binding.episodeId, binding.sourceSnapshotSha256,
    binding.projectionSha256, binding.downloadRequestId, binding.importRequestId,
    binding.requestId, timestamp, nonce,
  ].join('\n')
  return {
    'x-qingmu-download-request-id': binding.downloadRequestId,
    'x-qingmu-import-request-id': binding.importRequestId,
    'x-qingmu-preflight-request-id': binding.requestId,
    'x-qingmu-editorial-timestamp': timestamp,
    'x-qingmu-editorial-nonce': nonce,
    'x-qingmu-editorial-signature': createHmac('sha256', key).update(message).digest('hex'),
  }
}

function editorialCandidateHeaders(
  binding: CandidateBinding, path: string, key: string,
): Record<string, string> | undefined {
  if (Buffer.byteLength(key) < 32) return undefined
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomBytes(24).toString('base64url')
  const message = [
    EDITORIAL_MASTER_CANDIDATE_DOMAIN, 'POST', path,
    binding.masterSha256, String(binding.masterSize), binding.packageSha256,
    String(binding.packageSize), binding.authenticatedUserId, binding.projectId,
    binding.episodeId, binding.sourceSnapshotSha256, binding.projectionSha256,
    binding.downloadRequestId, binding.importRequestId, binding.preflightRequestId,
    binding.preflightSha256, binding.requestId, timestamp, nonce,
  ].join('\n')
  return {
    'x-qingmu-download-request-id': binding.downloadRequestId,
    'x-qingmu-import-request-id': binding.importRequestId,
    'x-qingmu-preflight-request-id': binding.preflightRequestId,
    'x-qingmu-preflight-sha256': binding.preflightSha256,
    'x-qingmu-idempotency-key': binding.requestId,
    'x-qingmu-editorial-timestamp': timestamp,
    'x-qingmu-editorial-nonce': nonce,
    'x-qingmu-editorial-signature': createHmac('sha256', key).update(message).digest('hex'),
  }
}

function sameBinding(left: DownloadBinding, right: DownloadBinding): boolean {
  return left.authenticatedUserId === right.authenticatedUserId
    && left.projectId === right.projectId && left.episodeId === right.episodeId
    && left.sourceSnapshotSha256 === right.sourceSnapshotSha256
    && left.projectionSha256 === right.projectionSha256 && left.requestId === right.requestId
}

function sameProjectionBinding(left: Omit<DownloadBinding, 'requestId'>, right: Omit<DownloadBinding, 'requestId'>): boolean {
  return left.authenticatedUserId === right.authenticatedUserId && left.projectId === right.projectId
    && left.episodeId === right.episodeId && left.sourceSnapshotSha256 === right.sourceSnapshotSha256
    && left.projectionSha256 === right.projectionSha256
}

function sameImportBinding(left: ImportBinding, right: ImportBinding): boolean {
  return sameProjectionBinding(left, right) && left.requestId === right.requestId
    && left.downloadRequestId === right.downloadRequestId && left.packageSha256 === right.packageSha256
    && left.packageSize === right.packageSize
}

function sameImportReceipt(entry: PersistedImport, download: PersistedDownload): boolean {
  return download.status.state === 'succeeded'
    && entry.downloadRequestId === download.requestId
    && sameProjectionBinding(entry, download)
    && entry.packageSha256 === download.status.sha256
    && entry.packageSize === download.status.size
}

function sameMasterBinding(left: MasterBinding, right: MasterBinding): boolean {
  return sameProjectionBinding(left, right) && left.requestId === right.requestId
    && left.downloadRequestId === right.downloadRequestId
    && left.importRequestId === right.importRequestId
    && left.packageSha256 === right.packageSha256 && left.packageSize === right.packageSize
}

function sameCandidateBinding(left: CandidateBinding, right: CandidateBinding): boolean {
  return sameProjectionBinding(left, right) && left.requestId === right.requestId
    && left.downloadRequestId === right.downloadRequestId
    && left.importRequestId === right.importRequestId
    && left.preflightRequestId === right.preflightRequestId
    && left.packageSha256 === right.packageSha256 && left.packageSize === right.packageSize
    && left.preflightSha256 === right.preflightSha256
    && left.masterSha256 === right.masterSha256 && left.masterSize === right.masterSize
    && left.mimeType === right.mimeType
}

function sameMasterReceipt(entry: PersistedMaster, source: PersistedImport): boolean {
  return source.status.state === 'succeeded' && sameProjectionBinding(entry, source)
    && entry.downloadRequestId === source.downloadRequestId
    && entry.packageSha256 === source.packageSha256 && entry.packageSize === source.packageSize
}

function preferMaster(candidate: PersistedMaster, current: PersistedMaster): boolean {
  const priority = (status: MasterStatus): number => status.state === 'succeeded'
    ? 3 : status.state === 'failed' ? 2 : status.state === 'authorized' ? 1 : 0
  const candidatePriority = priority(candidate.status)
  const currentPriority = priority(current.status)
  return candidatePriority > currentPriority
    || (candidatePriority === currentPriority && candidate.status.createdAt >= current.status.createdAt)
}

function packageReceiptIdentity(entry: Pick<ImportBinding,
  | 'authenticatedUserId' | 'projectId' | 'episodeId'
  | 'sourceSnapshotSha256' | 'projectionSha256' | 'downloadRequestId'
  | 'packageSha256' | 'packageSize'>): string {
  return JSON.stringify([
    entry.authenticatedUserId,
    entry.projectId,
    entry.episodeId,
    entry.sourceSnapshotSha256,
    entry.projectionSha256,
    entry.downloadRequestId,
    entry.packageSha256,
    entry.packageSize,
  ])
}

function preferImport(candidate: PersistedImport, current: PersistedImport): boolean {
  const priority = (status: ImportStatus): number => status.state === 'succeeded'
    ? 3 : status.state === 'failed' ? 2 : status.state === 'authorized' ? 1 : 0
  const candidatePriority = priority(candidate.status)
  const currentPriority = priority(current.status)
  return candidatePriority > currentPriority
    || (candidatePriority === currentPriority && candidate.status.createdAt >= current.status.createdAt)
}

function validPersisted(value: unknown): value is PersistedDownload {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const status = item.status
  if (!safeIdentifier(typeof item.authenticatedUserId === 'string' ? item.authenticatedUserId : null)
    || !safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    || !safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    || typeof item.sourceSnapshotSha256 !== 'string' || !SHA256.test(item.sourceSnapshotSha256)
    || typeof item.projectionSha256 !== 'string' || !SHA256.test(item.projectionSha256)
    || typeof item.requestId !== 'string' || !REQUEST_ID.test(item.requestId)
    || typeof item.capabilitySha256 !== 'string' || !SHA256.test(item.capabilitySha256)
    || typeof status !== 'object' || status === null) return false
  const state = status as Record<string, unknown>
  if (typeof state.createdAt !== 'number' || !Number.isSafeInteger(state.createdAt) || state.createdAt < 0) return false
  if (state.state === 'authorized' || state.state === 'running') return Object.keys(state).length === 2
  if (state.state === 'succeeded') {
    return typeof state.sha256 === 'string' && SHA256.test(state.sha256)
      && typeof state.size === 'number' && Number.isSafeInteger(state.size) && state.size > 0
  }
  return state.state === 'failed' && typeof state.errorCode === 'string' && state.errorCode.length > 0
}

function validPersistedImport(value: unknown): value is PersistedImport {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const status = item.status as Record<string, unknown> | undefined
  return safeIdentifier(typeof item.authenticatedUserId === 'string' ? item.authenticatedUserId : null)
    && safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    && safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    && typeof item.sourceSnapshotSha256 === 'string' && SHA256.test(item.sourceSnapshotSha256)
    && typeof item.projectionSha256 === 'string' && SHA256.test(item.projectionSha256)
    && typeof item.packageSha256 === 'string' && SHA256.test(item.packageSha256)
    && typeof item.packageSize === 'number' && Number.isSafeInteger(item.packageSize) && item.packageSize > 0
    && typeof item.requestId === 'string' && REQUEST_ID.test(item.requestId)
    && typeof item.downloadRequestId === 'string' && REQUEST_ID.test(item.downloadRequestId)
    && typeof item.capabilitySha256 === 'string' && SHA256.test(item.capabilitySha256)
    && status !== undefined && typeof status.createdAt === 'number'
    && Number.isSafeInteger(status.createdAt) && status.createdAt >= 0
    && ((status.state === 'authorized' || status.state === 'running') && Object.keys(status).length === 2
      || (status.state === 'failed' && typeof status.errorCode === 'string' && status.errorCode.length > 0)
      || (status.state === 'succeeded' && normalizeImportResult(status.result) !== undefined))
}

function validPersistedMaster(value: unknown): value is PersistedMaster {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const status = item.status as Record<string, unknown> | undefined
  return safeIdentifier(typeof item.authenticatedUserId === 'string' ? item.authenticatedUserId : null)
    && safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    && safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    && typeof item.sourceSnapshotSha256 === 'string' && SHA256.test(item.sourceSnapshotSha256)
    && typeof item.projectionSha256 === 'string' && SHA256.test(item.projectionSha256)
    && typeof item.packageSha256 === 'string' && SHA256.test(item.packageSha256)
    && typeof item.packageSize === 'number' && Number.isSafeInteger(item.packageSize) && item.packageSize > 0
    && typeof item.requestId === 'string' && REQUEST_ID.test(item.requestId)
    && typeof item.receiptRequestId === 'string' && REQUEST_ID.test(item.receiptRequestId)
    && typeof item.downloadRequestId === 'string' && REQUEST_ID.test(item.downloadRequestId)
    && typeof item.importRequestId === 'string' && REQUEST_ID.test(item.importRequestId)
    && typeof item.capabilitySha256 === 'string' && SHA256.test(item.capabilitySha256)
    && status !== undefined && typeof status.createdAt === 'number'
    && Number.isSafeInteger(status.createdAt) && status.createdAt >= 0
    && ((status.state === 'authorized' || status.state === 'running') && Object.keys(status).length === 2
      || (status.state === 'failed' && typeof status.errorCode === 'string' && status.errorCode.length > 0)
      || (status.state === 'succeeded' && normalizeMasterResult(status.result) !== undefined))
}

function validPersistedCandidate(value: unknown): value is PersistedCandidate {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const status = item.status as Record<string, unknown> | undefined
  return safeIdentifier(typeof item.authenticatedUserId === 'string' ? item.authenticatedUserId : null)
    && safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    && safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    && typeof item.sourceSnapshotSha256 === 'string' && SHA256.test(item.sourceSnapshotSha256)
    && typeof item.projectionSha256 === 'string' && SHA256.test(item.projectionSha256)
    && typeof item.packageSha256 === 'string' && SHA256.test(item.packageSha256)
    && typeof item.preflightSha256 === 'string' && SHA256.test(item.preflightSha256)
    && typeof item.masterSha256 === 'string' && SHA256.test(item.masterSha256)
    && typeof item.packageSize === 'number' && Number.isSafeInteger(item.packageSize) && item.packageSize > 0
    && typeof item.masterSize === 'number' && Number.isSafeInteger(item.masterSize) && item.masterSize > 0
    && ['video/mp4', 'video/quicktime', 'video/webm'].includes(String(item.mimeType))
    && typeof item.requestId === 'string' && REQUEST_ID.test(item.requestId)
    && typeof item.downloadRequestId === 'string' && REQUEST_ID.test(item.downloadRequestId)
    && typeof item.importRequestId === 'string' && REQUEST_ID.test(item.importRequestId)
    && typeof item.preflightRequestId === 'string' && REQUEST_ID.test(item.preflightRequestId)
    && typeof item.capabilitySha256 === 'string' && SHA256.test(item.capabilitySha256)
    && status !== undefined && typeof status.createdAt === 'number'
    && Number.isSafeInteger(status.createdAt) && status.createdAt >= 0
    && ((status.state === 'authorized' || status.state === 'running') && Object.keys(status).length === 2
      || ((status.state === 'failed' || status.state === 'unknown')
        && typeof status.errorCode === 'string' && status.errorCode.length > 0)
      || (status.state === 'succeeded' && normalizeCandidateResult(status.result) !== undefined))
}

function normalizeImportResult(value: unknown): EditorialHandoffImportResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const current = item.currentAuthority as Record<string, unknown> | undefined
  const binding = item.packageBinding as Record<string, unknown> | undefined
  const preview = item.preview as Record<string, unknown> | undefined
  const boundaries = item.boundaries as Record<string, unknown> | undefined
  if (item.schema !== 'jason.qingmu-editorial-package-consumption-preview.v1'
    || !safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    || !safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    || typeof item.packageSha256 !== 'string' || !SHA256.test(item.packageSha256)
    || typeof item.packageSize !== 'number' || !Number.isSafeInteger(item.packageSize) || item.packageSize <= 0
    || item.receiptMatch !== true || item.internalValidity !== true
    || item.readOnly !== true || item.businessMutations !== 0 || item.providerCalls !== 0
    || current === undefined || typeof current.matches !== 'boolean'
    || !(current.sourceSnapshotSha256 === null
      || (typeof current.sourceSnapshotSha256 === 'string' && SHA256.test(current.sourceSnapshotSha256)))
    || !(current.projectionSha256 === null
      || (typeof current.projectionSha256 === 'string' && SHA256.test(current.projectionSha256)))
    || !(current.errorCode === null || typeof current.errorCode === 'string')
    || binding === undefined || typeof binding.sourceSnapshotSha256 !== 'string'
    || !SHA256.test(binding.sourceSnapshotSha256) || typeof binding.projectionSha256 !== 'string'
    || !SHA256.test(binding.projectionSha256) || preview === undefined
    || !Array.isArray(preview.tracks) || preview.tracks.length !== 2
    || !Array.isArray(preview.orderedShots) || preview.orderedShots.length > 1000
    || !Array.isArray(preview.media) || preview.media.length > 2000
    || !Array.isArray(preview.unresolved) || preview.unresolved.length > 1000
    || boundaries === undefined || boundaries.nleOpened !== false
    || boundaries.productionComplete !== false || boundaries.releaseReady !== false
    || boundaries.humanSignoffInferred !== false) return undefined
  const serialized = JSON.stringify(value)
  if (serialized.length > 4 * 1024 * 1024 || serialized.includes('/Users/')
    || serialized.includes('Bearer ') || serialized.includes('local_path')) return undefined
  const expectedTracks = [
    { name: 'Picture', kind: 'Video' },
    { name: 'Dialogue', kind: 'Audio' },
  ] as const
  for (const [index, track] of preview.tracks.entries()) {
    if (typeof track !== 'object' || track === null || Array.isArray(track)) return undefined
    const entry = track as Record<string, unknown>
    if (entry.name !== expectedTracks[index]?.name || entry.kind !== expectedTracks[index]?.kind
      || typeof entry.clipCount !== 'number' || !Number.isSafeInteger(entry.clipCount)
      || entry.clipCount < 0 || entry.clipCount > 1000
      || entry.clipCount !== preview.orderedShots.length) return undefined
  }
  for (const [index, shot] of preview.orderedShots.entries()) {
    if (typeof shot !== 'object' || shot === null || Array.isArray(shot)) return undefined
    const entry = shot as Record<string, unknown>
    const videoRange = entry.videoRange as Record<string, unknown> | undefined
    const audioRange = entry.audioRange as Record<string, unknown> | undefined
    if (entry.order !== index + 1
      || !safeIdentifier(typeof entry.sceneId === 'string' ? entry.sceneId : null)
      || !safeIdentifier(typeof entry.frameId === 'string' ? entry.frameId : null)
      || typeof entry.frameNo !== 'number' || !Number.isSafeInteger(entry.frameNo) || entry.frameNo <= 0
      || typeof entry.videoPath !== 'string' || !safePackageMediaPath(entry.videoPath)
      || typeof entry.audioPath !== 'string' || !safePackageMediaPath(entry.audioPath)
      || !validPreviewRange(videoRange) || !validPreviewRange(audioRange)) return undefined
  }
  for (const media of preview.media) {
    if (typeof media !== 'object' || media === null || Array.isArray(media)) return undefined
    const entry = media as Record<string, unknown>
    if ((entry.kind !== 'video' && entry.kind !== 'audio') || typeof entry.path !== 'string'
      || !safePackageMediaPath(entry.path)
      || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0
      || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) return undefined
  }
  for (const unresolved of preview.unresolved) {
    if (typeof unresolved !== 'object' || unresolved === null || Array.isArray(unresolved)) return undefined
    const entry = unresolved as Record<string, unknown>
    if (!safeIdentifier(typeof entry.frameId === 'string' ? entry.frameId : null)
      || !safeIdentifier(typeof entry.code === 'string' ? entry.code : null)) return undefined
  }
  return value as EditorialHandoffImportResult
}

function normalizeMasterResult(value: unknown): EditorialMasterPreflightResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const binding = item.binding as Record<string, unknown> | undefined
  const master = item.master as Record<string, unknown> | undefined
  const checks = item.checks as Record<string, unknown> | undefined
  const boundaries = item.boundaries as Record<string, unknown> | undefined
  const optionalNumber = (input: unknown): boolean => input === null
    || (typeof input === 'number' && Number.isFinite(input) && input > 0)
  const stringList = (input: unknown): input is string[] => Array.isArray(input)
    && input.length <= 100 && input.every(entry => typeof entry === 'string' && safeIdentifier(entry))
  if (item.schema !== 'jason.qingmu-editorial-master-preflight.v1'
    || typeof item.preflightSha256 !== 'string' || !SHA256.test(item.preflightSha256)
    || !safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    || !safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    || item.readOnly !== true || item.businessMutations !== 0 || item.providerCalls !== 0
    || binding === undefined
    || typeof binding.sourceSnapshotSha256 !== 'string' || !SHA256.test(binding.sourceSnapshotSha256)
    || typeof binding.projectionSha256 !== 'string' || !SHA256.test(binding.projectionSha256)
    || typeof binding.downloadRequestId !== 'string' || !REQUEST_ID.test(binding.downloadRequestId)
    || typeof binding.importRequestId !== 'string' || !REQUEST_ID.test(binding.importRequestId)
    || typeof binding.packageSha256 !== 'string' || !SHA256.test(binding.packageSha256)
    || typeof binding.packageSize !== 'number' || !Number.isSafeInteger(binding.packageSize) || binding.packageSize <= 0
    || master === undefined || typeof master.sha256 !== 'string' || !SHA256.test(master.sha256)
    || typeof master.size !== 'number' || !Number.isSafeInteger(master.size) || master.size <= 0
    || !(master.mimeType === null || (typeof master.mimeType === 'string'
      && ['video/mp4', 'video/quicktime', 'video/webm'].includes(master.mimeType)))
    || !(master.container === null || (typeof master.container === 'string'
      && ['mp4', 'quicktime', 'webm'].includes(master.container)))
    || !(master.formatName === null || typeof master.formatName === 'string')
    || !optionalNumber(master.durationSec) || !optionalNumber(master.width)
    || !optionalNumber(master.height) || !optionalNumber(master.fps)
    || !Array.isArray(master.videoStreams) || master.videoStreams.length > 16
    || !Array.isArray(master.audioStreams) || master.audioStreams.length > 16
    || !stringList(master.blockers) || !stringList(item.blockers) || !stringList(item.unresolved)
    || JSON.stringify(master.blockers) !== JSON.stringify(item.blockers)
    || JSON.stringify(item.blockers) !== JSON.stringify(item.unresolved)
    || checks === undefined || checks.currentAuthorityMatches !== true
    || checks.packageReceiptBound !== true || typeof checks.containerVerified !== 'boolean'
    || typeof checks.probeSucceeded !== 'boolean'
    || boundaries === undefined || boundaries.nleOpened !== false
    || boundaries.editorConsumed !== false || boundaries.formalReturnRecorded !== false
    || boundaries.releaseReady !== false || boundaries.humanSignoffInferred !== false) return undefined
  const serialized = JSON.stringify(value)
  if (serialized.length > 4 * 1024 * 1024 || serialized.includes('/Users/')
    || serialized.includes('Bearer ') || serialized.includes('local_path')) return undefined
  return value as EditorialMasterPreflightResult
}

function normalizeCandidateResult(value: unknown): EditorialMasterCandidateResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const exactFalse = [
    'isSelected', 'approved', 'published', 'stageStarted', 'approvalGranted',
    'selectionGranted', 'releaseGranted', 'humanSignoffInferred',
  ].every(field => item[field] === false)
  const positive = (field: string): boolean => {
    const number = item[field]
    return typeof number === 'number' && Number.isFinite(number) && number > 0
  }
  const safeStorageKey = typeof item.storageKey === 'string'
    && item.storageKey.startsWith('qingmu/editorial-master-candidates/')
    && !item.storageKey.includes('..') && !item.storageKey.includes('\\')
    && !item.storageKey.startsWith('/') && !item.storageKey.includes('\0')
  if (item.schema !== 'jason.qingmu-returned-master-candidate-result.v1'
    || !safeIdentifier(typeof item.projectId === 'string' ? item.projectId : null)
    || !safeIdentifier(typeof item.episodeId === 'string' ? item.episodeId : null)
    || !safeIdentifier(typeof item.assetId === 'string' ? item.assetId : null)
    || !safeStorageKey
    || typeof item.masterSha256 !== 'string' || !SHA256.test(item.masterSha256)
    || item.materializedSha256 !== item.masterSha256
    || typeof item.packageSha256 !== 'string' || !SHA256.test(item.packageSha256)
    || typeof item.sourceSnapshotSha256 !== 'string' || !SHA256.test(item.sourceSnapshotSha256)
    || typeof item.projectionSha256 !== 'string' || !SHA256.test(item.projectionSha256)
    || typeof item.preflightSha256 !== 'string' || !SHA256.test(item.preflightSha256)
    || typeof item.requestSha256 !== 'string' || !SHA256.test(item.requestSha256)
    || !positive('byteSize') || !Number.isSafeInteger(item.byteSize)
    || !positive('durationSec') || !positive('width') || !Number.isSafeInteger(item.width)
    || !positive('height') || !Number.isSafeInteger(item.height) || !positive('fps')
    || !['video/mp4', 'video/quicktime', 'video/webm'].includes(String(item.mimeType))
    || !REQUEST_ID.test(String(item.downloadRequestId)) || !REQUEST_ID.test(String(item.importRequestId))
    || !REQUEST_ID.test(String(item.preflightRequestId)) || !REQUEST_ID.test(String(item.idempotencyKey))
    || !safeIdentifier(typeof item.commandReceiptId === 'string' ? item.commandReceiptId : null)
    || !safeIdentifier(typeof item.changeSetId === 'string' ? item.changeSetId : null)
    || !safeIdentifier(typeof item.eventId === 'string' ? item.eventId : null)
    || typeof item.savedAt !== 'string' || item.savedAt.length < 10 || item.savedAt.length > 64
    || item.qualityStatus !== 'pending' || item.selectionStatus !== 'Unselected'
    || item.providerCalls !== 0 || !exactFalse) return undefined
  const serialized = JSON.stringify(value)
  if (serialized.length > 128 * 1024 || serialized.includes('/Users/')
    || serialized.includes('Bearer ') || serialized.includes('local_path')) return undefined
  return value as EditorialMasterCandidateResult
}

function normalizeCandidateList(value: unknown): readonly EditorialMasterCandidateResult[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (item.schema !== 'jason.qingmu-returned-master-candidates.v1'
    || !Array.isArray(item.candidates) || item.candidates.length > 1000
    || item.providerCalls !== 0 || item.stageStarted !== false || item.approvalGranted !== false
    || item.selectionGranted !== false || item.releaseGranted !== false
    || item.humanSignoffInferred !== false) return undefined
  const candidates = item.candidates.map(normalizeCandidateResult)
  return candidates.every((entry): entry is EditorialMasterCandidateResult => entry !== undefined)
    ? candidates : undefined
}

function safePackageMediaPath(value: string): boolean {
  return value.startsWith('media/') && value.length <= 1024 && !value.includes('..')
    && !value.includes('\\') && !value.includes('\0') && !value.includes('//')
}

function validPreviewRange(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined
    && value.start === 0
    && typeof value.durationSec === 'number' && Number.isFinite(value.durationSec) && value.durationSec > 0
    && typeof value.rate === 'number' && Number.isFinite(value.rate) && value.rate > 0
}

function privateHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'cache-control': 'private, no-store, max-age=0',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
    ...extra,
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, privateHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
  }))
  res.end(bytes)
}

function validToken(value: string | undefined): string | undefined {
  const token = value?.trim()
  return token !== undefined && token.length > 0 && token.length <= 8192
    && !/[\r\n]/.test(token) ? token : undefined
}

function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://loopback.invalid').searchParams
}

function exactParams(params: URLSearchParams, names: readonly string[]): boolean {
  const keys = [...params.keys()]
  return keys.length === names.length && names.every(name => params.getAll(name).length === 1)
}

function safeIdentifier(value: string | null): value is string {
  return value !== null && IDENTIFIER.test(value)
}

const BINDING_PARAMS = [
  'projectId',
  'episodeId',
  'sourceSnapshotSha256',
  'projectionSha256',
  'requestId',
  'capability',
] as const

const IMPORT_PARAMS = ['projectId', 'episodeId', 'requestId', 'capability'] as const
const SCOPE_PARAMS = ['projectId', 'episodeId'] as const

function scopeAccess(params: URLSearchParams): { readonly projectId: string; readonly episodeId: string } | undefined {
  if (!exactParams(params, SCOPE_PARAMS)) return undefined
  const projectId = params.get('projectId')
  const episodeId = params.get('episodeId')
  return safeIdentifier(projectId) && safeIdentifier(episodeId) ? { projectId, episodeId } : undefined
}

function importAccess(params: URLSearchParams): {
  readonly projectId: string
  readonly episodeId: string
  readonly requestId: string
  readonly capability: string
} | undefined {
  if (!exactParams(params, IMPORT_PARAMS)) return undefined
  const projectId = params.get('projectId')
  const episodeId = params.get('episodeId')
  const requestId = params.get('requestId')
  const capability = params.get('capability')
  return safeIdentifier(projectId) && safeIdentifier(episodeId)
    && requestId !== null && REQUEST_ID.test(requestId)
    && capability !== null && CAPABILITY.test(capability)
    ? { projectId, episodeId, requestId, capability } : undefined
}

function downloadBinding(params: URLSearchParams): {
  readonly binding: BrowserDownloadBinding
  readonly capability: string
} | undefined {
  if (!exactParams(params, BINDING_PARAMS)) return undefined
  const projectId = params.get('projectId')
  const episodeId = params.get('episodeId')
  const sourceSnapshotSha256 = params.get('sourceSnapshotSha256')
  const projectionSha256 = params.get('projectionSha256')
  const requestId = params.get('requestId')
  const capability = params.get('capability')
  if (!safeIdentifier(projectId) || !safeIdentifier(episodeId)
    || sourceSnapshotSha256 === null || !SHA256.test(sourceSnapshotSha256)
    || projectionSha256 === null || !SHA256.test(projectionSha256)
    || requestId === null || !REQUEST_ID.test(requestId)
    || capability === null || !CAPABILITY.test(capability)) return undefined
  return {
    binding: { projectId, episodeId, sourceSnapshotSha256, projectionSha256, requestId },
    capability,
  }
}

async function authenticatedBinding(
  dependencies: EditorialHandoffDownloadDependencies,
  binding: BrowserDownloadBinding,
  token: string,
): Promise<DownloadBinding | undefined> {
  try {
    const response = await dependencies.fetch(new URL('/api/auth/me', dependencies.baseUrl), {
      method: 'GET', redirect: 'error', headers: {
        authorization: `Bearer ${token}`, accept: 'application/json',
      },
    })
    if (!response.ok) return undefined
    const length = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(length) && length > 64 * 1024) return undefined
    const value = await response.json() as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const authenticatedUserId = (value as Record<string, unknown>).id
    if (typeof authenticatedUserId !== 'string' || !safeIdentifier(authenticatedUserId)) return undefined
    return { ...binding, authenticatedUserId }
  } catch {
    return undefined
  }
}

async function authenticatedUserId(
  dependencies: EditorialHandoffDownloadDependencies,
  token: string,
): Promise<string | undefined> {
  try {
    const response = await dependencies.fetch(new URL('/api/auth/me', dependencies.baseUrl), {
      method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    if (!response.ok) return undefined
    const value = await response.json() as Record<string, unknown>
    return typeof value.id === 'string' && safeIdentifier(value.id) ? value.id : undefined
  } catch { return undefined }
}

function statusBody(status: DownloadStatus | undefined): Record<string, unknown> {
  if (status === undefined) return { status: 'not_found', sha256: null, size: null, errorCode: null }
  if (status.state === 'authorized') return { status: 'not_started', sha256: null, size: null, errorCode: null }
  if (status.state === 'running') return { status: 'running', sha256: null, size: null, errorCode: null }
  if (status.state === 'succeeded') {
    return { status: 'succeeded', sha256: status.sha256, size: status.size, errorCode: null }
  }
  return { status: 'failed', sha256: null, size: null, errorCode: status.errorCode }
}

function resultStatusBody(status: ImportStatus | MasterStatus | CandidateStatus | undefined): Record<string, unknown> {
  if (status === undefined) return { status: 'not_found', result: null, errorCode: null }
  if (status.state === 'authorized') return { status: 'not_started', result: null, errorCode: null }
  if (status.state === 'running') return { status: 'running', result: null, errorCode: null }
  if (status.state === 'unknown') return { status: 'unknown', result: null, errorCode: status.errorCode }
  if (status.state === 'succeeded') return { status: 'succeeded', result: status.result, errorCode: null }
  return { status: 'failed', result: null, errorCode: status.errorCode }
}

function cleanupImportSpools(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  for (const name of readdirSync(root)) {
    if (/^(?:qingmu-otio-import|qingmu-editorial-master|qingmu-editorial-candidate)-[A-Za-z0-9_-]+$/u.test(name)) {
      rmSync(join(root, name), { recursive: true, force: true })
    }
  }
}

/**
 * Write one chunk completely even when the file handle reports a short write.
 * @param output - Private spool handle receiving the bytes.
 * @param bytes - Exact upload or download chunk to persist.
 */
export async function writeAllSpoolBytes(
  output: {
    write: (
      bytes: Uint8Array, offset: number, length: number, position: null,
    ) => Promise<{ bytesWritten: number }>
  },
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = await output.write(bytes, offset, bytes.byteLength - offset, null)
    if (written.bytesWritten <= 0 || written.bytesWritten > bytes.byteLength - offset) {
      throw new Error('spool_partial_write_invalid')
    }
    offset += written.bytesWritten
  }
}

async function readWriterCandidateList(
  dependencies: EditorialHandoffDownloadDependencies,
  token: string,
  projectId: string,
  episodeId: string,
): Promise<{ readonly raw: unknown; readonly candidates: readonly EditorialMasterCandidateResult[] } | undefined> {
  const upstream = new URL(
    `/api/qingmu/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/editorial-handoff/returned-master-candidates`,
    dependencies.baseUrl,
  )
  try {
    const response = await dependencies.fetch(upstream, {
      method: 'GET', redirect: 'error', headers: {
        authorization: `Bearer ${token}`, accept: 'application/json',
      },
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok || bytes.length > 4 * 1024 * 1024) return undefined
    const raw = JSON.parse(bytes.toString('utf8')) as unknown
    const candidates = normalizeCandidateList(raw)
    if (candidates === undefined) return undefined
    const item = raw as Record<string, unknown>
    return item.projectId === projectId && item.episodeId === episodeId ? { raw, candidates } : undefined
  } catch { return undefined }
}

function candidateMatchesBinding(result: EditorialMasterCandidateResult, binding: CandidateBinding): boolean {
  return result.projectId === binding.projectId && result.episodeId === binding.episodeId
    && result.idempotencyKey === binding.requestId
    && result.masterSha256 === binding.masterSha256 && result.materializedSha256 === binding.masterSha256
    && result.byteSize === binding.masterSize && result.mimeType === binding.mimeType
    && result.packageSha256 === binding.packageSha256
    && result.sourceSnapshotSha256 === binding.sourceSnapshotSha256
    && result.projectionSha256 === binding.projectionSha256
    && result.downloadRequestId === binding.downloadRequestId
    && result.importRequestId === binding.importRequestId
    && result.preflightRequestId === binding.preflightRequestId
    && result.preflightSha256 === binding.preflightSha256
}

/**
 * Register the private loopback download and status routes.
 *
 * @param webServer - Host-only loopback web server.
 * @param dependencies - Writer endpoint, authenticated fetch, and private token lookup.
 * @returns A disposer that unregisters both routes and clears transient status.
 */
export function registerEditorialHandoffDownload(
  webServer: WebServer,
  dependencies: EditorialHandoffDownloadDependencies,
): () => void {
  const temporaryRoot = dependencies.temporaryRoot ?? tmpdir()
  cleanupImportSpools(temporaryRoot)
  const disposeStatus = webServer.register({
    kind: 'exact', path: STATUS_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      const params = query(req)
      const access = downloadBinding(params)
      if (access === undefined) {
        json(res, 400, { code: 'editorial_handoff_download_request_invalid' })
        return
      }
      const token = validToken(dependencies.readToken())
      const binding = token === undefined ? undefined
        : await authenticatedBinding(dependencies, access.binding, token)
      if (binding === undefined) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      const status = dependencies.authorizer.status(binding, access.capability)
      if (status === undefined) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      const nextAccess = status.state === 'succeeded'
        ? dependencies.authorizer.issueImport(binding, access.capability) : undefined
      json(res, 200, {
        ...statusBody(status), ...(nextAccess === undefined ? {} : { importAccess: nextAccess }),
      })
    },
  })
  const disposeDownload = webServer.register({
    kind: 'exact', path: DOWNLOAD_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      const params = query(req)
      const access = downloadBinding(params)
      if (access === undefined) {
        json(res, 400, { code: 'editorial_handoff_download_request_invalid' })
        return
      }
      const { capability } = access
      const token = validToken(dependencies.readToken())
      const binding = token === undefined ? undefined
        : await authenticatedBinding(dependencies, access.binding, token)
      if (binding === undefined) {
        json(res, 403, { code: 'editorial_handoff_download_forbidden' })
        return
      }
      if (!dependencies.authorizer.start(binding, capability)) {
        const status = dependencies.authorizer.status(binding, capability)
        json(res, status === undefined ? 403 : 409, {
          code: status === undefined
            ? 'editorial_handoff_download_forbidden'
            : 'editorial_handoff_download_request_reused',
        })
        return
      }
      const upstream = new URL(
        `/api/qingmu/projects/${encodeURIComponent(binding.projectId)}/episodes/${encodeURIComponent(binding.episodeId)}/editorial-handoff/download`,
        dependencies.baseUrl,
      )
      upstream.searchParams.set('sourceSnapshotSha256', binding.sourceSnapshotSha256)
      upstream.searchParams.set('projectionSha256', binding.projectionSha256)
      const controller = new AbortController()
      const cancel = (): void => { if (!res.writableEnded) controller.abort() }
      res.once('close', cancel)
      let temporaryDirectory: string | undefined
      try {
        const response = await dependencies.fetch(upstream, {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/zip',
            'x-qingmu-authenticated-user-id': binding.authenticatedUserId,
          },
        })
        const declaredSha = response.headers.get('x-qingmu-package-sha256')
        const declaredSizeText = response.headers.get('x-qingmu-package-size')
          ?? response.headers.get('content-length')
        const declaredSize = declaredSizeText === null ? Number.NaN : Number(declaredSizeText)
        if (!response.ok || response.body === null || declaredSha === null || !SHA256.test(declaredSha)
          || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > MAX_PACKAGE_BYTES
          || response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/zip') {
          dependencies.authorizer.finish(binding, {
            state: 'failed', createdAt: Date.now(),
            errorCode: response.status === 409 ? 'source_stale' : 'package_contract_failed',
          })
          json(res, response.status === 409 ? 409 : 502, { code: 'editorial_handoff_download_failed' })
          return
        }
        temporaryDirectory = await mkdtemp(join(temporaryRoot, 'qingmu-otio-'))
        const temporaryPath = join(temporaryDirectory, 'package.zip')
        const output = await open(temporaryPath, 'wx', 0o600)
        const digest = createHash('sha256')
        const reader = response.body.getReader()
        let size = 0
        try {
          while (true) {
            const result = await reader.read()
            if (result.done) break
            size += result.value.byteLength
            if (size > declaredSize || size > MAX_PACKAGE_BYTES) throw new Error('package_size_mismatch')
            digest.update(result.value)
            await writeAllSpoolBytes(output, result.value)
          }
        } finally {
          await output.close()
        }
        if (size !== declaredSize || digest.digest('hex') !== declaredSha) throw new Error('package_digest_mismatch')
        res.writeHead(200, privateHeaders({
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="qingmu-editorial-handoff.otio.zip"',
          'content-length': String(declaredSize),
          'x-qingmu-package-sha256': declaredSha,
          'x-qingmu-package-size': String(declaredSize),
        }))
        for await (const chunk of createReadStream(temporaryPath)) {
          if (!res.write(chunk)) await once(res, 'drain')
        }
        dependencies.authorizer.finish(binding, {
          state: 'succeeded', createdAt: Date.now(), sha256: declaredSha, size,
        })
        res.end()
      } catch (error) {
        dependencies.authorizer.finish(binding, {
          state: 'failed', createdAt: Date.now(),
          errorCode: error instanceof DOMException && error.name === 'AbortError'
            ? 'download_cancelled' : 'package_stream_failed',
        })
        if (res.headersSent) res.destroy()
        else json(res, 502, { code: 'editorial_handoff_download_failed' })
      } finally {
        res.off('close', cancel)
        if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  })
  const disposeImportStatus = webServer.register({
    kind: 'exact', path: IMPORT_STATUS_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_handoff_import_forbidden' }); return
      }
      const access = importAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = access === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (access === undefined || userId === undefined) {
        json(res, access === undefined ? 400 : 403, { code: 'editorial_handoff_import_forbidden' }); return
      }
      const status = dependencies.authorizer.importStatus(
        userId, access.projectId, access.episodeId, access.requestId, access.capability,
      )
      if (status === undefined) { json(res, 403, { code: 'editorial_handoff_import_forbidden' }); return }
      const masterAccess = status.state === 'succeeded'
        ? dependencies.authorizer.issueMaster(
          userId, access.projectId, access.episodeId, access.requestId, access.capability,
        ) : undefined
      json(res, 200, {
        ...resultStatusBody(status), ...(masterAccess === undefined ? {} : { masterAccess }),
      })
    },
  })
  const disposeImport = webServer.register({
    kind: 'exact', path: IMPORT_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_handoff_import_forbidden' }); return
      }
      const access = importAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = access === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (access === undefined || userId === undefined) {
        json(res, access === undefined ? 400 : 403, { code: 'editorial_handoff_import_forbidden' }); return
      }
      const binding = dependencies.authorizer.startImport(
        userId, access.projectId, access.episodeId, access.requestId, access.capability,
      )
      if (binding === undefined) {
        const existing = dependencies.authorizer.importStatus(
          userId, access.projectId, access.episodeId, access.requestId, access.capability,
        )
        if (existing?.state === 'succeeded') json(res, 200, existing.result)
        else json(res, existing === undefined ? 403 : 409, {
          code: existing === undefined ? 'editorial_handoff_import_forbidden' : 'editorial_handoff_import_request_reused',
        })
        return
      }
      let temporaryDirectory: string | undefined
      try {
        const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim()
        const declaredLength = req.headers['content-length'] === undefined
          ? undefined : Number(req.headers['content-length'])
        if (contentType !== 'application/zip'
          || (declaredLength !== undefined && declaredLength !== binding.packageSize)) {
          throw new Error('import_contract_invalid')
        }
        temporaryDirectory = await mkdtemp(join(temporaryRoot, 'qingmu-otio-import-'))
        const temporaryPath = join(temporaryDirectory, 'package.zip')
        const output = await open(temporaryPath, 'wx', 0o600)
        const digest = createHash('sha256')
        let size = 0
        try {
          for await (const raw of req) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
            size += chunk.byteLength
            if (size > binding.packageSize || size > MAX_PACKAGE_BYTES) throw new Error('import_size_mismatch')
            digest.update(chunk)
            await writeAllSpoolBytes(output, chunk)
          }
        } finally { await output.close() }
        if (size !== binding.packageSize || digest.digest('hex') !== binding.packageSha256) {
          throw new Error('import_receipt_mismatch')
        }
        const upstream = new URL(
          `/api/qingmu/projects/${encodeURIComponent(binding.projectId)}/episodes/${encodeURIComponent(binding.episodeId)}/editorial-handoff/verify-downloaded-package`,
          dependencies.baseUrl,
        )
        const hostHeaders = editorialImportHeaders(
          binding, upstream.pathname, dependencies.readEditorialHandoffKey() ?? '',
        )
        if (hostHeaders === undefined) throw new Error('host_service_unavailable')
        const response = await dependencies.fetch(upstream, {
          method: 'POST', redirect: 'error',
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            'content-type': 'application/zip',
            'content-length': String(binding.packageSize),
            'x-qingmu-authenticated-user-id': binding.authenticatedUserId,
            'x-qingmu-package-sha256': binding.packageSha256,
            'x-qingmu-package-size': String(binding.packageSize),
            'x-qingmu-source-snapshot-sha256': binding.sourceSnapshotSha256,
            'x-qingmu-projection-sha256': binding.projectionSha256,
            ...hostHeaders,
          },
          body: createReadStream(temporaryPath),
          duplex: 'half',
        } as unknown as RequestInit & { duplex: 'half' })
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!response.ok || bytes.length > 4 * 1024 * 1024) throw new Error('writer_verification_failed')
        const result = normalizeImportResult(JSON.parse(bytes.toString('utf8')))
        if (result === undefined || result.projectId !== binding.projectId
          || result.episodeId !== binding.episodeId || result.packageSha256 !== binding.packageSha256
          || result.packageSize !== binding.packageSize
          || result.packageBinding.sourceSnapshotSha256 !== binding.sourceSnapshotSha256
          || result.packageBinding.projectionSha256 !== binding.projectionSha256) {
          throw new Error('writer_verification_contract_failed')
        }
        dependencies.authorizer.finishImport(binding, { state: 'succeeded', createdAt: Date.now(), result })
        json(res, 200, result)
      } catch (error) {
        const code = error instanceof Error && error.message === 'import_receipt_mismatch'
          ? 'package_receipt_mismatch'
          : error instanceof Error && error.message === 'import_contract_invalid'
            ? 'package_contract_invalid'
            : error instanceof Error && error.message === 'host_service_unavailable'
              ? 'host_service_unavailable' : 'package_verification_failed'
        dependencies.authorizer.finishImport(binding, { state: 'failed', createdAt: Date.now(), errorCode: code })
        if (!res.headersSent) json(res,
          code === 'package_receipt_mismatch' || code === 'package_contract_invalid' ? 409 : 502,
          { code },
        )
        else res.destroy()
      } finally {
        if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  })
  const disposeMasterStatus = webServer.register({
    kind: 'exact', path: MASTER_STATUS_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_master_preflight_forbidden' }); return
      }
      const access = importAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = access === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (access === undefined || userId === undefined) {
        json(res, access === undefined ? 400 : 403, { code: 'editorial_master_preflight_forbidden' }); return
      }
      const status = dependencies.authorizer.masterStatus(
        userId, access.projectId, access.episodeId, access.requestId, access.capability,
      )
      if (status === undefined) { json(res, 403, { code: 'editorial_master_preflight_forbidden' }); return }
      const candidateAccess = status.state === 'succeeded'
        ? dependencies.authorizer.issueCandidate(
          userId, access.projectId, access.episodeId, access.requestId, access.capability,
        ) : undefined
      json(res, 200, {
        ...resultStatusBody(status), ...(candidateAccess === undefined ? {} : { candidateAccess }),
      })
    },
  })
  const disposeMaster = webServer.register({
    kind: 'exact', path: MASTER_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_master_preflight_forbidden' }); return
      }
      const access = importAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = access === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (access === undefined || userId === undefined) {
        json(res, access === undefined ? 400 : 403, { code: 'editorial_master_preflight_forbidden' }); return
      }
      const binding = dependencies.authorizer.startMaster(
        userId, access.projectId, access.episodeId, access.requestId, access.capability,
      )
      if (binding === undefined) {
        const existing = dependencies.authorizer.masterStatus(
          userId, access.projectId, access.episodeId, access.requestId, access.capability,
        )
        json(res, existing === undefined ? 403 : 409, {
          code: existing === undefined
            ? 'editorial_master_preflight_forbidden'
            : 'editorial_master_preflight_request_reused',
        })
        return
      }
      let temporaryDirectory: string | undefined
      try {
        const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim()
        const declaredLength = Number(req.headers['content-length'] ?? '')
        if (!['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream'].includes(contentType ?? '')
          || !Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength > MAX_MASTER_BYTES) {
          throw new Error('master_contract_invalid')
        }
        temporaryDirectory = await mkdtemp(join(temporaryRoot, 'qingmu-editorial-master-'))
        const temporaryPath = join(temporaryDirectory, 'master.media')
        const output = await open(temporaryPath, 'wx', 0o600)
        const digest = createHash('sha256')
        let size = 0
        try {
          for await (const raw of req) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
            size += chunk.byteLength
            if (size > declaredLength || size > MAX_MASTER_BYTES) throw new Error('master_size_mismatch')
            digest.update(chunk)
            await writeAllSpoolBytes(output, chunk)
          }
        } finally { await output.close() }
        if (size !== declaredLength) throw new Error('master_size_mismatch')
        const masterSha256 = digest.digest('hex')
        const upstream = new URL(
          `/api/qingmu/projects/${encodeURIComponent(binding.projectId)}/episodes/${encodeURIComponent(binding.episodeId)}/editorial-handoff/preflight-returned-master`,
          dependencies.baseUrl,
        )
        const hostHeaders = editorialMasterHeaders(
          binding, upstream.pathname, dependencies.readEditorialHandoffKey() ?? '', masterSha256, size,
        )
        if (hostHeaders === undefined) throw new Error('host_service_unavailable')
        const response = await dependencies.fetch(upstream, {
          method: 'POST', redirect: 'error',
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            'content-type': 'application/octet-stream',
            'content-length': String(size),
            'x-qingmu-authenticated-user-id': binding.authenticatedUserId,
            'x-qingmu-master-sha256': masterSha256,
            'x-qingmu-master-size': String(size),
            'x-qingmu-package-sha256': binding.packageSha256,
            'x-qingmu-package-size': String(binding.packageSize),
            'x-qingmu-source-snapshot-sha256': binding.sourceSnapshotSha256,
            'x-qingmu-projection-sha256': binding.projectionSha256,
            ...hostHeaders,
          },
          body: createReadStream(temporaryPath),
          duplex: 'half',
        } as unknown as RequestInit & { duplex: 'half' })
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!response.ok || bytes.length > 4 * 1024 * 1024) throw new Error('writer_preflight_failed')
        const result = normalizeMasterResult(JSON.parse(bytes.toString('utf8')))
        if (result === undefined || result.projectId !== binding.projectId
          || result.episodeId !== binding.episodeId || result.master.sha256 !== masterSha256
          || result.master.size !== size || result.binding.sourceSnapshotSha256 !== binding.sourceSnapshotSha256
          || result.binding.projectionSha256 !== binding.projectionSha256
          || result.binding.downloadRequestId !== binding.downloadRequestId
          || result.binding.importRequestId !== binding.importRequestId
          || result.binding.packageSha256 !== binding.packageSha256
          || result.binding.packageSize !== binding.packageSize) {
          throw new Error('writer_preflight_contract_failed')
        }
        dependencies.authorizer.finishMaster(binding, { state: 'succeeded', createdAt: Date.now(), result })
        const candidateAccess = dependencies.authorizer.issueCandidate(
          userId, access.projectId, access.episodeId, access.requestId, access.capability,
        )
        json(res, 200, { ...result, ...(candidateAccess === undefined ? {} : { candidateAccess }) })
      } catch (error) {
        const code = error instanceof Error && error.message === 'master_contract_invalid'
          ? 'master_contract_invalid'
          : error instanceof Error && error.message === 'master_size_mismatch'
            ? 'master_size_mismatch'
            : error instanceof Error && error.message === 'host_service_unavailable'
              ? 'host_service_unavailable' : 'master_preflight_failed'
        dependencies.authorizer.finishMaster(binding, { state: 'failed', createdAt: Date.now(), errorCode: code })
        if (!res.headersSent) json(res, code === 'master_contract_invalid' || code === 'master_size_mismatch' ? 409 : 502, { code })
        else res.destroy()
      } finally {
        if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  })
  const disposeCandidateList = webServer.register({
    kind: 'exact', path: CANDIDATE_LIST_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      const scope = scopeAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = scope === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (scope === undefined || token === undefined || userId === undefined) {
        json(res, scope === undefined ? 400 : 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      const listing = await readWriterCandidateList(
        dependencies, token, scope.projectId, scope.episodeId,
      )
      if (listing === undefined) {
        json(res, 502, { code: 'editorial_master_candidate_list_failed' }); return
      }
      json(res, 200, listing.raw)
    },
  })
  const disposeCandidateStatus = webServer.register({
    kind: 'exact', path: CANDIDATE_STATUS_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      const access = importAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = access === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (access === undefined || token === undefined || userId === undefined) {
        json(res, access === undefined ? 400 : 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      let status = dependencies.authorizer.candidateStatus(
        userId, access.projectId, access.episodeId, access.requestId, access.capability,
      )
      if (status === undefined) {
        json(res, 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      if (status.state === 'unknown') {
        const listing = await readWriterCandidateList(
          dependencies, token, access.projectId, access.episodeId,
        )
        const result = listing?.candidates.find(item => item.idempotencyKey === access.requestId)
        if (result !== undefined) {
          const current = dependencies.authorizer.candidateBinding(
            userId, access.projectId, access.episodeId, access.requestId, access.capability,
          )
          if (current !== undefined && candidateMatchesBinding(result, current)) {
            dependencies.authorizer.finishCandidate(current, {
              state: 'succeeded', createdAt: Date.now(), result,
            })
            status = dependencies.authorizer.candidateStatus(
              userId, access.projectId, access.episodeId, access.requestId, access.capability,
            )
          }
        }
      }
      json(res, 200, resultStatusBody(status))
    },
  })
  const disposeCandidate = webServer.register({
    kind: 'exact', path: CANDIDATE_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      const access = importAccess(query(req))
      const token = validToken(dependencies.readToken())
      const userId = access === undefined || token === undefined ? undefined
        : await authenticatedUserId(dependencies, token)
      if (access === undefined || userId === undefined) {
        json(res, access === undefined ? 400 : 403, { code: 'editorial_master_candidate_forbidden' }); return
      }
      const binding = dependencies.authorizer.startCandidate(
        userId, access.projectId, access.episodeId, access.requestId, access.capability,
      )
      if (binding === undefined) {
        const existing = dependencies.authorizer.candidateStatus(
          userId, access.projectId, access.episodeId, access.requestId, access.capability,
        )
        if (existing?.state === 'succeeded') json(res, 200, existing.result)
        else json(res, existing === undefined ? 403 : 409, {
          code: existing === undefined ? 'editorial_master_candidate_forbidden'
            : existing.state === 'unknown' ? 'editorial_master_candidate_submission_unknown'
              : 'editorial_master_candidate_request_reused',
        })
        return
      }
      let temporaryDirectory: string | undefined
      let submitted = false
      try {
        const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim()
        const declaredLength = Number(req.headers['content-length'] ?? '')
        if (![binding.mimeType, 'application/octet-stream'].includes(contentType ?? '')
          || declaredLength !== binding.masterSize) throw new Error('candidate_contract_invalid')
        temporaryDirectory = await mkdtemp(join(temporaryRoot, 'qingmu-editorial-candidate-'))
        const temporaryPath = join(temporaryDirectory, 'master.media')
        const output = await open(temporaryPath, 'wx', 0o600)
        const digest = createHash('sha256')
        let size = 0
        try {
          for await (const raw of req) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
            size += chunk.byteLength
            if (size > binding.masterSize || size > MAX_MASTER_BYTES) throw new Error('candidate_size_mismatch')
            digest.update(chunk)
            await writeAllSpoolBytes(output, chunk)
          }
        } finally { await output.close() }
        if (size !== binding.masterSize || digest.digest('hex') !== binding.masterSha256) {
          throw new Error('candidate_bytes_mismatch')
        }
        const upstream = new URL(
          `/api/qingmu/projects/${encodeURIComponent(binding.projectId)}/episodes/${encodeURIComponent(binding.episodeId)}/editorial-handoff/returned-master-candidates`,
          dependencies.baseUrl,
        )
        const hostHeaders = editorialCandidateHeaders(
          binding, upstream.pathname, dependencies.readEditorialHandoffKey() ?? '',
        )
        if (hostHeaders === undefined) throw new Error('host_service_unavailable')
        submitted = true
        const response = await dependencies.fetch(upstream, {
          method: 'POST', redirect: 'error', headers: {
            authorization: `Bearer ${token}`, accept: 'application/json',
            'content-type': 'application/octet-stream', 'content-length': String(binding.masterSize),
            'x-qingmu-authenticated-user-id': binding.authenticatedUserId,
            'x-qingmu-master-sha256': binding.masterSha256,
            'x-qingmu-master-size': String(binding.masterSize),
            'x-qingmu-package-sha256': binding.packageSha256,
            'x-qingmu-package-size': String(binding.packageSize),
            'x-qingmu-source-snapshot-sha256': binding.sourceSnapshotSha256,
            'x-qingmu-projection-sha256': binding.projectionSha256,
            ...hostHeaders,
          }, body: createReadStream(temporaryPath), duplex: 'half',
        } as unknown as RequestInit & { duplex: 'half' })
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!response.ok) {
          submitted = false
          throw new Error(response.status === 409 ? 'candidate_writer_conflict' : 'candidate_writer_failed')
        }
        const result = bytes.length <= 4 * 1024 * 1024
          ? normalizeCandidateResult(JSON.parse(bytes.toString('utf8'))) : undefined
        if (result === undefined || !candidateMatchesBinding(result, binding)) {
          throw new Error('candidate_writer_contract_invalid')
        }
        dependencies.authorizer.finishCandidate(binding, { state: 'succeeded', createdAt: Date.now(), result })
        json(res, 200, result)
      } catch (error) {
        const unknown = submitted
        dependencies.authorizer.finishCandidate(binding, unknown
          ? { state: 'unknown', createdAt: Date.now(), errorCode: 'candidate_submission_unknown' }
          : { state: 'failed', createdAt: Date.now(), errorCode: error instanceof Error ? error.message : 'candidate_save_failed' })
        if (!res.headersSent) json(res, unknown ? 502 : 409, {
          code: unknown ? 'editorial_master_candidate_submission_unknown' : 'editorial_master_candidate_save_failed',
        })
        else res.destroy()
      } finally {
        if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  })
  return () => {
    disposeCandidate()
    disposeCandidateStatus()
    disposeCandidateList()
    disposeMaster()
    disposeMasterStatus()
    disposeImport()
    disposeImportStatus()
    disposeDownload()
    disposeStatus()
  }
}
