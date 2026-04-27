import { randomUUID } from 'node:crypto'
import {
  type IntervalsPlannedWorkoutEvent,
  type PlannedWorkout,
  type TrainingLoadProjection,
  type TrainingLoadProjectionPoint,
  type TrainingPlanDay,
  type TrainingPlanOverview,
  type TrainingPlanTotals,
  type TrainingPlanWeek,
  type TrainingProjectionSeed,
  WorkoutSports,
  type WorkoutStats,
  type WorkoutStep,
  type WorkoutStepInput,
  WorkoutStepKinds,
  type WorkoutStructureItem,
  WorkoutStructureItemTypes,
  type WorkoutTargetType,
  WorkoutTargetTypes,
} from './types.ts'

const ATL_DAYS = 7
const CTL_DAYS = 42

export function calculateWorkoutStats(steps: readonly WorkoutStepInput[]): WorkoutStats {
  const durationSeconds = steps.reduce(
    (total, step) => total + normalizedDuration(step.durationSeconds),
    0,
  )
  if (durationSeconds <= 0) {
    return { durationSeconds: 0, intensityFactor: 0, trainingLoad: 0 }
  }

  const weightedFourthPower = steps.reduce((total, step) => {
    const seconds = normalizedDuration(step.durationSeconds)
    const target = normalizedTarget(step.targetLow, step.targetHigh)
    return total + seconds * target ** 4
  }, 0)
  const intensityFactor = (weightedFourthPower / durationSeconds) ** 0.25
  const trainingLoad = (durationSeconds / 3600) * intensityFactor ** 2 * 100

  return {
    durationSeconds,
    intensityFactor: round(intensityFactor, 3),
    trainingLoad: round(trainingLoad, 0),
  }
}

export function normalizeWorkoutSteps(
  workoutId: string,
  steps: readonly WorkoutStepInput[],
): WorkoutStep[] {
  return steps.map((step, index) => ({
    id: step.id ?? randomUUID(),
    workoutId,
    position: index,
    kind: step.kind,
    durationSeconds: normalizedDuration(step.durationSeconds),
    targetType: step.targetType ?? WorkoutTargetTypes.Ftp,
    targetLow: clampTarget(step.targetLow),
    targetHigh: clampTarget(step.targetHigh ?? step.targetLow),
    ...(step.note?.trim() ? { note: step.note.trim() } : {}),
  }))
}

export function flattenWorkoutStructure(
  structure: readonly WorkoutStructureItem[],
): WorkoutStepInput[] {
  return structure.flatMap((item) => {
    if (item.type === WorkoutStructureItemTypes.Step) return [item.step]
    const repeat = Math.max(1, Math.min(Math.trunc(item.repeat), 99))
    return Array.from({ length: repeat }, () =>
      item.steps.map((step) => ({
        ...step,
        id: undefined,
      })),
    ).flat()
  })
}

export function buildPlanOverview(
  plan: TrainingPlanOverview['plan'],
  workouts: PlannedWorkout[],
  seed?: TrainingProjectionSeed,
): TrainingPlanOverview {
  const weeks: TrainingPlanWeek[] = []
  const projection = seed
    ? projectTrainingLoad(plan.startDate, plan.weeks * 7, seed, loadsByDate(workouts))
    : undefined
  const projectionByDate = new Map(projection?.points.map((point) => [point.date, point]) ?? [])

  for (let weekIndex = 0; weekIndex < plan.weeks; weekIndex += 1) {
    const startDate = addDays(plan.startDate, weekIndex * 7)
    const days: TrainingPlanDay[] = Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(startDate, weekday)
      const dayWorkouts = workouts.filter((workout) => workout.date === date)
      return {
        date,
        weekday,
        workouts: dayWorkouts,
        totals: sumTotals(dayWorkouts),
        ...(projectionByDate.get(date) ? { projection: projectionByDate.get(date) } : {}),
      }
    })
    weeks.push({
      index: weekIndex + 1,
      startDate,
      endDate: addDays(startDate, 6),
      days,
      totals: sumTotals(days.flatMap((day) => day.workouts)),
    })
  }

  return {
    plan,
    weeks,
    workouts,
    totals: sumTotals(workouts),
    ...(projection ? { projection } : {}),
  }
}

export function projectTrainingLoad(
  startDate: string,
  days: number,
  seed: TrainingProjectionSeed,
  loadByDate: ReadonlyMap<string, number>,
): TrainingLoadProjection {
  let ctl = seed.ctl
  let atl = seed.atl
  const points: TrainingLoadProjectionPoint[] = []
  for (let i = 0; i < days; i += 1) {
    const date = addDays(startDate, i)
    const load = loadByDate.get(date) ?? 0
    atl = atl + (load - atl) / ATL_DAYS
    ctl = ctl + (load - ctl) / CTL_DAYS
    points.push({
      date,
      load,
      ctl: round(ctl, 1),
      atl: round(atl, 1),
      tsb: round(ctl - atl, 1),
    })
  }

  const min = points.reduce<TrainingLoadProjectionPoint | null>(
    (lowest, point) => (!lowest || point.tsb < lowest.tsb ? point : lowest),
    null,
  )
  const maxAtl = points.reduce<number | undefined>(
    (max, point) => (max === undefined || point.atl > max ? point.atl : max),
    undefined,
  )

  return {
    startDate,
    endDate: addDays(startDate, Math.max(0, days - 1)),
    points,
    ...(min ? { minTsb: min.tsb, minTsbDate: min.date } : {}),
    ...(maxAtl !== undefined ? { maxAtl } : {}),
    totalLoad: round(
      [...loadByDate.values()].reduce((total, load) => total + load, 0),
      0,
    ),
  }
}

