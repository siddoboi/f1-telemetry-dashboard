// Drivers tab: a chip per loaded driver. Clicking a chip slides in that
// driver's profile card: headshot (OpenF1), grid/finish position, fastest
// lap, top speed, laps and pit stops (FastF1 results + telemetry).
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function DriversView({ driverMeta, sessionRef }) {
  const [active, setActive] = useState(null);     // driver code
  const [profiles, setProfiles] = useState({});   // code -> profile|'loading'

  const open = async (code) => {
    setActive(code);
    if (profiles[code] || !sessionRef) return;
    setProfiles((p) => ({ ...p, [code]: 'loading' }));
    try {
      const { year, round, session } = sessionRef;
      const data = await api(`/profile/${year}/${round}/${session}/${code}`);
      setProfiles((p) => ({ ...p, [code]: data }));
    } catch (e) {
      setProfiles((p) => ({ ...p, [code]: { error: e.message } }));
    }
  };

  useEffect(() => { setProfiles({}); setActive(null); }, [sessionRef]);

  const codes = Object.keys(driverMeta);
  if (!codes.length) {
    return <div className="empty"><p>Load a replay first - the drivers of
      that comparison appear here.</p></div>;
  }
  const profile = active ? profiles[active] : null;

  return (
    <div className="drivers-view">
      <div className="drivers-chip-row">
        {codes.map((code) => (
          <button key={code}
                  className={`driver-chip big ${active === code ? 'on' : ''}`}
                  style={{ '--team': driverMeta[code].color }}
                  onClick={() => open(code)}>
            {code}
          </button>
        ))}
      </div>

      <div className={`profile-card ${active ? 'open' : ''}`}
           style={{ '--team': active ? driverMeta[active]?.color : '#888' }}>
        {profile === 'loading' && <p className="hint">Loading profile...</p>}
        {profile?.error && <p className="hint">Couldn't load profile:
          {' '}{profile.error}</p>}
        {profile && profile !== 'loading' && !profile.error && (
          <>
            <div className="profile-head">
              {profile.headshot_url
                ? <img src={profile.headshot_url} alt={profile.full_name}
                       className="headshot" />
                : <div className="headshot placeholder">{active}</div>}
              <div>
                <h2>{profile.full_name || active}</h2>
                <p className="profile-team">{profile.team}
                  {profile.country ? ` · ${profile.country}` : ''}</p>
              </div>
            </div>

            <div className="stat-grid">
              <Stat label="GRID" value={pos(profile.grid_position)} />
              <Stat label="FINISH" value={pos(profile.finish_position)} />
              <Stat label="FASTEST LAP" value={profile.fastest_lap || '-'}
                    sub={profile.fastest_lap_number
                      ? `lap ${profile.fastest_lap_number}` : ''} />
              <Stat label="TOP SPEED"
                    value={profile.top_speed_kmh
                      ? `${Math.round(profile.top_speed_kmh)} km/h` : '-'} />
              <Stat label="LAPS" value={profile.laps_completed ?? '-'} />
              <Stat label="PIT STOPS" value={profile.pit_stops ?? '-'} />
              {profile.points != null &&
                <Stat label="POINTS" value={profile.points} />}
              {profile.classified_status &&
                <Stat label="STATUS" value={profile.classified_status} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const pos = (p) => (p == null ? '-' : `P${p}`);

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
