import type { TrainingStatusRange } from '@shared/ipc.ts'
import type {
  IntervalsFitnessPoint,
  IntervalsTrainingLoadReport,
  TrainingLoadAssessment,
  TrainingPlanOverview,
  TrainingStatusReason,
} from '@sweatrelay/core'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowUpRight, Gauge, Power, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { refreshStatusAtom, statusAtom } from '@/state/status'
import {
  refreshTrainingLoadAtom,
  refreshTrainingPlanAtom,
  trainingLoadResourceAtom,
  trainingPlanResourceAtom,
} from '@/state/training'

const HISTORY_DAYS = 42
const ICU_SERIES_COLORS = {
  ctl: 'oklch(59% 0.15 300)',
  atl: 'oklch(70% 0.14 225)',
  tsb: 'oklch(62% 0.17 145)',
  ramp: 'var(--color-fg-muted)',
} as const

const RANGE_OPTIONS: ReadonlyArray<{ value: TrainingStatusRange; label: string; desc: string }> = [
  { value: 'current', label: '当前', desc: '最新 CTL / ATL / TSB' },
  { value: 'future7', label: '未来 7 天', desc: '包含 ICU / 本地计划' },
  { value: 'future14', label: '未来 14 天', desc: '检查更长周期计划' },
]

function TrainingLoad() {
  const status = useAtomValue(statusAtom)
  const loadResource = useAtomValue(trainingLoadResourceAtom)
  const planResource = useAtomValue(trainingPlanResourceAtom)
  const refreshStatus = useSetAtom(refreshStatusAtom)
  const refreshTrainingLoad = useSetAtom(refreshTrainingLoadAtom)
  const refreshTrainingPlan = useSetAtom(refreshTrainingPlanAtom)
  const [err, setErr] = useState<string | null>(null)
  const report = loadResource.value
  const planOverview = planResource.value
  const busy =
    loadResource.loading ||
    loadResource.refreshing ||
    planResource.loading ||
    planResource.refreshing
  const displayError = err ?? loadResource.error ?? planResource.error
  const connected = status?.intervalsConnected ?? false
  const detectionEnabled = status?.trainingStatusEnabled ?? false
  const range = status?.trainingStatusRange ?? 'current'

  const refreshLoad = useCallback(
    async (
      nextRange: TrainingStatusRange = range,
      options: { force?: boolean; silent?: boolean } = {},
    ) => {
      setErr(null)
      await Promise.all([
        refreshTrainingLoad({
          payload: {
            days: HISTORY_DAYS,
            forecastDays: forecastDaysForRange(nextRange),
          },
          force: options.force,
          silent: options.silent,
        }),
        refreshTrainingPlan({
          force: options.force,
          silent: options.silent ?? true,
        }),
      ])
    },
    [range, refreshTrainingLoad, refreshTrainingPlan],
  )

  useEffect(() => {
    if (!connected) return
    void refreshLoad(range, { silent: true })
  }, [connected, range, refreshLoad])

  if (!status) return null

  async function setDetectionEnabled(enabled: boolean) {
    setErr(null)
    const res = await api.setTrainingStatus({ enabled })
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await refreshStatus()
    if (enabled) await refreshLoad(range, { silent: true })
  }

  async function setRange(nextRange: TrainingStatusRange) {
    setErr(null)
    const res = await api.setTrainingStatus({ range: nextRange })
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await refreshStatus()
    if (detectionEnabled) await refreshLoad(nextRange, { silent: true })
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        index="03"
        title="训练负荷"
        subtitle="ICU 提供 CTL / ATL / Ramp 等原始数据；SweatRelay 用本地规则做状态检测。"
        action={
          connected ? (
            <Button
              onClick={() => void refreshLoad(range, { force: true, silent: false })}
              disabled={busy}
              className="min-w-40"
            >
              <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
              {busy ? '读取中' : '刷新'}
            </Button>
          ) : null
        }
      />

      {!connected ? (
        <ConnectIntervals />
      ) : (
        <DetectionConsole
          enabled={detectionEnabled}
          range={range}
          busy={busy}
          fetchedAt={report?.summary.fetchedAt}
          onToggle={setDetectionEnabled}
          onRangeChange={setRange}
          onRefresh={() => refreshLoad(range, { force: true, silent: false })}
        />
      )}

      {displayError ? (
        <Alert variant="destructive">
          <AlertDescription>{displayError}</AlertDescription>
        </Alert>
      ) : null}

      {connected && report?.summary.latest ? (
        <TrainingDashboard
          report={report}
          planOverview={planOverview}
          detectionEnabled={detectionEnabled}
        />
      ) : null}

      {connected && report && !report.summary.latest ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-5 py-8 text-sm text-fg-muted">
          Intervals.icu 暂时没有返回可用的 CTL / ATL 记录。
        </div>
      ) : null}

      {connected && loadResource.loading && !report ? <TrainingSkeleton /> : null}
    </div>
  )
}

