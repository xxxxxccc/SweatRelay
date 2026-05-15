import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GarminDomains, GarminUploader } from '../src/uploader/GarminUploader.ts'

const SSO_ORIGIN = 'https://sso.garmin.com'
const DIAUTH_ORIGIN = 'https://diauth.garmin.com'
const CONNECT_API_ORIGIN = 'https://connectapi.garmin.com'
const SSO_CHINA_ORIGIN = 'https://sso.garmin.cn'
const DIAUTH_CHINA_ORIGIN = 'https://diauth.garmin.cn'
const CONNECT_CHINA_ORIGIN = 'https://connect.garmin.cn'
const CONNECT_API_CHINA_ORIGIN = 'https://connectapi.garmin.cn'

describe('GarminUploader', () => {
  let agent: MockAgent

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    await agent.close()
  })

  it('logs in with Garmin mobile SSO and imports a FIT file', async () => {
    const token = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    })
    const ssoPool = agent.get(SSO_ORIGIN)
    const diauthPool = agent.get(DIAUTH_ORIGIN)
    const connectPool = agent.get(CONNECT_API_ORIGIN)

    ssoPool
      .intercept({
        path: /\/mobile\/api\/login.*/,
        method: 'POST',
      })
      .reply(
        200,
        {
          responseStatus: { type: 'SUCCESSFUL' },
          serviceTicketId: 'ticket-1',
        },
        { headers: { 'set-cookie': 'GARMIN-SSO=abc; Path=/; HttpOnly' } },
      )

    diauthPool
      .intercept({
        path: '/di-oauth2-service/oauth/token',
        method: 'POST',
      })
      .reply(200, (opts) => {
        const body = String(opts.body)
        const headers = opts.headers as Record<string, string>
        expect(headers.authorization).toMatch(/^Basic /)
        expect(body).toContain('service_ticket=ticket-1')
        expect(body).toContain('grant_type=https%3A%2F%2Fconnectapi.garmin.com')
        return {
          access_token: token,
          refresh_token: 'refresh-token',
        }
      })

    connectPool
      .intercept({ path: '/userprofile-service/socialProfile', method: 'GET' })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        expect(headers.authorization).toBe(`Bearer ${token}`)
        return { displayName: 'rider' }
      })

    connectPool
      .intercept({ path: '/upload-service/upload/fit', method: 'POST' })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        const body = Buffer.from(opts.body as Uint8Array)
        expect(headers.authorization).toBe(`Bearer ${token}`)
        expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=sweatrelay-/)
        expect(body.toString('utf8')).toContain('filename="ride.fit"')
        expect(body.includes(Buffer.from('fake-fit'))).toBe(true)
        return {
          detailedImportResult: {
            uploadId: 77,
            successes: [{ internalId: 12345 }],
          },
        }
      })

    const login = await GarminUploader.login({
      email: 'rider@example.com',
      password: 'secret',
      domain: GarminDomains.global,
    })
    expect(login.kind).toBe('authenticated')
    if (login.kind !== 'authenticated') throw new Error('expected authenticated login')

    const uploader = new GarminUploader({ getSession: async () => login.session })
    await expect(uploader.fetchProfile()).resolves.toMatchObject({ displayName: 'rider' })
    await expect(
      uploader.upload(Buffer.from('fake-fit'), { dataType: 'fit', filename: 'ride.fit' }),
    ).resolves.toMatchObject({
      domain: GarminDomains.global,
      uploadId: '77',
      activityId: '12345',
      filename: 'ride.fit',
    })
  })

  it('uses Garmin uploadId as the activity id when upload successes omit internalId', async () => {
    const token = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    })
    const connectPool = agent.get(CONNECT_API_ORIGIN)

    connectPool.intercept({ path: '/upload-service/upload/fit', method: 'POST' }).reply(200, {
      detailedImportResult: {
        uploadId: 98765,
      },
    })

    const uploader = new GarminUploader({
      getSession: async () => ({
        domain: GarminDomains.global,
        diToken: token,
      }),
    })

    await expect(
      uploader.upload(Buffer.from('fake-fit'), { dataType: 'fit', filename: 'ride.fit' }),
    ).resolves.toMatchObject({
      domain: GarminDomains.global,
      uploadId: '98765',
      activityId: '98765',
      filename: 'ride.fit',
    })
  })

  it('creates and schedules Garmin workout-service workouts idempotently', async () => {
    const token = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    })
    const connectPool = agent.get(CONNECT_API_ORIGIN)
    const uploader = new GarminUploader({
      getSession: async () => ({
        domain: GarminDomains.global,
        diToken: token,
      }),
    })

    connectPool
      .intercept({ path: '/workout-service/workouts?start=0&limit=200', method: 'GET' })
      .reply(200, [
        {
          workoutId: 55,
          workoutName: 'Old',
          description: 'SweatRelay ID: sweatrelay:workout:abc',
        },
      ])

    connectPool.intercept({ path: '/workout-service/workout/55', method: 'DELETE' }).reply(204)

    connectPool
      .intercept({ path: '/workout-service/workout', method: 'POST' })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        const body = JSON.parse(String(opts.body)) as {
          workoutName?: string
          description?: string
        }
        expect(headers.authorization).toBe(`Bearer ${token}`)
        expect(headers['content-type']).toBe('application/json')
        expect(body.workoutName).toBe('VO2 repeats')
        expect(body.description).toContain('sweatrelay:workout:abc')
        return { workoutId: 77 }
      })

    connectPool
      .intercept({ path: '/workout-service/schedule/77', method: 'POST' })
      .reply(200, (opts) => {
        expect(JSON.parse(String(opts.body))).toEqual({ date: '2026-05-18' })
        return { scheduledWorkoutId: 88 }
      })

    await expect(
      uploader.syncPlannedWorkouts([
        {
          localId: 'abc',
          externalId: 'sweatrelay:workout:abc',
          date: '2026-05-18',
          name: 'VO2 repeats',
          workout: {
            workoutName: 'VO2 repeats',
            sportType: { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 },
            estimatedDurationInSecs: 1200,
            description: 'SweatRelay ID: sweatrelay:workout:abc',
            author: {},
            workoutSegments: [
              {
                segmentOrder: 1,
                sportType: { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 },
                workoutSteps: [],
              },
            ],
          },
        },
      ]),
    ).resolves.toMatchObject({
      attempted: 1,
      created: 1,
      scheduled: 1,
      failed: 0,
      workouts: [{ workoutId: '77', scheduledWorkoutId: '88' }],
    })
  })

  it('retries China login with a Connect service ticket when mobile ticket exchange fails', async () => {
    const token = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    })
    const ssoPool = agent.get(SSO_CHINA_ORIGIN)
    const diauthPool = agent.get(DIAUTH_CHINA_ORIGIN)
    const connectApiPool = agent.get(CONNECT_API_CHINA_ORIGIN)

    ssoPool
      .intercept({
        path: /\/mobile\/api\/login.*service=https%3A%2F%2Fmobile\.integration\.garmin\.com%2Fgcm%2Fios/,
        method: 'POST',
      })
      .reply(
        200,
        {
          responseStatus: { type: 'SUCCESSFUL' },
          serviceTicketId: 'mobile-ticket',
        },
        {
          headers: { 'set-cookie': 'GARMIN-SSO=mobile-session; Path=/; HttpOnly' },
        },
      )

    for (let i = 0; i < 4; i++) {
      diauthPool
        .intercept({
          path: '/di-oauth2-service/oauth/token',
          method: 'POST',
        })
        .reply(400, {
          error: 'invalid_request',
          error_description: 'invalid service ticket provided',
        })
    }
    for (let i = 0; i < 4; i++) {
      connectApiPool
        .intercept({
          path: '/di-oauth2-service/oauth/token',
          method: 'POST',
        })
        .reply(400, {
          error: 'invalid_request',
          error_description: 'invalid service ticket provided',
        })
    }

    ssoPool
      .intercept({
        path: /\/mobile\/api\/login.*service=https%3A%2F%2Fconnect\.garmin\.cn%2Fapp/,
        method: 'POST',
      })
      .reply(
        200,
        {
          responseStatus: { type: 'SUCCESSFUL' },
          serviceTicketId: 'connect-ticket',
        },
        {
          headers: { 'set-cookie': 'GARMIN-SSO=connect-session; Path=/; HttpOnly' },
        },
      )

    diauthPool
      .intercept({
        path: '/di-oauth2-service/oauth/token',
        method: 'POST',
      })
      .reply(200, (opts) => {
        const body = String(opts.body)
        expect(body).toContain('service_ticket=connect-ticket')
        expect(body).toContain('service_url=https%3A%2F%2Fconnect.garmin.cn%2Fapp')
        return {
          access_token: token,
          refresh_token: 'refresh-token',
        }
      })

    await expect(
      GarminUploader.login({
        email: 'rider@example.cn',
        password: 'secret',
        domain: GarminDomains.china,
      }),
    ).resolves.toMatchObject({
      kind: 'authenticated',
      session: {
        domain: GarminDomains.china,
        diToken: token,
        diRefreshToken: 'refresh-token',
      },
    })
  })

  it('falls back to JWT_WEB cookie auth when China DI token exchange rejects service tickets', async () => {
    const ssoPool = agent.get(SSO_CHINA_ORIGIN)
    const diauthPool = agent.get(DIAUTH_CHINA_ORIGIN)
    const connectPool = agent.get(CONNECT_CHINA_ORIGIN)
    const connectApiPool = agent.get(CONNECT_API_CHINA_ORIGIN)

    ssoPool
      .intercept({
        path: /\/mobile\/api\/login.*service=https%3A%2F%2Fmobile\.integration\.garmin\.com%2Fgcm%2Fios/,
        method: 'POST',
      })
      .reply(
        200,
        {
          responseStatus: { type: 'SUCCESSFUL' },
          serviceTicketId: 'mobile-ticket',
        },
        {
          headers: { 'set-cookie': 'GARMIN-SSO=mobile-session; Path=/; HttpOnly' },
        },
      )

    for (let i = 0; i < 4; i++) {
      diauthPool.intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' }).reply(400, {
        error: 'invalid_request',
        error_description: 'invalid service ticket provided',
      })
    }
    for (let i = 0; i < 4; i++) {
      connectApiPool
        .intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' })
        .reply(400, {
          error: 'invalid_request',
          error_description: 'invalid service ticket provided',
        })
    }

    ssoPool
      .intercept({
        path: /\/mobile\/api\/login.*service=https%3A%2F%2Fconnect\.garmin\.cn%2Fapp/,
        method: 'POST',
      })
      .reply(
        200,
        {
          responseStatus: { type: 'SUCCESSFUL' },
          serviceTicketId: 'connect-ticket',
        },
        {
          headers: { 'set-cookie': 'GARMIN-SSO=connect-session; Path=/; HttpOnly' },
        },
      )

    for (let i = 0; i < 4; i++) {
      diauthPool.intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' }).reply(400, {
        error: 'invalid_request',
        error_description: 'invalid service ticket provided',
      })
    }
    for (let i = 0; i < 4; i++) {
      connectApiPool
        .intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' })
        .reply(400, {
          error: 'invalid_request',
          error_description: 'invalid service ticket provided',
        })
    }

    connectPool.intercept({ path: '/app?ticket=connect-ticket', method: 'GET' }).reply(
      200,
      (opts) => {
        const headers = opts.headers as Record<string, string>
        expect(headers.cookie).toContain('GARMIN-SSO=connect-session')
        return '<html>ok</html>'
      },
      {
        headers: {
          'set-cookie': [
            'JWT_WEB=jwt-cookie; Path=/; Secure; HttpOnly',
            'GARMIN-SSO-CSRF=csrf-token; Path=/; Secure',
          ],
        },
      },
    )

    connectApiPool
      .intercept({ path: '/userprofile-service/socialProfile', method: 'GET' })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        expect(headers.cookie).toContain('JWT_WEB=jwt-cookie')
        expect(headers['connect-csrf-token']).toBe('csrf-token')
        expect(headers['DI-Backend']).toBe('connectapi.garmin.cn')
        return { displayName: 'cn-rider' }
      })

    const login = await GarminUploader.login({
      email: 'rider@example.cn',
      password: 'secret',
      domain: GarminDomains.china,
    })

    expect(login).toMatchObject({
      kind: 'authenticated',
      session: {
        domain: GarminDomains.china,
        jwtWeb: 'jwt-cookie',
        csrfToken: 'csrf-token',
      },
    })
    if (login.kind !== 'authenticated') throw new Error('expected authenticated login')
    const uploader = new GarminUploader({ getSession: async () => login.session })
    await expect(uploader.fetchProfile()).resolves.toMatchObject({ displayName: 'cn-rider' })
  })

  it('falls back to portal login when mobile China tickets cannot establish a session', async () => {
    const ssoPool = agent.get(SSO_CHINA_ORIGIN)
    const diauthPool = agent.get(DIAUTH_CHINA_ORIGIN)
    const connectPool = agent.get(CONNECT_CHINA_ORIGIN)
    const connectApiPool = agent.get(CONNECT_API_CHINA_ORIGIN)

    let mobileTicketIndex = 0
    for (let i = 0; i < 4; i++) {
      ssoPool
        .intercept({
          path: /\/mobile\/api\/login.*/,
          method: 'POST',
        })
        .reply(
          200,
          () => {
            mobileTicketIndex += 1
            return {
              responseStatus: { type: 'SUCCESSFUL' },
              serviceTicketId: `mobile-ticket-${mobileTicketIndex}`,
            }
          },
          {
            headers: { 'set-cookie': 'GARMIN-SSO=mobile-session; Path=/; HttpOnly' },
          },
        )
    }

    for (let i = 0; i < 20; i++) {
      diauthPool.intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' }).reply(400, {
        error: 'invalid_request',
        error_description: 'invalid service ticket provided',
      })
    }
    for (let i = 0; i < 20; i++) {
      connectApiPool
        .intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' })
        .reply(400, {
          error: 'invalid_request',
          error_description: 'invalid service ticket provided',
        })
    }

    for (const ticket of ['mobile-ticket-2', 'mobile-ticket-4']) {
      connectPool.intercept({ path: `/app?ticket=${ticket}`, method: 'GET' }).reply(200, '<html />')
    }

    ssoPool
      .intercept({
        path: /\/portal\/sso\/en-US\/sign-in.*/,
        method: 'GET',
      })
      .reply(200, '<html />', {
        headers: { 'set-cookie': 'PORTAL=preflight; Path=/; HttpOnly' },
      })

    ssoPool
      .intercept({
        path: /\/portal\/api\/login.*/,
        method: 'POST',
      })
      .reply(
        200,
        (opts) => {
          const headers = opts.headers as Record<string, string>
          expect(headers.cookie).toContain('PORTAL=preflight')
          return {
            responseStatus: { type: 'SUCCESSFUL' },
            serviceTicketId: 'portal-ticket',
          }
        },
        {
          headers: { 'set-cookie': 'GARMIN-SSO=portal-session; Path=/; HttpOnly' },
        },
      )

    connectPool.intercept({ path: '/app?ticket=portal-ticket', method: 'GET' }).reply(
      200,
      (opts) => {
        const headers = opts.headers as Record<string, string>
        expect(headers.cookie).toContain('GARMIN-SSO=portal-session')
        return '<html>ok</html>'
      },
      {
        headers: {
          'set-cookie': [
            'JWT_WEB=portal-jwt-cookie; Path=/; Secure; HttpOnly',
            'GARMIN-SSO-CSRF=portal-csrf-token; Path=/; Secure',
          ],
        },
      },
    )

    connectApiPool
      .intercept({ path: '/userprofile-service/socialProfile', method: 'GET' })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        expect(headers.cookie).toContain('JWT_WEB=portal-jwt-cookie')
        expect(headers['connect-csrf-token']).toBe('portal-csrf-token')
        return { displayName: 'portal-cn-rider' }
      })

    const login = await GarminUploader.login({
      email: 'rider@example.cn',
      password: 'secret',
      domain: GarminDomains.china,
    })

    expect(login).toMatchObject({
      kind: 'authenticated',
      session: {
        domain: GarminDomains.china,
        jwtWeb: 'portal-jwt-cookie',
        csrfToken: 'portal-csrf-token',
      },
    })
    if (login.kind !== 'authenticated') throw new Error('expected authenticated login')
    const uploader = new GarminUploader({ getSession: async () => login.session })
    await expect(uploader.fetchProfile()).resolves.toMatchObject({
      displayName: 'portal-cn-rider',
    })
  })
})

function jwt(payload: Record<string, unknown>): string {
  return `${base64url({ alg: 'none' })}.${base64url(payload)}.sig`
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
