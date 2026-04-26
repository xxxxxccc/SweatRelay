import { createHash, randomBytes } from 'node:crypto'
import { SweatRelayError } from '@sweatrelay/core'
import { request } from 'undici'

const ONELAP_SECRET = 'fe9f8382418fcdeb136461cac6acae7b'
const LOGIN_URL = 'https://www.onelap.cn/api/login'
const LIST_URL = 'https://u.onelap.cn/api/otm/ride_record/list'
const DETAIL_URL = 'https://u.onelap.cn/api/otm/ride_record/analysis'
const FIT_CONTENT_URL = 'https://u.onelap.cn/api/otm/ride_record/analysis/fit_content'

export interface OnelapSession {
  uid: string
  xsrfToken: string
  oToken: string
}

export interface OnelapActivityRaw {
  /** Onelap-side unique activity id (`_id`). */
  externalId: string
  /** Numeric user id (`id`). */
  userId: string
  fileKey: string
  /** "YYYY-MM-DD HH:MM" — assumed Asia/Shanghai. */
  dateString: string
  /** Direct download URL for the FIT file. */
  durl: string
}

interface LoginResponse {
  data?: Array<{
    token: string
    refresh_token: string
    userinfo: { uid: number | string }
  }>
}

interface ListResponse {
  data?:
    | {
        list?: Array<{
          id: string
          rid?: string | number | null
          start_riding_time?: string
          date?: string
          fitUrl?: string
          durl?: string
        }>
      }
    | Array<{
        _id: string
        id: number | string
        fileKey?: string
        date: string
        durl: string
      }>
}

interface DetailResponse {
  data?: {
    ridingRecord?: {
      fitUrl?: string
      durl?: string
    }
  }
}

export class OnelapApiResponseError extends SweatRelayError {
  readonly operation: string
  readonly statusCode: number
  readonly contentType: string | undefined
  readonly bodySnippet: string

  constructor(args: {
    operation: string
    statusCode: number
    contentType: string | undefined
    bodySnippet: string
    message: string
  }) {
    super(args.message)
    this.name = 'OnelapApiResponseError'
    this.operation = args.operation
    this.statusCode = args.statusCode
    this.contentType = args.contentType
    this.bodySnippet = args.bodySnippet
  }
}

export function isOnelapSessionFailure(err: unknown): boolean {
  if (!(err instanceof OnelapApiResponseError)) return false
  if (err.operation !== 'list') return false
  return err.statusCode === 401 || err.statusCode === 403 || err.bodySnippet.startsWith('<')
}

