export type ThemePreference = 'system' | 'light' | 'dark'
export type TrainingStatusRange = 'current' | 'future7' | 'future14'
export const AutoSyncTargets = {
  strava: 'strava',
  coros: 'coros',
  garmin: 'garmin',
} as const
export type AutoSyncTarget = (typeof AutoSyncTargets)[keyof typeof AutoSyncTargets]

const DEFAULT_SCHEDULE_TARGETS: readonly AutoSyncTarget[] = [AutoSyncTargets.strava]

export interface SharedSettings {
  watchDir?: string
  scheduleCron?: string
  scheduleTz?: string
  scheduleTargets?: AutoSyncTarget[]
}

export interface GuiSettings {
  theme?: ThemePreference
  trainingStatusEnabled?: boolean
  trainingStatusRange?: TrainingStatusRange
}

export interface PersistedSettings {
  v: 1
  shared: SharedSettings
  gui: GuiSettings
}

export interface PersistedSettingsPatch {
  shared?: Partial<SharedSettings>
  gui?: Partial<GuiSettings>
}

interface LegacyPersistedSettings {
  v?: number
  stravaClientId?: string
  stravaClientSecret?: string
  watchDir?: string
  scheduleCron?: string
  scheduleTz?: string
  scheduleTargets?: unknown
  theme?: ThemePreference
  trainingStatusEnabled?: boolean
  trainingStatusRange?: TrainingStatusRange
  shared?: Partial<SharedSettings>
  gui?: Partial<GuiSettings>
}

export function normalizePersistedSettings(input: unknown): PersistedSettings {
  const raw = (isRecord(input) ? input : {}) as LegacyPersistedSettings
  const shared = isRecord(raw.shared) ? raw.shared : {}
  const gui = isRecord(raw.gui) ? raw.gui : {}

  return {
    v: 1,
    shared: {
      watchDir: shared.watchDir ?? raw.watchDir,
      scheduleCron: shared.scheduleCron ?? raw.scheduleCron,
      scheduleTz: shared.scheduleTz ?? raw.scheduleTz,
      scheduleTargets: normalizeScheduleTargets(shared.scheduleTargets) ??
        normalizeScheduleTargets(raw.scheduleTargets) ?? [...DEFAULT_SCHEDULE_TARGETS],
    },
    gui: {
      theme: gui.theme ?? raw.theme,
      trainingStatusEnabled:
        normalizeBoolean(gui.trainingStatusEnabled) ??
        normalizeBoolean(raw.trainingStatusEnabled) ??
        false,
      trainingStatusRange:
        normalizeTrainingStatusRange(gui.trainingStatusRange) ??
        normalizeTrainingStatusRange(raw.trainingStatusRange) ??
        'current',
    },
  }
}

export function mergePersistedSettings(
  current: PersistedSettings,
  patch: PersistedSettingsPatch,
): PersistedSettings {
  return {
    v: 1,
    shared: {
      ...current.shared,
      ...patch.shared,
    },
    gui: {
      ...current.gui,
      ...patch.gui,
    },
  }
}

export function readLegacyStravaAppConfig(
  input: unknown,
): { clientId: string; clientSecret: string } | null {
  if (!isRecord(input)) return null
  const clientId = typeof input.stravaClientId === 'string' ? input.stravaClientId : null
  const clientSecret =
    typeof input.stravaClientSecret === 'string' ? input.stravaClientSecret : null
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeTrainingStatusRange(value: unknown): TrainingStatusRange | undefined {
  return value === 'current' || value === 'future7' || value === 'future14' ? value : undefined
}

function normalizeScheduleTargets(value: unknown): AutoSyncTarget[] | undefined {
  if (!Array.isArray(value)) return undefined
  const targets = value.filter(isAutoSyncTarget)
  const deduped = Array.from(new Set(targets))
  return deduped.length > 0 ? deduped : undefined
}

function isAutoSyncTarget(value: unknown): value is AutoSyncTarget {
  return (
    value === AutoSyncTargets.strava ||
    value === AutoSyncTargets.coros ||
    value === AutoSyncTargets.garmin
  )
}
