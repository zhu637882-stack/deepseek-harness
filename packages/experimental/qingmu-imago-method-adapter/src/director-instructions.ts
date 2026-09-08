/** Fixed, paged read-only access to the current C and C5 directing methods. */

import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type {
  ImagoDirectorInstructionsRequest,
  ImagoDirectorInstructionsResponse,
} from './types.ts'

/** Browser input outside the two fixed capability/resource allowlists. */
export class DirectorInstructionsInputError extends Error {}

/** A fixed source cannot be returned in full under the declared read contract. */
export class DirectorInstructionsContentError extends Error {}

const MAX_RESOURCE_BYTES = 128 * 1024
const MAX_PACKAGE_BYTES = 512 * 1024

type ResourceSpec = {
  readonly resourceId: string
  readonly path: string
  readonly kind: 'skill' | 'direct_reference'
}

type CapabilitySpec = {
  readonly packagePath: string
  readonly resources: readonly ResourceSpec[]
  readonly additionalReferences: readonly ResourceSpec[]
  readonly methodScope: string
}

const CAPABILITIES = {
  director_development: {
    packagePath: 'skill-package/imago-c-director-development',
    resources: [
      { resourceId: 'skill', path: 'skill-package/imago-c-director-development/SKILL.md', kind: 'skill' },
      { resourceId: 'director_evidence_standard', path: 'skill-package/imago-c-director-development/references/director-evidence-standard.md', kind: 'direct_reference' },
      { resourceId: 'scene_performance_blocking_method', path: 'skill-package/imago-c-director-development/references/scene-performance-blocking-method.md', kind: 'direct_reference' },
      { resourceId: 'coverage_media_review_method', path: 'skill-package/imago-c-director-development/references/coverage-media-review-method.md', kind: 'direct_reference' },
    ],
    additionalReferences: [],
    methodScope: 'C director development: dramatic change, performance and blocking, coverage, sound, and C5 handoff.',
  },
  shot_design: {
    packagePath: 'skill-package/imago-c5-execution-storyboard',
    resources: [
      { resourceId: 'skill', path: 'skill-package/imago-c5-execution-storyboard/SKILL.md', kind: 'skill' },
      { resourceId: 'execution_closure_standard', path: 'skill-package/imago-c5-execution-storyboard/references/execution-closure-standard.md', kind: 'direct_reference' },
      { resourceId: 'shot_grammar_continuity_lsu_method', path: 'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md', kind: 'direct_reference' },
      { resourceId: 'director_storyboard_production_loop', path: 'skill-package/imago-c5-execution-storyboard/references/director-storyboard-production-loop.md', kind: 'direct_reference' },
    ],
    additionalReferences: [
      { resourceId: 'rough_final_feedback', path: 'skill-package/imago-c5-execution-storyboard/references/rough-final-feedback-closure-method.md', kind: 'direct_reference' },
    ],
    methodScope: 'C5 shot design: compile C direction into coverage topology, shot state, continuity, LSU paths, generation-risk routing, and production-ready execution; detailed rough-to-final feedback closure remains an additional direct reference.',
  },
} as const satisfies Readonly<Record<ImagoDirectorInstructionsRequest['capability'], CapabilitySpec>>

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex')

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isContainedByCoreRoot(coreRoot: string, resolvedPath: string): boolean {
  return coreRoot === sep ? resolvedPath.startsWith(sep) : resolvedPath.startsWith(`${coreRoot}${sep}`)
}

/**
 * Reject caller-supplied filesystem coordinates and select one fixed capability package.
 * @param payload - untrusted Host request arguments.
 * @returns validated capability and optional fixed supplementary resource identifier.
 */
export function parseDirectorInstructionsRequest(payload: unknown): ImagoDirectorInstructionsRequest {
  if (!object(payload) || (Object.keys(payload).length !== 1 && Object.keys(payload).length !== 2)
    || !Object.hasOwn(payload, 'capability')
    || !Object.keys(payload).every(key => key === 'capability' || key === 'resourceId')
    || (payload.capability !== 'director_development' && payload.capability !== 'shot_design')
    || (Object.hasOwn(payload, 'resourceId') && payload.resourceId !== 'rough_final_feedback')
    || (payload.resourceId === 'rough_final_feedback' && payload.capability !== 'shot_design')) {
    throw new DirectorInstructionsInputError('directorInstructions accepts only capability')
  }
  const capability = payload.capability
  return payload.resourceId === undefined
    ? { capability }
    : { capability, resourceId: payload.resourceId as 'rough_final_feedback' }
}

