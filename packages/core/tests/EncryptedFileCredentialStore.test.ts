import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EncryptedFileCredentialStore } from '../src/credentials/EncryptedFileCredentialStore.ts'

describe('EncryptedFileCredentialStore', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sweatrelay-creds-'))
    path = join(dir, 'creds.enc')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a value with the same passphrase', async () => {
    const a = new EncryptedFileCredentialStore({ path, passphrase: 'correct-horse' })
    await a.set('strava.tokens', '{"foo":1}')

    const b = new EncryptedFileCredentialStore({ path, passphrase: 'correct-horse' })
    expect(await b.get('strava.tokens')).toBe('{"foo":1}')
  })

  it('refuses to decrypt with the wrong passphrase', async () => {
    const a = new EncryptedFileCredentialStore({ path, passphrase: 'right' })
    await a.set('k', 'v')

    const b = new EncryptedFileCredentialStore({ path, passphrase: 'wrong' })
    await expect(b.get('k')).rejects.toThrow()
  })

  it('returns null for missing keys and empty file', async () => {
    const a = new EncryptedFileCredentialStore({ path, passphrase: 'p' })
    expect(await a.get('absent')).toBeNull()
    expect(await a.keys()).toEqual([])
  })

  it('deletes a key', async () => {
    const a = new EncryptedFileCredentialStore({ path, passphrase: 'p' })
    await a.set('k', 'v')
    await a.delete('k')
    expect(await a.get('k')).toBeNull()
  })
})
