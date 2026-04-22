import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  EncryptedFileCredentialStore,
  makeTokenGetter,
  StravaOAuth,
  type StravaTokens,
  StravaUploader,
  SyncedStore,
} from '@sweatrelay/core'

export interface CliContext {
  configDir: string
  credsPath: string
  syncedPath: string
  passphrase: string
  stravaClientId: string
  stravaClientSecret: string
  store: SyncedStore
  credentials: EncryptedFileCredentialStore
  oauth: StravaOAuth
  uploader: StravaUploader
}

const STRAVA_TOKENS_KEY = 'strava.tokens'

export function buildContext(): CliContext {
  const configDir =
    process.env.SWEATRELAY_HOME ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'sweatrelay')
  const credsPath = join(configDir, 'creds.enc')
  const syncedPath = join(configDir, 'synced.sqlite')
  const legacySyncedPath = join(configDir, 'synced.json')

  const passphrase = process.env.SWEATRELAY_PASSPHRASE
  if (!passphrase) {
    throw new Error(
      'SWEATRELAY_PASSPHRASE env var required. Pick a strong passphrase and export it to your shell.',
    )
  }

  const stravaClientId = process.env.STRAVA_CLIENT_ID
  const stravaClientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!stravaClientId || !stravaClientSecret) {
    throw new Error(
      'STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET env vars required. Create a Strava API app at https://www.strava.com/settings/api',
    )
  }

  const credentials = new EncryptedFileCredentialStore({ path: credsPath, passphrase })
  const store = new SyncedStore({ path: syncedPath, legacyJsonPath: legacySyncedPath })
  const oauth = new StravaOAuth({ clientId: stravaClientId, clientSecret: stravaClientSecret })

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
    configDir,
    credsPath,
    syncedPath,
    passphrase,
    stravaClientId,
    stravaClientSecret,
    store,
    credentials,
    oauth,
    uploader,
  }
}

export const STRAVA_TOKENS_CRED_KEY = STRAVA_TOKENS_KEY
