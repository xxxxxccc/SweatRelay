import type { Activity, Sport } from '../activity/Activity.ts'

export interface ActivityRef {
  sourceId: string
  startTime: Date
  sport?: Sport
  /** Hint to the adapter for fetching (URL, key, etc.). Opaque to consumers. */
  meta?: Record<string, unknown>
}

export interface FetchedActivity {
  activity: Activity
  /** Raw file bytes if the source provides them (FIT/GPX/TCX). */
  file?: { bytes: Buffer; format: 'fit' | 'gpx' | 'tcx'; suggestedName?: string }
}

export interface ListOptions {
  since?: Date
  until?: Date
  limit?: number
}

export interface SourceAdapter {
  readonly id: string
  readonly displayName: string
  list(opts?: ListOptions): AsyncIterable<ActivityRef>
  fetch(ref: ActivityRef): Promise<FetchedActivity>
}
