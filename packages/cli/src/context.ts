import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  type CredentialStore,
  EncryptedFileCredentialStore,
  KeyringCredentialStore,
  makeTokenGetter,
  STRAVA_CLIENT_ID_KEY,
  STRAVA_CLIENT_SECRET_KEY,
  STRAVA_TOKENS_KEY,
  StravaOAuth,
  type StravaTokens,
  StravaUploader,
  SyncedStore,
} from '@sweatrelay/core'

export interface CliPaths {
  configDir: string
  settingsPath: string
  credsPath: string
  syncedPath: string
  store: SyncedStore
}

export function buildPaths(): CliPaths {
  const configDir =
    process.env.SWEATRELAY_HOME ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'sweatrelay')
  const settingsPath = join(configDir, 'settings.json')
  const credsPath = join(configDir, 'creds.enc')
  const syncedPath = join(configDir, 'synced.sqlite')
  const legacySyncedPath = join(configDir, 'synced.json')
  const store = new SyncedStore({ path: syncedPath, legacyJsonPath: legacySyncedPath })

  return {
    configDir,
    settingsPath,
    credsPath,
    syncedPath,
    store,
  }
}

export async function buildCredentialStore(
  paths: Pick<CliPaths, 'credsPath'>,
): Promise<CredentialStore> {
  const passphrase = process.env.SWEATRELAY_PASSPHRASE
  const hasEncryptedFile = await fileExists(paths.credsPath)

  try {
    const keyring = new KeyringCredentialStore({ service: 'SweatRelay' })
    await keyring.get('__probe__')
    if (passphrase) {
      const file = new EncryptedFileCredentialStore({ path: paths.credsPath, passphrase })
      const [fileKeys, keyringKeys] = await Promise.all([
        file.keys().catch(() => [] as string[]),
        keyring.keys(),
      ])
      if (fileKeys.length > 0 && keyringKeys.length === 0) {
        await keyring.importFrom(file)
      }
    } else if ((await keyring.keys()).length === 0 && hasEncryptedFile) {
      return buildEncryptedFileStore(paths.credsPath, hasEncryptedFile, passphrase)
    }
    return keyring
  } catch {
    // Fall through to the encrypted-file store used by the SEA CLI binary.
  }

  return buildEncryptedFileStore(paths.credsPath, hasEncryptedFile, passphrase)
}

export async function buildUploader(
  paths: Pick<CliPaths, 'settingsPath'>,
  credentials: CredentialStore,
): Promise<{
  stravaClientId: string
  stravaClientSecret: string
  oauth: StravaOAuth
  uploader: StravaUploader
}> {
  const config = await loadStravaAppConfig(paths, credentials)
  if (!config) {
    throw new Error(
      'No Strava app config found. Set STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET or configure the GUI once.',
    )
  }

  const oauth = new StravaOAuth({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  })
  const uploader = new StravaUploader({
    getAccessToken: makeTokenGetter({
      load: async () => {
        const raw = await credentials.get(STRAVA_TOKENS_KEY)
        return raw ? (JSON.parse(raw) as StravaTokens) : null
      },
      save: async (tokens) => {
        await credentials.set(STRAVA_TOKENS_KEY, JSON.stringify(tokens))
      },
      refresh: (refreshToken) => oauth.refresh(refreshToken),
    }),
  })

  return {
    stravaClientId: config.clientId,
    stravaClientSecret: config.clientSecret,
    oauth,
    uploader,
  }
}

export const STRAVA_TOKENS_CRED_KEY = STRAVA_TOKENS_KEY

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function buildEncryptedFileStore(
  credsPath: string,
  hasEncryptedFile: boolean,
  passphrase: string | undefined,
): EncryptedFileCredentialStore {
  if (!passphrase) {
    if (hasEncryptedFile) {
      throw new Error(
        'Stored credentials are encrypted in creds.enc. Export SWEATRELAY_PASSPHRASE to unlock them.',
      )
    }
    throw new Error(
      'No OS keychain available and no SWEATRELAY_PASSPHRASE set. Pick a strong passphrase and export it to your shell.',
    )
  }

  return new EncryptedFileCredentialStore({ path: credsPath, passphrase })
}

async function loadStravaAppConfig(
  paths: Pick<CliPaths, 'settingsPath'>,
  credentials: CredentialStore,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const envClientId = process.env.STRAVA_CLIENT_ID
  const envClientSecret = process.env.STRAVA_CLIENT_SECRET
  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret }
  }

  const [storedId, storedSecret] = await Promise.all([
    credentials.get(STRAVA_CLIENT_ID_KEY),
    credentials.get(STRAVA_CLIENT_SECRET_KEY),
  ])
  if (storedId && storedSecret) {
    return { clientId: storedId, clientSecret: storedSecret }
  }

  const legacy = await loadLegacyStravaAppConfig(paths.settingsPath)
  if (!legacy) return null

  await Promise.all([
    credentials.set(STRAVA_CLIENT_ID_KEY, legacy.clientId),
    credentials.set(STRAVA_CLIENT_SECRET_KEY, legacy.clientSecret),
  ])

  return legacy
}

async function loadLegacyStravaAppConfig(
  settingsPath: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    const raw = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      stravaClientId?: string
      stravaClientSecret?: string
    }
    if (!raw.stravaClientId || !raw.stravaClientSecret) return null
    return { clientId: raw.stravaClientId, clientSecret: raw.stravaClientSecret }
  } catch {
    return null
  }
}
