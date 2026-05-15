import { access, readFile } from 'node:fs/promises'
import { OnelapApiAdapter } from '@sweatrelay/adapter-onelap'
import {
  type AutoSyncTarget,
  AutoSyncTargets,
  buildGarminWorkoutSyncItem,
  buildIntervalsWorkoutEvent,
  COROS_SESSION_KEY,
  type CorosImportOutcome,
  CorosImportPipeline,
  type CorosRegionId,
  CorosRegionIds,
  type CorosSession,
  CorosUploader,
  type CredentialStore,
  EncryptedFileCredentialStore,
  FileWatcherTrigger,
  GARMIN_SESSION_KEY,
  type GarminApiFetch,
  type GarminDomain,
  GarminDomains,
  type GarminImportOutcome,
  GarminImportPipeline,
  type GarminMfaChallenge,
  type GarminSession,
  GarminUploader,
  type GarminWorkoutSyncResult,
  INTERVALS_API_KEY,
  IntervalsClient,
  type IntervalsTrainingLoadReport,
  KeyringCredentialStore,
  MirroredCredentialStore,
  makeTokenGetter,
  ONELAP_ACCOUNT_KEY,
  readLegacyStravaAppConfig,
  ScheduledTrigger,
  STRAVA_CLIENT_ID_KEY,
  STRAVA_CLIENT_SECRET_KEY,
  STRAVA_TOKENS_KEY,
  StravaOAuth,
  type StravaTokens,
  StravaUploader,
  SyncedStore,
  type SyncOutcome,
  SyncPipeline,
  type TrainingPlanOverview,
  TrainingPlanStore,
  type TrainingPlanSyncResult,
  type TrainingProjectionSeed,
  type UpdateTrainingPlanInput,
  type UpsertPlannedWorkoutInput,
  workoutNeedsGarminFtp,
  workoutNeedsGarminMaxHeartRate,
} from '@sweatrelay/core'
import {
  type AppPaths,
  loadSettings,
  saveSettings,
  type ThemePreference,
  type TrainingStatusRange,
} from './state.ts'

export interface ServiceDiagnostics {
  keyringAvailable: boolean
  hasEncryptedCredentials: boolean
  stravaConfigPresent: boolean
  stravaTokensPresent: boolean
  intervalsCredentialsPresent: boolean
  onelapCredentialsPresent: boolean
  corosCredentialsPresent: boolean
  garminCredentialsPresent: boolean
  sharedConfigPresent: boolean
}

interface PendingGarminMfa {
  email: string
  domain: GarminDomain
  challenge: GarminMfaChallenge
}

interface ServicesOptions {
  garminApiFetch?: GarminApiFetch
}

type RestoreStatus = 'unconfigured' | 'needsUnlock' | 'ready'

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
    const mirrored = new MirroredCredentialStore(keyring, [file])
    await mirrored.mirrorFrom(file).catch(() => 0)
    await mirrored.mirrorFrom(keyring).catch(() => 0)
    return mirrored
  } catch {
    return file
  }
}

/** Container of the GUI's live services; rebuilt whenever passphrase or settings change. */
export class Services {
  readonly paths: AppPaths
  private credentials: CredentialStore | null = null
  private store: SyncedStore
  private plans: TrainingPlanStore
  private oauth: StravaOAuth | null = null
  private uploader: StravaUploader | null = null
  private corosUploader: CorosUploader | null = null
  private garminUploader: GarminUploader | null = null
  private pendingGarminMfa: PendingGarminMfa | null = null
  private fileWatcher: FileWatcherTrigger | null = null
  private scheduledTrigger: ScheduledTrigger | null = null
  private listeners = new Set<(outcome: SyncOutcome) => void>()
  private errorListeners = new Set<(scope: string, err: unknown) => void>()
  private readonly garminApiFetch?: GarminApiFetch
  private restoreStatus: RestoreStatus = 'unconfigured'
  private lastDiagnostics: ServiceDiagnostics = {
    keyringAvailable: false,
    hasEncryptedCredentials: false,
    stravaConfigPresent: false,
    stravaTokensPresent: false,
    intervalsCredentialsPresent: false,
    onelapCredentialsPresent: false,
    corosCredentialsPresent: false,
    garminCredentialsPresent: false,
    sharedConfigPresent: false,
  }

