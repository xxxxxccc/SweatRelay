import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import { Eye, FolderOpen, Power, Timer } from 'lucide-react'
import { useState } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { refreshStatusAtom, statusAtom } from '@/state/atoms'

function Triggers() {
  const status = useAtomValue(statusAtom)
  if (!status) return null
  return (
    <div className="space-y-10">
      <SectionHeading index="02" title="触发器" subtitle="新增文件 或 按时检查，都能自动同步。" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <WatchLane current={status.watchDir} />
        <ScheduleLane current={status.scheduleCron} />
      </div>
    </div>
  )
}

function LaneChrome({
  number,
  title,
  tag,
  active,
  children,
}: {
  number: string
  title: string
  tag: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-lg border bg-surface',
        active ? 'border-border-strong' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-micro text-accent">{number}</span>
          <h2 className="font-display text-2xl uppercase leading-none text-fg">{title}</h2>
          <span className="font-mono text-micro uppercase tracking-wider text-fg-subtle">
            {tag}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot tone={active ? 'live' : 'idle'} />
          <Badge variant={active ? 'live' : 'outline'} className="font-mono text-micro">
            {active ? '运行中' : '未启用'}
          </Badge>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  )
}

function WatchLane({ current }: { current?: string }) {
  const refresh = useSetAtom(refreshStatusAtom)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function pickAndSet() {
    setBusy(true)
    setErr(null)
    const pick = await api.pickDirectory()
    if (!pick.ok) {
      setErr(pick.error.message)
      setBusy(false)
      return
    }
    if (pick.value === null) {
      setBusy(false)
      return
    }
    const res = await api.setWatchDir({ dir: pick.value })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await refresh()
  }

  async function clear() {
    setBusy(true)
    setErr(null)
    const res = await api.setWatchDir({ dir: null })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await refresh()
  }

  return (
    <LaneChrome number="02.A" title="文件夹监控" tag="本地目录 · 自动" active={!!current}>
      <div className="space-y-5">
        <p className="text-sm text-fg-muted">
          盯着一个文件夹，里面新增的 .fit / .gpx / .tcx 文件会自动上传到 Strava。
          把码表导出的文件夹、或者浏览器下载文件夹指过来就行。
        </p>

        <div className="overflow-hidden rounded-md border border-border bg-bg/40">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <FolderOpen className="size-3.5 text-fg-subtle" />
            <span className="font-mono text-micro uppercase tracking-stamp-mono text-fg-subtle">
              目录
            </span>
            {current ? (
              <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-micro text-accent">
                <StatusDot tone="live" /> 监控中
              </span>
            ) : null}
          </div>
          <div className="break-all px-3 py-3 font-mono text-xs text-fg">
            {current ?? <span className="text-fg-subtle">— 未选择目录 —</span>}
          </div>
        </div>

        {err ? (
          <Alert variant="destructive">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button onClick={pickAndSet} disabled={busy}>
            <Eye className="size-4" />
            {current ? '更换目录' : '选择目录'}
          </Button>
          {current ? (
            <Button variant="ghost" onClick={clear} disabled={busy}>
              <Power className="size-4" />
              停止监听
            </Button>
          ) : null}
        </div>
      </div>
    </LaneChrome>
  )
}

interface FrequencyPreset {
  cron: string
  label: string
  desc: string
}

const FREQUENCIES: ReadonlyArray<FrequencyPreset> = [
  { cron: '*/15 * * * *', label: '每 15 分钟', desc: '骑得勤、要尽快上传时' },
  { cron: '*/30 * * * *', label: '每 30 分钟', desc: '推荐 · 平衡及时性和资源占用' },
  { cron: '0 * * * *', label: '每小时整点', desc: '一天好几次但不急' },
  { cron: '0 22 * * *', label: '每天晚上 22:00', desc: '当天骑完晚上再统一同步' },
]

function ScheduleLane({ current }: { current?: string }) {
  const refresh = useSetAtom(refreshStatusAtom)
  const initialPreset = current ?? '*/30 * * * *'
  const [selected, setSelected] = useState(initialPreset)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    const res = await api.setSchedule({ cron: selected, timezone: 'Asia/Shanghai' })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await refresh()
  }

  async function disable() {
    setBusy(true)
    setErr(null)
    const res = await api.setSchedule({ cron: null })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await refresh()
  }

  return (
    <LaneChrome number="02.B" title="定时同步" tag="自动 · Onelap" active={!!current}>
      <div className="space-y-5">
        <p className="text-sm text-fg-muted">
          每隔一段时间自动去 Onelap 拉一次今天的新活动。挑一个适合你的频率即可。
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FREQUENCIES.map((f) => {
            const active = selected === f.cron
            return (
              <button
                key={f.cron}
                type="button"
                onClick={() => setSelected(f.cron)}
                className={cn(
                  'group flex flex-col items-start gap-1 rounded-md border bg-surface p-3 text-left transition-colors',
                  active
                    ? 'border-accent ring-1 ring-accent/40'
                    : 'border-border hover:border-border-strong',
                )}
              >
                <span
                  className={cn(
                    'font-display text-base uppercase tracking-wide',
                    active ? 'text-fg' : 'text-fg-muted',
                  )}
                >
                  {f.label}
                </span>
                <span className="text-xs text-fg-subtle">{f.desc}</span>
              </button>
            )
          })}
        </div>

        {err ? (
          <Alert variant="destructive">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={busy}>
            <Timer className="size-4" />
            {busy ? '保存中…' : current ? '更新频率' : '启用定时同步'}
          </Button>
          {current ? (
            <Button type="button" variant="ghost" onClick={disable} disabled={busy}>
              <Power className="size-4" />
              停止
            </Button>
          ) : null}
        </div>
      </div>
    </LaneChrome>
  )
}

export const Route = createFileRoute('/triggers')({ component: Triggers })
