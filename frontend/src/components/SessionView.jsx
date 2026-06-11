// SESSION tab (Option C): lap-time progression chart on top, clickable lap
// film strip below. Clicking a chart point or a strip card loads that exact
// lap into the replay for that driver.
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from 'recharts';
import { getLaps } from '../api/client';

export default function SessionView({ driverMeta, sessionRef, onPickLap }) {
  const [lapsByDriver, setLapsByDriver] = useState({});
  const [error, setError] = useState('');
  const drivers = Object.keys(driverMeta);

  useEffect(() => {
    setLapsByDriver({}); setError('');
    if (!sessionRef || !drivers.length) return;
    const { year, round, session } = sessionRef;
    Promise.all(drivers.map((d) =>
      getLaps(year, round, session, d).then((laps) => [d, laps])))
      .then((pairs) => setLapsByDriver(Object.fromEntries(pairs)))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRef, drivers.join(',')]);

  // merge to one chart series: x = lap_number, one y-key per driver
  const chartData = useMemo(() => {
    const byLap = {};
    for (const [drv, laps] of Object.entries(lapsByDriver)) {
      for (const l of laps) {
        byLap[l.lap_number] ??= { lap: l.lap_number };
        byLap[l.lap_number][drv] = l.lap_time_s;
      }
    }
    return Object.values(byLap).sort((a, b) => a.lap - b.lap);
  }, [lapsByDriver]);

  if (!sessionRef || !drivers.length) {
    return <div className="empty"><p>Load a replay first — the full session
      timeline for those drivers appears here.</p></div>;
  }
  if (error) {
    return <div className="empty"><p>Couldn't load session laps:
      {' '}{error}</p></div>;
  }

  const fmt = (s) => {
    if (s == null) return '';
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toFixed(3).padStart(6, '0')}`;
  };

  return (
    <div className="session-view">
      <h2 className="session-title">LAP TIME PROGRESSION</h2>
      <p className="hint">Click any point or lap card to load that exact lap
      into the replay.</p>

      <div className="chart-block">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}
                     margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" />
            <XAxis dataKey="lap" stroke="var(--axis)" fontSize={10}
                   label={{ value: 'LAP', position: 'insideBottomRight',
                            fontSize: 9, fill: 'var(--axis)' }} />
            <YAxis stroke="var(--axis)" fontSize={10} width={56}
                   domain={['auto', 'auto']} tickFormatter={fmt}
                   reversed={false} />
            <Tooltip
              contentStyle={{ background: 'var(--panel)',
                              border: '1px solid var(--grid)', fontSize: 11 }}
              labelFormatter={(v) => `Lap ${v}`}
              formatter={(value, name) => [fmt(value), name]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {drivers.map((drv) => (
              <Line key={drv} dataKey={drv} name={drv} connectNulls
                    stroke={driverMeta[drv].color} strokeWidth={1.8}
                    isAnimationActive={false}
                    dot={{ r: 3.5, cursor: 'pointer',
                           onClick: (_, payload) =>
                             onPickLap(drv, payload.payload.lap) }}
                    activeDot={{ r: 6, cursor: 'pointer',
                                 onClick: (_, payload) =>
                                   onPickLap(drv, payload.payload.lap) }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {drivers.map((drv) => (
        <div key={drv} className="film-strip-block">
          <div className="driver-chart-label"
               style={{ '--team': driverMeta[drv].color }}>{drv}</div>
          <div className="film-strip">
            {(lapsByDriver[drv] || []).map((l) => (
              <button key={l.lap_number}
                      className={`lap-card-btn ${l.is_personal_best ? 'pb' : ''}`}
                      style={{ '--team': driverMeta[drv].color }}
                      onClick={() => onPickLap(drv, l.lap_number)}>
                <span className="lap-num">L{l.lap_number}</span>
                <span className="lap-time">{l.lap_time}</span>
                <span className="lap-compound">{l.compound}
                  {l.is_personal_best ? ' ★' : ''}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