  constructor(paths: AppPaths, options: ServicesOptions = {}) {
    this.paths = paths
    this.garminApiFetch = options.garminApiFetch
    this.store = new SyncedStore({
      path: paths.syncedPath,
      legacyJsonPath: paths.syncedPath.replace(/\.sqlite$/, '.json'),
    })
    this.plans = new TrainingPlanStore({
      path: paths.trainingPlansPath,
    })
  }

  configured(): boolean {
    return this.uploader !== null
  }

  needsUnlock(): boolean {
    return this.restoreStatus === 'needsUnlock'
  }

  diagnostics(): ServiceDiagnostics {
    return this.lastDiagnostics
  }

  async restorePersistedConfiguration(passphrase?: string): Promise<void> {
    if (this.uploader) return

    const restore = await this.resolveRestoreState(passphrase)
    this.lastDiagnostics = restore.diagnostics
    this.restoreStatus = restore.status
    if (restore.status !== 'ready') return

    this.credentials = restore.credentials
    this.corosUploader = this.buildCorosUploader(restore.credentials)
    this.garminUploader = this.buildGarminUploader(restore.credentials)
    this.oauth = new StravaOAuth({
      clientId: restore.config.clientId,
      clientSecret: restore.config.clientSecret,
    })
    const oauth = this.oauth
    this.uploader = new StravaUploader({
      getAccessToken: makeTokenGetter({
        load: async () => {
          const raw = await restore.credentials.get(STRAVA_TOKENS_KEY)
          return raw ? (JSON.parse(raw) as StravaTokens) : null
        },
        save: async (tokens) => {
          await restore.credentials.set(STRAVA_TOKENS_KEY, JSON.stringify(tokens))
        },
        refresh: (refreshToken) => oauth.refresh(refreshToken),
      }),
    })
    await this.restartTriggers()
  }

  async unlock(passphrase: string): Promise<void> {
    await this.restorePersistedConfiguration(passphrase)
    if (!this.configured()) {
      throw new Error('无法解锁已保存的凭证，请确认密码正确。')
    }
  }

  async configure(
    passphrase: string,
    stravaClientId: string,
    stravaClientSecret: string,
  ): Promise<void> {
    this.credentials = await buildCredentialStore(this.paths, passphrase)
    this.corosUploader = this.buildCorosUploader(this.credentials)
    this.garminUploader = this.buildGarminUploader(this.credentials)
    await this.credentials.set(STRAVA_CLIENT_ID_KEY, stravaClientId)
    await this.credentials.set(STRAVA_CLIENT_SECRET_KEY, stravaClientSecret)
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
    await this.refreshDiagnostics()
    this.restoreStatus = 'ready'
  }

  async authorizeStrava(openUrl: (url: string) => void): Promise<void> {
    if (!this.oauth || !this.credentials) {
      throw new Error('Configure first')
    }
    const tokens = await this.oauth.authorize({ openUrl })
    await this.credentials.set(STRAVA_TOKENS_KEY, JSON.stringify(tokens))
    await this.refreshDiagnostics()
  }

  async authorizeOnelap(account: string, password: string): Promise<void> {
    if (!this.credentials) throw new Error('Configure first')
    const adapter = new OnelapApiAdapter({ credentials: this.credentials })
    await adapter.saveCredentials(account, password)
    await this.credentials.set(ONELAP_ACCOUNT_KEY, account)
    // Eagerly try login to surface bad creds
    const refs: unknown[] = []
    for await (const ref of adapter.list({ limit: 1 })) refs.push(ref)
    await this.refreshDiagnostics()
  }

