import { buildContext } from '../context.ts'

export async function status(): Promise<void> {
  const ctx = buildContext()
  console.log(`Config dir:   ${ctx.configDir}`)
  console.log(`Creds:        ${ctx.credsPath}`)
  console.log(`Synced state: ${ctx.syncedPath}`)
  console.log()

  const credKeys = await ctx.credentials.keys()
  console.log(`Credentials stored: ${credKeys.length === 0 ? '(none)' : credKeys.join(', ')}`)

  const records = await ctx.store.list()
  console.log(`\nRecent syncs (${records.length} total):`)
  for (const r of records.slice(0, 20)) {
    const url = r.activityUrl ?? '(no Strava url)'
    console.log(`  [${r.syncedAt}] ${r.source}  ${r.key.slice(0, 32)}  → ${url}`)
  }
}
