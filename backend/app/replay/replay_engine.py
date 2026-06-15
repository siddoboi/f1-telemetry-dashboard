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

import numpy as np
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
        self._cursor = 0                # current frame index
        self._seek_to = None            # pending forward-seek target index

    # ------------------------------------------------------------- control
    def pause(self):  self._paused.clear()
    def resume(self): self._paused.set()
    def stop(self):   self._stopped = True; self._paused.set()

    def set_speed(self, multiplier: float):
        base = 1.0 / config.DEFAULT_TICK_RATE_HZ
        self.tick = base / max(0.1, min(multiplier, 20.0))

    def seek_to_distance(self, distance: float) -> None:
        """Request a forward jump to the frame nearest `distance`. Backward
        seeks are handled on the frontend, so only targets ahead of the
        cursor are honoured here."""
        target = self._index_for_distance(distance)
        if target > self._cursor:
            self._seek_to = target

    def _index_for_distance(self, distance: float) -> int:
        ref = max(self.laps.values(), key=len)
        dist = ref["distance"].to_numpy()
        return int(min(np.searchsorted(dist, distance), self.n_steps - 1))

    def _bundle(self, i: int, kind: str = "frame") -> dict:
        bundle = {"type": kind, "index": i, "drivers": {}}
        for drv, df in self.laps.items():
            if i < len(df):
                row = df.iloc[i]
                bundle["drivers"][drv] = {
                    c: _jsonable(row[c]) for c in FRAME_COLS if c in row}
        return bundle

    # -------------------------------------------------------------- stream
    async def frames(self) -> AsyncIterator[dict]:
        """Yields one multi-driver frame bundle per tick. A pending forward
        seek fast-emits every skipped frame (kind='seek_fill', no sleep) so
        the client's point array stays complete, then pacing resumes."""
        self._cursor = 0
        while self._cursor < self.n_steps:
            if self._stopped:
                return
            await self._paused.wait()

            if self._seek_to is not None:
                target = min(self._seek_to, self.n_steps - 1)
                self._seek_to = None
                while self._cursor < target:
                    yield self._bundle(self._cursor, kind="seek_fill")
                    self._cursor += 1

            yield self._bundle(self._cursor)
            self._cursor += 1
            await asyncio.sleep(self.tick)
        yield {"type": "complete", "total_steps": self.n_steps}


def _jsonable(v):
    if pd.isna(v):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v