  async authorizeIntervals(apiKey: string): Promise<void> {
    if (!this.credentials) throw new Error('Configure first')
    const trimmed = apiKey.trim()
    const client = new IntervalsClient({ apiKey: trimmed })
    await client.fetchFitness(7)
    await this.credentials.set(INTERVALS_API_KEY, trimmed)
    await this.refreshDiagnostics()
  }

  async authorizeCoros(session: CorosSession): Promise<void> {
    if (!this.credentials) throw new Error('Configure first')
    const normalized = normalizeCorosSession(session)
    const uploader = new CorosUploader({ getSession: async () => normalized })
    await uploader.fetchRecentImports(1)
    await this.credentials.set(COROS_SESSION_KEY, JSON.stringify(normalized))
    this.corosUploader = this.buildCorosUploader(this.credentials)
    await this.refreshDiagnostics()
  }

  async authorizeGarmin(payload: {
    email: string
    password: string
    domain?: GarminDomain
    mfaCode?: string
  }): Promise<{ mfaRequired: boolean }> {
    if (!this.credentials) throw new Error('Configure first')
    const email = payload.email.trim()
    const domain = normalizeGarminDomain(payload.domain)
    const mfaCode = payload.mfaCode?.trim()

    let session: GarminSession | null = null
    if (
      mfaCode &&
      this.pendingGarminMfa &&
      this.pendingGarminMfa.email === email &&
      this.pendingGarminMfa.domain === domain
    ) {
      session = await GarminUploader.completeMfa(this.pendingGarminMfa.challenge, mfaCode)
    } else {
      const result = await GarminUploader.login({
        email,
        password: payload.password,
        domain,
        ...(mfaCode ? { mfaCode } : {}),
      })
      if (result.kind === 'mfa-required') {
        this.pendingGarminMfa = { email, domain, challenge: result.challenge }
        return { mfaRequired: true }
      }
      session = result.session
    }

    await this.authorizeGarminSession(session)
    return { mfaRequired: false }
  }

  async authorizeGarminSession(session: GarminSession): Promise<void> {
    if (!this.credentials) throw new Error('Configure first')
    const normalized = normalizeGarminSession(session)
    const uploader = new GarminUploader({
      getSession: async () => normalized,
      ...(this.garminApiFetch ? { request: this.garminApiFetch } : {}),
    })
    const profile = await uploader.fetchProfile()
    const stored: GarminSession = normalizeGarminSession({
      ...normalized,
      ...(profile.displayName ? { displayName: profile.displayName } : {}),
      ...(profile.fullName ? { fullName: profile.fullName } : {}),
      ...(profile.userName ? { userName: profile.userName } : {}),
    })
    await this.credentials.set(GARMIN_SESSION_KEY, JSON.stringify(stored))
    this.garminUploader = this.buildGarminUploader(this.credentials)
    this.pendingGarminMfa = null
    await this.refreshDiagnostics()
  }

  async disconnectGarmin(): Promise<void> {
    if (!this.credentials) throw new Error('Configure first')
    await this.credentials.delete(GARMIN_SESSION_KEY)
    this.garminUploader = null
    this.pendingGarminMfa = null
    await this.refreshDiagnostics()
  }

  async getIntervalsTrainingLoad(
    days = 42,
    forecastDays = 0,
  ): Promise<IntervalsTrainingLoadReport> {
    if (!this.credentials) throw new Error('Configure first')
    const apiKey = await this.credentials.get(INTERVALS_API_KEY)
    if (!apiKey) throw new Error('Intervals.icu API key not stored')
    return new IntervalsClient({ apiKey }).fetchTrainingLoadReport({ days, forecastDays })
  }

  async getTrainingPlanOverview(planId?: string): Promise<TrainingPlanOverview> {
    return this.plans.getOverview(planId, await this.getTrainingProjectionSeed())
  }

  async updateTrainingPlan(input: UpdateTrainingPlanInput): Promise<TrainingPlanOverview> {
    const plan = await this.plans.updatePlan(input)
    return this.getTrainingPlanOverview(plan.id)
  }

  async upsertPlannedWorkout(input: UpsertPlannedWorkoutInput): Promise<TrainingPlanOverview> {
    const workout = await this.plans.upsertWorkout(input)
    return this.getTrainingPlanOverview(workout.planId)
  }

