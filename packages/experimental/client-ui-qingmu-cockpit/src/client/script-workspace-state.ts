import type {
  YimengCommitScriptResponse,
  YimengPreviewScriptResponse,
  YimengScriptResponse,
} from './contracts.ts'

/** Observable phase of the human-operated script ChangeSet state machine. */
export type ScriptWorkspacePhase =
  | 'empty'
  | 'loading'
  | 'draft'
  | 'preparing'
  | 'preview'
  | 'conflict'
  | 'committing'
  | 'recovering'
  | 'committed'
  | 'error'

/** Network operation that produced the current recoverable error. */
export type ScriptWorkspaceOperation = 'load' | 'prepare' | 'commit' | 'recover'

/** Complete client state for one project-and-episode script workspace. */
export interface ScriptWorkspaceState {
  readonly phase: ScriptWorkspacePhase
  readonly snapshot?: YimengScriptResponse | undefined
  readonly draft: string
  readonly preview?: YimengPreviewScriptResponse | undefined
  readonly commit?: YimengCommitScriptResponse | undefined
  readonly commitRecovered: boolean
  readonly idempotencyKey?: string | undefined
  readonly confirmed: boolean
  readonly error?: string | undefined
  readonly errorOperation?: ScriptWorkspaceOperation | undefined
  readonly postCommitRefreshing: boolean
  readonly refreshWarning?: string | undefined
}

/** Closed action set accepted by the script workspace reducer. */
export type ScriptWorkspaceAction =
  | { readonly type: 'reset' }
  | { readonly type: 'load-start' }
  | { readonly type: 'load-success'; readonly snapshot: YimengScriptResponse }
  | { readonly type: 'load-failure'; readonly error: string }
  | { readonly type: 'edit'; readonly draft: string }
  | { readonly type: 'prepare-start' }
  | {
    readonly type: 'prepare-success'
    readonly preview: YimengPreviewScriptResponse
    readonly idempotencyKey: string
  }
  | { readonly type: 'prepare-failure'; readonly error: string }
  | { readonly type: 'confirm'; readonly value: boolean }
  | { readonly type: 'commit-start' }
  | { readonly type: 'recover-start' }
  | { readonly type: 'commit-success'; readonly commit: YimengCommitScriptResponse; readonly recovered: boolean }
  | { readonly type: 'commit-failure'; readonly error: string }
  | { readonly type: 'recover-failure'; readonly error: string }
  | { readonly type: 'discard-recovery' }
  | { readonly type: 'post-commit-refresh'; readonly snapshot: YimengScriptResponse }
  | { readonly type: 'post-commit-warning'; readonly warning: string }

/** Empty and side-effect-free initial state for a script workspace. */
export const INITIAL_SCRIPT_WORKSPACE_STATE: ScriptWorkspaceState = {
  phase: 'empty',
  draft: '',
  confirmed: false,
  commitRecovered: false,
  postCommitRefreshing: false,
}

/**
 * Remove persistence-only metadata while retaining every semantic script field.
 * @param snapshot - Host-validated authoritative Yimeng script response.
 * @returns An editable semantic script object without authority metadata.
 */
export function editableScript(snapshot: YimengScriptResponse): Record<string, unknown> {
  const source: Record<string, unknown> = snapshot.script === null
    ? { scenes: [{ sceneIndex: 1, title: '', actionDescription: '', dialogues: [] }] }
    : { ...snapshot.script }
  delete source.editMetadata
  return source
}

/**
 * Format an authoritative snapshot as the local human-editable JSON draft.
 * @param snapshot - Host-validated authoritative Yimeng script response.
 * @returns Pretty-printed semantic script JSON.
 */
export function formatScriptDraft(snapshot: YimengScriptResponse): string {
  return JSON.stringify(editableScript(snapshot), null, 2)
}

/**
 * Parse one semantic script draft without carrying Yimeng edit metadata back as authority.
 * @param draft - Human-edited JSON source.
 * @returns A semantic script object without persistence authority metadata.
 */
export function parseScriptDraft(draft: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(draft)
  } catch {
    throw new Error('剧本草稿不是有效 JSON，请先修正格式')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('剧本草稿必须是一个 JSON 对象')
  }
  const script = { ...value as Record<string, unknown> }
  delete script.editMetadata
  return script
}

/**
 * Build the stable key for exact retry of this immutable ChangeSet payload.
 * @param changeSetId - Immutable Yimeng ChangeSet identifier.
 * @param payloadSha256 - Verified immutable command payload SHA-256.
 * @returns A deterministic idempotency key scoped to the ChangeSet payload.
 */
export function scriptCommitIdempotencyKey(changeSetId: string, payloadSha256: string): string {
  return `qingmu:${changeSetId.slice(0, 100)}:${payloadSha256}`
}

