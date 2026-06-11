// App: owns replay/live state, the zoom domain shared by all telemetry
// charts, and the tab router. All views stay mounted (hidden with CSS) so
// switching tabs never interrupts the stream.
import { useMemo, useRef, useState } from 'react';
import { ReplayClient } from './api/client';
import NavBar from './components/NavBar';
import ControlPanel from './components/ControlPanel';
import TelemetryView from './components/TelemetryView';
import TrackMapView from './components/TrackMapView';
import DriversView from './components/DriversView';
import HistoryView from './components/HistoryView';
import AnomalySidebar from './components/AnomalySidebar';

const CHANNELS = ['speed', 'throttle', 'brake', 'rpm', 'gear', 'drs'];

export default function App() {
  const [tab, setTab] = useState('telemetry');
  const [status, setStatus] = useState('');
  const [meta, setMeta] = useState(null);
  const [points, setPoints] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState('replay');           // 'replay' | 'live'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusedEvent, setFocusedEvent] = useState(null);
  const [visibleDistance, setVisibleDistance] = useState(0);
  const [driverDistances, setDriverDistances] = useState({});
  const [domain, setDomain] = useState([0, 1]);
  const [sessionRef, setSessionRef] = useState(null);   // for profile API
  const clientRef = useRef(null);
  const bufferRef = useRef([]);
  const liveEventsRef = useRef([]);

  const driverMeta = useMemo(() => {
    if (!meta) return {};
    const out = {};
    for (const [drv, info] of Object.entries(meta.drivers)) {
      out[drv] = { color: info.meta.color || '#888888', ...info.meta };
    }
    return out;
  }, [meta]);

  const fullRange = useMemo(() => {
    if (!points.length) return [0, 1];
    return [points[0].distance, points[points.length - 1].distance];
  }, [points]);

  const visibleEvents = useMemo(() => {
    if (mode === 'live') return liveEventsRef.current;
    return (meta?.events || [])
      .filter((e) => e.start_distance <= visibleDistance);
  }, [meta, visibleDistance, mode]);

  const flush = () => {
    const buffered = bufferRef.current;
    if (!buffered.length) return;
    bufferRef.current = [];
    setPoints((prev) => {
      let next = [...prev];
      for (const frame of buffered) {
        if (frame.mode === 'live') {
          // live mode: append-only growing series, one point per bundle
          const p = { distance: 0 };
          for (const [drv, vals] of Object.entries(frame.drivers)) {
            p.distance = Math.max(p.distance, vals.distance);
            for (const ch of CHANNELS) p[`${drv}_${ch}`] = vals[ch];
            if (vals.anomaly) {
              liveEventsRef.current = [...liveEventsRef.current.slice(-49), {
                driver: drv, start_distance: vals.distance,
                end_distance: vals.distance + 10,
                peak_score: vals.anomaly_score,
                label: vals.anomaly_label || 'Anomaly',
                diagnosis: `${vals.anomaly_label} flagged live at `
                  + `${Math.round(vals.distance)} m (rules engine).`,
              }];
            }
          }
          next.push(p);
          if (next.length > 4000) next = next.slice(-4000);
        } else {
          const i = frame.index;
          if (i >= next.length) continue;
          const p = { ...next[i] };
          for (const [drv, vals] of Object.entries(frame.drivers)) {
            for (const ch of CHANNELS) p[`${drv}_${ch}`] = vals[ch];
          }
          next[i] = p;
        }
      }
      return next;
    });
    const last = buffered[buffered.length - 1];
    const dists = {};
    for (const [drv, vals] of Object.entries(last.drivers)) {
      dists[drv] = vals.distance ?? 0;
    }
    setDriverDistances(dists);
    setVisibleDistance(Math.max(0, ...Object.values(dists)));
    if (last.mode === 'live') {
      setDomain((d) => d); // domain managed below for live
    }
  };

  const makeClient = (isLive) => new ReplayClient({
    onStatus: (m) => setStatus(m.message),
    onError: (m) => { setStatus(`Error: ${m.message}`); setRunning(false); },
    onComplete: () => { flush(); setStatus('Replay complete.'); },
    onMeta: (m) => {
      setMeta(m); setStatus('');
      if (!isLive) {
        const first = Object.values(m.drivers)[0];
        const dist = first.baseline.distance;
        const base = [];
        for (let i = 0; i < dist.length; i++) {
          const p = { distance: dist[i] };
          for (const [drv, info] of Object.entries(m.drivers)) {
            for (const ch of CHANNELS) {
              if (info.baseline[ch] && i < info.baseline[ch].length) {
                p[`base_${drv}_${ch}`] = info.baseline[ch][i];
              }
            }
          }
          base.push(p);
        }
        setPoints(base);
        setDomain([dist[0], dist[dist.length - 1]]);
      }
    },
    onFrame: (frame) => {
      bufferRef.current.push(frame);
      if (bufferRef.current.length >= 2) flush();
    },
  });

  const handleStart = (request) => {
    setStatus('Connecting...');
    reset('replay');
    setSessionRef({ year: request.year, round: request.round,
                    session: request.session });
    const client = makeClient(false);
    client.start(request);
    clientRef.current = client;
  };

  const handleStartLive = (drivers) => {
    setStatus('Connecting to live feed...');
    reset('live');
    setSessionRef(null);
    setDomain([0, 100]);
    const client = makeClient(true);
    client.startLive(drivers);
    clientRef.current = client;
  };

  const reset = (m) => {
    clientRef.current?.stop();
    setMeta(null); setPoints([]); setRunning(true); setPaused(false);
    setVisibleDistance(0); setDriverDistances({});
    bufferRef.current = []; liveEventsRef.current = [];
    setMode(m); setFocusedEvent(null);
  };

  return (
    <div className="app">
      <NavBar tab={tab} onTab={setTab} live={mode === 'live' && running} />
      <div className="layout">
        <ControlPanel
          onStart={handleStart}
          onStartLive={handleStartLive}
          onPause={() => { clientRef.current?.pause(); setPaused(true); }}
          onResume={() => { clientRef.current?.resume(); setPaused(false); }}
          onSpeed={(x) => clientRef.current?.setSpeed(x)}
          running={running} paused={paused} mode={mode}
        />

        <main className="main">
          {meta && mode === 'replay' && (
            <header className="lap-header">
              {Object.entries(meta.drivers).map(([drv, info]) => (
                <div className="lap-card" key={drv}
                     style={{ '--team': info.meta.color }}>
                  <span className="lap-drv">{drv}</span>
                  <span>Lap {info.lap_number} · {info.lap_time}</span>
                  <span className="lap-base">
                    vs {info.baseline_driver} {info.baseline_lap_time}
                    {meta.baseline_mode === 'personal_best'
                      ? ' (PB)' : ' (optimal)'}
                  </span>
                </div>
              ))}
            </header>
          )}
          {meta && mode === 'live' && (
            <header className="lap-header">
              <div className="lap-card live">
                <span className="lap-drv">{meta.session_name}</span>
                <span>{meta.circuit}</span>
                <span className="lap-base">distance integrated from speed ·
                  rules-engine anomalies only</span>
              </div>
            </header>
          )}

          {status && <div className="status-bar">{status}</div>}

          <div className={tab === 'telemetry' ? '' : 'hidden'}>
            <TelemetryView
              points={points} driverMeta={driverMeta}
              events={visibleEvents}
              onEventClick={(ev) => { setFocusedEvent(ev); setSidebarOpen(true); }}
              domain={mode === 'live' ? fullRange : domain}
              setDomain={setDomain} fullRange={fullRange}
            />
          </div>
          <div className={tab === 'trackmap' ? '' : 'hidden'}>
            <TrackMapView
              track={meta?.track} driverMeta={driverMeta}
              driverDistances={driverDistances} events={visibleEvents}
              onEventClick={(ev) => { setFocusedEvent(ev); setSidebarOpen(true); }}
            />
          </div>
          <div className={tab === 'drivers' ? '' : 'hidden'}>
            <DriversView driverMeta={driverMeta} sessionRef={sessionRef} />
          </div>
          <div className={tab === 'history' ? '' : 'hidden'}>
            <HistoryView />
          </div>
        </main>

        <AnomalySidebar
          events={visibleEvents}
          validation={meta?.validation || {}}
          driverMeta={driverMeta}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          focused={focusedEvent}
        />
      </div>
    </div>
  );
}
