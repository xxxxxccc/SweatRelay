import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SourceAdapter } from '../adapters/SourceAdapter.ts'
import type { SyncedStore, SyncRecord } from '../state/SyncedStore.ts'
import type { TriggerEvent } from '../triggers/Trigger.ts'
import type { StravaUploader } from '../uploader/StravaUploader.ts'
import { DuplicateActivityError, SweatRelayError } from '../util/errors.ts'

export interface SyncPipelineOptions {
  uploader: StravaUploader
  store: SyncedStore
  /** Optional named adapter, used when trigger is `manual` or `scheduled`. */
  adapter?: SourceAdapter
  /** Source label for file-based events. Default: 'folder'. */
  fileSource?: string
}

export type SyncOutcome =
  | { kind: 'uploaded'; record: SyncRecord }
  | { kind: 'duplicate'; key: string; activityId?: number }
  | { kind: 'skipped-already-synced'; record: SyncRecord }
  | { kind: 'error'; error: Error; key?: string }

export class SyncPipeline {
  private readonly opts: SyncPipelineOptions

  constructor(opts: SyncPipelineOptions) {
    this.opts = opts
  }

  /** Handle one trigger event end-to-end. Never throws — returns SyncOutcome. */
  async handle(event: TriggerEvent): Promise<SyncOutcome[]> {
    try {
      switch (event.kind) {
        case 'file':
          return [await this.handleFile(event.path, event.format)]
        case 'manual':
        case 'scheduled':
          return await this.handleAdapterPull()
      }
    } catch (err) {
      return [{ kind: 'error', error: err as Error }]
    }
  }

  /** Upload a single file by path. Used by `cli upload <path>` and watch trigger. */
  async handleFile(path: string, format: 'fit' | 'gpx' | 'tcx'): Promise<SyncOutcome> {
    const bytes = await readFile(path)
    const sha = createHash('sha256').update(bytes).digest('hex')
    const key = `sha256:${sha}`
    const existing = await this.opts.store.get(key)
    if (existing) return { kind: 'skipped-already-synced', record: existing }

    const source = this.opts.fileSource ?? 'folder'
    return this.uploadAndRecord({
      key,
      bytes,
      dataType: format,
      source,
      externalId: `sweatrelay:${sha.slice(0, 16)}`,
      name: deriveName(path),
    })
  }

  /** Pull recent activities from the configured adapter and upload each. */
  async handleAdapterPull(): Promise<SyncOutcome[]> {
    const adapter = this.opts.adapter
    if (!adapter) {
      throw new SweatRelayError('SyncPipeline.handleAdapterPull called without an adapter')
    }
    const outcomes: SyncOutcome[] = []
    for await (const ref of adapter.list({ since: startOfToday() })) {
      const key = ref.sourceId
      const existing = await this.opts.store.get(key)
      if (existing) {
        outcomes.push({ kind: 'skipped-already-synced', record: existing })
        continue
      }
      try {
        const fetched = await adapter.fetch(ref)
        if (!fetched.file) {
          outcomes.push({
            kind: 'error',
            error: new SweatRelayError(`Adapter ${adapter.id} returned no file for ${key}`),
            key,
          })
          continue
        }
        const dataType = fetched.file.format
        outcomes.push(
          await this.uploadAndRecord({
            key,
            bytes: fetched.file.bytes,
            dataType,
            source: adapter.id,
            externalId: ref.sourceId,
            name: fetched.activity.meta.name as string | undefined,
          }),
        )
      } catch (err) {
        outcomes.push({ kind: 'error', error: err as Error, key })
      }
    }
    return outcomes
  }

  private async uploadAndRecord(args: {
    key: string
    bytes: Buffer
    dataType: 'fit' | 'gpx' | 'tcx' | 'fit.gz' | 'gpx.gz' | 'tcx.gz'
    source: string
    externalId?: string
    name?: string
  }): Promise<SyncOutcome> {
    try {
      const result = await this.opts.uploader.upload(args.bytes, {
        dataType: args.dataType,
        externalId: args.externalId,
        name: args.name,
      })
      const record: SyncRecord = {
        key: args.key,
        activityId: result.activityId,
        activityUrl: result.activityUrl,
        source: args.source,
        syncedAt: new Date().toISOString(),
      }
      await this.opts.store.add(record)
      return { kind: 'uploaded', record }
    } catch (err) {
      if (err instanceof DuplicateActivityError) {
        const record: SyncRecord = {
          key: args.key,
          ...(err.existingActivityId
            ? {
                activityId: err.existingActivityId,
                activityUrl: `https://www.strava.com/activities/${err.existingActivityId}`,
              }
            : {}),
          source: args.source,
          syncedAt: new Date().toISOString(),
        }
        await this.opts.store.add(record)
        return {
          kind: 'duplicate',
          key: args.key,
          ...(err.existingActivityId !== undefined ? { activityId: err.existingActivityId } : {}),
        }
      }
      throw err
    }
  }
}

function deriveName(path: string): string {
  return basename(path).replace(/\.(fit|gpx|tcx)(\.gz)?$/i, '')
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
