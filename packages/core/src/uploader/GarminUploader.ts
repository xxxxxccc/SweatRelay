import { randomUUID } from 'node:crypto'
import type { FileFormat } from '../activity/Activity.ts'
import type { GarminPlannedWorkoutSyncItem } from '../training/garmin.ts'
import {
  GarminApiError,
  GarminDuplicateImportError,
  GarminMfaRequiredError,
  SweatRelayError,
} from '../util/errors.ts'

const IOS_SSO_CLIENT_ID = 'GCM_IOS_DARK'
const IOS_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/ios'
const IOS_LOGIN_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID_SSO_CLIENT_ID = 'GCM_ANDROID_DARK'
const ANDROID_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/android'
const ANDROID_LOGIN_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
const PORTAL_SSO_CLIENT_ID = 'GarminConnect'
const DESKTOP_LOGIN_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const NATIVE_API_USER_AGENT = 'GCM-Android-5.23'
const NATIVE_X_GARMIN_USER_AGENT =
  'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0'
const DI_GRANT_TYPE = 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket'
const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_IOS_DI',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
] as const

const GARMIN_IMPORT_USER_AGENT = 'GCM-iOS-5.7.2.1'
const GARMIN_DUPLICATE_IMPORT_MESSAGE = 'Garmin already has this activity'

export const GarminDomains = {
  global: 'garmin.com',
  china: 'garmin.cn',
} as const

export type GarminDomain = (typeof GarminDomains)[keyof typeof GarminDomains]

export interface GarminSession {
  domain: GarminDomain
  diToken?: string
  diRefreshToken?: string
  diClientId?: string
  jwtWeb?: string
  webCookie?: string
  csrfToken?: string
  browserPartition?: string
  displayName?: string
  fullName?: string
  userName?: string
}

export interface GarminLoginOptions {
  email: string
  password: string
  domain?: GarminDomain
  mfaCode?: string
}

export interface GarminMfaChallenge {
  domain: GarminDomain
  cookie: string
  ssoClientId?: string
  mfaEndpoint?: 'mobile' | 'portal'
  mfaMethod: string
  serviceUrl: string
  userAgent?: string
}

export type GarminLoginResult =
  | { kind: 'authenticated'; session: GarminSession }
  | { kind: 'mfa-required'; challenge: GarminMfaChallenge }

export interface GarminUploadOptions {
  filename?: string
  dataType: Extract<FileFormat, 'fit' | 'tcx'>
}

export interface GarminImportResult {
  domain: GarminDomain
  uploadId?: string
  activityId?: string
  filename: string
}

export interface GarminWorkoutSyncEntry {
  localId: string
  externalId: string
  name: string
  date: string
  workoutId?: string
  scheduledWorkoutId?: string
  error?: string
}

export interface GarminWorkoutSyncResult {
  attempted: number
  created: number
  scheduled: number
  failed: number
  syncedAt: string
  workouts: GarminWorkoutSyncEntry[]
}

export interface GarminActivitySummary {
  activityId?: number | string
  activityName?: string
  activityType?: { typeKey?: string }
  startTimeLocal?: string
  startTimeGMT?: string
}

export interface GarminProfile {
  displayName?: string
  fullName?: string
  userName?: string
}

export type GarminApiFetch = (
  session: GarminSession,
  url: string,
  init: RequestInit,
) => Promise<Response>

export interface GarminUploaderConfig {
  getSession(): Promise<GarminSession>
  saveSession?(session: GarminSession): Promise<void>
  request?: GarminApiFetch
}

interface GarminLoginResponse {
  responseStatus?: { type?: string }
  serviceTicketId?: string
  customerMfaInfo?: { mfaLastMethodUsed?: string }
  error?: { 'status-code'?: string; message?: string }
}

interface GarminTokenResponse {
  access_token?: string
  refresh_token?: string
}

interface GarminImportResponse {
  detailedImportResult?: {
    uploadId?: string | number
    successes?: Array<{
      internalId?: string | number
      activityId?: string | number
      externalId?: string
      messages?: string[]
    }>
    failures?: Array<{
      fileName?: string
      messages?: string[]
    }>
  }
  status?: string
}

interface GarminWorkoutSummary {
  workoutId?: number | string
  id?: number | string
  workoutName?: string
  description?: string | null
}

export class GarminUploader {
  private readonly config: GarminUploaderConfig

  constructor(config: GarminUploaderConfig) {
    this.config = config
  }

  static async login(opts: GarminLoginOptions): Promise<GarminLoginResult> {
    const result = await startMobileLogin(opts.email, opts.password, opts.domain)
    if (result.kind === 'authenticated' || !opts.mfaCode?.trim()) return result
    return {
      kind: 'authenticated',
      session: await completeMobileMfa(result.challenge, opts.mfaCode.trim()),
    }
  }

