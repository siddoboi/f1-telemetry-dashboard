"""Replay engine behavior: frame count, completion, pause/stop, speed."""
import asyncio

import pytest

from app.ml.anomaly_detector import AnomalyDetector


@pytest.fixture
def scored(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    return det.score(comparison_lap, baseline_lap)


async def _collect(engine, limit=None):
    frames = []
    async for f in engine.frames():
        frames.append(f)
        if limit and len(frames) >= limit:
            engine.stop()
    return frames


async def test_emits_all_frames_then_complete(scored):
    from app.replay.replay_engine import ReplayEngine
    eng = ReplayEngine({"TST": scored}, tick_rate_hz=5000)
    frames = await _collect(eng)
    assert frames[-1]["type"] == "complete"
    assert len(frames) == len(scored) + 1          # +1 complete message
    assert frames[0]["drivers"]["TST"]["distance"] == 0.0


async def test_multi_driver_bundles_share_index(scored):
    from app.replay.replay_engine import ReplayEngine
    eng = ReplayEngine({"A": scored, "B": scored.iloc[:500]},
                       tick_rate_hz=5000)
    frames = await _collect(eng)
    mid = frames[100]
    assert set(mid["drivers"]) == {"A", "B"}
    late = frames[800]
    assert set(late["drivers"]) == {"A"}           # B's lap ended


async def test_stop_halts_stream(scored):
    from app.replay.replay_engine import ReplayEngine
    eng = ReplayEngine({"TST": scored}, tick_rate_hz=5000)
    frames = await _collect(eng, limit=50)
    assert len(frames) == 50


async def test_pause_blocks_until_resume(scored):
    from app.replay.replay_engine import ReplayEngine
    eng = ReplayEngine({"TST": scored}, tick_rate_hz=5000)
    it = eng.frames()
    await it.__anext__()
    eng.pause()
    task = asyncio.ensure_future(it.__anext__())
    await asyncio.sleep(0.05)
    assert not task.done(), "frame emitted while paused"
    eng.resume()
    frame = await asyncio.wait_for(task, timeout=1)
    assert frame["type"] == "frame"
    eng.stop()


def test_speed_multiplier_clamped(scored):
    from app.replay.replay_engine import ReplayEngine
    eng = ReplayEngine({"TST": scored})
    eng.set_speed(100.0)                            # clamps to 20x
    assert eng.tick == pytest.approx(1 / (10 * 20))
    eng.set_speed(0.01)                             # clamps to 0.1x
    assert eng.tick == pytest.approx(1 / (10 * 0.1))
