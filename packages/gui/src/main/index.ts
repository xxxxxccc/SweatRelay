import { fileURLToPath } from 'node:url'
import type { SyncOutcome } from '@sweatrelay/core'
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from 'electron'
import {
  type AppStatus,
  type AutoSyncMode,
  type ConfigurePayload,
  IPC_CHANNELS,
  type IpcResult,
  type OnelapAuthPayload,
  type SetSchedulePayload,
  type SetThemePayload,
  type SetWatchDirPayload,
  type UnlockPayload,
} from '../shared/ipc.ts'
import { Services } from './services.ts'
import { appPaths } from './state.ts'
import { configureAutoUpdates } from './updater.ts'

let mainWindow: BrowserWindow | null = null
const services = new Services(appPaths())

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}
function fail(err: unknown): IpcResult<never> {
  const e = err as Error
  return { ok: false, error: { name: e.name ?? 'Error', message: e.message ?? String(err) } }
}

async function buildStatus(): Promise<AppStatus> {
  const settings = await services.loadPersistedSettings()
  const onelapAccount = await services.getOnelapAccount()
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
    onelapConnected: onelapAccount !== null,
    autoSyncEnabled,
    autoSyncMode,
    manualSyncAvailable:
      services.configured() && stravaAthleteId !== undefined && onelapAccount !== null,
    theme: settings.gui.theme ?? 'system',
    diagnostics,
    recentSyncs,
  }
  if (stravaAthleteId !== undefined) status.stravaAthleteId = stravaAthleteId
  if (onelapAccount) status.onelapAccount = onelapAccount
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
  services.onSyncEvent(emit)

  ipcMain.handle(IPC_CHANNELS.status, async () => {
    try {
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
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
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.unlock, async (_evt, payload: UnlockPayload) => {
    try {
      await services.unlock(payload.passphrase)
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authStrava, async () => {
    try {
      await services.authorizeStrava((url) => {
        shell.openExternal(url)
      })
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.authOnelap, async (_evt, payload: OnelapAuthPayload) => {
    try {
      await services.authorizeOnelap(payload.account, payload.password)
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.setWatchDir, async (_evt, payload: SetWatchDirPayload) => {
    try {
      await services.setWatchDir(payload.dir)
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.setSchedule, async (_evt, payload: SetSchedulePayload) => {
    try {
      await services.setSchedule(payload.cron, payload.timezone)
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.setTheme, async (_evt, payload: SetThemePayload) => {
    try {
      await services.setTheme(payload.theme)
      return ok(await buildStatus())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.syncOnelap, async () => {
    try {
      const outcomes = await services.runOnelapSyncOnce()
      for (const o of outcomes) emit(o)
      return ok(outcomes)
    } catch (err) {
      return fail(err)
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
      return fail(err)
    }
  })
}

app.whenReady().then(async () => {
  await services.restorePersistedConfiguration().catch((err) => {
    console.error('[startup] failed to restore persisted GUI configuration:', err)
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
