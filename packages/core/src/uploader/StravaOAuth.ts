import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { request } from 'undici'
import { StravaApiError } from '../util/errors.ts'

export interface StravaTokens {
  accessToken: string
  refreshToken: string
  /** Unix seconds. */
  expiresAt: number
  scope: string
  athleteId?: number
}

export interface OAuthAppConfig {
  clientId: string
  clientSecret: string
  /** Default: 'read,activity:write,activity:read' */
  scope?: string
}

const DEFAULT_SCOPE = 'read,activity:write,activity:read'
const TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token'
const AUTH_URL = 'https://www.strava.com/oauth/authorize'
/** Refresh if token expires in less than this many seconds. */
const REFRESH_LEEWAY_SEC = 60

export interface AuthorizeOptions {
  /**
   * Called with the authorization URL the user must visit. The CLI prints it
   * and tries to open the browser; Electron loads it in a BrowserWindow.
   */
  openUrl: (url: string) => void | Promise<void>
  /** Override the loopback port (0 = random). Default 0. */
  port?: number
  /** Override the loopback host. Default '127.0.0.1'. Strava accepts localhost. */
  host?: string
}

export class StravaOAuth {
  private readonly app: OAuthAppConfig

  constructor(app: OAuthAppConfig) {
    this.app = app
  }

  /** Run the loopback authorization flow and return fresh tokens. */
  async authorize(opts: AuthorizeOptions): Promise<StravaTokens> {
    const code = await this.captureAuthCode(opts)
    return this.exchangeCode(code.code, code.redirectUri)
  }

  /** Refresh the access token if needed; returns the (possibly same) tokens. */
  async refreshIfExpired(tokens: StravaTokens): Promise<StravaTokens> {
    const nowSec = Math.floor(Date.now() / 1000)
    if (tokens.expiresAt - nowSec > REFRESH_LEEWAY_SEC) return tokens
    return this.refresh(tokens.refreshToken)
  }

  async refresh(refreshToken: string): Promise<StravaTokens> {
    const body = new URLSearchParams({
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
    const res = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const json = (await res.body.json()) as TokenResponse
    if (res.statusCode >= 400) {
      throw new StravaApiError(`Token refresh failed: ${res.statusCode}`, res.statusCode, json)
    }
    return tokensFromResponse(json)
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<StravaTokens> {
    const body = new URLSearchParams({
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    })
    const res = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const json = (await res.body.json()) as TokenResponse
    if (res.statusCode >= 400) {
      throw new StravaApiError(`Code exchange failed: ${res.statusCode}`, res.statusCode, json)
    }
    return tokensFromResponse(json)
  }

  private captureAuthCode(opts: AuthorizeOptions): Promise<{ code: string; redirectUri: string }> {
    const host = opts.host ?? '127.0.0.1'
    const port = opts.port ?? 0
    const scope = this.app.scope ?? DEFAULT_SCOPE

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400).end('Missing URL')
          return
        }
        const url = new URL(req.url, `http://${req.headers.host}`)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (error) {
          res
            .writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
            .end(`<h1>Strava 授权失败</h1><p>${escapeHtml(error)}</p>`)
          server.close()
          reject(new StravaApiError(`Authorization denied: ${error}`, 400, { error }))
          return
        }
        if (!code) {
          res.writeHead(400).end('Missing code')
          return
        }
        res
          .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end('<!doctype html><meta charset="utf-8"><h1>授权成功，可以关闭此窗口。</h1>')
        server.close()
        resolve({ code, redirectUri })
      })

      server.on('error', reject)

      let redirectUri = ''

      server.listen(port, host, () => {
        const addr = server.address() as AddressInfo
        redirectUri = `http://${host}:${addr.port}/callback`
        const authUrl = new URL(AUTH_URL)
        authUrl.searchParams.set('client_id', this.app.clientId)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('approval_prompt', 'auto')
        authUrl.searchParams.set('scope', scope)
        Promise.resolve(opts.openUrl(authUrl.toString())).catch(reject)
      })
    })
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  scope?: string
  athlete?: { id: number }
}

function tokensFromResponse(json: TokenResponse): StravaTokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_at,
    scope: json.scope ?? DEFAULT_SCOPE,
    athleteId: json.athlete?.id,
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}
