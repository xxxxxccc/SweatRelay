declare module '@garmin/fitsdk' {
  /** Garmin FIT SDK — minimal type stubs for the API surface SweatRelay uses. */
  // biome-ignore lint/complexity/noStaticOnlyClass: ambient stub mirroring upstream class API
  export class Stream {
    static fromByteArray(bytes: Uint8Array | Buffer): Stream
    static fromBuffer(buffer: Buffer): Stream
  }

  export interface DecodeResult {
    messages: FitMessages
    errors: Error[]
  }

  export class Decoder {
    constructor(stream: Stream)
    isFIT(): boolean
    checkIntegrity(): boolean
    read(opts?: {
      mesgListener?: (mesgNum: number, mesg: unknown) => void
      applyScaleAndOffset?: boolean
      expandSubFields?: boolean
      expandComponents?: boolean
      convertTypesToStrings?: boolean
      convertDateTimesToDates?: boolean
      includeUnknownFields?: boolean
      mergeHeartRates?: boolean
    }): DecodeResult
  }

  /** A loose typing of the message map; FIT has many message types we don't all need. */
  export interface FitMessages {
    sessionMesgs?: FitSessionMesg[]
    recordMesgs?: FitRecordMesg[]
    lapMesgs?: FitLapMesg[]
    activityMesgs?: FitActivityMesg[]
    fileIdMesgs?: FitFileIdMesg[]
    [key: string]: unknown
  }

  export interface FitSessionMesg {
    startTime?: Date
    timestamp?: Date
    sport?: string
    subSport?: string
    totalElapsedTime?: number
    totalTimerTime?: number
    totalDistance?: number
    totalAscent?: number
    avgPower?: number
    normalizedPower?: number
    trainingStressScore?: number
    avgHeartRate?: number
    maxHeartRate?: number
    avgCadence?: number
    [key: string]: unknown
  }

  export interface FitRecordMesg {
    timestamp?: Date
    positionLat?: number
    positionLong?: number
    altitude?: number
    enhancedAltitude?: number
    distance?: number
    speed?: number
    enhancedSpeed?: number
    heartRate?: number
    cadence?: number
    power?: number
    temperature?: number
    [key: string]: unknown
  }

  export interface FitLapMesg {
    startTime?: Date
    totalElapsedTime?: number
    totalDistance?: number
    [key: string]: unknown
  }

  export interface FitActivityMesg {
    timestamp?: Date
    [key: string]: unknown
  }

  export interface FitFileIdMesg {
    type?: string
    manufacturer?: string
    product?: string
    timeCreated?: Date
    [key: string]: unknown
  }

  /** Re-exported as a namespace for callers who want `Profile.MesgNum`. */
  export const Profile: {
    MesgNum: Record<string, number>
    Field: Record<string, unknown>
  }
}