  static completeMfa(challenge: GarminMfaChallenge, mfaCode: string): Promise<GarminSession> {
    return completeMobileMfa(challenge, mfaCode)
  }

  static exchangeServiceTicket(
    ticket: string,
    domain: GarminDomain,
    serviceUrl: string,
  ): Promise<GarminSession> {
    return exchangeServiceTicket(ticket, domain, serviceUrl, new CookieJar())
  }

  async fetchProfile(): Promise<GarminProfile> {
    const session = await this.activeSession()
    const res = await this.apiRequest(session, 'GET', '/userprofile-service/socialProfile')
    const json = await readJson<GarminProfile>(res, 'Garmin profile')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin session verification failed', res.status, json)
    }
    return json
  }

  async fetchRecentActivities(limit = 10): Promise<GarminActivitySummary[]> {
    const session = await this.activeSession()
    const path = `/activitylist-service/activities/search/activities?start=0&limit=${Math.max(1, limit)}`
    const res = await this.apiRequest(session, 'GET', path)
    const json = await readJson<unknown>(res, 'Garmin recent activities')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin activity list failed', res.status, json)
    }
    return Array.isArray(json) ? (json as GarminActivitySummary[]) : []
  }

  async currentDomain(): Promise<GarminDomain> {
    return (await this.activeSession()).domain
  }

  async fetchCyclingFtp(): Promise<number | undefined> {
    const session = await this.activeSession()
    const res = await this.apiRequest(
      session,
      'GET',
      '/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING',
    )
    const json = await readJson<unknown>(res, 'Garmin cycling FTP')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin cycling FTP lookup failed', res.status, json)
    }
    return (
      extractFirstNumber(json, /functional.*threshold.*power|threshold.*power|ftp/i) ??
      extractFirstNumber(json, /^value$/i)
    )
  }

  async fetchMaxHeartRate(): Promise<number | undefined> {
    const session = await this.activeSession()
    const res = await this.apiRequest(session, 'GET', '/userprofile-service/userprofile/settings')
    const json = await readJson<unknown>(res, 'Garmin profile settings')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin profile settings lookup failed', res.status, json)
    }
    return extractFirstNumber(json, /max.*heart.*rate|max.*hr|heart.*rate.*max|hr.*max/i)
  }

  async upload(file: Buffer, opts: GarminUploadOptions): Promise<GarminImportResult> {
    const session = await this.activeSession()
    const extension = extensionFor(opts.dataType)
    const filename = sanitizeFilename(opts.filename ?? `sweatrelay.${extension}`, extension)
    const multipart = buildMultipartBody([
      {
        name: 'file',
        filename,
        contentType: 'application/octet-stream',
        value: file,
      },
    ])
    const res = await this.apiRequest(session, 'POST', `/upload-service/upload/${extension}`, {
      headers: {
        NK: 'NT',
        origin: `https://connect.${session.domain}`,
        'content-type': multipart.contentType,
        'user-agent': GARMIN_IMPORT_USER_AGENT,
      },
      body: multipart.body,
      timeoutMs: 60000,
    })
    const json = await readJson<GarminImportResponse>(res, 'Garmin upload')
    if (res.status === 409) {
      throw new GarminDuplicateImportError(GARMIN_DUPLICATE_IMPORT_MESSAGE)
    }
    if (res.status >= 400) {
      throw new GarminApiError(`Garmin upload failed: ${res.status}`, res.status, json)
    }
    return parseImportResult(json, filename, session.domain)
  }

  async syncPlannedWorkouts(
    items: readonly GarminPlannedWorkoutSyncItem[],
  ): Promise<GarminWorkoutSyncResult> {
    const session = await this.activeSession()
    const existing = await this.fetchWorkoutLibrary(session)
    const syncedAt = new Date().toISOString()
    const workouts: GarminWorkoutSyncEntry[] = []

    for (const item of items) {
      try {
        await this.deleteMatchingWorkout(session, existing, item)
        const created = await this.createWorkout(session, item)
        const workoutId = extractWorkoutId(created)
        if (!workoutId) {
          throw new GarminApiError('Garmin 没有返回训练课程 ID', 200, created)
        }
        const scheduled = await this.scheduleWorkout(session, workoutId, item.date)
        workouts.push({
          localId: item.localId,
          externalId: item.externalId,
          name: item.name,
          date: item.date,
          workoutId,
          ...(extractScheduledWorkoutId(scheduled)
            ? { scheduledWorkoutId: extractScheduledWorkoutId(scheduled) }
            : {}),
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        workouts.push({
          localId: item.localId,
          externalId: item.externalId,
          name: item.name,
          date: item.date,
          error,
        })
      }
    }

    const failed = workouts.filter((workout) => workout.error).length
    const scheduled = workouts.filter((workout) => workout.workoutId && !workout.error).length
    const created = workouts.filter((workout) => workout.workoutId && !workout.error).length
    return {
      attempted: items.length,
      created,
      scheduled,
      failed,
      syncedAt,
      workouts,
    }
  }

  private async activeSession(): Promise<GarminSession> {
    const session = normalizeSession(await this.config.getSession())
    if (!session.diToken || !tokenExpiresSoon(session.diToken)) return session
    return this.refreshSession(session)
  }

  private async refreshSession(session: GarminSession): Promise<GarminSession> {
    if (!session.diToken || !session.diRefreshToken || !session.diClientId) {
      throw new GarminApiError('Garmin session expired', 401)
    }
    const failures: string[] = []
    for (const url of diTokenUrls(session.domain)) {
      const res = await fetch(url, {
        method: 'POST',
        headers: nativeHeaders({
          authorization: basicAuth(session.diClientId),
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          'cache-control': 'no-cache',
        }),
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: session.diClientId,
          refresh_token: session.diRefreshToken,
        }).toString(),
      })
      const text = await res.text()
      const json = parseJson<GarminTokenResponse>(text)
      if (res.status < 400 && json.access_token) {
        const refreshed = normalizeSession({
          ...session,
          diToken: json.access_token,
          diRefreshToken: json.refresh_token ?? session.diRefreshToken,
          diClientId: clientIdFromJwt(json.access_token) ?? session.diClientId,
        })
        await this.config.saveSession?.(refreshed)
        return refreshed
      }
      failures.push(`${new URL(url).host}: ${res.status} ${summarizeTokenExchangeBody(text)}`)
    }
    throw new GarminApiError('Garmin session refresh failed', 401, { failures })
  }

  private async apiRequest(
    session: GarminSession,
    method: 'DELETE' | 'GET' | 'POST',
    path: string,
    opts: {
      headers?: Record<string, string>
      body?: Buffer | string
      timeoutMs?: number
    } = {},
  ): Promise<Response> {
    const url = `https://connectapi.${session.domain}/${path.replace(/^\/+/, '')}`
    const headers = apiHeaders(session, opts.headers)
    let res = await this.request(session, url, {
      method,
      headers,
      body: toFetchBody(opts.body),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    })
    if (res.status !== 401 || !session.diRefreshToken) return res

    const refreshed = await this.refreshSession(session)
    res = await this.request(refreshed, url, {
      method,
      headers: apiHeaders(refreshed, opts.headers),
      body: toFetchBody(opts.body),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    })
    return res
  }

  private request(session: GarminSession, url: string, init: RequestInit): Promise<Response> {
    return this.config.request?.(session, url, init) ?? fetch(url, init)
  }

  private async fetchWorkoutLibrary(session: GarminSession): Promise<GarminWorkoutSummary[]> {
    const res = await this.apiRequest(session, 'GET', '/workout-service/workouts?start=0&limit=200')
    const json = await readJson<unknown>(res, 'Garmin workout library')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin workout library lookup failed', res.status, json)
    }
    if (Array.isArray(json)) return json as GarminWorkoutSummary[]
    if (isRecord(json) && Array.isArray(json.workouts)) {
      return json.workouts as GarminWorkoutSummary[]
    }
    return []
  }

  private async deleteMatchingWorkout(
    session: GarminSession,
    existing: readonly GarminWorkoutSummary[],
    item: GarminPlannedWorkoutSyncItem,
  ): Promise<void> {
    const workout = await this.findMatchingWorkout(session, existing, item)
    const workoutId = workout ? extractWorkoutId(workout) : undefined
    if (!workoutId) return
    const res = await this.apiRequest(session, 'DELETE', `/workout-service/workout/${workoutId}`)
    if (res.status >= 400 && res.status !== 404) {
      const json = await readJson<unknown>(res, 'Garmin workout delete')
      throw new GarminApiError('Garmin workout delete failed', res.status, json)
    }
  }

  private async findMatchingWorkout(
    session: GarminSession,
    existing: readonly GarminWorkoutSummary[],
    item: GarminPlannedWorkoutSyncItem,
  ): Promise<GarminWorkoutSummary | undefined> {
    const direct = existing.find((workout) => workout.description?.includes(item.externalId))
    if (direct) return direct

    for (const workout of existing) {
      if (workout.workoutName !== item.name) continue
      const workoutId = extractWorkoutId(workout)
      if (!workoutId) continue
      const detail = await this.fetchWorkoutDetail(session, workoutId)
      if (detail.description?.includes(item.externalId)) return detail
    }
    return undefined
  }

  private async fetchWorkoutDetail(
    session: GarminSession,
    workoutId: string,
  ): Promise<GarminWorkoutSummary> {
    const res = await this.apiRequest(session, 'GET', `/workout-service/workout/${workoutId}`)
    const json = await readJson<unknown>(res, 'Garmin workout detail')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin workout detail lookup failed', res.status, json)
    }
    return isRecord(json) ? (json as GarminWorkoutSummary) : {}
  }

  private async createWorkout(
    session: GarminSession,
    item: GarminPlannedWorkoutSyncItem,
  ): Promise<unknown> {
    const res = await this.apiRequest(session, 'POST', '/workout-service/workout', {
      headers: {
        origin: `https://connect.${session.domain}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(item.workout),
    })
    const json = await readJson<unknown>(res, 'Garmin workout upload')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin workout upload failed', res.status, json)
    }
    return json
  }

  private async scheduleWorkout(
    session: GarminSession,
    workoutId: string,
    date: string,
  ): Promise<unknown> {
    const res = await this.apiRequest(session, 'POST', `/workout-service/schedule/${workoutId}`, {
      headers: {
        origin: `https://connect.${session.domain}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ date }),
    })
    const json = await readJson<unknown>(res, 'Garmin workout schedule')
    if (res.status >= 400) {
      throw new GarminApiError('Garmin workout schedule failed', res.status, json)
    }
    return json
  }
}

