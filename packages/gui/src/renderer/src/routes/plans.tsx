import type {
  PlannedWorkout,
  TrainingPlanOverview,
  TrainingPlanWeek,
  UpsertPlannedWorkoutInput,
  WorkoutStepInput,
  WorkoutStepKind,
  WorkoutStructureItem,
  WorkoutTargetType,
} from '@sweatrelay/core'
import { createFileRoute } from '@tanstack/react-router'
import {
  CalendarDays,
  ClipboardPaste,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Send,
  Trash2,
} from 'lucide-react'
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { toast } from 'sonner'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const STEP_KINDS = {
  Warmup: 'warmup',
  Steady: 'steady',
  Interval: 'interval',
  Recovery: 'recovery',
  Cooldown: 'cooldown',
} as const
const TARGET_TYPES = {
  Ftp: 'ftp',
  HeartRateMax: 'hrmax',
} as const
const STRUCTURE_TYPES = {
  Step: 'step',
  Repeat: 'repeat',
} as const

type PlanDraft = {
  name: string
  description: string
  startDate: string
  weeks: number
}

type WorkoutDraft = {
  id?: string
  date: string
  name: string
  description: string
  items: WorkoutDraftItem[]
}

type StepDraft = {
  id?: string
  type: typeof STRUCTURE_TYPES.Step
  kind: WorkoutStepKind
  durationMinutes: number
  targetType: WorkoutTargetType
  target: number
  note: string
}

type RepeatDraft = {
  id: string
  type: typeof STRUCTURE_TYPES.Repeat
  repeat: number
  steps: StepDraft[]
}

type WorkoutDraftItem = StepDraft | RepeatDraft

