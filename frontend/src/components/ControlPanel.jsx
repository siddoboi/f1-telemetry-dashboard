// Cascading selector chain: Year -> Event -> Session -> Drivers (max 5) ->
// Laps -> Baseline. (Live mode removed - OpenF1 live feed requires a paid
// Sponsor subscription; all data here is historical via FastF1.)
import { useEffect, useState } from 'react';
import { api, getSchedule, getSessions, getDrivers, getLaps } from '../api/client';

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
const MAX_DRIVERS = 5;

export default function ControlPanel({ onStart, onPause,
                                       onResume, onSpeed, running, paused }) {
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



  useEffect(() => {
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
    onStart({
      year, round: Number(round), session,
      drivers: selected,
      lap_numbers: Object.keys(lap_numbers).length ? lap_numbers : null,
      baseline_mode: baseline,
    });
  };

  const ready = round && session && selected.length > 0;

  return (
    <aside className="control-panel">

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
            Session optimal
          </button>
          <button className={baseline === 'personal_best' ? 'on' : ''}
                  onClick={() => setBaseline('personal_best')}>
            Personal best
          </button>
          <button className={baseline === 'off' ? 'on' : ''}
                  onClick={() => setBaseline('off')}
                  title="No baseline traces; anomalies from physics rules only">
            Off
          </button>
        </div>
      </div>

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
