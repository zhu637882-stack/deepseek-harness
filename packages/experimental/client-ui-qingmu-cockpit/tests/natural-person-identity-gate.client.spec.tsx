// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NaturalPersonIdentityGate } from '../src/client/NaturalPersonIdentityGate.tsx'

type Deferred<T> = { readonly promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((next) => { resolve = next }), resolve }
}
function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }) }
function identity(projectId: string, state: 'unbound' | 'bound' = 'unbound') { return { schema: 'jason.qingmu-natural-person-identity-status.v1', projectId, state, naturalPersonId: state === 'bound' ? 'person' : null, canEnroll: state === 'unbound' } }
function presence(projectId: string) { return { schema: 'jason.qingmu-platform-human-presence-status.v1', projectId, state: 'unregistered' } }

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('aborts old-scope status reads and ignores their delayed identity result', async () => {
  const oldIdentity = deferred<Response>(); const oldPresence = deferred<Response>()
  const fetcher = vi.mocked(fetch)
  fetcher.mockImplementation((input) => {
    const url = String(input)
    if (url.includes('projectId=one')) return url.includes('natural-person-identity') ? oldIdentity.promise : oldPresence.promise
    return Promise.resolve(response(url.includes('natural-person-identity') ? identity('two') : presence('two')))
  })
  const onBound = vi.fn(async () => undefined)
  const view = render(<NaturalPersonIdentityGate projectId="one" episodeId="episode" onBound={onBound} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const oldSignals = fetcher.mock.calls.slice(0, 2).map(([, init]) => (init as RequestInit).signal as AbortSignal)
  view.rerender(<NaturalPersonIdentityGate projectId="two" episodeId="episode" onBound={onBound} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
  expect(oldSignals.every(signal => signal.aborted)).toBe(true)
  oldIdentity.resolve(response(identity('one', 'bound'))); oldPresence.resolve(response(presence('one')))
  await Promise.resolve(); await Promise.resolve()
  expect(screen.queryByText('本人身份已绑定。可重新检查采用条件。')).toBeNull()
  expect(onBound).not.toHaveBeenCalled()
})

it('cancels a stale login before it can trigger a further presence request or identity callback', async () => {
  const delayedLogin = deferred<Response>()
  const fetcher = vi.mocked(fetch)
  fetcher.mockImplementation((input) => {
    const url = String(input)
    if (url.endsWith('/human-session')) return delayedLogin.promise
    const projectId = new URL(url, 'http://localhost').searchParams.get('projectId')!
    return Promise.resolve(response(url.includes('natural-person-identity') ? identity(projectId) : presence(projectId)))
  })
  const onBound = vi.fn(async () => undefined)
  const view = render(<NaturalPersonIdentityGate projectId="one" episodeId="episode" onBound={onBound} />)
  const account = await screen.findByRole('textbox', { name: '本人账户' })
  fireEvent.change(account, { target: { value: 'human@example.test' } })
  fireEvent.change(screen.getByLabelText('本人账户密码'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: '登录本人账户' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/qingmu/editorial-handoff/human-session', expect.objectContaining({ method: 'POST' })))
  const loginCall = fetcher.mock.calls.find(([url]) => String(url).endsWith('/human-session'))!
  const loginSignal = (loginCall[1] as RequestInit).signal as AbortSignal
  view.rerender(<NaturalPersonIdentityGate projectId="two" episodeId="episode" onBound={onBound} />)
  expect(loginSignal.aborted).toBe(true)
  delayedLogin.resolve(response({ schema: 'jason.qingmu-human-session.v1' }))
  await Promise.resolve(); await Promise.resolve()
  const oldPresenceReads = fetcher.mock.calls.filter(([url]) => String(url).includes('human-presence-credential?projectId=one'))
  expect(oldPresenceReads).toHaveLength(1)
  expect(onBound).not.toHaveBeenCalled()
})

function registeredPresence(projectId: string) {
  return {
    schema: 'jason.qingmu-platform-human-presence-status.v1',
    projectId,
    state: 'registered',
  }
}

function authenticationOptions() {
  return {
    schema: 'jason.qingmu-platform-human-presence-options.v1',
    ceremony: 'authentication',
    challengeId: 'challenge-platform-12345678',
    publicKey: {
      challenge: 'AAAAAAAAAAAAAAAA',
      userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: 'BAUG' }],
    },
  }
}

function installPlatformAssertionMock() {
  class FakeAttestationResponse { readonly fixture = true }
  class FakeAssertionResponse {
    clientDataJSON = Uint8Array.of(1).buffer
    authenticatorData = Uint8Array.of(2).buffer
    signature = Uint8Array.of(3).buffer
    userHandle = null
  }
  class FakePublicKeyCredential {
    id = 'platform-credential-test'
    rawId = Uint8Array.of(4, 5, 6).buffer
    type = 'public-key'
    authenticatorAttachment = 'platform'
    response = new FakeAssertionResponse()
    getClientExtensionResults() { return {} }
  }
  vi.stubGlobal('AuthenticatorAttestationResponse', FakeAttestationResponse)
  vi.stubGlobal('AuthenticatorAssertionResponse', FakeAssertionResponse)
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { get: vi.fn(async () => new FakePublicKeyCredential()) },
  })
}

