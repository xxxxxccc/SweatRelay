import { mkdir, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite'
import { dynamicRequire } from '../util/dynamicRequire.ts'

// node:sqlite is a brand-new built-in (Node 22.5+ experimental, 24+ stable).
// Tools like Vite/Vitest may not yet know about it, so we load it via
// createRequire to bypass their static analysis.
const { DatabaseSync } = dynamicRequire()('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncT
}

export interface SyncRecord {
  /** Composite key: `<sourceId>` (preferred) or `sha256:<hash>` for file-only sources. */
  key: string
  /** Strava activity URL once known. */
  activityUrl?: string
  /** Strava activity numeric id once known. */
  activityId?: number
  /** ISO timestamp of when the sync completed. */
  syncedAt: string
  /** Source name (adapter id). */
  source: string
}

export interface SyncedStoreOptions {
  /** Path to the SQLite file. */
  path: string
  /**
   * If a legacy JSON file exists at this path, import its records on first
   * open and rename it aside. Default: same dirname, basename "synced.json".
   */
  legacyJsonPath?: string
}

interface LegacyJsonShape {
  v: 1
  records: SyncRecord[]
}

/**
 * SQLite-backed sync history store. Uses Node 24+ built-in `node:sqlite` so
 * there are no native modules to ship — works inside SEA binaries unchanged.
 *
 * Schema:
 *   sync_records(key TEXT PRIMARY KEY, activity_id INTEGER, activity_url TEXT,
 *                synced_at TEXT NOT NULL, source TEXT NOT NULL)
 */
export class SyncedStore {
  private readonly opts: SyncedStoreOptions
  private db: DatabaseSyncT | null = null
  private initPromise: Promise<void> | null = null

  constructor(opts: SyncedStoreOptions) {
    this.opts = opts
  }

  async has(key: string): Promise<boolean> {
    const db = await this.getDb()
    const row = db.prepare('SELECT 1 FROM sync_records WHERE key = ? LIMIT 1').get(key)
    return row !== undefined
  }

  async get(key: string): Promise<SyncRecord | null> {
    const db = await this.getDb()
    const row = db
      .prepare('SELECT * FROM sync_records WHERE key = ? LIMIT 1')
      .get(key) as unknown as RawRow | undefined
    return row ? rowToRecord(row) : null
  }

  async add(record: SyncRecord): Promise<void> {
    const db = await this.getDb()
    db.prepare(
      `INSERT INTO sync_records (key, activity_id, activity_url, synced_at, source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           activity_id = excluded.activity_id,
           activity_url = excluded.activity_url,
           synced_at = excluded.synced_at,
           source = excluded.source`,
    ).run(
      record.key,
      record.activityId ?? null,
      record.activityUrl ?? null,
      record.syncedAt,
      record.source,
    )
  }

  async list(): Promise<SyncRecord[]> {
    const db = await this.getDb()
    const rows = db
      .prepare('SELECT * FROM sync_records ORDER BY synced_at DESC')
      .all() as unknown as RawRow[]
    return rows.map(rowToRecord)
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
    this.initPromise = null
  }

  private async getDb(): Promise<DatabaseSyncT> {
    if (!this.initPromise) this.initPromise = this.init()
    await this.initPromise
    if (!this.db) throw new Error('SyncedStore database not initialized')
    return this.db
  }

  private async init(): Promise<void> {
    await mkdir(dirname(this.opts.path), { recursive: true })
    this.db = new DatabaseSync(this.opts.path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_records (
        key          TEXT PRIMARY KEY,
        activity_id  INTEGER,
        activity_url TEXT,
        synced_at    TEXT NOT NULL,
        source       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_records_synced_at
        ON sync_records (synced_at DESC);
    `)
    await this.maybeImportLegacyJson()
  }

  private async maybeImportLegacyJson(): Promise<void> {
    const legacy = this.opts.legacyJsonPath ?? `${this.opts.path.replace(/\.sqlite$/, '')}.json`
    let raw: string
    try {
      raw = await readFile(legacy, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    let parsed: LegacyJsonShape
    try {
      parsed = JSON.parse(raw) as LegacyJsonShape
    } catch {
      return
    }
    if (!Array.isArray(parsed.records)) return
    if (!this.db) throw new Error('SyncedStore database not initialized')

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO sync_records (key, activity_id, activity_url, synced_at, source)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const r of parsed.records) {
      insert.run(r.key, r.activityId ?? null, r.activityUrl ?? null, r.syncedAt, r.source)
    }
    // Move the legacy file aside so we don't re-import on every open.
    await rename(legacy, `${legacy}.imported`)
  }
}

interface RawRow {
  key: string
  activity_id: number | null
  activity_url: string | null
  synced_at: string
  source: string
}

function rowToRecord(row: RawRow): SyncRecord {
  const r: SyncRecord = {
    key: row.key,
    syncedAt: row.synced_at,
    source: row.source,
  }
  if (row.activity_id !== null) r.activityId = row.activity_id
  if (row.activity_url !== null) r.activityUrl = row.activity_url
  return r
}
