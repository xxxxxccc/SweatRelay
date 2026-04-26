import { resolve } from 'node:path'
import { BlackbirdFolderAdapter } from '@sweatrelay/adapter-blackbird'
import { FolderAdapter } from '@sweatrelay/adapter-folder'
import { MageneFolderAdapter } from '@sweatrelay/adapter-magene'
import { OnelapApiAdapter } from '@sweatrelay/adapter-onelap'
import { type SourceAdapter, SyncPipeline } from '@sweatrelay/core'
import { buildCredentialStore, buildPaths, buildUploader } from '../context.ts'
import { reportOutcomes } from './shared.ts'

export interface SyncOptions {
  since?: string
}

export interface FolderSyncOptions extends SyncOptions {
  dir: string
}

async function runWithAdapter(adapter: SourceAdapter): Promise<void> {
  const paths = buildPaths()
  const credentials = await buildCredentialStore(paths)
  const { uploader } = await buildUploader(paths, credentials)
  const pipeline = new SyncPipeline({
    uploader,
    store: paths.store,
    adapter,
  })
  const outcomes = await pipeline.handleAdapterPull()
  reportOutcomes(outcomes)
}

export async function syncOnelap(opts: SyncOptions = {}): Promise<void> {
  const paths = buildPaths()
  const credentials = await buildCredentialStore(paths)
  const { uploader } = await buildUploader(paths, credentials)
  const pipeline = new SyncPipeline({
    uploader,
    store: paths.store,
    adapter: new OnelapApiAdapter({ credentials }),
  })
  const since = parseSince(opts.since ?? 'today')
  const outcomes = await pipeline.handleAdapterPull(since ? { since } : { defaultSince: null })
  reportOutcomes(outcomes)
}

export async function syncMagene(opts: FolderSyncOptions): Promise<void> {
  await runWithAdapter(new MageneFolderAdapter({ dir: resolve(opts.dir) }))
}

export async function syncBlackbird(opts: FolderSyncOptions): Promise<void> {
  await runWithAdapter(new BlackbirdFolderAdapter({ dir: resolve(opts.dir) }))
}

export async function syncFolder(opts: FolderSyncOptions): Promise<void> {
  await runWithAdapter(new FolderAdapter({ dir: resolve(opts.dir) }))
}

function parseSince(value: string): Date | undefined {
  if (value === 'all') return undefined
  if (value === 'today') return startOfLocalDay(new Date())

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new Error(`Invalid --since value: ${value}. Use today, all, or YYYY-MM-DD.`)
  }

  const [, year, month, day] = match
  const since = new Date(Number(year), Number(month) - 1, Number(day))
  if (
    since.getFullYear() !== Number(year) ||
    since.getMonth() !== Number(month) - 1 ||
    since.getDate() !== Number(day)
  ) {
    throw new Error(`Invalid --since date: ${value}. Use today, all, or YYYY-MM-DD.`)
  }
  return since
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}
