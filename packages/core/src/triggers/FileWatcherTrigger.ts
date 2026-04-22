import { extname } from 'node:path'
import { type FSWatcher, watch } from 'chokidar'
import type { Trigger, TriggerHandler } from './Trigger.ts'

export interface FileWatcherTriggerOptions {
  /** Directory or glob to watch. */
  paths: string | string[]
  /** Re-process files that already exist when the watcher starts. Default false. */
  processExisting?: boolean
  /** Wait for write to settle (chokidar awaitWriteFinish). Default 2000ms stability. */
  stableMs?: number
}

const SUPPORTED = new Set(['.fit', '.gpx', '.tcx'])

export class FileWatcherTrigger implements Trigger {
  private watcher: FSWatcher | null = null

  private readonly opts: FileWatcherTriggerOptions

  constructor(opts: FileWatcherTriggerOptions) {
    this.opts = opts
  }

  async start(handler: TriggerHandler): Promise<void> {
    const stableMs = this.opts.stableMs ?? 2000
    this.watcher = watch(this.opts.paths, {
      ignoreInitial: !this.opts.processExisting,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: stableMs, pollInterval: 200 },
    })

    this.watcher.on('add', async (path) => {
      const ext = extname(path).toLowerCase()
      if (!SUPPORTED.has(ext)) return
      const format = ext.slice(1) as 'fit' | 'gpx' | 'tcx'
      try {
        await handler({ kind: 'file', path, format })
      } catch (err) {
        console.error(`[FileWatcherTrigger] handler error for ${path}:`, err)
      }
    })

    const watcher = this.watcher
    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', resolve)
      watcher.once('error', reject)
    })
  }

  async stop(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }
}
