import { cn } from '@/lib/utils'

type Tone = 'live' | 'success' | 'warning' | 'danger' | 'idle'

const toneClass: Record<Tone, string> = {
  live: 'bg-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_25%,transparent)] animate-pulse-slow',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  idle: 'bg-fg-subtle',
}

/** A 6×6 circle indicator. Use `live` for actively-running tasks (pulses). */
export function StatusDot({ tone = 'idle', className }: { tone?: Tone; className?: string }) {
  return <span className={cn('inline-block size-1.5 rounded-full', toneClass[tone], className)} />
}
