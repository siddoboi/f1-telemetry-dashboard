// Stacked, distance-synchronized charts. All charts share syncId="dist" so a
// hover crosshair on one chart appears at the same distance on every chart -
// the signature interaction of the dashboard.
//
// Data model: one merged array of points keyed by distance. Each point holds
// `${drv}_speed`, `${drv}_throttle`, ... plus `base_${drv}_speed` etc. for
// baseline traces.
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceArea, CartesianGrid,
} from 'recharts';

const CHART_DEFS = [
  { key: 'speed', label: 'SPEED · km/h', height: 200 },
  { key: 'throttle', label: 'THROTTLE · %', height: 120 },
  { key: 'brake', label: 'BRAKE · %', height: 120 },
  { key: 'rpm', label: 'RPM', height: 120 },
  { key: 'gear', label: 'GEAR', height: 100, step: true },
];

export default function TelemetryCharts({ data, driverMeta, events,
                                          onEventClick }) {
  if (!data.length) return null;
  const drivers = Object.keys(driverMeta);

  return (
    <div className="charts">
      {CHART_DEFS.map((def) => (
        <div className="chart-block" key={def.key}>
          <div className="chart-label">{def.label}</div>
          <ResponsiveContainer width="100%" height={def.height}>
            <LineChart data={data} syncId="dist"
                       margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" />
              <XAxis
                dataKey="distance"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) => `${Math.round(v)}m`}
                stroke="var(--axis)"
                fontSize={10}
              />
              <YAxis stroke="var(--axis)" fontSize={10} width={42}
                     domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: 'var(--panel)',
                                border: '1px solid var(--grid)',
                                fontSize: 11 }}
                labelFormatter={(v) => `${Math.round(v)} m`}
                formatter={(value, name) =>
                  [typeof value === 'number' ? value.toFixed(1) : value, name]}
              />

              {/* Anomaly highlight bands (per driver, tinted by team color) */}
              {events.map((ev, i) => (
                <ReferenceArea
                  key={i}
                  x1={ev.start_distance}
                  x2={ev.end_distance}
                  fill={driverMeta[ev.driver]?.color || '#ff4444'}
                  fillOpacity={0.16}
                  stroke={driverMeta[ev.driver]?.color || '#ff4444'}
                  strokeOpacity={0.5}
                  onClick={() => onEventClick(ev)}
                  style={{ cursor: 'pointer' }}
                />
              ))}

              {/* Baseline traces: dashed, dimmed */}
              {drivers.map((drv) => (
                <Line key={`b-${drv}`} dataKey={`base_${drv}_${def.key}`}
                      name={`${drv} baseline`}
                      stroke={driverMeta[drv].color} strokeWidth={1}
                      strokeDasharray="5 4" strokeOpacity={0.45}
                      dot={false} isAnimationActive={false}
                      type={def.step ? 'stepAfter' : 'monotone'} />
              ))}

              {/* Live comparison traces: solid, bright */}
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
