/** Self-writeback experience channel: the director submits lesson capsules to a review queue. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CAPSULE_ID, loadQueuedCapsules, withCapsuleStoreLock, writeCapsuleFile } from './experience-capsule-files.ts'
import type { QueuedCapsule } from './experience-capsule-store.ts'
import { assertNativeTurnTarget } from './native-prompt-target.ts'

/** Capsules older than this are pruned so the queue cannot grow unbounded. */
const MAX_QUEUE_DAYS = 30

type CapsuleDraft = QueuedCapsule & { readonly submittedAt: string }

function isValidCapsule(value: unknown): value is Pick<CapsuleDraft, 'id' | 'symptom' | 'rule'> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Record<string, unknown>
  return typeof draft.id === 'string' && CAPSULE_ID.test(draft.id)
    && typeof draft.symptom === 'string' && draft.symptom.trim().length > 0 && draft.symptom.length <= 400
    && typeof draft.rule === 'string' && draft.rule.trim().length > 0 && draft.rule.length <= 400
}

/**
 * Register the capsule-submission tool. The director calls it after finishing a
 * real assignment to record a lesson it can act on itself next time. Drafts land
 * in the review queue under the runtime root; nothing enters the injection layer
 * until an operator promotes them into the active store, which the review routes
 * in `experience-capsule-review.ts` do on one human decision.
 * @param ctx - the director's agent or preset scope, so the tool is only visible
 * to the session that can learn from its own work.
 * @param capsuleQueuePath - queue path from `capsuleQueuePathFor`.
 */
export function registerExperienceCapsuleTools(ctx: Context, capsuleQueuePath: string): void {
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  ctx.tools.register(defineTool({
    name: 'qingmu_submit_experience_capsule',
    description: 'After finishing a real assignment, submit one operational lesson you learned yourself: a pitfall you hit and the concrete rule you will follow next time to avoid it. Rules must be executable by you through tool order, self-recovery or verification timing — never changes that require system code. Each capsule is queued for human review; it reaches future sessions only after approval. Do not submit system rules you were told, only what the work taught you. No shot data, secrets, or project content.',
    parameters: {
      id: { type: 'string', required: true, description: 'Short capsule id you invent, letters/digits/dashes, 3-32 chars. Use a SELF- prefix to mark it as self-learned.' },
      symptom: { type: 'string', required: true, description: 'One sentence describing the pitfall or failure you actually hit.' },
      rule: { type: 'string', required: true, description: 'One sentence describing the concrete behavior you will apply next time. Must be within your own control.' },
    },
    output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '提交经验胶囊' }),
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      if (exec.agent !== undefined) assertNativeTurnTarget(exec.agent.session, exec.callId, 'selection')
      if (!isValidCapsule(args)) throw new Error('Capsule needs a valid id plus nonempty symptom and rule (max 400 chars each).')
      const draft: CapsuleDraft = {
        id: args.id, symptom: args.symptom.trim(), rule: args.rule.trim(),
        submittedAt: new Date().toISOString(),
        ...(typeof exec.agent?.session?.id === 'string' ? { sessionId: exec.agent.session.id } : {}),
      }
      const cutoff = Date.now() - MAX_QUEUE_DAYS * 24 * 60 * 60 * 1000
      await withCapsuleStoreLock(async () => {
        const queue = loadQueuedCapsules(capsuleQueuePath)
          .filter(entry => entry.submittedAt !== undefined && Date.parse(entry.submittedAt) >= cutoff)
        if (queue.some(entry => entry.id === draft.id)) throw new Error(`Capsule ${draft.id} is already queued; choose a new id.`)
        await writeCapsuleFile(capsuleQueuePath, [...queue, draft])
      })
      return { queued: true, id: draft.id, queuePath: capsuleQueuePath, reviewRequired: true }
    },
  }))
}
