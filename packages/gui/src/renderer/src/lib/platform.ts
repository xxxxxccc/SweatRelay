import { api } from './api.ts'

export const platform = api.platform
export const isMac = platform === 'darwin'
export const isWindows = platform === 'win32'
