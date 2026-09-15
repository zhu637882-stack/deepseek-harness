import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { capsuleQueuePathFor, registerExperienceCapsuleTools } from '../src/experience-capsule-tools.ts'

const exec = { signal: new AbortController().signal, session: undefined, callId: 'call-1' }

type RegisteredTool = { name: string; execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> }

/** Minimal host exposing only the tool registry the capsule tool needs. */
async function makeQueue(): Promise<{ tool: RegisteredTool; queuePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'capsule-'))
  const queuePath = capsuleQueuePathFor(dir)
  const registry = new Map<string, RegisteredTool>()
  const host = { tools: { register: (tool: RegisteredTool) => { registry.set(tool.name, tool) } } }
  registerExperienceCapsuleTools(host as unknown as Context, queuePath)
  const tool = registry.get('qingmu_submit_experience_capsule')
  if (tool === undefined) throw new Error('capsule tool not registered')
  return { tool, queuePath }
}

describe('experience capsule tool', () => {
  it('queues a valid capsule and requires review', async () => {
    const { tool, queuePath } = await makeQueue()
    const result = await tool.execute({ id: 'SELF-01', symptom: '绑定失效导致保存被拒', rule: '保存前先确认当前镜头选择与请求一致' }, exec as never) as { queued: boolean; reviewRequired: boolean }
    expect(result.queued).toBe(true)
    expect(result.reviewRequired).toBe(true)
    const queue = JSON.parse(await readFile(queuePath, 'utf8')) as { id: string }[]
    expect(queue.length).toBe(1)
    expect(queue[0]?.id).toBe('SELF-01')
  })

  it('rejects duplicate ids and invalid payloads without writing', async () => {
    const { tool, queuePath } = await makeQueue()
    await writeFile(queuePath, `${JSON.stringify([{ id: 'SELF-01', symptom: 's', rule: 'r', submittedAt: new Date().toISOString() }])}\n`, 'utf8')
    await expect(tool.execute({ id: 'SELF-01', symptom: 'dup', rule: 'dup' }, exec as never)).rejects.toThrow(/already queued/)
    await expect(tool.execute({ id: '', symptom: 'no id', rule: 'x' }, exec as never)).rejects.toThrow()
    await expect(tool.execute({ id: 'SELF-02', symptom: '', rule: 'x' }, exec as never)).rejects.toThrow()
    const queue = JSON.parse(await readFile(queuePath, 'utf8')) as unknown[]
    expect(queue.length).toBe(1)
  })

  it('prunes stale entries older than the retention window', async () => {
    const { tool, queuePath } = await makeQueue()
    const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    await writeFile(queuePath, `${JSON.stringify([{ id: 'OLD-01', symptom: 's', rule: 'r', submittedAt: stale }])}\n`, 'utf8')
    await tool.execute({ id: 'SELF-03', symptom: 'new', rule: 'new' }, exec as never)
    const queue = JSON.parse(await readFile(queuePath, 'utf8')) as { id: string }[]
    expect(queue.map(item => item.id)).toEqual(['SELF-03'])
  })
})
