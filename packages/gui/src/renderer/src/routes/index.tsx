import { createFileRoute, Link } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  Eye,
  FolderOpen,
  Mountain,
  RefreshCw,
  Timer,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { ElevationBackdrop } from '@/components/ElevationBackdrop'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { refreshStatusAtom, statusAtom } from '@/state/atoms'

function Dashboard() {
  const status = useAtomValue(statusAtom)
  const refresh = useSetAtom(refreshStatusAtom)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  if (!status) return <DashboardSkeleton />

  const records = status.recentSyncs
  const today = new Date().toDateString()
  const todayCount = records.filter((r) => new Date(r.syncedAt).toDateString() === today).length
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weekCount = records.filter((r) => Date.parse(r.syncedAt) > weekStart).length

  const ready = status.stravaConnected && status.onelapConnected
  const liveTriggers = (status.watchDir ? 1 : 0) + (status.scheduleCron ? 1 : 0)

  async function syncNow() {
    setBusy(true)
    setFeedback(null)
    const res = await api.syncOnelap()
    setBusy(false)
    if (!res.ok) {
      setFeedback(res.error.message)
      return
    }
    const counts = res.value.reduce<Record<string, number>>((acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1
      return acc
    }, {})
    const summary = Object.entries(counts)
      .map(([k, v]) => `${KIND_LABEL[k] ?? k} ${v}`)
      .join(' · ')
    setFeedback(summary || '没有新活动')
    await refresh()
  }

  return (
    <div className="space-y-10">
      <SectionHeading
        index="00"
        title="概览"
        subtitle={ready ? '所有源已就绪。立即同步或交给后台触发器。' : '配置数据源后才能开始同步。'}
        action={
          <Button onClick={syncNow} disabled={busy || !ready} size="lg" className="group min-w-40">
            {busy ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                同步中
              </>
            ) : (
              <>
                <Zap className="size-4" />
                立即同步
              </>
            )}
          </Button>
        }
      />

      <section className="grid grid-cols-12 gap-6">
        {ready ? (
          <MetricHero
            weekCount={weekCount}
            todayCount={todayCount}
            totalCount={records.length}
            liveTriggers={liveTriggers}
          />
        ) : (
          <OnboardingHero
            stravaConnected={status.stravaConnected}
            onelapConnected={status.onelapConnected}
            hasFolderWatch={!!status.watchDir}
          />
        )}

        <div className="col-span-12 grid grid-cols-2 gap-4 lg:col-span-7">
          <StatusTile
            label="Strava"
            value={status.stravaConnected ? '已连接' : '未连接'}
            tone={status.stravaConnected ? 'success' : 'idle'}
            sub={status.stravaConnected ? `运动员 · ${status.stravaAthleteId ?? '—'}` : '尚未授权'}
            icon={ActivityIcon}
            to="/sources"
          />
          <StatusTile
            label="Onelap"
            value={status.onelapConnected ? '已连接' : '未连接'}
            tone={status.onelapConnected ? 'success' : 'idle'}
            sub={status.onelapAccount ?? '尚未连接账号'}
            icon={Mountain}
            to="/sources"
          />
          <StatusTile
            label="文件夹监控"
            value={status.watchDir ? '监控中' : '未启用'}
            tone={status.watchDir ? 'live' : 'idle'}
            sub={status.watchDir ?? '未选择目录'}
            icon={FolderOpen}
            to="/triggers"
            mono
          />
          <StatusTile
            label="定时同步"
            value={status.scheduleCron ? '运行中' : '未启用'}
            tone={status.scheduleCron ? 'live' : 'idle'}
            sub={status.scheduleCron ?? '未配置'}
            icon={Timer}
            to="/triggers"
            mono={!!status.scheduleCron}
          />
        </div>
      </section>

      {feedback ? (
        <div className="rounded-md border border-border bg-surface px-4 py-2.5 text-sm">
          <span className="font-mono text-micro uppercase tracking-wider text-accent">
            上次运行
          </span>
          <span className="ml-3 text-fg">{feedback}</span>
        </div>
      ) : null}

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-xl uppercase tracking-wider text-fg">最近活动</h2>
          <Link
            to="/history"
            className="font-mono text-micro uppercase tracking-wider text-fg-muted hover:text-accent"
          >
            查看全部 <ArrowUpRight className="ml-0.5 inline size-3" />
          </Link>
        </div>

        {records.length === 0 ? (
          <EmptyRail />
        ) : (
          <ol className="divide-y divide-border border-y border-border">
            {records.slice(0, 6).map((r) => (
              <li
                key={r.key}
                className="grid grid-cols-[120px_1fr_auto_120px] items-center gap-4 px-1 py-3 text-sm"
              >
                <span className="font-mono text-xs tabular text-fg-muted">
                  {formatTime(r.syncedAt)}
                </span>
                <span className="truncate font-display text-base uppercase tracking-wide text-fg">
                  {sourceLabel(r.source)}
                </span>
                <StatusDot tone="success" />
                {r.activityUrl ? (
                  <a
                    href={r.activityUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-right font-mono text-xs text-accent hover:underline"
                  >
                    打开 ↗
                  </a>
                ) : (
                  <span className="text-right font-mono text-xs text-fg-subtle">—</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function StatusTile({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  to,
  mono,
}: {
  label: string
  value: string
  sub: string
  tone: 'success' | 'live' | 'idle'
  icon: React.ComponentType<{ className?: string }>
  to: string
  mono?: boolean
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col justify-between overflow-hidden rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-fg-muted" />
          <p className="font-mono text-micro uppercase tracking-stamp text-fg-muted">{label}</p>
        </div>
        <StatusDot tone={tone} />
      </div>
      <div className="mt-6">
        <p className="font-display text-3xl uppercase leading-none text-fg">{value}</p>
        <p
          className={cn(
            'mt-2 truncate text-xs',
            mono ? 'font-mono text-fg-muted' : 'text-fg-muted',
          )}
        >
          {sub}
        </p>
      </div>
      <ArrowUpRight className="absolute right-4 top-4 size-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  )
}

function MetricHero({
  weekCount,
  todayCount,
  totalCount,
  liveTriggers,
}: {
  weekCount: number
  todayCount: number
  totalCount: number
  liveTriggers: number
}) {
  return (
    <div className="relative col-span-12 overflow-hidden rounded-lg border border-border-strong bg-surface lg:col-span-5">
      <ElevationBackdrop className="absolute inset-x-0 bottom-0 h-32 w-full" />
      <div className="relative flex h-full flex-col p-7">
        <div className="flex items-center justify-between">
          <p className="font-mono text-micro uppercase tracking-stamp-wide text-fg-muted">
            近 7 天
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/history"
                className="font-mono text-micro uppercase tracking-wider text-accent hover:underline"
              >
                历史 →
              </Link>
            </TooltipTrigger>
            <TooltipContent>查看完整同步历史</TooltipContent>
          </Tooltip>
        </div>
        <div className="mt-auto pt-12">
          <div className="flex items-baseline gap-4">
            <span className="font-display text-hero leading-[0.85] tabular text-fg">
              {weekCount.toString().padStart(2, '0')}
            </span>
            <div className="pb-3">
              <p className="font-display text-2xl uppercase leading-none text-fg">条同步</p>
              <p className="mt-1 text-xs text-fg-muted">本周共完成</p>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-5 border-t border-border pt-4 text-xs text-fg-muted">
            <span className="flex items-center gap-1.5">
              <span className="font-mono tabular text-fg">{todayCount}</span> 今日
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono tabular text-fg">{totalCount}</span> 总计
            </span>
            {liveTriggers > 0 ? (
              <span className="ml-auto flex items-center gap-1.5">
                <StatusDot tone="live" />
                <span>{liveTriggers} 个触发器运行中</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

interface NextStep {
  index: '01' | '02' | '03'
  badge: string
  title: string
  desc: string
  cta: string
  to: '/sources' | '/triggers'
  icon: React.ComponentType<{ className?: string }>
}

function pickNextStep({
  stravaConnected,
  onelapConnected,
  hasFolderWatch,
}: {
  stravaConnected: boolean
  onelapConnected: boolean
  hasFolderWatch: boolean
}): NextStep {
  if (!stravaConnected) {
    return {
      index: '01',
      badge: '下一步 · 01 / 02',
      title: '授权 Strava',
      desc: '点一下，浏览器打开 Strava 登录页，授权完成自动回到这里。',
      cta: '去授权 Strava',
      to: '/sources',
      icon: Zap,
    }
  }
  if (!onelapConnected && !hasFolderWatch) {
    return {
      index: '02',
      badge: '下一步 · 02 / 02',
      title: '选一条数据来源',
      desc: '连接 Onelap 账号自动同步今日骑行，或选一个文件夹监控任何码表导出的 FIT 文件。两者可以并存。',
      cta: '配置数据源',
      to: '/sources',
      icon: Mountain,
    }
  }
  // Edge: somehow ready=false but onelap or folder is set — point to triggers
  return {
    index: '03',
    badge: '下一步',
    title: '启用一个触发器',
    desc: '决定怎么自动跑：监控文件夹新增文件，或按设定频率拉取 Onelap。',
    cta: '配置触发器',
    to: '/triggers',
    icon: ActivityIcon,
  }
}

function OnboardingHero(props: {
  stravaConnected: boolean
  onelapConnected: boolean
  hasFolderWatch: boolean
}) {
  const step = pickNextStep(props)
  const Icon = step.icon
  return (
    <div className="relative col-span-12 overflow-hidden rounded-lg border border-accent/40 bg-surface lg:col-span-5">
      <ElevationBackdrop className="absolute inset-x-0 bottom-0 h-32 w-full" />
      <div className="relative flex h-full flex-col p-7">
        <div className="flex items-center justify-between">
          <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">
            {step.badge}
          </p>
          <span className="inline-flex size-7 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
            <Icon className="size-4" />
          </span>
        </div>

        <div className="mt-auto pt-12">
          <h2 className="font-display text-5xl uppercase leading-[0.95] text-fg">{step.title}</h2>
          <p className="mt-3 max-w-sm text-sm text-fg-muted">{step.desc}</p>
          <Button asChild size="lg" className="group mt-6">
            <Link to={step.to}>
              {step.cta}
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function EmptyRail() {
  return (
    <div className="flex items-center gap-4 rounded-md border border-dashed border-border px-5 py-8 text-sm text-fg-muted">
      <Eye className="size-5 text-fg-subtle" />
      <div>
        <p className="text-fg">还没有同步记录。</p>
        <p className="mt-0.5 text-xs">连上数据源后，第一次同步的活动会出现在这里。</p>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div className="h-16 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-5 h-72 animate-pulse rounded-lg bg-surface-2" />
        <div className="col-span-7 grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  uploaded: '新上传',
  duplicate: '已存在',
  'skipped-already-synced': '已同步',
  error: '错误',
}

const SOURCE_LABELS: Record<string, string> = {
  onelap: 'Onelap',
  'onelap-folder': 'Onelap · Folder',
  'magene-folder': 'Magene',
  'blackbird-folder': 'Blackbird',
  folder: 'Folder',
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString()
  if (d.toDateString() === today) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const hm = d
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    .replace(/\s/g, '')
  return `${mm}/${dd} ${hm}`
}

export const Route = createFileRoute('/')({ component: Dashboard })
