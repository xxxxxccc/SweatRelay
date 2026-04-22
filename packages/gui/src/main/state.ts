import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface PersistedSettings {
  v: 1
  stravaClientId?: string
  stravaClientSecret?: string
  watchDir?: string
  scheduleCron?: string
  scheduleTz?: string
  theme?: ThemePreference
}

export interface AppPaths {
  configDir: string
  settingsPath: string
  credsPath: string
  syncedPath: string
}

export function appPaths(): AppPaths {
  const configDir =
    process.env.SWEATRELAY_HOME ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'sweatrelay')
  return {
    configDir,
    settingsPath: join(configDir, 'settings.json'),
    credsPath: join(configDir, 'creds.enc'),
    syncedPath: join(configDir, 'synced.sqlite'),
  }
}

export async function loadSettings(path: string): Promise<PersistedSettings> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as PersistedSettings
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1 }
    throw err
  }
}

export async function saveSettings(
  path: string,
  patch: Partial<Omit<PersistedSettings, 'v'>>,
): Promise<PersistedSettings> {
  const current = await loadSettings(path)
  const next: PersistedSettings = { ...current, ...patch, v: 1 }
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(next, null, 2))
  return next
}
