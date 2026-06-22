// Hover-triggered driver profile overlay.
// Appears as a horizontal card over the current view when the cursor rests
// on a lap-header chip; disappears on mouse leave. Profiles are fetched
// once per driver per session and cached in-memory.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const cache = {};   // `${year}-${round}-${session}-${code}` -> profile

export default function ProfileOverlay({ driver, color, sessionRef,
                                         anchorRect, onMouseEnter,
                                         onMouseLeave }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const key = sessionRef
    ? `${sessionRef.year}-${sessionRef.round}-${sessionRef.session}-${driver}`
    : null;

  useEffect(() => {
    if (!key) return;
    if (cache[key]) { setProfile(cache[key]); return; }
    setProfile(null); setError('');
    const { year, round, session } = sessionRef;
    api(`/profile/${year}/${round}/${session}/${driver}`)
      .then((p) => { cache[key] = p; setProfile(p); })
      .catch((e) => setError(e.message));
  }, [key]);

  if (!anchorRect) return null;

  const style = {
    top: anchorRect.bottom + 8,
    left: Math.max(12, Math.min(anchorRect.left, window.innerWidth - 560)),
    '--team': color,
  };

  return (
    <div className="profile-overlay" style={style}
         onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {error && <p className="hint">Profile unavailable: {error}</p>}
      {!profile && !error && <p className="hint">Loading {driver}...</p>}
      {profile && (
        <>
          {profile.headshot_url
            ? <img src={profile.headshot_url} alt={driver}
                   className="headshot" />
            : <div className="headshot placeholder">{driver}</div>}
          <div className="overlay-body">
            <div className="overlay-name">
              <strong>{profile.full_name || driver}</strong>
              <span>{profile.team}
                {profile.country ? ` · ${profile.country}` : ''}</span>
            </div>
            <div className="overlay-stats">
              <Stat l="GRID" v={pos(profile.grid_position)} />
              <Stat l="FINISH" v={pos(profile.finish_position)} />
              <Stat l="FASTEST" v={profile.fastest_lap || '-'} />
              <Stat l="TOP SPD" v={profile.top_speed_kmh
                ? `${Math.round(profile.top_speed_kmh)}` : '-'} />
              <Stat l="LAPS" v={profile.laps_completed ?? '-'} />
              <Stat l="PITS" v={profile.pit_stops ?? '-'} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const pos = (p) => (p == null ? '-' : `P${p}`);

function Stat({ l, v }) {
  return (
    <div className="overlay-stat">
      <span className="stat-label">{l}</span>
      <span className="stat-value">{v}</span>
    </div>
  );
}
