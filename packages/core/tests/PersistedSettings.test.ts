import { describe, expect, it } from 'vitest'
import {
  mergePersistedSettings,
  normalizePersistedSettings,
  ONELAP_ACCOUNT_KEY,
  ONELAP_PASSWORD_KEY,
  ONELAP_SESSION_KEY,
  readLegacyStravaAppConfig,
  STRAVA_CLIENT_ID_KEY,
  STRAVA_CLIENT_SECRET_KEY,
  STRAVA_TOKENS_KEY,
} from '../src/index.ts'

describe('persisted settings', () => {
  it('normalizes the legacy flat settings shape into shared/gui buckets', () => {
    expect(
      normalizePersistedSettings({
        v: 1,
        watchDir: '/tmp/rides',
        scheduleCron: '*/30 * * * *',
        scheduleTz: 'Asia/Shanghai',
        theme: 'dark',
      }),
    ).toEqual({
      v: 1,
      shared: {
        watchDir: '/tmp/rides',
        scheduleCron: '*/30 * * * *',
        scheduleTz: 'Asia/Shanghai',
      },
      gui: {
        theme: 'dark',
      },
    })
  })

  it('merges nested patches without losing existing settings', () => {
    expect(
      mergePersistedSettings(
        {
          v: 1,
          shared: {
            watchDir: '/tmp/rides',
          },
          gui: {
            theme: 'system',
          },
        },
        {
          shared: {
            scheduleCron: '0 * * * *',
          },
          gui: {
            theme: 'light',
          },
        },
      ),
    ).toEqual({
      v: 1,
      shared: {
        watchDir: '/tmp/rides',
        scheduleCron: '0 * * * *',
      },
      gui: {
        theme: 'light',
      },
    })
  })

  it('reads legacy Strava app config from old settings files', () => {
    expect(
      readLegacyStravaAppConfig({
        stravaClientId: '12345',
        stravaClientSecret: 'secret',
      }),
    ).toEqual({
      clientId: '12345',
      clientSecret: 'secret',
    })
  })
})

describe('shared credential keys', () => {
  it('exposes stable shared keys for GUI, CLI, and adapters', () => {
    expect(STRAVA_CLIENT_ID_KEY).toBe('strava.clientId')
    expect(STRAVA_CLIENT_SECRET_KEY).toBe('strava.clientSecret')
    expect(STRAVA_TOKENS_KEY).toBe('strava.tokens')
    expect(ONELAP_ACCOUNT_KEY).toBe('onelap.account')
    expect(ONELAP_PASSWORD_KEY).toBe('onelap.password')
    expect(ONELAP_SESSION_KEY).toBe('onelap.session')
  })
})
