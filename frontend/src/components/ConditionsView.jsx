// CONDITIONS tab - historical track weather (Open-Meteo) + circuit map.
// Map: Leaflet with OSM (default) or ESRI World Imagery (satellite) tiles,
// no token/account. The map preloads from circuitLocation in meta the moment
// a replay starts, so it's ready before the user opens this tab.
// Weather timeline is always cubic-interpolated to 15-min points for a smooth
// curve; X-axis is labelled only at the original hourly timestamps.
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, SkeletonBlock, SkeletonGrid } from './EmptyState';

const ICONS = {
  sun: '☀', 'cloud-sun': '⛅', cloud: '☁', fog: '🌫', drizzle: '🌦',
  rain: '🌧', snow: '❄', storm: '⛈',
};

const TILE_LAYERS = {
  map: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors', maxZoom: 18,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 19,
  },
};

export default function ConditionsView({ year, round, session,
                                         circuitLocation = null,
                                         panelCollapsed = false }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [mapStyle, setMapStyle] = useState('map');   // 'map' | 'satellite'
  const [tilesReady, setTilesReady] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const tileLayerRef = useRef(null);
  const roRef = useRef(null);

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

  // coordinates: prefer the preloaded meta location, fall back to fetched data
  const loc = data?.location || circuitLocation;
  const lat = loc?.latitude, lon = loc?.longitude;

  // lazy-load Leaflet from CDN and create the map as soon as we have coords
  // (this runs even before the weather fetch resolves, via circuitLocation)
  useEffect(() => {
    if (lat == null || lon == null || !mapRef.current) return;

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

    ensureLeaflet().then((L) => {
      if (!mapRef.current) return;
      if (!mapInstance.current) {
        const map = L.map(mapRef.current, {
          center: [lat, lon], zoom: 15, zoomControl: true,
          attributionControl: true, scrollWheelZoom: false,
        });
        const conf = TILE_LAYERS[mapStyle];
        tileLayerRef.current = L.tileLayer(conf.url, {
          maxZoom: conf.maxZoom, attribution: conf.attribution,
        });
        tileLayerRef.current.on('load', () => setTilesReady(true));
        tileLayerRef.current.addTo(map);
        L.circleMarker([lat, lon], {
          radius: 8, color: '#ff1e1e', weight: 2,
          fillColor: '#ff1e1e', fillOpacity: 0.7,
        }).addTo(map).bindPopup(loc.event_name || loc.circuit || 'Circuit');
        mapInstance.current = map;

        // invalidateSize once the container has real dimensions (tab visible)
        roRef.current = new ResizeObserver(() => {
          if (mapInstance.current) mapInstance.current.invalidateSize();
        });
        roRef.current.observe(mapRef.current);
      } else {
        mapInstance.current.setView([lat, lon], 15);
      }
    });

    return () => {
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      if (mapInstance.current) {
        mapInstance.current.remove(); mapInstance.current = null;
        tileLayerRef.current = null;
      }
    };
  }, [lat, lon]);

  // swap tile layer when the user toggles map/satellite
  useEffect(() => {
    if (!mapInstance.current || !window.L || !tileLayerRef.current) return;
    setTilesReady(false);
    mapInstance.current.removeLayer(tileLayerRef.current);
    const conf = TILE_LAYERS[mapStyle];
    tileLayerRef.current = window.L.tileLayer(conf.url, {
      maxZoom: conf.maxZoom, attribution: conf.attribution,
    });
    tileLayerRef.current.on('load', () => setTilesReady(true));
    tileLayerRef.current.addTo(mapInstance.current);
  }, [mapStyle]);

  // always-interpolated series (smooth curve)
  const series = useMemo(() => {
    const hourly = data?.hourly || [];
    if (hourly.length < 2) return hourly;
    return interpolateQuarterHour(hourly);
  }, [data]);

  const summary = useMemo(() => {
    const h = data?.hourly || [];
    if (!h.length) return null;
    return h[Math.floor(h.length / 2)];
  }, [data]);

  // ---- render guards (map still renders so it can preload) ----------------
  const showWeather = status === 'ok' && data?.available;

  return (
    <div className={`conditions-view ${panelCollapsed ? 'panels-collapsed'
                                                       : 'panels-open'}`}>
      <div className="cond-header">
        <div>
          <h2>{loc?.event_name || loc?.circuit || 'Track conditions'}</h2>
          <p className="hint">
            {loc?.circuit || ''}{loc?.country ? `, ${loc.country}` : ''}
            {data?.date ? ` · ${data.date}` : ''}
          </p>
        </div>
        {summary?.weather && (
          <div className="cond-now">
            <span className="cond-icon">
              {ICONS[summary.weather.icon] || '☁'}</span>
            <span className="cond-now-label">{summary.weather.label}</span>
          </div>
        )}
      </div>

      <div className="cond-layout">
        {/* LEFT: square map on top, timeline below */}
        <div className="cond-left">
          <div className="cond-map-card">
            <div className="cond-map-head">
              <h3>Circuit location</h3>
              <div className="map-toggle">
                <button className={mapStyle === 'map' ? 'on' : ''}
                        onClick={() => setMapStyle('map')}>🗺 MAP</button>
                <button className={mapStyle === 'satellite' ? 'on' : ''}
                        onClick={() => setMapStyle('satellite')}>🛰 SAT</button>
              </div>
            </div>
            <div className="cond-map-square">
              {lat == null ? (
                <div className="cond-map cond-map-empty">
                  <EmptyState icon="map" title="No coordinates"
                    hint="This circuit isn't in the location table yet." />
                </div>
              ) : (
                <>
                  <div ref={mapRef} className="cond-map" />
                  {!tilesReady && (
                    <div className="map-loading">Loading map…</div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="cond-timeline-card">
            <h3>Conditions through the day</h3>
            {showWeather ? (
              <>
                <TempChart series={series} />
                <div className="chart-legend">
                  <span className="cl-item">
                    <svg width="22" height="8"><line x1="0" y1="4" x2="22"
                      y2="4" stroke="#ff7a1a" strokeWidth="2" /></svg>
                    Air temp
                  </span>
                  <span className="cl-item">
                    <svg width="22" height="8"><line x1="0" y1="4" x2="22"
                      y2="4" stroke="#ff3b3b" strokeWidth="2"
                      strokeDasharray="4 3" /></svg>
                    Track temp (est.)
                  </span>
                </div>
                <p className="hint">15-minute points are interpolated from
                Open-Meteo's hourly archive. X-axis ticks mark the hourly
                readings.</p>
              </>
            ) : status === 'loading' ? (
              <SkeletonBlock height={200} radius={6} />
            ) : (
              <p className="hint">Weather data is unavailable for this
              session.</p>
            )}
          </div>
        </div>

        {/* RIGHT: weather cards, 2-col when panels collapsed else 1-col */}
        <div className="cond-cards">
          {showWeather ? (
            <>
              <WeatherCard label="Air temp"
                value={fmt(summary?.air_temp, '°C')} accent="#ff7a1a" />
              <WeatherCard label="Track temp (est.)"
                value={fmt(summary?.track_temp, '°C')} accent="#ff3b3b" />
              <WeatherCard label="Humidity"
                value={fmt(summary?.humidity, '%')} accent="#36d1ff" />
              <WeatherCard label="Precipitation"
                value={fmt(summary?.precipitation, ' mm')} accent="#4a9eff" />
              <WeatherCard label="Cloud cover"
                value={fmt(summary?.cloud_cover, '%')} accent="#9aa4b2" />
              <WindCard speed={summary?.wind_speed}
                direction={summary?.wind_direction} />
            </>
          ) : status === 'loading' ? (
            <SkeletonGrid count={6} minWidth={140} height={84} />
          ) : (
            <p className="hint">No weather readings to show.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function WeatherCard({ label, value, accent }) {
  return (
    <div className="weather-card" style={{ '--accent': accent }}>
      <span className="wc-label">{label}</span>
      <span className="wc-value">{value}</span>
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
          <line x1="30" y1="30" x2="30" y2="8" className="wr-needle"
                transform={`rotate(${dir} 30 30)`} />
          <text x="30" y="7" className="wr-n">N</text>
        </svg>
      </div>
      <span className="wc-value">
        {speed != null ? `${speed.toFixed(0)}` : '-'}<small> km/h</small></span>
    </div>
  );
}

function TempChart({ series }) {
  const W = 760, H = 200, L = 44, R = 12, T = 16, B = 34;
  if (!series?.length) return <div className="hint">No readings.</div>;
  const temps = [];
  for (const s of series) {
    if (s.air_temp != null) temps.push(s.air_temp);
    if (s.track_temp != null) temps.push(s.track_temp);
  }
  if (!temps.length) return <div className="hint">No temperature data.</div>;
  const min = Math.floor(Math.min(...temps) - 1);
  const max = Math.ceil(Math.max(...temps) + 1);
  const n = series.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => H - B - ((v - min) / (max - min || 1)) * (H - T - B);

  const path = (key) => series.map((s, i) =>
    s[key] == null ? null : `${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`)
    .filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p).join(' ');

  // y gridlines at min, mid, max
  const yTicks = [min, Math.round((min + max) / 2), max];
  // x ticks only at original hourly points, thinned if too many to fit
  const allHourly = series.map((s, i) => ({ i, s }))
    .filter(({ s }) => !s.interpolated);
  // show at most 8 ticks; skip evenly if more
  const step = Math.ceil(allHourly.length / 8);
  const xTicks = allHourly.filter((_, idx) => idx % step === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="temp-chart"
         preserveAspectRatio="xMidYMid meet">
      {/* y gridlines + labels */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} className="tc-grid" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end"
                className="tc-axislabel">{v}</text>
        </g>
      ))}
      {/* y axis title */}
      <text x={14} y={H / 2} className="tc-axistitle"
            transform={`rotate(-90 14 ${H / 2})`}>TEMPERATURE (°C)</text>

      {/* x ticks at hourly readings */}
      {xTicks.map(({ i, s }) => (
        <g key={i}>
          <line x1={x(i)} y1={H - B} x2={x(i)} y2={H - B + 4}
                className="tc-grid" />
          <text x={x(i)} y={H - B + 16} textAnchor="middle"
                className="tc-axislabel">
            {(s.time || '').slice(11, 16)}</text>
        </g>
      ))}
      {/* x axis title */}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle"
            className="tc-axistitle">TIME (local)</text>

      <path d={path('track_temp')} className="tc-track" />
      <path d={path('air_temp')} className="tc-air" />
    </svg>
  );
}

function fmt(v, unit) {
  if (v == null) return '-';
  return `${typeof v === 'number' ? v.toFixed(1) : v}${unit}`;
}

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
      pt.weather = p1.weather;
      out.push(pt);
    }
  }
  const last = { ...hourly[hourly.length - 1], interpolated: false };
  out.push(last);
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
