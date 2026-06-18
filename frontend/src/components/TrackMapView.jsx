// Full-page Track Map.
// Circuit outline = baseline lap GPS path. Driver markers use each driver's
// OWN GPS x/y streamed in the frames (true positions). Enhancements:
//  - sector boundaries drawn as a full perpendicular slash across the track
//  - corner number labels (T01..) offset OFF the track (never over it)
//  - driver flag badges offset perpendicular to the racing line, dynamically
//    to the outward side so they don't cover the track or other dots
import { useMemo, useState } from 'react';
import { EmptyState, SkeletonBlock } from './EmptyState';

const PAD = 48;
const SECTOR_COLORS = { s1: '#ff7a1a', s2: '#ffd21a', s3: '#36d1ff' };

export default function TrackMapView({ track, driverMeta, driverPositions,
                                       events, onEventClick, focusedEvent = null,
                                       corners = [], sectorDistances = null,
                                       preparing = false }) {
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
    const cx = sx((minX + maxX) / 2);             // screen centre of circuit
    const cy = sy((minY + maxY) / 2);
    const d = xs.map((x, i) =>
      `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');

    const idxByDist = (dist) => {
      const a = track.distance;
      let lo = 0, hi = a.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] < dist) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    const ptAt = (i) => ({ x: sx(xs[i]), y: sy(ys[i]) });
    const lookupByDist = (dist) => ptAt(idxByDist(dist));

    // unit tangent (direction of travel) at an index, in screen space
    const tangentAt = (i) => {
      const n = xs.length;
      const a = ptAt((i - 2 + n) % n), b = ptAt((i + 2) % n);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { tx: dx / len, ty: dy / len };
    };

    return { d, sx, sy, cx, cy, idxByDist, ptAt, lookupByDist, tangentAt,
             height: PAD * 2 + h * scale };
  }, [track]);

  // skeleton: shown while a replay is preparing (all hooks already ran above)
  if (preparing && !geom) {
    return (
      <div className="trackmap-skeleton">
        <SkeletonBlock height={420} radius={8} />
        <SkeletonBlock height={90} radius={6} className="sk-mt" />
        <p className="sk-note">Preparing track map…</p>
      </div>
    );
  }

  if (!geom) {
    return (
      <EmptyState icon="map"
        title="No track map yet"
        hint="The circuit outline is built from the baseline lap's GPS data once a replay is loaded." />
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

  // outward normal at a point: perpendicular to tangent, pointing away from
  // the circuit centre (so labels/badges sit outside the track)
  const outwardNormal = (i, px, py) => {
    const { tx, ty } = geom.tangentAt(i);
    let nx = -ty, ny = tx;                       // perpendicular
    // flip to point away from centre
    if ((px - geom.cx) * nx + (py - geom.cy) * ny < 0) { nx = -nx; ny = -ny; }
    return { nx, ny };
  };

  // sector boundary slashes (perpendicular line, no label on the slash itself)
  const sectorMarks = [];
  // sector region labels placed at the midpoint of each sector, pushed outward
  const sectorRegions = [];
  if (sectorDistances) {
    const { s1_end, s2_end, total } = sectorDistances;
    if (s1_end != null)
      sectorMarks.push({ key: 's1', dist: s1_end });
    if (s2_end != null)
      sectorMarks.push({ key: 's2', dist: s2_end });
    sectorMarks.push({ key: 's3', dist: 0 });   // start/finish line

    // region label midpoints
    if (s1_end != null)
      sectorRegions.push({ key: 's1', label: 'Sector 1',
                           mid: s1_end / 2 });
    if (s1_end != null && s2_end != null)
      sectorRegions.push({ key: 's2', label: 'Sector 2',
                           mid: (s1_end + s2_end) / 2 });
    if (s2_end != null && total != null)
      sectorRegions.push({ key: 's3', label: 'Sector 3',
                           mid: (s2_end + total) / 2 });
  }

  return (
    <div className="trackmap-view">
      <svg viewBox={`0 0 1000 ${Math.max(400, geom.height)}`}
           className="trackmap-svg">
        <path d={geom.d} className="track-outline-glow" />
        <path d={geom.d} className="track-outline" />

        {/* sector boundaries: perpendicular slash only, no inline label */}
        {sectorMarks.map((m) => {
          const i = geom.idxByDist(m.dist);
          const p = geom.ptAt(i);
          const { tx, ty } = geom.tangentAt(i);
          const nx = -ty, ny = tx;
          const L = 26;
          const col = SECTOR_COLORS[m.key];
          return (
            <line key={m.key}
                  x1={p.x - nx * L} y1={p.y - ny * L}
                  x2={p.x + nx * L} y2={p.y + ny * L}
                  stroke={col} strokeWidth="3" strokeLinecap="round" />
          );
        })}

        {/* sector region labels: float in the open space of each sector */}
        {sectorRegions.map((r) => {
          const i = geom.idxByDist(r.mid);
          const p = geom.ptAt(i);
          const { nx, ny } = outwardNormal(i, p.x, p.y);
          const off = 72;   // large offset so label sits in open space
          const col = SECTOR_COLORS[r.key];
          return (
            <text key={r.key}
                  x={p.x + nx * off} y={p.y + ny * off}
                  textAnchor="middle" dominantBaseline="middle"
                  className="sector-region-label" fill={col}>
              {r.label}
            </text>
          );
        })}

        {/* corner number labels, pushed OFF the track along the outward normal */}
        {corners.map((c) => {
          const i = geom.idxByDist(c.distance);
          const p = geom.ptAt(i);
          const { nx, ny } = outwardNormal(i, p.x, p.y);
          const off = 16;
          return (
            <text key={`${c.number}${c.letter}`}
                  x={p.x + nx * off} y={p.y + ny * off}
                  textAnchor="middle" dominantBaseline="middle"
                  className="corner-label">
              T{String(c.number).padStart(2, '0')}{c.letter}
            </text>
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
              <circle r={isFocused ? 18 : 13} fill={c}
                      opacity={isFocused ? 0.35 : 0.22} />
              <circle r={isFocused ? 8 : 6} fill={c}
                      stroke="#0b0c0f" strokeWidth="1.5" />
            </g>
          );
        })}

        {/* driver flag badges, offset perpendicular to the racing line */}
        {Object.entries(driverPositions).map(([drv, pos]) => {
          const idx = (pos.distance != null)
            ? geom.idxByDist(pos.distance) : 0;
          const p = (pos.x != null && pos.y != null)
            ? { x: geom.sx(pos.x), y: geom.sy(pos.y) }
            : geom.ptAt(idx);
          const { nx, ny } = outwardNormal(idx, p.x, p.y);
          const off = 30;
          const lx = p.x + nx * off, ly = p.y + ny * off;
          const c = driverMeta[drv]?.color || '#fff';
          return (
            <g key={drv} className="driver-flag"
               onClick={() => focusNearest(drv)}>
              {/* connector from dot to offset badge */}
              <line x1={p.x} y1={p.y} x2={lx} y2={ly}
                    stroke={c} strokeWidth="1.5" opacity="0.5" />
              {/* the precise track position */}
              <circle cx={p.x} cy={p.y} r="7" fill={c}
                      stroke="#0b0c0f" strokeWidth="2" />
              {/* badge, offset off the track */}
              <g transform={`translate(${lx},${ly})`}>
                <rect x="-26" y="-12" width="52" height="24" rx="4"
                      className="flag-body" />
                <rect x="-26" y="-12" width="6" height="24" rx="2" fill={c} />
                <text x="4" y="1" textAnchor="middle" dominantBaseline="middle"
                      className="flag-code" fill="#fff">{drv}</text>
              </g>
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