async function startMobileLogin(
  email: string,
  password: string,
  domain: GarminDomain | undefined = GarminDomains.china,
): Promise<GarminLoginResult> {
  const normalizedDomain = normalizeDomain(domain)
  const failures: string[] = []
  for (const flow of mobileLoginFlows(normalizedDomain)) {
    try {
      return await startMobileLoginWithFlow(email, password, normalizedDomain, flow)
    } catch (err) {
      if (!isTokenExchangeError(err)) throw err
      failures.push(...formatLoginFlowFailures(flow.label, err))
    }
  }
  try {
    return await startPortalLogin(email, password, normalizedDomain)
  } catch (err) {
    if (isCredentialError(err)) throw err
    failures.push(...formatLoginFlowFailures('Portal web service', err))
  }
  const hint =
    normalizedDomain === GarminDomains.china
      ? '中国区请优先使用 Garmin 账号绑定的邮箱登录；手机号有时可以通过 SSO，但无法换取 Garmin Connect token。'
      : '请确认账号属于当前选择的 Garmin 区域。'
  throw new GarminApiError(`Garmin token exchange failed. ${hint}`, 401, { failures })
}

interface MobileLoginFlow {
  label: string
  ssoClientId: string
  serviceUrl: string
  userAgent: string
}

function mobileLoginFlows(domain: GarminDomain): MobileLoginFlow[] {
  const connectServiceUrl = `https://connect.${domain}/app`
  return [
    {
      label: 'iOS mobile service',
      ssoClientId: IOS_SSO_CLIENT_ID,
      serviceUrl: IOS_SERVICE_URL,
      userAgent: IOS_LOGIN_USER_AGENT,
    },
    {
      label: 'iOS connect service',
      ssoClientId: IOS_SSO_CLIENT_ID,
      serviceUrl: connectServiceUrl,
      userAgent: IOS_LOGIN_USER_AGENT,
    },
    {
      label: 'Android mobile service',
      ssoClientId: ANDROID_SSO_CLIENT_ID,
      serviceUrl: ANDROID_SERVICE_URL,
      userAgent: ANDROID_LOGIN_USER_AGENT,
    },
    {
      label: 'Android connect service',
      ssoClientId: ANDROID_SSO_CLIENT_ID,
      serviceUrl: connectServiceUrl,
      userAgent: ANDROID_LOGIN_USER_AGENT,
    },
  ]
}

