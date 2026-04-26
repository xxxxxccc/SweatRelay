import { createHash } from 'node:crypto'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnelapApiClient, parseOnelapDate } from '../src/OnelapApiClient.ts'

const SECRET = 'fe9f8382418fcdeb136461cac6acae7b'

describe('OnelapApiClient', () => {
  let agent: MockAgent

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    await agent.close()
  })

  it('logs in with the documented MD5 signature scheme', async () => {
    const pool = agent.get('https://www.onelap.cn')
    pool
      .intercept({
        path: '/api/login',
        method: 'POST',
      })
      .reply((opts) => {
        const headers = opts.headers as Record<string, string>
        const body = JSON.parse(String(opts.body)) as { account: string; password: string }
        const expectedSign = md5(
          `account=${body.account}&nonce=${headers.nonce}&password=${body.password}&timestamp=${headers.timestamp}&key=${SECRET}`,
        )
        if (headers.sign !== expectedSign) {
          return { statusCode: 400, data: { error: 'bad sign' } }
        }
        return {
          statusCode: 200,
          data: {
            data: [
              {
                token: 'TOK',
                refresh_token: 'RT',
                userinfo: { uid: 42 },
              },
            ],
          },
        }
      })

    const client = new OnelapApiClient()
    const session = await client.login('user@example.com', 'plain-pwd')
    expect(session).toEqual({ uid: '42', xsrfToken: 'TOK', oToken: 'RT' })
  })

  it('lists activities using the current Web API token', async () => {
    const pool = agent.get('https://u.onelap.cn')
    pool.intercept({ path: '/api/otm/ride_record/list', method: 'POST' }).reply((opts) => {
      const headers = opts.headers as Record<string, string>
      if (headers.authorization !== 'TOK') {
        return { statusCode: 401, data: { error: 'no auth' } }
      }
      return {
        statusCode: 200,
        data: {
          code: 200,
          data: {
            list: [
              {
                id: 'abc123',
                rid: 'fk',
                start_riding_time: '2026-04-22 14:30:15',
              },
            ],
            pagination: { total: 1 },
          },
        },
      }
    })

    const client = new OnelapApiClient()
    const list = await client.listActivities({ uid: '42', xsrfToken: 'TOK', oToken: 'RT' })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      externalId: 'abc123',
      userId: '42',
      fileKey: 'fk',
      dateString: '2026-04-22 14:30:15',
      durl: 'record:abc123',
    })
  })

  it('reports non-JSON activity list responses with response context', async () => {
    const pool = agent.get('https://u.onelap.cn')
    pool
      .intercept({ path: '/api/otm/ride_record/list', method: 'POST' })
      .reply(200, '<!DOCTYPE html><html><title>login</title></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })

    const client = new OnelapApiClient()
    await expect(
      client.listActivities({ uid: '42', xsrfToken: 'expired', oToken: 'expired' }),
    ).rejects.toThrow(
      'Onelap list returned non-JSON: status=200 content-type=text/html; charset=utf-8 body=<!DOCTYPE html><html><title>login</title></html>',
    )
  })

  it('downloads FIT bytes', async () => {
    const pool = agent.get('https://u.onelap.cn')
    pool
      .intercept({ path: '/files/abc123.fit', method: 'GET' })
      .reply(200, Buffer.from([0x0e, 0x10, 0x83, 0x00]))

    const client = new OnelapApiClient()
    const bytes = await client.downloadFit(
      { uid: '42', xsrfToken: 'TOK', oToken: 'RT' },
      'https://u.onelap.cn/files/abc123.fit',
    )
    expect(bytes).toBeInstanceOf(Buffer)
    expect(bytes.length).toBe(4)
    expect(bytes[0]).toBe(0x0e)
  })

  it('downloads FIT bytes through the current Onelap record detail API', async () => {
    const pool = agent.get('https://u.onelap.cn')
    pool.intercept({ path: '/api/otm/ride_record/analysis/abc123', method: 'GET' }).reply(200, {
      code: 200,
      data: { ridingRecord: { fitUrl: 'MATCH_abc123-log.st' } },
    })
    pool
      .intercept({
        path: `/api/otm/ride_record/analysis/fit_content/${encodeURIComponent(Buffer.from('MATCH_abc123-log.st', 'utf8').toString('base64'))}`,
        method: 'GET',
      })
      .reply(200, Buffer.from([0x0e, 0x20, 0x8d, 0x52, 0x2e, 0x46, 0x49, 0x54]))

    const client = new OnelapApiClient()
    const bytes = await client.downloadFit(
      { uid: '42', xsrfToken: 'TOK', oToken: 'RT' },
      'record:abc123',
    )
    expect(bytes).toBeInstanceOf(Buffer)
    expect(bytes.subarray(4, 8).toString('utf8')).toBe('.FIT')
  })

  it('parseOnelapDate treats the wall-clock string as Asia/Shanghai', () => {
    const d = parseOnelapDate('2026-04-22 14:30')
    // 14:30 +0800 == 06:30 UTC
    expect(d.toISOString()).toBe('2026-04-22T06:30:00.000Z')
  })

  it('parseOnelapDate accepts seconds in the current Web API timestamp', () => {
    const d = parseOnelapDate('2026-04-22 14:30:15')
    expect(d.toISOString()).toBe('2026-04-22T06:30:15.000Z')
  })
})

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}
