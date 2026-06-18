"""Bundle E: weather client unit tests (network-free).

The live Open-Meteo fetch is integration-tested on a machine with internet;
here we verify the pure helpers: WMO mapping, track-temp estimation, and the
response shaping from a mocked hourly payload.
"""
import pytest
from app.data import weather_client as wc


def test_wmo_known_codes():
    assert wc._wmo(0)["label"] == "Clear sky"
    assert wc._wmo(0)["icon"] == "sun"
    assert wc._wmo(63)["icon"] == "rain"
    assert wc._wmo(95)["icon"] == "storm"


def test_wmo_unknown_code():
    out = wc._wmo(12345)
    assert out["label"] == "Unknown"
    assert out["icon"] == "cloud"


def test_track_temp_estimate_sunny_vs_overcast():
    # clear sky (0% cloud) should be hotter than fully overcast
    sunny = wc._estimate_track_temp(30.0, 0)
    overcast = wc._estimate_track_temp(30.0, 100)
    assert sunny > overcast
    # clear: air + 4 + 16 = +20 over air
    assert sunny == pytest.approx(50.0, abs=0.1)
    # overcast: air + 4 + 0 = +4 over air
    assert overcast == pytest.approx(34.0, abs=0.1)


def test_track_temp_none_air():
    assert wc._estimate_track_temp(None, 50) is None


def test_get_safe_indexing():
    h = {"temperature_2m": [10, 20, 30]}
    assert wc._get(h, "temperature_2m", 1) == 20
    assert wc._get(h, "temperature_2m", 99) is None
    assert wc._get(h, "missing_key", 0) is None
