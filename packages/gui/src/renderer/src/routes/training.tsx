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
  ctl: 'oklch(70% 0.14 225)',
  atl: 'oklch(59% 0.15 300)',
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
              训练负荷趋势
            </h2>
            <p className="mt-2 text-xs text-fg-muted">
              上半区看体能与疲劳，下半区看状态值；虚线表示未来计划预测。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4 text-xs text-fg-muted">
            <Legend color={ICU_SERIES_COLORS.ctl} label="体能 CTL" />
            <Legend color={ICU_SERIES_COLORS.atl} label="疲劳 ATL" />
            <Legend color={ICU_SERIES_COLORS.tsb} label="状态 TSB" />
            <span className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">
              实线 已读取 · 虚线 计划
            </span>
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
        <div className="border-t border-border px-6 py-4 text-xs leading-6 text-fg-muted">
          <span className="font-medium text-fg">读图：</span>
          蓝线是体能，紫线是疲劳；下半区绿色线是状态值，越低表示越疲劳。虚线是按未来计划推算，状态值接近或低于
          -25 时需要减量或安排恢复。
        </div>
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
        viewBox="0 0 760 330"
        className="h-[420px] w-full"
        role="img"
        aria-label="CTL ATL TSB training load chart"
      >
        <ChartPanelLabel x={12} y={82} label="每日训练负荷" rotate />
        <ChartPanelLabel x={12} y={224} label="状态值" rotate />

        <rect
          x={model.left}
          y={model.loadTop}
          width={model.plotWidth}
          height={model.loadHeight}
          fill="var(--color-bg)"
          opacity="0.42"
        />
        <rect
          x={model.left}
          y={model.formTop}
          width={model.plotWidth}
          height={model.formHeight}
          fill="var(--color-bg)"
          opacity="0.28"
        />

        {model.ctlAreaPath ? (
          <path d={model.ctlAreaPath} fill={ICU_SERIES_COLORS.ctl} opacity="0.12" />
        ) : null}

        {model.loadTicks.map((tick) => (
          <g key={`load-${tick.value}`}>
            <line
              x1={model.left}
              x2={model.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--color-border)"
              strokeWidth="1"
            />
            <text
              x={model.left - 8}
              y={tick.y + 4}
              textAnchor="end"
              className="font-mono text-micro"
              style={{ fill: 'var(--color-fg-subtle)' }}
            >
              {formatTick(tick.value)}
            </text>
          </g>
        ))}

        {showBands ? <FormRiskBands model={model} /> : null}

        {model.formTicks.map((tick) => (
          <g key={`form-${tick.value}`}>
            <line
              x1={model.left}
              x2={model.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--color-border)"
              strokeWidth="1"
              strokeDasharray={tick.value === 0 ? '5 7' : undefined}
            />
            <text
              x={model.left - 8}
              y={tick.y + 4}
              textAnchor="end"
              className="font-mono text-micro"
              style={{ fill: 'var(--color-fg-subtle)' }}
            >
              {formatTick(tick.value)}
            </text>
          </g>
        ))}

        <line
          x1={model.currentX}
          x2={model.currentX}
          y1={model.loadTop}
          y2={model.formBottom}
          stroke="var(--color-border-strong)"
          strokeWidth="1.2"
          opacity="0.8"
        />

        <path d={model.ctlPath} fill="none" stroke={ICU_SERIES_COLORS.ctl} strokeWidth="2.3" />
        <path d={model.atlPath} fill="none" stroke={ICU_SERIES_COLORS.atl} strokeWidth="2.3" />
        <path d={model.tsbPath} fill="none" stroke={ICU_SERIES_COLORS.tsb} strokeWidth="2.1" />
        {model.forecastCtlPath ? (
          <path
            d={model.forecastCtlPath}
            fill="none"
            stroke={ICU_SERIES_COLORS.ctl}
            strokeDasharray="7 7"
            strokeWidth="2.1"
          />
        ) : null}
        {model.forecastAtlPath ? (
          <path
            d={model.forecastAtlPath}
            fill="none"
            stroke={ICU_SERIES_COLORS.atl}
            strokeDasharray="7 7"
            strokeWidth="2.1"
          />
        ) : null}
        {model.forecastTsbPath ? (
          <path
            d={model.forecastTsbPath}
            fill="none"
            stroke={ICU_SERIES_COLORS.tsb}
            strokeDasharray="7 7"
            strokeWidth="2.1"
          />
        ) : null}

        <ChartPoint x={model.currentX} y={model.currentCtlY} color={ICU_SERIES_COLORS.ctl} />
        <ChartPoint x={model.currentX} y={model.currentAtlY} color={ICU_SERIES_COLORS.atl} />
        <ChartPoint x={model.currentX} y={model.currentTsbY} color={ICU_SERIES_COLORS.tsb} />

        <text
          x={model.currentX}
          y={model.loadTop - 12}
          textAnchor="middle"
          className="font-mono text-micro uppercase tracking-stamp"
          style={{ fill: 'var(--color-fg-muted)' }}
        >
          {formatAxisDate(model.currentDate)}
        </text>

        <ChartValueRail model={model} />

        <line
          x1={model.left}
          x2={model.right}
          y1={model.loadBottom}
          y2={model.loadBottom}
          stroke="var(--color-border-strong)"
          strokeWidth="1"
        />
        <line
          x1={model.left}
          x2={model.right}
          y1={model.formBottom}
          y2={model.formBottom}
          stroke="var(--color-border-strong)"
          strokeWidth="1"
        />

        {model.ticks.map((tick) => (
          <text
            key={tick.x}
            x={tick.x}
            y="306"
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

function ChartPanelLabel({
  x,
  y,
  label,
  rotate,
}: {
  x: number
  y: number
  label: string
  rotate?: boolean
}) {
  return (
    <text
      x={x}
      y={y}
      transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}
      textAnchor="middle"
      className="font-mono text-micro uppercase tracking-stamp"
      style={{ fill: 'var(--color-fg-subtle)' }}
    >
      {label}
    </text>
  )
}

function ChartPoint({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r="4" fill={color} stroke="var(--color-surface)" strokeWidth="2" />
}

function ChartValueRail({ model }: { model: ChartModel }) {
  return (
    <g>
      <text
        x={model.railX}
        y={model.loadTop + 2}
        className="font-mono text-micro uppercase tracking-stamp"
        style={{ fill: 'var(--color-fg-subtle)' }}
      >
        当前
      </text>
      <ChartRailValue
        x={model.railX}
        y={model.loadTop + 28}
        label="体能"
        value={model.current.ctl}
        color={ICU_SERIES_COLORS.ctl}
      />
      <ChartRailValue
        x={model.railX}
        y={model.loadTop + 56}
        label="疲劳"
        value={model.current.atl}
        color={ICU_SERIES_COLORS.atl}
      />
      <ChartRailValue
        x={model.railX}
        y={model.formTop + 46}
        label="状态"
        value={model.current.tsb}
        color={ICU_SERIES_COLORS.tsb}
        signed
      />
      <text
        x={model.railX}
        y={model.formTop + 76}
        className="font-mono text-micro uppercase tracking-stamp"
        style={{ fill: 'var(--color-fg-subtle)' }}
      >
        风险区
      </text>
      <ChartBandLabel
        x={model.railX}
        y={model.formTop + 96}
        color="var(--color-warning)"
        label="恢复偏多"
      />
      <ChartBandLabel
        x={model.railX}
        y={model.formTop + 116}
        color="var(--color-success)"
        label="可控区"
      />
      <ChartBandLabel
        x={model.railX}
        y={model.formTop + 136}
        color="var(--color-danger)"
        label="高风险"
      />
    </g>
  )
}

function ChartRailValue({
  x,
  y,
  label,
  value,
  color,
  signed,
}: {
  x: number
  y: number
  label: string
  value: number
  color: string
  signed?: boolean
}) {
  return (
    <g>
      <text x={x} y={y} className="text-xs" style={{ fill: 'var(--color-fg-muted)' }}>
        {label}
      </text>
      <text x={x + 42} y={y} className="font-mono text-xs font-semibold" style={{ fill: color }}>
        {signed ? signedMetric(value) : formatMetric(value)}
      </text>
    </g>
  )
}

function ChartBandLabel({
  x,
  y,
  color,
  label,
}: {
  x: number
  y: number
  color: string
  label: string
}) {
  return (
    <g>
      <circle cx={x} cy={y - 3} r="3" fill={color} />
      <text x={x + 10} y={y} className="text-micro" style={{ fill: 'var(--color-fg-muted)' }}>
        {label}
      </text>
    </g>
  )
}

function FormRiskBands({ model }: { model: ChartModel }) {
  const yFresh = model.formY(15)
  const yHigh = model.formY(-25)
  const yLoad = model.formY(-10)
  return (
    <>
      <rect
        x={model.left}
        y={Math.max(0, yHigh)}
        width={model.plotWidth}
        height={Math.max(0, model.formBottom - yHigh)}
        fill="var(--color-danger)"
        opacity="0.06"
      />
      <rect
        x={model.left}
        y={Math.max(0, yLoad)}
        width={model.plotWidth}
        height={Math.max(0, yHigh - yLoad)}
        fill="var(--color-warning)"
        opacity="0.05"
      />
      <rect
        x={model.left}
        y={Math.max(model.formTop, yFresh)}
        width={model.plotWidth}
        height={Math.max(0, yLoad - Math.max(model.formTop, yFresh))}
        fill="var(--color-success)"
        opacity="0.045"
      />
      <rect
        x={model.left}
        y={model.formTop}
        width={model.plotWidth}
        height={Math.max(0, yFresh - model.formTop)}
        fill="var(--color-warning)"
        opacity="0.035"
      />
      <text
        x={model.right - 6}
        y={yFresh - 6}
        textAnchor="end"
        className="font-mono text-micro uppercase tracking-stamp"
        style={{ fill: 'var(--color-warning)' }}
      >
        恢复偏多
      </text>
      <text
        x={model.right - 6}
        y={model.formY(-10) - 6}
        textAnchor="end"
        className="font-mono text-micro uppercase tracking-stamp"
        style={{ fill: 'var(--color-success)' }}
      >
        可控区
      </text>
      <text
        x={model.right - 6}
        y={model.formY(-25) + 14}
        textAnchor="end"
        className="font-mono text-micro uppercase tracking-stamp"
        style={{ fill: 'var(--color-danger)' }}
      >
        高风险
      </text>
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
            <span className="font-mono text-xs text-fg-muted">
              {formatCalendarDate(point.date)}
            </span>
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
        <SummaryRow label="最近日期" value={formatCalendarDate(latest.date)} />
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
  left: number
  right: number
  railX: number
  plotWidth: number
  loadTop: number
  loadBottom: number
  loadHeight: number
  formTop: number
  formBottom: number
  formHeight: number
  ctlPath: string
  atlPath: string
  tsbPath: string
  ctlAreaPath?: string
  forecastCtlPath?: string
  forecastAtlPath?: string
  forecastTsbPath?: string
  loadTicks: ChartTick[]
  formTicks: ChartTick[]
  ticks: Array<{ x: number; label: string }>
  current: IntervalsFitnessPoint
  currentDate: string
  currentX: number
  currentCtlY: number
  currentAtlY: number
  currentTsbY: number
  formY: (value: number) => number
}

interface ChartTick {
  value: number
  y: number
}

function buildChartModel(
  points: IntervalsFitnessPoint[],
  forecastPoints: IntervalsFitnessPoint[],
): ChartModel | null {
  if (points.length < 2) return null
  const left = 46
  const right = 628
  const railX = 650
  const plotWidth = right - left
  const loadTop = 32
  const loadBottom = 144
  const formTop = 164
  const formBottom = 270
  const loadHeight = loadBottom - loadTop
  const formHeight = formBottom - formTop
  const allPoints = [...points, ...forecastPoints]
  const current = points.at(-1)
  if (!current) return null
  const loadValues = allPoints.flatMap((point) => [point.ctl, point.atl])
  const formValues = allPoints.map((point) => point.tsb).concat([-25, -10, 0, 15])
  const loadTicks = buildNumericTicks(
    Math.max(0, Math.min(...loadValues)),
    Math.max(...loadValues),
    5,
  )
  const formTicks = buildNumericTicks(Math.min(...formValues), Math.max(...formValues), 6)
  const loadMin = loadTicks.at(0) ?? 0
  const loadMax = loadTicks.at(-1) ?? 1
  const formMin = formTicks.at(0) ?? -30
  const formMax = formTicks.at(-1) ?? 20
  const totalSlots = points.length + forecastPoints.length - 1
  const x = (index: number) => left + (index / Math.max(1, totalSlots - 1)) * plotWidth
  const loadY = (value: number) =>
    loadBottom - ((value - loadMin) / Math.max(1, loadMax - loadMin)) * loadHeight
  const formY = (value: number) =>
    formBottom - ((value - formMin) / Math.max(1, formMax - formMin)) * formHeight
  const pathFor = (
    pathPoints: IntervalsFitnessPoint[],
    metric: 'ctl' | 'atl' | 'tsb',
    yFor: (value: number) => number,
    offset = 0,
  ) =>
    pathPoints
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${x(index + offset).toFixed(1)} ${yFor(point[metric]).toFixed(1)}`,
      )
      .join(' ')
  const lastHistoryPoint = points.at(-1)
  const forecastPathPoints =
    forecastPoints.length > 0 && lastHistoryPoint ? [lastHistoryPoint, ...forecastPoints] : []
  const ctlAreaPath = areaPathFor(points, 'ctl', loadY, loadBottom, x)
  const tickIndexes =
    forecastPoints.length > 0
      ? [0, points.length - 1, totalSlots - 1]
      : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const currentIndex = points.length - 1
  const currentX = x(currentIndex)

  return {
    left,
    right,
    railX,
    plotWidth,
    loadTop,
    loadBottom,
    loadHeight,
    formTop,
    formBottom,
    formHeight,
    ctlPath: pathFor(points, 'ctl', loadY),
    atlPath: pathFor(points, 'atl', loadY),
    tsbPath: pathFor(points, 'tsb', formY),
    ...(ctlAreaPath ? { ctlAreaPath } : {}),
    ...(forecastPathPoints.length > 0
      ? {
          forecastCtlPath: pathFor(forecastPathPoints, 'ctl', loadY, points.length - 1),
          forecastAtlPath: pathFor(forecastPathPoints, 'atl', loadY, points.length - 1),
          forecastTsbPath: pathFor(forecastPathPoints, 'tsb', formY, points.length - 1),
        }
      : {}),
    loadTicks: loadTicks.map((value) => ({ value, y: loadY(value) })),
    formTicks: formTicks.map((value) => ({ value, y: formY(value) })),
    ticks: tickIndexes.map((index) => ({
      x: x(index),
      label: formatAxisDate(allPoints[Math.min(index, allPoints.length - 1)]?.date ?? ''),
    })),
    current,
    currentDate: current.date,
    currentX,
    currentCtlY: loadY(current.ctl),
    currentAtlY: loadY(current.atl),
    currentTsbY: formY(current.tsb),
    formY,
  }
}

function areaPathFor(
  points: IntervalsFitnessPoint[],
  metric: 'ctl' | 'atl' | 'tsb',
  yFor: (value: number) => number,
  baselineY: number,
  xFor: (index: number) => number,
): string | null {
  if (points.length < 2) return null
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(point[metric]).toFixed(1)}`,
    )
    .join(' ')
  const firstX = xFor(0).toFixed(1)
  const lastX = xFor(points.length - 1).toFixed(1)
  return `${line} L ${lastX} ${baselineY.toFixed(1)} L ${firstX} ${baselineY.toFixed(1)} Z`
}

function buildNumericTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) return [Math.floor(min), Math.ceil(max + 1)]
  const range = niceNumber(max - min, false)
  const step = niceNumber(range / Math.max(1, count - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(4)))
  }
  return ticks
}

function niceNumber(value: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(value))
  const fraction = value / 10 ** exponent
  const niceFraction = round
    ? fraction < 1.5
      ? 1
      : fraction < 3
        ? 2
        : fraction < 7
          ? 5
          : 10
    : fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 5
          ? 5
          : 10
  return niceFraction * 10 ** exponent
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

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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

function formatCalendarDate(value: string): string {
  const parts = parseDateParts(value)
  return parts ? `${parts.year}/${parts.month}/${parts.day}` : value
}

function formatAxisDate(value: string): string {
  const parts = parseDateParts(value)
  return parts ? `${parts.month}/${parts.day}` : value
}

function parseDateParts(value: string): { year: string; month: string; day: string } | null {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  if (!year || !month || !day) return null
  return { year, month, day }
}

function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hour}:${minute}`
}

export const Route = createFileRoute('/training')({ component: TrainingLoad })
