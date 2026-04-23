import type { SyncOutcome, SyncRecord } from '@sweatrelay/core'

export type ThemePreference = 'system' | 'light' | 'dark'
export type AutoSyncMode = 'none' | 'watch' | 'schedule' | 'both'

export interface AppDiagnostics {
  keyringAvailable: boolean
  hasEncryptedCredentials: boolean
  stravaConfigPresent: boolean
  stravaTokensPresent: boolean
  onelapCredentialsPresent: boolean
  sharedConfigPresent: boolean
}

export interface AppStatus {
  configured: boolean
  needsUnlock: boolean
  configDir: string
  appVersion: string
  stravaConnected: boolean
  stravaConfigPresent: boolean
  stravaAthleteId?: number
  onelapConnected: boolean
  onelapAccount?: string
  watchDir?: string
  scheduleCron?: string
  autoSyncEnabled: boolean
  autoSyncMode: AutoSyncMode
  manualSyncAvailable: boolean
  theme: ThemePreference
  diagnostics: AppDiagnostics
  recentSyncs: SyncRecord[]
}

export interface ConfigurePayload {
  passphrase: string
  stravaClientId: string
  stravaClientSecret: string
}

export interface UnlockPayload {
  passphrase: string
}

export interface OnelapAuthPayload {
  account: string
  password: string
}

export interface SetWatchDirPayload {
  /** Directory path; pass null to clear. */
  dir: string | null
}

export interface SetSchedulePayload {
  /** 5-field cron, or null to disable. */
  cron: string | null
  timezone?: string
}

export interface SetThemePayload {
  theme: ThemePreference
}

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { name: string; message: string } }

/** The typed surface exposed via contextBridge as `window.sweatrelay`. */
export interface SweatRelayApi {
  /** Synchronously available host info (set once at preload time). */
  readonly platform: NodeJS.Platform
  status(): Promise<IpcResult<AppStatus>>
  configure(payload: ConfigurePayload): Promise<IpcResult<AppStatus>>
  unlock(payload: UnlockPayload): Promise<IpcResult<AppStatus>>
  authStrava(): Promise<IpcResult<AppStatus>>
  authOnelap(payload: OnelapAuthPayload): Promise<IpcResult<AppStatus>>
  setWatchDir(payload: SetWatchDirPayload): Promise<IpcResult<AppStatus>>
  setSchedule(payload: SetSchedulePayload): Promise<IpcResult<AppStatus>>
  setTheme(payload: SetThemePayload): Promise<IpcResult<AppStatus>>
  syncOnelap(): Promise<IpcResult<SyncOutcome[]>>
  pickDirectory(): Promise<IpcResult<string | null>>
  /** Subscribe to live sync events (file watcher / scheduled). Returns an unsubscribe fn. */
  onSyncEvent(handler: (outcome: SyncOutcome) => void): () => void
}

export const IPC_CHANNELS = {
  status: 'sweatrelay:status',
  configure: 'sweatrelay:configure',
  unlock: 'sweatrelay:unlock',
  authStrava: 'sweatrelay:authStrava',
  authOnelap: 'sweatrelay:authOnelap',
  setWatchDir: 'sweatrelay:setWatchDir',
  setSchedule: 'sweatrelay:setSchedule',
  setTheme: 'sweatrelay:setTheme',
  syncOnelap: 'sweatrelay:syncOnelap',
  pickDirectory: 'sweatrelay:pickDirectory',
  syncEvent: 'sweatrelay:syncEvent',
} as const
