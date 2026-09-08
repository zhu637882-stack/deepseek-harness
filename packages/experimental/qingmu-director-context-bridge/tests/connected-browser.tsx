/** Test shell only: actual production component, with HTTP forwarding to real service handlers. */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { PromptIrBootstrapWorkspace } from '../../client-ui-qingmu-cockpit/src/client/PromptIrBootstrapWorkspace.tsx'
import type { QingmuYimengPort } from '../../client-ui-qingmu-cockpit/src/client/contracts.ts'
import type { DirectorContextClientPort } from '../src/types.ts'

const boot = await fetch('/fixture/boot').then(response => response.json())
async function call(namespace: string, endpoint: string, input: unknown, signal?: AbortSignal) {
  const response = await fetch(`/fixture/rpc/${namespace}/${endpoint}`, {
    method: 'POST', body: JSON.stringify(input), signal,
  })
  const result = await response.json()
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}
const endpoints = {
  promptIrBootstrap: 'read', promptIrBootstrapMethod: 'method', bootstrapPromptIr: 'command',
  recoverPromptIrBootstrap: 'command', selectBootstrapPromptIr: 'command', recoverPromptIrSelection: 'command',
}
// Unused members are intentionally absent: the shell cannot fabricate their results.
const port = Object.fromEntries(Object.entries(endpoints).map(([endpoint, namespace]) =>
  [endpoint, (input: unknown, signal?: AbortSignal) => call(namespace, endpoint, input, signal)])) as unknown as QingmuYimengPort
const bridge = {
  readNativeFirstDraftProposal: (sessionId: string, scope: unknown, signal?: AbortSignal) =>
    call('bridge', 'readNativeFirstDraftProposal', { sessionId, scope }, signal),
} as unknown as DirectorContextClientPort

function Fixture() {
  const [refreshed, setRefreshed] = useState('none')
  return <><h1>隔离真实服务联调 · 非正式项目</h1><output aria-label="外层权威回读">{refreshed}</output>
    <PromptIrBootstrapWorkspace {...boot.frame} selectedShotId={boot.frame.frameId} presentation="director"
      shotItems={[{ frameId: boot.frame.frameId, shotId: boot.frame.frameId, title: '空月台测试镜头' }]}
      onSelectShotId={() => {}} port={port} t={key => key}
      nativeDirector={{ bridge, sessionId: boot.sessionId, scope: boot.scope }}
      onCommitted={async () => {
        const state = await call('read', 'promptIrBootstrap', boot.frame)
        setRefreshed(state.ready?.status ?? state.draft?.status ?? 'none')
      }} />
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
