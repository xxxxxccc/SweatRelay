import { buildCredentialStore, buildPaths } from '../context.ts'

export async function status(): Promise<void> {
  const paths = buildPaths()
  console.log(`Config dir:   ${paths.configDir}`)
  console.log(`Creds:        ${paths.credsPath}`)
  console.log(`Synced state: ${paths.syncedPath}`)
  console.log()

  try {
    const credentials = await buildCredentialStore(paths)
    const credKeys = await credentials.keys()
    console.log(`Credentials stored: ${credKeys.length === 0 ? '(none)' : credKeys.join(', ')}`)
  } catch (err) {
    console.log(`Credentials stored: unavailable (${(err as Error).message})`)
  }

  const records = await paths.store.list()
  console.log(`\nRecent syncs (${records.length} total):`)
  for (const r of records.slice(0, 20)) {
    const url = r.activityUrl ?? '(no Strava url)'
    console.log(`  [${r.syncedAt}] ${r.source}  ${r.key.slice(0, 32)}  → ${url}`)
  }
}
