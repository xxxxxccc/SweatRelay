import type { SweatRelayApi } from '@shared/ipc.ts'

declare global {
  interface Window {
    sweatrelay: SweatRelayApi
  }
}

export const api: SweatRelayApi = window.sweatrelay
