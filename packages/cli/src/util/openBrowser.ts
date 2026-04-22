import { spawn } from 'node:child_process'
import { platform } from 'node:os'

/** Best-effort: open a URL in the user's default browser. */
export function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
  const args = platform() === 'win32' ? ['', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.unref()
  } catch {
    // Ignore — the URL is also printed to stdout for manual fallback.
  }
}
