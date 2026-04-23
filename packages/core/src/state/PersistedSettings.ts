export type ThemePreference = 'system' | 'light' | 'dark'

export interface SharedSettings {
  watchDir?: string
  scheduleCron?: string
  scheduleTz?: string
}

export interface GuiSettings {
  theme?: ThemePreference
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
  theme?: ThemePreference
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
    },
    gui: {
      theme: gui.theme ?? raw.theme,
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
