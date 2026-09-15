/** Self-writeback experience channel: the director submits lesson capsules to a review queue. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { assertNativeTurnTarget } from './native-prompt-target.ts'

/** Capsules older than this are pruned so the queue cannot grow unbounded. */
const MAX_QUEUE_DAYS = 30

interface CapsuleDraft {
  id: string
  symptom: string
  rule: string
  submittedAt: string
  sessionId?: string
}

function isValidCapsule(value: unknown): value is Omit<CapsuleDraft, 'submittedAt' | 'sessionId'> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Record<string, unknown>
  return typeof draft.id === 'string' && /^[A-Za-z0-9_-]{3,32}$/u.test(draft.id)
    && typeof draft.symptom === 'string' && draft.symptom.trim().length > 0 && draft.symptom.length <= 400
    && typeof draft.rule === 'string' && draft.rule.trim().length > 0 && draft.rule.length <= 400
}

/**
 * Register the capsule-submission tool. The director calls it after finishing a
 * real assignment to record a lesson it can act on itself next time. Drafts land
 * in a JSON queue file under the runtime root; nothing enters the injection
 * layer until a human reviews and merges them into experience_capsules.json.
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
      await mkdir(dirname(capsuleQueuePath), { recursive: true })
      let queue: CapsuleDraft[] = []
      try {
        const raw = JSON.parse(await readFile(capsuleQueuePath, 'utf8')) as unknown
        if (Array.isArray(raw)) queue = raw.filter(isValidCapsule).map(item => ({ ...item, submittedAt: 'submittedAt' in item && typeof item.submittedAt === 'string' ? item.submittedAt : '' }))
      } catch { /* First write starts a fresh queue. */ }
      const cutoff = Date.now() - MAX_QUEUE_DAYS * 24 * 60 * 60 * 1000
      queue = queue.filter(item => item.submittedAt !== '' && Date.parse(item.submittedAt) >= cutoff)
      if (queue.some(item => item.id === draft.id)) throw new Error(`Capsule ${draft.id} is already queued; choose a new id.`)
      queue.push(draft)
      await writeFile(capsuleQueuePath, `${JSON.stringify(queue, null, 2)}\n`, { encoding: 'utf8' })
      return { queued: true, id: draft.id, queuePath: capsuleQueuePath, reviewRequired: true }
    },
  }))
}

/** Resolve the capsule queue path next to the runtime identity. */
export function capsuleQueuePathFor(runtimeRoot: string): string {
  return join(runtimeRoot, 'experience-capsule-queue.json')
}
