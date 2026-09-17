import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CapsuleStoreError, loadApprovedCapsules, loadQueuedCapsules,
  withCapsuleStoreLock, writeCapsuleFile,
} from '../src/experience-capsule-files.ts'
import { capsuleActiveStorePathFor, capsuleQueuePathFor } from '../src/experience-capsule-store.ts'

async function runtimeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'capsule-store-'))
}

/** One queue entry carrying every field a submission writes. */
function queued(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, symptom: `${id} 症状`, rule: `${id} 规则`,
    submittedAt: '2026-09-16T00:00:00.000Z', sessionId: 'session-1', ...overrides,
  }
}

describe('capsule store lock', () => {
  it('runs one read-modify-write at a time', async () => {
    const order: string[] = []
    const first = withCapsuleStoreLock(async () => {
      order.push('first-start')
      await Promise.resolve()
      order.push('first-end')
    })
    const second = withCapsuleStoreLock(async () => { order.push('second') })
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('keeps the lock usable after a task fails', async () => {
    await expect(withCapsuleStoreLock(async () => { throw new CapsuleStoreError('boom') }))
      .rejects.toThrow('boom')
    await expect(withCapsuleStoreLock(async () => 'next')).resolves.toBe('next')
  })
})

describe('loadQueuedCapsules', () => {
  it('reads a missing queue as empty', async () => {
    expect(loadQueuedCapsules(capsuleQueuePathFor(await runtimeRoot()))).toEqual([])
  })

  it('keeps only well-formed entries in stored order', async () => {
    const path = capsuleQueuePathFor(await runtimeRoot())
    await writeFile(path, JSON.stringify([
      queued('SELF-01'),
      queued('SELF-02', { submittedAt: 42, sessionId: null }),
      null, ['SELF-03'], 'SELF-04',
      queued('bad id!'),
      queued('SELF-05', { symptom: 7 }),
      queued('SELF-06', { rule: 'x'.repeat(401) }),
      queued('SELF-07', { sessionId: 's'.repeat(257) }),
    ]), 'utf8')
    const entries = loadQueuedCapsules(path)
    expect(entries.map(entry => entry.id)).toEqual(['SELF-01', 'SELF-02', 'SELF-07'])
    expect(entries[1]).toEqual({ id: 'SELF-02', symptom: 'SELF-02 症状', rule: 'SELF-02 规则' })
    expect(entries[2]).toEqual({
      id: 'SELF-07', symptom: 'SELF-07 症状', rule: 'SELF-07 规则',
      submittedAt: '2026-09-16T00:00:00.000Z',
    })
  })

  it('fails loud on a queue that is not an array', async () => {
    const path = capsuleQueuePathFor(await runtimeRoot())
    await writeFile(path, JSON.stringify({ capsules: [] }), 'utf8')
    expect(() => loadQueuedCapsules(path)).toThrow(CapsuleStoreError)
    expect(() => loadQueuedCapsules(path)).toThrow(/not an array/u)
  })

  it('fails loud on a file it cannot read or parse', async () => {
    const root = await runtimeRoot()
    const blocked = join(root, 'blocked')
    await writeFile(blocked, 'not a directory', 'utf8')
    expect(() => loadQueuedCapsules(join(blocked, 'queue.json'))).toThrow(/unreadable/u)

    const directory = capsuleQueuePathFor(join(root, 'as-directory'))
    await mkdir(directory, { recursive: true })
    expect(() => loadQueuedCapsules(directory)).toThrow(/unreadable/u)

    const malformed = join(root, 'malformed.json')
    await writeFile(malformed, '{', 'utf8')
    expect(() => loadQueuedCapsules(malformed)).toThrow(/not valid JSON/u)

    const oversized = join(root, 'oversized.json')
    await writeFile(oversized, `"${'x'.repeat(1024 * 1024)}"`, 'utf8')
    expect(() => loadQueuedCapsules(oversized)).toThrow(/exceeds/u)
  })
})

describe('loadApprovedCapsules', () => {
  it('reads a missing store as empty and refuses one it cannot parse', async () => {
    const path = capsuleActiveStorePathFor(await runtimeRoot())
    expect(loadApprovedCapsules(path)).toEqual([])
    await writeFile(path, '{', 'utf8')
    expect(() => loadApprovedCapsules(path)).toThrow(CapsuleStoreError)
  })

  it('reads a document that is not the store shape as no capsule', async () => {
    const path = capsuleActiveStorePathFor(await runtimeRoot())
    await writeFile(path, JSON.stringify([{ id: 'EXP-01', symptom: 's', rule: 'r' }]), 'utf8')
    expect(loadApprovedCapsules(path)).toEqual([])
  })

  it('keeps the stored capsules and their stage tags', async () => {
    const path = capsuleActiveStorePathFor(await runtimeRoot())
    await writeFile(path, JSON.stringify({
      capsules: [
        { id: 'EXP-02', symptom: 'b', rule: 'B', stages: ['shooting'] },
        { id: 'EXP-01', symptom: 'a', rule: 'A' },
      ],
    }), 'utf8')
    expect(loadApprovedCapsules(path)).toEqual([
      { id: 'EXP-02', symptom: 'b', rule: 'B', stages: ['shooting'] },
      { id: 'EXP-01', symptom: 'a', rule: 'A' },
    ])
  })
})

describe('writeCapsuleFile', () => {
  it('replaces the whole file by rename and creates its directory', async () => {
    const path = capsuleQueuePathFor(join(await runtimeRoot(), 'nested', 'root'))
    await writeCapsuleFile(path, [queued('SELF-01')])
    await writeCapsuleFile(path, [queued('SELF-02')])
    const raw = await readFile(path, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  {\n')
    expect(JSON.parse(raw)).toEqual([queued('SELF-02')])
  })

  it('reports an unwritable path and leaves no temporary behind', async () => {
    const root = await runtimeRoot()
    const path = capsuleQueuePathFor(root)
    await mkdir(path, { recursive: true })
    await expect(writeCapsuleFile(path, [])).rejects.toThrow(/could not be written/u)
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})
