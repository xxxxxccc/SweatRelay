import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IntervalsClient } from '../src/analytics/IntervalsClient.ts'

const INTERVALS_ORIGIN = 'https://intervals.icu'

describe('IntervalsClient', () => {
  let agent: MockAgent

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    await agent.close()
  })

  it('loads wellness fitness points and derives TSB from CTL minus ATL', async () => {
    const pool = agent.get(INTERVALS_ORIGIN)
    pool
      .intercept({
        path: /^\/api\/v1\/athlete\/0\/wellness\?/,
        method: 'GET',
      })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        const url = new URL(`${INTERVALS_ORIGIN}${opts.path}`)
        expect(headers.authorization).toBe('Basic QVBJX0tFWTp0ZXN0LWtleQ==')
        expect(url.searchParams.get('oldest')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(url.searchParams.get('newest')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(url.searchParams.get('fields')).toBe('id,ctl,atl,rampRate,ctlLoad,atlLoad')
        return [
          { id: '2026-04-26', ctl: 50, atl: 58, rampRate: 3.2 },
          { id: '2026-04-25', ctl: 49.5, atl: 54.25, ctlLoad: 70, atlLoad: 82 },
          { id: '2026-04-24', ctl: null, atl: 50 },
        ]
      })

    const client = new IntervalsClient({ apiKey: 'test-key' })
    const summary = await client.fetchFitness(14)

    expect(summary.days).toBe(14)
    expect(summary.points).toHaveLength(2)
    expect(summary.points.map((p) => p.date)).toEqual(['2026-04-25', '2026-04-26'])
    expect(summary.latest).toMatchObject({
      date: '2026-04-26',
      ctl: 50,
      atl: 58,
      tsb: -8,
      rampRate: 3.2,
    })
  })

  it('builds a local status assessment from Intervals.icu current and forecast data', async () => {
    const pool = agent.get(INTERVALS_ORIGIN)
    pool
      .intercept({
        path: /^\/api\/v1\/athlete\/0\/wellness\?/,
        method: 'GET',
      })
      .reply(200, [
        { id: '2026-04-25', ctl: 53, atl: 55 },
        { id: '2026-04-26', ctl: 54, atl: 56, rampRate: 2.1 },
      ])
    pool
      .intercept({
        path: /^\/api\/v1\/athlete\/0\/events\?/,
        method: 'GET',
      })
      .reply(200, (opts) => {
        const url = new URL(`${INTERVALS_ORIGIN}${opts.path}`)
        expect(url.searchParams.get('category')).toBe('WORKOUT,RACE_A,RACE_B,RACE_C')
        return [
          {
            id: 1001,
            start_date_local: '2026-04-29T07:30:00',
            name: 'VO2 block',
            category: 'WORKOUT',
            icu_training_load: 128,
            icu_ctl: 55,
            icu_atl: 84,
          },
        ]
      })

    const client = new IntervalsClient({ apiKey: 'test-key' })
    const report = await client.fetchTrainingLoadReport({ days: 14, forecastDays: 7 })

    expect(report.summary.forecast).toMatchObject({
      days: 7,
      totalPlannedLoad: 128,
      minTsb: -29,
      maxAtl: 84,
    })
    expect(report.summary.forecast?.events[0]).toMatchObject({
      date: '2026-04-29',
      name: 'VO2 block',
      trainingLoad: 128,
      ctl: 55,
      atl: 84,
      tsb: -29,
    })
    expect(report.assessment.level).toBe('high')
    expect(report.assessment.reasons).toContainEqual(
      expect.objectContaining({
        id: 'forecast-min-tsb',
        severity: 'danger',
        source: 'sweatrelay',
        metric: 'TSB',
        value: -29,
      }),
    )
  })

  it('upserts planned workouts to the Intervals.icu calendar', async () => {
    const pool = agent.get(INTERVALS_ORIGIN)
    pool
      .intercept({
        path: '/api/v1/athlete/0/events/bulk?upsert=true',
        method: 'POST',
      })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        expect(headers.authorization).toBe('Basic QVBJX0tFWTp0ZXN0LWtleQ==')
        expect(headers['content-type']).toBe('application/json')
        expect(JSON.parse(opts.body as string)).toEqual([
          expect.objectContaining({
            category: 'WORKOUT',
            external_id: 'sweatrelay:workout:1',
            name: 'FTP 3x10',
          }),
        ])
        return [{ id: 42, external_id: 'sweatrelay:workout:1' }]
      })

    const client = new IntervalsClient({ apiKey: 'test-key' })
    await expect(
      client.upsertCalendarEvents([
        {
          category: 'WORKOUT',
          start_date_local: '2026-04-28T00:00:00',
          type: 'Ride',
          name: 'FTP 3x10',
          description: '- 10m 90%',
          moving_time: 1800,
          target: 'POWER',
          icu_training_load: 45,
          external_id: 'sweatrelay:workout:1',
        },
      ]),
    ).resolves.toEqual([{ id: 42, external_id: 'sweatrelay:workout:1' }])
  })

  it('surfaces Intervals.icu API errors', async () => {
    const pool = agent.get(INTERVALS_ORIGIN)
    pool
      .intercept({
        path: /^\/api\/v1\/athlete\/0\/wellness\?/,
        method: 'GET',
      })
      .reply(403, 'Access denied')

    const client = new IntervalsClient({ apiKey: 'bad-key' })

    await expect(client.fetchFitness()).rejects.toThrow(/Intervals\.icu request failed: 403/)
  })
})
