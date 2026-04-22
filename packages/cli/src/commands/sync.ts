import { resolve } from 'node:path'
import { BlackbirdFolderAdapter } from '@sweatrelay/adapter-blackbird'
import { FolderAdapter } from '@sweatrelay/adapter-folder'
import { MageneFolderAdapter } from '@sweatrelay/adapter-magene'
import { OnelapApiAdapter } from '@sweatrelay/adapter-onelap'
import { type SourceAdapter, SyncPipeline } from '@sweatrelay/core'
import { buildContext } from '../context.ts'
import { reportOutcomes } from './shared.ts'

export interface SyncOptions {
  since?: string
}

export interface FolderSyncOptions extends SyncOptions {
  dir: string
}

async function runWithAdapter(adapter: SourceAdapter): Promise<void> {
  const ctx = buildContext()
  const pipeline = new SyncPipeline({
    uploader: ctx.uploader,
    store: ctx.store,
    adapter,
  })
  const outcomes = await pipeline.handleAdapterPull()
  reportOutcomes(outcomes)
}

export async function syncOnelap(_opts: SyncOptions = {}): Promise<void> {
  const ctx = buildContext()
  await runWithAdapter(new OnelapApiAdapter({ credentials: ctx.credentials }))
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
