import type { SyncOutcome } from '@sweatrelay/core'
import { contextBridge, ipcRenderer } from 'electron'
import {
  type ConfigurePayload,
  type DeletePlannedWorkoutPayload,
  type IntervalsAuthPayload,
  IPC_CHANNELS,
  type IpcResult,
  type OnelapAuthPayload,
  type SetSchedulePayload,
  type SetThemePayload,
  type SetTrainingStatusPayload,
  type SetWatchDirPayload,
  type SweatRelayApi,
  type SyncTrainingPlanPayload,
  type TrainingLoadPayload,
  type TrainingPlanPayload,
  type UnlockPayload,
  type UpdateTrainingPlanPayload,
  type UpsertPlannedWorkoutPayload,
} from '../shared/ipc.ts'

const api: SweatRelayApi = {
  platform: process.platform,
  status: () => ipcRenderer.invoke(IPC_CHANNELS.status) as Promise<IpcResult<never>>,
  configure: (payload: ConfigurePayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.configure, payload) as Promise<IpcResult<never>>,
  unlock: (payload: UnlockPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.unlock, payload) as Promise<IpcResult<never>>,
  authStrava: () => ipcRenderer.invoke(IPC_CHANNELS.authStrava) as Promise<IpcResult<never>>,
  authOnelap: (payload: OnelapAuthPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.authOnelap, payload) as Promise<IpcResult<never>>,
  authIntervals: (payload: IntervalsAuthPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.authIntervals, payload) as Promise<IpcResult<never>>,
  trainingLoad: (payload?: TrainingLoadPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.trainingLoad, payload) as Promise<IpcResult<never>>,
  setTrainingStatus: (payload: SetTrainingStatusPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.setTrainingStatus, payload) as Promise<IpcResult<never>>,
  trainingPlan: (payload?: TrainingPlanPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.trainingPlan, payload) as Promise<IpcResult<never>>,
  updateTrainingPlan: (payload: UpdateTrainingPlanPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateTrainingPlan, payload) as Promise<IpcResult<never>>,
  upsertPlannedWorkout: (payload: UpsertPlannedWorkoutPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.upsertPlannedWorkout, payload) as Promise<IpcResult<never>>,
  deletePlannedWorkout: (payload: DeletePlannedWorkoutPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.deletePlannedWorkout, payload) as Promise<IpcResult<never>>,
  syncTrainingPlan: (payload: SyncTrainingPlanPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.syncTrainingPlan, payload) as Promise<IpcResult<never>>,
  setWatchDir: (payload: SetWatchDirPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.setWatchDir, payload) as Promise<IpcResult<never>>,
  setSchedule: (payload: SetSchedulePayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.setSchedule, payload) as Promise<IpcResult<never>>,
  setTheme: (payload: SetThemePayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.setTheme, payload) as Promise<IpcResult<never>>,
  syncOnelap: () => ipcRenderer.invoke(IPC_CHANNELS.syncOnelap) as Promise<IpcResult<never>>,
  pickDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.pickDirectory) as Promise<IpcResult<string | null>>,
  onSyncEvent: (handler: (outcome: SyncOutcome) => void) => {
    const wrapper = (_evt: unknown, outcome: SyncOutcome) => handler(outcome)
    ipcRenderer.on(IPC_CHANNELS.syncEvent, wrapper)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.syncEvent, wrapper)
    }
  },
}

contextBridge.exposeInMainWorld('sweatrelay', api)
