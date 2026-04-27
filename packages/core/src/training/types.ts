export const WorkoutSports = {
  Ride: 'Ride',
} as const
export type WorkoutSport = (typeof WorkoutSports)[keyof typeof WorkoutSports]

export const WorkoutStepKinds = {
  Warmup: 'warmup',
  Steady: 'steady',
  Interval: 'interval',
  Recovery: 'recovery',
  Cooldown: 'cooldown',
} as const
export type WorkoutStepKind = (typeof WorkoutStepKinds)[keyof typeof WorkoutStepKinds]

export const WorkoutTargetTypes = {
  Ftp: 'ftp',
  HeartRateMax: 'hrmax',
} as const
export type WorkoutTargetType = (typeof WorkoutTargetTypes)[keyof typeof WorkoutTargetTypes]

export const WorkoutSyncStates = {
  Draft: 'draft',
  Dirty: 'dirty',
  Synced: 'synced',
  Failed: 'failed',
} as const
export type WorkoutSyncState = (typeof WorkoutSyncStates)[keyof typeof WorkoutSyncStates]

export interface WorkoutStep {
  id: string
  workoutId: string
  position: number
  kind: WorkoutStepKind
  durationSeconds: number
  targetType: WorkoutTargetType
  targetLow: number
  targetHigh: number
  note?: string
}

export interface WorkoutStepInput {
  id?: string
  kind: WorkoutStepKind
  durationSeconds: number
  targetType?: WorkoutTargetType
  targetLow: number
  targetHigh?: number
  note?: string
}

export const WorkoutStructureItemTypes = {
  Step: 'step',
  Repeat: 'repeat',
} as const
export type WorkoutStructureItemType =
  (typeof WorkoutStructureItemTypes)[keyof typeof WorkoutStructureItemTypes]

export interface WorkoutStructureStep {
  type: typeof WorkoutStructureItemTypes.Step
  step: WorkoutStepInput
}

export interface WorkoutStructureRepeat {
  id?: string
  type: typeof WorkoutStructureItemTypes.Repeat
  repeat: number
  steps: WorkoutStepInput[]
}

export type WorkoutStructureItem = WorkoutStructureStep | WorkoutStructureRepeat

export interface WorkoutStats {
  durationSeconds: number
  intensityFactor: number
  trainingLoad: number
}

export interface TrainingPlan {
  id: string
  name: string
  description?: string
  startDate: string
  weeks: number
  createdAt: string
  updatedAt: string
}

export interface PlannedWorkout extends WorkoutStats {
  id: string
  planId: string
  date: string
  name: string
  sport: WorkoutSport
  description?: string
  steps: WorkoutStep[]
  structure?: WorkoutStructureItem[]
  externalId: string
  syncState: WorkoutSyncState
  intervalsEventId?: number
  syncedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTrainingPlanInput {
  name: string
  description?: string
  startDate?: string
  weeks?: number
}

export interface UpdateTrainingPlanInput {
  id: string
  name?: string
  description?: string
  startDate?: string
  weeks?: number
}

export interface UpsertPlannedWorkoutInput {
  id?: string
  planId: string
  date: string
  name: string
  sport?: WorkoutSport
  description?: string
  steps: WorkoutStepInput[]
  structure?: WorkoutStructureItem[]
}

export interface TrainingPlanTotals extends WorkoutStats {
  workouts: number
}

export interface TrainingPlanDay {
  date: string
  weekday: number
  workouts: PlannedWorkout[]
  totals: TrainingPlanTotals
  projection?: TrainingLoadProjectionPoint
}

export interface TrainingPlanWeek {
  index: number
  startDate: string
  endDate: string
  days: TrainingPlanDay[]
  totals: TrainingPlanTotals
}

export interface TrainingLoadProjectionPoint {
  date: string
  load: number
  ctl: number
  atl: number
  tsb: number
}

export interface TrainingLoadProjection {
  startDate: string
  endDate: string
  points: TrainingLoadProjectionPoint[]
  minTsb?: number
  minTsbDate?: string
  maxAtl?: number
  totalLoad: number
}

export interface TrainingPlanOverview {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  workouts: PlannedWorkout[]
  totals: TrainingPlanTotals
  projection?: TrainingLoadProjection
}

export interface TrainingProjectionSeed {
  ctl: number
  atl: number
  date: string
}

export interface IntervalsPlannedWorkoutEvent {
  category: 'WORKOUT'
  start_date_local: string
  type: WorkoutSport
  name: string
  description: string
  moving_time: number
  target: 'POWER' | 'HR'
  icu_training_load: number
  external_id: string
}

export interface TrainingPlanSyncResult {
  planId: string
  attempted: number
  upserted: number
  syncedAt: string
}
