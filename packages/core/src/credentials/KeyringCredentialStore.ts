import { dynamicRequire } from '../util/dynamicRequire.ts'
import type { CredentialStore } from './CredentialStore.ts'

// `@napi-rs/keyring` is loaded lazily so consumers that don't use this store
// (e.g. the SEA-packaged CLI) won't fail at import time if the native module
// isn't present.
type KeyringCtor = new (
  service: string,
  account: string,
) => {
  getPassword(): string | null
  setPassword(value: string): void
  deletePassword(): boolean
}

let cachedCtor: KeyringCtor | null = null
function loadKeyring(): KeyringCtor {
  if (cachedCtor) return cachedCtor
  const mod = dynamicRequire()('@napi-rs/keyring') as { Entry: KeyringCtor }
  cachedCtor = mod.Entry
  return cachedCtor
}

export interface KeyringCredentialStoreOptions {
  /** Service name shown in the OS keychain. Default: 'SweatRelay'. */
  service?: string
  /**
   * Index of stored keys (so `keys()` works). Stored as a single keyring entry
   * named `<service>:__index__`. Default: enabled.
   */
  trackIndex?: boolean
}

/**
 * OS keychain-backed CredentialStore. macOS Keychain on Darwin, Credential
 * Manager on Windows, libsecret on Linux. Each `key` becomes its own keyring
 * entry under the same service name.
 *
 * Loss of OS keychain access = loss of credentials. Users on headless Linux
 * without libsecret should fall back to {@link EncryptedFileCredentialStore}.
 */
export class KeyringCredentialStore implements CredentialStore {
  private readonly service: string
  private readonly trackIndex: boolean

  constructor(opts: KeyringCredentialStoreOptions = {}) {
    this.service = opts.service ?? 'SweatRelay'
    this.trackIndex = opts.trackIndex ?? true
  }

  async get(key: string): Promise<string | null> {
    const Entry = loadKeyring()
    const entry = new Entry(this.service, key)
    return entry.getPassword()
  }

  async set(key: string, value: string): Promise<void> {
    const Entry = loadKeyring()
    new Entry(this.service, key).setPassword(value)
    if (this.trackIndex) await this.indexAdd(key)
  }

  async delete(key: string): Promise<void> {
    const Entry = loadKeyring()
    new Entry(this.service, key).deletePassword()
    if (this.trackIndex) await this.indexRemove(key)
  }

  async keys(): Promise<string[]> {
    if (!this.trackIndex) return []
    const Entry = loadKeyring()
    const raw = new Entry(this.service, '__index__').getPassword()
    if (!raw) return []
    try {
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : []
    } catch {
      return []
    }
  }

  /** One-shot import from another store (e.g. the encrypted-file fallback). */
  async importFrom(other: CredentialStore): Promise<number> {
    const keys = await other.keys()
    let n = 0
    for (const k of keys) {
      const v = await other.get(k)
      if (v !== null) {
        await this.set(k, v)
        n++
      }
    }
    return n
  }

  private async indexAdd(key: string): Promise<void> {
    const cur = await this.keys()
    if (cur.includes(key)) return
    cur.push(key)
    const Entry = loadKeyring()
    new Entry(this.service, '__index__').setPassword(JSON.stringify(cur))
  }

  private async indexRemove(key: string): Promise<void> {
    const cur = await this.keys()
    const next = cur.filter((k) => k !== key)
    if (next.length === cur.length) return
    const Entry = loadKeyring()
    new Entry(this.service, '__index__').setPassword(JSON.stringify(next))
  }
}
