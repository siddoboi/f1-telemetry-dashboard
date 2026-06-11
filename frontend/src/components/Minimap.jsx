// Editing-software-style timeline minimap.
// Shows the full lap (speed trace of the first driver) and a selection
// window. Dragging the window pans; dragging its edges resizes (zooms);
// Ctrl+wheel anywhere over the charts zooms around the cursor.
// The selected [start, end] distance range drives EVERY chart above it.
import { useCallback, useMemo, useRef } from 'react';

const H = 56;

export default function Minimap({ points, fullRange, domain, onDomain,
                                  driverMeta }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);   // {mode:'pan'|'left'|'right', startX, dom0}
  const [min, max] = fullRange;
  const span = max - min || 1;

  const firstDriver = Object.keys(driverMeta)[0];
  const color = driverMeta[firstDriver]?.color || '#888';

  // Downsample the speed trace to ~300 points for a cheap path
  const path = useMemo(() => {
    if (!points.length || !firstDriver) return '';
    const key = `base_${firstDriver}_speed`;
    const altKey = `${firstDriver}_speed`;
    const step = Math.max(1, Math.floor(points.length / 300));
    let maxV = 1;
    for (const p of points) {
      const v = p[key] ?? p[altKey];
      if (v > maxV) maxV = v;
    }
    const cmds = [];
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      const v = p[key] ?? p[altKey] ?? 0;
      const x = ((p.distance - min) / span) * 100;
      const y = H - 6 - (v / maxV) * (H - 14);
      cmds.push(`${cmds.length ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return cmds.join(' ');
  }, [points, firstDriver, min, span]);

  const toDist = useCallback((clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return min + frac * span;
  }, [min, span]);

  const onPointerDown = (mode) => (e) => {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, dom0: [...domain] };
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dDist = ((e.clientX - drag.startX) / rect.width) * span;
    let [a, b] = drag.dom0;
    const minWidth = span * 0.02;
    if (drag.mode === 'pan') {
      const w = b - a;
      a = Math.max(min, Math.min(max - w, a + dDist));
      b = a + w;
    } else if (drag.mode === 'left') {
      a = Math.max(min, Math.min(b - minWidth, a + dDist));
    } else if (drag.mode === 'right') {
      b = Math.min(max, Math.max(a + minWidth, b + dDist));
    }
    onDomain([a, b]);
  };

  const onPointerUp = () => { dragRef.current = null; };

  // Click outside the window: jump-center the window there
  const onTrackClick = (e) => {
    if (dragRef.current) return;
    const d = toDist(e.clientX);
    const w = domain[1] - domain[0];
    let a = Math.max(min, Math.min(max - w, d - w / 2));
    onDomain([a, a + w]);
  };

  const x1 = ((domain[0] - min) / span) * 100;
  const x2 = ((domain[1] - min) / span) * 100;

  return (
    <div className="minimap">
      <svg ref={svgRef} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
           onPointerMove={onPointerMove} onPointerUp={onPointerUp}
           onPointerLeave={onPointerUp} onClick={onTrackClick}>
        <rect x="0" y="0" width="100" height={H} className="mm-bg" />
        {path && <path d={path} className="mm-trace" style={{ stroke: color }} />}
        {/* dimmed outside-selection shrouds */}
        <rect x="0" y="0" width={x1} height={H} className="mm-shroud" />
        <rect x={x2} y="0" width={100 - x2} height={H} className="mm-shroud" />
        {/* selection window */}
        <rect x={x1} y="0" width={x2 - x1} height={H} className="mm-window"
              onPointerDown={onPointerDown('pan')} />
        <rect x={x1 - 0.6} y="0" width="1.6" height={H} className="mm-handle"
              onPointerDown={onPointerDown('left')} />
        <rect x={x2 - 1} y="0" width="1.6" height={H} className="mm-handle"
              onPointerDown={onPointerDown('right')} />
      </svg>
      <div className="mm-labels">
        <span>{Math.round(domain[0])} m</span>
        <button className="mm-reset" onClick={() => onDomain([min, max])}>
          RESET ZOOM
        </button>
        <span>{Math.round(domain[1])} m</span>
      </div>
    </div>
  );
}

// Shared helper: Ctrl+wheel zoom around cursor, used by TelemetryView
export function wheelZoom(e, domain, fullRange, onDomain, containerEl) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const [min, max] = fullRange;
  const rect = containerEl.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const cursor = domain[0] + frac * (domain[1] - domain[0]);
  const factor = e.deltaY > 0 ? 1.25 : 0.8;
  const minWidth = (max - min) * 0.02;
  let w = Math.max(minWidth, Math.min(max - min,
                                      (domain[1] - domain[0]) * factor));
  let a = Math.max(min, cursor - frac * w);
  let b = Math.min(max, a + w);
  a = Math.max(min, b - w);
  onDomain([a, b]);
}
