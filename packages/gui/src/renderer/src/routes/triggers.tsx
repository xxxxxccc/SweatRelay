import type { AppStatus, AutoSyncTarget } from '@shared/ipc.ts'
import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import { Eye, FolderOpen, Power, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { refreshStatusAtom, statusAtom } from '@/state/status'

function Triggers() {
  const status = useAtomValue(statusAtom)
  if (!status) return null
  return (
    <div className="space-y-10">
      <SectionHeading
        index="04"
        title="自动同步"
        subtitle="把手动同步升级成后台执行。文件夹监控负责新文件，定时同步负责按计划拉取 Onelap。"
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <WatchLane current={status.watchDir} />
        <ScheduleLane status={status} />
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
  { cron: '30 23 * * *', label: '每天晚上 23:30', desc: '避开夜间训练还没结束的情况' },
]

const SCHEDULE_TARGETS = {
  strava: 'strava',
  coros: 'coros',
  garmin: 'garmin',
} as const satisfies Record<string, AutoSyncTarget>

interface ScheduleTargetOption {
  id: AutoSyncTarget
  label: string
  desc: string
  available: boolean
  unavailable: string
}

function ScheduleLane({ status }: { status: AppStatus }) {
  const refresh = useSetAtom(refreshStatusAtom)
  const current = status.scheduleCron
  const initialPreset = current ?? '*/30 * * * *'
  const scheduleTargets = useMemo(
    () => normalizeScheduleTargets(status.scheduleTargets),
    [status.scheduleTargets],
  )
  const [selected, setSelected] = useState(initialPreset)
  const [selectedTargets, setSelectedTargets] = useState<AutoSyncTarget[]>(scheduleTargets)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const targetOptions = buildScheduleTargetOptions(status)

  useEffect(() => {
    setSelected(current ?? '*/30 * * * *')
  }, [current])

  useEffect(() => {
    setSelectedTargets(scheduleTargets)
  }, [scheduleTargets])

  function toggleTarget(target: AutoSyncTarget, checked: boolean) {
    const option = targetOptions.find((item) => item.id === target)
    if (!option?.available && checked) return
    setSelectedTargets((currentTargets) => {
      if (checked) return Array.from(new Set([...currentTargets, target]))
      return currentTargets.filter((item) => item !== target)
    })
  }

  async function save() {
    const unavailableTargets = selectedTargets
      .map((target) => targetOptions.find((option) => option.id === target))
      .filter((target): target is ScheduleTargetOption => target !== undefined && !target.available)
    if (unavailableTargets.length > 0) {
      setErr(`请先连接或取消选择：${unavailableTargets.map((target) => target.label).join(' / ')}`)
      return
    }
    if (selectedTargets.length === 0) {
      setErr('至少选择一个已连接的平台')
      return
    }
    setBusy(true)
    setErr(null)
    const res = await api.setSchedule({
      cron: selected,
      timezone: 'Asia/Shanghai',
      targets: selectedTargets,
    })
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
          每隔一段时间自动去 Onelap
          拉一次新活动。启用后，即使你不手动点“立即同步”，后台也会自己执行。
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-micro uppercase tracking-stamp-mono text-fg-subtle">
              同步目标
            </span>
            <span className="font-mono text-micro text-fg-subtle">
              {selectedTargets.length}/{targetOptions.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {targetOptions.map((target) => {
              const checked = selectedTargets.includes(target.id)
              return (
                <div
                  key={target.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border bg-bg/40 p-3 transition-colors',
                    checked && target.available
                      ? 'border-accent/70 bg-accent/5'
                      : 'border-border hover:border-border-strong',
                    !target.available && 'cursor-not-allowed opacity-55 hover:border-border',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={busy || (!target.available && !checked)}
                    onCheckedChange={(value) => toggleTarget(target.id, value === true)}
                    aria-label={`同步到 ${target.label}`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-display text-base uppercase leading-none text-fg">
                        {target.label}
                      </span>
                      <StatusDot tone={target.available ? 'success' : 'idle'} />
                    </span>
                    <span className="mt-1 block text-xs text-fg-subtle">
                      {target.available ? target.desc : target.unavailable}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
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

function normalizeScheduleTargets(
  targets: readonly AutoSyncTarget[] | undefined,
): AutoSyncTarget[] {
  return targets && targets.length > 0 ? [...targets] : [SCHEDULE_TARGETS.strava]
}

function buildScheduleTargetOptions(status: AppStatus): ScheduleTargetOption[] {
  return [
    {
      id: SCHEDULE_TARGETS.strava,
      label: 'Strava',
      desc: '把 Onelap 新活动上传到 Strava',
      available: status.manualSyncAvailable,
      unavailable: '先连接 Onelap 和 Strava',
    },
    {
      id: SCHEDULE_TARGETS.coros,
      label: 'COROS',
      desc: '把 Onelap 新活动导入高驰',
      available: status.corosManualSyncAvailable,
      unavailable: '先连接 Onelap 和高驰',
    },
    {
      id: SCHEDULE_TARGETS.garmin,
      label: 'Garmin',
      desc: '把 Onelap 新活动导入 Garmin Connect',
      available: status.garminManualSyncAvailable,
      unavailable: '先连接 Onelap 和 Garmin',
    },
  ]
}

export const Route = createFileRoute('/triggers')({ component: Triggers })
