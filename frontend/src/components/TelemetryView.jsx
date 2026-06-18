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
import { EmptyState, ChartSkeleton } from './EmptyState';

export default function TelemetryView({ points, driverMeta, events,
                                        onEventClick, domain, setDomain,
                                        fullRange, hasBaseline = true,
                                        focusedEvent = null,
                                        playhead = 0, onSeek,
                                        sectorDistances = null,
                                        running = false }) {
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
    return running
      ? <ChartSkeleton rows={1} />
      : (
        <EmptyState icon="chart"
          title="No telemetry yet"
          hint="Pick a session and drivers in the control panel, then start a replay to see synchronized telemetry here." />
      );
  }

  const drivers = Object.keys(driverMeta);
  const def = CHART_DEFS.find((d) => d.key === channel);

  // if every selected driver is on the same team, surface that team's colour
  // on the active channel tab (else leave it the default white underline)
  const sharedTeamColor = (() => {
    const metas = Object.values(driverMeta);
    if (metas.length < 1) return null;
    const teams = new Set(metas.map((m) => m?.team).filter(Boolean));
    return teams.size === 1 ? (metas[0]?.color || null) : null;
  })();

  return (
    <div className="telemetry-view" ref={areaRef}>
      <div className="telemetry-toolbar">
        <div className="channel-tabs">
          {CHART_DEFS.filter((d) => hasBaseline || !d.needsBaseline)
                     .map((d) => (
            <button key={d.key}
                    className={`chan-tab ${channel === d.key ? 'on' : ''}`}
                    style={channel === d.key && sharedTeamColor
                      ? { borderBottomColor: sharedTeamColor } : undefined}
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
          channels={[channel]} tall focusedEvent={focusedEvent}
          sectorDistances={sectorDistances}
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
              focusedEvent={focusedEvent}
              sectorDistances={sectorDistances}
            />
          </div>
        ))
      )}

      <Minimap
        points={points} fullRange={fullRange}
        domain={domain} onDomain={setDomain} driverMeta={driverMeta}
        playhead={playhead} onSeek={onSeek}
      />
      <p className="hint zoom-hint">Ctrl + scroll to zoom · drag the window
      to pan · drag its edges to resize</p>
    </div>
  );
}
