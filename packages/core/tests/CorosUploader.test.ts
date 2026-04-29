import { createHash } from 'node:crypto'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CorosRegionIds, CorosUploader } from '../src/uploader/CorosUploader.ts'

const TEAM_CN_ORIGIN = 'https://teamcnapi.coros.com'
const FAQ_ORIGIN = 'https://faq.coros.com'
const OSS_ORIGIN = 'https://coros-web.oss-cn-beijing.aliyuncs.com'
const STS_MARKER = '9y78gpoERW4lBNYL'

describe('CorosUploader', () => {
  let agent: MockAgent

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    await agent.close()
  })

  it('uploads a FIT as COROS web import package and registers the import', async () => {
    const fit = Buffer.from('fake-fit')
    const md5 = createHash('md5').update(fit).digest('hex')
    const teamPool = agent.get(TEAM_CN_ORIGIN)
    const faqPool = agent.get(FAQ_ORIGIN)
    const ossPool = agent.get(OSS_ORIGIN)
    const credentials = Buffer.from(
      JSON.stringify({
        Region: 'oss-cn-beijing',
        AccessKeyId: 'ak',
        AccessKeySecret: 'secret',
        SecurityToken: 'token',
        Bucket: 'coros-web',
      }),
    ).toString('base64')

    faqPool
      .intercept({
        path: '/openapi/oss/sts?bucket=coros-oss&service=aliyun&v=2&app_id=1660188068672619112&sign=9AD4AA35AAFEE6BB1E847A76848D58DF',
        method: 'GET',
      })
      .reply(200, () => {
        return { code: 200, data: { credentials: `${STS_MARKER}${credentials}` } }
      })

    ossPool
      .intercept({
        path: `/fit_zip/u123/${md5}.zip`,
        method: 'PUT',
      })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>
        const body = opts.body as Buffer
        expect(headers.authorization).toMatch(/^OSS ak:/)
        expect(headers['x-oss-security-token']).toBe('token')
        expect(body.subarray(0, 2).toString()).toBe('PK')
        expect(body.toString('utf8')).toContain(`${md5}/ride.fit`)
        return ''
      })

    teamPool.intercept({ path: '/activity/fit/import', method: 'POST' }).reply(200, (opts) => {
      const headers = opts.headers as Record<string, string>
      const body = (opts.body as Buffer).toString('utf8')
      expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=sweatrelay-/)
      expect(body).toContain('"bucket":"coros-web"')
      expect(body).toContain(`"md5":"${md5}"`)
      expect(body).toContain(`"object":"fit_zip/u123/${md5}.zip"`)
      expect(body).toContain('"serviceName":"aliyun"')
      expect(body).toContain('"oriFileName":"ride.fit"')
      return { result: '0000', message: 'OK', data: { id: 42, idString: '42' } }
    })

    const uploader = new CorosUploader({
      getSession: async () => ({
        userId: 'u123',
        accessToken: 'coros-token',
        regionId: CorosRegionIds.china,
      }),
    })
    const result = await uploader.upload(fit, { dataType: 'fit', filename: 'ride.fit' })

    expect(result).toMatchObject({
      importId: '42',
      md5,
      objectKey: `fit_zip/u123/${md5}.zip`,
      filename: 'ride.fit',
    })
  })
})
