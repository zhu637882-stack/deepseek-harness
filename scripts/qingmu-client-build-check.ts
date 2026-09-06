/** Read-only Qingmu release check; reuse the complete client build record and digest. */
import { resolve } from 'node:path'
import { readClientBuildRecord, resolveClientBuildEnvironment, type ClientBuildRecord } from './client-build-environment.ts'

/**
 * Verify the exact Qingmu profile and current artifact bytes before recording a release.
 * @param root - Harness checkout containing the complete build record.
 * @param commit - Full Git commit independently read by the release caller.
 * @returns The verified existing record; no files, services, or credentials are changed.
 */
export function checkQingmuClientBuild(root: string, commit: string): ClientBuildRecord {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('Expected a full Git commit for the Qingmu client build')
  const expected = resolveClientBuildEnvironment({ DSH_CLIENT_COMMIT_HASH: commit.slice(0, 7) }, 'qingmu')
  return readClientBuildRecord(resolve(root), expected)
}

if (import.meta.main) {
  try {
    const [root, commit, extra] = process.argv.slice(2)
    if (!root || !commit || extra !== undefined) throw new Error('Usage: qingmu-client-build-check.ts HARNESS_ROOT COMMIT')
    const record = checkQingmuClientBuild(root, commit)
    process.stdout.write(JSON.stringify({ verified: true, ...record }) + '\n')
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n')
    process.exitCode = 1
  }
}
