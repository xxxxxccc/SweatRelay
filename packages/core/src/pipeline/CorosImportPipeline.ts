import type { ListOptions, SourceAdapter } from '../adapters/SourceAdapter.ts'
import type { SyncedStore, SyncRecord } from '../state/SyncedStore.ts'
import type { CorosImportResult, CorosUploader } from '../uploader/CorosUploader.ts'
import { SweatRelayError } from '../util/errors.ts'

export interface CorosImportPipelineOptions {
  uploader: CorosUploader
  store: SyncedStore
  adapter: SourceAdapter
}

export type CorosImportOutcome =
  | { kind: 'imported'; key: string; result: CorosImportResult }
  | { kind: 'skipped-already-imported'; record: SyncRecord }
  | { kind: 'error'; error: Error; key?: string }

export class CorosImportPipeline {
  private readonly opts: CorosImportPipelineOptions

  constructor(opts: CorosImportPipelineOptions) {
    this.opts = opts
  }

  async handleAdapterPull(
    opts: ListOptions & { defaultSince?: Date | null } = {},
  ): Promise<CorosImportOutcome[]> {
    const outcomes: CorosImportOutcome[] = []
    const { defaultSince, ...listOptions } = opts
    for await (const ref of this.opts.adapter.list({
      ...listOptions,
      since: opts.since ?? (defaultSince === null ? undefined : (defaultSince ?? startOfToday())),
    })) {
      const key = `coros:${ref.sourceId}`
      const existing = await this.opts.store.get(key)
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
              `COROS import supports FIT/TCX for now, got ${fetched.file.format}`,
            ),
            key,
          })
          continue
        }
        const result = await this.opts.uploader.upload(fetched.file.bytes, {
          dataType: fetched.file.format,
          filename: fetched.file.suggestedName,
        })
        await this.opts.store.add({
          key,
          source: `${this.opts.adapter.id}:coros`,
          syncedAt: new Date().toISOString(),
        })
        outcomes.push({ kind: 'imported', key, result })
      } catch (err) {
        outcomes.push({ kind: 'error', error: err as Error, key })
      }
    }
    return outcomes
  }
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
