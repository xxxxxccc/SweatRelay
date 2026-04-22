/// <reference path="./garmin-fitsdk.d.ts" />
import { createHash } from 'node:crypto'
import { Decoder, Stream } from '@garmin/fitsdk'
import type { Activity, ActivityLap, ActivitySample, RawFile, Sport } from '../activity/Activity.ts'
import { SweatRelayError } from '../util/errors.ts'

export interface ParseFitOptions {
  /** Source-scoped activity id, used as Activity.sourceId. */
  sourceId: string
  /** Original file path on disk (kept for reference, not read here). */
  rawFilePath?: string
}

export function parseFit(bytes: Buffer, opts: ParseFitOptions): Activity {
  const stream = Stream.fromBuffer(bytes)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT()) {
    throw new SweatRelayError('Not a valid FIT file')
  }
  const result = decoder.read({
    applyScaleAndOffset: true,
    convertDateTimesToDates: true,
    expandSubFields: true,
    expandComponents: true,
    mergeHeartRates: true,
  })
  if (result.errors.length > 0) {
    // Log but don't fail — partial decode is usually still useful.
    for (const err of result.errors) console.warn('[parseFit]', err.message)
  }

  const session = result.messages.sessionMesgs?.[0]
  const records = result.messages.recordMesgs ?? []
  const laps = result.messages.lapMesgs ?? []

  const startTime = session?.startTime ?? records[0]?.timestamp ?? new Date(0)
  const durationSec =
    session?.totalElapsedTime ?? session?.totalTimerTime ?? estimateDurationSec(records)

  const samples: ActivitySample[] = records.map((r) => {
    const ts = r.timestamp instanceof Date ? r.timestamp.getTime() : 0
    const t = (ts - startTime.getTime()) / 1000
    const sample: ActivitySample = { t }
    if (typeof r.positionLat === 'number') sample.lat = semicirclesToDeg(r.positionLat)
    if (typeof r.positionLong === 'number') sample.lon = semicirclesToDeg(r.positionLong)
    const altitude = r.enhancedAltitude ?? r.altitude
    if (typeof altitude === 'number') sample.altitude = altitude
    if (typeof r.distance === 'number') sample.distance = r.distance
    const speed = r.enhancedSpeed ?? r.speed
    if (typeof speed === 'number') sample.speed = speed
    if (typeof r.heartRate === 'number') sample.hr = r.heartRate
    if (typeof r.cadence === 'number') sample.cadence = r.cadence
    if (typeof r.power === 'number') sample.power = r.power
    if (typeof r.temperature === 'number') sample.temperature = r.temperature
    return sample
  })

  const lapEntries: ActivityLap[] = laps
    .filter((l): l is typeof l & { startTime: Date } => l.startTime instanceof Date)
    .map((l) => {
      const lap: ActivityLap = {
        startTime: l.startTime,
        durationSec: l.totalElapsedTime ?? 0,
      }
      if (typeof l.totalDistance === 'number') lap.distance = l.totalDistance
      return lap
    })

  const rawFile: RawFile | undefined = opts.rawFilePath
    ? {
        path: opts.rawFilePath,
        format: 'fit',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      }
    : undefined

  const activity: Activity = {
    sourceId: opts.sourceId,
    sport: mapSport(session?.sport),
    startTime,
    durationSec,
    samples,
    meta: {
      manufacturer: result.messages.fileIdMesgs?.[0]?.manufacturer,
      product: result.messages.fileIdMesgs?.[0]?.product,
      subSport: session?.subSport,
    },
  }
  if (typeof session?.totalDistance === 'number') activity.distance = session.totalDistance
  if (typeof session?.totalAscent === 'number') activity.elevationGain = session.totalAscent
  if (typeof session?.avgPower === 'number') activity.avgPower = session.avgPower
  if (typeof session?.normalizedPower === 'number') activity.np = session.normalizedPower
  if (typeof session?.trainingStressScore === 'number') activity.tss = session.trainingStressScore
  if (typeof session?.avgHeartRate === 'number') activity.avgHr = session.avgHeartRate
  if (typeof session?.maxHeartRate === 'number') activity.maxHr = session.maxHeartRate
  if (typeof session?.avgCadence === 'number') activity.avgCadence = session.avgCadence
  if (lapEntries.length > 0) activity.laps = lapEntries
  if (rawFile) activity.rawFile = rawFile
  return activity
}

function mapSport(s?: string): Sport {
  if (!s) return 'other'
  const lower = s.toLowerCase()
  if (lower.includes('cycl') || lower === 'biking') return 'cycling'
  if (lower.includes('run')) return 'running'
  return 'other'
}

function semicirclesToDeg(sc: number): number {
  return (sc * 180) / 2 ** 31
}

function estimateDurationSec(records: Array<{ timestamp?: Date }>): number {
  if (records.length < 2) return 0
  const first = records[0]?.timestamp
  const last = records[records.length - 1]?.timestamp
  if (!(first instanceof Date) || !(last instanceof Date)) return 0
  return Math.max(0, (last.getTime() - first.getTime()) / 1000)
}
