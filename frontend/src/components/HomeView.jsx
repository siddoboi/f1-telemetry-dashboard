// HOME - landing screen shown on the first tab. Both side panels are hidden
// (App handles that) so this is full-width. Pure SVG + CSS animation, no chart
// library, same dark theme + Titillium/IBM Plex typography as the dashboard.
// Cards 1-3 (telemetry-heavy) use richer animated mini-charts; cards 4-6
// (Track Map / Session / Conditions) use lighter looping SVG motifs.

export default function HomeView({ onStart, onAbout }) {
  return (
    <div className="home-view">
      <section className="home-hero">
        <div className="hero-trace" aria-hidden="true">
          <CircuitTrace />
        </div>
        <div className="hero-content">
          <h1>PIT WALL</h1>
          <p className="hero-tag">
            F1 telemetry &amp; driver-consistency analysis. Replay any lap,
            aligned by track distance, with unsupervised anomaly detection
            validated against vehicle physics.
          </p>
          <button className="hero-cta" onClick={onStart}>
            Load a session →
          </button>
          <p className="hero-sub">
            Historical data via FastF1 · weather via Open-Meteo · no live feed
          </p>
        </div>
      </section>

      <section className="home-cards">
        <FeatureCard title="Anomaly Detection"
          desc="An Isolation Forest flags atypical telemetry, cross-checked
                against physics rules (lock-ups, wheelspin, lifts).">
          <AnomalyChart />
        </FeatureCard>

        <FeatureCard title="Distance Alignment"
          desc="Every lap is resampled onto a 5-metre grid so two drivers are
                compared at the same track position, not the same clock time.">
          <AlignChart />
        </FeatureCard>

        <FeatureCard title="Multi-Driver Comparison"
          desc="Overlay up to five drivers on synchronized channels - speed,
                throttle, brake, delta - against a shared baseline.">
          <MultiDriverChart />
        </FeatureCard>

        <FeatureCard title="Track Map" small
          desc="A GPS circuit map with sector slashes, corner labels and live
                driver positions interpolated to your screen's refresh rate.">
          <TrackMotif />
        </FeatureCard>

        <FeatureCard title="Session Timeline" small
          desc="Browse every lap each driver set, with tyre compound and a
                lap-time progression chart.">
          <SessionMotif />
        </FeatureCard>

        <FeatureCard title="Track Conditions" small
          desc="Historical air and estimated track temperature, wind, humidity
                and a satellite circuit map for the session date.">
          <ConditionsMotif />
        </FeatureCard>
      </section>

      <footer className="home-footer">
        <span>Built by <strong>Siddhesh Singh</strong> ·{' '}
          <a href="https://github.com/siddoboi/f1-telemetry-dashboard"
             target="_blank" rel="noreferrer">GitHub</a>
          {' · '}
          <button className="hf-link" onClick={onAbout}>About &amp; Support</button>
        </span>
        <span className="hf-data">Data: FastF1 · Open-Meteo · OpenStreetMap</span>
      </footer>
    </div>
  );
}

function FeatureCard({ title, desc, children, small = false }) {
  return (
    <div className={`feature-card ${small ? 'fc-small' : 'fc-large'}`}>
      <div className="fc-visual">{children}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

/* ---------- hero: looping circuit outline trace ---------- */
function CircuitTrace() {
  // a stylised closed circuit path; stroke-dashoffset animates a "car" trace
  const d = "M60,260 C40,180 80,120 160,120 L300,120 C360,120 380,80 360,50 "
          + "C340,20 380,20 440,40 L600,90 C660,110 680,160 640,200 "
          + "L520,250 C470,270 470,230 420,235 L200,270 C120,290 80,300 60,260 Z";
  return (
    <svg viewBox="0 0 720 340" preserveAspectRatio="xMidYMid slice">
      <path d={d} className="ct-base" />
      <path d={d} className="ct-run" />
    </svg>
  );
}

/* ---------- card 1: anomaly mini-chart with pulsing band ---------- */
function AnomalyChart() {
  const pts = genWave(80, 40, 7);
  return (
    <svg viewBox="0 0 200 90" className="mini">
      <rect x="118" y="6" width="26" height="78" className="an-band" />
      <polyline points={pts} className="ml-line ml-accent" />
      <circle cx="131" cy="46" r="4" className="an-flag" />
    </svg>
  );
}

/* ---------- card 2: two lines snapping into alignment ---------- */
function AlignChart() {
  return (
    <svg viewBox="0 0 200 90" className="mini">
      <polyline className="ml-line al-a"
        points={genWave(90, 42, 5, 0)} />
      <polyline className="ml-line al-b"
        points={genWave(90, 42, 5, 10)} />
    </svg>
  );
}

/* ---------- card 3: multi-driver overlay ---------- */
function MultiDriverChart() {
  const colors = ['#1e90ff', '#ff3b3b', '#2ecc71', '#ffd21a'];
  return (
    <svg viewBox="0 0 200 90" className="mini">
      {colors.map((c, i) => (
        <polyline key={i} className="ml-line md-line"
          style={{ stroke: c, animationDelay: `${i * 0.25}s` }}
          points={genWave(85, 40, 6, i * 6)} />
      ))}
    </svg>
  );
}

/* ---------- card 4: circuit outline trace (light) ---------- */
function TrackMotif() {
  const d = "M30,60 C20,30 50,20 80,25 L140,35 C170,40 175,20 160,15 "
          + "L130,8 C110,4 120,2 150,8 L180,16 C195,22 195,45 170,52 "
          + "L70,70 C45,75 38,72 30,60 Z";
  return (
    <svg viewBox="0 0 210 84" className="mini">
      <path d={d} className="tm-base" />
      <path d={d} className="tm-run" />
      <circle r="3" className="tm-dot">
        <animateMotion dur="4s" repeatCount="indefinite" path={d} />
      </circle>
    </svg>
  );
}

/* ---------- card 5: lap-time bars filling ---------- */
function SessionMotif() {
  const bars = [44, 30, 52, 26, 38, 48, 22, 40];
  return (
    <svg viewBox="0 0 200 84" className="mini">
      {bars.map((h, i) => (
        <rect key={i} x={10 + i * 23} y={74 - h} width="14" height={h}
          rx="2" className="sm-bar"
          style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </svg>
  );
}

/* ---------- card 6: sun/cloud + temp line ---------- */
function ConditionsMotif() {
  return (
    <svg viewBox="0 0 200 84" className="mini">
      <circle cx="44" cy="34" r="14" className="cm-sun" />
      <g className="cm-cloud">
        <ellipse cx="60" cy="44" rx="22" ry="13" />
        <ellipse cx="44" cy="46" rx="14" ry="10" />
      </g>
      <polyline className="ml-line cm-temp"
        points="10,70 40,62 70,66 100,52 130,58 160,44 190,50" />
    </svg>
  );
}

/* ---------- helpers ---------- */
function genWave(amp, mid, n, phase = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = 10 + (i / n) * 180;
    const y = mid - (amp / 2) * Math.sin((i / n) * Math.PI * 2 + phase / 6);
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  return pts.join(' ');
}
