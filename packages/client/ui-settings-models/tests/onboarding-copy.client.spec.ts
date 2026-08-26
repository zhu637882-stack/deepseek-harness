import { afterEach, describe, expect, it, vi } from 'vitest'

describe('build-profile onboarding copy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('keeps the upstream notice for stock builds', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    vi.resetModules()

    const copy = await import('../src/onboarding-copy.ts')

    expect(copy.WELCOME_NOTICE_VERSION).toBe('2026-08-13.1')
    expect(copy.DEEPSEEK_ONBOARDING_ENABLED).toBe(true)
    expect(copy.QINGMU_MODEL_ONBOARDING_ENABLED).toBe(false)
    expect(copy.WELCOME_NOTICE_COPY.en.body).toContain('DeepSeek Harness')
  })

  it('selects Qingmu copy and a distinct acknowledgement version', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'qingmu')
    vi.resetModules()

    const copy = await import('../src/onboarding-copy.ts')

    expect(copy.WELCOME_NOTICE_VERSION).toBe('qingmu-2026-08-26.1')
    expect(copy.DEEPSEEK_ONBOARDING_ENABLED).toBe(false)
    expect(copy.QINGMU_MODEL_ONBOARDING_ENABLED).toBe(true)
    expect(copy.WELCOME_NOTICE_COPY.zh.title).toBe('青木 OS 早期共创说明')
    expect(copy.WELCOME_NOTICE_COPY.en.body).not.toContain('DeepSeek Harness')
  })
})
