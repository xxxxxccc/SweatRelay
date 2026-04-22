import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SyncedStore } from '../src/state/SyncedStore.ts'

describe('SyncedStore (sqlite)', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sweatrelay-store-'))
    path = join(dir, 'synced.sqlite')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists and reloads records across instances', async () => {
    const a = new SyncedStore({ path })
    await a.add({
      key: 'sha256:abc',
      activityId: 1,
      activityUrl: 'https://www.strava.com/activities/1',
      source: 'folder',
      syncedAt: '2026-04-22T10:00:00Z',
    })
    expect(await a.has('sha256:abc')).toBe(true)
    await a.close()

    const b = new SyncedStore({ path })
    expect(await b.has('sha256:abc')).toBe(true)
    expect((await b.get('sha256:abc'))?.activityId).toBe(1)
    await b.close()
  })

  it('returns records sorted newest first', async () => {
    const s = new SyncedStore({ path })
    await s.add({ key: 'k1', source: 'x', syncedAt: '2026-04-20T00:00:00Z' })
    await s.add({ key: 'k2', source: 'x', syncedAt: '2026-04-22T00:00:00Z' })
    await s.add({ key: 'k3', source: 'x', syncedAt: '2026-04-21T00:00:00Z' })
    const list = await s.list()
    expect(list.map((r) => r.key)).toEqual(['k2', 'k3', 'k1'])
    await s.close()
  })

  it('upserts on duplicate key', async () => {
    const s = new SyncedStore({ path })
    await s.add({ key: 'k1', source: 'a', syncedAt: '2026-04-20T00:00:00Z' })
    await s.add({
      key: 'k1',
      source: 'b',
      activityId: 99,
      syncedAt: '2026-04-22T00:00:00Z',
    })
    const got = await s.get('k1')
    expect(got?.source).toBe('b')
    expect(got?.activityId).toBe(99)
    await s.close()
  })

  it('imports a legacy synced.json on first open and renames it aside', async () => {
    const legacy = join(dir, 'synced.json')
    await writeFile(
      legacy,
      JSON.stringify({
        v: 1,
        records: [
          {
            key: 'legacy-1',
            activityId: 7,
            activityUrl: 'https://www.strava.com/activities/7',
            source: 'onelap',
            syncedAt: '2026-04-01T00:00:00Z',
          },
        ],
      }),
    )

    const s = new SyncedStore({ path, legacyJsonPath: legacy })
    expect(await s.has('legacy-1')).toBe(true)
    await s.close()

    // Legacy file should be moved aside
    await expect(readFile(legacy, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const moved = await readFile(`${legacy}.imported`, 'utf8')
    expect(JSON.parse(moved)).toMatchObject({ v: 1 })
  })
})
