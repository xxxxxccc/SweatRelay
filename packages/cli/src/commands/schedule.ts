import { OnelapApiAdapter } from '@sweatrelay/adapter-onelap'
import { ScheduledTrigger, SyncPipeline } from '@sweatrelay/core'
import { buildContext } from '../context.ts'
import { reportOutcomes } from './shared.ts'

export interface ScheduleOptions {
  timezone?: string
}

/**
 * `sweatrelay schedule "<cron>" sync onelap`
 * Currently only supports `sync onelap` as the action — extend as needed.
 */
export async function schedule(
  cron: string,
  action: string,
  opts: ScheduleOptions = {},
): Promise<void> {
  if (action !== 'sync' && action !== 'sync-onelap') {
    throw new Error(`Unsupported scheduled action: ${action}. Try \`sync\` or \`sync onelap\`.`)
  }

  const ctx = buildContext()
  const adapter = new OnelapApiAdapter({ credentials: ctx.credentials })
  const pipeline = new SyncPipeline({
    uploader: ctx.uploader,
    store: ctx.store,
    adapter,
  })
  const trigger = new ScheduledTrigger({
    cron,
    ...(opts.timezone ? { timezone: opts.timezone } : {}),
  })

  await trigger.start(async (event) => {
    console.log(`\n[${new Date().toISOString()}] Scheduled fire (${event.kind})`)
    const outcomes = await pipeline.handle(event)
    reportOutcomes(outcomes)
  })

  console.log(`⏰ Scheduled "${cron}" → ${action}. Ctrl-C to stop.`)
  process.on('SIGINT', async () => {
    await trigger.stop()
    process.exit(0)
  })
}