export class OnelapApiClient {
  /** Login with account + plaintext password. Returns the session triple. */
  async login(account: string, password: string): Promise<OnelapSession> {
    if (!account || !password) {
      throw new SweatRelayError('Onelap account and password required')
    }
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomHex(16)
    const passwordMd5 = md5Hex(password)
    const signStr = `account=${account}&nonce=${nonce}&password=${passwordMd5}&timestamp=${timestamp}&key=${ONELAP_SECRET}`
    const sign = md5Hex(signStr)

    const res = await request(LOGIN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        nonce,
        timestamp,
        sign,
      },
      body: JSON.stringify({ account, password: passwordMd5 }),
    })

    const text = await res.body.text()
    const contentType = headerValue(res.headers['content-type'])
    if (res.statusCode !== 200) {
      throw responseError('login', res.statusCode, contentType, text, 'Onelap login failed')
    }
    let json: LoginResponse
    try {
      json = JSON.parse(text) as LoginResponse
    } catch {
      throw responseError(
        'login',
        res.statusCode,
        contentType,
        text,
        'Onelap login returned non-JSON',
      )
    }
    const entry = json.data?.[0]
    if (!entry) throw new SweatRelayError('Onelap login response missing data[0]')
    return {
      uid: String(entry.userinfo.uid),
      xsrfToken: entry.token,
      oToken: entry.refresh_token,
    }
  }

  /** Fetch the activity list using a stored session. */
  async listActivities(session: OnelapSession): Promise<OnelapActivityRaw[]> {
    const res = await request(LIST_URL, {
      method: 'POST',
      headers: {
        authorization: session.xsrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ page: 1, limit: 100 }),
    })
    const text = await res.body.text()
    const contentType = headerValue(res.headers['content-type'])
    if (res.statusCode !== 200) {
      throw responseError('list', res.statusCode, contentType, text, 'Onelap list failed')
    }
    let json: ListResponse
    try {
      json = JSON.parse(text) as ListResponse
    } catch {
      throw responseError(
        'list',
        res.statusCode,
        contentType,
        text,
        'Onelap list returned non-JSON',
      )
    }
    return normalizeListResponse(json, session.uid)
  }

  /** Download a FIT file from a `durl` returned by listActivities. */
  async downloadFit(session: OnelapSession, durl: string): Promise<Buffer> {
    if (durl.startsWith('record:')) {
      const detail = await this.getActivityDetail(session, durl.slice('record:'.length))
      if (!detail.fitUrl) {
        throw new SweatRelayError(`Onelap record ${durl} missing fitUrl`)
      }
      return this.downloadFitContent(session, detail.fitUrl)
    }

    const cookies = `ouid=${session.uid}; XSRF-TOKEN=${session.xsrfToken}; OTOKEN=${session.oToken}`
    const res = await request(durl, {
      method: 'GET',
      headers: { cookie: cookies },
    })
    if (res.statusCode !== 200) {
      const txt = await res.body.text()
      throw new SweatRelayError(
        `Onelap FIT download failed: ${res.statusCode} ${txt.slice(0, 200)}`,
      )
    }
    const chunks: Buffer[] = []
    for await (const chunk of res.body) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  private async getActivityDetail(
    session: OnelapSession,
    recordId: string,
  ): Promise<{ fitUrl?: string; durl?: string }> {
    const res = await request(`${DETAIL_URL}/${recordId}`, {
      method: 'GET',
      headers: { authorization: session.xsrfToken },
    })
    const text = await res.body.text()
    const contentType = headerValue(res.headers['content-type'])
    if (res.statusCode !== 200) {
      throw responseError('detail', res.statusCode, contentType, text, 'Onelap detail failed')
    }
    let json: DetailResponse
    try {
      json = JSON.parse(text) as DetailResponse
    } catch {
      throw responseError(
        'detail',
        res.statusCode,
        contentType,
        text,
        'Onelap detail returned non-JSON',
      )
    }
    return json.data?.ridingRecord ?? {}
  }

  private async downloadFitContent(session: OnelapSession, fitUrl: string): Promise<Buffer> {
    const encoded = encodeURIComponent(base64Utf8(fitUrl))
    const res = await request(`${FIT_CONTENT_URL}/${encoded}`, {
      method: 'GET',
      headers: { authorization: session.xsrfToken },
    })
    if (res.statusCode !== 200) {
      const txt = await res.body.text()
      throw responseError(
        'fit-content',
        res.statusCode,
        headerValue(res.headers['content-type']),
        txt,
        'Onelap FIT content download failed',
      )
    }
    const chunks: Buffer[] = []
    for await (const chunk of res.body) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }
}

function normalizeListResponse(json: ListResponse, uid: string): OnelapActivityRaw[] {
  if (Array.isArray(json.data)) {
    return json.data.map((row) => ({
      externalId: row._id,
      userId: String(row.id),
      fileKey: row.fileKey ?? '',
      dateString: row.date,
      durl: row.durl,
    }))
  }

  return (json.data?.list ?? []).map((row) => {
    const externalId = String(row.id)
    return {
      externalId,
      userId: uid,
      fileKey: String(row.rid ?? ''),
      dateString: row.start_riding_time ?? row.date ?? '',
      durl: row.durl ?? row.fitUrl ?? `record:${externalId}`,
    }
  })
}

function responseError(
  operation: string,
  statusCode: number,
  contentType: string | undefined,
  body: string,
  label: string,
): OnelapApiResponseError {
  const bodySnippet = normalizeSnippet(body)
  const contentTypeText = contentType ?? 'unknown'
  return new OnelapApiResponseError({
    operation,
    statusCode,
    contentType,
    bodySnippet,
    message: `${label}: status=${statusCode} content-type=${contentTypeText} body=${bodySnippet}`,
  })
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(', ')
  return value
}

function normalizeSnippet(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function base64Utf8(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function md5Hex(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

function randomHex(n: number): string {
  return randomBytes(Math.ceil(n / 2))
    .toString('hex')
    .slice(0, n)
}

/** Parse "YYYY-MM-DD HH:MM[:SS]" as Asia/Shanghai (UTC+8). */
export function parseOnelapDate(s: string): Date {
  // Treat the wall-clock time as UTC+8 by subtracting 8h to get UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim())
  if (!m) return new Date(Number.NaN)
  const [, y, mo, d, h, mi, sec = '0'] = m
  // Build the timestamp as if it were UTC, then shift back by 8h.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec))
  return new Date(utcMs - 8 * 3600 * 1000)
}
