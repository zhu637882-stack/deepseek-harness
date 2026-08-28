/** Browser-only unsaved text, never a persisted Draft or an approval source. */
export interface DirectorEditBuffer {
  readonly source: string
  readonly text: string
}

/** Bind a recovery buffer to one project/episode/revision/frame.
 * @param coordinates Ordered canonical identities.
 * @returns Scoped session-storage key.
 */
export function directorBufferKey(coordinates: readonly string[]): string {
  return `qingmu.director.unsaved.v1:${JSON.stringify(coordinates)}`
}

/** Read only the exact scoped buffer; malformed or inaccessible storage is an error.
 * @param key Scoped key.
 * @returns Unsaved text or null; callers must compare the source before allowing saves.
 */
export function readDirectorBuffer(key: string): DirectorEditBuffer | null {
  const raw = sessionStorage.getItem(key)
  if (raw === null) return null
  const value = JSON.parse(raw) as Partial<DirectorEditBuffer> | null
  if (value === null || typeof value.source !== 'string' || typeof value.text !== 'string') {
    throw new Error('本地未保存内容损坏；请保留当前文字，勿覆盖。')
  }
  return { source: value.source, text: value.text }
}

/** Persist or remove browser recovery text, without claiming server persistence.
 * @param key Scoped key.
 * @param value Unsaved buffer, or null after verified readback/explicit discard.
 */
export function writeDirectorBuffer(key: string, value: DirectorEditBuffer | null): void {
  if (value === null) sessionStorage.removeItem(key)
  else {
    const raw = JSON.stringify(value)
    sessionStorage.setItem(key, raw)
    if (sessionStorage.getItem(key) !== raw) throw new Error('Browser recovery buffer was not retained')
  }
}
