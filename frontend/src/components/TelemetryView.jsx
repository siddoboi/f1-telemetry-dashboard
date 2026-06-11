// The Telemetry tab.
// - Channel tabs (SPEED..DRS) always show ONE channel at a time.
// - The STACKED / SEPARATE toggle controls DRIVERS:
//     STACKED  - all drivers overlaid on one chart
//     SEPARATE - one chart per driver, stacked vertically (baseline included)
// - Ctrl+wheel zooms the distance window (non-passive listener so the
//   browser page never zooms); minimap pans/resizes the window.
import { useEffect, useRef, useState } from 'react';
import TelemetryCharts, { CHART_DEFS } from './TelemetryCharts';
import Minimap, { wheelZoom } from './Minimap';

export default function TelemetryView({ points, driverMeta, events,
                                        onEventClick, domain, setDomain,
                                        fullRange }) {
  const [driverMode, setDriverMode] = useState('stacked');
  const [channel, setChannel] = useState('speed');
  const areaRef = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { domain, fullRange, setDomain };

  // Non-passive wheel listener: preventDefault() actually works, so
  // Ctrl+scroll zooms the timeline and never the browser page.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const handler = (e) => {
      const { domain, fullRange, setDomain } = stateRef.current;
      wheelZoom(e, domain, fullRange, setDomain, el);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  if (!points.length) {
    return (
      <div className="empty">
        <p>Start a replay (or go live) from the control panel to see
        telemetry here.</p>
      </div>
    );
  }

  const drivers = Object.keys(driverMeta);
  const def = CHART_DEFS.find((d) => d.key === channel);

  return (
    <div className="telemetry-view" ref={areaRef}>
      <div className="telemetry-toolbar">
        <div className="channel-tabs">
          {CHART_DEFS.map((d) => (
            <button key={d.key}
                    className={`chan-tab ${channel === d.key ? 'on' : ''}`}
                    onClick={() => setChannel(d.key)}>
              {d.key.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="mode-toggle" title="Driver display">
          <button className={driverMode === 'stacked' ? 'on' : ''}
                  onClick={() => setDriverMode('stacked')}>STACKED</button>
          <button className={driverMode === 'separate' ? 'on' : ''}
                  onClick={() => setDriverMode('separate')}>SEPARATE</button>
        </div>
      </div>

      {driverMode === 'stacked' ? (
        <TelemetryCharts
          data={points} driverMeta={driverMeta} events={events}
          onEventClick={onEventClick} domain={domain}
          channels={[channel]} tall
        />
      ) : (
        drivers.map((drv) => (
          <div key={drv} className="driver-chart-block">
            <div className="driver-chart-label"
                 style={{ '--team': driverMeta[drv].color }}>{drv}</div>
            <TelemetryCharts
              data={points}
              driverMeta={{ [drv]: driverMeta[drv] }}
              events={events.filter((e) => e.driver === drv)}
              onEventClick={onEventClick} domain={domain}
              channels={[channel]}
              tall={drivers.length === 1}
            />
          </div>
        ))
      )}

      <Minimap
        points={points} fullRange={fullRange}
        domain={domain} onDomain={setDomain} driverMeta={driverMeta}
      />
      <p className="hint zoom-hint">Ctrl + scroll to zoom · drag the window
      to pan · drag its edges to resize</p>
    </div>
  );
}
