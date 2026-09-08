/** Pure replay fold for the session-owned Qingmu director context binding. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { DirectorContextBindingState } from './types.ts'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const scopeSchema = z.object({
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  sceneId: z.string().min(1),
  shotId: z.string().min(1),
}).strict()
const proposalSchema = z.object({
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  sceneId: z.string().min(1),
  shotId: z.string().min(1),
  contextSnapshotSha256: sha256Schema,
  methodPackageVersion: z.string().min(1),
  methodPackageSha256: sha256Schema,
  workOrderId: z.string().min(1),
  workOrderSha256: sha256Schema,
  promptSha256: sha256Schema,
  proposalId: z.string().min(1),
  proposalSha256: sha256Schema,
  outputSha256: sha256Schema,
}).strict()

/** Strict persisted-state boundary shared by checkpoint restore and wire output. */
export const directorContextBindingStateSchema = z.object({
  version: z.literal(1),
  binding: z.object({
    scope: scopeSchema,
    contextSnapshotSha256: sha256Schema,
  }).strict(),
  proposal: proposalSchema.nullable(),
  transition: z.enum(['enter', 'switch', 'recovery_drift', 'proposal_attached']),
}).strict().superRefine((state, ctx) => {
  if (state.proposal === null) {
    if (state.transition === 'proposal_attached') {
      ctx.addIssue({ code: 'custom', path: ['proposal'], message: 'proposal_attached requires a proposal' })
    }
    return
  }
  if (state.transition !== 'proposal_attached') {
    ctx.addIssue({ code: 'custom', path: ['transition'], message: 'a proposal requires proposal_attached' })
  }
  const scope = state.binding.scope
  const proposal = state.proposal
  if (proposal.projectId !== scope.projectId
    || proposal.episodeId !== scope.episodeId
    || proposal.sceneId !== scope.sceneId
    || proposal.shotId !== scope.shotId
    || proposal.contextSnapshotSha256 !== state.binding.contextSnapshotSha256) {
    ctx.addIssue({
      code: 'custom',
      path: ['proposal'],
      message: 'proposal coordinates and context SHA must match the active binding',
    })
  }
}) as z.ZodType<DirectorContextBindingState>

/** Latest whole-state event wins; all unrelated session events preserve the same state reference. */
export const directorContextBindingProjectionDefinition: Omit<ProjectionDefinition<
  'qingmuDirectorContext', DirectorContextBindingState | null
>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<
    'qingmuDirectorContext', DirectorContextBindingState | null
  >['wire']>
} = {
  key: 'qingmuDirectorContext',
  stateVersion: 1,
  stateSchema: directorContextBindingStateSchema.nullable(),
  init: () => null,
  apply: (state, event) => event.type === 'qingmu-director-context/state'
    ? directorContextBindingStateSchema.nullable().parse(event.data)
    : state,
  wire: {
    viewSchema: directorContextBindingStateSchema.nullable(),
    view: state => state,
  },
}
