// CONDITIONS tab - historical track weather (Open-Meteo) + circuit map.
// Map uses Leaflet + OpenStreetMap tiles (no token/account required), loaded
// from CDN on demand. Weather timeline offers HOURLY (raw) or 15 MIN
// (cubic-interpolated, clearly labelled) resolution.
import { useEffect, useMemo, useRef, useState } from 'react';

const ICONS = {
  sun: '☀', 'cloud-sun': '⛅', cloud: '☁', fog: '🌫', drizzle: '🌦',
  rain: '🌧', snow: '❄', storm: '⛈',
};

export default function ConditionsView({ year, round, session }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');   // idle|loading|ok|error
  const [res, setRes] = useState('hourly');        // 'hourly' | '15min'
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  // fetch weather when a session is identified
  useEffect(() => {
    if (year == null || round == null || !session) { setData(null); return; }
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/weather/${year}/${round}/${session}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.available) { setData(d); setStatus('ok'); }
        else { setData(d); setStatus('error'); }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [year, round, session]);

  // lazy-load Leaflet from CDN and render the circuit location
  useEffect(() => {
    const loc = data?.location;
    if (!loc?.latitude || !mapRef.current) return;

    const ensureLeaflet = () => new Promise((resolve) => {
      if (window.L) return resolve(window.L);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = () => resolve(window.L);
      document.head.appendChild(js);
    });

    let map;
    ensureLeaflet().then((L) => {
      if (!mapRef.current) return;
      if (mapInstance.current) { mapInstance.current.remove(); }
      map = L.map(mapRef.current, {
        center: [loc.latitude, loc.longitude], zoom: 14,
        zoomControl: true, attributionControl: true,
        scrollWheelZoom: false,
      });
      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 18,
          attribution: '© OpenStreetMap contributors' }).addTo(map);
      L.circleMarker([loc.latitude, loc.longitude],
        { radius: 8, color: '#ff1e1e', fillColor: '#ff1e1e',
          fillOpacity: 0.7 }).addTo(map)
        .bindPopup(`${loc.event_name || loc.circuit}`);
      mapInstance.current = map;
    });

    return () => { if (mapInstance.current) {
      mapInstance.current.remove(); mapInstance.current = null; } };
  }, [data]);

  const series = useMemo(() => {
    const hourly = data?.hourly || [];
    if (res === 'hourly' || hourly.length < 2) return hourly;
    return interpolateQuarterHour(hourly);
  }, [data, res]);

  // representative "current" reading = midday or middle of the series
  const summary = useMemo(() => {
    const h = data?.hourly || [];
    if (!h.length) return null;
    return h[Math.floor(h.length / 2)];
  }, [data]);

  if (year == null) {
    return (
      <div className="empty">
        <p>Load a session to see track conditions.</p>
        <p className="hint">Historical weather is fetched for the circuit
        location and session date from Open-Meteo.</p>
      </div>
    );
  }
  if (status === 'loading')
    return <div className="empty"><p>Loading track conditions…</p></div>;
  if (status === 'error' || !data?.available) {
    return (
      <div className="empty">
        <p>Weather data isn't available for this session.</p>
        <p className="hint">
          {data?.location?.circuit
            ? `No coordinates on file for ${data.location.circuit}.`
            : 'Could not resolve the circuit location or date.'}
        </p>
      </div>
    );
  }

  const loc = data.location;

  return (
    <div className="conditions-view">
      <div className="cond-header">
        <div>
          <h2>{loc.event_name || loc.circuit}</h2>
          <p className="hint">{loc.circuit}{loc.country ? `, ${loc.country}` : ''}
            {' · '}{data.date}</p>
        </div>
        {summary?.weather && (
          <div className="cond-now">
            <span className="cond-icon">
              {ICONS[summary.weather.icon] || '☁'}</span>
            <span className="cond-now-label">{summary.weather.label}</span>
          </div>
        )}
      </div>

      <div className="cond-grid">
        <WeatherCard label="Air temp"
          value={fmt(summary?.air_temp, '°C')} accent="#ff7a1a" />
        <WeatherCard label="Track temp (est.)"
          value={fmt(summary?.track_temp, '°C')} accent="#ff3b3b"
          note="estimated from air temp + cloud" />
        <WeatherCard label="Humidity"
          value={fmt(summary?.humidity, '%')} accent="#36d1ff" />
        <WeatherCard label="Precipitation"
          value={fmt(summary?.precipitation, ' mm')} accent="#4a9eff" />
        <WeatherCard label="Cloud cover"
          value={fmt(summary?.cloud_cover, '%')} accent="#9aa4b2" />
        <WindCard speed={summary?.wind_speed}
          direction={summary?.wind_direction} />
      </div>

      <div className="cond-lower">
        <div className="cond-timeline">
          <div className="cond-timeline-head">
            <h3>Conditions through the day</h3>
            <div className="res-toggle">
              <button className={res === 'hourly' ? 'on' : ''}
                      onClick={() => setRes('hourly')}>HOURLY</button>
              <button className={res === '15min' ? 'on' : ''}
                      onClick={() => setRes('15min')}>15 MIN</button>
            </div>
          </div>
          {res === '15min' && (
            <p className="hint interp-note">15-minute points are cubic-
            interpolated between hourly readings (Open-Meteo's archive
            resolution is hourly).</p>
          )}
          <TempChart series={series} />
        </div>

        <div className="cond-map-wrap">
          <h3>Circuit location</h3>
          <div ref={mapRef} className="cond-map" />
          <p className="hint">© OpenStreetMap</p>
        </div>
      </div>
    </div>
  );
}

