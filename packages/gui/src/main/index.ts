import { fileURLToPath } from 'node:url'
import {
  AutoSyncTargets,
  GarminApiError,
  type GarminDomain,
  GarminDomains,
  type GarminSession,
  GarminUploader,
  type SyncOutcome,
} from '@sweatrelay/core'
import {
  app,
  BrowserWindow,
  dialog,
  session as electronSession,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from 'electron'
import {
  type AppStatus,
  type AutoSyncMode,
  type ConfigurePayload,
  type CorosAuthPayload,
  type DeletePlannedWorkoutPayload,
  type GarminAuthPayload,
  type IntervalsAuthPayload,
  IPC_CHANNELS,
  type IpcResult,
  type OnelapAuthPayload,
  type SetSchedulePayload,
  type SetThemePayload,
  type SetTrainingStatusPayload,
  type SetWatchDirPayload,
  type SyncTrainingPlanPayload,
  type TrainingLoadPayload,
  type TrainingPlanPayload,
  type UnlockPayload,
  type UpdateTrainingPlanPayload,
  type UpsertPlannedWorkoutPayload,
} from '../shared/ipc.ts'
import {
  logApp,
  logAppError,
  logCorosImportOutcomes,
  logGarminImportOutcomes,
  logSyncOutcomes,
} from './logging.ts'
import { Services } from './services.ts'
import { appPaths } from './state.ts'
import { configureAutoUpdates } from './updater.ts'

let mainWindow: BrowserWindow | null = null
const services = new Services(appPaths(), { garminApiFetch })
let onelapSyncInFlight = false
let onelapCorosImportInFlight = false
let onelapGarminImportInFlight = false
let garminTrainingPlanSyncInFlight = false

const GARMIN_BROWSER_AUTH_TIMEOUT_MS = 5 * 60 * 1000
const GARMIN_BROWSER_COOKIE_NAMES = new Set([
  'CASRMC',
  'GARMIN-SSO',
  'GARMIN-SSO-CSRF',
  'GARMIN-SSO-CUST-GUID',
  'GARMIN-SSO-CUST-ID',
  'JWT_WEB',
  'session',
])

async function garminApiFetch(
  session: GarminSession,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!session.browserPartition) return fetch(url, init)
  const res = await electronSession.fromPartition(session.browserPartition).fetch(url, {
    ...withoutBrowserManagedHeaders(init),
    credentials: 'include',
  })
  if (session.domain === GarminDomains.china) {
    const parsed = new URL(url)
    logApp(`garmin:browser-fetch ${parsed.pathname} status=${res.status}`)
  }
  return res
}

function withoutBrowserManagedHeaders(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers)
  headers.delete('cookie')
  headers.delete('origin')
  headers.delete('referer')
  headers.delete('referrer')
  return {
    ...init,
    headers,
  }
}

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}
function fail(scope: string, err: unknown): IpcResult<never> {
  logAppError(scope, err)
  const e = err as Error
  return { ok: false, error: { name: e.name ?? 'Error', message: e.message ?? String(err) } }
}

