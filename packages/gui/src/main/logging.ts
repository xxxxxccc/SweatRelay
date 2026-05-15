import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CorosImportOutcome, GarminImportOutcome, SyncOutcome } from '@sweatrelay/core'
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

export function logCorosImportOutcomes(scope: string, outcomes: CorosImportOutcome[]): void {
  const counts = { imported: 0, skipped: 0, error: 0 }
  for (const o of outcomes) {
    if (o.kind === 'imported') counts.imported += 1
    else if (o.kind === 'skipped-already-imported') counts.skipped += 1
    else counts.error += 1
  }
  logApp(
    `${scope} outcomes imported=${counts.imported} skipped=${counts.skipped} error=${counts.error}`,
  )
  for (const outcome of outcomes) {
    if (outcome.kind !== 'error') continue
    logApp(
      `${scope} outcome-error${outcome.key ? ` key=${outcome.key}` : ''} ${formatError(outcome.error)}`,
    )
  }
}

export function logGarminImportOutcomes(scope: string, outcomes: GarminImportOutcome[]): void {
  const counts = { imported: 0, skipped: 0, duplicate: 0, error: 0 }
  for (const o of outcomes) {
    if (o.kind === 'imported') counts.imported += 1
    else if (o.kind === 'skipped-already-imported') counts.skipped += 1
    else if (o.kind === 'skipped-duplicate') counts.duplicate += 1
    else counts.error += 1
  }
  logApp(
    `${scope} outcomes imported=${counts.imported} skipped=${counts.skipped} duplicate=${counts.duplicate} error=${counts.error}`,
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
  if (err instanceof Error) {
    const details = errorDetails(err)
    const base = err.stack ?? `${err.name}: ${err.message}`
    return details ? `${base}\n${details}` : base
  }
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function errorDetails(err: Error): string {
  const record = err as Error & { status?: unknown; body?: unknown }
  const details: Record<string, unknown> = {}
  if (typeof record.status === 'number') details.status = record.status
  if (record.body !== undefined) details.body = record.body
  if (Object.keys(details).length === 0) return ''
  try {
    return `details=${JSON.stringify(details)}`
  } catch {
    return `details=${String(details)}`
  }
}
