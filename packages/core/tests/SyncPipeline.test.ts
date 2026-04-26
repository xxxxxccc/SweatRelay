import { describe, expect, it } from 'vitest'
import type { ActivityRef, SourceAdapter } from '../src/adapters/SourceAdapter.ts'
import { SyncPipeline } from '../src/pipeline/SyncPipeline.ts'
import type { SyncedStore } from '../src/state/SyncedStore.ts'
import type { StravaUploader } from '../src/uploader/StravaUploader.ts'

describe('SyncPipeline', () => {
  it('passes explicit adapter pull filters through to the source adapter', async () => {
    const since = new Date('2026-04-01T00:00:00Z')
    const seen: unknown[] = []
    const adapter = makeAdapter((opts) => {
      seen.push(opts)
    })

    const pipeline = new SyncPipeline({
      adapter,
      store: makeStore(),
      uploader: makeUploader(),
    })

    await pipeline.handleAdapterPull({ since })

    expect(seen).toEqual([{ since }])
  })
})

function makeAdapter(onList: (opts: Parameters<SourceAdapter['list']>[0]) => void): SourceAdapter {
  return {
    id: 'test',
    displayName: 'Test',
    list(opts) {
      onList(opts)
      return [] as unknown as AsyncIterable<ActivityRef>
    },
    async fetch(ref: ActivityRef) {
      return {
        activity: {
          sourceId: ref.sourceId,
          sport: 'cycling',
          startTime: ref.startTime,
          durationSec: 1,
          samples: [],
          meta: {},
        },
        file: { bytes: Buffer.from('fit'), format: 'fit' },
      }
    },
  }
}

function makeStore(): SyncedStore {
  return {
    get: async () => null,
    add: async () => undefined,
  } as SyncedStore
}

function makeUploader(): StravaUploader {
  return {
    upload: async () => ({
      uploadId: '1',
      activityId: 1,
      activityUrl: 'https://www.strava.com/activities/1',
    }),
  } as StravaUploader
}