function PlansRoute() {
  const [overview, setOverview] = useState<TrainingPlanOverview | null>(null)
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null)
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutDraft | null>(null)
  const [copiedWorkout, setCopiedWorkout] = useState<PlannedWorkout | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refreshPlan = useCallback(async () => {
    setBusy(true)
    setErr(null)
    const res = await api.trainingPlan()
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    setOverview(res.value)
    setPlanDraft(planToDraft(res.value))
  }, [])

  useEffect(() => {
    void refreshPlan()
  }, [refreshPlan])

  async function savePlan(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!overview || !planDraft) return
    setBusy(true)
    setErr(null)
    const res = await api.updateTrainingPlan({
      id: overview.plan.id,
      name: planDraft.name,
      description: planDraft.description,
      startDate: planDraft.startDate,
      weeks: planDraft.weeks,
    })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    setOverview(res.value)
    setPlanDraft(planToDraft(res.value))
    setMessage('计划信息已保存')
  }

  async function saveWorkout(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!overview || !workoutDraft) return
    setBusy(true)
    setErr(null)
    const payload = workoutDraftToPayload(overview.plan.id, workoutDraft)
    const res = await api.upsertPlannedWorkout(payload)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    setOverview(res.value)
    setPlanDraft(planToDraft(res.value))
    setWorkoutDraft(null)
    setMessage('训练已保存')
  }

  function copyWorkout(workout: PlannedWorkout) {
    setCopiedWorkout(workout)
    setErr(null)
    toast.success('已复制训练课', {
      description: `「${workout.name}」可粘贴到任意日期`,
    })
  }

  async function pasteWorkout(date: string) {
    if (!overview || !copiedWorkout) return
    setBusy(true)
    setErr(null)
    const draft = cloneWorkoutDraft(copiedWorkout, date)
    const res = await api.upsertPlannedWorkout(workoutDraftToPayload(overview.plan.id, draft))
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    setOverview(res.value)
    setPlanDraft(planToDraft(res.value))
    toast.success('已粘贴训练课', {
      description: `「${copiedWorkout.name}」已添加到 ${formatDate(date)}`,
    })
  }

  async function deleteWorkout(workout: PlannedWorkout) {
    if (!overview) return
    if (!window.confirm(`删除「${workout.name}」？这只会删除 SweatRelay 本地计划。`)) return
    setBusy(true)
    setErr(null)
    const res = await api.deletePlannedWorkout({
      planId: overview.plan.id,
      workoutId: workout.id,
    })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    setOverview(res.value)
    setPlanDraft(planToDraft(res.value))
    setMessage('训练已删除')
  }

  async function syncPlan() {
    if (!overview) return
    if (overview.workouts.length === 0) {
      setErr('计划里还没有训练')
      return
    }
    if (
      !window.confirm(
        `将 ${overview.workouts.length} 节计划训练同步到 Intervals.icu？如果这些训练之前已由 SweatRelay 同步过，本次会更新对应内容。`,
      )
    ) {
      return
    }
    setSyncing(true)
    setErr(null)
    const res = await api.syncTrainingPlan({ planId: overview.plan.id })
    setSyncing(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    setOverview(res.value.overview)
    setPlanDraft(planToDraft(res.value.overview))
    setMessage(`已同步 ${res.value.result.upserted}/${res.value.result.attempted} 节训练到 ICU`)
  }

  if (!overview || !planDraft) {
    return (
      <div className="space-y-8">
        <SectionHeading
          index="02"
          title="训练计划"
          subtitle="在 SweatRelay 编排未来训练计划，并预览 CTL / ATL / TSB 风险。"
        />
        {err ? (
          <Alert variant="destructive">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        ) : null}
        <div className="h-96 animate-pulse rounded-lg bg-surface-2" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        index="02"
        title="训练计划"
        subtitle="本地编排训练结构，实时估算 TSS，并同步 planned workouts 到 Intervals.icu。"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={refreshPlan} disabled={busy}>
              <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
              刷新
            </Button>
            <Button onClick={syncPlan} disabled={syncing || overview.workouts.length === 0}>
              <Send className={cn('size-4', syncing && 'animate-pulse')} />
              同步 ICU
            </Button>
          </div>
        }
      />

      {err ? (
        <Alert variant="destructive">
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <PlanForm draft={planDraft} onChange={setPlanDraft} onSubmit={savePlan} busy={busy} />
        <PlanStats overview={overview} />
      </section>

      <PlanCalendar
        overview={overview}
        clipboardName={copiedWorkout?.name}
        onAdd={(date) => setWorkoutDraft(newWorkoutDraft(date))}
        onEdit={(workout) => setWorkoutDraft(workoutToDraft(workout))}
        onPaste={pasteWorkout}
        onCopy={copyWorkout}
        onDelete={deleteWorkout}
      />

      <WorkoutEditor
        draft={workoutDraft}
        busy={busy}
        onChange={setWorkoutDraft}
        onClose={() => setWorkoutDraft(null)}
        onSubmit={saveWorkout}
      />
    </div>
  )
}

function PlanForm({
  draft,
  busy,
  onChange,
  onSubmit,
}: {
  draft: PlanDraft
  busy: boolean
  onChange: (draft: PlanDraft) => void
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-bg/50 text-accent">
          <CalendarDays className="size-5" />
        </span>
        <div>
          <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">
            Plan setup
          </p>
          <h2 className="font-display text-2xl uppercase leading-none text-fg">计划信息</h2>
        </div>
      </div>
      <div className="space-y-4">
        <LabelledControl label="计划名称">
          <Input
            value={draft.name}
            maxLength={40}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </LabelledControl>
        <LabelledControl label="计划简介">
          <textarea
            value={draft.description}
            rows={5}
            maxLength={300}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            className="min-h-28 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-sm outline-none transition-colors placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
        </LabelledControl>
        <div className="grid grid-cols-2 gap-3">
          <LabelledControl label="开始日期">
            <Input
              type="date"
              value={draft.startDate}
              onChange={(event) => onChange({ ...draft, startDate: event.target.value })}
            />
          </LabelledControl>
          <LabelledControl label="周数">
            <Input
              type="number"
              min={1}
              max={24}
              value={draft.weeks}
              onChange={(event) =>
                onChange({ ...draft, weeks: Number.parseInt(event.target.value, 10) || 1 })
              }
            />
          </LabelledControl>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          <Save className="size-4" />
          保存计划
        </Button>
      </div>
    </form>
  )
}

function PlanStats({ overview }: { overview: TrainingPlanOverview }) {
  const maxLoad = Math.max(1, ...overview.weeks.map((week) => week.totals.trainingLoad))
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">
            Load forecast
          </p>
          <h2 className="mt-1 font-display text-2xl uppercase leading-none text-fg">周负荷统计</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <StatPill label="总时长" value={formatDuration(overview.totals.durationSeconds)} />
          <StatPill label="训练负荷" value={`${Math.round(overview.totals.trainingLoad)}`} />
          <StatPill label="最低 TSB" value={displaySigned(overview.projection?.minTsb)} />
        </div>
      </div>
      <div className="h-48">
        <svg viewBox="0 0 720 180" className="h-full w-full" role="img" aria-label="Weekly load">
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1="0"
              x2="720"
              y1={24 + i * 38}
              y2={24 + i * 38}
              stroke="var(--color-border)"
            />
          ))}
          {overview.weeks.map((week, index) => {
            const slot = 720 / overview.weeks.length
            const height = (week.totals.trainingLoad / maxLoad) * 112
            const x = index * slot + slot * 0.35
            const y = 142 - height
            return (
              <g key={week.index}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(8, slot * 0.3)}
                  height={height}
                  rx="4"
                  fill="var(--color-accent)"
                  opacity="0.78"
                />
                <text
                  x={index * slot + slot / 2}
                  y="168"
                  textAnchor="middle"
                  className="font-mono text-micro"
                  style={{ fill: 'var(--color-fg-subtle)' }}
                >
                  W{week.index}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-3">
        <ProjectionTile
          label="预测来源"
          value={overview.projection ? 'ICU 起点 + 本地计划' : '等待 ICU 连接'}
        />
        <ProjectionTile
          label="风险日期"
          value={overview.projection?.minTsbDate ? formatDate(overview.projection.minTsbDate) : '—'}
        />
        <ProjectionTile label="计划训练" value={`${overview.workouts.length} 节`} />
      </div>
    </section>
  )
}

function PlanCalendar({
  overview,
  clipboardName,
  onAdd,
  onEdit,
  onPaste,
  onCopy,
  onDelete,
}: {
  overview: TrainingPlanOverview
  clipboardName?: string
  onAdd: (date: string) => void
  onEdit: (workout: PlannedWorkout) => void
  onPaste: (date: string) => void
  onCopy: (workout: PlannedWorkout) => void
  onDelete: (workout: PlannedWorkout) => Promise<void>
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid min-w-[980px] grid-cols-[repeat(7,minmax(120px,1fr))_180px] border-b border-border bg-surface-2/60">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-r border-border px-3 py-3 text-center font-display text-lg"
          >
            {day}
          </div>
        ))}
        <div className="px-3 py-3 text-center font-display text-lg">周统计</div>
      </div>
      <div className="max-h-[720px] min-w-[980px] overflow-auto">
        {overview.weeks.map((week) => (
          <PlanWeekRow
            key={week.index}
            week={week}
            clipboardName={clipboardName}
            onAdd={onAdd}
            onEdit={onEdit}
            onPaste={onPaste}
            onCopy={onCopy}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  )
}

function PlanWeekRow({
  week,
  clipboardName,
  onAdd,
  onEdit,
  onPaste,
  onCopy,
  onDelete,
}: {
  week: TrainingPlanWeek
  clipboardName?: string
  onAdd: (date: string) => void
  onEdit: (workout: PlannedWorkout) => void
  onPaste: (date: string) => void
  onCopy: (workout: PlannedWorkout) => void
  onDelete: (workout: PlannedWorkout) => Promise<void>
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="bg-surface-2 px-4 py-1.5 font-mono text-micro uppercase tracking-stamp text-fg-muted">
        第 {week.index} 周 · {formatDate(week.startDate)} - {formatDate(week.endDate)}
      </div>
      <div className="grid grid-cols-[repeat(7,minmax(120px,1fr))_180px]">
        {week.days.map((day) => (
          <div key={day.date} className="min-h-44 border-r border-border p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">
                {formatDay(day.date)}
              </span>
              <DayActionMenu
                date={day.date}
                clipboardName={clipboardName}
                onAdd={onAdd}
                onPaste={onPaste}
              />
            </div>
            <div className="space-y-2">
              {day.workouts.map((workout) => (
                <WorkoutCard
                  key={workout.id}
                  workout={workout}
                  onEdit={() => onEdit(workout)}
                  onCopy={() => onCopy(workout)}
                  onDelete={() => onDelete(workout)}
                />
              ))}
            </div>
          </div>
        ))}
        <WeekSummary week={week} />
      </div>
    </div>
  )
}

function DayActionMenu({
  date,
  clipboardName,
  onAdd,
  onPaste,
}: {
  date: string
  clipboardName?: string
  onAdd: (date: string) => void
  onPaste: (date: string) => void
}) {
  const [open, setOpen] = useState(false)
  const canPaste = Boolean(clipboardName)

  function close() {
    setOpen(false)
  }

  return (
    <div className="relative">
      <IconTooltip label="添加训练">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-accent"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="添加训练"
        >
          <Plus className="size-3.5" />
        </button>
      </IconTooltip>
      {open ? (
        <div className="absolute right-0 top-7 z-30 w-40 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-2"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              close()
              onAdd(date)
            }}
          >
            <Plus className="size-4 text-accent" />
            新建训练
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-2 disabled:text-fg-muted disabled:hover:bg-transparent"
            disabled={!canPaste}
            title={clipboardName ? `粘贴：${clipboardName}` : '先复制一节训练课'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!canPaste) return
              close()
              onPaste(date)
            }}
          >
            <ClipboardPaste className="size-4 text-accent" />
            粘贴训练
          </button>
          {clipboardName ? (
            <p className="border-t border-border px-3 py-2 font-mono text-micro uppercase tracking-stamp text-fg-muted">
              {clipboardName}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function WorkoutCard({
  workout,
  onEdit,
  onCopy,
  onDelete,
}: {
  workout: PlannedWorkout
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  return (
    <article className="overflow-hidden rounded-md border border-border bg-bg/50">
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full items-center justify-between gap-2 bg-accent px-3 py-2 text-left text-accent-fg"
      >
        <span className="truncate text-sm font-semibold">{workout.name}</span>
        <StatusDot tone={workout.syncState === 'synced' ? 'success' : 'idle'} />
      </button>
      <div className="space-y-3 px-3 py-3">
        <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs tabular text-fg">
          <span>{formatDuration(workout.durationSeconds)}</span>
          <span>{workout.intensityFactor.toFixed(2)} IF</span>
          <span>{Math.round(workout.trainingLoad)} TSS</span>
        </div>
        <MiniWorkoutBars workout={workout} />
        <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
          <IconTooltip label="编辑训练">
            <button
              type="button"
              onClick={onEdit}
              className="text-fg-muted hover:text-accent"
              aria-label="编辑训练"
            >
              <Pencil className="size-3.5" />
            </button>
          </IconTooltip>
          <IconTooltip label="复制训练">
            <button
              type="button"
              onClick={onCopy}
              className="text-fg-muted hover:text-accent"
              aria-label="复制训练"
            >
              <Copy className="size-3.5" />
            </button>
          </IconTooltip>
          <IconTooltip label="删除训练">
            <button
              type="button"
              onClick={onDelete}
              className="text-fg-muted hover:text-danger"
              aria-label="删除训练"
            >
              <Trash2 className="size-3.5" />
            </button>
          </IconTooltip>
        </div>
      </div>
    </article>
  )
}

function MiniWorkoutBars({ workout }: { workout: PlannedWorkout }) {
  const total = Math.max(1, workout.durationSeconds)
  return (
    <div className="flex h-4 items-end gap-px bg-surface-2 px-1 py-1">
      {workout.steps.map((step) => (
        <span
          key={step.id}
          className="block h-full"
          style={{
            width: `${(step.durationSeconds / total) * 100}%`,
            backgroundColor:
              step.targetLow >= 90
                ? 'var(--color-danger)'
                : step.targetLow >= 75
                  ? 'var(--color-warning)'
                  : 'var(--color-accent)',
          }}
        />
      ))}
    </div>
  )
}

function WeekSummary({ week }: { week: TrainingPlanWeek }) {
  const minTsb = week.days.reduce<number | undefined>((min, day) => {
    if (!day.projection) return min
    return min === undefined || day.projection.tsb < min ? day.projection.tsb : min
  }, undefined)
  const tone =
    minTsb !== undefined && minTsb <= -25
      ? 'danger'
      : minTsb !== undefined && minTsb < -10
        ? 'warning'
        : 'idle'
  return (
    <aside className="bg-surface-2/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-micro uppercase tracking-stamp-wide text-fg-subtle">
          Week {week.index}
        </p>
        <StatusDot tone={tone} />
      </div>
      <dl className="space-y-3 text-sm">
        <SummaryLine label="时长" value={formatDuration(week.totals.durationSeconds)} />
        <SummaryLine label="负荷" value={`${Math.round(week.totals.trainingLoad)} TSS`} />
        <SummaryLine label="训练" value={`${week.totals.workouts} 节`} />
        <SummaryLine label="最低 TSB" value={displaySigned(minTsb)} />
      </dl>
    </aside>
  )
}

function WorkoutEditor({
  draft,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: WorkoutDraft | null
  busy: boolean
  onChange: (draft: WorkoutDraft | null) => void
  onClose: () => void
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>
}) {
  const stats = useMemo(
    () =>
      draft
        ? calculateDraftStats(flattenDraftItems(draft.items))
        : { durationSeconds: 0, intensityFactor: 0, trainingLoad: 0 },
    [draft],
  )

  if (!draft) return null

  function addStep() {
    if (!draft) return
    onChange({ ...draft, items: [...draft.items, newStepDraft()] })
  }

  function addRepeatGroup() {
    if (!draft) return
    onChange({ ...draft, items: [...draft.items, newRepeatDraft()] })
  }

  function updateItem(index: number, item: WorkoutDraftItem) {
    if (!draft) return
    onChange({ ...draft, items: draft.items.map((current, i) => (i === index ? item : current)) })
  }

  function duplicateItem(index: number) {
    if (!draft) return
    const item = cloneDraftItem(draft.items[index])
    if (!item) return
    onChange({
      ...draft,
      items: [...draft.items.slice(0, index + 1), item, ...draft.items.slice(index + 1)],
    })
  }

  function removeItem(index: number) {
    if (!draft) return
    if (draft.items.length <= 1) return
    onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <form onSubmit={onSubmit} className="space-y-6">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl uppercase">训练编辑器</DialogTitle>
            <DialogDescription>
              按 FTP 或最大心率百分比编排步骤，保存后会自动计算 IF 和 TSS。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-[1fr_160px]">
            <LabelledControl label="训练名称">
              <Input
                value={draft.name}
                maxLength={48}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
              />
            </LabelledControl>
            <LabelledControl label="日期">
              <Input
                type="date"
                value={draft.date}
                onChange={(event) => onChange({ ...draft, date: event.target.value })}
              />
            </LabelledControl>
          </div>

          <LabelledControl label="简介">
            <textarea
              value={draft.description}
              rows={3}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            />
          </LabelledControl>

          <section className="rounded-lg border border-border bg-bg/40 p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">
                  Intensity preview
                </p>
                <h3 className="font-display text-2xl uppercase leading-none text-fg">强度预览</h3>
              </div>
              <div className="flex gap-3 text-right">
                <StatPill label="时长" value={formatDuration(stats.durationSeconds)} />
                <StatPill label="IF" value={stats.intensityFactor.toFixed(2)} />
                <StatPill label="TSS" value={`${Math.round(stats.trainingLoad)}`} />
              </div>
            </div>
            <StepPreview steps={flattenDraftItems(draft.items)} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl uppercase leading-none text-fg">训练编排</h3>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={addStep}>
                  <Plus className="size-4" />
                  添加步骤
                </Button>
                <Button type="button" variant="outline" onClick={addRepeatGroup}>
                  <Repeat2 className="size-4" />
                  添加重复组
                </Button>
              </div>
            </div>
            {draft.items.map((item, index) =>
              item.type === STRUCTURE_TYPES.Step ? (
                <StepEditorRow
                  key={item.id ?? index}
                  step={item}
                  index={index}
                  canDelete={draft.items.length > 1}
                  onChange={(next) => updateItem(index, next)}
                  onDuplicate={() => duplicateItem(index)}
                  onDelete={() => removeItem(index)}
                />
              ) : (
                <RepeatGroupEditor
                  key={item.id}
                  group={item}
                  index={index}
                  canDelete={draft.items.length > 1}
                  onChange={(next) => updateItem(index, next)}
                  onDuplicate={() => duplicateItem(index)}
                  onDelete={() => removeItem(index)}
                />
              ),
            )}
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              <Save className="size-4" />
              保存训练
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StepEditorRow({
  step,
  index,
  canDelete,
  onChange,
  onDuplicate,
  onDelete,
}: {
  step: StepDraft
  index: number
  canDelete: boolean
  onChange: (step: StepDraft) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <ItemHeading
          code={`STEP ${String(index + 1).padStart(2, '0')}`}
          title={stepKindLabel(step.kind)}
          detail={stepSummary(step)}
        />
        <div className="flex items-center gap-2">
          <IconTooltip label="复制步骤">
            <Button type="button" variant="ghost" size="icon" onClick={onDuplicate}>
              <Copy className="size-4" />
            </Button>
          </IconTooltip>
          <IconTooltip label="删除步骤">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={!canDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          </IconTooltip>
        </div>
      </div>
      <StepFields step={step} onChange={onChange} />
    </article>
  )
}

function RepeatGroupEditor({
  group,
  index,
  canDelete,
  onChange,
  onDuplicate,
  onDelete,
}: {
  group: RepeatDraft
  index: number
  canDelete: boolean
  onChange: (group: RepeatDraft) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  function updateStep(index: number, patch: Partial<StepDraft>) {
    onChange({
      ...group,
      steps: group.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    })
  }

  function removeStep(index: number) {
    if (group.steps.length <= 1) return
    onChange({ ...group, steps: group.steps.filter((_, i) => i !== index) })
  }

  const expandedSteps = group.steps.length * Math.max(1, group.repeat)

  return (
    <article className="rounded-lg border border-accent/60 bg-bg/40 p-4">
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-accent">
            <Repeat2 className="size-4" />
          </span>
          <ItemHeading
            code={`REPEAT ${String(index + 1).padStart(2, '0')}`}
            title={`${group.repeat} 次重复组`}
            detail={`${group.steps.length} 个组内步骤 · 展开 ${expandedSteps} 步`}
          />
        </div>
        <div className="flex items-center gap-2">
          <LabelledControl label="重复次数">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={99}
                value={group.repeat}
                onChange={(event) =>
                  onChange({
                    ...group,
                    repeat: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                  })
                }
                className="h-9 w-20"
              />
              <span className="text-sm text-fg-muted">次</span>
            </div>
          </LabelledControl>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange({ ...group, steps: [...group.steps, newStepDraft()] })}
          >
            <Plus className="size-4" />
            组内步骤
          </Button>
          <IconTooltip label="复制重复组">
            <Button type="button" variant="ghost" size="icon" onClick={onDuplicate}>
              <Copy className="size-4" />
            </Button>
          </IconTooltip>
          <IconTooltip label="删除重复组">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={!canDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          </IconTooltip>
        </div>
      </div>
      <div className="space-y-3 border-l-2 border-accent/50 pl-3">
        {group.steps.map((step, index) => (
          <article
            key={step.id ?? index}
            className="rounded-md border border-border bg-surface p-3"
          >
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <ItemHeading
                code={`LOOP STEP ${String(index + 1).padStart(2, '0')}`}
                title={stepKindLabel(step.kind)}
                detail={stepSummary(step)}
              />
              <IconTooltip label="删除组内步骤">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeStep(index)}
                  disabled={group.steps.length <= 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </IconTooltip>
            </div>
            <StepFields step={step} onChange={(next) => updateStep(index, next)} />
          </article>
        ))}
      </div>
    </article>
  )
}

function StepFields({ step, onChange }: { step: StepDraft; onChange: (step: StepDraft) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_2fr]">
      <LabelledControl label="步骤类型">
        <select
          value={step.kind}
          onChange={(event) => onChange({ ...step, kind: event.target.value as WorkoutStepKind })}
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {STEP_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </LabelledControl>
      <LabelledControl label="持续时间 (分钟)">
        <Input
          type="number"
          min={1}
          value={step.durationMinutes}
          onChange={(event) =>
            onChange({ ...step, durationMinutes: Number.parseInt(event.target.value, 10) || 1 })
          }
        />
      </LabelledControl>
      <LabelledControl label="强度基准">
        <select
          value={step.targetType}
          onChange={(event) =>
            onChange({ ...step, targetType: event.target.value as WorkoutTargetType })
          }
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {TARGET_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </LabelledControl>
      <LabelledControl label={targetValueLabel(step.targetType)}>
        <Input
          type="number"
          min={0}
          max={250}
          value={step.target}
          onChange={(event) =>
            onChange({ ...step, target: Number.parseInt(event.target.value, 10) || 0 })
          }
        />
      </LabelledControl>
      <LabelledControl label="备注">
        <Input
          value={step.note}
          placeholder="可选"
          onChange={(event) => onChange({ ...step, note: event.target.value })}
        />
      </LabelledControl>
    </div>
  )
}

function ItemHeading({ code, title, detail }: { code: string; title: string; detail: string }) {
  return (
    <div>
      <p className="font-mono text-micro uppercase tracking-stamp-wide text-accent">{code}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="font-display text-xl uppercase leading-none text-fg">{title}</h4>
        <span className="font-mono text-micro uppercase tracking-stamp text-fg-muted">
          {detail}
        </span>
      </div>
    </div>
  )
}

function IconTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function StepPreview({ steps }: { steps: StepDraft[] }) {
  const total = Math.max(
    1,
    steps.reduce((sum, step) => sum + step.durationMinutes, 0),
  )
  return (
    <div className="flex h-28 items-end overflow-hidden rounded-md border border-border bg-surface-2">
      {steps.map((step, index) => (
        <div
          key={step.id ?? index}
          className="flex h-full items-end border-r border-bg/50 last:border-r-0"
          style={{ width: `${(step.durationMinutes / total) * 100}%` }}
        >
          <div
            className="w-full bg-accent"
            style={{ height: `${Math.max(8, Math.min(step.target, 160) / 1.6)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

function LabelledControl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block font-mono text-micro uppercase tracking-stamp text-fg-muted">
        {label}
      </span>
      {children}
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">{label}</p>
      <p className="mt-1 font-display text-xl uppercase leading-none text-fg tabular">{value}</p>
    </div>
  )
}

function ProjectionTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg/40 px-3 py-2">
      <p className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">{label}</p>
      <p className="mt-1 truncate text-sm text-fg">{value}</p>
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono tabular text-fg">{value}</dd>
    </div>
  )
}

function planToDraft(overview: TrainingPlanOverview): PlanDraft {
  return {
    name: overview.plan.name,
    description: overview.plan.description ?? '',
    startDate: overview.plan.startDate,
    weeks: overview.plan.weeks,
  }
}

function newWorkoutDraft(date: string): WorkoutDraft {
  return {
    date,
    name: defaultWorkoutName(date),
    description: '',
    items: defaultWorkoutSteps().map(inputToStepDraft),
  }
}

function workoutToDraft(workout: PlannedWorkout): WorkoutDraft {
  return {
    id: workout.id,
    date: workout.date,
    name: workout.name,
    description: workout.description ?? '',
    items: workout.structure
      ? workout.structure.map(structureItemToDraft)
      : workout.steps.map((step) => ({
          id: step.id,
          type: STRUCTURE_TYPES.Step,
          kind: step.kind,
          durationMinutes: Math.max(1, Math.round(step.durationSeconds / 60)),
          targetType: step.targetType,
          target: Math.round((step.targetLow + step.targetHigh) / 2),
          note: step.note ?? '',
        })),
  }
}

function cloneWorkoutDraft(workout: PlannedWorkout, date: string): WorkoutDraft {
  const draft = workoutToDraft(workout)
  return {
    ...draft,
    id: undefined,
    date,
    name: workout.name,
    items: draft.items.flatMap((item) => {
      const clone = cloneDraftItem(item)
      return clone ? [clone] : []
    }),
  }
}

function workoutDraftToPayload(
  planId: string,
  workoutDraft: WorkoutDraft,
): UpsertPlannedWorkoutInput {
  return {
    id: workoutDraft.id,
    planId,
    date: workoutDraft.date,
    name: workoutDraft.name,
    description: workoutDraft.description,
    steps: flattenDraftItems(workoutDraft.items).map(stepDraftToInput),
    structure: workoutDraft.items.map(draftItemToStructure),
  }
}

function inputToStepDraft(step: WorkoutStepInput): StepDraft {
  return {
    id: step.id,
    type: STRUCTURE_TYPES.Step,
    kind: step.kind,
    durationMinutes: Math.max(1, Math.round(step.durationSeconds / 60)),
    targetType: step.targetType ?? TARGET_TYPES.Ftp,
    target: Math.round((step.targetLow + (step.targetHigh ?? step.targetLow)) / 2),
    note: step.note ?? '',
  }
}

function structureItemToDraft(item: WorkoutStructureItem): WorkoutDraftItem {
  if (item.type === STRUCTURE_TYPES.Step) return inputToStepDraft(item.step)
  return {
    id: item.id ?? crypto.randomUUID(),
    type: STRUCTURE_TYPES.Repeat,
    repeat: item.repeat,
    steps: item.steps.map(inputToStepDraft),
  }
}

function draftItemToStructure(item: WorkoutDraftItem): WorkoutStructureItem {
  if (item.type === STRUCTURE_TYPES.Step) {
    return { type: STRUCTURE_TYPES.Step, step: stepDraftToInput(item) }
  }
  return {
    id: item.id,
    type: STRUCTURE_TYPES.Repeat,
    repeat: Math.max(1, Math.trunc(item.repeat)),
    steps: item.steps.map(stepDraftToInput),
  }
}

function flattenDraftItems(items: readonly WorkoutDraftItem[]): StepDraft[] {
  return items.flatMap((item) => {
    if (item.type === STRUCTURE_TYPES.Step) return [item]
    const repeat = Math.max(1, Math.trunc(item.repeat))
    return Array.from({ length: repeat }, () =>
      item.steps.map((step) => ({
        ...step,
        id: undefined,
      })),
    ).flat()
  })
}

function cloneDraftItem(item: WorkoutDraftItem | undefined): WorkoutDraftItem | null {
  if (!item) return null
  if (item.type === STRUCTURE_TYPES.Step) return { ...item, id: crypto.randomUUID() }
  return {
    ...item,
    id: crypto.randomUUID(),
    steps: item.steps.map((step) => ({ ...step, id: crypto.randomUUID() })),
  }
}

function stepDraftToInput(step: StepDraft): WorkoutStepInput {
  return {
    id: step.id,
    kind: step.kind,
    durationSeconds: Math.max(1, step.durationMinutes) * 60,
    targetType: step.targetType,
    targetLow: step.target,
    targetHigh: step.target,
    ...(step.note.trim() ? { note: step.note.trim() } : {}),
  }
}

function newStepDraft(): StepDraft {
  return {
    id: crypto.randomUUID(),
    type: STRUCTURE_TYPES.Step,
    kind: STEP_KINDS.Steady,
    durationMinutes: 10,
    targetType: TARGET_TYPES.Ftp,
    target: 70,
    note: '',
  }
}

function newRepeatDraft(): RepeatDraft {
  return {
    id: crypto.randomUUID(),
    type: STRUCTURE_TYPES.Repeat,
    repeat: 3,
    steps: [
      {
        id: crypto.randomUUID(),
        type: STRUCTURE_TYPES.Step,
        kind: STEP_KINDS.Interval,
        durationMinutes: 2,
        targetType: TARGET_TYPES.Ftp,
        target: 110,
        note: '',
      },
      {
        id: crypto.randomUUID(),
        type: STRUCTURE_TYPES.Step,
        kind: STEP_KINDS.Recovery,
        durationMinutes: 2,
        targetType: TARGET_TYPES.Ftp,
        target: 60,
        note: '',
      },
    ],
  }
}

function calculateDraftStats(steps: StepDraft[]) {
  const durationSeconds = steps.reduce((sum, step) => sum + step.durationMinutes * 60, 0)
  if (durationSeconds <= 0) return { durationSeconds: 0, intensityFactor: 0, trainingLoad: 0 }
  const weighted = steps.reduce((sum, step) => {
    const target = step.target / 100
    return sum + step.durationMinutes * 60 * target ** 4
  }, 0)
  const intensityFactor = (weighted / durationSeconds) ** 0.25
  return {
    durationSeconds,
    intensityFactor,
    trainingLoad: (durationSeconds / 3600) * intensityFactor ** 2 * 100,
  }
}

function stepSummary(step: StepDraft): string {
  return `${formatDuration(step.durationMinutes * 60)} · ${step.target}% ${targetTypeLabel(
    step.targetType,
  )}`
}

function stepKindLabel(kind: WorkoutStepKind): string {
  return STEP_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '步骤'
}

function targetTypeLabel(type: WorkoutTargetType): string {
  return type === TARGET_TYPES.HeartRateMax ? '最大心率' : 'FTP'
}

function targetValueLabel(type: WorkoutTargetType): string {
  return type === TARGET_TYPES.HeartRateMax ? '最大心率 %' : 'FTP %'
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}m`
}

function formatDate(value: string): string {
  return value.replace(/^\d{4}-/, '').replace('-', '/')
}

function formatDay(value: string): string {
  return value.slice(8)
}

function displaySigned(value?: number): string {
  if (value === undefined) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

const STEP_KIND_OPTIONS: ReadonlyArray<{ value: WorkoutStepKind; label: string }> = [
  { value: STEP_KINDS.Warmup, label: '热身' },
  { value: STEP_KINDS.Steady, label: '骑行' },
  { value: STEP_KINDS.Interval, label: '间歇' },
  { value: STEP_KINDS.Recovery, label: '恢复' },
  { value: STEP_KINDS.Cooldown, label: '冷身' },
]

const TARGET_TYPE_OPTIONS: ReadonlyArray<{ value: WorkoutTargetType; label: string }> = [
  { value: TARGET_TYPES.Ftp, label: 'FTP %' },
  { value: TARGET_TYPES.HeartRateMax, label: '最大心率 %' },
]

function defaultWorkoutSteps(): WorkoutStepInput[] {
  return [
    {
      kind: STEP_KINDS.Warmup,
      durationSeconds: 600,
      targetType: TARGET_TYPES.Ftp,
      targetLow: 55,
    },
    {
      kind: STEP_KINDS.Interval,
      durationSeconds: 1800,
      targetType: TARGET_TYPES.Ftp,
      targetLow: 88,
    },
    {
      kind: STEP_KINDS.Cooldown,
      durationSeconds: 600,
      targetType: TARGET_TYPES.Ftp,
      targetLow: 50,
    },
  ]
}

function defaultWorkoutName(date: string): string {
  return `训练 ${date.slice(5).replace('-', '/')}`
}

export const Route = createFileRoute('/plans')({ component: PlansRoute })