/**
 * Apply one closed state-machine action without side effects.
 * @param state - Current script workspace state.
 * @param action - Validated workspace action.
 * @returns The next immutable workspace state.
 */
export function scriptWorkspaceReducer(
  state: ScriptWorkspaceState,
  action: ScriptWorkspaceAction,
): ScriptWorkspaceState {
  switch (action.type) {
    case 'reset': return INITIAL_SCRIPT_WORKSPACE_STATE
    case 'load-start': return { ...INITIAL_SCRIPT_WORKSPACE_STATE, phase: 'loading' }
    case 'load-success': return {
      ...INITIAL_SCRIPT_WORKSPACE_STATE,
      phase: 'draft',
      snapshot: action.snapshot,
      draft: formatScriptDraft(action.snapshot),
    }
    case 'load-failure': return {
      ...state,
      phase: 'error',
      error: action.error,
      errorOperation: 'load',
      confirmed: false,
      postCommitRefreshing: false,
    }
    case 'edit': return {
      ...state,
      phase: 'draft',
      draft: action.draft,
      preview: undefined,
      commit: undefined,
      commitRecovered: false,
      idempotencyKey: undefined,
      confirmed: false,
      error: undefined,
      errorOperation: undefined,
      refreshWarning: undefined,
    }
    case 'prepare-start': return {
      ...state,
      phase: 'preparing',
      preview: undefined,
      commit: undefined,
      commitRecovered: false,
      idempotencyKey: undefined,
      confirmed: false,
      error: undefined,
      errorOperation: undefined,
    }
    case 'prepare-success': return {
      ...state,
      phase: action.preview.canCommit ? 'preview' : 'conflict',
      preview: action.preview,
      idempotencyKey: action.idempotencyKey,
      confirmed: false,
      error: undefined,
      errorOperation: undefined,
    }
    case 'prepare-failure': return {
      ...state,
      phase: 'error',
      error: action.error,
      errorOperation: 'prepare',
      confirmed: false,
    }
    case 'confirm': return state.phase === 'preview'
      ? { ...state, confirmed: action.value }
      : state
    case 'commit-start': return {
      ...state,
      phase: 'committing',
      error: undefined,
      errorOperation: undefined,
    }
    case 'recover-start': return {
      ...state,
      phase: 'recovering',
      commit: undefined,
      commitRecovered: false,
      confirmed: false,
      error: undefined,
      errorOperation: undefined,
      postCommitRefreshing: false,
      refreshWarning: undefined,
    }
    case 'commit-success': return {
      ...state,
      phase: 'committed',
      commit: action.commit,
      commitRecovered: action.recovered,
      confirmed: false,
      error: undefined,
      errorOperation: undefined,
      postCommitRefreshing: true,
      refreshWarning: undefined,
    }
    case 'commit-failure': return {
      ...state,
      phase: 'error',
      error: action.error,
      errorOperation: 'commit',
      confirmed: false,
    }
    case 'recover-failure': return {
      ...state,
      phase: 'error',
      error: action.error,
      errorOperation: 'recover',
      confirmed: false,
      postCommitRefreshing: false,
    }
    case 'discard-recovery': return {
      ...state,
      phase: state.snapshot === undefined ? 'empty' : 'draft',
      preview: undefined,
      commit: undefined,
      commitRecovered: false,
      idempotencyKey: undefined,
      confirmed: false,
      error: undefined,
      errorOperation: undefined,
      postCommitRefreshing: false,
      refreshWarning: undefined,
    }
    case 'post-commit-refresh': return {
      ...state,
      snapshot: action.snapshot,
      draft: formatScriptDraft(action.snapshot),
      postCommitRefreshing: false,
      refreshWarning: undefined,
    }
    case 'post-commit-warning': return {
      ...state,
      postCommitRefreshing: false,
      refreshWarning: action.warning,
    }
  }
}

/**
 * Determine whether the current snapshot and phase permit creating a new preview.
 * @param state - Current script workspace state.
 * @returns Whether the prepare action is currently allowed.
 */
export function canPrepareScript(state: ScriptWorkspaceState): boolean {
  return state.snapshot !== undefined
    && !state.postCommitRefreshing
    && state.refreshWarning === undefined
    && (state.phase === 'draft' || state.phase === 'committed'
      || (state.phase === 'error' && state.errorOperation === 'prepare'))
}

/**
 * Determine whether a confirmed, committable preview may be submitted.
 * @param state - Current script workspace state.
 * @returns Whether the commit action is currently allowed.
 */
export function canCommitScript(state: ScriptWorkspaceState): boolean {
  return state.preview?.canCommit === true
    && state.idempotencyKey !== undefined
    && state.confirmed
    && (state.phase === 'preview' || (state.phase === 'error' && state.errorOperation === 'commit'))
}
