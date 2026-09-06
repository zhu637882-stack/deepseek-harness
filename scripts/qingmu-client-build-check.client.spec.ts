import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { writeClientBuildRecord } from './client-build-environment.ts'
import { checkQingmuClientBuild } from './qingmu-client-build-check.ts'

const commit = 'abcdef01'.repeat(5)
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qingmu-client-check-')); roots.push(root)
  mkdirSync(join(root, 'apps/web/dist'), { recursive: true })
  writeFileSync(join(root, 'apps/web/dist/index.html'), '<main>Qingmu</main>')
  const environment = { DSH_CLIENT_COMMIT_HASH: commit.slice(0, 7), DSH_CLIENT_BUILD_PROFILE: 'qingmu', DSH_CLIENT_TITLE: '青木 OS' }
  writeClientBuildRecord(root, environment)
  return { root, environment }
}
it('verifies the recorded Qingmu profile without writing the record', () => {
  const { root } = fixture(); const path = join(root, '.dsh-build/client-build-environment.json')
  const before = readFileSync(path, 'utf8')
  expect(checkQingmuClientBuild(root, commit).environment.DSH_CLIENT_BUILD_PROFILE).toBe('qingmu')
  expect(readFileSync(path, 'utf8')).toBe(before)
})
it.each(['profile', 'commit', 'bytes', 'missing', 'extra'] as const)('rejects %s drift', (reason) => {
  const { root, environment } = fixture()
  if (reason === 'profile') writeClientBuildRecord(root, { ...environment, DSH_CLIENT_BUILD_PROFILE: 'official' })
  if (reason === 'extra') writeClientBuildRecord(root, { ...environment, DSH_CLIENT_OTHER: 'unintended' })
  if (reason === 'bytes') writeFileSync(join(root, 'apps/web/dist/index.html'), '<main>drift</main>')
  if (reason === 'missing') rmSync(join(root, '.dsh-build/client-build-environment.json'))
  expect(() => checkQingmuClientBuild(root, reason === 'commit' ? 'f'.repeat(40) : commit)).toThrow()
})
it('uses the real CLI and exits unsuccessfully for a rejected build', () => {
  const { root } = fixture()
  const command = ['--import', 'tsx/esm', join(import.meta.dirname, 'qingmu-client-build-check.ts'), root, commit]
  const options = { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' as const, timeout: 10000,
    env: { PATH: process.env.PATH } }
  const accepted = spawnSync(process.execPath, command, options)
  expect(accepted.status, accepted.stderr).toBe(0)
  expect(JSON.parse(accepted.stdout)).toMatchObject({ verified: true })
  writeFileSync(join(root, 'apps/web/dist/index.html'), '<main>changed</main>')
  const rejected = spawnSync(process.execPath, command, options)
  expect(rejected.status).toBe(1)
  expect(rejected.stderr).toContain('client artifacts differ')
})