async function loginForEnrollment() {
  fireEvent.change(await screen.findByRole('textbox', { name: '本人账户' }), {
    target: { value: 'human@example.test' },
  })
  fireEvent.change(screen.getByLabelText('本人账户密码'), {
    target: { value: 'secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: '登录本人账户' }))
  await screen.findByRole('button', { name: '确认并绑定本人身份' })
}

function installLostEnrollmentResponse(committed: boolean) {
  let identityBound = false
  let finalPosts = 0
  const fetcher = vi.mocked(fetch)
  fetcher.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/human-session')) return response({ ok: true })
    if (url.includes('human-presence-credential')) return response(registeredPresence('p'))
    if (url.includes('natural-person-identity') && method === 'GET') {
      return response(identity('p', identityBound ? 'bound' : 'unbound'))
    }
    if (url.includes('natural-person-identity') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (body.platformAssertion === undefined) return response(authenticationOptions())
      finalPosts += 1
      identityBound = committed
      throw new Error('response_lost_after_commit')
    }
    return new Response('{}', { status: 404 })
  })
  return { fetcher, finalPosts: () => finalPosts }
}

it('recovers a lost identity-enrollment response by GET and only then clears the stable key', async () => {
  installPlatformAssertionMock()
  const route = installLostEnrollmentResponse(true)
  const onBound = vi.fn(async () => undefined)
  render(<NaturalPersonIdentityGate projectId="p" episodeId="episode" onBound={onBound} />)
  await loginForEnrollment()
  fireEvent.click(screen.getByRole('button', { name: '确认并绑定本人身份' }))
  await waitFor(() => expect(onBound).toHaveBeenCalledTimes(1))
  expect(route.finalPosts()).toBe(1)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('keeps the enrollment key after a lost response whose safety GET remains unbound, without another POST', async () => {
  installPlatformAssertionMock()
  const route = installLostEnrollmentResponse(false)
  const onBound = vi.fn(async () => undefined)
  render(<NaturalPersonIdentityGate projectId="p" episodeId="episode" onBound={onBound} />)
  await loginForEnrollment()
  fireEvent.click(screen.getByRole('button', { name: '确认并绑定本人身份' }))
  await screen.findByRole('alert')
  expect(route.finalPosts()).toBe(1)
  expect(onBound).not.toHaveBeenCalled()
})

it('shows an invalid identity state as an explicit conflict that cannot continue binding', async () => {
  const fetcher = vi.mocked(fetch)
  fetcher.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('natural-person-identity')) {
      return response({
        ...identity('p'),
        state: 'invalid',
        canEnroll: false,
      })
    }
    return response(presence('p'))
  })
  render(<NaturalPersonIdentityGate projectId="p" episodeId="episode" onBound={vi.fn(async () => undefined)} />)
  expect(await screen.findByText(/当前本人身份绑定状态异常/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '登录本人账户' })).toBeNull()
  expect(screen.getByRole('button', { name: '重新检查本人身份状态' })).toBeTruthy()
})
