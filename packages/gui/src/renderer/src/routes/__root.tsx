import { createRootRoute, Link, Outlet, useRouter } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Activity as ActivityIcon,
  Cable,
  CalendarDays,
  Gauge,
  History as HistoryIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Timer,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { configuredAtom, refreshStatusAtom, statusAtom } from '@/state/status'

const SIDEBAR_STORAGE_KEY = 'sweatrelay.sidebar.expanded'
const SIDEBAR_SHORTCUT_KEY = 'b'

const NAV: ReadonlyArray<{
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { to: '/', label: '概览', icon: ActivityIcon },
  { to: '/sources', label: '数据源', icon: Cable },
  { to: '/plans', label: '训练计划', icon: CalendarDays },
  { to: '/training', label: '训练负荷', icon: Gauge },
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
  const [sidebarExpanded, setSidebarExpanded] = useState(() => readSidebarPreference())

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarExpanded))
  }, [sidebarExpanded])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== SIDEBAR_SHORTCUT_KEY) return
      event.preventDefault()
      setSidebarExpanded((current) => !current)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
          <Sidebar expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} />
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

function Sidebar({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  return (
    <aside
      data-state={expanded ? 'expanded' : 'collapsed'}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r border-border bg-bg/60 py-4 transition-all duration-200 ease-out',
        expanded ? 'w-52 px-3' : 'w-16 px-2',
      )}
    >
      <div
        className={cn(
          'mb-4 flex min-h-8 items-center gap-2',
          expanded ? 'justify-between px-1' : 'justify-center',
        )}
      >
        {expanded ? (
          <p className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">Navigation</p>
        ) : null}
        <SidebarToggle expanded={expanded} onExpandedChange={onExpandedChange} />
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavLink key={item.to} {...item} expanded={expanded} />
        ))}
      </nav>
    </aside>
  )
}

function SidebarToggle({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen
  const label = expanded ? '收起侧边栏' : '展开侧边栏'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="app-region-no-drag size-8 text-fg-muted hover:text-fg"
          aria-label={label}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" align="center">
        <span>{label}</span>
        <span className="ml-2 font-mono text-micro uppercase tracking-stamp text-fg-subtle">
          {isMac ? '⌘B' : 'Ctrl+B'}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function NavLink({
  to,
  label,
  icon: Icon,
  expanded,
}: {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  expanded: boolean
}) {
  const link = (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className={cn(
        'group relative flex items-center rounded-md text-sm text-fg-muted transition-colors hover:text-fg',
        expanded ? 'gap-3 px-3 py-2' : 'justify-center px-0 py-2.5',
      )}
      activeProps={{
        className: cn(
          'text-fg bg-surface-2',
          // Race-line marker — 2px orange bar on the leading edge
          expanded
            ? "before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-sm before:bg-accent before:content-['']"
            : "before:absolute before:-left-2 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-sm before:bg-accent before:content-['']",
        ),
      }}
      aria-label={label}
    >
      <Icon className="size-4 shrink-0" />
      <span className={cn('truncate transition-opacity', !expanded && 'sr-only')}>{label}</span>
    </Link>
  )

  if (expanded) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function readSidebarPreference(): boolean {
  const value = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
  return value === null ? true : value === 'true'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

export const Route = createRootRoute({ component: RootLayout })
