import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { ActivityRef, FetchedActivity, ListOptions, SourceAdapter } from '@sweatrelay/core'
import { parseFit } from '@sweatrelay/core'

const SUPPORTED = new Set(['.fit', '.gpx', '.tcx'])

export interface FolderAdapterOptions {
  /** Directory to scan for activity files. */
  dir: string
  /** Override the adapter id (default: 'folder'). */
  id?: string
  /** Override the display name (default: 'Local folder'). */
  displayName?: string
}

/**
 * SourceAdapter that lists FIT/GPX/TCX files in a folder. Useful for
 * `sweatrelay sync folder --dir <path>` (one-shot upload of an existing batch),
 * separately from the FileWatcherTrigger which handles "new file arrives" live.
 */
export class FolderAdapter implements SourceAdapter {
  readonly id: string
  readonly displayName: string
  private readonly opts: FolderAdapterOptions

  constructor(opts: FolderAdapterOptions) {
    this.opts = opts
    this.id = opts.id ?? 'folder'
    this.displayName = opts.displayName ?? 'Local folder'
  }

  async *list(opts?: ListOptions): AsyncIterable<ActivityRef> {
    const files = await listSupportedFiles(this.opts.dir)
    let count = 0
    for (const file of files) {
      if (opts?.limit && count >= opts.limit) break
      const stats = await stat(file)
      if (opts?.since && stats.mtime < opts.since) continue
      if (opts?.until && stats.mtime > opts.until) continue
      const ext = extname(file).slice(1) as 'fit' | 'gpx' | 'tcx'
      yield {
        sourceId: `${this.id}:${file}`,
        startTime: stats.mtime,
        meta: { path: file, format: ext },
      }
      count++
    }
  }

  async fetch(ref: ActivityRef): Promise<FetchedActivity> {
    const path = (ref.meta?.path as string) ?? ref.sourceId.replace(/^[^:]+:/, '')
    const format = ((ref.meta?.format as string) ?? 'fit') as 'fit' | 'gpx' | 'tcx'
    const bytes = await readFile(path)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (format === 'fit') {
      const activity = parseFit(bytes, { sourceId: ref.sourceId, rawFilePath: path })
      return { activity, file: { bytes, format, suggestedName: basename(path) } }
    }
    return {
      activity: {
        sourceId: ref.sourceId,
        sport: 'other',
        startTime: ref.startTime,
        durationSec: 0,
        samples: [],
        meta: { path, format },
        rawFile: { path, format, sha256, bytes: bytes.length },
      },
      file: { bytes, format, suggestedName: basename(path) },
    }
  }
}

async function listSupportedFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = extname(entry.name).toLowerCase()
    if (SUPPORTED.has(ext)) out.push(join(dir, entry.name))
  }
  return out.sort()
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
