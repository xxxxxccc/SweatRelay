export type Sport = 'cycling' | 'running' | 'other'

export type FileFormat = 'fit' | 'fit.gz' | 'gpx' | 'gpx.gz' | 'tcx' | 'tcx.gz'

export interface ActivitySample {
  /** Seconds since activity start. */
  t: number
  lat?: number
  lon?: number
  /** Meters. */
  altitude?: number
  /** Cumulative meters. */
  distance?: number
  /** Meters/second. */
  speed?: number
  /** Beats per minute. */
  hr?: number
  /** Revolutions per minute. */
  cadence?: number
  /** Watts. */
  power?: number
  /** Celsius. */
  temperature?: number
}

export interface ActivityLap {
  startTime: Date
  durationSec: number
  /** Meters. */
  distance?: number
}

export interface RawFile {
  path: string
  format: 'fit' | 'gpx' | 'tcx'
  sha256: string
  bytes: number
}

export interface Activity {
  /** Stable, source-scoped ID. e.g. "onelap:abc123" or "folder:<sha256>". */
  sourceId: string
  sport: Sport
  startTime: Date
  durationSec: number
  /** Meters. */
  distance?: number
  /** Meters. */
  elevationGain?: number
  avgPower?: number
  /** Normalized Power. */
  np?: number
  /** Training Stress Score. */
  tss?: number
  avgHr?: number
  maxHr?: number
  avgCadence?: number
  samples: ActivitySample[]
  laps?: ActivityLap[]
  rawFile?: RawFile
  /** Free-form per-source metadata. */
  meta: Record<string, unknown>
}
