// Full-page Track Map.
// Circuit outline = baseline lap GPS path. Driver dots use each driver's OWN
// GPS x/y streamed in the frames (true positions, not a shared-line lookup).
// Clicking a dot focuses that driver's nearest anomaly event; clicking an
// anomaly marker opens its diagnosis in the sidebar.
import { useMemo, useState } from 'react';

const PAD = 30;

export default function TrackMapView({ track, driverMeta, driverPositions,
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
    const sy = (y) => PAD + (maxY - y) * scale;   // flip SVG y
    const d = xs.map((x, i) =>
      `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');
    const lookupByDist = (dist) => {
      const a = track.distance;
      let lo = 0, hi = a.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] < dist) lo = mid + 1; else hi = mid;
      }
      return { x: sx(xs[lo]), y: sy(ys[lo]) };
    };
    return { d, sx, sy, lookupByDist,
             height: PAD * 2 + h * scale };
  }, [track]);

  if (!geom) {
    return (
      <div className="empty">
        <p>The track map appears once a replay is loaded.</p>
        <p className="hint">The circuit outline is built from the baseline
        lap's GPS data. Live mode has no track outline.</p>
      </div>
    );
  }

  // clicking a driver dot -> focus that driver's nearest event
  const focusNearest = (drv) => {
    const pos = driverPositions[drv];
    if (!pos) return;
    const mine = events.filter((e) => e.driver === drv);
    if (!mine.length) return;
    const nearest = mine.reduce((best, e) =>
      Math.abs(e.start_distance - pos.distance)
        < Math.abs(best.start_distance - pos.distance) ? e : best);
    onEventClick(nearest);
  };

  return (
    <div className="trackmap-view">
      <svg viewBox={`0 0 1000 ${Math.max(400, geom.height)}`}
           className="trackmap-svg">
        <path d={geom.d} className="track-outline-glow" />
        <path d={geom.d} className="track-outline" />

        {events.map((ev, i) => {
          const p = geom.lookupByDist(ev.start_distance);
          const c = driverMeta[ev.driver]?.color || '#ff4444';
          return (
            <g key={i} transform={`translate(${p.x},${p.y})`}
               className="anomaly-marker"
               onClick={() => onEventClick(ev)}
               onMouseEnter={() => setHover(ev)}
               onMouseLeave={() => setHover(null)}>
              <circle r="11" fill={c} opacity="0.22" />
              <circle r="5" fill={c} stroke="#0b0c0f" strokeWidth="1.5" />
            </g>
          );
        })}

        {Object.entries(driverPositions).map(([drv, pos]) => {
          // true GPS position when frames carry x/y; fall back to the
          // baseline path at the driver's distance otherwise
          const p = (pos.x != null && pos.y != null)
            ? { x: geom.sx(pos.x), y: geom.sy(pos.y) }
            : geom.lookupByDist(pos.distance ?? 0);
          const c = driverMeta[drv]?.color || '#fff';
          return (
            <g key={drv} transform={`translate(${p.x},${p.y})`}
               className="driver-dot" onClick={() => focusNearest(drv)}>
              <circle r="9" fill={c} stroke="#0b0c0f" strokeWidth="2" />
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
