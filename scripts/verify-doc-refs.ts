/**
 * Verify root-relative documentation paths in repo-authored TypeScript. The
 * textual scan covers `docs/*.md` and `.agents/notes/*.md`, requires the
 * extension, checks matching string literals too, and excludes built
 * declarations, vendored source, and declared external-owner references.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { findReferenceViolations, uniqueRepoFiles, type ReferenceViolation as Violation } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/** Repo-authored TypeScript that may cite docs in comments. */
const PATTERNS = ['packages/**/*.ts', 'examples/**/*.ts']

/** Paths excluded from the scan: built output and vendored upstream source. */
const isExcluded = (p: string): boolean =>
  p.includes('/lib/') || p.endsWith('.d.ts') || p.startsWith('vendor/')

/** Root-relative Markdown path token, excluding trailing prose. */
const DOC_REF = /(?:\bdocs|\.agents\/notes)\/[A-Za-z0-9._/-]+\.md/g

/** IMAGO Core-owned method source resolved below the deployment-specific Core root. */
const EXTERNAL_OWNER_REFS = new Set(['docs/qingmu-os/report-source.md'])

/** Find every broken root-relative documentation reference in one TypeScript file. */
function findViolations(absPath: string): Violation[] {
  return findReferenceViolations(
    root,
    absPath,
    DOC_REF,
    ref => ref,
    ref => !EXTERNAL_OWNER_REFS.has(ref) && !existsSync(resolve(root, ref)),
  )
}

const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
const all = files.flatMap(file => findViolations(file.abs))
const checked = files.length

if (all.length === 0) {
  console.log(`verify-doc-refs: ${checked} file(s) checked, all documentation references resolve.`)
  process.exit(0)
}

console.error('verify-doc-refs: broken documentation references found in source comments (target does not exist):')
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.ref}`)
}
process.exit(1)
