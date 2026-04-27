import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildIntervalsWorkoutEvent,
  buildWorkoutDescription,
  defaultWorkoutSteps,
  TrainingPlanStore,
  WorkoutStepKinds,
  WorkoutStructureItemTypes,
  WorkoutTargetTypes,
} from '../src/training/index.ts'

describe('TrainingPlanStore', () => {
  let dir: string
  let store: TrainingPlanStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sweatrelay-training-plans-'))
    store = new TrainingPlanStore({ path: join(dir, 'plans.sqlite') })
  })

  afterEach(async () => {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a default plan and stores planned workouts with computed load', async () => {
    const overview = await store.getOverview()
    expect(overview.plan.name).toBe('我的训练计划')
    expect(overview.weeks).toHaveLength(8)

    const workout = await store.upsertWorkout({
      planId: overview.plan.id,
      date: overview.plan.startDate,
      name: 'FTP 3x10',
      steps: defaultWorkoutSteps(),
    })

    expect(workout.durationSeconds).toBe(3000)
    expect(workout.trainingLoad).toBeGreaterThan(30)
    expect(workout.externalId).toBe(`sweatrelay:workout:${workout.id}`)

    const next = await store.getOverview(overview.plan.id, {
      date: overview.plan.startDate,
      ctl: 50,
      atl: 52,
    })
    expect(next.workouts).toHaveLength(1)
    expect(next.weeks[0]?.totals.workouts).toBe(1)
    expect(next.projection?.points[0]).toMatchObject({
      date: overview.plan.startDate,
      load: workout.trainingLoad,
    })
  })

  it('marks workouts as synced from Intervals.icu responses', async () => {
    const overview = await store.getOverview()
    const workout = await store.upsertWorkout({
      planId: overview.plan.id,
      date: overview.plan.startDate,
      name: 'Tempo',
      steps: [
        {
          kind: WorkoutStepKinds.Steady,
          durationSeconds: 1800,
          targetLow: 80,
        },
      ],
    })

    const result = await store.markSynced(overview.plan.id, [
      { external_id: workout.externalId, id: 12345 },
    ])
    const next = await store.getOverview(overview.plan.id)

    expect(result.upserted).toBe(1)
    expect(next.workouts[0]).toMatchObject({
      syncState: 'synced',
      intervalsEventId: 12345,
    })
  })

  it('preserves repeat groups while calculating from expanded steps', async () => {
    const overview = await store.getOverview()
    const workout = await store.upsertWorkout({
      planId: overview.plan.id,
      date: overview.plan.startDate,
      name: 'VO2 repeats',
      steps: [],
      structure: [
        {
          type: WorkoutStructureItemTypes.Repeat,
          repeat: 10,
          steps: [
            {
              kind: WorkoutStepKinds.Interval,
              durationSeconds: 120,
              targetLow: 110,
            },
            {
              kind: WorkoutStepKinds.Recovery,
              durationSeconds: 120,
              targetLow: 60,
            },
          ],
        },
      ],
    })

    const next = await store.getOverview(overview.plan.id)

    const savedWorkout = next.workouts.at(0)

    expect(workout.steps).toHaveLength(20)
    expect(savedWorkout?.structure?.[0]).toMatchObject({
      type: 'repeat',
      repeat: 10,
    })
    expect(savedWorkout).toBeDefined()
    if (!savedWorkout) {
      throw new Error('Expected saved workout')
    }
    expect(buildWorkoutDescription(savedWorkout)).toBe(`10x
- Interval 2m 110%
- Recovery 2m 60%`)
    expect(workout.durationSeconds).toBe(2400)
  })

  it('maps heart-rate targets to Intervals.icu workout text', async () => {
    const overview = await store.getOverview()
    const workout = await store.upsertWorkout({
      planId: overview.plan.id,
      date: overview.plan.startDate,
      name: 'HR endurance',
      description: 'Local note should not enter Intervals workout syntax',
      steps: [
        {
          kind: WorkoutStepKinds.Steady,
          durationSeconds: 1800,
          targetType: WorkoutTargetTypes.HeartRateMax,
          targetLow: 70,
        },
      ],
    })

    expect(buildWorkoutDescription(workout)).toBe('- Steady 30m 70% HR')
    expect(buildIntervalsWorkoutEvent(workout)).toMatchObject({
      target: 'HR',
      description: '- Steady 30m 70% HR',
    })
  })
})
