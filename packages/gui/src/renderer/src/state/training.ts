import type { TrainingLoadPayload } from '@shared/ipc.ts'
import type { IntervalsTrainingLoadReport, TrainingPlanOverview } from '@sweatrelay/core'
import { atom } from 'jotai'
import { api } from '@/lib/api'

const TRAINING_PLAN_STALE_MS = 30_000
const TRAINING_LOAD_STALE_MS = 90_000

type ResourceState<T> = {
  value: T | null
  fetchedAt: number | null
  loading: boolean
  refreshing: boolean
  error: string | null
}

type RefreshOptions = {
  force?: boolean
  silent?: boolean
}

type TrainingLoadCacheEntry = {
  value: IntervalsTrainingLoadReport
  fetchedAt: number
}

type TrainingLoadState = {
  entries: Record<string, TrainingLoadCacheEntry>
  activeKey: string | null
  loading: boolean
  refreshing: boolean
  error: string | null
}

type RefreshTrainingLoadOptions = RefreshOptions & {
  payload?: TrainingLoadPayload
}

const initialResourceState = <T>(): ResourceState<T> => ({
  value: null,
  fetchedAt: null,
  loading: false,
  refreshing: false,
  error: null,
})

const trainingPlanInFlight = {
  current: null as Promise<TrainingPlanOverview | null> | null,
}

const trainingLoadInFlight = new Map<string, Promise<IntervalsTrainingLoadReport | null>>()

export const trainingPlanResourceAtom = atom<ResourceState<TrainingPlanOverview>>(
  initialResourceState<TrainingPlanOverview>(),
)

export const setTrainingPlanCacheAtom = atom(null, (_get, set, overview: TrainingPlanOverview) => {
  set(trainingPlanResourceAtom, {
    value: overview,
    fetchedAt: Date.now(),
    loading: false,
    refreshing: false,
    error: null,
  })
})

export const refreshTrainingPlanAtom = atom(
  null,
  async (get, set, options: RefreshOptions = {}) => {
    const current = get(trainingPlanResourceAtom)
    const now = Date.now()
    const hasFreshValue =
      current.value !== null &&
      current.fetchedAt !== null &&
      now - current.fetchedAt < TRAINING_PLAN_STALE_MS

    if (!options.force && hasFreshValue) return current.value

    const silent = (options.silent ?? current.value !== null) && current.value !== null
    set(trainingPlanResourceAtom, {
      ...current,
      loading: !silent,
      refreshing: silent,
      error: null,
    })

    if (trainingPlanInFlight.current) return trainingPlanInFlight.current

    const request = (async () => {
      const res = await api.trainingPlan()
      if (!res.ok) {
        const latest = get(trainingPlanResourceAtom)
        set(trainingPlanResourceAtom, {
          ...latest,
          loading: false,
          refreshing: false,
          error: res.error.message,
        })
        return latest.value
      }

      set(trainingPlanResourceAtom, {
        value: res.value,
        fetchedAt: Date.now(),
        loading: false,
        refreshing: false,
        error: null,
      })
      return res.value
    })().finally(() => {
      trainingPlanInFlight.current = null
    })

    trainingPlanInFlight.current = request
    return request
  },
)

const trainingLoadStateAtom = atom<TrainingLoadState>({
  entries: {},
  activeKey: null,
  loading: false,
  refreshing: false,
  error: null,
})

export const trainingLoadResourceAtom = atom((get) => {
  const state = get(trainingLoadStateAtom)
  const entry = state.activeKey ? state.entries[state.activeKey] : undefined
  return {
    value: entry?.value ?? null,
    fetchedAt: entry?.fetchedAt ?? null,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    key: state.activeKey,
  }
})

export const refreshTrainingLoadAtom = atom(
  null,
  async (get, set, options: RefreshTrainingLoadOptions = {}) => {
    const payload = options.payload
    const key = trainingLoadPayloadKey(payload)
    const current = get(trainingLoadStateAtom)
    const entry = current.entries[key]
    const now = Date.now()
    const hasFreshValue = entry !== undefined && now - entry.fetchedAt < TRAINING_LOAD_STALE_MS

    if (!options.force && hasFreshValue) {
      set(trainingLoadStateAtom, {
        ...current,
        activeKey: key,
        loading: false,
        refreshing: false,
        error: null,
      })
      return entry.value
    }

    const silent = (options.silent ?? entry !== undefined) && entry !== undefined
    set(trainingLoadStateAtom, {
      ...current,
      activeKey: key,
      loading: !silent,
      refreshing: silent,
      error: null,
    })

    const existingRequest = trainingLoadInFlight.get(key)
    if (existingRequest) return existingRequest

    const request = (async () => {
      const res = await api.trainingLoad(payload)
      if (!res.ok) {
        const latest = get(trainingLoadStateAtom)
        set(trainingLoadStateAtom, {
          ...latest,
          loading: false,
          refreshing: false,
          error: res.error.message,
        })
        return latest.entries[key]?.value ?? null
      }

      const latest = get(trainingLoadStateAtom)
      set(trainingLoadStateAtom, {
        ...latest,
        entries: {
          ...latest.entries,
          [key]: {
            value: res.value,
            fetchedAt: Date.now(),
          },
        },
        activeKey: key,
        loading: false,
        refreshing: false,
        error: null,
      })
      return res.value
    })().finally(() => {
      trainingLoadInFlight.delete(key)
    })

    trainingLoadInFlight.set(key, request)
    return request
  },
)

function trainingLoadPayloadKey(payload?: TrainingLoadPayload): string {
  return `${payload?.days ?? 'default'}:${payload?.forecastDays ?? 'default'}`
}
