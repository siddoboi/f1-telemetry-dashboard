// Cascading selector chain: Year -> Event -> Session -> Drivers (max 5) ->
// Laps -> Baseline. (Live mode removed - OpenF1 live feed requires a paid
// Sponsor subscription; all data here is historical via FastF1.)
//
// Phase 6: the panel collapses to a 60px rail (hamburger to expand, chevron
//   to collapse) that keeps the replay controls reachable. State persists in
//   localStorage.
// Phase 7: "Custom" baseline mode reveals a second Year->GP->Session->Driver
//   ->Lap cascade; the baseline lap can come from a different session/year.
import { useEffect, useState } from 'react';
import { getSchedule, getSessions, getDrivers, getLaps } from '../api/client';

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
const MAX_DRIVERS = 5;
const COLLAPSE_KEY = 'pitwall.panelCollapsed';

export default function ControlPanel({ onStart, onPause, onResume, onSpeed,
                                       running, paused,
                                       collapsed, onCollapsedChange }) {
  const setCollapsed = (v) => {
    localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
    onCollapsedChange?.(v);
  };

  const [year, setYear] = useState(2025);
  const [events, setEvents] = useState([]);
  const [round, setRound] = useState('');
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState('');
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [lapsByDriver, setLapsByDriver] = useState({});
  const [lapChoice, setLapChoice] = useState({});
  const [baseline, setBaseline] = useState('session_optimal');
  const [speed, setSpeedLocal] = useState(1);
  const [loading, setLoading] = useState('');

  // --- custom baseline (Phase 7) cascade state ---
  const [bYear, setBYear] = useState(2024);
  const [bEvents, setBEvents] = useState([]);
  const [bRound, setBRound] = useState('');
  const [bSessions, setBSessions] = useState([]);
  const [bSession, setBSession] = useState('');
  const [bDrivers, setBDrivers] = useState([]);
  const [bDriver, setBDriver] = useState('');
  const [bLaps, setBLaps] = useState([]);
  const [bLap, setBLap] = useState('');
  const [bLoading, setBLoading] = useState('');

  useEffect(() => {
    // comparison cascade: reload events when the season changes
    setEvents([]); setRound('');
    getSchedule(year).then(setEvents).catch(() => setEvents([]));
  }, [year]);

  useEffect(() => {
    setSessions([]); setSession('');
    if (round) getSessions(year, round).then(setSessions).catch(() => {});
  }, [year, round]);

  useEffect(() => {
    setDrivers([]); setSelected([]); setLapsByDriver({}); setLapChoice({});
    if (!session) return;
    setLoading('Loading drivers (downloads session on first use)...');
    getDrivers(year, round, session)
      .then((d) => { setDrivers(d); setLoading(''); })
      .catch((e) => setLoading(`Failed: ${e.message}`));
  }, [year, round, session]);

  // --- custom baseline cascade effects (only when baseline === 'custom') ---
  useEffect(() => {
    if (baseline !== 'custom') return;
    setBEvents([]); setBRound('');
    getSchedule(bYear).then(setBEvents).catch(() => setBEvents([]));
  }, [bYear, baseline]);

  useEffect(() => {
    if (baseline !== 'custom') return;
    setBSessions([]); setBSession('');
    if (bRound) getSessions(bYear, bRound).then(setBSessions).catch(() => {});
  }, [bYear, bRound, baseline]);

  useEffect(() => {
    if (baseline !== 'custom') return;
    setBDrivers([]); setBDriver(''); setBLaps([]); setBLap('');
    if (!bSession) return;
    setBLoading('Loading drivers...');
    getDrivers(bYear, bRound, bSession)
      .then((d) => { setBDrivers(d); setBLoading(''); })
      .catch((e) => setBLoading(`Failed: ${e.message}`));
  }, [bYear, bRound, bSession, baseline]);

  useEffect(() => {
    if (baseline !== 'custom' || !bDriver) return;
    setBLaps([]); setBLap('');
    getLaps(bYear, bRound, bSession, bDriver).then(setBLaps).catch(() => {});
  }, [bDriver, bYear, bRound, bSession, baseline]);

  const toggle = (list, setList) => (code) => {
    if (list.includes(code)) setList(list.filter((c) => c !== code));
    else if (list.length < MAX_DRIVERS) setList([...list, code]);
  };

  const toggleDriver = async (code) => {
    toggle(selected, setSelected)(code);
    if (!selected.includes(code) && !lapsByDriver[code]) {
      const laps = await getLaps(year, round, session, code).catch(() => []);
      setLapsByDriver((p) => ({ ...p, [code]: laps }));
    }
  };

  const start = () => {
    const lap_numbers = {};
    selected.forEach((c) => {
      if (lapChoice[c]) lap_numbers[c] = Number(lapChoice[c]);
    });
    const payload = {
      year, round: Number(round), session,
      drivers: selected,
      lap_numbers: Object.keys(lap_numbers).length ? lap_numbers : null,
      baseline_mode: baseline,
    };
    if (baseline === 'custom') {
      payload.baseline_override = {
        year: bYear, round: Number(bRound), session: bSession,
        driver: bDriver, lap: bLap ? Number(bLap) : null,
      };
    }
    onStart(payload);
  };

  const customReady = baseline !== 'custom'
    || (bRound && bSession && bDriver);
  const ready = round && session && selected.length > 0 && customReady;

  // ---- collapsed rail -----------------------------------------------------
  if (collapsed) {
    return (
      <aside className="control-panel collapsed">
        <button className="rail-btn expand" title="Expand panel"
                onClick={() => setCollapsed(false)}>
          <Hamburger />
        </button>
        {running && (
          <div className="rail-controls">
            <button className="rail-btn" title={paused ? 'Resume' : 'Pause'}
                    onClick={paused ? onResume : onPause}>
              {paused ? '▶' : '⏸'}
            </button>
            <div className="rail-speed" title={`Speed ×${speed}`}>
              <input type="range" min="0.5" max="8" step="0.5" value={speed}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       setSpeedLocal(v); onSpeed(v);
                     }} />
              <span>×{speed}</span>
            </div>
          </div>
        )}
      </aside>
    );
  }

  // ---- expanded panel -----------------------------------------------------
  return (
    <aside className="control-panel">
      <button className="collapse-btn" title="Collapse panel"
              onClick={() => setCollapsed(true)}>
        <Chevron /> <span>Collapse</span>
      </button>

      <label className="field">Season
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>

      <label className="field">Grand Prix
        <select value={round} onChange={(e) => setRound(e.target.value)}>
          <option value="">Select event</option>
          {events.map((ev) => (
            <option key={ev.round} value={ev.round}>
              R{ev.round} · {ev.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">Session
        <select value={session} onChange={(e) => setSession(e.target.value)}>
          <option value="">Select session</option>
          {sessions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {loading && <p className="hint">{loading}</p>}

      {drivers.length > 0 && (
        <div className="field">
          <span>Drivers <em>(max {MAX_DRIVERS})</em></span>
          <div className="driver-grid">
            {drivers.map((d) => (
              <button key={d.code}
                      className={`driver-chip ${selected.includes(d.code) ? 'on' : ''}`}
                      style={{ '--team': d.color }}
                      onClick={() => toggleDriver(d.code)}
                      title={`${d.name} · ${d.team}`}>
                {d.code}
              </button>
            ))}
          </div>
        </div>
      )}

      {selected.map((code) => (
        <label className="field" key={code}>Lap · {code}
          <select value={lapChoice[code] ?? ''}
                  onChange={(e) =>
                    setLapChoice((p) => ({ ...p, [code]: e.target.value }))}>
            <option value="">Fastest lap</option>
            {(lapsByDriver[code] || []).map((l) => (
              <option key={l.lap_number} value={l.lap_number}>
                Lap {l.lap_number} · {l.lap_time} · {l.compound}
                {l.is_personal_best ? ' ★' : ''}
              </option>
            ))}
          </select>
        </label>
      ))}

      <div className="field">
        <span>Baseline</span>
        <div className="baseline-toggle">
          <button className={baseline === 'session_optimal' ? 'on' : ''}
                  onClick={() => setBaseline('session_optimal')}>
            Optimal
          </button>
          <button className={baseline === 'personal_best' ? 'on' : ''}
                  onClick={() => setBaseline('personal_best')}>
            Personal
          </button>
          <button className={baseline === 'off' ? 'on' : ''}
                  onClick={() => setBaseline('off')}
                  title="No baseline traces; anomalies from physics rules only">
            Off
          </button>
          <button className={baseline === 'custom' ? 'on' : ''}
                  onClick={() => setBaseline('custom')}
                  title="Pick any driver's lap from any session as baseline">
            Custom
          </button>
        </div>
      </div>

      {baseline === 'custom' && (
        <div className="custom-baseline">
          <p className="hint">Baseline lap — can be any driver from any
          session. Loading a different session downloads it on first use,
          which may take a few minutes.</p>

          <label className="field">Baseline season
            <select value={bYear}
                    onChange={(e) => setBYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field">Baseline Grand Prix
            <select value={bRound} onChange={(e) => setBRound(e.target.value)}>
              <option value="">Select event</option>
              {bEvents.map((ev) => (
                <option key={ev.round} value={ev.round}>
                  R{ev.round} · {ev.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">Baseline session
            <select value={bSession}
                    onChange={(e) => setBSession(e.target.value)}>
              <option value="">Select session</option>
              {bSessions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {bLoading && <p className="hint">{bLoading}</p>}
          {bDrivers.length > 0 && (
            <label className="field">Baseline driver
              <select value={bDriver}
                      onChange={(e) => setBDriver(e.target.value)}>
                <option value="">Select driver</option>
                {bDrivers.map((d) => (
                  <option key={d.code} value={d.code}>{d.code} · {d.team}</option>
                ))}
              </select>
            </label>
          )}
          {bDriver && (
            <label className="field">Baseline lap
              <select value={bLap} onChange={(e) => setBLap(e.target.value)}>
                <option value="">Fastest lap</option>
                {bLaps.map((l) => (
                  <option key={l.lap_number} value={l.lap_number}>
                    Lap {l.lap_number} · {l.lap_time} · {l.compound}
                    {l.is_personal_best ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <button className="start-btn" disabled={!ready} onClick={start}>
        {running ? 'Restart replay' : 'Start replay'}
      </button>

      {running && (
        <div className="replay-controls">
          <button onClick={paused ? onResume : onPause}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <label>Speed ×{speed}
            <input type="range" min="0.5" max="8" step="0.5" value={speed}
                   onChange={(e) => {
                     const v = Number(e.target.value);
                     setSpeedLocal(v); onSpeed(v);
                   }} />
          </label>
        </div>
      )}
    </aside>
  );
}

function Hamburger() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
