import { useCallback, useEffect, useRef, useState } from 'react'
import css from './ShootingFirstFrameHistory.module.css'

interface IdentityStatus {
  readonly schema: 'jason.qingmu-natural-person-identity-status.v1'
  readonly projectId: string
  readonly state: 'unbound' | 'bound' | 'invalid'
  readonly naturalPersonId: string | null
  readonly canEnroll: boolean
}

interface PresenceStatus {
  readonly schema: 'jason.qingmu-platform-human-presence-status.v1'
  readonly projectId: string
  readonly state: 'registered' | 'unregistered'
}

interface PresenceOptions {
  readonly schema: 'jason.qingmu-platform-human-presence-options.v1'
  readonly ceremony: 'registration' | 'authentication'
  readonly challengeId: string
  readonly publicKey: Record<string, unknown>
}

function isIdentityStatus(value: unknown): value is IdentityStatus {
  const record = value as Partial<IdentityStatus> | null
  return (
    record !== null &&
    typeof record === 'object' &&
    record.schema === 'jason.qingmu-natural-person-identity-status.v1' &&
    (record.state === 'unbound' || record.state === 'bound' || record.state === 'invalid') &&
    typeof record.projectId === 'string' &&
    typeof record.canEnroll === 'boolean'
  )
}

function isPresenceOptions(value: unknown): value is PresenceOptions {
  const record = value as Partial<PresenceOptions> | null
  return (
    record !== null &&
    typeof record === 'object' &&
    record.schema === 'jason.qingmu-platform-human-presence-options.v1' &&
    (record.ceremony === 'registration' || record.ceremony === 'authentication') &&
    typeof record.challengeId === 'string' &&
    typeof record.publicKey === 'object'
  )
}

function aborted(): DOMException {
  return new DOMException('The active project scope changed.', 'AbortError')
}

function base64Url(value: ArrayBuffer | null): string | null {
  if (value === null) return null
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('platform_presence_options_invalid')
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, item => item.charCodeAt(0)).buffer
}

async function platformAssertion(
  options: PresenceOptions,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!Reflect.has(globalThis, 'PublicKeyCredential') || !Reflect.has(navigator, 'credentials')) {
    throw new Error('platform_presence_unavailable')
  }
  const source = options.publicKey
  const challenge = decodeBase64Url(source.challenge)
  let credential: Credential | null

  if (options.ceremony === 'registration') {
    const user = source.user as Record<string, unknown> | undefined
    const selection = source.authenticatorSelection as AuthenticatorSelectionCriteria | undefined
    if (
      user === undefined ||
      typeof user.name !== 'string' ||
      typeof user.displayName !== 'string' ||
      selection?.authenticatorAttachment !== 'platform' ||
      selection.userVerification !== 'required'
    ) {
      throw new Error('platform_presence_options_invalid')
    }
    credential = await navigator.credentials.create({
      signal,
      publicKey: {
        ...(source as unknown as PublicKeyCredentialCreationOptions),
        challenge,
        user: {
          ...user,
          id: decodeBase64Url(user.id),
        } as PublicKeyCredentialUserEntity,
      },
    })
  } else {
    const allowed = Array.isArray(source.allowCredentials)
      ? source.allowCredentials.map((item) => {
        const value = item as Record<string, unknown>
        return {
          ...value,
          id: decodeBase64Url(value.id),
        } as PublicKeyCredentialDescriptor
      })
      : []
    if (source.userVerification !== 'required' || allowed.length !== 1) {
      throw new Error('platform_presence_options_invalid')
    }
    credential = await navigator.credentials.get({
      signal,
      publicKey: {
        ...(source as unknown as PublicKeyCredentialRequestOptions),
        challenge,
        allowCredentials: allowed,
      },
    })
  }

  if (
    signal.aborted ||
    !(credential instanceof PublicKeyCredential) ||
    credential.authenticatorAttachment !== 'platform'
  ) {
    throw signal.aborted ? aborted() : new Error('platform_presence_not_verified')
  }

  const response = credential.response
  const serialized: Record<string, unknown> = {
    clientDataJSON: base64Url(response.clientDataJSON),
  }
  if (response instanceof AuthenticatorAttestationResponse) {
    serialized.attestationObject = base64Url(response.attestationObject)
    serialized.transports = response.getTransports()
  } else if (response instanceof AuthenticatorAssertionResponse) {
    serialized.authenticatorData = base64Url(response.authenticatorData)
    serialized.signature = base64Url(response.signature)
    serialized.userHandle = base64Url(response.userHandle)
  } else {
    throw new Error('platform_presence_not_verified')
  }

  return {
    challengeId: options.challengeId,
    credential: {
      id: credential.id,
      rawId: base64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: serialized,
    },
  }
}

