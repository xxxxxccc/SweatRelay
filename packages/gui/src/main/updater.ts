import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, dialog, shell } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater
const updaterLogName = 'updater.log'
const isMac = process.platform === 'darwin'

/**
 * Wires electron-updater against GitHub releases. Owner/repo come from
 * package.json `build.publish` set by electron-builder at build time, so we
 * just need to configure logging + UX here.
 */
export function configureAutoUpdates(): AppUpdater {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = !isMac

  autoUpdater.on('checking-for-update', () => {
    logUpdater('checking-for-update')
  })

  autoUpdater.on('update-available', (info) => {
    logUpdater(`update-available version=${info.version}`)
  })

  autoUpdater.on('update-not-available', (info) => {
    logUpdater(`update-not-available version=${info.version}`)
  })

  autoUpdater.on('download-progress', (progress) => {
    logUpdater(
      `download-progress percent=${progress.percent.toFixed(1)} transferred=${progress.transferred} total=${progress.total} bytesPerSecond=${progress.bytesPerSecond}`,
    )
  })

  autoUpdater.on('error', (err) => {
    logUpdater(`error ${(err as Error).stack ?? (err as Error).message ?? String(err)}`)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    logUpdater(`update-downloaded version=${info.version}`)
    if (!app.isPackaged) return
    if (isMac) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: ['打开 Releases 页面', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '已下载新版本',
        message: `SweatRelay ${info.version} 已下载完成`,
        detail: '当前 macOS 版本将引导你前往 Releases 页面手动安装更新。',
      })
      logUpdater(
        `update-downloaded-dialog response=${response === 0 ? 'open-release-page' : 'later'}`,
      )
      if (response === 0) {
        await shell.openExternal(releaseUrl(info.version))
      }
      return
    }

    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['现在重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '已下载新版本',
      message: `SweatRelay ${info.version} 准备就绪`,
      detail: '重启后将自动应用更新。',
    })
    logUpdater(`update-downloaded-dialog response=${response === 0 ? 'restart-now' : 'later'}`)
    if (response === 0) autoUpdater.quitAndInstall()
  })

  if (app.isPackaged) {
    logUpdater('checkForUpdatesAndNotify start')
    autoUpdater
      .checkForUpdatesAndNotify()
      .then((result) => {
        if (!result) {
          logUpdater('checkForUpdatesAndNotify result=no-update')
          return
        }
        logUpdater(
          `checkForUpdatesAndNotify result=${result.isUpdateAvailable ? 'update-available' : 'update-not-available'} version=${result.updateInfo.version}`,
        )
      })
      .catch((err) =>
        logUpdater(`error ${(err as Error).stack ?? (err as Error).message ?? String(err)}`),
      )
  } else {
    logUpdater('skip auto-update check in development')
  }

  return autoUpdater
}

function logUpdater(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log('[updater]', message)
  void writeUpdaterLog(line)
}

async function writeUpdaterLog(line: string): Promise<void> {
  try {
    const path = updaterLogPath()
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${line}\n`, 'utf8')
  } catch (err) {
    console.error('[updater]', 'failed to write updater log', err)
  }
}

function updaterLogPath(): string {
  return join(app.getPath('userData'), 'logs', updaterLogName)
}

function releaseUrl(version: string): string {
  return `https://github.com/xxxxxccc/SweatRelay/releases/tag/v${version}`
}
