import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite'
import { dynamicRequire } from '../util/dynamicRequire.ts'
import {
  buildPlanOverview,
  calculateWorkoutStats,
  defaultPlanStartDate,
  defaultWorkoutName,
  defaultWorkoutSteps,
  flattenWorkoutStructure,
  normalizeWorkoutSteps,
} from './calculations.ts'
import {
  type CreateTrainingPlanInput,
  type PlannedWorkout,
  type TrainingPlan,
  type TrainingPlanOverview,
  type TrainingPlanSyncResult,
  type TrainingProjectionSeed,
  type UpdateTrainingPlanInput,
  type UpsertPlannedWorkoutInput,
  WorkoutSports,
  type WorkoutStep,
  type WorkoutStructureItem,
  WorkoutSyncStates,
  WorkoutTargetTypes,
} from './types.ts'

const { DatabaseSync } = dynamicRequire()('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncT
}

export interface TrainingPlanStoreOptions {
  path: string
}

export class TrainingPlanStore {
  private readonly opts: TrainingPlanStoreOptions
  private db: DatabaseSyncT | null = null
  private initPromise: Promise<void> | null = null

  constructor(opts: TrainingPlanStoreOptions) {
    this.opts = opts
  }

  async getOverview(planId?: string, seed?: TrainingProjectionSeed): Promise<TrainingPlanOverview> {
    const plan = planId ? await this.getPlan(planId) : await this.ensureDefaultPlan()
    if (!plan) throw new Error('Training plan not found')
    const workouts = await this.listWorkouts(plan.id)
    return buildPlanOverview(plan, workouts, seed)
  }

  async listPlans(): Promise<TrainingPlan[]> {
    const db = await this.getDb()
    const rows = db
      .prepare('SELECT * FROM training_plans ORDER BY updated_at DESC')
      .all() as unknown as PlanRow[]
    return rows.map(rowToPlan)
  }

