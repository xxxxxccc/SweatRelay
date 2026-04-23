import { resolve } from 'node:path'
import { detectFormat, SyncPipeline } from '@sweatrelay/core'
import { buildCredentialStore, buildPaths, buildUploader } from '../context.ts'
import { reportOutcome } from './shared.ts'

export async function uploadFile(filePath: string): Promise<void> {
  const paths = buildPaths()
  const credentials = await buildCredentialStore(paths)
  const { uploader } = await buildUploader(paths, credentials)
  const abs = resolve(filePath)
  const format = detectFormat(abs)
  if (!format) throw new Error(`Unsupported file extension: ${abs}`)
  if (format.endsWith('.gz'))
    throw new Error('Gzipped files not yet supported by the file path; pass a raw .fit/.gpx/.tcx')
  const pipeline = new SyncPipeline({ uploader, store: paths.store })
  const outcome = await pipeline.handleFile(abs, format as 'fit' | 'gpx' | 'tcx')
  reportOutcome(outcome)
}
