export class SweatRelayError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = new.target.name
    if (cause !== undefined) this.cause = cause
  }
}

export class StravaApiError extends SweatRelayError {
  readonly status: number
  readonly body?: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.status = status
    if (body !== undefined) this.body = body
  }
}

export class UploadTimeoutError extends SweatRelayError {
  readonly uploadId: string

  constructor(uploadId: string, waitedMs: number) {
    super(`Strava upload ${uploadId} did not finish processing within ${waitedMs}ms`)
    this.uploadId = uploadId
  }
}

export class DuplicateActivityError extends SweatRelayError {
  readonly existingActivityId?: number

  constructor(message: string, existingActivityId?: number) {
    super(message)
    if (existingActivityId !== undefined) this.existingActivityId = existingActivityId
  }
}

export class RateLimitError extends SweatRelayError {
  readonly retryAfterMs: number

  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.retryAfterMs = retryAfterMs
  }
}
