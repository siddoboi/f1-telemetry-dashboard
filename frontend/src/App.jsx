// App: owns replay state and merges per-driver frames into the single
// distance-keyed array that the synchronized charts consume.
import { useMemo, useRef, useState } from 'react';
import { ReplayClient } from './api/client';
import ControlPanel from './components/ControlPanel';
import TelemetryCharts from './components/TelemetryCharts';
import AnomalySidebar from './components/AnomalySidebar';

const CHANNELS = ['speed', 'throttle', 'brake', 'rpm', 'gear'];

export default function App() {
  const [status, setStatus] = useState('');
  const [meta, setMeta] = useState(null);
  const [points, setPoints] = useState([]);       // merged chart data
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusedEvent, setFocusedEvent] = useState(null);
  const [visibleDistance, setVisibleDistance] = useState(0);
  const clientRef = useRef(null);
  const bufferRef = useRef([]);                    // frame buffer between renders

  const driverMeta = useMemo(() => {
    if (!meta) return {};
    const out = {};
    for (const [drv, info] of Object.entries(meta.drivers)) {
      out[drv] = { color: info.meta.color || '#888888', ...info.meta };
    }
    return out;
  }, [meta]);

  // Only show anomaly events whose region the replay has already reached
  const visibleEvents = useMemo(
    () => (meta?.events || []).filter((e) => e.start_distance <= visibleDistance),
    [meta, visibleDistance],
  );

  const handleStart = (request) => {
    setStatus('Connecting...');
    setMeta(null); setPoints([]); setRunning(true); setPaused(false);
    setVisibleDistance(0); bufferRef.current = [];

    const client = new ReplayClient({
      onStatus: (m) => setStatus(m.message),
      onError: (m) => { setStatus(`Error: ${m.message}`); setRunning(false); },
      onComplete: () => { flush(); setStatus('Replay complete.'); },
      onMeta: (m) => {
        setMeta(m);
        setStatus('');
        // Pre-build full point array with baseline values; live values fill in.
        const first = Object.values(m.drivers)[0];
        const base = [];
        const dist = first.baseline.distance;
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
      },
      onFrame: (frame) => {
        bufferRef.current.push(frame);
        // Batch state updates: apply buffered frames ~5x/sec to keep React fast
        if (bufferRef.current.length >= 2) flush();
      },
    });

    const flush = () => {
      const buffered = bufferRef.current;
      if (!buffered.length) return;
      bufferRef.current = [];
      setPoints((prev) => {
        const next = [...prev];
        for (const frame of buffered) {
          const i = frame.index;
          if (i >= next.length) continue;
          const p = { ...next[i] };
          for (const [drv, vals] of Object.entries(frame.drivers)) {
            for (const ch of CHANNELS) p[`${drv}_${ch}`] = vals[ch];
            p[`${drv}_anomaly`] = vals.anomaly_score;
          }
          next[i] = p;
        }
        return next;
      });
      const last = buffered[buffered.length - 1];
      const dists = Object.values(last.drivers).map((v) => v.distance ?? 0);
      setVisibleDistance(Math.max(...dists));
    };

    client.start(request);
    clientRef.current = client;
  };

  return (
    <div className="layout">
      <ControlPanel
        onStart={handleStart}
        onPause={() => { clientRef.current?.pause(); setPaused(true); }}
        onResume={() => { clientRef.current?.resume(); setPaused(false); }}
        onSpeed={(x) => clientRef.current?.setSpeed(x)}
        running={running}
        paused={paused}
      />

      <main className="main">
        {meta && (
          <header className="lap-header">
            {Object.entries(meta.drivers).map(([drv, info]) => (
              <div className="lap-card" key={drv}
                   style={{ '--team': info.meta.color }}>
                <span className="lap-drv">{drv}</span>
                <span>Lap {info.lap_number} · {info.lap_time}</span>
                <span className="lap-base">
                  vs {info.baseline_driver} {info.baseline_lap_time}
                  {meta.baseline_mode === 'personal_best'
                    ? ' (PB)' : ' (session optimal)'}
                </span>
              </div>
            ))}
          </header>
        )}

        {status && <div className="status-bar">{status}</div>}

        {points.length > 0 ? (
          <TelemetryCharts
            data={points}
            driverMeta={driverMeta}
            events={visibleEvents}
            onEventClick={(ev) => { setFocusedEvent(ev); setSidebarOpen(true); }}
          />
        ) : !status && (
          <div className="empty">
            <p>Select a season, event, session and up to two drivers,
            then start the replay.</p>
            <p className="hint">First load of a session downloads telemetry
            from the F1 servers and may take a few minutes. It is cached
            afterwards.</p>
          </div>
        )}
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
  );
}
