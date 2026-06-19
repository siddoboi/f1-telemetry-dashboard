// ABOUT - project description, tech stack, credits and a "Report a bug"
// button that opens a pre-filled GitHub issue. Same dark theme as the rest.

const REPO = 'https://github.com/siddoboi/f1-telemetry-dashboard';

const BUG_TEMPLATE = `**Describe the bug**
A clear description of what went wrong.

**Steps to reproduce**
1.
2.
3.

**Expected behaviour**

**Actual behaviour**

**Session / context** (year, round, session, drivers if relevant)

**Browser / OS**
`;

export const BUG_URL = `${REPO}/issues/new`
  + `?title=${encodeURIComponent('[Bug] ')}`
  + `&body=${encodeURIComponent(BUG_TEMPLATE)}`;

const STACK = [
  ['FastAPI', 'REST + WebSocket backend'],
  ['React + Vite', 'frontend & live charts'],
  ['scikit-learn', 'Isolation Forest anomaly detection'],
  ['FastF1', 'telemetry, laps, circuit geometry'],
  ['OpenF1', 'driver headshots'],
  ['Open-Meteo', 'historical track weather'],
  ['MongoDB', 'replay & lap caching'],
  ['Recharts · Leaflet', 'charts & circuit map'],
];

export default function AboutView() {
  return (
    <div className="about-view">
      <section className="about-block">
        <h2>About PIT WALL</h2>
        <p>
          PIT WALL is an F1 telemetry and driver-consistency dashboard. It
          replays historical laps through a simulated real-time pipeline and
          aligns every lap by track distance (a 5-metre grid) rather than by
          time, so two drivers are always compared at the same point on the
          circuit.
        </p>
        <p>
          An unsupervised Isolation Forest flags atypical telemetry, and those
          flags are cross-checked against vehicle-physics rules — braking
          lock-ups, traction loss, unexpected lifts — to separate genuine
          driving events from sensor noise. The result is a per-lap consistency
          view with explainable anomalies rather than a black-box score.
        </p>
        <p className="about-note">
          A personal project exploring distance-aligned telemetry analysis and
          explainable anomaly detection for motorsport data.
        </p>
      </section>

      <section className="about-block">
        <h2>Tech stack</h2>
        <div className="stack-grid">
          {STACK.map(([name, role]) => (
            <div key={name} className="stack-item">
              <span className="stack-name">{name}</span>
              <span className="stack-role">{role}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="about-block">
        <h2>Support</h2>
        <p>
          Found a bug or have a suggestion? Reports go straight to the project's
          GitHub issues, where they're triaged and tracked.
        </p>
        <a className="bug-button" href={BUG_URL} target="_blank"
           rel="noreferrer">⚑ Report a bug</a>
      </section>

      <section className="about-block">
        <h2>Credits &amp; data</h2>
        <p>
          Built by <strong>Siddhesh Singh</strong> ·{' '}
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </p>
        <p className="about-sources">
          Data sources: FastF1 · Open-Meteo · OpenStreetMap. Not affiliated with
          Formula 1 or the FIA. For research and educational use.
        </p>
      </section>
    </div>
  );
}
