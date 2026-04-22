import type { ThemePreference } from '@shared/ipc.ts'
import { useAtomValue, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { refreshStatusAtom, themePreferenceAtom } from '@/state/atoms'

type ResolvedTheme = 'light' | 'dark'

function readSystem(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? readSystem() : pref
}

/**
 * Applies the active theme as `data-theme` on <html>.
 * Reads preference from Jotai; system mode follows OS via matchMedia.
 */
export function ThemeEffect({ children }: { children: ReactNode }) {
  const preference = useAtomValue(themePreferenceAtom)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference))

  useEffect(() => {
    setResolved(resolve(preference))
    if (preference !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  return <>{children}</>
}

/** Hook to change the theme preference; persists via IPC. */
export function useSetTheme() {
  const refresh = useSetAtom(refreshStatusAtom)
  return async (next: ThemePreference) => {
    await api.setTheme({ theme: next })
    await refresh()
  }
}
