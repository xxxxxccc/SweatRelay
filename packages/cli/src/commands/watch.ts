import { resolve } from 'node:path'
import { FileWatcherTrigger, SyncPipeline } from '@sweatrelay/core'
import { buildCredentialStore, buildPaths, buildUploader } from '../context.ts'
import { reportOutcomes } from './shared.ts'

export interface WatchOptions {
  processExisting?: boolean
}

export async function watchDir(dir: string, opts: WatchOptions = {}): Promise<void> {
  const paths = buildPaths()
  const credentials = await buildCredentialStore(paths)
  const { uploader } = await buildUploader(paths, credentials)
  const abs = resolve(dir)
  const pipeline = new SyncPipeline({ uploader, store: paths.store })
  const trigger = new FileWatcherTrigger({
    paths: abs,
    ...(opts.processExisting !== undefined ? { processExisting: opts.processExisting } : {}),
  })

  await trigger.start(async (event) => {
    const outcomes = await pipeline.handle(event)
    reportOutcomes(outcomes)
  })

  console.log(`👀 Watching ${abs} for new .fit/.gpx/.tcx files. Ctrl-C to stop.`)
  process.on('SIGINT', async () => {
    await trigger.stop()
    process.exit(0)
  })
}
