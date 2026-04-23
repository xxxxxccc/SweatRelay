import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EncryptedFileCredentialStore,
  KeyringCredentialStore,
  STRAVA_CLIENT_ID_KEY,
  STRAVA_CLIENT_SECRET_KEY,
} from '@sweatrelay/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Services } from './services.ts'

describe('Services restore state', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sweatrelay-gui-services-'))
    vi.restoreAllMocks()
    delete process.env.SWEATRELAY_PASSPHRASE
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env.SWEATRELAY_PASSPHRASE
    await rm(dir, { recursive: true, force: true })
  })

  it('marks the GUI as needing unlock when only creds.enc is available', async () => {
    vi.spyOn(KeyringCredentialStore.prototype, 'get').mockRejectedValue(new Error('keyring down'))
    vi.spyOn(KeyringCredentialStore.prototype, 'keys').mockRejectedValue(new Error('keyring down'))

    const credsPath = join(dir, 'creds.enc')
    const fileStore = new EncryptedFileCredentialStore({
      path: credsPath,
      passphrase: 'test-passphrase',
    })
    await fileStore.set(STRAVA_CLIENT_ID_KEY, '12345')
    await fileStore.set(STRAVA_CLIENT_SECRET_KEY, 'secret')

    const services = new Services({
      configDir: dir,
      settingsPath: join(dir, 'settings.json'),
      credsPath,
      syncedPath: join(dir, 'synced.sqlite'),
    })

    await services.restorePersistedConfiguration()

    expect(services.configured()).toBe(false)
    expect(services.needsUnlock()).toBe(true)
    expect(services.diagnostics()).toMatchObject({
      keyringAvailable: false,
      hasEncryptedCredentials: true,
      sharedConfigPresent: false,
    })
  })

  it('restores from encrypted credentials when a passphrase is provided', async () => {
    vi.spyOn(KeyringCredentialStore.prototype, 'get').mockRejectedValue(new Error('keyring down'))
    vi.spyOn(KeyringCredentialStore.prototype, 'keys').mockRejectedValue(new Error('keyring down'))

    const credsPath = join(dir, 'creds.enc')
    const fileStore = new EncryptedFileCredentialStore({
      path: credsPath,
      passphrase: 'test-passphrase',
    })
    await fileStore.set(STRAVA_CLIENT_ID_KEY, '12345')
    await fileStore.set(STRAVA_CLIENT_SECRET_KEY, 'secret')

    const services = new Services({
      configDir: dir,
      settingsPath: join(dir, 'settings.json'),
      credsPath,
      syncedPath: join(dir, 'synced.sqlite'),
    })

    await services.restorePersistedConfiguration('test-passphrase')

    expect(services.configured()).toBe(true)
    expect(services.needsUnlock()).toBe(false)
    expect(services.diagnostics()).toMatchObject({
      keyringAvailable: false,
      hasEncryptedCredentials: true,
      stravaConfigPresent: true,
    })
  })
})
