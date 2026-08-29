/** Browser-safe issue contract for an inactive paid-capable Director work order. */
export interface DirectorPaidWorkOrderRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
  readonly purpose: 'director_text_proposal_canary'
  readonly methodPackageVersion: string
  readonly methodPackageSha256: string
  readonly expectedContextSnapshotSha256: string
  readonly idempotencyKey: string
}

/** Browser-safe projection of a Yimeng-signed paid-capable Director work order. */
export interface DirectorPaidWorkOrder {
  readonly schema: 'jason.qingmu-director-provider-work-order.v1'
  readonly workOrderId: string
  readonly generationTaskId: string
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
  readonly provider: string
  readonly model: string
  readonly inputSha256: string
  readonly promptSha256: string
  readonly workOrderSha256: string
  readonly methodPackage: { readonly version: string; readonly sha256: string }
  readonly pricingSnapshot: { readonly sha256: string }
  readonly requestPolicy: { readonly maxAttempts: 1; readonly maxRetries: 0 }
  readonly dispatchState: string
}

/** Owner-scoped public status lookup for one issued Director work order. */
export interface DirectorPaidWorkOrderStatusRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly generationTaskId: string
}

/** Browser-safe technical status without any Host claim or Provider payload. */
export interface DirectorPaidWorkOrderStatus {
  readonly state: string
  readonly generationTaskId: string
  readonly executionReceipt: Readonly<Record<string, unknown>> | null
  readonly costAccounting: Readonly<Record<string, unknown>> | null
  readonly automaticRetry: false
}

const id = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) throw new Error(`${field} invalid`)
  return value
}
const digest = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} invalid`)
  return value
}
const object = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} invalid`)
  return value as Record<string, unknown>
}

/**
 * Parse the exact browser request for issuing an inactive paid-capable work order.
 * @param value Untrusted Host RPC payload.
 * @returns A scope- and digest-validated issue request.
 */
export function parseDirectorPaidWorkOrderRequest(value: unknown): DirectorPaidWorkOrderRequest {
  const root = object(value, 'director paid work order request')
  const keys = ['episodeId', 'expectedContextSnapshotSha256', 'idempotencyKey', 'methodPackageSha256',
    'methodPackageVersion', 'projectId', 'purpose', 'sceneId', 'shotId']
  if (Object.keys(root).sort().join('\0') !== keys.sort().join('\0')
    || root.purpose !== 'director_text_proposal_canary') throw new Error('director paid work order request invalid')
  return {
    projectId: id(root.projectId, 'projectId'), episodeId: id(root.episodeId, 'episodeId'),
    sceneId: id(root.sceneId, 'sceneId'), shotId: id(root.shotId, 'shotId'),
    purpose: 'director_text_proposal_canary', methodPackageVersion: id(root.methodPackageVersion, 'methodPackageVersion'),
    methodPackageSha256: digest(root.methodPackageSha256, 'methodPackageSha256'),
    expectedContextSnapshotSha256: digest(root.expectedContextSnapshotSha256, 'expectedContextSnapshotSha256'),
    idempotencyKey: digest(root.idempotencyKey, 'idempotencyKey'),
  }
}

/**
 * Normalize the public issue response while rejecting Host execution material.
 * @param value Untrusted Yimeng response.
 * @param request Original validated issue request.
 * @returns The browser-safe signed work-order projection.
 */
export function normalizeDirectorPaidWorkOrder(
  value: unknown,
  request: DirectorPaidWorkOrderRequest,
): DirectorPaidWorkOrder {
  const root = object(value, 'director paid work order')
  if (root.schema !== 'jason.qingmu-director-provider-work-order.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.sceneId !== request.sceneId || root.shotId !== request.shotId
    || root.inputSha256 !== request.expectedContextSnapshotSha256) {
    throw new Error('director paid work order scope mismatch')
  }
  const method = object(root.methodPackage, 'methodPackage')
  const pricing = object(root.pricingSnapshot, 'pricingSnapshot')
  const policy = object(root.requestPolicy, 'requestPolicy')
  if (method.version !== request.methodPackageVersion || method.sha256 !== request.methodPackageSha256
    || policy.maxAttempts !== 1 || policy.maxRetries !== 0
    || 'claimToken' in root || 'payload' in root || 'dispatch' in root) {
    throw new Error('director paid work order authority mismatch')
  }
  for (const [field, item] of Object.entries({ inputSha256: root.inputSha256, promptSha256: root.promptSha256,
    workOrderSha256: root.workOrderSha256, pricingSnapshotSha256: pricing.sha256 })) digest(item, field)
  for (const field of ['workOrderId', 'generationTaskId', 'provider', 'model', 'dispatchState']) id(root[field], field)
  return {
    schema: 'jason.qingmu-director-provider-work-order.v1',
    workOrderId: id(root.workOrderId, 'workOrderId'),
    generationTaskId: id(root.generationTaskId, 'generationTaskId'),
    projectId: request.projectId,
    episodeId: request.episodeId,
    sceneId: request.sceneId,
    shotId: request.shotId,
    provider: id(root.provider, 'provider'),
    model: id(root.model, 'model'),
    inputSha256: digest(root.inputSha256, 'inputSha256'),
    promptSha256: digest(root.promptSha256, 'promptSha256'),
    workOrderSha256: digest(root.workOrderSha256, 'workOrderSha256'),
    methodPackage: {
      version: id(method.version, 'methodPackage.version'),
      sha256: digest(method.sha256, 'methodPackage.sha256'),
    },
    pricingSnapshot: { sha256: digest(pricing.sha256, 'pricingSnapshot.sha256') },
    requestPolicy: { maxAttempts: 1, maxRetries: 0 },
    dispatchState: id(root.dispatchState, 'dispatchState'),
  }
}

/**
 * Parse an owner-scoped public status lookup.
 * @param value Untrusted Host RPC payload.
 * @returns A validated project, episode, and task coordinate.
 */
export function parseDirectorPaidWorkOrderStatusRequest(value: unknown): DirectorPaidWorkOrderStatusRequest {
  const root = object(value, 'director paid status request')
  const keys = ['episodeId', 'generationTaskId', 'projectId']
  if (Object.keys(root).sort().join('\0') !== keys.join('\0')) throw new Error('director paid status request invalid')
  return {
    projectId: id(root.projectId, 'projectId'), episodeId: id(root.episodeId, 'episodeId'),
    generationTaskId: id(root.generationTaskId, 'generationTaskId'),
  }
}

/**
 * Normalize a public technical status while rejecting private execution fields.
 * @param value Untrusted Yimeng status response.
 * @param request Original validated status coordinate.
 * @returns A browser-safe status projection.
 */
export function normalizeDirectorPaidWorkOrderStatus(
  value: unknown,
  request: DirectorPaidWorkOrderStatusRequest,
): DirectorPaidWorkOrderStatus {
  const root = object(value, 'director paid status')
  const keys = ['automaticRetry', 'costAccounting', 'executionReceipt', 'generationTaskId', 'state']
  if (Object.keys(root).sort().join('\0') !== keys.join('\0')
    || root.generationTaskId !== request.generationTaskId || root.automaticRetry !== false
    || typeof root.state !== 'string' || !/^[a-z_]{1,64}$/.test(root.state)
    || ['claimToken', 'payload', 'dispatch'].some(field => field in root)) {
    throw new Error('director paid status contract mismatch')
  }
  for (const field of ['executionReceipt', 'costAccounting'] as const) {
    if (root[field] !== null) object(root[field], `director paid status ${field}`)
  }
  return root as unknown as DirectorPaidWorkOrderStatus
}
