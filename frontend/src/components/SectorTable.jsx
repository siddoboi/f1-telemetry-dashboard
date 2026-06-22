// Sector timing comparison table (broadcast-style).
// One row per driver: S1 | S2 | S3 | LAP. Colour states per cell:
//   purple  = fastest in that sector across all selected drivers (session best
//             proxy within this comparison)
//   green   = faster than the baseline driver in that sector
//   red     = slower than the baseline driver
//   neutral = the baseline driver's own cells
// Values are IBM Plex Mono; headers are Titillium uppercase.
import { useMemo } from 'react';

const SECTORS = ['s1', 's2', 's3'];
const HEADERS = { s1: 'SECTOR 1', s2: 'SECTOR 2', s3: 'SECTOR 3' };

function fmt(v) {
  if (v == null) return '-';
  return v.toFixed(3);
}
function fmtLap(v) {
  if (v == null) return '-';
  const m = Math.floor(v / 60);
  const s = (v % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

export default function SectorTable({ driverMeta, sectorTimes,
                                      baselineOwner }) {
  // sectorTimes: { driverCode: {s1,s2,s3, s1_fmt,...} }
  const drivers = Object.keys(sectorTimes || {});
  const analysis = useMemo(() => {
    if (!drivers.length) return null;
    // fastest per sector (for purple)
    const fastest = {};
    for (const s of SECTORS) {
      let best = null, bestDrv = null;
      for (const d of drivers) {
        const v = sectorTimes[d]?.[s];
        if (v != null && (best == null || v < best)) { best = v; bestDrv = d; }
      }
      fastest[s] = bestDrv;
    }
    // lap totals
    const laps = {};
    for (const d of drivers) {
      const st = sectorTimes[d];
      laps[d] = (st?.s1 != null && st?.s2 != null && st?.s3 != null)
        ? st.s1 + st.s2 + st.s3 : null;
    }
    return { fastest, laps };
  }, [sectorTimes, drivers]);

  if (!analysis) return null;

  const base = sectorTimes[baselineOwner] ? baselineOwner : drivers[0];

  const cellClass = (drv, s) => {
    const v = sectorTimes[drv]?.[s];
    if (v == null) return '';
    if (analysis.fastest[s] === drv) return 'sec-purple';
    if (drv === base) return '';
    const bv = sectorTimes[base]?.[s];
    if (bv == null) return '';
    return v < bv ? 'sec-green' : v > bv ? 'sec-red' : '';
  };

  const delta = (drv, s) => {
    if (drv === base) return null;
    const v = sectorTimes[drv]?.[s], bv = sectorTimes[base]?.[s];
    if (v == null || bv == null) return null;
    const d = v - bv;
    return `${d > 0 ? '+' : ''}${d.toFixed(3)}`;
  };

  return (
    <div className="sector-table">
      <table>
        <thead>
          <tr>
            <th className="st-driver" />
            {SECTORS.map((s) => <th key={s}>{HEADERS[s]}</th>)}
            <th>LAP TIME</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((drv) => (
            <tr key={drv}>
              <td className="st-driver"
                  style={{ '--team': driverMeta[drv]?.color || '#888' }}>
                <span className="st-stripe" />{drv}
              </td>
              {SECTORS.map((s) => (
                <td key={s} className={`st-cell ${cellClass(drv, s)}`}>
                  <span className="st-time">{fmt(sectorTimes[drv]?.[s])}</span>
                  {delta(drv, s) && (
                    <span className="st-delta">{delta(drv, s)}</span>
                  )}
                </td>
              ))}
              <td className="st-cell st-lap">
                {fmtLap(analysis.laps[drv])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
