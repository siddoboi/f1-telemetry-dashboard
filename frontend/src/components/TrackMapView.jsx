// Full-page Track Map. The circuit outline is the GPS X/Y path of the
// baseline lap. Driver dots are positioned by looking up each driver's
// current replay distance along that shared path (single-racing-line
// approximation - fine at this scale). Anomaly events become pulsing
// markers at their start distance; clicking one opens its diagnosis.
import { useMemo, useState } from 'react';

const PAD = 30;

export default function TrackMapView({ track, driverMeta, driverDistances,
                                       events, onEventClick }) {
  const [hover, setHover] = useState(null);

  const geom = useMemo(() => {
    if (!track?.x?.length) return null;
    const xs = track.x, ys = track.y;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const scale = (1000 - 2 * PAD) / Math.max(w, h);
    const sx = (x) => PAD + (x - minX) * scale;
    // SVG y grows downward; flip so the map isn't mirrored
    const sy = (y) => PAD + (maxY - y) * scale;
    const d = xs.map((x, i) =>
      `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');
    const lookup = (dist) => {
      // binary search on the monotonic distance array
      const a = track.distance;
      let lo = 0, hi = a.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] < dist) lo = mid + 1; else hi = mid;
      }
      return { x: sx(xs[lo]), y: sy(ys[lo]) };
    };
    const height = PAD * 2 + h * scale;
    return { d, lookup, height };
  }, [track]);

  if (!geom) {
    return (
      <div className="empty">
        <p>The track map appears once a replay is loaded.</p>
        <p className="hint">GPS position data comes from the baseline lap.
        Live mode does not provide a track outline.</p>
      </div>
    );
  }

  return (
    <div className="trackmap-view">
      <svg viewBox={`0 0 1000 ${Math.max(400, geom.height)}`}
           className="trackmap-svg">
        <path d={geom.d} className="track-outline-glow" />
        <path d={geom.d} className="track-outline" />

        {/* anomaly markers */}
        {events.map((ev, i) => {
          const p = geom.lookup(ev.start_distance);
          const c = driverMeta[ev.driver]?.color || '#ff4444';
          return (
            <g key={i} transform={`translate(${p.x},${p.y})`}
               className="anomaly-marker"
               onClick={() => onEventClick(ev)}
               onMouseEnter={() => setHover(ev)}
               onMouseLeave={() => setHover(null)}>
              <circle r="11" fill={c} opacity="0.22" />
              <circle r="5" fill={c} stroke="#101114" strokeWidth="1.5" />
            </g>
          );
        })}

        {/* driver position dots */}
        {Object.entries(driverDistances).map(([drv, dist]) => {
          const p = geom.lookup(dist);
          const c = driverMeta[drv]?.color || '#fff';
          return (
            <g key={drv} transform={`translate(${p.x},${p.y})`}>
              <circle r="9" fill={c} stroke="#101114" strokeWidth="2" />
              <text y="-14" textAnchor="middle" className="dot-label">
                {drv}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div className="track-tooltip">
          <strong>{hover.driver} · {hover.label}</strong>
          <span>{Math.round(hover.start_distance)} m ·
            score {hover.peak_score.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
