import type { CredentialStore } from './CredentialStore.ts'

export class MirroredCredentialStore implements CredentialStore {
  private readonly primary: CredentialStore
  private readonly mirrors: CredentialStore[]

  constructor(primary: CredentialStore, mirrors: CredentialStore[]) {
    this.primary = primary
    this.mirrors = mirrors
  }

  async get(key: string): Promise<string | null> {
    const stores = [this.primary, ...this.mirrors]
    for (let index = 0; index < stores.length; index++) {
      const store = stores[index]
      if (!store) continue
      let value: string | null
      try {
        value = await store.get(key)
      } catch {
        continue
      }
      if (value === null) continue
      await Promise.allSettled(stores.slice(0, index).map((store) => store.set(key, value)))
      return value
    }
    return null
  }

  async set(key: string, value: string): Promise<void> {
    await this.primary.set(key, value)
    await Promise.allSettled(this.mirrors.map((store) => store.set(key, value)))
  }

  async delete(key: string): Promise<void> {
    await this.primary.delete(key)
    await Promise.allSettled(this.mirrors.map((store) => store.delete(key)))
  }

  async keys(): Promise<string[]> {
    const all = await Promise.allSettled(
      [this.primary, ...this.mirrors].map((store) => store.keys()),
    )
    const fulfilled = all.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    return [...new Set(fulfilled)]
  }

  async mirrorFrom(store: CredentialStore): Promise<number> {
    let count = 0
    for (const key of await store.keys()) {
      const value = await store.get(key)
      if (value === null) continue
      await this.set(key, value)
      count++
    }
    return count
  }
}
