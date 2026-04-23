import { createRootRoute, Link, Outlet, useRouter } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Activity as ActivityIcon,
  Cable,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Timer,
} from 'lucide-react'
import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { configuredAtom, refreshStatusAtom, statusAtom } from '@/state/atoms'

const NAV: ReadonlyArray<{
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { to: '/', label: '概览', icon: ActivityIcon },
  { to: '/sources', label: '数据源', icon: Cable },
  { to: '/triggers', label: '自动同步', icon: Timer },
  { to: '/history', label: '历史', icon: HistoryIcon },
  { to: '/settings', label: '设置', icon: SettingsIcon },
]

function RootLayout() {
  const status = useAtomValue(statusAtom)
  const configured = useAtomValue(configuredAtom)
  const refresh = useSetAtom(refreshStatusAtom)
  const router = useRouter()
  const path = router.state.location.pathname
  const needsUnlock = status?.needsUnlock ?? false

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!status) return
    if (needsUnlock && path !== '/unlock') {
      router.navigate({ to: '/unlock' })
      return
    }
    if (!configured && !needsUnlock && path !== '/setup') {
      router.navigate({ to: '/setup' })
      return
    }
    if (configured && (path === '/setup' || path === '/unlock')) {
      router.navigate({ to: '/' })
    }
  }, [configured, needsUnlock, path, status, router])

  if (!status) return <LaunchScreen />

  const pendingRedirect =
    (needsUnlock && path !== '/unlock') ||
    (!configured && !needsUnlock && path !== '/setup') ||
    (configured && (path === '/setup' || path === '/unlock'))
  if (pendingRedirect) {
    return <LaunchScreen bare={!configured || needsUnlock} />
  }

  // While unconfigured (Setup screen), render a single-column layout without
  // the persistent left rail so the form takes the whole window.
  if (!configured) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className="relative flex h-screen w-full flex-col overflow-hidden">
          <FramelessHeader bare />
          <main className="flex flex-1 items-center justify-center overflow-y-auto px-8 pb-12">
            <Outlet />
          </main>
          <Toaster />
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen w-full flex-col overflow-hidden">
        <FramelessHeader />
        <div className="flex min-h-0 flex-1 w-full">
          <Sidebar />
          <main className="min-w-0 flex-1 h-full overflow-y-auto px-10 py-8">
            <Outlet />
          </main>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  )
}

function LaunchScreen({ bare = true }: { bare?: boolean }) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative flex h-screen w-full flex-col overflow-hidden">
        <FramelessHeader bare={bare} />
        <main className="flex flex-1 items-center justify-center px-8 pb-12">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandMark />
            <p className="font-mono text-mini uppercase tracking-stamp-wide text-fg-subtle">
              正在连接控制台
            </p>
          </div>
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  )
}

function FramelessHeader({ bare }: { bare?: boolean }) {
  const status = useAtomValue(statusAtom)
  return (
    <header
      className={cn(
        'app-region-drag relative h-11 shrink-0 border-b border-border bg-bg',
        // Reserve room for traffic lights on macOS
        isMac && 'pl-19.5',
      )}
    >
      <div className="flex h-full w-full items-center justify-between pr-4">
        <div className="flex items-center gap-2.5 px-3">
          <BrandMark />
          <span className="font-display text-sm uppercase tracking-stamp text-fg">SweatRelay</span>
          {!bare ? (
            <span className="font-mono text-micro uppercase tracking-wider text-fg-subtle">
              v{status?.appVersion ?? '—'} · 同步控制台
            </span>
          ) : null}
        </div>
        {/* Persistent thin orange "race stripe" sits on the bottom edge */}
      </div>
      <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-linear-to-r from-transparent via-accent/70 to-transparent" />
    </header>
  )
}

function BrandMark() {
  // Two small orange chevrons evoking a rear-derailleur logo / race finish
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 16 L9 6 L11 9 L7 16 Z" fill="var(--color-accent)" />
      <path d="M11 16 L17 6 L19 9 L15 16 Z" fill="var(--color-accent)" opacity="0.55" />
    </svg>
  )
}

function Sidebar() {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-bg/60 px-3 py-6">
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavLink key={item.to} {...item} />
        ))}
      </nav>
      <div className="mt-auto border-t border-border pt-4">
        <p className="font-mono text-micro uppercase tracking-wider text-fg-subtle">
          骑 · 同步 · 上传
        </p>
      </div>
    </aside>
  )
}

function NavLink({
  to,
  label,
  icon: Icon,
}: {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className="group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:text-fg"
      activeProps={{
        className: cn(
          'text-fg bg-surface-2',
          // Race-line marker — 2px orange bar on the leading edge
          "before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-sm before:bg-accent before:content-['']",
        ),
      }}
    >
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
    </Link>
  )
}

export const Route = createRootRoute({ component: RootLayout })
