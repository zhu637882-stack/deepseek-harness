import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'

/** Client transport handshake snapshots; reconnect publishes a fresh object. */
export function directorConnectionFixture() {
  const listeners = new Set<() => void>()
  let snapshot: ReturnType<HostDescriptionSource['getSnapshot']> = {
    version: 'fixture', cwd: '/project', attachedSessions: 1, home: '/fixture', canOpenPath: false,
  }
  const source: HostDescriptionSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { source, publish(online: boolean) {
    snapshot = online ? { version: 'fixture', cwd: '/project', attachedSessions: 1, home: '/fixture', canOpenPath: false } : undefined
    for (const listener of listeners) listener()
  } }
}
