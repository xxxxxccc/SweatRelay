import { FormData, request } from 'undici'
import type { FileFormat } from '../activity/Activity.ts'
import {
  DuplicateActivityError,
  RateLimitError,
  StravaApiError,
  UploadTimeoutError,
} from '../util/errors.ts'
import { sleep } from '../util/sleep.ts'
import type { StravaTokens } from './StravaOAuth.ts'

const API_BASE = 'https://www.strava.com/api/v3'

export interface UploadOptions {
  dataType: FileFormat
  name?: string
  description?: string
  externalId?: string
  trainer?: boolean
  commute?: boolean
}

export interface UploadResult {
  uploadId: string
  activityId: number
  activityUrl: string
  externalId?: string
}

export interface PollOptions {
  /** Initial poll delay in ms. Default 1000. */
  initialDelayMs?: number
  /** Max poll delay in ms (cap for exponential backoff). Default 5000. */
  maxDelayMs?: number
  /** Total wait timeout in ms. Default 60000. */
  timeoutMs?: number
}

interface UploadStatusResponse {
  id: number
  id_str: string
  external_id: string | null
  error: string | null
  status: string
  activity_id: number | null
}

export interface StravaUploaderConfig {
  /**
   * Returns a fresh access token. Implementations should call
   * StravaOAuth.refreshIfExpired and persist the new token.
   */
  getAccessToken(): Promise<string>
  /** Override poll defaults. */
  poll?: PollOptions
}

export class StravaUploader {
  private readonly config: StravaUploaderConfig

  constructor(config: StravaUploaderConfig) {
    this.config = config
  }

  async upload(file: Buffer, opts: UploadOptions): Promise<UploadResult> {
    const uploadId = await this.startUpload(file, opts)
    return this.pollUntilDone(uploadId, opts.externalId)
  }

  private async startUpload(file: Buffer, opts: UploadOptions): Promise<string> {
    const accessToken = await this.config.getAccessToken()
    const form = new FormData()
    form.append('data_type', opts.dataType)
    if (opts.name) form.append('name', opts.name)
    if (opts.description) form.append('description', opts.description)
    if (opts.externalId) form.append('external_id', opts.externalId)
    if (opts.trainer) form.append('trainer', '1')
    if (opts.commute) form.append('commute', '1')
    const filename = `upload.${opts.dataType.replace('.gz', '')}`
    form.append('file', new Blob([new Uint8Array(file)]), filename)

    const res = await request(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    })

    const text = await res.body.text()
    handleRateLimit(res.statusCode, res.headers)

    let json: UploadStatusResponse
    try {
      json = JSON.parse(text) as UploadStatusResponse
    } catch {
      throw new StravaApiError(`Upload returned non-JSON ${res.statusCode}`, res.statusCode, text)
    }

    if (res.statusCode >= 400) {
      throw new StravaApiError(
        `Upload start failed: ${res.statusCode} ${json.error ?? text}`,
        res.statusCode,
        json,
      )
    }
    if (json.error) {
      throwForUploadError(json)
    }
    return json.id_str
  }

  private async pollUntilDone(uploadId: string, externalId?: string): Promise<UploadResult> {
    const initial = this.config.poll?.initialDelayMs ?? 1000
    const maxDelay = this.config.poll?.maxDelayMs ?? 5000
    const timeout = this.config.poll?.timeoutMs ?? 60000
    const deadline = Date.now() + timeout
    let delay = initial

    while (Date.now() < deadline) {
      await sleep(delay)
      const status = await this.fetchStatus(uploadId)
      if (status.error) {
        throwForUploadError(status)
      }
      if (status.activity_id !== null) {
        return {
          uploadId,
          activityId: status.activity_id,
          activityUrl: `https://www.strava.com/activities/${status.activity_id}`,
          externalId: status.external_id ?? externalId,
        }
      }
      delay = Math.min(Math.floor(delay * 1.5), maxDelay)
    }
    throw new UploadTimeoutError(uploadId, timeout)
  }

  private async fetchStatus(uploadId: string): Promise<UploadStatusResponse> {
    const accessToken = await this.config.getAccessToken()
    const res = await request(`${API_BASE}/uploads/${uploadId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    handleRateLimit(res.statusCode, res.headers)
    const json = (await res.body.json()) as UploadStatusResponse
    if (res.statusCode >= 400) {
      throw new StravaApiError(
        `Upload status fetch failed: ${res.statusCode}`,
        res.statusCode,
        json,
      )
    }
    return json
  }
}

/** Tokens helper: build a getAccessToken closure that refreshes via OAuth. */
export interface TokenManager {
  load(): Promise<StravaTokens | null>
  save(tokens: StravaTokens): Promise<void>
  refresh(refreshToken: string): Promise<StravaTokens>
}

export function makeTokenGetter(mgr: TokenManager): () => Promise<string> {
  let cache: StravaTokens | null = null
  return async () => {
    if (!cache) cache = await mgr.load()
    if (!cache) throw new StravaApiError('No Strava tokens stored — run `auth strava` first', 401)
    const nowSec = Math.floor(Date.now() / 1000)
    if (cache.expiresAt - nowSec <= 60) {
      cache = await mgr.refresh(cache.refreshToken)
      await mgr.save(cache)
    }
    return cache.accessToken
  }
}

function throwForUploadError(status: UploadStatusResponse): never {
  const msg = status.error ?? 'Unknown upload error'
  // Strava format: "<external_id> duplicate of activity <id>"
  const dup = /duplicate of activity (\d+)/i.exec(msg)
  if (dup) {
    throw new DuplicateActivityError(msg, Number(dup[1]))
  }
  throw new StravaApiError(`Upload failed: ${msg}`, 422, status)
}

function handleRateLimit(
  status: number,
  headers: Record<string, string | string[] | undefined>,
): void {
  if (status !== 429) return
  // Strava resets on the natural 15-minute window boundary.
  const now = new Date()
  const minutes = now.getUTCMinutes()
  const minutesUntilNextWindow = 15 - (minutes % 15)
  const retryAfterMs = (minutesUntilNextWindow * 60 - now.getUTCSeconds()) * 1000
  const headerVal = headers['retry-after']
  const retryAfterHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : retryAfterMs
  throw new RateLimitError(`Strava rate limit hit, retry in ${retryAfter}ms`, retryAfter)
}