async function buildStatus(): Promise<AppStatus> {
  const settings = await services.loadPersistedSettings()
  const onelapAccount = await services.getOnelapAccount()
  const corosUserId = await services.getCorosUserId()
  const garminDisplayName = await services.getGarminDisplayName()
  const garminDomain = await services.getGarminDomain()
  const stravaAthleteId = await services.getStravaAthleteId()
  const diagnostics = services.diagnostics()
  const recentSyncs = services.configured() ? (await services.recentSyncs()).slice(0, 50) : []
  const autoSyncMode = getAutoSyncMode(settings)
  const autoSyncEnabled = autoSyncMode !== 'none'
  const status: AppStatus = {
    configured: services.configured(),
    needsUnlock: services.needsUnlock(),
    configDir: services.paths.configDir,
    appVersion: app.getVersion(),
    stravaConnected: stravaAthleteId !== undefined,
    stravaConfigPresent: diagnostics.stravaConfigPresent,
    intervalsConnected: diagnostics.intervalsCredentialsPresent,
    corosConnected: diagnostics.corosCredentialsPresent,
    garminConnected: diagnostics.garminCredentialsPresent,
    onelapConnected: onelapAccount !== null,
    scheduleTargets: settings.shared.scheduleTargets ?? [AutoSyncTargets.strava],
    autoSyncEnabled,
    autoSyncMode,
    manualSyncAvailable:
      services.configured() && stravaAthleteId !== undefined && onelapAccount !== null,
    corosManualSyncAvailable: diagnostics.corosCredentialsPresent && onelapAccount !== null,
    garminManualSyncAvailable: diagnostics.garminCredentialsPresent && onelapAccount !== null,
    garminTrainingPlanSyncAvailable:
      diagnostics.garminCredentialsPresent && garminDomain === GarminDomains.china,
    trainingStatusEnabled: settings.gui.trainingStatusEnabled ?? false,
    trainingStatusRange: settings.gui.trainingStatusRange ?? 'current',
    theme: settings.gui.theme ?? 'system',
    diagnostics,
    recentSyncs,
  }
  if (stravaAthleteId !== undefined) status.stravaAthleteId = stravaAthleteId
  if (onelapAccount) status.onelapAccount = onelapAccount
  if (corosUserId) status.corosUserId = corosUserId
  if (garminDisplayName) status.garminDisplayName = garminDisplayName
  if (garminDomain) status.garminDomain = garminDomain
  if (settings.shared.watchDir) status.watchDir = settings.shared.watchDir
  if (settings.shared.scheduleCron) status.scheduleCron = settings.shared.scheduleCron
  return status
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    title: 'SweatRelay',
    backgroundColor: '#0b0d10',
    // macOS: hide the system title bar but keep the traffic lights inset into
    // the window. The renderer reserves header space so they don't overlap.
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.mjs', import.meta.url)),
      sandbox: false,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }
}

function emit(outcome: SyncOutcome): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.syncEvent, outcome)
  }
}

async function authorizeGarminWithBrowser(domain: GarminDomain): Promise<GarminSession> {
  const connectOrigin = `https://connect.${domain}`
  const partition = `persist:sweatrelay-garmin-auth-${domain.replaceAll('.', '-')}`
  const authWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    title: domain === GarminDomains.china ? '登录 Garmin 中国区' : '登录 Garmin 国际区',
    parent: mainWindow ?? undefined,
    modal: false,
    backgroundColor: '#f7f4ef',
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const authSession = authWindow.webContents.session
  await authSession.clearStorageData({ storages: ['cookies'] })

  return new Promise<GarminSession>((resolve, reject) => {
    let settled = false
    let ticketExchangeInFlight = false
    const cleanup = (): void => {
      clearInterval(poll)
      clearTimeout(timeout)
      authSession.webRequest.onBeforeRequest(null)
    }
    const finish = (session: GarminSession): void => {
      if (settled) return
      settled = true
      cleanup()
      authWindow.close()
      resolve(session)
    }
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    const tryExchangeTicket = async (urlString: string): Promise<void> => {
      if (settled || ticketExchangeInFlight) return
      let url: URL
      try {
        url = new URL(urlString)
      } catch {
        return
      }
      const ticket = url.searchParams.get('ticket')
      if (!ticket) return
      ticketExchangeInFlight = true
      url.searchParams.delete('ticket')
      const serviceUrl = url.toString()
      logApp(`garmin:browser-ticket captured domain=${domain}`)
      try {
        const session = await GarminUploader.exchangeServiceTicket(ticket, domain, serviceUrl)
        logApp(`garmin:browser-ticket exchanged domain=${domain}`)
        finish(session)
      } catch (err) {
        logAppError('garmin:browser-ticket', err)
        ticketExchangeInFlight = false
      }
    }
    const readSession = async (): Promise<void> => {
      try {
        await tryExchangeTicket(authWindow.webContents.getURL())
        const cookies = await authSession.cookies.get({})
        const garminCookies = cookies.filter(
          (cookie) =>
            (cookie.domain ?? '').includes(domain) &&
            GARMIN_BROWSER_COOKIE_NAMES.has(cookie.name) &&
            cookie.value,
        )
        const jwtWeb = cookies.find(
          (cookie) =>
            cookie.name === 'JWT_WEB' &&
            (cookie.domain ?? '').includes(`garmin.${domain.endsWith('.cn') ? 'cn' : 'com'}`),
        )
        if (!jwtWeb?.value) return
        const csrfToken = cookies.find(
          (cookie) =>
            /csrf/i.test(cookie.name) &&
            (cookie.domain ?? '').includes(`garmin.${domain.endsWith('.cn') ? 'cn' : 'com'}`),
        )?.value
        finish({
          domain,
          jwtWeb: jwtWeb.value,
          webCookie: garminCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
          browserPartition: partition,
          ...(csrfToken ? { csrfToken } : {}),
        })
      } catch (err) {
        fail(err)
      }
    }
    const poll = setInterval(() => {
      void readSession()
    }, 1000)
    const timeout = setTimeout(() => {
      fail(new Error('Garmin 浏览器登录超时，请重新连接'))
    }, GARMIN_BROWSER_AUTH_TIMEOUT_MS)

    authSession.webRequest.onBeforeRequest(
      { urls: [`${connectOrigin}/*`] },
      (details, callback) => {
        void tryExchangeTicket(details.url)
        callback({})
      },
    )
    authWindow.on('closed', () => {
      if (!settled) fail(new Error('已取消 Garmin 浏览器登录'))
    })
    authWindow.webContents.on('will-redirect', (_event, url) => {
      void tryExchangeTicket(url)
    })
    authWindow.webContents.on('did-redirect-navigation', (_event, url) => {
      void tryExchangeTicket(url)
    })
    authWindow.webContents.on('did-navigate', (_event, url) => {
      void tryExchangeTicket(url)
      void readSession()
    })
    authWindow.webContents.on('did-navigate-in-page', (_event, url) => {
      void tryExchangeTicket(url)
      void readSession()
    })
    authWindow.loadURL(`${connectOrigin}/modern/`).catch(fail)
  })
}

