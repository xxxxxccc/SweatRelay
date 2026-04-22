import { Cron } from 'croner'
import type { Trigger, TriggerHandler } from './Trigger.ts'

export interface ScheduledTriggerOptions {
  /** Standard 5-field cron expression. */
  cron: string
  /** Optional IANA timezone, e.g. 'Asia/Shanghai'. */
  timezone?: string
}

export class ScheduledTrigger implements Trigger {
  private job: Cron | null = null

  private readonly opts: ScheduledTriggerOptions

  constructor(opts: ScheduledTriggerOptions) {
    this.opts = opts
  }

  async start(handler: TriggerHandler): Promise<void> {
    this.job = new Cron(
      this.opts.cron,
      { timezone: this.opts.timezone, protect: true },
      async () => {
        await handler({ kind: 'scheduled', firedAt: new Date() })
      },
    )
  }

  async stop(): Promise<void> {
    this.job?.stop()
    this.job = null
  }
}
