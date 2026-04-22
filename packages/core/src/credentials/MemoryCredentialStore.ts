import type { CredentialStore } from './CredentialStore.ts'

export class MemoryCredentialStore implements CredentialStore {
  private records = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.records.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.records.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()]
  }
}
