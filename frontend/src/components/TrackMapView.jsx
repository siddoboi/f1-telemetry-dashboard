// Full-page Track Map.
// Circuit outline = baseline lap GPS path. Driver markers use each driver's
// OWN GPS x/y streamed in the frames (true positions). Enhancements:
//  - sector boundary markers (S1/S2/S3) at meta.sector_distances
//  - corner number labels (T01..) at meta.corners apex positions
//  - driver flag badges (team-color stripe + code) instead of plain dots
//  - per-sector timing cards showing each driver's time + delta vs baseline
import { useMemo, useState } from 'react';

const PAD = 36;
const SECTOR_COLORS = { s1: '#ff7a1a', s2: '#ffd21a', s3: '#36d1ff' };

export default function TrackMapView({ track, driverMeta, driverPositions,
                                       events, onEventClick, focusedEvent = null,
                                       corners = [], sectorDistances = null }) {
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
    return { d, sx, sy, lookupByDist, height: PAD * 2 + h * scale };
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

  // sector boundary tick marks (S1 end, S2 end, and start/finish = S3 end)
  const sectorMarks = [];
  if (sectorDistances) {
    if (sectorDistances.s1_end != null)
      sectorMarks.push({ key: 's1', dist: sectorDistances.s1_end, label: 'S1' });
    if (sectorDistances.s2_end != null)
      sectorMarks.push({ key: 's2', dist: sectorDistances.s2_end, label: 'S2' });
    if (track?.distance?.length)
      sectorMarks.push({ key: 's3', dist: 0, label: 'S3' });   // start/finish
  }

  return (
    <div className="trackmap-view">
      <svg viewBox={`0 0 1000 ${Math.max(400, geom.height)}`}
           className="trackmap-svg">
        <path d={geom.d} className="track-outline-glow" />
        <path d={geom.d} className="track-outline" />

        {/* sector boundary ticks */}
        {sectorMarks.map((m) => {
          const p = geom.lookupByDist(m.dist);
          const col = SECTOR_COLORS[m.key];
          return (
            <g key={m.key} transform={`translate(${p.x},${p.y})`}>
              <circle r="6" fill="none" stroke={col} strokeWidth="2.5" />
              <circle r="2" fill={col} />
              <text y="-12" textAnchor="middle" className="sector-tick-label"
                    fill={col}>{m.label}</text>
            </g>
          );
        })}

        {/* corner number labels */}
        {corners.map((c) => {
          const p = geom.lookupByDist(c.distance);
          return (
            <g key={`${c.number}${c.letter}`}
               transform={`translate(${p.x},${p.y})`}>
              <circle r="2" className="corner-dot" />
              <text y="11" textAnchor="middle" className="corner-label">
                T{String(c.number).padStart(2, '0')}{c.letter}
              </text>
            </g>
          );
        })}

        {/* anomaly markers */}
        {events.map((ev, i) => {
          const p = geom.lookupByDist(ev.start_distance);
          const c = driverMeta[ev.driver]?.color || '#ff4444';
          const isFocused = focusedEvent
            && ev.driver === focusedEvent.driver
            && ev.start_distance === focusedEvent.start_distance;
          return (
            <g key={i} transform={`translate(${p.x},${p.y})`}
               className={`anomaly-marker ${isFocused ? 'focused' : ''}`}
               onClick={() => onEventClick(ev)}
               onMouseEnter={() => setHover(ev)}
               onMouseLeave={() => setHover(null)}>
              <circle r={isFocused ? 16 : 11} fill={c}
                      opacity={isFocused ? 0.35 : 0.22} />
              <circle r={isFocused ? 7 : 5} fill={c}
                      stroke="#0b0c0f" strokeWidth="1.5" />
            </g>
          );
        })}

        {/* driver flag badges */}
        {Object.entries(driverPositions).map(([drv, pos]) => {
          const p = (pos.x != null && pos.y != null)
            ? { x: geom.sx(pos.x), y: geom.sy(pos.y) }
            : geom.lookupByDist(pos.distance ?? 0);
          const c = driverMeta[drv]?.color || '#fff';
          return (
            <g key={drv} transform={`translate(${p.x},${p.y})`}
               className="driver-flag" onClick={() => focusNearest(drv)}>
              {/* stripe + badge body, anchored above the true position */}
              <g transform="translate(0,-26)">
                <rect x="-22" y="-9" width="44" height="18" rx="3"
                      className="flag-body" />
                <rect x="-22" y="-9" width="5" height="18" rx="2" fill={c} />
                <text x="3" y="4" textAnchor="middle" className="flag-code"
                      fill="#fff">{drv}</text>
              </g>
              {/* the precise track position */}
              <circle r="4" fill={c} stroke="#0b0c0f" strokeWidth="1.5" />
              <line x1="0" y1="-17" x2="0" y2="-4" stroke={c}
                    strokeWidth="1.5" opacity="0.6" />
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
