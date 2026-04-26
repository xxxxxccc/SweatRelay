import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StravaUploader } from '../src/uploader/StravaUploader.ts'
import { DuplicateActivityError, UploadTimeoutError } from '../src/util/errors.ts'

const STRAVA_ORIGIN = 'https://www.strava.com'

describe('StravaUploader', () => {
  let agent: MockAgent

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    await agent.close()
  })

  function makeUploader(
    opts: { initialDelayMs?: number; maxDelayMs?: number; timeoutMs?: number } = {},
  ) {
    return new StravaUploader({
      getAccessToken: async () => 'fake-token',
      poll: { initialDelayMs: 5, maxDelayMs: 5, timeoutMs: 1000, ...opts },
      requestRetryDelayMs: 1,
    })
  }

  it('uploads and returns activity URL after polling completes', async () => {
    const pool = agent.get(STRAVA_ORIGIN)
    pool.intercept({ path: '/api/v3/uploads', method: 'POST' }).reply(201, (opts) => {
      const headers = opts.headers as Record<string, string>
      const body = opts.body as Buffer
      expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=sweatrelay-/)
      expect(headers['content-length']).toBe(String(body.length))
      expect(body.toString()).toContain('Content-Disposition: form-data; name="data_type"')
      expect(body.toString()).toContain('Content-Disposition: form-data; name="external_id"')
      expect(body.toString()).toContain(
        'Content-Disposition: form-data; name="file"; filename="upload.fit"',
      )
      return {
        id: 99,
        id_str: '99',
        external_id: 'ext-1',
        error: null,
        status: 'Your activity is still being processed.',
        activity_id: null,
      }
    })
    pool
      .intercept({ path: '/api/v3/uploads/99', method: 'GET' })
      .reply(200, {
        id: 99,
        id_str: '99',
        external_id: 'ext-1',
        error: null,
        status: 'Your activity is ready.',
        activity_id: 12345,
      })
      .times(1)

    const uploader = makeUploader()
    const result = await uploader.upload(Buffer.from('fakefit'), {
      dataType: 'fit',
      externalId: 'ext-1',
    })

    expect(result.uploadId).toBe('99')
    expect(result.activityId).toBe(12345)
    expect(result.activityUrl).toBe('https://www.strava.com/activities/12345')
    expect(result.externalId).toBe('ext-1')
  })

  it('throws DuplicateActivityError when Strava reports a duplicate', async () => {
    const pool = agent.get(STRAVA_ORIGIN)
    pool.intercept({ path: '/api/v3/uploads', method: 'POST' }).reply(201, {
      id: 100,
      id_str: '100',
      external_id: 'ext-2',
      error: 'duplicate of activity 99887',
      status: 'There was an error processing your activity.',
      activity_id: null,
    })

    const uploader = makeUploader()
    const promise = uploader.upload(Buffer.from('x'), {
      dataType: 'fit',
      externalId: 'ext-2',
    })
    await expect(promise).rejects.toBeInstanceOf(DuplicateActivityError)
    await promise.catch((err: DuplicateActivityError) => {
      expect(err.existingActivityId).toBe(99887)
    })
  })

  it('throws DuplicateActivityError when Strava reports a duplicate with an activity link', async () => {
    const pool = agent.get(STRAVA_ORIGIN)
    pool.intercept({ path: '/api/v3/uploads', method: 'POST' }).reply(201, {
      id: 104,
      id_str: '104',
      external_id: 'ext-4.fit',
      error: null,
      status: 'Your activity is still being processed.',
      activity_id: null,
    })
    pool.intercept({ path: '/api/v3/uploads/104', method: 'GET' }).reply(200, {
      id: 104,
      id_str: '104',
      external_id: 'ext-4.fit',
      error:
        "ext-4.fit duplicate of <a href='/activities/18260018524' target='_blank'>Morning Ride</a>",
      status: 'There was an error processing your activity.',
      activity_id: null,
    })

    const uploader = makeUploader()
    const promise = uploader.upload(Buffer.from('x'), {
      dataType: 'fit',
      externalId: 'ext-4',
    })
    await expect(promise).rejects.toBeInstanceOf(DuplicateActivityError)
    await promise.catch((err: DuplicateActivityError) => {
      expect(err.existingActivityId).toBe(18260018524)
    })
  })

  it('retries transient upload transport failures', async () => {
    const pool = agent.get(STRAVA_ORIGIN)
    pool
      .intercept({ path: '/api/v3/uploads', method: 'POST' })
      .replyWithError(Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }))
    pool.intercept({ path: '/api/v3/uploads', method: 'POST' }).reply(201, {
      id: 103,
      id_str: '103',
      external_id: 'ext-retry',
      error: null,
      status: 'Your activity is still being processed.',
      activity_id: null,
    })
    pool.intercept({ path: '/api/v3/uploads/103', method: 'GET' }).reply(200, {
      id: 103,
      id_str: '103',
      external_id: 'ext-retry',
      error: null,
      status: 'Your activity is ready.',
      activity_id: 45678,
    })

    const uploader = makeUploader()
    const result = await uploader.upload(Buffer.from('fakefit'), {
      dataType: 'fit',
      externalId: 'ext-retry',
    })

    expect(result.activityId).toBe(45678)
  })

  it('throws UploadTimeoutError when activity_id never appears', async () => {
    const pool = agent.get(STRAVA_ORIGIN)
    pool.intercept({ path: '/api/v3/uploads', method: 'POST' }).reply(201, {
      id: 101,
      id_str: '101',
      external_id: null,
      error: null,
      status: 'processing',
      activity_id: null,
    })
    pool
      .intercept({ path: '/api/v3/uploads/101', method: 'GET' })
      .reply(200, {
        id: 101,
        id_str: '101',
        external_id: null,
        error: null,
        status: 'still processing',
        activity_id: null,
      })
      .persist()

    const uploader = makeUploader({ timeoutMs: 50 })
    await expect(uploader.upload(Buffer.from('x'), { dataType: 'fit' })).rejects.toBeInstanceOf(
      UploadTimeoutError,
    )
  })

  it('surfaces a delayed error from polling', async () => {
    const pool = agent.get(STRAVA_ORIGIN)
    pool.intercept({ path: '/api/v3/uploads', method: 'POST' }).reply(201, {
      id: 102,
      id_str: '102',
      external_id: null,
      error: null,
      status: 'processing',
      activity_id: null,
    })
    pool.intercept({ path: '/api/v3/uploads/102', method: 'GET' }).reply(200, {
      id: 102,
      id_str: '102',
      external_id: null,
      error: 'Bad fit file: corrupt header',
      status: 'failed',
      activity_id: null,
    })

    const uploader = makeUploader()
    await expect(uploader.upload(Buffer.from('bad'), { dataType: 'fit' })).rejects.toThrow(
      /Bad fit file/,
    )
  })
})
