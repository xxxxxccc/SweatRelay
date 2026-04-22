/**
 * Subtle ambient elevation profile drawn behind the dashboard hero. SVG so
 * it scales crisp on retina; opacity stays low so it never competes with
 * foreground numbers.
 */
export function ElevationBackdrop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="elev-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,140 L20,128 L48,112 L82,96 L120,108 L156,72 L192,84 L228,52 L262,40 L298,68 L332,56 L368,88 L402,74 L444,108 L480,96 L520,116 L560,104 L600,124 L600,160 L0,160 Z"
        fill="url(#elev-fill)"
      />
      <path
        d="M0,140 L20,128 L48,112 L82,96 L120,108 L156,72 L192,84 L228,52 L262,40 L298,68 L332,56 L368,88 L402,74 L444,108 L480,96 L520,116 L560,104 L600,124"
        fill="none"
        stroke="var(--color-accent)"
        strokeOpacity="0.35"
        strokeWidth="1.25"
      />
    </svg>
  )
}