function DetectionConsole({
  enabled,
  range,
  busy,
  fetchedAt,
  onToggle,
  onRangeChange,
  onRefresh,
}: {
  enabled: boolean
  range: TrainingStatusRange
  busy: boolean
  fetchedAt?: string
  onToggle: (enabled: boolean) => Promise<void>
  onRangeChange: (range: TrainingStatusRange) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-col gap-5 px-6 py-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex items-start gap-4">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg/50 text-accent">
            <Power className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl uppercase leading-none text-fg">状态检测</h2>
              <StatusDot tone={enabled ? 'live' : 'idle'} />
            </div>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              开启后按当前范围评估强度是否合适。原始 CTL / ATL 来自 ICU，结论来自本地规则。
            </p>
            <p className="mt-2 font-mono text-micro uppercase tracking-stamp text-fg-subtle">
              最近读取 {fetchedAt ? formatDateTime(fetchedAt) : '—'}
            </p>
          </div>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-2 2xl:w-auto 2xl:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-bg/40 p-px sm:col-span-2 2xl:col-span-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onRangeChange(option.value)}
                className={cn(
                  'min-w-0 px-3 py-2 text-left transition-colors',
                  range === option.value
                    ? 'bg-surface-2 text-fg'
                    : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
                )}
              >
                <span className="block font-display text-base uppercase leading-none">
                  {option.label}
                </span>
                <span className="mt-1 block truncate font-mono text-micro uppercase tracking-stamp">
                  {option.desc}
                </span>
              </button>
            ))}
          </div>

          <div className="flex min-h-14 w-full items-center justify-center gap-3 rounded-md border border-border bg-bg/40 px-3 py-2 2xl:min-w-40 2xl:shrink-0">
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => void onToggle(checked)}
              className="shrink-0"
            />
            <span className="whitespace-nowrap font-mono text-micro uppercase tracking-stamp text-fg-muted">
              {enabled ? '检测已开启' : '开启检测'}
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => onRefresh()}
            disabled={busy}
            className="min-h-14 w-full shrink-0 whitespace-nowrap px-5 2xl:w-auto"
          >
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
            立即检测
          </Button>
        </div>
      </div>
    </section>
  )
}

function ConnectIntervals() {
  return (
    <section className="flex items-center justify-between gap-6 rounded-lg border border-border bg-surface px-6 py-5">
      <div className="flex items-start gap-4">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg/50 text-accent">
          <Gauge className="size-5" />
        </span>
        <div>
          <h2 className="font-display text-2xl uppercase leading-none text-fg">
            连接 Intervals.icu
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            API key 保存在本机凭据中；这里只读取 wellness 和计划课表里的训练负荷字段。
          </p>
        </div>
      </div>
      <Button asChild>
        <Link to="/sources">
          去数据源
          <ArrowUpRight className="size-4" />
        </Link>
      </Button>
    </section>
  )
}

