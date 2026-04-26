import { randomUUID } from 'node:crypto'
import { request } from 'undici'
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
  /** Retry transient Strava transport failures. Defaults to 3 attempts. */
  requestAttempts?: number
  /** Initial retry delay for transient transport failures. Defaults to 500ms. */
  requestRetryDelayMs?: number
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
    const filename = `upload.${opts.dataType.replace('.gz', '')}`
    const multipart = buildMultipartBody([
      { name: 'data_type', value: opts.dataType },
      ...(opts.name ? [{ name: 'name', value: opts.name }] : []),
      ...(opts.description ? [{ name: 'description', value: opts.description }] : []),
      ...(opts.externalId ? [{ name: 'external_id', value: opts.externalId }] : []),
      ...(opts.trainer ? [{ name: 'trainer', value: '1' }] : []),
      ...(opts.commute ? [{ name: 'commute', value: '1' }] : []),
      {
        name: 'file',
        filename,
        contentType: 'application/octet-stream',
        bytes: file,
      },
    ])
    const res = await this.requestWithRetry('Strava upload start', () => {
      return request(`${API_BASE}/uploads`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': multipart.contentType,
          'content-length': String(multipart.body.length),
        },
        body: multipart.body,
      })
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

  private async requestWithRetry(
    operation: string,
    makeRequest: () => ReturnType<typeof request>,
  ): Promise<Awaited<ReturnType<typeof request>>> {
    const attempts = this.config.requestAttempts ?? 3
    const initialDelay = this.config.requestRetryDelayMs ?? 500
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await makeRequest()
      } catch (err) {
        if (!isRetriableTransportError(err) || attempt === attempts) {
          throw new StravaApiError(
            `${operation} request failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${formatTransportError(err)}`,
            0,
            { cause: formatTransportError(err) },
          )
        }
        await sleep(initialDelay * attempt)
      }
    }
    throw new StravaApiError(`${operation} request failed`, 0)
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
    const res = await this.requestWithRetry('Strava upload status', () =>
      request(`${API_BASE}/uploads/${uploadId}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    )
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
  if (isDuplicateUploadError(msg)) {
    const duplicateActivityId = parseDuplicateActivityId(msg)
    throw new DuplicateActivityError(msg, duplicateActivityId)
  }
  throw new StravaApiError(`Upload failed: ${msg}`, 422, status)
}

function isDuplicateUploadError(message: string): boolean {
  return /duplicate/i.test(message)
}

function parseDuplicateActivityId(message: string): number | undefined {
  // Strava has returned both plain text and HTML anchor variants here:
  // "duplicate of activity 123" and "duplicate of <a href='/activities/123'>..."
  const anchorMatch = /href=['"]\/activities\/(\d+)/i.exec(message)
  if (anchorMatch) return Number(anchorMatch[1])
  const textMatch = /duplicate of activity (\d+)/i.exec(message)
  if (textMatch) return Number(textMatch[1])
  return undefined
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

function isRetriableTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = 'code' in err ? String(err.code) : ''
  return (
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    /socket|connect timeout|other side closed/i.test(err.message)
  )
}

function formatTransportError(err: unknown): string {
  if (err instanceof Error) {
    const code = 'code' in err ? ` ${(err as Error & { code?: string }).code}` : ''
    return `${err.name}${code}: ${err.message}`
  }
  return String(err)
}

interface MultipartTextPart {
  name: string
  value: string
}

interface MultipartFilePart {
  name: string
  filename: string
  contentType: string
  bytes: Buffer
}

type MultipartPart = MultipartTextPart | MultipartFilePart

function buildMultipartBody(parts: MultipartPart[]): { body: Buffer; contentType: string } {
  const boundary = `sweatrelay-${randomUUID()}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n${contentDisposition(part)}`))
    if ('bytes' in part) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`))
      chunks.push(part.bytes)
      chunks.push(Buffer.from('\r\n'))
    } else {
      chunks.push(Buffer.from(`\r\n${part.value}\r\n`))
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function contentDisposition(part: MultipartPart): string {
  const base = `Content-Disposition: form-data; name="${escapeMultipartValue(part.name)}"`
  if (!('bytes' in part)) return `${base}\r\n`
  return `${base}; filename="${escapeMultipartValue(part.filename)}"\r\n`
}

function escapeMultipartValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
}
