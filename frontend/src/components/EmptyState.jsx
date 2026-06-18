// Shared empty-state + loading-skeleton primitives used across tabs so the
// "nothing here yet" and "preparing…" moments look intentional, not blank.

export function EmptyState({ icon = 'chart', title, hint }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{ICONS[icon] || ICONS.chart}</div>
      {title && <p className="empty-title">{title}</p>}
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

// Shimmer placeholder sized like the chart canvas, shown while a replay is
// preparing (after Start, before the first frames arrive).
export function ChartSkeleton({ rows = 1 }) {
  return (
    <div className="chart-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk-chart">
          <div className="sk-shimmer" />
        </div>
      ))}
      <p className="sk-note">Preparing telemetry…</p>
    </div>
  );
}

// A single shimmer block of arbitrary height (px) and optional border radius.
export function SkeletonBlock({ height = 200, radius = 8, className = '' }) {
  return (
    <div className={`sk-block ${className}`}
         style={{ height: typeof height === 'number' ? `${height}px` : height,
                  borderRadius: radius }}>
      <div className="sk-shimmer" />
    </div>
  );
}

// A grid of shimmer cards (for weather cards, lap cards, etc.).
export function SkeletonGrid({ count = 6, minWidth = 150, height = 80 }) {
  return (
    <div className="sk-grid"
         style={{ gridTemplateColumns:
                    `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk-block" style={{ height: `${height}px` }}>
          <div className="sk-shimmer" />
        </div>
      ))}
    </div>
  );
}

const ICONS = {
  chart: (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
      <path d="M6 40V8M6 40h36" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" />
      <path d="M12 32l8-10 7 6 11-16" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
      <path d="M18 6l12 4 12-4v32l-12 4-12-4-12 4V10l12-4z" stroke="currentColor"
            strokeWidth="2" strokeLinejoin="round" />
      <path d="M18 6v32M30 10v32" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  session: (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
      <rect x="6" y="10" width="36" height="30" rx="3" stroke="currentColor"
            strokeWidth="2" />
      <path d="M6 18h36M16 6v8M32 6v8" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" />
    </svg>
  ),
  weather: (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
      <circle cx="18" cy="18" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M30 38a8 8 0 000-16 10 10 0 00-19 3 7 7 0 00-1 13h20z"
            stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
};