  async deletePlannedWorkout(planId: string, workoutId: string): Promise<TrainingPlanOverview> {
    await this.plans.deleteWorkout(workoutId)
    return this.getTrainingPlanOverview(planId)
  }

  async syncTrainingPlanToIntervals(planId: string): Promise<{
    overview: TrainingPlanOverview
    result: TrainingPlanSyncResult
  }> {
    if (!this.credentials) throw new Error('Configure first')
    const apiKey = await this.credentials.get(INTERVALS_API_KEY)
    if (!apiKey) throw new Error('Intervals.icu API key not stored')

    const overview = await this.plans.getOverview(planId, await this.getTrainingProjectionSeed())
    const events = overview.workouts.map((workout) => buildIntervalsWorkoutEvent(workout))
    if (events.length === 0) throw new Error('计划里还没有可同步的训练')

    const synced = await new IntervalsClient({ apiKey }).upsertCalendarEvents(events)
    const result = await this.plans.markSynced(planId, synced)
    return {
      overview: await this.getTrainingPlanOverview(planId),
      result,
    }
  }

  async syncTrainingPlanToGarmin(planId: string): Promise<{
    overview: TrainingPlanOverview
    result: GarminWorkoutSyncResult
  }> {
    if (!this.garminUploader || !this.credentials) throw new Error('请先连接 Garmin')
    const session = await this.getGarminSession()
    if (session?.domain !== GarminDomains.china) {
      throw new Error('只有 Garmin 中国区登录态可以直接同步训练课程')
    }

    const overview = await this.plans.getOverview(planId, await this.getTrainingProjectionSeed())
    if (overview.workouts.length === 0) throw new Error('计划里还没有可同步的训练')

    const needsFtp = overview.workouts.some(workoutNeedsGarminFtp)
    const needsMaxHeartRate = overview.workouts.some(workoutNeedsGarminMaxHeartRate)
    const [ftpWatts, maxHeartRate] = await Promise.all([
      needsFtp ? this.garminUploader.fetchCyclingFtp() : Promise.resolve(undefined),
      needsMaxHeartRate ? this.garminUploader.fetchMaxHeartRate() : Promise.resolve(undefined),
    ])
    const items = overview.workouts.map((workout) =>
      buildGarminWorkoutSyncItem(workout, { ftpWatts, maxHeartRate }),
    )
    const result = await this.garminUploader.syncPlannedWorkouts(items)
    if (result.failed > 0 && result.failed === result.attempted) {
      const first = result.workouts.find((workout) => workout.error)
      throw new Error(first?.error ?? 'Garmin 训练课程同步失败')
    }
    return {
      overview: await this.getTrainingPlanOverview(planId),
      result,
    }
  }

  async setWatchDir(dir: string | null): Promise<void> {
    await saveSettings(this.paths.settingsPath, { shared: { watchDir: dir ?? undefined } })
    await this.restartTriggers()
    await this.refreshDiagnostics()
  }

  async setSchedule(
    cron: string | null,
    timezone?: string,
    targets?: readonly AutoSyncTarget[],
  ): Promise<void> {
    await saveSettings(this.paths.settingsPath, {
      shared: {
        scheduleCron: cron ?? undefined,
        scheduleTz: timezone ?? undefined,
        ...(targets ? { scheduleTargets: normalizeAutoSyncTargets(targets) } : {}),
      },
    })
    await this.restartTriggers()
    await this.refreshDiagnostics()
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    await saveSettings(this.paths.settingsPath, { gui: { theme } })
  }

  async setTrainingStatus(payload: {
    enabled?: boolean
    range?: TrainingStatusRange
  }): Promise<void> {
    await saveSettings(this.paths.settingsPath, {
      gui: {
        ...(payload.enabled !== undefined ? { trainingStatusEnabled: payload.enabled } : {}),
        ...(payload.range ? { trainingStatusRange: payload.range } : {}),
      },
    })
  }

