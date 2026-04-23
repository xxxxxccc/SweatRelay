import { buildPaths, collectDiagnostics, loadPersistedSettings } from '../context.ts'

export async function status(): Promise<void> {
  const paths = buildPaths()
  const [settings, diagnostics, records] = await Promise.all([
    loadPersistedSettings(paths.settingsPath),
    collectDiagnostics(paths),
    paths.store.list(),
  ])

  const watchEnabled = Boolean(settings.shared.watchDir)
  const scheduleEnabled = Boolean(settings.shared.scheduleCron)
  const manualSourceConfigured = diagnostics.onelapCredentialsPresent
  const onlyManualSync = manualSourceConfigured && !watchEnabled && !scheduleEnabled

  console.log(`Config dir:          ${paths.configDir}`)
  console.log(`Shared watch dir:    ${settings.shared.watchDir ?? '(disabled)'}`)
  console.log(`Scheduled sync:      ${settings.shared.scheduleCron ?? '(disabled)'}`)
  console.log(`Manual Onelap sync:  ${yesNo(manualSourceConfigured)}`)
  console.log(`Automatic sync:      ${yesNo(watchEnabled || scheduleEnabled)}`)
  console.log(`Only manual sync:    ${yesNo(onlyManualSync)}`)
  console.log(`Strava app config:   ${yesNo(diagnostics.stravaConfigPresent)}`)
  console.log(`Strava authorized:   ${yesNo(diagnostics.stravaTokensPresent)}`)
  console.log()
  console.log('Recent syncs:')
  if (records.length === 0) {
    console.log('  (none)')
    return
  }

  for (const record of records.slice(0, 20)) {
    const url = record.activityUrl ?? '(no Strava url)'
    console.log(`  [${record.syncedAt}] ${record.source}  ${record.key.slice(0, 32)}  → ${url}`)
  }
}

export async function doctor(): Promise<void> {
  const paths = buildPaths()
  const diagnostics = await collectDiagnostics(paths)
  console.log(`Config dir:               ${diagnostics.configDir}`)
  console.log(`OS keyring available:     ${yesNo(diagnostics.keyringAvailable)}`)
  console.log(`creds.enc present:        ${yesNo(diagnostics.hasEncryptedCredentials)}`)
  console.log(`Strava app config:        ${yesNo(diagnostics.stravaConfigPresent)}`)
  console.log(`Strava tokens:            ${yesNo(diagnostics.stravaTokensPresent)}`)
  console.log(`Onelap credentials:       ${yesNo(diagnostics.onelapCredentialsPresent)}`)
  console.log(`Automatic sync config:    ${yesNo(diagnostics.sharedConfigPresent)}`)
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}
