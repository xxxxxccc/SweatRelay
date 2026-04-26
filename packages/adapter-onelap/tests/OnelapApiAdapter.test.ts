import {
  MemoryCredentialStore,
  ONELAP_ACCOUNT_KEY,
  ONELAP_PASSWORD_KEY,
  ONELAP_SESSION_KEY,
} from '@sweatrelay/core'
import { describe, expect, it } from 'vitest'
import { OnelapApiAdapter } from '../src/OnelapApiAdapter.ts'
import {
  type OnelapApiClient,
  OnelapApiResponseError,
  type OnelapSession,
} from '../src/OnelapApiClient.ts'

describe('OnelapApiAdapter', () => {
  it('refreshes a stale cached session before listing activities', async () => {
    const credentials = new MemoryCredentialStore()
    await credentials.set(ONELAP_ACCOUNT_KEY, 'rider@example.com')
    await credentials.set(ONELAP_PASSWORD_KEY, 'plain-password')
    await credentials.set(
      ONELAP_SESSION_KEY,
      JSON.stringify({ uid: '42', xsrfToken: 'old', oToken: 'old' }),
    )
    const client = new SessionRefreshingClient()
    const adapter = new OnelapApiAdapter({
      credentials,
      client: client as unknown as OnelapApiClient,
    })

    const refs = []
    for await (const ref of adapter.list()) refs.push(ref)

    expect(refs).toHaveLength(1)
    expect(refs[0]?.sourceId).toBe('onelap:activity-1')
    expect(client.loginCalls).toBe(1)
    expect(client.listSessions).toEqual(['old', 'new'])
    await expect(credentials.get(ONELAP_SESSION_KEY)).resolves.toBe(
      JSON.stringify({ uid: '42', xsrfToken: 'new', oToken: 'new-refresh' }),
    )
  })
})

class SessionRefreshingClient {
  loginCalls = 0
  listSessions: string[] = []

  async login(account: string, password: string): Promise<OnelapSession> {
    expect(account).toBe('rider@example.com')
    expect(password).toBe('plain-password')
    this.loginCalls += 1
    return { uid: '42', xsrfToken: 'new', oToken: 'new-refresh' }
  }

  async listActivities(session: OnelapSession) {
    this.listSessions.push(session.xsrfToken)
    if (session.xsrfToken === 'old') {
      throw new OnelapApiResponseError({
        operation: 'list',
        statusCode: 200,
        contentType: 'text/html',
        bodySnippet: '<!DOCTYPE html>',
        message:
          'Onelap list returned non-JSON: status=200 content-type=text/html body=<!DOCTYPE html>',
      })
    }
    return [
      {
        externalId: 'activity-1',
        userId: '42',
        fileKey: 'fit-key',
        dateString: '2026-04-22 14:30',
        durl: 'https://u.onelap.cn/files/activity-1.fit',
      },
    ]
  }
}