  async runOnelapSyncOnce(): Promise<SyncOutcome[]> {
    if (!this.uploader || !this.credentials) throw new Error('Configure first')
    const adapter = new OnelapApiAdapter({ credentials: this.credentials })
    const pipeline = new SyncPipeline({
      uploader: this.uploader,
      store: this.store,
      adapter,
    })
    return pipeline.handleAdapterPull({ since: daysAgo(7) })
  }

  async runOnelapCorosImportOnce(): Promise<CorosImportOutcome[]> {
    if (!this.corosUploader || !this.credentials) throw new Error('请先连接高驰 COROS')
    const adapter = new OnelapApiAdapter({ credentials: this.credentials })
    const pipeline = new CorosImportPipeline({
      uploader: this.corosUploader,
      store: this.store,
      adapter,
    })
    return pipeline.handleAdapterPull({ since: daysAgo(7) })
  }

  async runOnelapGarminImportOnce(): Promise<GarminImportOutcome[]> {
    if (!this.garminUploader || !this.credentials) throw new Error('请先连接 Garmin')
    const adapter = new OnelapApiAdapter({ credentials: this.credentials })
    const pipeline = new GarminImportPipeline({
      uploader: this.garminUploader,
      store: this.store,
      adapter,
    })
    return pipeline.handleAdapterPull({ since: daysAgo(7) })
  }

  async getOnelapAccount(): Promise<string | null> {
    if (!this.credentials) return null
    return this.credentials.get(ONELAP_ACCOUNT_KEY)
  }

  async getCorosUserId(): Promise<string | undefined> {
    if (!this.credentials) return undefined
    const raw = await this.credentials.get(COROS_SESSION_KEY)
    if (!raw) return undefined
    try {
      return (JSON.parse(raw) as CorosSession).userId
    } catch {
      return undefined
    }
  }

  async getGarminDisplayName(): Promise<string | undefined> {
    const session = await this.getGarminSession()
    return session?.displayName ?? session?.fullName ?? session?.userName
  }