function WeatherCard({ label, value, accent, note }) {
  return (
    <div className="weather-card" style={{ '--accent': accent }}>
      <span className="wc-label">{label}</span>
      <span className="wc-value">{value}</span>
      {note && <span className="wc-note">{note}</span>}
    </div>
  );
}

function WindCard({ speed, direction }) {
  const dir = direction ?? 0;
  return (
    <div className="weather-card wind-card" style={{ '--accent': '#36d1ff' }}>
      <span className="wc-label">Wind</span>
      <div className="wind-rose">
        <svg viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="26" className="wr-ring" />
          <line x1="30" y1="30" x2="30" y2="8"
                className="wr-needle"
                transform={`rotate(${dir} 30 30)`} />
          <text x="30" y="7" className="wr-n">N</text>
        </svg>
      </div>
      <span className="wc-value">
        {speed != null ? `${speed.toFixed(0)}` : '—'}
        <small> km/h</small></span>
    </div>
  );
}

function TempChart({ series }) {
  const W = 800, H = 180, P = 30;
  if (!series?.length) return <div className="hint">No readings.</div>;
  const temps = series.map((s) => s.air_temp).filter((v) => v != null);
  if (!temps.length) return <div className="hint">No temperature data.</div>;
  const min = Math.min(...temps) - 1, max = Math.max(...temps) + 1;
  const n = series.length;
  const x = (i) => P + (i / (n - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);

  const line = (key) => series.map((s, i) =>
    s[key] == null ? null : `${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`)
    .filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p).join(' ');

  const labelIdx = [0, Math.floor(n / 2), n - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="temp-chart"
         preserveAspectRatio="none">
      <path d={line('track_temp')} className="tc-track" />
      <path d={line('air_temp')} className="tc-air" />
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle"
              className="tc-xlabel">
          {(series[i].time || '').slice(11, 16)}
        </text>
      ))}
      <text x={P} y={16} className="tc-legend tc-air-l">air</text>
      <text x={P + 34} y={16} className="tc-legend tc-track-l">track est.</text>
    </svg>
  );
}

function fmt(v, unit) {
  if (v == null) return '—';
  return `${typeof v === 'number' ? v.toFixed(1) : v}${unit}`;
}

// cubic (Catmull-Rom) interpolation of hourly readings to 15-minute points
function interpolateQuarterHour(hourly) {
  const keys = ['air_temp', 'track_temp', 'humidity', 'precipitation',
                'cloud_cover', 'wind_speed', 'wind_direction'];
  const out = [];
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  for (let i = 0; i < hourly.length - 1; i++) {
    const p0 = hourly[Math.max(0, i - 1)], p1 = hourly[i];
    const p2 = hourly[i + 1], p3 = hourly[Math.min(hourly.length - 1, i + 2)];
    for (let q = 0; q < 4; q++) {
      const t = q / 4;
      const pt = { time: addMinutes(p1.time, q * 15), interpolated: q !== 0 };
      for (const k of keys) {
        const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
        pt[k] = (a == null || b == null || c == null || d == null)
          ? (b ?? null) : cr(a, b, c, d, t);
      }
      if (pt.weather === undefined) pt.weather = p1.weather;
      out.push(pt);
    }
  }
  out.push(hourly[hourly.length - 1]);
  return out;
}

function addMinutes(iso, mins) {
  if (!iso) return iso;
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + mins);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
