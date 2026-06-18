// Distance-synchronized charts (Recharts, syncId="dist").
// Phase 2: charts render only the zoom window (data sliced by domain) and a
// channel filter supports the stacked-vs-separate toggle in TelemetryView.
import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceArea, ReferenceLine, CartesianGrid,
} from 'recharts';

export const CHART_DEFS = [
  { key: 'speed', label: 'SPEED · km/h', height: 210 },
  { key: 'throttle', label: 'THROTTLE · %', height: 120 },
  { key: 'brake', label: 'BRAKE · %', height: 120 },
  { key: 'rpm', label: 'RPM', height: 120 },
  { key: 'gear', label: 'GEAR', height: 100, step: true },
  { key: 'drs', label: 'DRS', height: 80, step: true },
  { key: 'delta', label: 'DELTA · s vs baseline', height: 210,
    needsBaseline: true },
];

export default function TelemetryCharts({ data, driverMeta, events,
                                          onEventClick, domain, channels,
                                          tall = false, focusedEvent = null,
                                          sectorDistances = null }) {
  const drivers = Object.keys(driverMeta);

  const sectorLines = useMemo(() => {
    if (!sectorDistances) return [];
    const out = [];
    // S3 boundary = start/finish line at distance 0
    out.push({ x: 0, label: 'S3', color: '#36d1ff' });
    if (sectorDistances.s1_end != null)
      out.push({ x: sectorDistances.s1_end, label: 'S1', color: '#ff7a1a' });
    if (sectorDistances.s2_end != null)
      out.push({ x: sectorDistances.s2_end, label: 'S2', color: '#ffd21a' });
    return out;
  }, [sectorDistances]);

  const windowed = useMemo(() => {
    if (!domain) return data;
    const [a, b] = domain;
    return data.filter((p) => p.distance >= a && p.distance <= b);
  }, [data, domain]);

  if (!windowed.length) return null;
  const defs = CHART_DEFS.filter((d) => !channels || channels.includes(d.key));

  return (
    <div className="charts">
      {defs.map((def) => (
        <div className="chart-block" key={def.key}>
          <div className="chart-label">{def.label}</div>
          <ResponsiveContainer width="100%"
                               height={tall ? 360 : def.height}>
            <LineChart data={windowed} syncId="dist"
                       margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" />
              <XAxis dataKey="distance" type="number"
                     domain={['dataMin', 'dataMax']}
                     tickFormatter={(v) => `${Math.round(v)}m`}
                     stroke="var(--axis)" fontSize={10} />
              <YAxis stroke="var(--axis)" fontSize={10} width={44}
                     domain={['auto', 'auto']}
                     tickFormatter={def.key === 'delta'
                       ? (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` : undefined} />
              {def.key === 'delta' && (
                <ReferenceLine y={0} stroke="var(--text)"
                               strokeDasharray="6 4" strokeOpacity={0.55} />
              )}
              <Tooltip content={<SwatchTooltip driverMeta={driverMeta}
                                               channelKey={def.key} />} />

              {events.map((ev, i) => {
                const isFocused = focusedEvent
                  && ev.driver === focusedEvent.driver
                  && ev.start_distance === focusedEvent.start_distance;
                return (
                  <ReferenceArea key={i}
                    x1={Math.max(ev.start_distance, windowed[0].distance)}
                    x2={Math.min(ev.end_distance,
                                 windowed[windowed.length - 1].distance)}
                    fill={driverMeta[ev.driver]?.color || '#ff4444'}
                    fillOpacity={isFocused ? 0.38 : 0.15}
                    stroke={driverMeta[ev.driver]?.color || '#ff4444'}
                    strokeOpacity={isFocused ? 1 : 0.5}
                    strokeWidth={isFocused ? 2 : 1}
                    onClick={() => onEventClick(ev)}
                    style={{ cursor: 'pointer' }} />
                );
              })}

              {/* sector boundary lines (S1/S2 ends; S3 = start/finish) */}
              {sectorLines.map((sl) => (
                <ReferenceLine key={sl.label} x={sl.x}
                  stroke={sl.color} strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  label={{ value: sl.label, position: 'top',
                           fontSize: 9, fill: sl.color }} />
              ))}

              {drivers.map((drv) => (
                <Line key={`b-${drv}`} dataKey={`base_${drv}_${def.key}`}
                      name={`${drv} base`}
                      stroke={driverMeta[drv].color} strokeWidth={1}
                      strokeDasharray="5 4" strokeOpacity={0.4}
                      dot={false} isAnimationActive={false}
                      type={def.step ? 'stepAfter' : 'monotone'} />
              ))}
              {drivers.map((drv) => (
                <Line key={drv} dataKey={`${drv}_${def.key}`} name={drv}
                      stroke={driverMeta[drv].color} strokeWidth={1.8}
                      dot={false} isAnimationActive={false}
                      type={def.step ? 'stepAfter' : 'monotone'} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}

// tooltip with a team-colour swatch beside each driver's name
function SwatchTooltip({ active, payload, label, driverMeta, channelKey }) {
  if (!active || !payload?.length) return null;
  const fmt = (v) => typeof v !== 'number' ? v
    : channelKey === 'delta'
      ? `${v > 0 ? '+' : ''}${v.toFixed(3)} s`
      : v.toFixed(1);
  // map each payload row back to its driver code (dataKey like "VER_speed"
  // or "base_VER_speed")
  const rows = payload.map((p) => {
    const key = p.dataKey || '';
    const m = key.match(/^(?:base_)?([A-Z0-9]{2,4})_/);
    const drv = m ? m[1] : p.name;
    const isBase = key.startsWith('base_');
    return { drv, isBase, value: p.value,
             color: driverMeta[drv]?.color || p.color || '#888' };
  });
  return (
    <div className="chart-tooltip">
      <div className="ct-label">{Math.round(label)} m</div>
      {rows.map((r, i) => (
        <div key={i} className="ct-row">
          <span className="ct-swatch" style={{ background: r.color }} />
          <span className="ct-name">{r.drv}{r.isBase ? ' base' : ''}</span>
          <span className="ct-value">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