async function startMobileLoginWithFlow(
  email: string,
  password: string,
  normalizedDomain: GarminDomain,
  flow: MobileLoginFlow,
): Promise<GarminLoginResult> {
  const jar = new CookieJar()
  const url = new URL(`https://sso.${normalizedDomain}/mobile/api/login`)
  url.searchParams.set('clientId', flow.ssoClientId)
  url.searchParams.set('locale', 'en-US')
  url.searchParams.set('service', flow.serviceUrl)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': flow.userAgent,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: `https://sso.${normalizedDomain}`,
    },
    body: JSON.stringify({
      username: email.trim(),
      password,
      rememberMe: true,
      captchaToken: '',
    }),
  })
  jar.add(getSetCookie(res.headers))
  const json = await readJson<GarminLoginResponse>(res, 'Garmin login')
  if (res.status === 429 || json.error?.['status-code'] === '429') {
    throw new GarminApiError('Garmin login rate limited', 429, json)
  }
  const type = json.responseStatus?.type
  if (type === 'MFA_REQUIRED') {
    return {
      kind: 'mfa-required',
      challenge: {
        domain: normalizedDomain,
        cookie: jar.header(),
        ssoClientId: flow.ssoClientId,
        mfaMethod: json.customerMfaInfo?.mfaLastMethodUsed ?? 'email',
        serviceUrl: flow.serviceUrl,
        userAgent: flow.userAgent,
      },
    }
  }
  if (type === 'SUCCESSFUL' && json.serviceTicketId) {
    return {
      kind: 'authenticated',
      session: await exchangeServiceTicket(
        json.serviceTicketId,
        normalizedDomain,
        flow.serviceUrl,
        jar,
      ),
    }
  }
  if (type === 'INVALID_USERNAME_PASSWORD') {
    throw new GarminApiError('Garmin username or password is incorrect', 401, json)
  }
  throw new GarminApiError('Garmin login failed', res.status, json)
}

