export type TriggerEvent =
  | { kind: 'manual' }
  | { kind: 'scheduled'; firedAt: Date }
  | { kind: 'file'; path: string; format: 'fit' | 'gpx' | 'tcx' }

export type TriggerHandler = (event: TriggerEvent) => Promise<void>

export interface Trigger {
  start(handler: TriggerHandler): Promise<void>
  stop(): Promise<void>
}
