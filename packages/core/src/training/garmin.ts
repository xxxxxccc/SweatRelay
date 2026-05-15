import { buildWorkoutDescription } from './calculations.ts'
import {
  type PlannedWorkout,
  type WorkoutStep,
  type WorkoutStepInput,
  WorkoutStepKinds,
  type WorkoutStructureItem,
  WorkoutStructureItemTypes,
  WorkoutTargetTypes,
} from './types.ts'

export interface GarminWorkoutTargetContext {
  ftpWatts?: number
  maxHeartRate?: number
}

export interface GarminPlannedWorkoutSyncItem {
  localId: string
  externalId: string
  date: string
  name: string
  workout: GarminWorkoutDefinition
}

export interface GarminWorkoutDefinition {
  workoutName: string
  sportType: GarminSportType
  estimatedDurationInSecs: number
  description: string
  workoutSegments: GarminWorkoutSegment[]
  author: Record<string, never>
}

export interface GarminWorkoutSegment {
  segmentOrder: number
  sportType: GarminSportType
  workoutSteps: GarminWorkoutStep[]
}

export type GarminWorkoutStep = GarminExecutableStep | GarminRepeatGroup

export interface GarminExecutableStep {
  type: 'ExecutableStepDTO'
  stepOrder: number
  stepType: GarminStepType
  endCondition: GarminEndCondition
  endConditionValue: number
  targetType: GarminTargetType
  targetValueOne?: number
  targetValueTwo?: number
}

export interface GarminRepeatGroup {
  type: 'RepeatGroupDTO'
  stepOrder: number
  stepType: GarminStepType
  numberOfIterations: number
  workoutSteps: GarminWorkoutStep[]
  endCondition: GarminEndCondition
  endConditionValue: number
  smartRepeat: false
}

interface GarminSportType {
  sportTypeId: number
  sportTypeKey: string
  displayOrder: number
}

interface GarminStepType {
  stepTypeId: number
  stepTypeKey: string
  displayOrder: number
}

interface GarminEndCondition {
  conditionTypeId: number
  conditionTypeKey: string
  displayOrder: number
  displayable: boolean
}

interface GarminTargetType {
  workoutTargetTypeId: number
  workoutTargetTypeKey: string
  displayOrder: number
}

const CYCLING_SPORT_TYPE = {
  sportTypeId: 2,
  sportTypeKey: 'cycling',
  displayOrder: 2,
} as const satisfies GarminSportType

const TIME_END_CONDITION = {
  conditionTypeId: 2,
  conditionTypeKey: 'time',
  displayOrder: 2,
  displayable: true,
} as const satisfies GarminEndCondition

const REPEAT_END_CONDITION = {
  conditionTypeId: 7,
  conditionTypeKey: 'iterations',
  displayOrder: 7,
  displayable: false,
} as const satisfies GarminEndCondition

const POWER_TARGET = {
  workoutTargetTypeId: 2,
  workoutTargetTypeKey: 'power.zone',
  displayOrder: 2,
} as const satisfies GarminTargetType

const HEART_RATE_TARGET = {
  workoutTargetTypeId: 4,
  workoutTargetTypeKey: 'heart.rate.zone',
  displayOrder: 4,
} as const satisfies GarminTargetType

export function buildGarminWorkoutSyncItem(
  workout: PlannedWorkout,
  targets: GarminWorkoutTargetContext,
): GarminPlannedWorkoutSyncItem {
  const order = { current: 1 }
  const steps = workout.structure
    ? buildStructuredSteps(workout.structure, targets, order)
    : workout.steps.map((step) => buildExecutableStep(step, targets, nextOrder(order)))
  const marker = `SweatRelay ID: ${workout.externalId}`

  return {
    localId: workout.id,
    externalId: workout.externalId,
    date: workout.date,
    name: workout.name,
    workout: {
      workoutName: sanitizeWorkoutName(workout.name),
      sportType: CYCLING_SPORT_TYPE,
      estimatedDurationInSecs: Math.max(1, Math.trunc(workout.durationSeconds)),
      description: [workout.description?.trim(), buildWorkoutDescription(workout), marker]
        .filter(Boolean)
        .join('\n\n'),
      workoutSegments: [
        {
          segmentOrder: 1,
          sportType: CYCLING_SPORT_TYPE,
          workoutSteps: steps,
        },
      ],
      author: {},
    },
  }
}

