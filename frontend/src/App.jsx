// App: owns replay/live state, the shared zoom domain, the tab router, the
// hover profile overlay, and lap re-picking from the Session view.
import React, { useMemo, useRef, useState } from 'react';
import { ReplayClient } from './api/client';
import NavBar from './components/NavBar';
import ControlPanel from './components/ControlPanel';
import TelemetryView from './components/TelemetryView';
import TrackMapView from './components/TrackMapView';
import SessionView from './components/SessionView';
import HistoryView from './components/HistoryView';
import AnomalySidebar from './components/AnomalySidebar';
import ProfileOverlay from './components/ProfileOverlay';

const CHANNELS = ['speed', 'throttle', 'brake', 'rpm', 'gear', 'drs', 'delta'];
const HOVER_SHOW_MS = 350;
const HOVER_HIDE_MS = 200;

export default function App() {
  const [tab, setTab] = useState('telemetry');
  const [status, setStatus] = useState('');
  const [meta, setMeta] = useState(null);
  const [points, setPoints] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState('replay');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusedEvent, setFocusedEvent] = useState(null);
  const [visibleDistance, setVisibleDistance] = useState(0);
  const [driverPositions, setDriverPositions] = useState({});
  const [domain, setDomain] = useState(null);     // null = follow full lap
  const [sessionRef, setSessionRef] = useState(null);
  const [hoverProfile, setHoverProfile] = useState(null); // {code, rect}
  const clientRef = useRef(null);
  const bufferRef = useRef([]);
  const liveEventsRef = useRef([]);
  const lastRequestRef = useRef(null);
  const hoverTimer = useRef(null);

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

  const effDomain = domain ?? fullRange;

  const handleSetDomain = (d) => {
    const [min, max] = fullRange;
    const eps = (max - min) * 0.005;
    if (Math.abs(d[0] - min) < eps && Math.abs(d[1] - max) < eps) {
      setDomain(null);          // back to full lap = follow growth
    } else {
      setDomain(d);
    }
  };

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
          // grow the array when no baseline pre-filled it (baseline OFF)
          while (next.length <= i) next.push({ distance: 0 });
          const p = { ...next[i] };
          let maxDist = p.distance || 0;
          for (const [drv, vals] of Object.entries(frame.drivers)) {
            for (const ch of CHANNELS) p[`${drv}_${ch}`] = vals[ch];
            maxDist = Math.max(maxDist, vals.distance ?? 0);
          }
          p.distance = p.distance || maxDist;
          next[i] = p;
        }
      }
      return next;
    });
    const last = buffered[buffered.length - 1];
    const pos = {};
    for (const [drv, vals] of Object.entries(last.drivers)) {
      pos[drv] = { distance: vals.distance ?? 0,
                   x: vals.x ?? null, y: vals.y ?? null };
    }
    setDriverPositions(pos);
    setVisibleDistance(Math.max(0,
      ...Object.values(pos).map((p) => p.distance)));
  };

  const makeClient = (isLive) => new ReplayClient({
    onStatus: (m) => setStatus(m.message),
    onError: (m) => { setStatus(`Error: ${m.message}`); setRunning(false); },
    onComplete: () => { flush(); setStatus('Replay complete.'); },
    onMeta: (m) => {
      setMeta(m); setStatus('');
      if (!isLive) {
        const first = Object.values(m.drivers)[0];
        const dist = first?.baseline?.distance;
        if (dist?.length) {                       // baseline traces present
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
        } else {
          setPoints([]);                          // baseline OFF: grow live
        }
        setDomain(null);
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
    lastRequestRef.current = request;
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
    const client = makeClient(true);
    client.startLive(drivers);
    clientRef.current = client;
  };

  // HISTORY tab: replay saved laps straight from MongoDB (no FastF1)
  const handleLoadHistory = (laps) => {
    setStatus('Loading saved laps...');
    reset('replay');
    setSessionRef(null);              // profiles/session need FastF1 context
    const client = makeClient(false);
    client.startHistory(laps);
    clientRef.current = client;
    setTab('telemetry');
  };

  // SESSION tab: click a lap -> reload the replay with that exact lap
  const handlePickLap = (driver, lapNumber) => {
    const last = lastRequestRef.current;
    if (!last) return;
    const req = { ...last,
                  lap_numbers: { ...(last.lap_numbers || {}),
                                 [driver]: lapNumber } };
    setTab('telemetry');
    handleStart(req);
  };

  const reset = (m) => {
    clientRef.current?.stop();
    setMeta(null); setPoints([]); setRunning(true); setPaused(false);
    setVisibleDistance(0); setDriverPositions({});
    bufferRef.current = []; liveEventsRef.current = [];
    setMode(m); setFocusedEvent(null); setDomain(null);
    setHoverProfile(null);
  };

  // ---- hover profile overlay (lap header chips) -------------------------
  const chipEnter = (code) => (e) => {
    clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(
      () => setHoverProfile({ code, rect }), HOVER_SHOW_MS);
  };
  const chipLeave = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => setHoverProfile(null), HOVER_HIDE_MS);
  };
  const overlayEnter = () => clearTimeout(hoverTimer.current);

  const focusEvent = (ev) => { setFocusedEvent(ev); setSidebarOpen(true); };

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
                <div className="lap-card hoverable" key={drv}
                     style={{ '--team': info.meta.color }}
                     onMouseEnter={chipEnter(drv)}
                     onMouseLeave={chipLeave}>
                  <span className="lap-drv">{drv}</span>
                  <span>Lap {info.lap_number} · {info.lap_time}</span>
                  {info.baseline_driver && (
                    <span className="lap-base">
                      vs {info.baseline_driver} {info.baseline_lap_time}
                      {meta.baseline_mode === 'personal_best'
                        ? ' (PB)' : ' (optimal)'}
                    </span>
                  )}
                  {meta.baseline_mode === 'off' && (
                    <span className="lap-base">baseline off ·
                      rules-only anomalies</span>
                  )}
                  {meta.baseline_mode === 'fastest_selected' && (
                    <span className="lap-base">from database ·
                      baseline = fastest selected</span>
                  )}
                </div>
              ))}
            <ExportMenu />
            </header>
          )}
          {meta && mode === 'live' && (
            <header className="lap-header">
              <div className="lap-card live">
                <span className="lap-drv">{meta.session_name}</span>
                <span>{meta.circuit}</span>
                <span className="lap-base">distance integrated from speed ·
                  rules-engine anomalies</span>
              </div>
            <ExportMenu />
            </header>
          )}

          {status && <div className="status-bar">{status}</div>}

          <div className={tab === 'telemetry' ? '' : 'hidden'}>
            <TelemetryView
              points={points} driverMeta={driverMeta}
              events={visibleEvents} onEventClick={focusEvent}
              domain={effDomain} setDomain={handleSetDomain}
              fullRange={fullRange}
              hasBaseline={!!meta && meta.mode !== 'live'
                           && meta.baseline_mode !== 'off'}
            />
          </div>
          <div className={tab === 'trackmap' ? '' : 'hidden'}>
            <TrackMapView
              track={meta?.track} driverMeta={driverMeta}
              driverPositions={driverPositions} events={visibleEvents}
              onEventClick={focusEvent}
            />
          </div>
          <div className={tab === 'session' ? '' : 'hidden'}>
            <SessionView driverMeta={driverMeta} sessionRef={sessionRef}
                         onPickLap={handlePickLap} />
          </div>
          <div className={tab === 'history' ? '' : 'hidden'}>
            <HistoryView onLoadHistory={handleLoadHistory} />
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

      {hoverProfile && (
        <ProfileOverlay
          driver={hoverProfile.code}
          color={driverMeta[hoverProfile.code]?.color || '#888'}
          sessionRef={sessionRef}
          anchorRect={hoverProfile.rect}
          onMouseEnter={overlayEnter}
          onMouseLeave={chipLeave}
        />
      )}
    </div>
  );
}

function ExportMenu() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="export-menu">
      <button className="export-btn" onClick={() => setOpen((o) => !o)}>
        ⬇ Export
      </button>
      {open && (
        <>
          <div className="export-backdrop" onClick={() => setOpen(false)} />
          <div className="export-overlay">
            <p className="export-label">Export as</p>
            <a className="export-option" href="/api/export/csv"
               onClick={() => setOpen(false)}>
              CSV <span>telemetry + events as ZIP</span>
            </a>
            <a className="export-option" href="/api/export/pdf"
               onClick={() => setOpen(false)}>
              PDF <span>multi-page lap report</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}