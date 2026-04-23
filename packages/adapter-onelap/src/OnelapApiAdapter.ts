import type {
  ActivityRef,
  CredentialStore,
  FetchedActivity,
  ListOptions,
  SourceAdapter,
} from '@sweatrelay/core'
import {
  ONELAP_ACCOUNT_KEY,
  ONELAP_PASSWORD_KEY,
  ONELAP_SESSION_KEY,
  parseFit,
  SweatRelayError,
} from '@sweatrelay/core'
import { OnelapApiClient, type OnelapSession, parseOnelapDate } from './OnelapApiClient.ts'

export interface OnelapApiAdapterOptions {
  credentials: CredentialStore
  /** Inject a custom client (for testing). */
  client?: OnelapApiClient
}

/**
 * SourceAdapter backed by Onelap's private mobile-app API.
 *
 * Reads account/password from the credential store and caches the session
 * triple (uid + XSRF-TOKEN + OTOKEN). Re-logs in on session-related failures.
 */
export class OnelapApiAdapter implements SourceAdapter {
  readonly id = 'onelap'
  readonly displayName = 'Onelap (顽鹿运动)'
  private readonly client: OnelapApiClient
  private readonly opts: OnelapApiAdapterOptions

  constructor(opts: OnelapApiAdapterOptions) {
    this.opts = opts
    this.client = opts.client ?? new OnelapApiClient()
  }

  async *list(opts?: ListOptions): AsyncIterable<ActivityRef> {
    const session = await this.ensureSession()
    const rows = await this.client.listActivities(session)
    let count = 0
    for (const row of rows) {
      if (opts?.limit && count >= opts.limit) break
      const startTime = parseOnelapDate(row.dateString)
      if (opts?.since && Number.isFinite(startTime.getTime()) && startTime < opts.since) continue
      if (opts?.until && Number.isFinite(startTime.getTime()) && startTime > opts.until) continue
      yield {
        sourceId: `onelap:${row.externalId}`,
        startTime,
        meta: { externalId: row.externalId, durl: row.durl, fileKey: row.fileKey },
      }
      count++
    }
  }

  async fetch(ref: ActivityRef): Promise<FetchedActivity> {
    const session = await this.ensureSession()
    const durl = ref.meta?.durl as string | undefined
    if (!durl) throw new SweatRelayError(`Onelap ref ${ref.sourceId} missing durl`)
    const bytes = await this.client.downloadFit(session, durl)
    const activity = parseFit(bytes, { sourceId: ref.sourceId })
    return {
      activity,
      file: { bytes, format: 'fit', suggestedName: `${ref.sourceId.replace(':', '_')}.fit` },
    }
  }

  /** Save credentials. Call this from `cli auth onelap`. */
  async saveCredentials(account: string, password: string): Promise<void> {
    await this.opts.credentials.set(ONELAP_ACCOUNT_KEY, account)
    await this.opts.credentials.set(ONELAP_PASSWORD_KEY, password)
    // Clear stale session so the next call re-logs in.
    await this.opts.credentials.delete(ONELAP_SESSION_KEY)
  }

  private async ensureSession(): Promise<OnelapSession> {
    const cached = await this.opts.credentials.get(ONELAP_SESSION_KEY)
    if (cached) {
      try {
        return JSON.parse(cached) as OnelapSession
      } catch {
        // fall through to re-login
      }
    }
    const account = await this.opts.credentials.get(ONELAP_ACCOUNT_KEY)
    const password = await this.opts.credentials.get(ONELAP_PASSWORD_KEY)
    if (!account || !password) {
      throw new SweatRelayError(
        'Onelap account/password not stored — run `sweatrelay auth onelap` first',
      )
    }
    const session = await this.client.login(account, password)
    await this.opts.credentials.set(ONELAP_SESSION_KEY, JSON.stringify(session))
    return session
  }
}
