import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  capsuleActiveStorePathFor,
  capsuleQueuePathFor,
  loadActiveCapsules,
  mergeApprovedCapsules,
  renderExperienceCapsulesBlock,
  resolveCapsuleRuntimeRoot,
  type ActiveCapsule,
  type QueuedCapsule,
} from '../src/experience-capsule-store.ts'

async function writeStore(value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'capsule-store-'))
  const path = capsuleActiveStorePathFor(dir)
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
  return path
}

describe('loadActiveCapsules', () => {
  it('returns the stored capsules and drops malformed entries', async () => {
    const path = await writeStore({
      capsules: [
        { id: 'EXP-016', stages: ['video'], symptom: '无声角色嘴唇微动', rule: '静音锁写双唇闭合' },
        { id: 'no-rule', symptom: 'x', rule: '   ' },
        { id: '', symptom: 'x', rule: 'y' },
        'not-an-object',
        { id: 'EXP-001', symptom: '', rule: '交付可区分三件套' },
      ],
    })
    expect(loadActiveCapsules(path)).toEqual([
      { id: 'EXP-016', stages: ['video'], symptom: '无声角色嘴唇微动', rule: '静音锁写双唇闭合' },
      { id: 'EXP-001', symptom: '', rule: '交付可区分三件套' },
    ])
  })

  it('contributes nothing for a missing or malformed store', async () => {
    expect(loadActiveCapsules(join(tmpdir(), 'does-not-exist-capsules.json'))).toEqual([])
    expect(loadActiveCapsules(await writeStore({ capsules: 'nope' }))).toEqual([])
    expect(loadActiveCapsules(await writeStore([{ id: 'x', symptom: 'a', rule: 'b' }]))).toEqual([])
  })
})

describe('renderExperienceCapsulesBlock', () => {
  it('renders a bounded newest-first block with a symptom arrow', () => {
    const capsules: ActiveCapsule[] = [
      { id: 'a', symptom: '症状A', rule: '规则A' },
      { id: 'b', symptom: '', rule: '规则B' },
    ]
    expect(renderExperienceCapsulesBlock(capsules)).toBe(
      '\n最近踩坑经验（人审入库，本次会话优先遵守）：\n- 症状A→规则A\n- 规则B',
    )
  })

  it('caps the rendered lines at the limit', () => {
    const capsules: ActiveCapsule[] = Array.from({ length: 5 }, (_unused, index) => ({
      id: `c${index}`, symptom: '', rule: `规则${index}`,
    }))
    const block = renderExperienceCapsulesBlock(capsules, 2)
    expect(block.trimStart().split('\n')).toHaveLength(3)
    expect(block).toContain('规则0')
    expect(block).toContain('规则1')
    expect(block).not.toContain('规则2')
  })

  it('returns an empty string when there are no capsules', () => {
    expect(renderExperienceCapsulesBlock([])).toBe('')
  })
})

describe('mergeApprovedCapsules', () => {
  const queue: QueuedCapsule[] = [
    { id: 'SELF-01', symptom: '旧症状', rule: '旧规则', submittedAt: '2026-09-15T00:00:00Z' },
    { id: 'SELF-02', symptom: '新症状', rule: '新规则', submittedAt: '2026-09-16T00:00:00Z' },
    { id: 'SELF-03', symptom: '未审', rule: '未审', submittedAt: '2026-09-16T01:00:00Z' },
  ]
  const active: ActiveCapsule[] = [{ id: 'EXP-001', symptom: '', rule: '既有规则' }]

  it('promotes approved entries newest-first, tags stages, and trims the queue', () => {
    const result = mergeApprovedCapsules(queue, active, ['SELF-01', 'SELF-02'], { 'SELF-02': ['video'] })
    expect(result.merged).toEqual(['SELF-01', 'SELF-02'])
    expect(result.active).toEqual([
      { id: 'SELF-01', symptom: '旧症状', rule: '旧规则' },
      { id: 'SELF-02', symptom: '新症状', rule: '新规则', stages: ['video'] },
      { id: 'EXP-001', symptom: '', rule: '既有规则' },
    ])
    expect(result.remainingQueue.map(entry => entry.id)).toEqual(['SELF-03'])
  })

  it('supersedes an active capsule that reuses an approved id', () => {
    const stale: ActiveCapsule[] = [{ id: 'SELF-02', symptom: '过期', rule: '过期规则' }]
    const result = mergeApprovedCapsules(queue, stale, ['SELF-02'])
    expect(result.active).toEqual([{ id: 'SELF-02', symptom: '新症状', rule: '新规则' }])
  })

  it('ignores unapproved ids and leaves the store unchanged when nothing is approved', () => {
    const result = mergeApprovedCapsules(queue, active, [])
    expect(result.merged).toEqual([])
    expect(result.active).toEqual(active)
    expect(result.remainingQueue).toEqual(queue)
  })
})

describe('capsule file resolution', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('puts both capsule files directly in the runtime root', () => {
    expect(capsuleQueuePathFor('/runtime')).toBe(join('/runtime', 'experience-capsule-queue.json'))
    expect(capsuleActiveStorePathFor('/runtime')).toBe(join('/runtime', 'experience-capsules-active.json'))
  })

  it('prefers the runtime root and reports an unconfigured channel as empty', () => {
    vi.stubEnv('QINGMU_RUNTIME_ROOT', '/runtime')
    vi.stubEnv('QINGMU_NATIVE_ROOT', '/native')
    expect(resolveCapsuleRuntimeRoot()).toBe('/runtime')
    vi.stubEnv('QINGMU_RUNTIME_ROOT', undefined)
    expect(resolveCapsuleRuntimeRoot()).toBe('/native')
    vi.stubEnv('QINGMU_NATIVE_ROOT', undefined)
    expect(resolveCapsuleRuntimeRoot()).toBe('')
  })
})
