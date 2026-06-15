// REST + WebSocket client. The Vite dev server proxies /api and /ws to
// FastAPI on :8000, so no hardcoded hosts are needed in dev.

export async function api(path) {
  let res;
  try {
    res = await fetch(`/api${path}`);
  } catch {
    throw new Error('Network error — is the backend running on port 8000?');
  }
  if (!res.ok) {
    // backend returns {error, detail, path}; surface detail when present
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return res.json();
}

export const getHealth = () => api('/health');
export const getSchedule = (year) => api(`/schedule/${year}`);
export const getSessions = (year, rnd) => api(`/sessions/${year}/${rnd}`);
export const getDrivers = (year, rnd, ses) => api(`/drivers/${year}/${rnd}/${ses}`);
export const getLaps = (year, rnd, ses, drv) =>
  api(`/laps/${year}/${rnd}/${ses}/${drv}`);

// ---------------------------------------------------------------------------
// ReplayClient wraps the /ws/replay socket and exposes typed callbacks.
// ---------------------------------------------------------------------------
export class ReplayClient {
  constructor({ onStatus, onMeta, onFrame, onComplete, onError }) {
    this.handlers = { onStatus, onMeta, onFrame, onComplete, onError };
    this.ws = null;
  }

  start(request) {
    this._open({ action: 'start', ...request });
  }


  startHistory(laps) {
    this._open({ action: 'start_history', laps });
  }

  _open(firstMessage) {
    this.stop();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${window.location.host}/ws/replay`);
    this.ws.onopen = () => this.ws.send(JSON.stringify(firstMessage));
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const h = this.handlers;
      if (msg.type === 'status') h.onStatus?.(msg);
      else if (msg.type === 'meta') h.onMeta?.(msg);
      else if (msg.type === 'frame') h.onFrame?.(msg);
      else if (msg.type === 'complete') h.onComplete?.(msg);
      else if (msg.type === 'error') h.onError?.(msg);
    };
    this.ws.onerror = () =>
      this.handlers.onError?.({ message: 'WebSocket connection failed. Is the backend running on port 8000?' });
  }

  send(action, value) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, value }));
    }
  }

  pause() { this.send('pause'); }
  resume() { this.send('resume'); }
  setSpeed(x) { this.send('speed', x); }

  stop() {
    if (this.ws) {
      this.send('stop');
      this.ws.close();
      this.ws = null;
    }
  }
}
