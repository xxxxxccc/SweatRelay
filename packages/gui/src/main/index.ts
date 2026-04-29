import { fileURLToPath } from 'node:url'
import type { SyncOutcome } from '@sweatrelay/core'
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from 'electron'
import {
  type AppStatus,
  type AutoSyncMode,
  type ConfigurePayload,
  type CorosAuthPayload,
  type DeletePlannedWorkoutPayload,
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
import { logApp, logAppError, logCorosImportOutcomes, logSyncOutcomes } from './logging.ts'
import { Services } from './services.ts'
import { appPaths } from './state.ts'
import { configureAutoUpdates } from './updater.ts'

let mainWindow: BrowserWindow | null = null
const services = new Services(appPaths())
let onelapSyncInFlight = false
let onelapCorosImportInFlight = false

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
    onelapConnected: onelapAccount !== null,
    autoSyncEnabled,
    autoSyncMode,
    manualSyncAvailable:
      services.configured() && stravaAthleteId !== undefined && onelapAccount !== null,
    corosManualSyncAvailable: diagnostics.corosCredentialsPresent && onelapAccount !== null,
    trainingStatusEnabled: settings.gui.trainingStatusEnabled ?? false,
    trainingStatusRange: settings.gui.trainingStatusRange ?? 'current',
    theme: settings.gui.theme ?? 'system',
    diagnostics,
    recentSyncs,
  }
  if (stravaAthleteId !== undefined) status.stravaAthleteId = stravaAthleteId
  if (onelapAccount) status.onelapAccount = onelapAccount
  if (corosUserId) status.corosUserId = corosUserId
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
      await services.setSchedule(payload.cron, payload.timezone)
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
