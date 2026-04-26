import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SyncOutcome } from '@sweatrelay/core'
import { app } from 'electron'

const appLogName = 'app.log'

export function logApp(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  console.info('[app]', message)
  void writeAppLog(line)
}

export function logAppError(scope: string, err: unknown): void {
  logApp(`${scope} error ${formatError(err)}`)
}

export function logSyncOutcomes(scope: string, outcomes: SyncOutcome[]): void {
  const counts = countOutcomes(outcomes)
  logApp(
    `${scope} outcomes uploaded=${counts.uploaded} duplicate=${counts.duplicate} skipped=${counts.skipped} error=${counts.error}`,
  )

  for (const outcome of outcomes) {
    if (outcome.kind !== 'error') continue
    logApp(
      `${scope} outcome-error${outcome.key ? ` key=${outcome.key}` : ''} ${formatError(outcome.error)}`,
    )
  }
}

export function appLogPath(): string {
  return join(app.getPath('userData'), 'logs', appLogName)
}

async function writeAppLog(line: string): Promise<void> {
  try {
    const path = appLogPath()
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${line}\n`, 'utf8')
  } catch (err) {
    console.error('[app]', 'failed to write app log', err)
  }
}

function countOutcomes(outcomes: SyncOutcome[]): {
  uploaded: number
  duplicate: number
  skipped: number
  error: number
} {
  return outcomes.reduce(
    (counts, outcome) => {
      if (outcome.kind === 'skipped-already-synced') {
        counts.skipped += 1
      } else {
        counts[outcome.kind] += 1
      }
      return counts
    },
    { uploaded: 0, duplicate: 0, skipped: 0, error: 0 },
  )
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
