import { chmodSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createServiceTokenReader } from '../src/service-token.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function session() {
  const directory = mkdtempSync(join(tmpdir(), 'qingmu-session-test-'))
  directories.push(directory)
  return join(directory, 'session.json')
}

it('reads replacement tokens without recreating the reader or caching the fallback', () => {
  const file = session()
  const fallback = vi.fn(() => 'stale-environment')
  const read = createServiceTokenReader(file, fallback)
  expect(read()).toBeUndefined()
  writeFileSync(file, JSON.stringify({ token: 'first' }), { mode: 0o600 })
  expect(read()).toBe('first')
  writeFileSync(file + '.next', JSON.stringify({ token: 'second' }), { mode: 0o600 })
  renameSync(file + '.next', file)
  expect(read()).toBe('second')
  rmSync(file)
  expect(read()).toBeUndefined()
  expect(fallback).not.toHaveBeenCalled()
})

it.each(['{', 'null', '{}', '{"token":12}', '{"token":""}', '{"token":"a b"}', ' '.repeat(16_385)])(
  'fails closed for malformed private content %#', (content) => {
    const file = session()
    writeFileSync(file, content, { mode: 0o600 })
    expect(createServiceTokenReader(file, () => 'stale')()).toBeUndefined()
  },
)

it('refuses shared files and symlinks instead of exposing another token', () => {
  const file = session()
  writeFileSync(file, '{"token":"private"}', { mode: 0o600 })
  chmodSync(file, 0o644)
  expect(createServiceTokenReader(file)()).toBeUndefined()
  chmodSync(file, 0o600)
  symlinkSync(file, file + '.link')
  expect(createServiceTokenReader(file + '.link')()).toBeUndefined()
})

it('preserves explicit environment deployments and rejects relative session paths', () => {
  let token = 'one'
  const read = createServiceTokenReader(undefined, () => token)
  expect(read()).toBe('one')
  token = 'two'
  expect(read()).toBe('two')
  expect(() => createServiceTokenReader('session.json')).toThrow('absolute path')
})
