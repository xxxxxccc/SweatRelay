#!/usr/bin/env node
import { cac } from 'cac'
import { authOnelap, authStrava } from './commands/auth.ts'
import { schedule } from './commands/schedule.ts'
import { status } from './commands/status.ts'
import { syncBlackbird, syncFolder, syncMagene, syncOnelap } from './commands/sync.ts'
import { uploadFile } from './commands/upload.ts'
import { watchDir } from './commands/watch.ts'

const cli = cac('sweatrelay')

cli.command('auth strava', 'Authenticate with Strava (OAuth)').action(async () => {
  await authStrava()
})

cli.command('auth onelap', 'Save Onelap account/password (encrypted)').action(async () => {
  await authOnelap()
})

cli
  .command('upload <file>', 'Upload a single FIT/GPX/TCX file to Strava')
  .action(async (file: string) => {
    await uploadFile(file)
  })

cli
  .command('watch <dir>', 'Watch a directory; auto-upload new FIT/GPX/TCX files')
  .option('--process-existing', 'Also upload files already present at startup', { default: false })
  .action(async (dir: string, opts: { processExisting?: boolean }) => {
    await watchDir(dir, { processExisting: opts.processExisting })
  })

cli
  .command('sync onelap', 'Pull recent activities from Onelap and upload to Strava')
  .option('--since <when>', 'Filter: today | YYYY-MM-DD', { default: 'today' })
  .action(async (opts: { since?: string }) => {
    await syncOnelap({ ...(opts.since ? { since: opts.since } : {}) })
  })

cli
  .command('sync magene <dir>', 'Upload Magene-exported FIT/GPX files from <dir>')
  .action(async (dir: string) => {
    await syncMagene({ dir })
  })

cli
  .command('sync blackbird <dir>', 'Upload Blackbird-exported FIT/GPX files from <dir>')
  .action(async (dir: string) => {
    await syncBlackbird({ dir })
  })

cli
  .command('sync folder <dir>', 'Upload all FIT/GPX/TCX files in <dir> (generic, no brand label)')
  .action(async (dir: string) => {
    await syncFolder({ dir })
  })

cli
  .command('schedule <cron> <action>', 'Run an action on a cron schedule (e.g. "sync onelap")')
  .option('--tz <zone>', 'IANA timezone, e.g. Asia/Shanghai')
  .action(async (cron: string, action: string, opts: { tz?: string }) => {
    await schedule(cron, action, { ...(opts.tz ? { timezone: opts.tz } : {}) })
  })

cli.command('status', 'Show config, credentials list, and recent sync history').action(async () => {
  await status()
})

cli.help()
cli.version('0.0.1')

async function main() {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
}

main().catch((err: Error) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
