import type {
  CorosImportOutcome,
  CorosRegionId,
  IntervalsTrainingLoadReport,
  SyncOutcome,
  SyncRecord,
  TrainingPlanOverview,
  TrainingPlanSyncResult,
  UpdateTrainingPlanInput,
  UpsertPlannedWorkoutInput,
} from '@sweatrelay/core'

export type ThemePreference = 'system' | 'light' | 'dark'
export type AutoSyncMode = 'none' | 'watch' | 'schedule' | 'both'
export type TrainingStatusRange = 'current' | 'future7' | 'future14'

export interface AppDiagnostics {
  keyringAvailable: boolean
  hasEncryptedCredentials: boolean
  stravaConfigPresent: boolean
  stravaTokensPresent: boolean
  intervalsCredentialsPresent: boolean
  onelapCredentialsPresent: boolean
  corosCredentialsPresent: boolean
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
  intervalsConnected: boolean
  corosConnected: boolean
  corosUserId?: string
  onelapConnected: boolean
  onelapAccount?: string
  watchDir?: string
  scheduleCron?: string
  autoSyncEnabled: boolean
  autoSyncMode: AutoSyncMode
  manualSyncAvailable: boolean
  corosManualSyncAvailable: boolean
  trainingStatusEnabled: boolean
  trainingStatusRange: TrainingStatusRange
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

export interface IntervalsAuthPayload {
  apiKey: string
}

export interface CorosAuthPayload {
  userId: string
  accessToken: string
  regionId?: CorosRegionId
  cookie?: string
}

export interface TrainingLoadPayload {
  days?: number
  forecastDays?: number
}

export interface SetTrainingStatusPayload {
  enabled?: boolean
  range?: TrainingStatusRange
}

export interface TrainingPlanPayload {
  planId?: string
}

export type UpdateTrainingPlanPayload = UpdateTrainingPlanInput
export type UpsertPlannedWorkoutPayload = UpsertPlannedWorkoutInput

export interface DeletePlannedWorkoutPayload {
  planId: string
  workoutId: string
}

export interface SyncTrainingPlanPayload {
  planId: string
}

export interface SyncTrainingPlanResult {
  overview: TrainingPlanOverview
  result: TrainingPlanSyncResult
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
  authIntervals(payload: IntervalsAuthPayload): Promise<IpcResult<AppStatus>>
  authCoros(payload: CorosAuthPayload): Promise<IpcResult<AppStatus>>
  trainingLoad(payload?: TrainingLoadPayload): Promise<IpcResult<IntervalsTrainingLoadReport>>
  setTrainingStatus(payload: SetTrainingStatusPayload): Promise<IpcResult<AppStatus>>
  trainingPlan(payload?: TrainingPlanPayload): Promise<IpcResult<TrainingPlanOverview>>
  updateTrainingPlan(payload: UpdateTrainingPlanPayload): Promise<IpcResult<TrainingPlanOverview>>
  upsertPlannedWorkout(
    payload: UpsertPlannedWorkoutPayload,
  ): Promise<IpcResult<TrainingPlanOverview>>
  deletePlannedWorkout(
    payload: DeletePlannedWorkoutPayload,
  ): Promise<IpcResult<TrainingPlanOverview>>
  syncTrainingPlan(payload: SyncTrainingPlanPayload): Promise<IpcResult<SyncTrainingPlanResult>>
  setWatchDir(payload: SetWatchDirPayload): Promise<IpcResult<AppStatus>>
  setSchedule(payload: SetSchedulePayload): Promise<IpcResult<AppStatus>>
  setTheme(payload: SetThemePayload): Promise<IpcResult<AppStatus>>
  syncOnelap(): Promise<IpcResult<SyncOutcome[]>>
  syncOnelapToCoros(): Promise<IpcResult<CorosImportOutcome[]>>
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
  authIntervals: 'sweatrelay:authIntervals',
  authCoros: 'sweatrelay:authCoros',
  trainingLoad: 'sweatrelay:trainingLoad',
  setTrainingStatus: 'sweatrelay:setTrainingStatus',
  trainingPlan: 'sweatrelay:trainingPlan',
  updateTrainingPlan: 'sweatrelay:updateTrainingPlan',
  upsertPlannedWorkout: 'sweatrelay:upsertPlannedWorkout',
  deletePlannedWorkout: 'sweatrelay:deletePlannedWorkout',
  syncTrainingPlan: 'sweatrelay:syncTrainingPlan',
  setWatchDir: 'sweatrelay:setWatchDir',
  setSchedule: 'sweatrelay:setSchedule',
  setTheme: 'sweatrelay:setTheme',
  syncOnelap: 'sweatrelay:syncOnelap',
  syncOnelapToCoros: 'sweatrelay:syncOnelapToCoros',
  pickDirectory: 'sweatrelay:pickDirectory',
  syncEvent: 'sweatrelay:syncEvent',
} as const
