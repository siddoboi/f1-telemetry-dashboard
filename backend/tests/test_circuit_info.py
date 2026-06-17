"""Bundle B: circuit info (corners, sector boundaries, sector times).

The network-dependent path (get_circuit_info hitting FastF1) is covered by the
slow suite. Here we unit-test the pieces that need no network: the sector-time
extraction helper and the sector-boundary interpolation math.
"""
import numpy as np
import pandas as pd
import pytest

fastf1 = pytest.importorskip("fastf1")

from app.data import fastf1_loader as f1


class _Lap(dict):
    """Minimal lap stub supporting .get() returning the stored value."""
    pass


def test_sector_times_extracts_all_three():
    lap = _Lap({
        "Sector1Time": pd.Timedelta(seconds=28.542),
        "Sector2Time": pd.Timedelta(seconds=37.059),
        "Sector3Time": pd.Timedelta(seconds=25.008),
    })
    out = f1._sector_times(lap)
    assert out["s1"] == pytest.approx(28.542)
    assert out["s2"] == pytest.approx(37.059)
    assert out["s3"] == pytest.approx(25.008)
    assert out["s1_fmt"] == "28.542"


def test_sector_times_handles_missing():
    lap = _Lap({
        "Sector1Time": pd.Timedelta(seconds=28.5),
        "Sector2Time": pd.NaT,
        "Sector3Time": None,
    })
    out = f1._sector_times(lap)
    assert out["s1"] == pytest.approx(28.5)
    assert out["s2"] is None
    assert out["s3"] is None
    assert out["s2_fmt"] is None


def test_sector_boundary_interpolation_math():
    # a lap where distance is linear in time: d = 60 * t  (60 m/s constant)
    t = np.linspace(0, 90, 1000)
    dist = 60.0 * t
    s1_s, s2_s = 28.542, 37.059
    s1_end = float(np.interp(s1_s, t, dist))
    s2_end = float(np.interp(s1_s + s2_s, t, dist))
    assert s1_end == pytest.approx(60.0 * s1_s, rel=1e-3)
    assert s2_end == pytest.approx(60.0 * (s1_s + s2_s), rel=1e-3)
    assert s2_end > s1_end