interface NaturalPersonIdentityGateProps {
  readonly projectId: string
  readonly episodeId: string
  /** Only rereads the blocked selection state after explicit enrollment. */
  readonly onBound: () => Promise<void>
}

/** Explicit local login, platform-presence, and identity binding for the current first-frame decision. */
export function NaturalPersonIdentityGate({
  projectId,
  episodeId,
  onBound,
}: NaturalPersonIdentityGateProps) {
  const [identity, setIdentity] = useState<IdentityStatus>()
  const [presence, setPresence] = useState<PresenceStatus>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState<'idle' | 'saving' | 'ready' | 'failed'>('idle')
  const [phase, setPhase] = useState<'idle' | 'prompting' | 'saving'>('idle')
  const [error, setError] = useState('')
  const scopeVersion = useRef(0)
  const loadController = useRef<AbortController>()
  const actionController = useRef<AbortController>()
  const enrollmentKey = useRef('')

  const current = (version: number, signal?: AbortSignal) =>
    version === scopeVersion.current && signal?.aborted !== true
  const query = useCallback(
    () => new URLSearchParams({ projectId, episodeId }).toString(),
    [episodeId, projectId],
  )

  const load = useCallback(
    async (signal: AbortSignal, version: number) => {
      const params = query()
      const [identityResponse, presenceResponse] = await Promise.all([
        fetch(`/api/qingmu/editorial-handoff/natural-person-identity?${params}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        }),
        fetch(`/api/qingmu/editorial-handoff/human-presence-credential?${params}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        }),
      ])
      if (!current(version, signal)) return

      const identityValue: unknown = identityResponse.ok
        ? await identityResponse.json()
        : undefined
      const presenceValue: unknown = presenceResponse.ok
        ? await presenceResponse.json()
        : undefined
      if (!current(version, signal)) return

      const identityStatus = isIdentityStatus(identityValue) ? identityValue : undefined
      const presenceStatus = presenceValue as PresenceStatus | undefined
      if (
        identityStatus?.schema === 'jason.qingmu-natural-person-identity-status.v1' &&
        identityStatus.projectId === projectId
      ) {
        setIdentity(identityStatus)
      }
      if (
        presenceStatus?.schema === 'jason.qingmu-platform-human-presence-status.v1' &&
        presenceStatus.projectId === projectId
      ) {
        setPresence(presenceStatus)
      }
    },
    [projectId, query],
  )

  const readIdentity = useCallback(
    async (signal: AbortSignal, version: number): Promise<IdentityStatus | undefined> => {
      const response = await fetch(
        `/api/qingmu/editorial-handoff/natural-person-identity?${query()}`,
        { cache: 'no-store', credentials: 'same-origin', signal },
      )
      if (!current(version, signal) || !response.ok) return undefined
      const value: unknown = await response.json()
      if (!current(version, signal) || !isIdentityStatus(value) || value.projectId !== projectId) {
        return undefined
      }
      setIdentity(value)
      return value
    },
    [projectId, query],
  )

  useEffect(() => {
    const version = ++scopeVersion.current
    enrollmentKey.current = ''
    loadController.current?.abort()
    actionController.current?.abort()
    const next = new AbortController()
    loadController.current = next

    setIdentity(undefined)
    setPresence(undefined)
    setSession('idle')
    setPhase('idle')
    setError('')
    setPassword('')
    void load(next.signal, version).catch((cause: unknown) => {
      if (
        current(version, next.signal) &&
        !(cause instanceof DOMException && cause.name === 'AbortError')
      ) {
        setError('身份状态暂时无法读取。请稍后重新检查。')
      }
    })

    return () => {
      next.abort()
      actionController.current?.abort()
      if (scopeVersion.current === version) scopeVersion.current += 1
    }
  }, [load])

  const beginAction = (version: number) => {
    if (!current(version)) throw aborted()
    const next = new AbortController()
    actionController.current?.abort()
    actionController.current = next
    return next
  }

  const refreshIdentity = async () => {
    const version = scopeVersion.current
    let next: AbortController
    try {
      next = beginAction(version)
    } catch {
      return
    }
    setError('')
    try {
      await readIdentity(next.signal, version)
    } catch {
      if (current(version, next.signal)) {
        setError('身份状态暂时无法读取。请稍后重新检查。')
      }
    } finally {
      if (actionController.current === next) actionController.current = undefined
    }
  }

  const login = async () => {
    if (session === 'saving' || username.trim() === '' || password === '') return
    const version = scopeVersion.current
    let next: AbortController
    try {
      next = beginAction(version)
    } catch {
      return
    }

    setSession('saving')
    setError('')
    try {
      const response = await fetch('/api/qingmu/editorial-handoff/human-session', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: next.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!current(version, next.signal)) return
      if (!response.ok) throw new Error('human_session_login_failed')
      setPassword('')
      setSession('ready')
      await load(next.signal, version)
    } catch (cause) {
      if (
        current(version, next.signal) &&
        !(cause instanceof DOMException && cause.name === 'AbortError')
      ) {
        setSession('failed')
        setError('本人账户登录未完成；服务账户不能代替本人会话。')
      }
    } finally {
      if (actionController.current === next) actionController.current = undefined
    }
  }

  const requestWithPresence = async (
    path: string,
    body: Record<string, unknown>,
    next: AbortController,
    version: number,
  ) => {
    const initial = await fetch(`${path}?${query()}`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: next.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!current(version, next.signal)) throw aborted()
    if (!initial.ok) return initial

    const options: unknown = await initial.json()
    if (!current(version, next.signal)) throw aborted()
    if (!isPresenceOptions(options)) {
      throw new Error('platform_presence_options_invalid')
    }

    setPhase('prompting')
    const assertion = await platformAssertion(options, next.signal)
    if (!current(version, next.signal)) throw aborted()
    return fetch(`${path}?${query()}`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: next.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, platformAssertion: assertion }),
    })
  }

  const registerPresence = async () => {
    if (session !== 'ready' || phase !== 'idle') return
    const version = scopeVersion.current
    let next: AbortController
    try {
      next = beginAction(version)
    } catch {
      return
    }

    setPhase('saving')
    setError('')
    try {
      const response = await requestWithPresence(
        '/api/qingmu/editorial-handoff/human-presence-credential',
        {},
        next,
        version,
      )
      if (!current(version, next.signal)) return
      if (!response.ok) throw new Error('platform_presence_registration_failed')
      const value = (await response.json()) as PresenceStatus
      if (current(version, next.signal)) setPresence(value)
    } catch (cause) {
      if (
        current(version, next.signal) &&
        !(cause instanceof DOMException && cause.name === 'AbortError')
      ) {
        setError(cause instanceof Error ? cause.message : 'platform_presence_registration_failed')
      }
    } finally {
      if (current(version)) setPhase('idle')
      if (actionController.current === next) actionController.current = undefined
    }
  }

  const enroll = async () => {
    if (
      session !== 'ready' ||
      presence?.state !== 'registered' ||
      identity?.canEnroll !== true ||
      phase !== 'idle'
    ) {
      return
    }
    const version = scopeVersion.current
    let next: AbortController
    try {
      next = beginAction(version)
    } catch {
      return
    }
    if (enrollmentKey.current === '') {
      enrollmentKey.current = `natural-person-${crypto.randomUUID()}`
    }

    setPhase('saving')
    setError('')
    try {
      const response = await requestWithPresence(
        '/api/qingmu/editorial-handoff/natural-person-identity',
        {
          confirmed: true,
          idempotencyKey: enrollmentKey.current,
        },
        next,
        version,
      )
      if (!current(version, next.signal)) return
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? 'natural_person_identity_relogin_required'
            : 'natural_person_identity_enrollment_failed',
        )
      }

      const refreshed = await readIdentity(next.signal, version)
      if (!current(version, next.signal)) return
      if (refreshed?.state !== 'bound') {
        throw new Error('natural_person_identity_enrollment_not_confirmed')
      }
      enrollmentKey.current = ''
      await onBound()
    } catch (cause) {
      if (!current(version, next.signal) || (cause instanceof DOMException && cause.name === 'AbortError')) {
        return
      }

      // A lost response is not permission to submit again. Read this same scope
      // once; retain the idempotency key until an explicit retry or a bound result.
      let refreshed: IdentityStatus | undefined
      try {
        refreshed = await readIdentity(next.signal, version)
      } catch {
        // Preserve the original failure below when the safety read also fails.
      }
      if (!current(version, next.signal)) return
      if (refreshed?.state === 'bound') {
        enrollmentKey.current = ''
        await onBound()
        return
      }

      const failure = cause instanceof Error
        ? cause.message
        : 'natural_person_identity_enrollment_failed'
      if (failure === 'natural_person_identity_relogin_required') setSession('idle')
      setError(failure)
    } finally {
      if (current(version)) setPhase('idle')
      if (actionController.current === next) actionController.current = undefined
    }
  }

  return (
    <section className={css.identityGate} aria-label="本人身份确认">
      <h3>采用首帧前需要本人身份确认</h3>
      <p>
        首帧候选仍可查看。采用必须由本人完成账户登录、平台在场凭据和
        自然人身份绑定；不会自动登录、绑定或采用。
      </p>
      {identity?.state === 'invalid' ? (
        <>
          <p role="alert">
            当前本人身份绑定状态异常，不能在这里继续绑定。请先处理账户身份冲突后再重新检查。
          </p>
          <button type="button" onClick={() => { void refreshIdentity() }}>
            重新检查本人身份状态
          </button>
        </>
      ) : identity?.state === 'bound' ? (
        <>
          <p role="status">本人身份已绑定。可重新检查采用条件。</p>
          <button type="button" onClick={() => { void onBound() }}>
            重新检查采用条件
          </button>
        </>
      ) : (
        <>
          <label>
            <span>本人账户</span>
            <input
              aria-label="本人账户"
              autoComplete="username"
              value={username}
              onChange={(event) => { setUsername(event.currentTarget.value) }}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              aria-label="本人账户密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => { setPassword(event.currentTarget.value) }}
            />
          </label>
          <button
            type="button"
            disabled={session === 'saving' || username.trim() === '' || password === ''}
            onClick={() => { void login() }}
          >
            {session === 'saving' ? '正在登录本人账户…' : '登录本人账户'}
          </button>
          {session === 'ready' && (
            <>
              <p role="status">
                {presence?.state === 'registered'
                  ? '平台在场凭据已就绪。'
                  : '下一步需要使用本机的平台在场凭据。'}
              </p>
              {presence?.state !== 'registered' && (
                <button
                  type="button"
                  disabled={phase !== 'idle'}
                  onClick={() => { void registerPresence() }}
                >
                  {phase === 'prompting' ? '请在设备上确认…' : '登记平台在场凭据'}
                </button>
              )}
              {presence?.state === 'registered' && (
                <button
                  type="button"
                  disabled={phase !== 'idle' || identity?.canEnroll !== true}
                  onClick={() => { void enroll() }}
                >
                  {phase === 'prompting' ? '请在设备上确认…' : '确认并绑定本人身份'}
                </button>
              )}
              {phase === 'prompting' && (
                <button type="button" onClick={() => { actionController.current?.abort() }}>
                  取消设备确认
                </button>
              )}
            </>
          )}
        </>
      )}
      {error !== '' && <p role="alert">{error}</p>}
    </section>
  )
}