function TrainingDashboard({
  report,
  planOverview,
  detectionEnabled,
}: {
  report: IntervalsTrainingLoadReport
  planOverview: TrainingPlanOverview | null
  detectionEnabled: boolean
}) {
  const { summary, assessment } = report
  const latest = summary.latest
  if (!latest) return null
  const previous = previousPoint(summary.points, latest.date)

  return (
    <div className="space-y-6">
      {detectionEnabled ? <AssessmentPanel assessment={assessment} /> : <DetectionOffPanel />}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="CTL"
          title="体能"
          value={latest.ctl}
          delta={previous ? latest.ctl - previous.ctl : undefined}
          sub="ICU 原始值"
          markerColor={ICU_SERIES_COLORS.ctl}
        />
        <MetricCard
          label="ATL"
          title="疲劳"
          value={latest.atl}
          delta={previous ? latest.atl - previous.atl : undefined}
          sub="ICU 原始值"
          markerColor={ICU_SERIES_COLORS.atl}
        />
        <MetricCard
          label="TSB"
          title="状态"
          value={latest.tsb}
          delta={previous ? latest.tsb - previous.tsb : undefined}
          sub="CTL - ATL"
          markerColor={ICU_SERIES_COLORS.tsb}
        />
        <MetricCard
          label="Ramp"
          title="增长率"
          value={latest.rampRate}
          sub="ICU 原始值"
          markerColor={ICU_SERIES_COLORS.ramp}
          muted={latest.rampRate === undefined}
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">
              42 day load
            </p>
            <h2 className="mt-1 font-display text-2xl uppercase leading-none text-fg">
              CTL / ATL / TSB
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-fg-muted">
            <Legend color={ICU_SERIES_COLORS.ctl} label="CTL" />
            <Legend color={ICU_SERIES_COLORS.atl} label="ATL" />
            <Legend color={ICU_SERIES_COLORS.tsb} label="TSB" />
          </div>
        </div>
        <TrainingChart
          points={summary.points}
          forecastPoints={forecastPointsForDisplay(
            summary.latest,
            summary.forecast?.points,
            planOverview,
          )}
          showBands={detectionEnabled}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <RecentLoadTable points={summary.points.slice(-10).toReversed()} />
        <LoadSummary report={report} planOverview={planOverview} />
      </section>
    </div>
  )
}

function AssessmentPanel({ assessment }: { assessment: TrainingLoadAssessment }) {
  const tone = toneForAssessment(assessment.level)
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border bg-surface',
        assessment.level === 'high' ? 'border-danger/70' : 'border-border',
      )}
    >
      <div className="grid gap-6 p-6 xl:grid-cols-[340px_1fr]">
        <div>
          <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">
            Training state
          </p>
          <div className="mt-5 flex items-start gap-4">
            <StatusDot tone={tone} className="mt-2 size-2" />
            <div>
              <h2 className="font-display text-6xl uppercase leading-none text-fg">
                {assessment.title}
              </h2>
              <p className="mt-3 text-sm text-fg-muted">{assessment.summary}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {assessment.reasons.map((reason) => (
            <ReasonTile key={reason.id} reason={reason} />
          ))}
        </div>
      </div>
    </section>
  )
}

function DetectionOffPanel() {
  return (
    <section className="rounded-lg border border-dashed border-border bg-surface px-6 py-5">
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="font-mono text-micro uppercase tracking-stamp-wide text-fg-subtle">
            Status check disabled
          </p>
          <h2 className="mt-2 font-display text-3xl uppercase leading-none text-fg">
            已读取训练负荷，尚未开启状态检测
          </h2>
          <p className="mt-2 text-sm text-fg-muted">
            开启后会基于 ICU 数据触发本地规则，显示强度是否偏高以及触发原因。
          </p>
        </div>
        <StatusDot tone="idle" />
      </div>
    </section>
  )
}

function ReasonTile({ reason }: { reason: TrainingStatusReason }) {
  return (
    <div className="rounded-md border border-border bg-bg/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg uppercase leading-none text-fg">{reason.title}</p>
          <p className="mt-2 text-xs text-fg-muted">{reason.detail}</p>
        </div>
        <StatusDot tone={toneForReason(reason.severity)} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 font-mono text-micro uppercase tracking-stamp text-fg-subtle">
        <span>{reason.source === 'intervals' ? 'ICU 数据' : '本地规则'}</span>
        <span>
          {reason.metric}
          {reason.value !== undefined ? ` ${formatReasonValue(reason)}` : ''}
        </span>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  title,
  value,
  delta,
  sub,
  markerColor,
  muted,
}: {
  label: string
  title: string
  value?: number
  delta?: number
  sub: string
  markerColor: string
  muted?: boolean
}) {
  const hasValue = value !== undefined && Number.isFinite(value)
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-micro uppercase tracking-stamp text-fg-muted">{label}</p>
        <span className="size-2 rounded-full" style={{ backgroundColor: markerColor }} />
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-2xl uppercase leading-none text-fg">{title}</p>
          <p className="mt-1 text-xs text-fg-muted">{sub}</p>
        </div>
        <p
          className={cn(
            'font-display text-5xl leading-none tabular text-fg',
            muted && 'text-fg-subtle',
          )}
        >
          {hasValue ? formatMetric(value) : '—'}
        </p>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <Delta value={delta} />
      </div>
    </div>
  )
}

