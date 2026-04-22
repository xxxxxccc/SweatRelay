import type { ThemePreference } from '@shared/ipc.ts'
import { useAtomValue } from 'jotai'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useSetTheme } from '@/components/ThemeProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { themePreferenceAtom } from '@/state/atoms'

const OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

export function ThemeToggle() {
  const preference = useAtomValue(themePreferenceAtom)
  const setTheme = useSetTheme()
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {OPTIONS.map((opt) => {
        const active = preference === opt.value
        return (
          <Button
            key={opt.value}
            variant={active ? 'default' : 'ghost'}
            size="sm"
            className={cn('rounded-sm px-3', !active && 'text-fg-muted')}
            onClick={() => setTheme(opt.value)}
          >
            <opt.icon className="size-3.5" />
            {opt.label}
          </Button>
        )
      })}
    </div>
  )
}
