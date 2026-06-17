"""
Replay engine - the heart of the "simulated real-time" architecture.

It takes fully prepared, ML-scored, distance-aligned laps and emits frames
one distance-step at a time. Pacing is timestamp-driven: the engine waits
the real time between distance steps (from time_s deltas), so 1x playback
matches the actual lap time. Speed multipliers scale that wait.

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
        self.laps = {d: df.reset_index(drop=True)
                     for d, df in scored_laps.items()}
        self.n_steps = max(len(df) for df in self.laps.values())
        self._speed = 1.0

        # Reference timeline from the longest lap's time_s column
        ref = max(self.laps.values(), key=len)
        t = ref["time_s"].to_numpy(dtype=float)
        dt = np.diff(t, prepend=t[0])
        dt[dt < 0] = 0
        self._frame_dt = np.clip(dt, 0.0, 0.5)

        # High tick_rate_hz (e.g. 5000 in tests) caps the wait so tests
        # run fast without real-time delays
        if tick_rate_hz and tick_rate_hz > config.DEFAULT_TICK_RATE_HZ * 4:
            self._cap_dt = 1.0 / tick_rate_hz
        else:
            self._cap_dt = None

        self._paused = asyncio.Event()
        self._paused.set()
        self._stopped = False
        self._cursor = 0
        self._seek_to = None

    # ------------------------------------------------------------- control
    def pause(self):  self._paused.clear()
    def resume(self): self._paused.set()
    def stop(self):   self._stopped = True; self._paused.set()

    def set_speed(self, multiplier: float):
        self._speed = max(0.1, min(multiplier, 20.0))

    def seek_to_distance(self, distance: float) -> None:
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

            if self._cursor < self.n_steps:
                gap = float(self._frame_dt[self._cursor]) / self._speed
                gap = min(gap, 1.0)
                if self._cap_dt:
                    gap = min(gap, self._cap_dt)
                await asyncio.sleep(gap)

        yield {"type": "complete", "total_steps": self.n_steps}


def _jsonable(v):
    if pd.isna(v):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v