import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  mergePersistedSettings,
  normalizePersistedSettings,
  type PersistedSettings,
  type PersistedSettingsPatch,
} from '@sweatrelay/core'

export type { ThemePreference } from '@sweatrelay/core'

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
    return normalizePersistedSettings(JSON.parse(raw) as unknown)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return normalizePersistedSettings(null)
    }
    throw err
  }
}

export async function saveSettings(
  path: string,
  patch: PersistedSettingsPatch,
): Promise<PersistedSettings> {
  const current = await loadSettings(path)
  const next = mergePersistedSettings(current, patch)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(next, null, 2))
  return next
}
