// The Telemetry tab. Two display modes, toggled top-right:
//   STACKED   - every channel visible at once (F1TV default style)
//   SEPARATE  - one channel at a time, picked from the channel tab strip
// Both modes share the same zoom domain, controlled by the minimap below
// and Ctrl+wheel over the chart area.
import { useRef, useState } from 'react';
import TelemetryCharts, { CHART_DEFS } from './TelemetryCharts';
import Minimap, { wheelZoom } from './Minimap';

export default function TelemetryView({ points, driverMeta, events,
                                        onEventClick, domain, setDomain,
                                        fullRange }) {
  const [mode, setMode] = useState('stacked');
  const [channel, setChannel] = useState('speed');
  const areaRef = useRef(null);

  if (!points.length) {
    return (
      <div className="empty">
        <p>Start a replay (or go live) from the control panel to see
        telemetry here.</p>
      </div>
    );
  }

  return (
    <div className="telemetry-view"
         ref={areaRef}
         onWheel={(e) =>
           wheelZoom(e, domain, fullRange, setDomain, areaRef.current)}>
      <div className="telemetry-toolbar">
        <div className="channel-tabs">
          {mode === 'separate' && CHART_DEFS.map((d) => (
            <button key={d.key}
                    className={`chan-tab ${channel === d.key ? 'on' : ''}`}
                    onClick={() => setChannel(d.key)}>
              {d.key.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="mode-toggle">
          <button className={mode === 'stacked' ? 'on' : ''}
                  onClick={() => setMode('stacked')}>STACKED</button>
          <button className={mode === 'separate' ? 'on' : ''}
                  onClick={() => setMode('separate')}>SEPARATE</button>
        </div>
      </div>

      <TelemetryCharts
        data={points}
        driverMeta={driverMeta}
        events={events}
        onEventClick={onEventClick}
        domain={domain}
        channels={mode === 'separate' ? [channel] : null}
        tall={mode === 'separate'}
      />

      <Minimap
        points={points}
        fullRange={fullRange}
        domain={domain}
        onDomain={setDomain}
        driverMeta={driverMeta}
      />
      <p className="hint zoom-hint">Ctrl + scroll to zoom · drag the window
      to pan · drag its edges to resize</p>
    </div>
  );
}
