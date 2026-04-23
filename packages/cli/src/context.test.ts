import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EncryptedFileCredentialStore,
  KeyringCredentialStore,
  ONELAP_ACCOUNT_KEY,
  STRAVA_CLIENT_ID_KEY,
  STRAVA_CLIENT_SECRET_KEY,
  SyncedStore,
} from '@sweatrelay/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Services } from '../../gui/src/main/services.ts'
import { buildCredentialStore, collectDiagnostics, loadPersistedSettings } from './context.ts'

describe('CLI credential recovery', () => {
  let dir: string
  let settingsPath: string
  let credsPath: string
  let syncedPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sweatrelay-cli-context-'))
    settingsPath = join(dir, 'settings.json')
    credsPath = join(dir, 'creds.enc')
    syncedPath = join(dir, 'synced.sqlite')
    vi.restoreAllMocks()
    delete process.env.SWEATRELAY_PASSPHRASE
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env.SWEATRELAY_PASSPHRASE
    await rm(dir, { recursive: true, force: true })
  })

  it('requires a passphrase when creds.enc exists and keyring is unavailable', async () => {
    vi.spyOn(KeyringCredentialStore.prototype, 'get').mockRejectedValue(new Error('keyring down'))
    vi.spyOn(KeyringCredentialStore.prototype, 'keys').mockRejectedValue(new Error('keyring down'))

    const fileStore = new EncryptedFileCredentialStore({
      path: credsPath,
      passphrase: 'test-passphrase',
    })
    await fileStore.set(STRAVA_CLIENT_ID_KEY, '12345')
    await fileStore.set(STRAVA_CLIENT_SECRET_KEY, 'secret')

    await expect(buildCredentialStore({ credsPath })).rejects.toThrow(
      'Stored credentials are encrypted in creds.enc. Export SWEATRELAY_PASSPHRASE to unlock them.',
    )
  })

  it('reports shared config and encrypted credentials in doctor diagnostics', async () => {
    vi.spyOn(KeyringCredentialStore.prototype, 'get').mockRejectedValue(new Error('keyring down'))
    vi.spyOn(KeyringCredentialStore.prototype, 'keys').mockRejectedValue(new Error('keyring down'))

    const fileStore = new EncryptedFileCredentialStore({
      path: credsPath,
      passphrase: 'test-passphrase',
    })
    await fileStore.set(STRAVA_CLIENT_ID_KEY, '12345')
    await fileStore.set(STRAVA_CLIENT_SECRET_KEY, 'secret')

    await writeFile(
      settingsPath,
      JSON.stringify({
        v: 1,
        shared: {
          watchDir: '/tmp/rides',
        },
        gui: {
          theme: 'dark',
        },
      }),
    )

    const settings = await loadPersistedSettings(settingsPath)
    expect(settings.shared.watchDir).toBe('/tmp/rides')

    const diagnostics = await collectDiagnostics({
      configDir: dir,
      settingsPath,
      credsPath,
      syncedPath,
      store: new SyncedStore({ path: syncedPath, legacyJsonPath: join(dir, 'synced.json') }),
    })

    expect(diagnostics).toMatchObject({
      configDir: dir,
      keyringAvailable: false,
      hasEncryptedCredentials: true,
      sharedConfigPresent: true,
    })
  })

  it('keeps GUI diagnostics aligned with CLI doctor data', async () => {
    vi.spyOn(KeyringCredentialStore.prototype, 'get').mockRejectedValue(new Error('keyring down'))
    vi.spyOn(KeyringCredentialStore.prototype, 'keys').mockRejectedValue(new Error('keyring down'))

    const fileStore = new EncryptedFileCredentialStore({
      path: credsPath,
      passphrase: 'test-passphrase',
    })
    await fileStore.set(STRAVA_CLIENT_ID_KEY, '12345')
    await fileStore.set(STRAVA_CLIENT_SECRET_KEY, 'secret')
    await fileStore.set(ONELAP_ACCOUNT_KEY, '18817507441')

    await writeFile(
      settingsPath,
      JSON.stringify({
        v: 1,
        shared: {
          watchDir: '/tmp/rides',
          scheduleCron: '*/30 * * * *',
        },
        gui: {
          theme: 'dark',
        },
      }),
    )

    const cliDiagnostics = await collectDiagnostics({
      configDir: dir,
      settingsPath,
      credsPath,
      syncedPath,
      store: new SyncedStore({ path: syncedPath, legacyJsonPath: join(dir, 'synced.json') }),
    })

    const services = new Services({
      configDir: dir,
      settingsPath,
      credsPath,
      syncedPath,
    })
    await services.restorePersistedConfiguration()

    expect(services.needsUnlock()).toBe(true)
    expect(services.diagnostics()).toEqual({
      keyringAvailable: cliDiagnostics.keyringAvailable,
      hasEncryptedCredentials: cliDiagnostics.hasEncryptedCredentials,
      stravaConfigPresent: cliDiagnostics.stravaConfigPresent,
      stravaTokensPresent: cliDiagnostics.stravaTokensPresent,
      onelapCredentialsPresent: cliDiagnostics.onelapCredentialsPresent,
      sharedConfigPresent: cliDiagnostics.sharedConfigPresent,
    })

    await services.dispose()
  })
})
