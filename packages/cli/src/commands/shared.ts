import type { SyncOutcome } from '@sweatrelay/core'

export function reportOutcome(outcome: SyncOutcome): void {
  switch (outcome.kind) {
    case 'uploaded':
      console.log(`✓ Uploaded → ${outcome.record.activityUrl}`)
      break
    case 'duplicate':
      console.log(
        `↻ Already on Strava (duplicate of activity ${outcome.activityId ?? '?'}) — recorded.`,
      )
      break
    case 'skipped-already-synced':
      console.log(`✓ Already synced → ${outcome.record.activityUrl ?? outcome.record.key}`)
      break
    case 'error':
      console.error(`✗ Error${outcome.key ? ` for ${outcome.key}` : ''}: ${outcome.error.message}`)
      process.exitCode = 1
      break
  }
}

export function reportOutcomes(outcomes: SyncOutcome[]): void {
  for (const o of outcomes) reportOutcome(o)
}
