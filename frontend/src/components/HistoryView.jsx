// History tab: laps persisted to the MongoDB time-series collection after
// completed replays. Read-only browser for now; selecting an entry pre-fills
// nothing yet (Phase 3 hook: re-serve saved laps without FastF1).
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function HistoryView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/history')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <div className="empty"><p>History unavailable: {error}</p></div>;
  }
  if (rows === null) return <div className="empty"><p>Loading...</p></div>;
  if (!rows.length) {
    return (
      <div className="empty">
        <p>No saved laps yet.</p>
        <p className="hint">Laps are written to MongoDB automatically when a
        replay finishes. If MongoDB isn't running, persistence is skipped -
        check <code>/api/health</code>.</p>
      </div>
    );
  }

  return (
    <div className="history-view">
      <table className="history-table">
        <thead>
          <tr><th>Year</th><th>Round</th><th>Session</th>
              <th>Driver</th><th>Lap</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.year}</td><td>R{r.round}</td><td>{r.session}</td>
              <td className="mono">{r.driver}</td>
              <td>{r.lap === -1 ? 'fastest' : r.lap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
