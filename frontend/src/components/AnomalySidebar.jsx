// Collapsible right sidebar: chronological (by distance) anomaly event log
// with programmatic diagnosis text, plus the ML-vs-physics-rules validation
// summary so the model's behaviour is transparent, not a black box.
import { useEffect, useRef } from 'react';

export default function AnomalySidebar({ events, validation, driverMeta,
                                         open, onToggle, focused,
                                         onEventClick }) {
  const refs = useRef({});
  useEffect(() => {
    if (focused == null) return;
    const idx = events.findIndex((e) =>
      e.driver === focused.driver
      && e.start_distance === focused.start_distance);
    if (idx === -1) return;
    const t = setTimeout(() => {
      refs.current[idx]?.scrollIntoView({ behavior: 'smooth',
                                          block: 'center' });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <button className="sidebar-toggle" onClick={onToggle}>
        {open ? '›' : '‹'} EVENTS {events.length > 0 && (
          <span className="badge">{events.length}</span>
        )}
      </button>

      {open && (
        <div className="sidebar-body">
          <h2>Anomaly log</h2>
          {events.length === 0 && (
            <p className="hint">No anomalies flagged yet. Bands appear on the
            charts and entries appear here as the replay progresses.</p>
          )}

          {events.map((ev, i) => (
            <div key={i}
                 ref={(el) => { refs.current[i] = el; }}
                 className={`event-card ${focused
                   && focused.driver === ev.driver
                   && focused.start_distance === ev.start_distance
                   ? 'focused' : ''}`}
                 style={{ '--team': driverMeta[ev.driver]?.color || '#888',
                          cursor: onEventClick ? 'pointer' : 'default' }}
                 onClick={() => onEventClick?.(ev)}>
              <div className="event-head">
                <span className="event-driver">{ev.driver}</span>
                <span className="event-score">
                  score {ev.peak_score.toFixed(2)}
                </span>
              </div>
              <div className="event-label">{ev.label}</div>
              <div className="event-range">
                <span className="dist-pill">{Math.round(ev.start_distance)} m</span>
                <span className="dist-arrow">→</span>
                <span className="dist-pill">{Math.round(ev.end_distance)} m</span>
              </div>
              <p className="event-diag">{ev.diagnosis}</p>
            </div>
          ))}

          {Object.keys(validation).length > 0 && (
            <div className="validation">
              <h3>Model validation</h3>
              <p className="hint">Agreement between the Isolation Forest and
              independent physics rules (lock-up, wheelspin, throttle
              oscillation, snap lift).</p>
              {Object.entries(validation).map(([drv, v]) => (
                <div className="val-row" key={drv}>
                  <strong>{drv}</strong>
                  <span>ML flags: {v.ml_flagged}</span>
                  <span>Rule flags: {v.rules_flagged}</span>
                  <span>
                    Precision vs rules:{' '}
                    {v.precision_vs_rules != null
                      ? `${(v.precision_vs_rules * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
