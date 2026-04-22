import { app, dialog } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * Wires electron-updater against GitHub releases. Owner/repo come from
 * package.json `build.publish` set by electron-builder at build time, so we
 * just need to configure logging + UX here.
 */
export function configureAutoUpdates(): AppUpdater {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (!app.isPackaged) return
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['现在重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '已下载新版本',
      message: `SweatRelay ${info.version} 准备就绪`,
      detail: '重启后将自动应用更新。',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('[updater]', err))
  }

  return autoUpdater
}
