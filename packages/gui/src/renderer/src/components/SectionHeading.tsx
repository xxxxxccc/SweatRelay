/**
 * Editorial section heading with a small numbered prefix and a thin orange
 * underline rule. Used as the page titles inside main content.
 */
export function SectionHeading({
  index,
  title,
  subtitle,
  action,
}: {
  /** "01", "02"... shown as a tiny race-number pill. Optional. */
  index?: string
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6 border-b border-border pb-4">
      <div className="flex items-end gap-4">
        {index ? <span className="font-mono text-xs text-accent">{index}</span> : null}
        <div>
          <h1 className="font-display text-4xl uppercase leading-none tracking-wide text-fg">
            {title}
          </h1>
          {subtitle ? <p className="mt-2 max-w-xl text-sm text-fg-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