export function workoutNeedsGarminFtp(workout: PlannedWorkout): boolean {
  return workout.steps.some((step) => step.targetType === WorkoutTargetTypes.Ftp)
}

export function workoutNeedsGarminMaxHeartRate(workout: PlannedWorkout): boolean {
  return workout.steps.some((step) => step.targetType === WorkoutTargetTypes.HeartRateMax)
}

function buildStructuredSteps(
  structure: readonly WorkoutStructureItem[],
  targets: GarminWorkoutTargetContext,
  order: { current: number },
): GarminWorkoutStep[] {
  return structure.map((item) => {
    if (item.type === WorkoutStructureItemTypes.Step) {
      return buildExecutableStep(item.step, targets, nextOrder(order))
    }
    return {
      type: 'RepeatGroupDTO',
      stepOrder: nextOrder(order),
      stepType: stepTypeFor(WorkoutStepKinds.Interval, true),
      numberOfIterations: clampRepeat(item.repeat),
      workoutSteps: item.steps.map((step) => buildExecutableStep(step, targets, nextOrder(order))),
      endCondition: REPEAT_END_CONDITION,
      endConditionValue: clampRepeat(item.repeat),
      smartRepeat: false,
    }
  })
}

function buildExecutableStep(
  step: WorkoutStep | WorkoutStepInput,
  targets: GarminWorkoutTargetContext,
  stepOrder: number,
): GarminExecutableStep {
  const target = targetValuesFor(step, targets)
  return {
    type: 'ExecutableStepDTO',
    stepOrder,
    stepType: stepTypeFor(step.kind),
    endCondition: TIME_END_CONDITION,
    endConditionValue: Math.max(1, Math.trunc(step.durationSeconds)),
    targetType: target.type,
    targetValueOne: target.low,
    targetValueTwo: target.high,
  }
}

function targetValuesFor(
  step: WorkoutStep | WorkoutStepInput,
  targets: GarminWorkoutTargetContext,
): { type: GarminTargetType; low: number; high: number } {
  const targetType = step.targetType ?? WorkoutTargetTypes.Ftp
  const lowPercent = clampPercent(step.targetLow)
  const highPercent = clampPercent(step.targetHigh ?? step.targetLow)
  const [low, high] =
    lowPercent <= highPercent ? [lowPercent, highPercent] : [highPercent, lowPercent]

  if (targetType === WorkoutTargetTypes.HeartRateMax) {
    const maxHeartRate = positiveNumber(targets.maxHeartRate)
    if (!maxHeartRate) {
      throw new Error('Garmin 没有可用的最大心率，无法同步最大心率百分比训练')
    }
    return {
      type: HEART_RATE_TARGET,
      low: Math.max(1, Math.round((maxHeartRate * low) / 100)),
      high: Math.max(1, Math.round((maxHeartRate * high) / 100)),
    }
  }

  const ftpWatts = positiveNumber(targets.ftpWatts)
  if (!ftpWatts) {
    throw new Error('Garmin 没有可用的骑行 FTP，无法同步 FTP 百分比训练')
  }
  return {
    type: POWER_TARGET,
    low: Math.max(1, Math.round((ftpWatts * low) / 100)),
    high: Math.max(1, Math.round((ftpWatts * high) / 100)),
  }
}

function stepTypeFor(kind: WorkoutStep['kind'], repeat = false): GarminStepType {
  if (repeat) return { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 }
  if (kind === WorkoutStepKinds.Warmup) {
    return { stepTypeId: 1, stepTypeKey: 'warmup', displayOrder: 1 }
  }
  if (kind === WorkoutStepKinds.Cooldown) {
    return { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 }
  }
  if (kind === WorkoutStepKinds.Recovery) {
    return { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 }
  }
  return { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 }
}

function nextOrder(order: { current: number }): number {
  const next = order.current
  order.current += 1
  return next
}

function clampRepeat(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(Math.trunc(value), 99))
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.round(value), 250))
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function sanitizeWorkoutName(name: string): string {
  const clean = name.replace(/[\r\n]/g, ' ').trim() || 'SweatRelay Workout'
  return clean.slice(0, 80)
}
