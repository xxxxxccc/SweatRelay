import type { AppStatus, ThemePreference } from '@shared/ipc.ts'
import { atom } from 'jotai'
import { api } from '@/lib/api'

/** Central app status mirror — written by IPC effects, read by every page. */
export const statusAtom = atom<AppStatus | null>(null)

/** Convenience derived atoms. */
export const configuredAtom = atom((get) => get(statusAtom)?.configured ?? false)
export const themePreferenceAtom = atom<ThemePreference>(
  (get) => get(statusAtom)?.theme ?? 'system',
)

/** Async refresh — write `null` to trigger; reads call `api.status()`. */
export const refreshStatusAtom = atom(null, async (_get, set) => {
  const res = await api.status()
  if (res.ok) set(statusAtom, res.value)
})
