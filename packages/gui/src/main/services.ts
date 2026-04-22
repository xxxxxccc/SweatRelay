import { OnelapApiAdapter } from '@sweatrelay/adapter-onelap'
import {
  type CredentialStore,
  EncryptedFileCredentialStore,
  FileWatcherTrigger,
  KeyringCredentialStore,
  makeTokenGetter,
  ScheduledTrigger,
  StravaOAuth,
  type StravaTokens,
  StravaUploader,
  SyncedStore,
  type SyncOutcome,
  SyncPipeline,
} from '@sweatrelay/core'
import { type AppPaths, loadSettings, saveSettings, type ThemePreference } from './state.ts'

const STRAVA_TOKENS_KEY = 'strava.tokens'
const ONELAP_ACCOUNT_KEY = 'onelap.account'

/**
 * Prefer the OS keychain. If it fails (headless Linux without libsecret, or the
 * native module didn't survive packaging), fall back to the encrypted file. On
 * the first successful keyring open, migrate any existing file-store entries.
 */
async function buildCredentialStore(paths: AppPaths, passphrase: string): Promise<CredentialStore> {
  const file = new EncryptedFileCredentialStore({
    path: paths.credsPath,
    passphrase,
  })
  try {
    const keyring = new KeyringCredentialStore({ service: 'SweatRelay' })
    // Smoke-test: a read of a (likely missing) key should not throw if the
    // backend is healthy.
    await keyring.get('__probe__')
    // First-run migration from the file store, if it has anything.
    const fileKeys = await file.keys().catch(() => [] as string[])
    if (fileKeys.length > 0) {
      const ringKeys = await keyring.keys()
      if (ringKeys.length === 0) {
        await keyring.importFrom(file)
      }
    }
    return keyring
  } catch (err) {
    console.warn('[services] OS keyring unavailable, falling back to encrypted file:', err)
    return file
  }
}

/** Container of the GUI's live services; rebuilt whenever passphrase or settings change. */
export class Services {
  readonly paths: AppPaths
  private passphrase: string | null = null
  private credentials: CredentialStore | null = null
  private store: SyncedStore
  private oauth: StravaOAuth | null = null
  private uploader: StravaUploader | null = null
  private fileWatcher: FileWatcherTrigger | null = null
  private scheduledTrigger: ScheduledTrigger | null = null
  private listeners = new Set<(outcome: SyncOutcome) => void>()

  constructor(paths: AppPaths) {
    this.paths = paths
    this.store = new SyncedStore({
      path: paths.syncedPath,
      legacyJsonPath: paths.syncedPath.replace(/\.sqlite$/, '.json'),
    })
  }

  configured(): boolean {
    return this.passphrase !== null && this.uploader !== null
  }

  async configure(
    passphrase: string,
    stravaClientId: string,
    stravaClientSecret: string,
  ): Promise<void> {
    await saveSettings(this.paths.settingsPath, { stravaClientId, stravaClientSecret })
    this.passphrase = passphrase
    this.credentials = await buildCredentialStore(this.paths, passphrase)
    this.oauth = new StravaOAuth({
      clientId: stravaClientId,
      clientSecret: stravaClientSecret,
    })
    const credentials = this.credentials
    const oauth = this.oauth
    this.uploader = new StravaUploader({
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
    await this.restartTriggers()
  }

  async authorizeStrava(openUrl: (url: string) => void): Promise<void> {
    if (!this.oauth || !this.credentials) {
      throw new Error('Configure first')
    }
    const tokens = await this.oauth.authorize({ openUrl })
    await this.credentials.set(STRAVA_TOKENS_KEY, JSON.stringify(tokens))
  }

  async authorizeOnelap(account: string, password: string): Promise<void> {
    if (!this.credentials) throw new Error('Configure first')
    const adapter = new OnelapApiAdapter({ credentials: this.credentials })
    await adapter.saveCredentials(account, password)
    await this.credentials.set(ONELAP_ACCOUNT_KEY, account)
    // Eagerly try login to surface bad creds
    const refs: unknown[] = []
    for await (const ref of adapter.list({ limit: 1 })) refs.push(ref)
  }

  async setWatchDir(dir: string | null): Promise<void> {
    await saveSettings(this.paths.settingsPath, { watchDir: dir ?? undefined })
    await this.restartTriggers()
  }

  async setSchedule(cron: string | null, timezone?: string): Promise<void> {
    await saveSettings(this.paths.settingsPath, {
      scheduleCron: cron ?? undefined,
      scheduleTz: timezone ?? undefined,
    })
    await this.restartTriggers()
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    await saveSettings(this.paths.settingsPath, { theme })
  }

  async runOnelapSyncOnce(): Promise<SyncOutcome[]> {
    if (!this.uploader || !this.credentials) throw new Error('Configure first')
    const adapter = new OnelapApiAdapter({ credentials: this.credentials })
    const pipeline = new SyncPipeline({
      uploader: this.uploader,
      store: this.store,
      adapter,
    })
    return pipeline.handleAdapterPull()
  }

  async getOnelapAccount(): Promise<string | null> {
    if (!this.credentials) return null
    return this.credentials.get(ONELAP_ACCOUNT_KEY)
  }

  async getStravaAthleteId(): Promise<number | undefined> {
    if (!this.credentials) return undefined
    const raw = await this.credentials.get(STRAVA_TOKENS_KEY)
    if (!raw) return undefined
    return (JSON.parse(raw) as StravaTokens).athleteId
  }

  recentSyncs() {
    return this.store.list()
  }

  async loadPersistedSettings() {
    return loadSettings(this.paths.settingsPath)
  }

  onSyncEvent(listener: (outcome: SyncOutcome) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(outcome: SyncOutcome): void {
    for (const listener of this.listeners) listener(outcome)
  }

  private async restartTriggers(): Promise<void> {
    await this.fileWatcher?.stop()
    this.fileWatcher = null
    await this.scheduledTrigger?.stop()
    this.scheduledTrigger = null
    if (!this.uploader) return

    const settings = await loadSettings(this.paths.settingsPath)

    if (settings.watchDir) {
      const pipeline = new SyncPipeline({ uploader: this.uploader, store: this.store })
      this.fileWatcher = new FileWatcherTrigger({ paths: settings.watchDir })
      await this.fileWatcher.start(async (event) => {
        const outcomes = await pipeline.handle(event)
        for (const o of outcomes) this.emit(o)
      })
    }

    if (settings.scheduleCron && this.credentials) {
      const adapter = new OnelapApiAdapter({ credentials: this.credentials })
      const pipeline = new SyncPipeline({
        uploader: this.uploader,
        store: this.store,
        adapter,
      })
      this.scheduledTrigger = new ScheduledTrigger({
        cron: settings.scheduleCron,
        ...(settings.scheduleTz ? { timezone: settings.scheduleTz } : {}),
      })
      await this.scheduledTrigger.start(async (event) => {
        const outcomes = await pipeline.handle(event)
        for (const o of outcomes) this.emit(o)
      })
    }
  }

  async dispose(): Promise<void> {
    await this.fileWatcher?.stop()
    await this.scheduledTrigger?.stop()
    this.listeners.clear()
  }
}
