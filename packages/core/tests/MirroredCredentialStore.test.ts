import { describe, expect, it } from 'vitest'
import { MemoryCredentialStore } from '../src/credentials/MemoryCredentialStore.ts'
import { MirroredCredentialStore } from '../src/credentials/MirroredCredentialStore.ts'

describe('MirroredCredentialStore', () => {
  it('writes values to primary and mirror stores', async () => {
    const primary = new MemoryCredentialStore()
    const mirror = new MemoryCredentialStore()
    const store = new MirroredCredentialStore(primary, [mirror])

    await store.set('strava.tokens', 'token-json')

    await expect(primary.get('strava.tokens')).resolves.toBe('token-json')
    await expect(mirror.get('strava.tokens')).resolves.toBe('token-json')
  })

  it('repairs the primary store when a value exists only in a mirror', async () => {
    const primary = new MemoryCredentialStore()
    const mirror = new MemoryCredentialStore()
    await mirror.set('strava.tokens', 'token-json')
    const store = new MirroredCredentialStore(primary, [mirror])

    await expect(store.get('strava.tokens')).resolves.toBe('token-json')
    await expect(primary.get('strava.tokens')).resolves.toBe('token-json')
  })

  it('mirrors existing values from one store into every backing store', async () => {
    const primary = new MemoryCredentialStore()
    const mirror = new MemoryCredentialStore()
    await primary.set('strava.tokens', 'token-json')
    const store = new MirroredCredentialStore(primary, [mirror])

    await expect(store.mirrorFrom(primary)).resolves.toBe(1)

    await expect(mirror.get('strava.tokens')).resolves.toBe('token-json')
  })
})
