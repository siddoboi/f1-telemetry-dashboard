"""
Replay engine - the heart of the "simulated real-time" architecture.

It takes fully prepared, ML-scored, distance-aligned laps and emits frames
one distance-step at a time at a configurable tick rate. Downstream consumers
(the WebSocket handler, the DB writer) cannot tell the data is historical.

Multi-driver note: drivers are interleaved by FRAME INDEX, i.e. both cars are
shown at the same track position each tick. That is exactly what a distance-
synchronized comparison chart needs.
"""
import asyncio
import logging
from typing import AsyncIterator

import pandas as pd

from app import config

log = logging.getLogger(__name__)

FRAME_COLS = ["distance", "speed", "rpm", "gear", "throttle", "brake",
              "drs", "time_s", "anomaly_score", "anomaly", "anomaly_label",
              "x", "y", "delta"]


class ReplayEngine:
    def __init__(self, scored_laps: dict[str, pd.DataFrame],
                 tick_rate_hz: float | None = None):
        """scored_laps: driver code -> scored distance-grid DataFrame."""
        self.laps = {d: df.reset_index(drop=True)
                     for d, df in scored_laps.items()}
        self.tick = 1.0 / (tick_rate_hz or config.DEFAULT_TICK_RATE_HZ)
        self.n_steps = max(len(df) for df in self.laps.values())
        self._paused = asyncio.Event()
        self._paused.set()              # not paused initially
        self._stopped = False

    # ------------------------------------------------------------- control
    def pause(self):  self._paused.clear()
    def resume(self): self._paused.set()
    def stop(self):   self._stopped = True; self._paused.set()

    def set_speed(self, multiplier: float):
        base = 1.0 / config.DEFAULT_TICK_RATE_HZ
        self.tick = base / max(0.1, min(multiplier, 20.0))

    # -------------------------------------------------------------- stream
    async def frames(self) -> AsyncIterator[dict]:
        """Yields one multi-driver frame bundle per tick."""
        for i in range(self.n_steps):
            if self._stopped:
                return
            await self._paused.wait()
            bundle = {"type": "frame", "index": i, "drivers": {}}
            for drv, df in self.laps.items():
                if i < len(df):
                    row = df.iloc[i]
                    bundle["drivers"][drv] = {
                        c: _jsonable(row[c]) for c in FRAME_COLS if c in row
                    }
            yield bundle
            await asyncio.sleep(self.tick)
        yield {"type": "complete", "total_steps": self.n_steps}


def _jsonable(v):
    if pd.isna(v):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v
