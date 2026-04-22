import { extname } from 'node:path'
import type { FileFormat } from '../activity/Activity.ts'

export { type ParseFitOptions, parseFit } from './fit.ts'

/** Map a file extension to a Strava data_type, including .gz variants. */
export function detectFormat(path: string): FileFormat | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.fit.gz')) return 'fit.gz'
  if (lower.endsWith('.gpx.gz')) return 'gpx.gz'
  if (lower.endsWith('.tcx.gz')) return 'tcx.gz'
  const ext = extname(lower).slice(1)
  if (ext === 'fit' || ext === 'gpx' || ext === 'tcx') return ext
  return null
}