  async getGarminDomain(): Promise<GarminDomain | undefined> {
    return (await this.getGarminSession())?.domain
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

  onError(listener: (scope: string, err: unknown) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  private emit(outcome: SyncOutcome): void {
    for (const listener of this.listeners) listener(outcome)
  }

  private emitError(scope: string, err: unknown): void {
    for (const listener of this.errorListeners) listener(scope, err)
  }

  private async restartTriggers(): Promise<void> {
    await this.fileWatcher?.stop()
    this.fileWatcher = null
    await this.scheduledTrigger?.stop()
    this.scheduledTrigger = null

    const settings = await loadSettings(this.paths.settingsPath)

    if (settings.shared.watchDir && this.uploader) {
      const pipeline = new SyncPipeline({ uploader: this.uploader, store: this.store })
      this.fileWatcher = new FileWatcherTrigger({ paths: settings.shared.watchDir })
      await this.fileWatcher.start(async (event) => {
        try {
          const outcomes = await pipeline.handle(event)
          for (const o of outcomes) this.emit(o)
        } catch (err) {
          this.emitError('sync:watch', err)
        }
      })
    }

    if (settings.shared.scheduleCron && this.credentials) {
      const credentials = this.credentials
      const targets = normalizeAutoSyncTargets(settings.shared.scheduleTargets)
      this.scheduledTrigger = new ScheduledTrigger({
        cron: settings.shared.scheduleCron,
        ...(settings.shared.scheduleTz ? { timezone: settings.shared.scheduleTz } : {}),
      })
      await this.scheduledTrigger.start(async (event) => {
        for (const target of targets) {
          try {
            if (target === AutoSyncTargets.strava) {
              if (!this.uploader) throw new Error('请先连接 Strava')
              const adapter = new OnelapApiAdapter({ credentials })
              const pipeline = new SyncPipeline({
                uploader: this.uploader,
                store: this.store,
                adapter,
              })
              const outcomes = await pipeline.handle(event)
              for (const o of outcomes) this.emit(o)
              continue
            }

            if (target === AutoSyncTargets.coros) {
              if (!this.corosUploader) throw new Error('请先连接高驰 COROS')
              const adapter = new OnelapApiAdapter({ credentials })
              const pipeline = new CorosImportPipeline({
                uploader: this.corosUploader,
                store: this.store,
                adapter,
              })
              const outcomes = await pipeline.handleAdapterPull()
              for (const outcome of outcomes) {
                if (outcome.kind === 'error') this.emitError('sync:schedule:coros', outcome.error)
              }
              continue
            }

            if (target === AutoSyncTargets.garmin) {
              if (!this.garminUploader) throw new Error('请先连接 Garmin')
              const adapter = new OnelapApiAdapter({ credentials })
              const pipeline = new GarminImportPipeline({
                uploader: this.garminUploader,
                store: this.store,
                adapter,
              })
              const outcomes = await pipeline.handleAdapterPull()
              for (const outcome of outcomes) {
                if (outcome.kind === 'error') this.emitError('sync:schedule:garmin', outcome.error)
              }
            }
          } catch (err) {
            this.emitError(`sync:schedule:${target}`, err)
          }
        }
      })
    }
  }

  async dispose(): Promise<void> {
    await this.fileWatcher?.stop()
    await this.scheduledTrigger?.stop()
    await this.plans.close()
    this.listeners.clear()
    this.errorListeners.clear()
  }

  private async getTrainingProjectionSeed(): Promise<TrainingProjectionSeed | undefined> {
    if (!this.credentials) return undefined
    const apiKey = await this.credentials.get(INTERVALS_API_KEY)
    if (!apiKey) return undefined
    try {
      const latest = (await new IntervalsClient({ apiKey }).fetchFitness(14)).latest
      return latest ? { date: latest.date, ctl: latest.ctl, atl: latest.atl } : undefined
    } catch {
      return undefined
    }
  }

  private async getGarminSession(): Promise<GarminSession | undefined> {
    if (!this.credentials) return undefined
    const raw = await this.credentials.get(GARMIN_SESSION_KEY)
    if (!raw) return undefined
    try {
      return normalizeGarminSession(JSON.parse(raw) as GarminSession)
    } catch {
      return undefined
    }
  }

  private buildCorosUploader(credentials: CredentialStore): CorosUploader {
    return new CorosUploader({
      getSession: async () => {
        const raw = await credentials.get(COROS_SESSION_KEY)
        if (!raw) throw new Error('请先连接高驰 COROS')
        return JSON.parse(raw) as CorosSession
      },
    })
  }

  private buildGarminUploader(credentials: CredentialStore): GarminUploader {
    return new GarminUploader({
      getSession: async () => {
        const raw = await credentials.get(GARMIN_SESSION_KEY)
        if (!raw) throw new Error('请先连接 Garmin')
        return JSON.parse(raw) as GarminSession
      },
      saveSession: async (session) => {
        await credentials.set(GARMIN_SESSION_KEY, JSON.stringify(normalizeGarminSession(session)))
      },
      ...(this.garminApiFetch ? { request: this.garminApiFetch } : {}),
    })
  }

  private async restoreCredentialStore(passphrase?: string): Promise<CredentialStore | null> {
    const hasEncryptedFile = await fileExists(this.paths.credsPath)

    try {
      const keyring = new KeyringCredentialStore({ service: 'SweatRelay' })
      await keyring.get('__probe__')
      if (passphrase) {
        const file = new EncryptedFileCredentialStore({
          path: this.paths.credsPath,
          passphrase,
        })
        const mirrored = new MirroredCredentialStore(keyring, [file])
        await mirrored.mirrorFrom(file).catch(() => 0)
        await mirrored.mirrorFrom(keyring).catch(() => 0)
        return mirrored
      } else if ((await keyring.keys()).length === 0 && hasEncryptedFile) {
        return null
      }
      return keyring
    } catch {
      // Fall through to the encrypted-file store path.
    }

    if (!passphrase) return null

    return new EncryptedFileCredentialStore({
      path: this.paths.credsPath,
      passphrase,
    })
  }

  private async loadStravaAppConfig(
    credentials: CredentialStore,
  ): Promise<{ clientId: string; clientSecret: string } | null> {
    const [storedId, storedSecret] = await Promise.all([
      credentials.get(STRAVA_CLIENT_ID_KEY),
      credentials.get(STRAVA_CLIENT_SECRET_KEY),
    ])
    if (storedId && storedSecret) {
      return { clientId: storedId, clientSecret: storedSecret }
    }

    const settings = await this.readRawSettings()
    const legacy = readLegacyStravaAppConfig(settings)
    if (!legacy) return null

    await Promise.all([
      credentials.set(STRAVA_CLIENT_ID_KEY, legacy.clientId),
      credentials.set(STRAVA_CLIENT_SECRET_KEY, legacy.clientSecret),
    ])

    return legacy
  }

  private async resolveRestoreState(passphrase?: string): Promise<
    | {
        status: 'ready'
        diagnostics: ServiceDiagnostics
        credentials: CredentialStore
        config: { clientId: string; clientSecret: string }
      }
    | {
        status: Exclude<RestoreStatus, 'ready'>
        diagnostics: ServiceDiagnostics
      }
  > {
    const settings = await loadSettings(this.paths.settingsPath)
    const keyringAvailable = await this.isKeyringAvailable()
    const hasEncryptedCredentials = await fileExists(this.paths.credsPath)
    const credentials = await this.restoreCredentialStore(
      passphrase ?? process.env.SWEATRELAY_PASSPHRASE,
    )
    const rawSettings = await this.readRawSettings()
    const legacyConfig = readLegacyStravaAppConfig(rawSettings)

    if (!credentials) {
      return {
        status: hasEncryptedCredentials ? 'needsUnlock' : 'unconfigured',
        diagnostics: {
          keyringAvailable,
          hasEncryptedCredentials,
          stravaConfigPresent: legacyConfig !== null,
          stravaTokensPresent: false,
          onelapCredentialsPresent: false,
          intervalsCredentialsPresent: false,
          corosCredentialsPresent: false,
          garminCredentialsPresent: false,
          sharedConfigPresent: hasSharedConfig(settings),
        },
      }
    }

    const config = await this.loadStravaAppConfig(credentials)
    const [
      stravaTokensPresent,
      intervalsCredentialsPresent,
      onelapCredentialsPresent,
      corosCredentialsPresent,
      garminCredentialsPresent,
    ] = await Promise.all([
      credentials.get(STRAVA_TOKENS_KEY).then(Boolean),
      credentials.get(INTERVALS_API_KEY).then(Boolean),
      credentials.get(ONELAP_ACCOUNT_KEY).then(Boolean),
      credentials.get(COROS_SESSION_KEY).then(Boolean),
      credentials.get(GARMIN_SESSION_KEY).then(Boolean),
    ])

    const diagnostics: ServiceDiagnostics = {
      keyringAvailable,
      hasEncryptedCredentials,
      stravaConfigPresent: config !== null,
      stravaTokensPresent,
      intervalsCredentialsPresent,
      onelapCredentialsPresent,
      corosCredentialsPresent,
      garminCredentialsPresent,
      sharedConfigPresent: hasSharedConfig(settings),
    }

    if (!config) {
      return {
        status: 'unconfigured',
        diagnostics,
      }
    }

    return {
      status: 'ready',
      diagnostics,
      credentials,
      config,
    }
  }

  private async refreshDiagnostics(): Promise<void> {
    if (!this.credentials) {
      this.lastDiagnostics = (await this.resolveRestoreState()).diagnostics
      return
    }

    const [
      settings,
      keyringAvailable,
      hasEncryptedCredentials,
      stravaConfigPresent,
      stravaTokensPresent,
      intervalsCredentialsPresent,
      corosCredentialsPresent,
      garminCredentialsPresent,
    ] = await Promise.all([
      loadSettings(this.paths.settingsPath),
      this.isKeyringAvailable(),
      fileExists(this.paths.credsPath),
      this.loadStravaAppConfig(this.credentials).then(Boolean),
      this.credentials.get(STRAVA_TOKENS_KEY).then(Boolean),
      this.credentials.get(INTERVALS_API_KEY).then(Boolean),
      this.credentials.get(COROS_SESSION_KEY).then(Boolean),
      this.credentials.get(GARMIN_SESSION_KEY).then(Boolean),
    ])

    this.lastDiagnostics = {
      keyringAvailable,
      hasEncryptedCredentials,
      stravaConfigPresent,
      stravaTokensPresent,
      intervalsCredentialsPresent,
      corosCredentialsPresent,
      garminCredentialsPresent,
      onelapCredentialsPresent: Boolean(await this.credentials.get(ONELAP_ACCOUNT_KEY)),
      sharedConfigPresent: hasSharedConfig(settings),
    }
  }

  private async isKeyringAvailable(): Promise<boolean> {
    try {
      const keyring = new KeyringCredentialStore({ service: 'SweatRelay' })
      await keyring.get('__probe__')
      return true
    } catch {
      return false
    }
  }

  private async readRawSettings(): Promise<unknown> {
    try {
      const raw = await readFile(this.paths.settingsPath, 'utf8')
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function hasSharedConfig(
  settings: Awaited<ReturnType<Services['loadPersistedSettings']>>,
): boolean {
  return Boolean(settings.shared.watchDir || settings.shared.scheduleCron)
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}

function normalizeAutoSyncTargets(
  targets: readonly AutoSyncTarget[] | undefined,
): AutoSyncTarget[] {
  if (!targets || targets.length === 0) return [AutoSyncTargets.strava]
  const normalized = targets.filter(isAutoSyncTarget)
  const deduped = Array.from(new Set(normalized))
  return deduped.length > 0 ? deduped : [AutoSyncTargets.strava]
}

function isAutoSyncTarget(value: unknown): value is AutoSyncTarget {
  return (
    value === AutoSyncTargets.strava ||
    value === AutoSyncTargets.coros ||
    value === AutoSyncTargets.garmin
  )
}

function normalizeCorosSession(session: CorosSession): CorosSession {
  return {
    userId: session.userId.trim(),
    accessToken: session.accessToken.trim(),
    regionId: normalizeCorosRegionId(session.regionId),
    ...(session.cookie?.trim() ? { cookie: session.cookie.trim() } : {}),
  }
}

function normalizeCorosRegionId(regionId: CorosRegionId | undefined): CorosRegionId {
  if (regionId === CorosRegionIds.global || regionId === CorosRegionIds.europe) return regionId
  return CorosRegionIds.china
}

function normalizeGarminSession(session: GarminSession): GarminSession {
  const diToken = session.diToken?.trim()
  const jwtWeb = session.jwtWeb?.trim()
  const webCookie = session.webCookie?.trim()
  return {
    domain: normalizeGarminDomain(session.domain),
    ...(diToken ? { diToken } : {}),
    ...(session.diRefreshToken?.trim() ? { diRefreshToken: session.diRefreshToken.trim() } : {}),
    ...(session.diClientId?.trim() ? { diClientId: session.diClientId.trim() } : {}),
    ...(jwtWeb ? { jwtWeb } : {}),
    ...(webCookie ? { webCookie } : {}),
    ...(session.csrfToken?.trim() ? { csrfToken: session.csrfToken.trim() } : {}),
    ...(session.browserPartition?.trim()
      ? { browserPartition: session.browserPartition.trim() }
      : {}),
    ...(session.displayName?.trim() ? { displayName: session.displayName.trim() } : {}),
    ...(session.fullName?.trim() ? { fullName: session.fullName.trim() } : {}),
    ...(session.userName?.trim() ? { userName: session.userName.trim() } : {}),
  }
}

function normalizeGarminDomain(domain: GarminDomain | undefined): GarminDomain {
  return domain === GarminDomains.global ? GarminDomains.global : GarminDomains.china
}
