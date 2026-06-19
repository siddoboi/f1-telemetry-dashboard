// Top-level navigation. Pure tab switcher - all views stay mounted in App so
// switching tabs never interrupts a running replay or live feed.
const TABS = [
  { id: 'home', label: 'HOME' },
  { id: 'telemetry', label: 'TELEMETRY' },
  { id: 'trackmap', label: 'TRACK MAP' },
  { id: 'session', label: 'SESSION' },
  { id: 'conditions', label: 'CONDITIONS' },
  { id: 'history', label: 'HISTORY' },
];

export default function NavBar({ tab, onTab }) {
  return (
    <nav className="navbar">
      <span className="nav-brand">PIT WALL</span>
      <div className="nav-tabs">
        {TABS.map((t) => (
          <button key={t.id}
                  className={`nav-tab ${tab === t.id ? 'on' : ''}`}
                  onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