async function readResource(
  coreRoot: string,
  resource: ResourceSpec,
  signal: AbortSignal,
): Promise<{ readonly resourceId: string; readonly path: string; readonly kind: 'skill' | 'direct_reference'; readonly content: string; readonly sha256: string; readonly byteLength: number }> {
  const resolvedPath = await realpath(join(coreRoot, resource.path))
  if (!isContainedByCoreRoot(coreRoot, resolvedPath)) {
    throw new DirectorInstructionsContentError(`directorInstructions source resolves outside Core root: ${resource.path}`)
  }
  const handle = await open(resolvedPath, 'r')
  let bytes: Buffer
  try {
    if (signal.aborted) throw new DirectorInstructionsContentError('directorInstructions read was cancelled')
    const before = await handle.stat()
    if (!before.isFile()) throw new DirectorInstructionsContentError(`directorInstructions source is not a file: ${resource.path}`)
    if (before.size > MAX_RESOURCE_BYTES) {
      throw new DirectorInstructionsContentError(`directorInstructions source exceeds ${String(MAX_RESOURCE_BYTES)} bytes: ${resource.path}`)
    }
    bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead === 0) throw new DirectorInstructionsContentError(`directorInstructions source changed while reading: ${resource.path}`)
      offset += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== before.size || bytes.byteLength > MAX_RESOURCE_BYTES) {
      throw new DirectorInstructionsContentError(`directorInstructions source changed or exceeds limit: ${resource.path}`)
    }
  } finally {
    await handle.close()
  }
  signal.throwIfAborted()
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new DirectorInstructionsContentError(`directorInstructions source is not UTF-8: ${resource.path}`)
  }
  return { ...resource, content, sha256: sha256(bytes), byteLength: bytes.byteLength }
}

/**
 * Read one complete, fixed method package and bind every source to its manifest.
 * @param coreRoot - resolved deployment root; it is never accepted from the RPC payload.
 * @param request - fixed capability identifier.
 * @param signal - caller cancellation signal.
 * @returns full requested source text with complete package provenance and read-only authority.
 */
export async function loadDirectorInstructions(
  coreRoot: string,
  request: ImagoDirectorInstructionsRequest,
  signal: AbortSignal,
): Promise<ImagoDirectorInstructionsResponse> {
  const specification = CAPABILITIES[request.capability]
  const resolvedCoreRoot = await realpath(coreRoot)
  if (signal.aborted) throw new DirectorInstructionsContentError('directorInstructions read was cancelled')
  const primaryResources = await Promise.all(specification.resources.map(
    async resource => await readResource(resolvedCoreRoot, resource, signal),
  ))
  const additionalResources = await Promise.all(specification.additionalReferences.map(
    async resource => await readResource(resolvedCoreRoot, resource, signal),
  ))
  signal.throwIfAborted()
  const resources = [...primaryResources, ...additionalResources]
  const packageByteLength = resources.reduce((total, resource) => total + resource.byteLength, 0)
  if (packageByteLength > MAX_PACKAGE_BYTES) {
    throw new DirectorInstructionsContentError(`directorInstructions package exceeds ${String(MAX_PACKAGE_BYTES)} bytes`)
  }
  const sourceBindings = resources.map(({ resourceId, path, kind, sha256: sourceSha256, byteLength }) => ({
    resourceId, path, kind, sha256: sourceSha256, byteLength,
  }))
  const packageBody = {
    schema: 'qingmu.imago-director-instructions.v1' as const,
    capability: request.capability,
    packagePath: specification.packagePath,
    sourceBindings,
    additionalReferences: specification.additionalReferences.map(({ resourceId, path }) => ({ resourceId, path, required: true as const })),
    methodScope: specification.methodScope,
    maxResourceBytes: MAX_RESOURCE_BYTES,
    maxPackageBytes: MAX_PACKAGE_BYTES,
  }
  return {
    ...packageBody,
    packageSha256: sha256(canonicalJson(packageBody)),
    requestedResourceId: request.resourceId ?? null,
    sources: request.resourceId === undefined
      ? primaryResources
      : additionalResources.filter(resource => resource.resourceId === request.resourceId),
    authority: {
      readOnly: true,
      businessTruth: 'yimeng',
      methodSource: 'imago_os',
      providerCalls: 0,
      maximumCostCny: '0',
      approvalGranted: false,
      humanDecisionInferred: false,
      formalQcInferred: false,
      projectStateWrite: false,
    },
  }
}