async function startPortalLogin(
  email: string,
  password: string,
  domain: GarminDomain,
): Promise<GarminLoginResult> {
  const jar = new CookieJar()
  const serviceUrl = `https://connect.${domain}/app`
  const signinUrl = new URL(`https://sso.${domain}/portal/sso/en-US/sign-in`)
  signinUrl.searchParams.set('clientId', PORTAL_SSO_CLIENT_ID)
  signinUrl.searchParams.set('service', serviceUrl)

  const getRes = await fetch(signinUrl, {
    headers: {
      'user-agent': DESKTOP_LOGIN_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
  jar.add(getSetCookie(getRes.headers))
  if (getRes.status === 429) {
    throw new GarminApiError('Garmin portal login rate limited', 429)
  }
  if (getRes.status >= 400) {
    throw new GarminApiError('Garmin portal login page was blocked', getRes.status, {
      status: getRes.status,
      cfMitigated: getRes.headers.get('cf-mitigated'),
      contentType: getRes.headers.get('content-type'),
    })
  }

  const loginUrl = new URL(`https://sso.${domain}/portal/api/login`)
  loginUrl.searchParams.set('clientId', PORTAL_SSO_CLIENT_ID)
  loginUrl.searchParams.set('locale', 'en-US')
  loginUrl.searchParams.set('service', serviceUrl)
  const res = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'user-agent': DESKTOP_LOGIN_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      origin: `https://sso.${domain}`,
      referer: signinUrl.toString(),
      ...(jar.header() ? { cookie: jar.header() } : {}),
    },
    body: JSON.stringify({
      username: email.trim(),
      password,
      rememberMe: true,
      captchaToken: '',
    }),
  })
  jar.add(getSetCookie(res.headers))
  const json = await readJson<GarminLoginResponse>(res, 'Garmin portal login')
  if (res.status === 429 || json.error?.['status-code'] === '429') {
    throw new GarminApiError('Garmin portal login rate limited', 429, json)
  }
  const type = json.responseStatus?.type
  if (type === 'MFA_REQUIRED') {
    return {
      kind: 'mfa-required',
      challenge: {
        domain,
        cookie: jar.header(),
        ssoClientId: PORTAL_SSO_CLIENT_ID,
        mfaEndpoint: 'portal',
        mfaMethod: json.customerMfaInfo?.mfaLastMethodUsed ?? 'email',
        serviceUrl,
        userAgent: DESKTOP_LOGIN_USER_AGENT,
      },
    }
  }
  if (type === 'SUCCESSFUL' && json.serviceTicketId) {
    return {
      kind: 'authenticated',
      session: await exchangeServiceTicket(json.serviceTicketId, domain, serviceUrl, jar),
    }
  }
  if (type === 'INVALID_USERNAME_PASSWORD') {
    throw new GarminApiError('Garmin username or password is incorrect', 401, json)
  }
  throw new GarminApiError('Garmin portal login failed', res.status, json)
}

async function completeMobileMfa(
  challenge: GarminMfaChallenge,
  mfaCode: string,
): Promise<GarminSession> {
  const code = mfaCode.trim()
  if (!code) throw new GarminMfaRequiredError()
  const endpoint = challenge.mfaEndpoint ?? 'mobile'
  const url = new URL(`https://sso.${challenge.domain}/${endpoint}/api/mfa/verifyCode`)
  url.searchParams.set('clientId', challenge.ssoClientId ?? IOS_SSO_CLIENT_ID)
  url.searchParams.set('locale', 'en-US')
  url.searchParams.set('service', challenge.serviceUrl)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': challenge.userAgent ?? IOS_LOGIN_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      cookie: challenge.cookie,
      origin: `https://sso.${challenge.domain}`,
    },
    body: JSON.stringify({
      mfaMethod: challenge.mfaMethod,
      mfaVerificationCode: code,
      rememberMyBrowser: true,
      reconsentList: [],
      mfaSetup: false,
    }),
  })
  const json = await readJson<GarminLoginResponse>(res, 'Garmin MFA')
  if (res.status === 429 || json.error?.['status-code'] === '429') {
    throw new GarminApiError('Garmin MFA rate limited', 429, json)
  }
  if (json.responseStatus?.type !== 'SUCCESSFUL' || !json.serviceTicketId) {
    throw new GarminApiError('Garmin MFA verification failed', res.status, json)
  }
  const jar = CookieJar.fromHeader(challenge.cookie)
  jar.add(getSetCookie(res.headers))
  return exchangeServiceTicket(json.serviceTicketId, challenge.domain, challenge.serviceUrl, jar)
}

