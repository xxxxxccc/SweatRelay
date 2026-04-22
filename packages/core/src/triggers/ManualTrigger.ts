import type { Trigger, TriggerHandler } from './Trigger.ts'

export class ManualTrigger implements Trigger {
  private handler: TriggerHandler | null = null

  async start(handler: TriggerHandler): Promise<void> {
    this.handler = handler
  }

  async stop(): Promise<void> {
    this.handler = null
  }

  async fire(): Promise<void> {
    if (!this.handler) throw new Error('ManualTrigger not started')
    await this.handler({ kind: 'manual' })
  }
}
