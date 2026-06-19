// App: owns replay/live state, the shared zoom domain, the tab router, the
// hover profile overlay, and lap re-picking from the Session view.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReplayClient } from './api/client';
import NavBar from './components/NavBar';
import ControlPanel from './components/ControlPanel';
import TelemetryView from './components/TelemetryView';
import TrackMapView from './components/TrackMapView';
import SectorTable from './components/SectorTable';
import ConditionsView from './components/ConditionsView';
import HomeView from './components/HomeView';
import AboutView from './components/AboutView';
import SessionView from './components/SessionView';
import HistoryView from './components/HistoryView';
import AnomalySidebar from './components/AnomalySidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ProfileOverlay from './components/ProfileOverlay';

const CHANNELS = ['speed', 'throttle', 'brake', 'rpm', 'gear', 'drs', 'delta'];
const HOVER_SHOW_MS = 350;
const HOVER_HIDE_MS = 200;

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

export default function App() {
  const [tab, setTab] = useState('home');
  const [status, setStatus] = useState('');
  const [statusDismissed, setStatusDismissed] = useState(false);
  const [meta, setMeta] = useState(null);
  const [points, setPoints] = useState([]);
  // Smoothly-interpolated values the views actually render. These ease toward
  // the latest WS frame target at the screen's native refresh rate via rAF,
  // so motion is 60/120/144 fps smooth even though data arrives at 30 Hz.
  const [smoothPositions, setSmoothPositions] = useState({});
  const [smoothDistance, setSmoothDistance] = useState(0);
  // interpolation bookkeeping
  const interpRef = useRef({
    prev: {},          // {drv: {distance,x,y}} at last frame
    next: {},          // {drv: {distance,x,y}} at current target
    prevDist: 0,
    nextDist: 0,
    tPrev: 0,          // performance.now() when target was set
    frameGapMs: 1000 / 30,   // expected ms between WS frames (updated live)
    seeking: false,    // during a seek_fill burst, snap instead of ease
  });
  const rafRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);  // lap finished playing
  const [paused, setPaused] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusedEvent, setFocusedEvent] = useState(null);
  const [visibleDistance, setVisibleDistance] = useState(0);
  const [driverPositions, setDriverPositions] = useState({});
  const [domain, setDomain] = useState(null);     // null = follow full lap
  const [sessionRef, setSessionRef] = useState(null);
  const [hoverProfile, setHoverProfile] = useState(null); // {code, rect}
  const [panelCollapsed, setPanelCollapsed] = useState(
    () => localStorage.getItem('pitwall.panelCollapsed') === '1');
  const clientRef = useRef(null);
  const bufferRef = useRef([]);
  const scrubbingRef = useRef(false);   // true while the user drags the playhead
  const pausedRef = useRef(false);       // mirror of `paused` for rAF closures
  useEffect(() => { pausedRef.current = paused; }, [paused]);
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
    return (meta?.events || [])
      .filter((e) => e.start_distance <= visibleDistance);
  }, [meta, visibleDistance]);

  // sector times per driver, pulled from meta.drivers[*].sector_times
  const sectorTimes = useMemo(() => {
    if (!meta?.drivers) return null;
    const out = {};
    let any = false;
    for (const [drv, info] of Object.entries(meta.drivers)) {
      if (info.sector_times) { out[drv] = info.sector_times; any = true; }
    }
    return any ? out : null;
  }, [meta]);

  const flush = () => {
    const buffered = bufferRef.current;
    if (!buffered.length) return;
    bufferRef.current = [];
    setPoints((prev) => {
      let next = [...prev];
      for (const frame of buffered) {
        {
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
    // While the user is scrubbing the playhead, keep ingesting frame data
    // into `points` (above) but DON'T move the cursor/positions — the drag
    // owns the playhead position until release.
    if (scrubbingRef.current) return;

    const targetDist = Math.max(0,
      ...Object.values(pos).map((p) => p.distance));

    // hand the new target to the interpolation loop. seek_fill frames arrive
    // in a burst with no real-time pacing, so snap straight to them.
    const it = interpRef.current;
    const now = performance.now();
    const isSeek = last.type === 'seek_fill';
    it.prev = isSeek ? pos : (it.next && Object.keys(it.next).length
                              ? it.next : pos);
    it.prevDist = isSeek ? targetDist : it.nextDist || targetDist;
    it.next = pos;
    it.nextDist = targetDist;
    it.tPrev = now;
    it.seeking = isSeek;

    // keep the raw values too (events filter, history, etc. use these)
    setDriverPositions(pos);
    setVisibleDistance(targetDist);
  };

  // ── interpolation loop: eases smoothPositions / smoothDistance toward the
  //    latest frame target at the display's refresh rate ───────────────────
  useEffect(() => {
    const step = () => {
      const it = interpRef.current;
      const drivers = Object.keys(it.next);
      if (drivers.length) {
        let t = it.seeking ? 1
          : Math.min(1, (performance.now() - it.tPrev) / it.frameGapMs);
        // ease-out for a touch of smoothness without lag
        const e = t;
        const out = {};
        for (const drv of drivers) {
          const a = it.prev[drv] || it.next[drv];
          const b = it.next[drv];
          out[drv] = {
            distance: a.distance + (b.distance - a.distance) * e,
            x: a.x != null && b.x != null ? a.x + (b.x - a.x) * e : b.x,
            y: a.y != null && b.y != null ? a.y + (b.y - a.y) * e : b.y,
          };
        }
        setSmoothPositions(out);
        setSmoothDistance(it.prevDist + (it.nextDist - it.prevDist) * e);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const makeClient = (isLive) => new ReplayClient({
    onStatus: (m) => { setStatus(m.message); setStatusDismissed(false); },
    onError: (m) => { setStatus(`Error: ${m.message}`);
                      setStatusDismissed(false); setRunning(false); },
    onComplete: () => { flush(); setStatus('Replay complete.');
                        setStatusDismissed(false);
                        setRunning(false); setPaused(false);
                        setCompleted(true); },
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
      // track the real gap between paced frames so interpolation eases over
      // the actual arrival interval (handles speed multiplier changes too)
      const it = interpRef.current;
      const now = performance.now();
      if (frame.type !== 'seek_fill' && it._lastArrival) {
        const gap = now - it._lastArrival;
        if (gap > 5 && gap < 2000) {
          it.frameGapMs = it.frameGapMs * 0.8 + gap * 0.2;  // smoothed
        }
      }
      it._lastArrival = now;
      bufferRef.current.push(frame);
      if (bufferRef.current.length >= 2) flush();
    },
  });

  const handleStart = (request) => {
    setStatus('Connecting...');
    reset();
    lastRequestRef.current = request;
    setSessionRef({ year: request.year, round: request.round,
                    session: request.session });
    const client = makeClient(false);
    client.start(request);
    clientRef.current = client;
  };


  // HISTORY tab: replay saved laps straight from MongoDB (no FastF1)
  const handleLoadHistory = (laps) => {
    setStatus('Loading saved laps...');
    reset();
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

  const reset = () => {
    clientRef.current?.stop();
    if (localReplayRef.current) {
      cancelAnimationFrame(localReplayRef.current);
      localReplayRef.current = null;
    }
    setMeta(null); setPoints([]); setRunning(true); setPaused(false);
    setCompleted(false);
    setVisibleDistance(0); setDriverPositions({});
    setSmoothPositions({}); setSmoothDistance(0);
    interpRef.current = { prev: {}, next: {}, prevDist: 0, nextDist: 0,
                          tPrev: 0, frameGapMs: 1000 / 30, seeking: false };
    bufferRef.current = []; scrubbingRef.current = false;
    setFocusedEvent(null); setDomain(null);
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

  // Seek: backward = frontend-only cursor move (data already buffered);
  // forward = ask the backend to fast-emit the skipped frames.
  // Replay the ALREADY-BUFFERED lap locally from a given distance with no
  // backend fetch. Paces from the stored time_s column (1x real time) and
  // feeds the same cursor/position/interpolation pipeline as a live replay.
  const localReplayRef = useRef(null);
  const replayFrom = (startDist = 0) => {
    if (!points.length) return;
    if (localReplayRef.current) cancelAnimationFrame(localReplayRef.current);
    setCompleted(false); setRunning(true); setPaused(false);
    setStatus(''); setStatusDismissed(false);

    const drivers = Object.keys(driverMeta);
    // find the frame index at/after the start distance
    let startIdx = points.findIndex((p) => (p.distance ?? 0) >= startDist);
    if (startIdx < 0) startIdx = 0;
    const tStart = points[startIdx]?.time_s ?? 0;
    const startWall = performance.now();
    let i = startIdx;

    const tick = () => {
      if (pausedRef.current) {
        localReplayRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = (performance.now() - startWall) / 1000;  // 1x seconds
      while (i < points.length - 1) {
        const ts = points[i + 1]?.time_s ?? null;
        if (ts == null || (ts - tStart) <= elapsed) i++;
        else break;
      }
      const row = points[i];
      const d = row?.distance ?? 0;
      const pos = {};
      for (const drv of drivers) {
        pos[drv] = { distance: d,
                     x: row?.[`${drv}_x`] ?? null,
                     y: row?.[`${drv}_y`] ?? null };
      }
      setDriverPositions(pos);
      setVisibleDistance(d);
      const it = interpRef.current;
      it.prev = it.next && Object.keys(it.next).length ? it.next : pos;
      it.prevDist = it.nextDist || d;
      it.next = pos; it.nextDist = d;
      it.tPrev = performance.now(); it.seeking = false;

      if (i >= points.length - 1) {
        setRunning(false); setCompleted(true);
        setStatus('Replay complete.');
        localReplayRef.current = null;
        return;
      }
      localReplayRef.current = requestAnimationFrame(tick);
    };
    localReplayRef.current = requestAnimationFrame(tick);
  };
  const replayFromStart = () => replayFrom(0);

  // Pause the engine the instant a scrub starts, so live frames stop
  // overwriting the position the user is dragging to.
  const handleSeekStart = () => {
    if (running && !paused) {
      clientRef.current?.pause();
      setPaused(true);
    }
    scrubbingRef.current = true;
  };

  // Seek works entirely on the locally-buffered points (both directions),
  // so it's instant and never fights the backend. The engine stays paused.
  const handleSeek = (distance) => {
    const d = Math.max(fullRange[0], Math.min(fullRange[1], distance));
    setVisibleDistance(d);
    const pos = {};
    const idx = points.findIndex((p) => p.distance >= d);
    const row = points[idx < 0 ? points.length - 1 : idx];
    for (const drv of Object.keys(driverMeta)) {
      pos[drv] = { distance: d,
                   x: row?.[`${drv}_x`] ?? null,
                   y: row?.[`${drv}_y`] ?? null };
    }
    setDriverPositions(pos);
    const it = interpRef.current;
    it.prev = pos; it.next = pos; it.prevDist = d; it.nextDist = d;
    it.seeking = true;
    setSmoothPositions(pos); setSmoothDistance(d);
  };

  // On release: stay put at the scrubbed position (paused). The user resumes
  // explicitly. During a live replay we re-sync the backend engine's cursor to
  // the drop point so Resume continues from here. After completion the whole
  // lap is buffered, so Resume/Replay use the local player instead.
  const handleSeekEnd = (distance) => {
    const d = Math.max(fullRange[0], Math.min(fullRange[1], distance));
    scrubbingRef.current = false;
    if (!completed) clientRef.current?.seek(d);
  };

  const focusEvent = (ev) => { setFocusedEvent(ev); setSidebarOpen(true); };

  return (
    <div className="app">
      <NavBar tab={tab} onTab={setTab} />
      <div className={`layout ${panelCollapsed ? 'panel-collapsed' : ''} `
                    + `${tab === 'home' ? 'home-mode' : ''}`}>
        {tab !== 'home' && (
        <ControlPanel
          onStart={handleStart}
          onPause={() => { clientRef.current?.pause(); setPaused(true); }}
          onResume={() => { clientRef.current?.resume(); setPaused(false); }}
          onSpeed={(x) => clientRef.current?.setSpeed(x)}
          onReplayStart={replayFromStart}
          running={running} paused={paused} completed={completed}
          collapsed={panelCollapsed} onCollapsedChange={setPanelCollapsed}
        />
        )}

        <main className="main">
          {tab === 'home' && (
            <ErrorBoundary name="Home">
              <HomeView onStart={() => setTab('telemetry')}
                        onAbout={() => setTab('about')} />
            </ErrorBoundary>
          )}
          {meta && tab !== 'home' && (
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
            </header>
          )}

          {status && !statusDismissed && (
            <div className="status-bar">
              <span>{status}</span>
              <button className="status-dismiss"
                      onClick={() => setStatusDismissed(true)}
                      aria-label="Dismiss">×</button>
            </div>
          )}

          <div className={tab === 'telemetry' ? '' : 'hidden'}>
            <ErrorBoundary name="Telemetry">
            <TelemetryView
              points={points} driverMeta={driverMeta}
              events={visibleEvents} onEventClick={focusEvent}
              focusedEvent={focusedEvent}
              playhead={smoothDistance || visibleDistance} onSeek={handleSeek}
              onSeekStart={handleSeekStart} onSeekEnd={handleSeekEnd}
              domain={effDomain} setDomain={handleSetDomain}
              fullRange={fullRange}
              hasBaseline={!!meta && meta.baseline_mode !== 'off'}
              sectorDistances={meta?.sector_distances || null}
              running={running && !points.length}
            />
            </ErrorBoundary>
          </div>
          <div className={tab === 'trackmap' ? '' : 'hidden'}>
            <ErrorBoundary name="Track Map">
            <TrackMapView
              track={meta?.track} driverMeta={driverMeta}
              driverPositions={
                Object.keys(smoothPositions).length
                  ? smoothPositions : driverPositions}
              events={visibleEvents}
              onEventClick={focusEvent} focusedEvent={focusedEvent}
              corners={meta?.corners || []}
              sectorDistances={meta?.sector_distances || null}
              preparing={running && !meta}
            />
            {meta && sectorTimes && (
              <SectorTable
                driverMeta={driverMeta}
                sectorTimes={sectorTimes}
                baselineOwner={meta.baseline_owner}
              />
            )}
            </ErrorBoundary>
          </div>
          <div className={tab === 'session' ? '' : 'hidden'}>
            <ErrorBoundary name="Session">
            <SessionView driverMeta={driverMeta} sessionRef={sessionRef}
                         onPickLap={handlePickLap} />
            </ErrorBoundary>
          </div>
          <div className={tab === 'conditions' ? '' : 'hidden'}>
            <ErrorBoundary name="Conditions">
            <ConditionsView
              year={sessionRef?.year}
              round={sessionRef?.round}
              session={sessionRef?.session}
              circuitLocation={meta?.circuit_location || null}
              panelCollapsed={panelCollapsed}
            />
            </ErrorBoundary>
          </div>
          <div className={tab === 'about' ? '' : 'hidden'}>
            <ErrorBoundary name="About">
            <AboutView />
            </ErrorBoundary>
          </div>
          <div className={tab === 'history' ? '' : 'hidden'}>
            <ErrorBoundary name="History">
            <HistoryView onLoadHistory={handleLoadHistory} />
            </ErrorBoundary>
          </div>
        </main>

        {tab !== 'home' && (
        <AnomalySidebar
          events={visibleEvents}
          validation={meta?.validation || {}}
          driverMeta={driverMeta}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          focused={focusedEvent}
          onEventClick={focusEvent}
        />
        )}
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
