// History tab - Phase 3.
// Saved laps grouped by session, with checkboxes (max 5 across all groups).
// "Load comparison" replays them straight from MongoDB - no FastF1, instant.
// Constraint surfaced in the UI: laps must come from the same Grand Prix.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const MAX = 5;

export default function HistoryView({ onLoadHistory }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);   // array of row objects

  useEffect(() => {
    api('/history').then(setRows).catch((e) => setError(e.message));
  }, []);

  const groups = useMemo(() => {
    if (!rows) return [];
    const g = {};
    for (const r of rows) {
      const k = `${r.year} · R${r.round} · ${r.session}`;
      (g[k] ??= { key: k, year: r.year, round: r.round,
                  session: r.session, laps: [] }).laps.push(r);
    }
    return Object.values(g).sort((a, b) =>
      b.year - a.year || b.round - a.round);
  }, [rows]);

  const isSel = (r) => selected.some((s) => sameLap(s, r));
  const sameCircuit = selected.length
    ? { year: selected[0].year, round: selected[0].round } : null;

  const toggle = (r) => {
    if (isSel(r)) {
      setSelected(selected.filter((s) => !sameLap(s, r)));
    } else if (selected.length < MAX) {
      setSelected([...selected, r]);
    }
  };

  if (error) {
    return <div className="empty"><p>History unavailable: {error}</p></div>;
  }
  if (rows === null) return <div className="empty"><p>Loading...</p></div>;
  if (!rows.length) {
    return (
      <div className="empty">
        <p>No saved laps yet.</p>
        <p className="hint">Laps are saved automatically when a replay runs
        to completion (MongoDB must be running).</p>
      </div>
    );
  }

  return (
    <div className="history-view">
      <div className="history-toolbar">
        <p className="hint">Select up to {MAX} laps from the
        {' '}<strong>same Grand Prix</strong> and load them as an instant
        comparison - served from the database, no download.</p>
        <button className="start-btn history-load"
                disabled={selected.length === 0}
                onClick={() => onLoadHistory(selected.map((s) => ({
                  year: s.year, round: s.round, session: s.session,
                  driver: s.driver, lap: s.lap })))}>
          Load comparison ({selected.length})
        </button>
      </div>

      {groups.map((g) => {
        const disabledGroup = sameCircuit
          && (sameCircuit.year !== g.year || sameCircuit.round !== g.round);
        return (
          <div key={g.key} className={`history-group ${disabledGroup ? 'dim' : ''}`}>
            <h3 className="history-group-title">{g.key}
              {disabledGroup && <em>  (different GP - deselect first)</em>}
            </h3>
            <div className="history-laps">
              {g.laps.map((r, i) => (
                <button key={i}
                        className={`lap-card-btn ${isSel(r) ? 'selected' : ''}`}
                        disabled={disabledGroup
                                  || (!isSel(r) && selected.length >= MAX)}
                        onClick={() => toggle(r)}>
                  <span className="lap-num mono">{r.driver}
                    {r.schema_version >= 2 && (
                      <span className="lap-v2" title="Full cache: track map,
                        events and baseline stored — loads instantly and
                        completely">★</span>
                    )}
                  </span>
                  <span className="lap-time">
                    {r.lap === -1 ? 'fastest lap' : `lap ${r.lap}`}
                  </span>
                  <span className="lap-compound">
                    {isSel(r) ? '✓ selected' : 'tap to select'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const sameLap = (a, b) =>
  a.year === b.year && a.round === b.round && a.session === b.session
  && a.driver === b.driver && a.lap === b.lap;
