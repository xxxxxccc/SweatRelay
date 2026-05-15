import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ActivityRef, SourceAdapter } from '../src/adapters/index.ts'
import { GarminImportPipeline } from '../src/pipeline/GarminImportPipeline.ts'
import { SyncedStore } from '../src/state/SyncedStore.ts'
import { GarminDomains, type GarminUploader } from '../src/uploader/GarminUploader.ts'

describe('GarminImportPipeline', () => {
  it('does not let legacy unconfirmed Garmin records block a domain-specific retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sweatrelay-garmin-pipeline-'))
    const store = new SyncedStore({ path: join(dir, 'synced.sqlite') })
    await store.add({
      key: 'garmin:onelap:ride-1',
      source: 'onelap:garmin',
      syncedAt: '2026-05-15T02:55:19.714Z',
    })

    let uploads = 0
    const uploader = {
      currentDomain: async () => GarminDomains.china,
      upload: async () => {
        uploads += 1
        return {
          domain: GarminDomains.china,
          activityId: '8888',
          filename: 'ride.fit',
        }
      },
    } as unknown as GarminUploader

    const pipeline = new GarminImportPipeline({
      uploader,
      store,
      adapter: fakeAdapter(),
    })

    const outcomes = await pipeline.handleAdapterPull({ defaultSince: null })

    expect(uploads).toBe(1)
    expect(outcomes).toMatchObject([{ kind: 'imported', key: 'garmin:garmin.cn:onelap:ride-1' }])
    await expect(store.get('garmin:garmin.cn:onelap:ride-1')).resolves.toMatchObject({
      activityId: 8888,
      activityUrl: 'https://connect.garmin.cn/modern/activity/8888',
      source: 'onelap:garmin:garmin.cn',
    })
    await store.close()
  })
})

function fakeAdapter(): SourceAdapter {
  const ref: ActivityRef = {
    sourceId: 'onelap:ride-1',
    startTime: new Date('2026-05-15T02:00:00Z'),
  }
  return {
    id: 'onelap',
    displayName: 'Onelap',
    async *list() {
      yield ref
    },
    async fetch() {
      return {
        activity: {
          sourceId: ref.sourceId,
          sport: 'cycling',
          startTime: ref.startTime,
          durationSec: 1800,
          samples: [],
          meta: { name: 'Ride' },
        },
        file: {
          bytes: Buffer.from('fake-fit'),
          format: 'fit',
          suggestedName: 'ride.fit',
        },
      }
    },
  }
}
