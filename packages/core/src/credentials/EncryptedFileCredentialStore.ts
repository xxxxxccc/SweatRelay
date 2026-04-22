import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CredentialStore } from './CredentialStore.ts'

interface FileFormat {
  v: 1
  /** scrypt salt, base64. */
  salt: string
  /** AES-GCM iv, base64. */
  iv: string
  /** AES-GCM authTag, base64. */
  tag: string
  /** Ciphertext, base64. JSON-encoded record map. */
  data: string
}

const KEY_LEN = 32
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

export interface EncryptedFileCredentialStoreOptions {
  /** Absolute path to the encrypted file. */
  path: string
  /** Passphrase to derive the encryption key. */
  passphrase: string
}

/**
 * AES-GCM-encrypted JSON-on-disk credential store.
 *
 * Records are kept in memory in plaintext after the first access; the file is
 * re-written on every mutation. Loss of the passphrase = loss of credentials.
 */
export class EncryptedFileCredentialStore implements CredentialStore {
  private records: Record<string, string> | null = null

  private readonly opts: EncryptedFileCredentialStoreOptions

  constructor(opts: EncryptedFileCredentialStoreOptions) {
    this.opts = opts
  }

  async get(key: string): Promise<string | null> {
    const records = await this.load()
    return records[key] ?? null
  }

  async set(key: string, value: string): Promise<void> {
    const records = await this.load()
    records[key] = value
    await this.persist(records)
  }

  async delete(key: string): Promise<void> {
    const records = await this.load()
    if (!(key in records)) return
    delete records[key]
    await this.persist(records)
  }

  async keys(): Promise<string[]> {
    const records = await this.load()
    return Object.keys(records)
  }

  private async load(): Promise<Record<string, string>> {
    if (this.records) return this.records
    let raw: string
    try {
      raw = await readFile(this.opts.path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = {}
        return this.records
      }
      throw err
    }
    const file = JSON.parse(raw) as FileFormat
    if (file.v !== 1) throw new Error(`Unsupported credential file version ${file.v}`)
    const key = scryptSync(
      this.opts.passphrase,
      Buffer.from(file.salt, 'base64'),
      KEY_LEN,
      SCRYPT_OPTS,
    )
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(file.data, 'base64')),
      decipher.final(),
    ])
    this.records = JSON.parse(plaintext.toString('utf8')) as Record<string, string>
    return this.records
  }

  private async persist(records: Record<string, string>): Promise<void> {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync(this.opts.passphrase, salt, KEY_LEN, SCRYPT_OPTS)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(records), 'utf8'),
      cipher.final(),
    ])
    const file: FileFormat = {
      v: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64'),
    }
    await mkdir(dirname(this.opts.path), { recursive: true })
    await writeFile(this.opts.path, JSON.stringify(file), { mode: 0o600 })
    this.records = records
  }
}