async function exchangeServiceTicket(
  ticket: string,
  domain: GarminDomain,
  serviceUrl: string,
  ssoJar: CookieJar,
): Promise<GarminSession> {
  const failures: string[] = []
  for (const tokenUrl of diTokenUrls(domain)) {
    for (const clientId of DI_CLIENT_IDS) {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: nativeHeaders({
          authorization: basicAuth(clientId),
          accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
          'content-type': 'application/x-www-form-urlencoded',
          'cache-control': 'no-cache',
        }),
        body: new URLSearchParams({
          client_id: clientId,
          service_ticket: ticket,
          grant_type: DI_GRANT_TYPE,
          service_url: serviceUrl,
        }).toString(),
      })
      if (res.status === 429) {
        throw new GarminApiError('Garmin token exchange rate limited', 429)
      }
      const text = await res.text()
      const json = parseJson<GarminTokenResponse>(text)
      if (res.status >= 400 || !json.access_token) {
        failures.push(
          `${new URL(tokenUrl).host} ${clientId}: ${res.status} ${summarizeTokenExchangeBody(text)}`,
        )
        continue
      }
      return normalizeSession({
        domain,
        diToken: json.access_token,
        ...(json.refresh_token ? { diRefreshToken: json.refresh_token } : {}),
        diClientId: clientIdFromJwt(json.access_token) ?? clientId,
      })
    }
  }
  try {
    return await consumeJwtWebTicket(ticket, domain, serviceUrl, ssoJar)
  } catch (err) {
    failures.push(`JWT_WEB fallback: ${formatErrorSummary(err)}`)
  }
  throw new GarminApiError('Garmin token exchange failed', 401, { failures })
}

function isTokenExchangeError(err: unknown): err is GarminApiError {
  return (
    err instanceof GarminApiError && err.status !== 429 && err.message.includes('token exchange')
  )
}

function isCredentialError(err: unknown): boolean {
  return err instanceof GarminApiError && err.message.includes('username or password')
}

function formatLoginFlowFailures(flowLabel: string, err: unknown): string[] {
  const nested = err instanceof GarminApiError ? extractFailureMessages(err.body) : []
  if (nested.length > 0) {
    return nested.map((failure) => `${flowLabel}: ${failure}`)
  }
  return [`${flowLabel}: ${formatErrorSummary(err)}`]
}

function extractFailureMessages(value: unknown): string[] {
  if (!isRecord(value)) return []
  const failures = value.failures
  if (!Array.isArray(failures)) return []
  return failures.filter((failure): failure is string => typeof failure === 'string')
}

function formatErrorSummary(err: unknown): string {
  if (err instanceof GarminApiError) {
    const body = summarizeErrorBody(err.body)
    return body ? `${err.message} ${body}` : err.message
  }
  return err instanceof Error ? err.message : String(err)
}

function summarizeErrorBody(body: unknown): string | undefined {
  if (body === undefined) return undefined
  try {
    return JSON.stringify(body).replace(/\s+/g, ' ').slice(0, 240)
  } catch {
    return String(body).replace(/\s+/g, ' ').slice(0, 240)
  }
}

async function consumeJwtWebTicket(
  ticket: string,
  domain: GarminDomain,
  serviceUrl: string,
  ssoJar: CookieJar,
): Promise<GarminSession> {
  const jar = ssoJar.clone()
  const first = new URL(serviceUrl)
  first.searchParams.set('ticket', ticket)
  let current = first

  for (let redirects = 0; redirects < 8; redirects++) {
    let res: Response
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: {
          'user-agent': IOS_LOGIN_USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(jar.header() ? { cookie: jar.header() } : {}),
        },
      })
    } catch (err) {
      throw new GarminApiError('Garmin JWT_WEB ticket consumption failed', 401, {
        url: current.toString(),
        cause: err instanceof Error ? err.message : String(err),
        cookies: jar.names(),
      })
    }
    jar.add(getSetCookie(res.headers))
    if (![301, 302, 303, 307, 308].includes(res.status)) break
    const location = res.headers.get('location')
    if (!location) break
    current = new URL(location, current)
  }

  const jwtWeb = jar.get('JWT_WEB')
  if (!jwtWeb) {
    throw new GarminApiError('Garmin JWT_WEB cookie was not issued', 401, {
      serviceUrl,
      cookies: jar.names(),
    })
  }
  return normalizeSession({
    domain,
    jwtWeb,
    webCookie: jar.header(),
    ...(jar.csrfToken() ? { csrfToken: jar.csrfToken() } : {}),
  })
}

