/** Pure replay fold for the session-owned Qingmu director relay batch ledger. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { relayStateSchema, type RelayState } from './relay-state.ts'

const validated: z.ZodType<RelayState> = relayStateSchema as z.ZodType<RelayState>

/** Latest whole-state event wins; all unrelated session events preserve the same state reference. */
export const relayStateProjectionDefinition: Omit<ProjectionDefinition<
  'qingmuDirectorRelay', RelayState | null
>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<
    'qingmuDirectorRelay', RelayState | null
  >['wire']>
} = {
  key: 'qingmuDirectorRelay',
  stateVersion: 1,
  stateSchema: validated.nullable(),
  init: () => null,
  apply: (state, event) => event.type === 'qingmu-director-relay/state'
    ? validated.nullable().parse(event.data)
    : state,
  wire: {
    viewSchema: validated.nullable(),
    view: state => state,
  },
}
