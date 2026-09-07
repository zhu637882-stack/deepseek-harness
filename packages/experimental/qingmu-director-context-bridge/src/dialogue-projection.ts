/** The current native dialogue operation, replayed over DSH's existing event stream. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { NativeDialogueExecution } from './types.ts'

const shot = z.object({ shotId: z.string(), frameNo: z.number(), title: z.string().nullable() }).strict()
/** Wire-safe status; model text, SQL, technical parameters and credentials are absent. */
export const nativeDialogueExecutionSchema: z.ZodType<NativeDialogueExecution> = z.object({
  scope: z.object({ projectId: z.string(), episodeId: z.string(), sceneId: z.string(), shotId: z.string() }).strict(),
  before: z.string(), after: z.string(), affectedShots: z.array(shot), unchangedShots: z.array(shot),
  status: z.enum(['prepared', 'saving', 'saved', 'uncertain', 'input_prepared']), commandReceiptId: z.string().nullable(),
}).strict()

/** Replay and live clients receive the same operation state without resubmitting it. */
export const nativeDialogueProjection: Omit<ProjectionDefinition<'qingmuDialogueExecution', NativeDialogueExecution | null>, 'wire'>
  & { wire: NonNullable<ProjectionDefinition<'qingmuDialogueExecution', NativeDialogueExecution | null>['wire']> } = {
    key: 'qingmuDialogueExecution', stateVersion: 1, stateSchema: nativeDialogueExecutionSchema.nullable(), init: () => null,
    apply: (state, event) => event.type === 'qingmu-director-dialogue/state'
      ? nativeDialogueExecutionSchema.parse(event.data) : state,
    wire: { viewSchema: nativeDialogueExecutionSchema.nullable(), view: state => state },
  }