function apiHeaders(
  session: GarminSession,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  if (session.diToken) {
    return nativeHeaders({
      authorization: `Bearer ${session.diToken}`,
      accept: 'application/json',
      ...(extra ?? {}),
    })
  }
  if (!session.jwtWeb) {
    throw new GarminApiError('Garmin session is missing an API credential', 401)
  }
  return {
    'user-agent': IOS_LOGIN_USER_AGENT,
    accept: 'application/json',
    NK: 'NT',
    origin: `https://connect.${session.domain}`,
    referer: `https://connect.${session.domain}/modern/`,
    'DI-Backend': `connectapi.${session.domain}`,
    cookie: session.webCookie ?? `JWT_WEB=${session.jwtWeb}`,
    ...(session.csrfToken ? { 'connect-csrf-token': session.csrfToken } : {}),
    ...(extra ?? {}),
  }
}

function diTokenUrls(domain: GarminDomain): string[] {
  return [
    `https://diauth.${domain}/di-oauth2-service/oauth/token`,
    `https://connectapi.${domain}/di-oauth2-service/oauth/token`,
  ]
}

function nativeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'user-agent': NATIVE_API_USER_AGENT,
    'x-garmin-user-agent': NATIVE_X_GARMIN_USER_AGENT,
    'x-garmin-paired-app-version': '10861',
    'x-garmin-client-platform': 'Android',
    'x-app-ver': '10861',
    'x-lang': 'en',
    'x-gcexperience': 'GC5',
    'accept-language': 'en-US,en;q=0.9',
    ...extra,
  }
}

function basicAuth(clientId: string): string {
  return `Basic ${Buffer.from(`${clientId}:`, 'utf8').toString('base64')}`
}

function normalizeSession(session: GarminSession): GarminSession {
  const domain = normalizeDomain(session.domain)
  const diToken = session.diToken?.trim()
  const jwtWeb = session.jwtWeb?.trim()
  const webCookie = session.webCookie?.trim()
  if (!diToken && !jwtWeb) throw new SweatRelayError('Garmin API credential is required')
  return {
    domain,
    ...(diToken ? { diToken } : {}),
    ...(session.diRefreshToken?.trim() ? { diRefreshToken: session.diRefreshToken.trim() } : {}),
    ...(session.diClientId?.trim() ? { diClientId: session.diClientId.trim() } : {}),
    ...(jwtWeb ? { jwtWeb } : {}),
    ...(webCookie ? { webCookie } : {}),
    ...(session.csrfToken?.trim() ? { csrfToken: session.csrfToken.trim() } : {}),
    ...(session.browserPartition?.trim()
      ? { browserPartition: session.browserPartition.trim() }
      : {}),
    ...(session.displayName?.trim() ? { displayName: session.displayName.trim() } : {}),
    ...(session.fullName?.trim() ? { fullName: session.fullName.trim() } : {}),
    ...(session.userName?.trim() ? { userName: session.userName.trim() } : {}),
  }
}

function normalizeDomain(domain: GarminDomain | undefined): GarminDomain {
  return domain === GarminDomains.global ? GarminDomains.global : GarminDomains.china
}

function tokenExpiresSoon(token: string): boolean {
  const payload = decodeJwtPayload(token)
  const exp = typeof payload?.exp === 'number' ? payload.exp : undefined
  if (!exp) return false
  return Date.now() / 1000 > exp - 900
}

function clientIdFromJwt(token: string): string | undefined {
  const payload = decodeJwtPayload(token)
  const clientId = payload?.client_id
  return typeof clientId === 'string' && clientId ? clientId : undefined
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function readJson<T>(res: Response, operation: string): Promise<T> {
  const text = await res.text()
  if (!text && res.status === 204) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new GarminApiError(`${operation} returned non-JSON ${res.status}`, res.status)
  }
}

function parseJson<T>(text: string): T {
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}

function summarizeTokenExchangeBody(text: string): string {
  const json = parseJson<Record<string, unknown>>(text)
  const description = json.error_description ?? json.message ?? json.error
  if (typeof description === 'string' && description.trim()) return description.trim()
  return text.replace(/\s+/g, ' ').trim().slice(0, 160) || 'empty response'
}

function toFetchBody(
  body: Buffer | string | undefined,
): Uint8Array<ArrayBuffer> | string | undefined {
  if (!Buffer.isBuffer(body)) return body
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  return bytes
}