function Delta({ value }: { value?: number }) {
  if (value === undefined || Math.abs(value) < 0.05) {
    return (
      <p className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">日变化 0.0</p>
    )
  }
  const positive = value > 0
  const Icon = positive ? TrendingUp : TrendingDown
  return (
    <p className={cn('flex items-center gap-1.5 font-mono text-micro uppercase tracking-stamp')}>
      <Icon className={cn('size-3', positive ? 'text-success' : 'text-warning')} />
      <span className={positive ? 'text-success' : 'text-warning'}>
        日变化 {positive ? '+' : ''}
        {formatMetric(value)}
      </span>
    </p>
  )
}

function TrainingChart({
  points,
  forecastPoints,
  showBands,
}: {
  points: IntervalsFitnessPoint[]
  forecastPoints: IntervalsFitnessPoint[]
  showBands: boolean
}) {
  const model = useMemo(() => buildChartModel(points, forecastPoints), [points, forecastPoints])
  if (!model) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-fg-muted">
        需要至少两天数据才能绘制趋势。
      </div>
    )
  }

  return (
    <div className="px-4 py-5">
      <svg
        viewBox="0 0 720 260"
        className="h-80 w-full"
        role="img"
        aria-label="Training load chart"
      >
        {showBands ? <RiskBands model={model} /> : null}
        {model.gridY.map((y) => (
          <line
            key={y}
            x1="0"
            x2="720"
            y1={y}
            y2={y}
            stroke="var(--color-border)"
            strokeWidth="1"
          />
        ))}
        <line
          x1="0"
          x2="720"
          y1={model.zeroY}
          y2={model.zeroY}
          stroke="var(--color-border-strong)"
          strokeDasharray="4 6"
          strokeWidth="1"
        />
        <path d={model.ctlPath} fill="none" stroke={ICU_SERIES_COLORS.ctl} strokeWidth="2.4" />
        <path d={model.atlPath} fill="none" stroke={ICU_SERIES_COLORS.atl} strokeWidth="2.4" />
        <path d={model.tsbPath} fill="none" stroke={ICU_SERIES_COLORS.tsb} strokeWidth="2" />
        {model.forecastTsbPath ? (
          <path
            d={model.forecastTsbPath}
            fill="none"
            stroke={ICU_SERIES_COLORS.tsb}
            strokeDasharray="6 7"
            strokeWidth="2"
          />
        ) : null}
        {model.forecastAtlPath ? (
          <path
            d={model.forecastAtlPath}
            fill="none"
            stroke={ICU_SERIES_COLORS.atl}
            strokeDasharray="6 7"
            strokeWidth="2"
          />
        ) : null}
        {model.ticks.map((tick) => (
          <text
            key={tick.x}
            x={tick.x}
            y="252"
            textAnchor="middle"
            style={{ fill: 'var(--color-fg-subtle)' }}
            className="font-mono text-micro"
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </div>
  )
}

function RiskBands({ model }: { model: ChartModel }) {
  const yHigh = model.y(-25)
  const yLoad = model.y(-10)
  const yFresh = model.y(15)
  return (
    <>
      <rect
        x="0"
        y={Math.max(0, yHigh)}
        width="720"
        height={Math.max(0, 224 - yHigh)}
        fill="var(--color-danger)"
        opacity="0.06"
      />
      <rect
        x="0"
        y={Math.max(0, yLoad)}
        width="720"
        height={Math.max(0, yHigh - yLoad)}
        fill="var(--color-warning)"
        opacity="0.07"
      />
      <rect
        x="0"
        y="20"
        width="720"
        height={Math.max(0, yFresh - 20)}
        fill="var(--color-success)"
        opacity="0.05"
      />
    </>
  )
}

function RecentLoadTable({ points }: { points: IntervalsFitnessPoint[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-[1fr_72px_72px_72px] border-b border-border px-4 py-3 font-mono text-micro uppercase tracking-stamp text-fg-subtle">
        <span>日期</span>
        <span className="text-right">CTL</span>
        <span className="text-right">ATL</span>
        <span className="text-right">TSB</span>
      </div>
      <ol className="divide-y divide-border">
        {points.map((point) => (
          <li key={point.date} className="grid grid-cols-[1fr_72px_72px_72px] px-4 py-3 text-sm">
            <span className="font-mono text-xs text-fg-muted">{formatDate(point.date)}</span>
            <span className="text-right font-mono tabular text-fg">{formatMetric(point.ctl)}</span>
            <span className="text-right font-mono tabular text-accent">
              {formatMetric(point.atl)}
            </span>
            <span className="text-right font-mono tabular text-fg">{signedMetric(point.tsb)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LoadSummary({
  report,
  planOverview,
}: {
  report: IntervalsTrainingLoadReport
  planOverview: TrainingPlanOverview | null
}) {
  const latest = report.summary.latest
  if (!latest) return null
  const forecast = futureSummaryForDisplay(report.summary.forecast, planOverview)
  return (
    <aside className="rounded-lg border border-border bg-surface px-5 py-4">
      <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">Snapshot</p>
      <div className="mt-5 space-y-4">
        <SummaryRow label="最近日期" value={formatDate(latest.date)} />
        <SummaryRow
          label="检测状态"
          value={report.assessment.title}
          tone={toneForAssessment(report.assessment.level)}
        />
        <SummaryRow
          label="未来计划"
          value={forecast ? `${forecast.workouts} 节 · ${forecast.source}` : '未编排'}
          tone={forecast && forecast.workouts > 0 ? 'success' : 'idle'}
        />
        <SummaryRow
          label="计划负荷"
          value={forecast ? formatMetric(forecast.totalPlannedLoad) : '—'}
        />
        <SummaryRow label="未来最低 TSB" value={displayOptional(forecast?.minTsb, true)} />
        <SummaryRow label="读取时间" value={formatDateTime(report.summary.fetchedAt)} />
      </div>
    </aside>
  )
}

function SummaryRow({
  label,
  value,
  tone = 'idle',
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'danger' | 'idle'
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">{label}</span>
      <span className="flex items-center gap-2 text-right font-mono text-xs text-fg">
        <StatusDot tone={tone} />
        {value}
      </span>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-stamp">
      <span className="h-px w-5" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function forecastPointsForDisplay(
  latest: IntervalsFitnessPoint | undefined,
  intervalsPoints: IntervalsFitnessPoint[] | undefined,
  planOverview: TrainingPlanOverview | null,
): IntervalsFitnessPoint[] {
  const localPoints = planOverview?.projection?.points
  if (localPoints && localPoints.length > 0) {
    return latest ? localPoints.filter((point) => point.date > latest.date) : localPoints
  }
  return intervalsPoints ?? []
}

interface FutureSummary {
  source: string
  workouts: number
  totalPlannedLoad: number
  minTsb?: number
}

function futureSummaryForDisplay(
  intervalsForecast: IntervalsTrainingLoadReport['summary']['forecast'],
  planOverview: TrainingPlanOverview | null,
): FutureSummary | null {
  if (planOverview && planOverview.workouts.length > 0) {
    return {
      source: '本地计划',
      workouts: planOverview.workouts.length,
      totalPlannedLoad: planOverview.totals.trainingLoad,
      ...(planOverview.projection?.minTsb !== undefined
        ? { minTsb: planOverview.projection.minTsb }
        : {}),
    }
  }
  if (!intervalsForecast) return null
  return {
    source: 'ICU',
    workouts: intervalsForecast.events.length,
    totalPlannedLoad: intervalsForecast.totalPlannedLoad,
    ...(intervalsForecast.minTsb !== undefined ? { minTsb: intervalsForecast.minTsb } : {}),
  }
}

function TrainingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-lg bg-surface-2" />
    </div>
  )
}

interface ChartModel {
  ctlPath: string
  atlPath: string
  tsbPath: string
  forecastAtlPath?: string
  forecastTsbPath?: string
  zeroY: number
  gridY: number[]
  ticks: Array<{ x: number; label: string }>
  y: (value: number) => number
}

function buildChartModel(
  points: IntervalsFitnessPoint[],
  forecastPoints: IntervalsFitnessPoint[],
): ChartModel | null {
  if (points.length < 2) return null
  const width = 720
  const top = 20
  const bottom = 224
  const allPoints = [...points, ...forecastPoints]
  const values = allPoints.flatMap((point) => [point.ctl, point.atl, point.tsb, -25, -10, 15])
  const minRaw = Math.min(...values)
  const maxRaw = Math.max(...values)
  const padding = Math.max(5, (maxRaw - minRaw) * 0.12)
  const min = minRaw - padding
  const max = maxRaw + padding
  const range = max - min || 1
  const totalSlots = points.length + forecastPoints.length - 1
  const x = (index: number) => (index / Math.max(1, totalSlots - 1)) * width
  const y = (value: number) => bottom - ((value - min) / range) * (bottom - top)
  const pathFor = (
    pathPoints: IntervalsFitnessPoint[],
    metric: 'ctl' | 'atl' | 'tsb',
    offset = 0,
  ) =>
    pathPoints
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${x(index + offset).toFixed(1)} ${y(point[metric]).toFixed(1)}`,
      )
      .join(' ')
  const lastHistoryPoint = points.at(-1)
  const forecastPathPoints =
    forecastPoints.length > 0 && lastHistoryPoint ? [lastHistoryPoint, ...forecastPoints] : []
  const tickIndexes =
    forecastPoints.length > 0
      ? [0, points.length - 1, totalSlots - 1]
      : [0, Math.floor((points.length - 1) / 2), points.length - 1]

  return {
    ctlPath: pathFor(points, 'ctl'),
    atlPath: pathFor(points, 'atl'),
    tsbPath: pathFor(points, 'tsb'),
    ...(forecastPathPoints.length > 0
      ? {
          forecastAtlPath: pathFor(forecastPathPoints, 'atl', points.length - 1),
          forecastTsbPath: pathFor(forecastPathPoints, 'tsb', points.length - 1),
        }
      : {}),
    zeroY: y(0),
    gridY: [top, top + 51, top + 102, top + 153, bottom],
    ticks: tickIndexes.map((index) => ({
      x: x(index),
      label: formatDate(allPoints[Math.min(index, allPoints.length - 1)]?.date ?? ''),
    })),
    y,
  }
}

function previousPoint(
  points: IntervalsFitnessPoint[],
  date: string,
): IntervalsFitnessPoint | null {
  const index = points.findIndex((point) => point.date === date)
  if (index <= 0) return null
  return points[index - 1] ?? null
}

function forecastDaysForRange(range: TrainingStatusRange): number {
  if (range === 'future14') return 14
  if (range === 'future7') return 7
  return 0
}

function toneForAssessment(level: string): 'success' | 'warning' | 'danger' | 'idle' {
  if (level === 'high') return 'danger'
  if (level === 'load') return 'warning'
  if (level === 'good') return 'success'
  return 'idle'
}

function toneForReason(severity: string): 'success' | 'warning' | 'danger' | 'idle' {
  if (severity === 'danger') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'idle'
}

function formatMetric(value: number): string {
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 1)
}

function signedMetric(value: number): string {
  return `${value > 0 ? '+' : ''}${formatMetric(value)}`
}

function formatReasonValue(reason: TrainingStatusReason): string {
  if (reason.metric === 'ATL/CTL') return `${(reason.value ?? 0).toFixed(2)}x`
  return signedMetric(reason.value ?? 0)
}

function displayOptional(value?: number, signed = false): string {
  if (value === undefined) return '—'
  return signed ? signedMetric(value) : formatMetric(value)
}

function formatDate(value: string): string {
  const [, mm, dd] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  return mm && dd ? `${mm}/${dd}` : value
}

function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d
    .toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(/\s/g, '')
}

export const Route = createFileRoute('/training')({ component: TrainingLoad })
