import type { ListOptions, SourceAdapter } from '../adapters/SourceAdapter.ts'
import type { SyncedStore, SyncRecord } from '../state/SyncedStore.ts'
import type { GarminImportResult, GarminUploader } from '../uploader/GarminUploader.ts'
import { GarminDuplicateImportError, SweatRelayError } from '../util/errors.ts'

export interface GarminImportPipelineOptions {
  uploader: GarminUploader
  store: SyncedStore
  adapter: SourceAdapter
}

export type GarminImportOutcome =
  | { kind: 'imported'; key: string; result: GarminImportResult }
  | { kind: 'skipped-already-imported'; record: SyncRecord }
  | { kind: 'skipped-duplicate'; key: string; message: string }
  | { kind: 'error'; error: Error; key?: string }

export class GarminImportPipeline {
  private readonly opts: GarminImportPipelineOptions

  constructor(opts: GarminImportPipelineOptions) {
    this.opts = opts
  }

  async handleAdapterPull(
    opts: ListOptions & { defaultSince?: Date | null } = {},
  ): Promise<GarminImportOutcome[]> {
    const outcomes: GarminImportOutcome[] = []
    const domain = await this.opts.uploader.currentDomain()
    const { defaultSince, ...listOptions } = opts
    for await (const ref of this.opts.adapter.list({
      ...listOptions,
      since: opts.since ?? (defaultSince === null ? undefined : (defaultSince ?? startOfToday())),
    })) {
      const key = `garmin:${domain}:${ref.sourceId}`
      const existing =
        (await getConfirmedGarminRecord(this.opts.store, key, domain)) ??
        (await getConfirmedGarminRecord(this.opts.store, `garmin:${ref.sourceId}`, domain))
      if (existing) {
        outcomes.push({ kind: 'skipped-already-imported', record: existing })
        continue
      }
      try {
        const fetched = await this.opts.adapter.fetch(ref)
        if (!fetched.file) {
          outcomes.push({
            kind: 'error',
            error: new SweatRelayError(
              `Adapter ${this.opts.adapter.id} returned no file for ${ref.sourceId}`,
            ),
            key,
          })
          continue
        }
        if (fetched.file.format !== 'fit' && fetched.file.format !== 'tcx') {
          outcomes.push({
            kind: 'error',
            error: new SweatRelayError(
              `Garmin upload supports FIT/TCX for now, got ${fetched.file.format}`,
            ),
            key,
          })
          continue
        }
        const result = await this.opts.uploader.upload(fetched.file.bytes, {
          dataType: fetched.file.format,
          filename: fetched.file.suggestedName,
        })
        const activityId = parseActivityId(result.activityId)
        await this.opts.store.add({
          key,
          source: `${this.opts.adapter.id}:garmin:${result.domain}`,
          syncedAt: new Date().toISOString(),
          ...(activityId !== undefined ? { activityId } : {}),
          ...(result.activityId
            ? {
                activityUrl: `https://connect.${result.domain}/modern/activity/${result.activityId}`,
              }
            : {}),
        })
        outcomes.push({ kind: 'imported', key, result })
      } catch (err) {
        if (err instanceof GarminDuplicateImportError) {
          const activityId = parseActivityId(err.activityId)
          await this.opts.store.add({
            key,
            source: `${this.opts.adapter.id}:garmin:${domain}`,
            syncedAt: new Date().toISOString(),
            ...(activityId !== undefined ? { activityId } : {}),
            ...(err.activityId
              ? {
                  activityUrl: `https://connect.${domain}/modern/activity/${err.activityId}`,
                }
              : {}),
          })
          outcomes.push({ kind: 'skipped-duplicate', key, message: err.message })
          continue
        }
        outcomes.push({ kind: 'error', error: err as Error, key })
      }
    }
    return outcomes
  }
}

async function getConfirmedGarminRecord(
  store: SyncedStore,
  key: string,
  domain: string,
): Promise<SyncRecord | null> {
  const record = await store.get(key)
  if (!record) return null
  if (record.activityUrl) {
    return record.activityUrl.includes(`connect.${domain}/`) ? record : null
  }
  if (record.activityId !== undefined && record.source.endsWith(`:garmin:${domain}`)) {
    return record
  }
  return null
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function parseActivityId(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}
