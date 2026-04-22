export interface CredentialStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** List all keys currently stored. Used for diagnostics, not auth. */
  keys(): Promise<string[]>
}
