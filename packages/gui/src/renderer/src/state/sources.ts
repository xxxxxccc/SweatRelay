import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const SourcePanelIds = {
  strava: 'strava',
  onelap: 'onelap',
  intervals: 'intervals',
  coros: 'coros',
  garmin: 'garmin',
} as const

export type SourcePanelId = (typeof SourcePanelIds)[keyof typeof SourcePanelIds]

export interface SourcePanelOption {
  id: SourcePanelId
  label: string
}

export const sourcePanelOptions: SourcePanelOption[] = [
  { id: SourcePanelIds.strava, label: 'Strava' },
  { id: SourcePanelIds.onelap, label: 'Onelap' },
  { id: SourcePanelIds.intervals, label: 'Intervals.icu' },
  { id: SourcePanelIds.coros, label: 'COROS' },
  { id: SourcePanelIds.garmin, label: 'Garmin' },
]

export type SourcePanelVisibility = Record<SourcePanelId, boolean>

export const defaultSourcePanelVisibility: SourcePanelVisibility = {
  [SourcePanelIds.strava]: true,
  [SourcePanelIds.onelap]: true,
  [SourcePanelIds.intervals]: true,
  [SourcePanelIds.coros]: true,
  [SourcePanelIds.garmin]: true,
}

const storedSourcePanelVisibilityAtom = atomWithStorage<Partial<SourcePanelVisibility>>(
  'sweatrelay.sources.panelVisibility.v1',
  defaultSourcePanelVisibility,
  undefined,
  { getOnInit: true },
)

export const sourcePanelVisibilityAtom = atom(
  (get): SourcePanelVisibility => ({
    ...defaultSourcePanelVisibility,
    ...get(storedSourcePanelVisibilityAtom),
  }),
  (_get, set, next: SourcePanelVisibility) => {
    set(storedSourcePanelVisibilityAtom, next)
  },
)

export const setSourcePanelVisibleAtom = atom(
  null,
  (get, set, panelId: SourcePanelId, visible: boolean) => {
    set(sourcePanelVisibilityAtom, {
      ...get(sourcePanelVisibilityAtom),
      [panelId]: visible,
    })
  },
)

export const resetSourcePanelVisibilityAtom = atom(null, (_get, set) => {
  set(sourcePanelVisibilityAtom, defaultSourcePanelVisibility)
})
