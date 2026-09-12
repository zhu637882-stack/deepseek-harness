/** Preserve authored design text when recovering missing JSON quote escapes. */
import { jsonrepair } from 'jsonrepair'

/** Parse a complete design; recovery may insert quote escapes but cannot add or remove creative text.
 * @param text - Original retained model output or manually imported JSON.
 * @returns Parsed value and whether missing quote escapes were repaired.
 */
export function parseQuotedDesignJson(text: string): { value: unknown; repaired: boolean } {
  try { return { value: JSON.parse(text) as unknown, repaired: false } }
  catch { /* Only missing quote escapes can be recovered below. */ }
  const repaired = jsonrepair(text)
  let source = 0
  for (let target = 0; target < repaired.length; target++) {
    if (text[source] === repaired[target]) { source++; continue }
    if (repaired[target] === '\\' && repaired[target + 1] === '"' && text[source] === '"') continue
    throw new Error('设计格式不完整，已保留原文；请修正后再采用。')
  }
  if (source !== text.length) throw new Error('设计格式不完整，已保留原文；请修正后再采用。')
  return { value: JSON.parse(repaired) as unknown, repaired: true }
}
