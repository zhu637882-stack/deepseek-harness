/** Provider-neutral first-run model setup for the Qingmu distribution. */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { providerUsable } from './store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './QingmuModelOnboarding.module.css'

/** Registration-side dependencies of {@link QingmuModelOnboarding}. */
export interface QingmuModelOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Provider-neutral feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type QingmuModelOnboardingProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<QingmuModelOnboardingInjected>

/**
 * Offer the Models section when no usable provider is configured, without
 * promoting or preselecting any provider.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the neutral setup modal, or null once a provider is usable.
 */
export function QingmuModelOnboarding(props: QingmuModelOnboardingProps): ReactNode {
  const { complete, openSection, controller, useModels, t } = props
  const state = useModels(snapshot => snapshot)
  const finished = useRef(false)
  const finish = useCallback((section?: string): void => {
    if (finished.current) return
    finished.current = true
    if (section !== undefined) openSection(section)
    complete()
  }, [complete, openSection])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const providerReady = state.status === 'ready' && state.rows.some(providerUsable)
  useEffect(() => {
    if (providerReady) finish()
  }, [finish, providerReady])

  if (state.status === 'idle' || state.status === 'loading' || providerReady) return null

  return (
    <OnboardingModal title={t('qingmuOnboardingTitle')} focusTitle>
      <p className={styles.description}>{t('qingmuOnboardingDescription')}</p>
      {state.status === 'error'
        ? <p className={styles.error} role="alert">{t('qingmuOnboardingLoadError')}</p>
        : null}
      <div className={styles.actions}>
        <Button onClick={() => { finish() }}>{t('qingmuOnboardingLater')}</Button>
        <Button variant="primary" onClick={() => { finish('models') }}>
          {t('qingmuOnboardingOpenModels')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