export function buildIntervalsWorkoutEvent(workout: PlannedWorkout): IntervalsPlannedWorkoutEvent {
  return {
    category: 'WORKOUT',
    start_date_local: `${workout.date}T00:00:00`,
    type: workout.sport,
    name: workout.name,
    description: buildWorkoutDescription(workout),
    moving_time: workout.durationSeconds,
    target: workout.steps.every((step) => step.targetType === WorkoutTargetTypes.HeartRateMax)
      ? 'HR'
      : 'POWER',
    icu_training_load: workout.trainingLoad,
    external_id: workout.externalId,
  }
}

export function buildWorkoutDescription(workout: PlannedWorkout): string {
  return workout.structure
    ? structureDescriptionText(workout.structure)
    : workout.steps.map(stepDescriptionLine).join('\n')
}

export function defaultWorkoutSteps(): WorkoutStepInput[] {
  return [
    {
      kind: WorkoutStepKinds.Warmup,
      durationSeconds: 600,
      targetType: WorkoutTargetTypes.Ftp,
      targetLow: 55,
    },
    {
      kind: WorkoutStepKinds.Interval,
      durationSeconds: 1800,
      targetType: WorkoutTargetTypes.Ftp,
      targetLow: 88,
    },
    {
      kind: WorkoutStepKinds.Cooldown,
      durationSeconds: 600,
      targetType: WorkoutTargetTypes.Ftp,
      targetLow: 50,
    },
  ]
}

export function defaultWorkoutName(date: string): string {
  return `训练 ${date.slice(5).replace('-', '/')}`
}

export function defaultPlanStartDate(date = new Date()): string {
  const copy = new Date(date)
  const day = copy.getDay()
  const offset = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + offset)
  return localDate(copy)
}

export function localDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`)
  parsed.setDate(parsed.getDate() + days)
  return localDate(parsed)
}

function sumTotals(workouts: readonly PlannedWorkout[]): TrainingPlanTotals {
  const durationSeconds = workouts.reduce((total, workout) => total + workout.durationSeconds, 0)
  const trainingLoad = workouts.reduce((total, workout) => total + workout.trainingLoad, 0)
  const intensityFactor =
    durationSeconds > 0
      ? (workouts.reduce(
          (total, workout) => total + workout.durationSeconds * workout.intensityFactor ** 4,
          0,
        ) /
          durationSeconds) **
        0.25
      : 0
  return {
    workouts: workouts.length,
    durationSeconds,
    intensityFactor: round(intensityFactor, 3),
    trainingLoad: round(trainingLoad, 0),
  }
}

function loadsByDate(workouts: readonly PlannedWorkout[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const workout of workouts) {
    map.set(workout.date, (map.get(workout.date) ?? 0) + workout.trainingLoad)
  }
  return map
}

function normalizedDuration(value: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0))
}

function normalizedTarget(low: number, high?: number): number {
  return (clampTarget(low) + clampTarget(high ?? low)) / 2 / 100
}

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.round(value), 250))
}

function stepLabel(kind: WorkoutStep['kind']): string {
  if (kind === WorkoutStepKinds.Warmup) return 'Warmup'
  if (kind === WorkoutStepKinds.Interval) return 'Interval'
  if (kind === WorkoutStepKinds.Recovery) return 'Recovery'
  if (kind === WorkoutStepKinds.Cooldown) return 'Cooldown'
  return 'Steady'
}

function structureDescriptionText(structure: readonly WorkoutStructureItem[]): string {
  const blocks: string[] = []
  let looseSteps: string[] = []

  function flushLooseSteps() {
    if (looseSteps.length === 0) return
    blocks.push(looseSteps.join('\n'))
    looseSteps = []
  }

  for (const item of structure) {
    if (item.type === WorkoutStructureItemTypes.Step) {
      looseSteps.push(stepInputDescriptionLine(item.step))
      continue
    }
    flushLooseSteps()
    blocks.push(
      [
        `${Math.max(1, Math.trunc(item.repeat))}x`,
        ...item.steps.map((step) => stepInputDescriptionLine(step)),
      ].join('\n'),
    )
  }

  flushLooseSteps()
  return blocks.join('\n\n')
}

function stepDescriptionLine(step: WorkoutStep): string {
  return `- ${stepCue(step.kind, step.note)} ${formatDurationCompact(
    step.durationSeconds,
  )} ${targetSyntax(step.targetLow, step.targetHigh, step.targetType)}`
}

function stepInputDescriptionLine(step: WorkoutStepInput): string {
  return `- ${stepCue(step.kind, step.note)} ${formatDurationCompact(
    step.durationSeconds,
  )} ${targetSyntax(step.targetLow, step.targetHigh ?? step.targetLow, step.targetType)}`
}

function formatDurationCompact(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

function targetSyntax(
  low: number,
  high: number,
  type: WorkoutTargetType = WorkoutTargetTypes.Ftp,
): string {
  const range =
    Math.abs(high - low) < 1 ? `${Math.round(low)}%` : `${Math.round(low)}-${Math.round(high)}%`
  return type === WorkoutTargetTypes.HeartRateMax ? `${range} HR` : range
}

function stepCue(kind: WorkoutStep['kind'], note?: string): string {
  return note?.trim() || stepLabel(kind)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export { WorkoutSports, WorkoutStepKinds, WorkoutTargetTypes }
