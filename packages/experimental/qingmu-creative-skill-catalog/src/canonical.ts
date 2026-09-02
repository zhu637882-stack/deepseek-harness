import { createHash } from 'node:crypto'

import { CreativeSkillCatalogError } from './error.ts'

/**
 * Serialize supported JSON data with Unicode-code-point-sorted keys and no whitespace.
 * @param value - JSON-compatible data to serialize.
 * @returns the deterministic JSON text.
 */
export function canonicalCreativeSkillJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    const serialized: unknown = JSON.stringify(value)
    if (typeof serialized !== 'string') throw new CreativeSkillCatalogError('creative_skill_json_invalid')
    return serialized
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CreativeSkillCatalogError('creative_skill_json_invalid')
    const serialized: unknown = JSON.stringify(Object.is(value, -0) ? 0 : value)
    if (typeof serialized !== 'string') throw new CreativeSkillCatalogError('creative_skill_json_invalid')
    return serialized
  }
  if (Array.isArray(value)) return `[${value.map(canonicalCreativeSkillJson).join(',')}]`
  if (typeof value !== 'object') throw new CreativeSkillCatalogError('creative_skill_json_invalid')
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CreativeSkillCatalogError('creative_skill_json_invalid')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort((left, right) => {
    const a = Array.from(left)
    const b = Array.from(right)
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      const delta = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0)
      if (delta !== 0) return delta
    }
    return a.length - b.length
  })
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalCreativeSkillJson(record[key])}`).join(',')}}`
}

/**
 * Hash one value through the catalog's canonical JSON form.
 * @param value - JSON-compatible data to bind.
 * @returns the lowercase SHA-256 digest.
 */
export function creativeSkillSha256(value: unknown): string {
  return createHash('sha256').update(canonicalCreativeSkillJson(value), 'utf8').digest('hex')
}

/**
 * Hash exact source bytes without JSON normalization.
 * @param bytes - source bytes or UTF-8 text.
 * @returns the lowercase SHA-256 digest.
 */
export function creativeSkillBytesSha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}