function parseImportResult(
  json: GarminImportResponse,
  filename: string,
  domain: GarminDomain,
): GarminImportResult {
  const detail = json.detailedImportResult
  const success = detail?.successes?.[0]
  const failure = detail?.failures?.[0]
  const failureMessage = failure?.messages?.join(' · ')
  const uploadId = detail?.uploadId !== undefined ? String(detail.uploadId) : undefined
  const activityId =
    success?.internalId !== undefined
      ? String(success.internalId)
      : success?.activityId !== undefined
        ? String(success.activityId)
        : uploadId
  if (failureMessage) {
    if (/duplicate|already|exist/i.test(failureMessage)) {
      throw new GarminDuplicateImportError(`${GARMIN_DUPLICATE_IMPORT_MESSAGE}: ${failureMessage}`)
    }
    throw new GarminApiError(`Garmin rejected the activity file: ${failureMessage}`, 200, json)
  }
  if (!activityId) {
    throw new GarminApiError(
      'Garmin accepted the activity file but did not return an activity id',
      200,
      json,
    )
  }
  return {
    domain,
    filename,
    ...(uploadId ? { uploadId } : {}),
    activityId,
  }
}

function extractWorkoutId(value: unknown): string | undefined {
  const direct = extractKnownId(value, ['workoutId', 'id'])
  if (direct) return direct
  if (isRecord(value)) {
    return extractKnownId(value.workout, ['workoutId', 'id'])
  }
  return undefined
}

function extractScheduledWorkoutId(value: unknown): string | undefined {
  const direct = extractKnownId(value, ['scheduledWorkoutId', 'id'])
  if (direct) return direct
  if (isRecord(value)) {
    return extractKnownId(value.scheduledWorkout, ['scheduledWorkoutId', 'id'])
  }
  return undefined
}

function extractKnownId(value: unknown, keys: readonly string[]): string | undefined {
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    const id = value[key]
    if (typeof id === 'string' && id.trim()) return id.trim()
    if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  }
  return undefined
}

function extractFirstNumber(value: unknown, keyPattern: RegExp): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstNumber(item, keyPattern)
      if (found) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  for (const [key, item] of Object.entries(value)) {
    if (!keyPattern.test(key)) continue
    const direct = positiveNumber(item)
    if (direct) return direct
    const nested = largestPositiveNumber(item)
    if (nested) return nested
  }
  for (const item of Object.values(value)) {
    const found = extractFirstNumber(item, keyPattern)
    if (found) return found
  }
  return undefined
}

function largestPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return positiveNumber(value)
  if (Array.isArray(value)) {
    return value.reduce<number | undefined>((max, item) => {
      const found = largestPositiveNumber(item)
      if (!found) return max
      return max === undefined || found > max ? found : max
    }, undefined)
  }
  if (!isRecord(value)) return undefined
  return Object.values(value).reduce<number | undefined>((max, item) => {
    const found = largestPositiveNumber(item)
    if (!found) return max
    return max === undefined || found > max ? found : max
  }, undefined)
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extensionFor(dataType: GarminUploadOptions['dataType']): 'fit' | 'tcx' {
  if (dataType === 'fit' || dataType === 'tcx') return dataType
  throw new SweatRelayError(`Garmin upload supports FIT/TCX for now, got ${dataType}`)
}

function sanitizeFilename(filename: string, extension: 'fit' | 'tcx'): string {
  const cleaned = filename
    .replaceAll('\\', '_')
    .replaceAll('/', '_')
    .replace(/[\r\n]/g, '_')
    .trim()
  const fallback = `sweatrelay.${extension}`
  const safe = cleaned || fallback
  return safe.toLowerCase().endsWith(`.${extension}`) ? safe : `${safe}.${extension}`
}

interface MultipartFilePart {
  name: string
  filename: string
  contentType: string
  value: Buffer
}

function buildMultipartBody(parts: MultipartFilePart[]): { body: Buffer; contentType: string } {
  const boundary = `sweatrelay-${randomUUID()}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${escapeMultipartValue(part.name)}"; filename="${escapeMultipartValue(part.filename)}"\r\n` +
          `Content-Type: ${part.contentType}\r\n\r\n`,
      ),
      part.value,
      Buffer.from('\r\n'),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function escapeMultipartValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
}

function getSetCookie(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const values = getSetCookie?.call(headers)
  if (values?.length) return values
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

class CookieJar {
  private readonly values = new Map<string, string>()

  static fromHeader(header: string): CookieJar {
    const jar = new CookieJar()
    for (const part of header.split(';')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      jar.values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
    }
    return jar
  }

  add(setCookies: string[]): void {
    for (const cookie of setCookies) {
      const pair = cookie.split(';', 1)[0]
      if (!pair) continue
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      this.values.set(pair.slice(0, eq), pair.slice(eq + 1))
    }
  }

  header(): string {
    return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }

  clone(): CookieJar {
    const jar = new CookieJar()
    for (const [key, value] of this.values.entries()) {
      jar.values.set(key, value)
    }
    return jar
  }

  get(key: string): string | undefined {
    return this.values.get(key)
  }

  names(): string[] {
    return [...this.values.keys()]
  }

  csrfToken(): string | undefined {
    for (const [key, value] of this.values.entries()) {
      if (/csrf/i.test(key)) return value
    }
    return undefined
  }
}