  async createPlan(input: CreateTrainingPlanInput): Promise<TrainingPlan> {
    const db = await this.getDb()
    const now = new Date().toISOString()
    const plan: TrainingPlan = {
      id: randomUUID(),
      name: input.name.trim() || '我的训练计划',
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      startDate: input.startDate ?? defaultPlanStartDate(),
      weeks: clampWeeks(input.weeks ?? 8),
      createdAt: now,
      updatedAt: now,
    }
    db.prepare(
      `INSERT INTO training_plans (id, name, description, start_date, weeks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      plan.id,
      plan.name,
      plan.description ?? null,
      plan.startDate,
      plan.weeks,
      plan.createdAt,
      plan.updatedAt,
    )
    return plan
  }

  async updatePlan(input: UpdateTrainingPlanInput): Promise<TrainingPlan> {
    const current = await this.getPlan(input.id)
    if (!current) throw new Error('Training plan not found')
    const db = await this.getDb()
    const next: TrainingPlan = {
      ...current,
      ...(input.name !== undefined ? { name: input.name.trim() || current.name } : {}),
      ...(input.description !== undefined
        ? input.description.trim()
          ? { description: input.description.trim() }
          : { description: undefined }
        : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.weeks !== undefined ? { weeks: clampWeeks(input.weeks) } : {}),
      updatedAt: new Date().toISOString(),
    }
    db.prepare(
      `UPDATE training_plans
       SET name = ?, description = ?, start_date = ?, weeks = ?, updated_at = ?
       WHERE id = ?`,
    ).run(next.name, next.description ?? null, next.startDate, next.weeks, next.updatedAt, next.id)
    return next
  }

  async upsertWorkout(input: UpsertPlannedWorkoutInput): Promise<PlannedWorkout> {
    const plan = await this.getPlan(input.planId)
    if (!plan) throw new Error('Training plan not found')
    const db = await this.getDb()
    const now = new Date().toISOString()
    const existing = input.id ? await this.getWorkout(input.id) : null
    const id = existing?.id ?? input.id ?? randomUUID()
    const sourceSteps = input.structure
      ? flattenWorkoutStructure(input.structure)
      : input.steps.length > 0
        ? input.steps
        : defaultWorkoutSteps()
    const steps = normalizeWorkoutSteps(
      id,
      sourceSteps.length > 0 ? sourceSteps : defaultWorkoutSteps(),
    )
    const stats = calculateWorkoutStats(steps)
    const structure = input.structure ?? existing?.structure
    const workout: PlannedWorkout = {
      id,
      planId: input.planId,
      date: input.date,
      name: input.name.trim() || defaultWorkoutName(input.date),
      sport: input.sport ?? WorkoutSports.Ride,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...stats,
      steps,
      ...(structure ? { structure } : {}),
      externalId: existing?.externalId ?? `sweatrelay:workout:${id}`,
      syncState: existing?.syncedAt ? WorkoutSyncStates.Dirty : WorkoutSyncStates.Draft,
      ...(existing?.intervalsEventId !== undefined
        ? { intervalsEventId: existing.intervalsEventId }
        : {}),
      ...(existing?.syncedAt ? { syncedAt: existing.syncedAt } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    db.prepare(
      `INSERT INTO planned_workouts (
         id, plan_id, date, name, sport, description, duration_seconds,
         intensity_factor, training_load, external_id, sync_state,
         intervals_event_id, synced_at, created_at, updated_at, structure_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         plan_id = excluded.plan_id,
         date = excluded.date,
         name = excluded.name,
         sport = excluded.sport,
         description = excluded.description,
         duration_seconds = excluded.duration_seconds,
         intensity_factor = excluded.intensity_factor,
         training_load = excluded.training_load,
         external_id = excluded.external_id,
         sync_state = excluded.sync_state,
         intervals_event_id = excluded.intervals_event_id,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at,
         structure_json = excluded.structure_json`,
    ).run(
      workout.id,
      workout.planId,
      workout.date,
      workout.name,
      workout.sport,
      workout.description ?? null,
      workout.durationSeconds,
      workout.intensityFactor,
      workout.trainingLoad,
      workout.externalId,
      workout.syncState,
      workout.intervalsEventId ?? null,
      workout.syncedAt ?? null,
      workout.createdAt,
      workout.updatedAt,
      workout.structure ? JSON.stringify(workout.structure) : null,
    )

    db.prepare('DELETE FROM workout_steps WHERE workout_id = ?').run(workout.id)
    const insertStep = db.prepare(
      `INSERT INTO workout_steps (
         id, workout_id, position, kind, duration_seconds, target_type,
         target_low, target_high, cadence, note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const step of workout.steps) {
      insertStep.run(
        step.id,
        step.workoutId,
        step.position,
        step.kind,
        step.durationSeconds,
        step.targetType,
        step.targetLow,
        step.targetHigh,
        null,
        step.note ?? null,
      )
    }

    await this.touchPlan(input.planId)
    return workout
  }

  async deleteWorkout(id: string): Promise<void> {
    const workout = await this.getWorkout(id)
    if (!workout) return
    const db = await this.getDb()
    db.prepare('DELETE FROM planned_workouts WHERE id = ?').run(id)
    await this.touchPlan(workout.planId)
  }

  async markSynced(
    planId: string,
    events: Array<{ external_id?: string; id?: number }>,
  ): Promise<TrainingPlanSyncResult> {
    const db = await this.getDb()
    const syncedAt = new Date().toISOString()
    const update = db.prepare(
      `UPDATE planned_workouts
       SET sync_state = ?, intervals_event_id = COALESCE(?, intervals_event_id), synced_at = ?, updated_at = ?
       WHERE plan_id = ? AND external_id = ?`,
    )
    let upserted = 0
    for (const event of events) {
      if (!event.external_id) continue
      const result = update.run(
        WorkoutSyncStates.Synced,
        event.id ?? null,
        syncedAt,
        syncedAt,
        planId,
        event.external_id,
      )
      if (result.changes > 0) upserted += 1
    }
    await this.touchPlan(planId)
    return { planId, attempted: events.length, upserted, syncedAt }
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
    this.initPromise = null
  }

  private async ensureDefaultPlan(): Promise<TrainingPlan> {
    const plans = await this.listPlans()
    if (plans[0]) return plans[0]
    return this.createPlan({
      name: '我的训练计划',
      description: '在 SweatRelay 编排未来训练，并同步到 Intervals.icu。',
      weeks: 8,
    })
  }

  private async getPlan(id: string): Promise<TrainingPlan | null> {
    const db = await this.getDb()
    const row = db
      .prepare('SELECT * FROM training_plans WHERE id = ? LIMIT 1')
      .get(id) as unknown as PlanRow | undefined
    return row ? rowToPlan(row) : null
  }

  private async getWorkout(id: string): Promise<PlannedWorkout | null> {
    const db = await this.getDb()
    const row = db
      .prepare('SELECT * FROM planned_workouts WHERE id = ? LIMIT 1')
      .get(id) as unknown as WorkoutRow | undefined
    if (!row) return null
    const steps = await this.listSteps(id)
    return rowToWorkout(row, steps)
  }

  private async listWorkouts(planId: string): Promise<PlannedWorkout[]> {
    const db = await this.getDb()
    const rows = db
      .prepare('SELECT * FROM planned_workouts WHERE plan_id = ? ORDER BY date ASC, created_at ASC')
      .all(planId) as unknown as WorkoutRow[]
    const steps = await this.listStepsForPlan(planId)
    return rows.map((row) => rowToWorkout(row, steps.get(row.id) ?? []))
  }

  private async listSteps(workoutId: string): Promise<WorkoutStep[]> {
    const db = await this.getDb()
    const rows = db
      .prepare('SELECT * FROM workout_steps WHERE workout_id = ? ORDER BY position ASC')
      .all(workoutId) as unknown as StepRow[]
    return rows.map(rowToStep)
  }

  private async listStepsForPlan(planId: string): Promise<Map<string, WorkoutStep[]>> {
    const db = await this.getDb()
    const rows = db
      .prepare(
        `SELECT s.*
         FROM workout_steps s
         JOIN planned_workouts w ON w.id = s.workout_id
         WHERE w.plan_id = ?
         ORDER BY s.workout_id ASC, s.position ASC`,
      )
      .all(planId) as unknown as StepRow[]
    const map = new Map<string, WorkoutStep[]>()
    for (const row of rows) {
      const step = rowToStep(row)
      const list = map.get(step.workoutId) ?? []
      list.push(step)
      map.set(step.workoutId, list)
    }
    return map
  }

  private async touchPlan(planId: string): Promise<void> {
    const db = await this.getDb()
    db.prepare('UPDATE training_plans SET updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      planId,
    )
  }

  private async getDb(): Promise<DatabaseSyncT> {
    if (!this.initPromise) this.initPromise = this.init()
    await this.initPromise
    if (!this.db) throw new Error('TrainingPlanStore database not initialized')
    return this.db
  }

  private async init(): Promise<void> {
    await mkdir(dirname(this.opts.path), { recursive: true })
    this.db = new DatabaseSync(this.opts.path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS training_plans (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        start_date  TEXT NOT NULL,
        weeks       INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS planned_workouts (
        id                TEXT PRIMARY KEY,
        plan_id           TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        date              TEXT NOT NULL,
        name              TEXT NOT NULL,
        sport             TEXT NOT NULL,
        description       TEXT,
        duration_seconds  INTEGER NOT NULL,
        intensity_factor  REAL NOT NULL,
        training_load     REAL NOT NULL,
        external_id       TEXT NOT NULL UNIQUE,
        sync_state        TEXT NOT NULL,
        intervals_event_id INTEGER,
        synced_at         TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        structure_json    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_planned_workouts_plan_date
        ON planned_workouts (plan_id, date);
      CREATE TABLE IF NOT EXISTS workout_steps (
        id                TEXT PRIMARY KEY,
        workout_id        TEXT NOT NULL REFERENCES planned_workouts(id) ON DELETE CASCADE,
        position          INTEGER NOT NULL,
        kind              TEXT NOT NULL,
        duration_seconds  INTEGER NOT NULL,
        target_type       TEXT NOT NULL,
        target_low        REAL NOT NULL,
        target_high       REAL NOT NULL,
        cadence           INTEGER,
        note              TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_workout_steps_workout_position
        ON workout_steps (workout_id, position);
    `)
    await this.migrateSchema()
  }

  private async migrateSchema(): Promise<void> {
    if (!this.db) throw new Error('TrainingPlanStore database not initialized')
    const columns = this.db
      .prepare('PRAGMA table_info(planned_workouts)')
      .all() as unknown as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'structure_json')) {
      this.db.exec('ALTER TABLE planned_workouts ADD COLUMN structure_json TEXT')
    }
  }
}

interface PlanRow {
  id: string
  name: string
  description: string | null
  start_date: string
  weeks: number
  created_at: string
  updated_at: string
}

interface WorkoutRow {
  id: string
  plan_id: string
  date: string
  name: string
  sport: string
  description: string | null
  duration_seconds: number
  intensity_factor: number
  training_load: number
  external_id: string
  sync_state: string
  intervals_event_id: number | null
  synced_at: string | null
  created_at: string
  updated_at: string
  structure_json: string | null
}

interface StepRow {
  id: string
  workout_id: string
  position: number
  kind: WorkoutStep['kind']
  duration_seconds: number
  target_type: WorkoutStep['targetType']
  target_low: number
  target_high: number
  cadence: number | null
  note: string | null
}

function rowToPlan(row: PlanRow): TrainingPlan {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    startDate: row.start_date,
    weeks: row.weeks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToWorkout(row: WorkoutRow, steps: WorkoutStep[]): PlannedWorkout {
  const structure = parseStructure(row.structure_json)
  return {
    id: row.id,
    planId: row.plan_id,
    date: row.date,
    name: row.name,
    sport: row.sport === WorkoutSports.Ride ? WorkoutSports.Ride : WorkoutSports.Ride,
    ...(row.description ? { description: row.description } : {}),
    durationSeconds: row.duration_seconds,
    intensityFactor: row.intensity_factor,
    trainingLoad: row.training_load,
    steps,
    ...(structure ? { structure } : {}),
    externalId: row.external_id,
    syncState: toSyncState(row.sync_state),
    ...(row.intervals_event_id !== null ? { intervalsEventId: row.intervals_event_id } : {}),
    ...(row.synced_at ? { syncedAt: row.synced_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseStructure(value: string | null): WorkoutStructureItem[] | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as WorkoutStructureItem[]) : null
  } catch {
    return null
  }
}

function rowToStep(row: StepRow): WorkoutStep {
  return {
    id: row.id,
    workoutId: row.workout_id,
    position: row.position,
    kind: row.kind,
    durationSeconds: row.duration_seconds,
    targetType:
      row.target_type === WorkoutTargetTypes.HeartRateMax
        ? WorkoutTargetTypes.HeartRateMax
        : WorkoutTargetTypes.Ftp,
    targetLow: row.target_low,
    targetHigh: row.target_high,
    ...(row.note ? { note: row.note } : {}),
  }
}

function toSyncState(value: string): PlannedWorkout['syncState'] {
  if (value === WorkoutSyncStates.Dirty) return WorkoutSyncStates.Dirty
  if (value === WorkoutSyncStates.Synced) return WorkoutSyncStates.Synced
  if (value === WorkoutSyncStates.Failed) return WorkoutSyncStates.Failed
  return WorkoutSyncStates.Draft
}

function clampWeeks(value: number): number {
  if (!Number.isFinite(value)) return 8
  return Math.max(1, Math.min(Math.trunc(value), 24))
}
