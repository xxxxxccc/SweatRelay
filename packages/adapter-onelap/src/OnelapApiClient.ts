import { createHash, randomBytes } from 'node:crypto'
import { SweatRelayError } from '@sweatrelay/core'
import { request } from 'undici'

const ONELAP_SECRET = 'fe9f8382418fcdeb136461cac6acae7b'
const LOGIN_URL = 'https://www.onelap.cn/api/login'
const LIST_URL = 'https://u.onelap.cn/analysis/list'

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
  data?: Array<{
    _id: string
    id: number | string
    fileKey?: string
    date: string
    durl: string
  }>
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
    if (res.statusCode !== 200) {
      throw new SweatRelayError(`Onelap login failed: ${res.statusCode} ${text.slice(0, 200)}`)
    }
    let json: LoginResponse
    try {
      json = JSON.parse(text) as LoginResponse
    } catch {
      throw new SweatRelayError(`Onelap login returned non-JSON: ${text.slice(0, 200)}`)
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
    const cookies = `ouid=${session.uid}; XSRF-TOKEN=${session.xsrfToken}; OTOKEN=${session.oToken}`
    const res = await request(LIST_URL, {
      method: 'GET',
      headers: { cookie: cookies },
    })
    const text = await res.body.text()
    if (res.statusCode !== 200) {
      throw new SweatRelayError(`Onelap list failed: ${res.statusCode} ${text.slice(0, 200)}`)
    }
    const json = JSON.parse(text) as ListResponse
    return (json.data ?? []).map((row) => ({
      externalId: row._id,
      userId: String(row.id),
      fileKey: row.fileKey ?? '',
      dateString: row.date,
      durl: row.durl,
    }))
  }

  /** Download a FIT file from a `durl` returned by listActivities. */
  async downloadFit(session: OnelapSession, durl: string): Promise<Buffer> {
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
}

function md5Hex(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

function randomHex(n: number): string {
  return randomBytes(Math.ceil(n / 2))
    .toString('hex')
    .slice(0, n)
}

/** Parse "YYYY-MM-DD HH:MM" as Asia/Shanghai (UTC+8). */
export function parseOnelapDate(s: string): Date {
  // Treat the wall-clock time as UTC+8 by subtracting 8h to get UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return new Date(Number.NaN)
  const [, y, mo, d, h, mi] = m
  // Build the timestamp as if it were UTC, then shift back by 8h.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi))
  return new Date(utcMs - 8 * 3600 * 1000)
}