function shouldRetryGarminAuthInBrowser(domain: GarminDomain | undefined, err: unknown): boolean {
  return (
    domain === GarminDomains.china &&
    err instanceof GarminApiError &&
    !err.message.includes('username or password') &&
    (err.message.includes('token exchange') ||
      err.message.includes('portal login') ||
      hasGarminTokenExchangeFailure(err.body))
  )
}

function hasGarminTokenExchangeFailure(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const failures = (body as { failures?: unknown }).failures
  return Array.isArray(failures) && failures.some((item) => String(item).includes('token exchange'))
}

function registerIpc(): void {
  services.onSyncEvent((outcome) => {
    logSyncOutcomes('sync:event', [outcome])
    emit(outcome)
  })
  services.onError((scope, err) => {
    logAppError(scope, err)
  })

  ipcMain.handle(IPC_CHANNELS.status, async () => {
    try {
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.status, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.configure, async (_evt, payload: ConfigurePayload) => {
    try {
      await services.configure(
        payload.passphrase,
        payload.stravaClientId,
        payload.stravaClientSecret,
      )
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.configure, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.unlock, async (_evt, payload: UnlockPayload) => {
    try {
      await services.unlock(payload.passphrase)
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.unlock, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authStrava, async () => {
    try {
      await services.authorizeStrava((url) => {
        shell.openExternal(url)
      })
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.authStrava, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authOnelap, async (_evt, payload: OnelapAuthPayload) => {
    try {
      await services.authorizeOnelap(payload.account, payload.password)
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.authOnelap, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authIntervals, async (_evt, payload: IntervalsAuthPayload) => {
    try {
      await services.authorizeIntervals(payload.apiKey)
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.authIntervals, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authCoros, async (_evt, payload: CorosAuthPayload) => {
    try {
      await services.authorizeCoros({
        userId: payload.userId,
        accessToken: payload.accessToken,
        regionId: payload.regionId ?? 2,
        ...(payload.cookie ? { cookie: payload.cookie } : {}),
      })
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.authCoros, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authGarmin, async (_evt, payload: GarminAuthPayload) => {
    try {
      const auth = await services.authorizeGarmin(payload)
      return ok({ status: await buildStatus(), mfaRequired: auth.mfaRequired })
    } catch (err) {
      const domain =
        payload.domain === GarminDomains.global ? GarminDomains.global : GarminDomains.china
      if (shouldRetryGarminAuthInBrowser(domain, err)) {
        try {
          logApp(`garmin:browser-auth start domain=${domain}`)
          const session = await authorizeGarminWithBrowser(domain)
          await services.authorizeGarminSession(session)
          logApp(`garmin:browser-auth complete domain=${domain}`)
          return ok({ status: await buildStatus(), mfaRequired: false })
        } catch (browserErr) {
          return fail(IPC_CHANNELS.authGarmin, browserErr)
        }
      }
      return fail(IPC_CHANNELS.authGarmin, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.disconnectGarmin, async () => {
    try {
      await services.disconnectGarmin()
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.disconnectGarmin, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.trainingLoad, async (_evt, payload?: TrainingLoadPayload) => {
    try {
      return ok(await services.getIntervalsTrainingLoad(payload?.days, payload?.forecastDays))
    } catch (err) {
      return fail(IPC_CHANNELS.trainingLoad, err)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.setTrainingStatus,
    async (_evt, payload: SetTrainingStatusPayload) => {
      try {
        await services.setTrainingStatus(payload)
        return ok(await buildStatus())
      } catch (err) {
        return fail(IPC_CHANNELS.setTrainingStatus, err)
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.trainingPlan, async (_evt, payload?: TrainingPlanPayload) => {
    try {
      return ok(await services.getTrainingPlanOverview(payload?.planId))
    } catch (err) {
      return fail(IPC_CHANNELS.trainingPlan, err)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.updateTrainingPlan,
    async (_evt, payload: UpdateTrainingPlanPayload) => {
      try {
        return ok(await services.updateTrainingPlan(payload))
      } catch (err) {
        return fail(IPC_CHANNELS.updateTrainingPlan, err)
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.upsertPlannedWorkout,
    async (_evt, payload: UpsertPlannedWorkoutPayload) => {
      try {
        return ok(await services.upsertPlannedWorkout(payload))
      } catch (err) {
        return fail(IPC_CHANNELS.upsertPlannedWorkout, err)
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.deletePlannedWorkout,
    async (_evt, payload: DeletePlannedWorkoutPayload) => {
      try {
        return ok(await services.deletePlannedWorkout(payload.planId, payload.workoutId))
      } catch (err) {
        return fail(IPC_CHANNELS.deletePlannedWorkout, err)
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.syncTrainingPlan, async (_evt, payload: SyncTrainingPlanPayload) => {
    try {
      return ok(await services.syncTrainingPlanToIntervals(payload.planId))
    } catch (err) {
      return fail(IPC_CHANNELS.syncTrainingPlan, err)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.syncTrainingPlanToGarmin,
    async (_evt, payload: SyncTrainingPlanPayload) => {
      if (garminTrainingPlanSyncInFlight) {
        logApp('sync:training-plan-garmin ignored reason=already-in-flight')
        return {
          ok: false,
          error: {
            name: 'SyncInProgressError',
            message: '正在同步 Garmin 训练课程，请等待当前同步完成',
          },
        }
      }

      const startedAt = Date.now()
      garminTrainingPlanSyncInFlight = true
      try {
        logApp('sync:training-plan-garmin start')
        const result = await services.syncTrainingPlanToGarmin(payload.planId)
        logApp(`sync:training-plan-garmin complete durationMs=${Date.now() - startedAt}`)
        return ok(result)
      } catch (err) {
        logApp(`sync:training-plan-garmin failed durationMs=${Date.now() - startedAt}`)
        return fail(IPC_CHANNELS.syncTrainingPlanToGarmin, err)
      } finally {
        garminTrainingPlanSyncInFlight = false
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.setWatchDir, async (_evt, payload: SetWatchDirPayload) => {
    try {
      await services.setWatchDir(payload.dir)
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.setWatchDir, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.setSchedule, async (_evt, payload: SetSchedulePayload) => {
    try {
      await services.setSchedule(payload.cron, payload.timezone, payload.targets)
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.setSchedule, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.setTheme, async (_evt, payload: SetThemePayload) => {
    try {
      await services.setTheme(payload.theme)
      return ok(await buildStatus())
    } catch (err) {
      return fail(IPC_CHANNELS.setTheme, err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.syncOnelap, async () => {
    if (onelapSyncInFlight) {
      logApp('sync:onelap ignored reason=already-in-flight')
      return {
        ok: false,
        error: { name: 'SyncInProgressError', message: '正在同步，请等待当前同步完成' },
      }
    }

    const startedAt = Date.now()
    onelapSyncInFlight = true
    try {
      logApp('sync:onelap start')
      const outcomes = await services.runOnelapSyncOnce()
      logSyncOutcomes(`sync:onelap complete durationMs=${Date.now() - startedAt}`, outcomes)
      for (const o of outcomes) emit(o)
      return ok(outcomes)
    } catch (err) {
      logApp(`sync:onelap failed durationMs=${Date.now() - startedAt}`)
      return fail(IPC_CHANNELS.syncOnelap, err)
    } finally {
      onelapSyncInFlight = false
    }
  })

  ipcMain.handle(IPC_CHANNELS.syncOnelapToCoros, async () => {
    if (onelapCorosImportInFlight) {
      logApp('sync:onelap-coros ignored reason=already-in-flight')
      return {
        ok: false,
        error: { name: 'SyncInProgressError', message: '正在导入高驰，请等待当前导入完成' },
      }
    }

    const startedAt = Date.now()
    onelapCorosImportInFlight = true
    try {
      logApp('sync:onelap-coros start')
      const outcomes = await services.runOnelapCorosImportOnce()
      logCorosImportOutcomes('sync:onelap-coros', outcomes)
      logApp(`sync:onelap-coros complete durationMs=${Date.now() - startedAt}`)
      return ok(outcomes)
    } catch (err) {
      logApp(`sync:onelap-coros failed durationMs=${Date.now() - startedAt}`)
      return fail(IPC_CHANNELS.syncOnelapToCoros, err)
    } finally {
      onelapCorosImportInFlight = false
    }
  })

  ipcMain.handle(IPC_CHANNELS.syncOnelapToGarmin, async () => {
    if (onelapGarminImportInFlight) {
      logApp('sync:onelap-garmin ignored reason=already-in-flight')
      return {
        ok: false,
        error: { name: 'SyncInProgressError', message: '正在导入 Garmin，请等待当前导入完成' },
      }
    }

    const startedAt = Date.now()
    onelapGarminImportInFlight = true
    try {
      logApp('sync:onelap-garmin start')
      const outcomes = await services.runOnelapGarminImportOnce()
      logGarminImportOutcomes('sync:onelap-garmin', outcomes)
      logApp(`sync:onelap-garmin complete durationMs=${Date.now() - startedAt}`)
      return ok(outcomes)
    } catch (err) {
      logApp(`sync:onelap-garmin failed durationMs=${Date.now() - startedAt}`)
      return fail(IPC_CHANNELS.syncOnelapToGarmin, err)
    } finally {
      onelapGarminImportInFlight = false
    }
  })

  ipcMain.handle(IPC_CHANNELS.pickDirectory, async (evt: IpcMainInvokeEvent) => {
    try {
      const win = BrowserWindow.fromWebContents(evt.sender)
      const result = await dialog.showOpenDialog(win ?? mainWindow ?? new BrowserWindow(), {
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return ok(null)
      return ok(result.filePaths[0] ?? null)
    } catch (err) {
      return fail(IPC_CHANNELS.pickDirectory, err)
    }
  })
}

app.whenReady().then(async () => {
  await services.restorePersistedConfiguration().catch((err) => {
    logAppError('startup:restore', err)
  })
  registerIpc()
  configureAutoUpdates()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await services.dispose()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await services.dispose()
})

function getAutoSyncMode(
  settings: Awaited<ReturnType<Services['loadPersistedSettings']>>,
): AutoSyncMode {
  if (settings.shared.watchDir && settings.shared.scheduleCron) return 'both'
  if (settings.shared.watchDir) return 'watch'
  if (settings.shared.scheduleCron) return 'schedule'
  return 'none'
}
