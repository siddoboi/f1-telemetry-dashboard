"""Pydantic models used by the REST API and the replay WebSocket."""
from typing import Literal, Optional
from pydantic import BaseModel, Field


class SessionRef(BaseModel):
    """Identifies one F1 session uniquely."""
    year: int = Field(ge=2018)               # FastF1 telemetry starts in 2018
    round: int = Field(ge=1)                 # event round number in the season
    session: str                             # 'FP1','FP2','FP3','Q','SQ','S','R'


class ReplayRequest(BaseModel):
    """First message a client sends on the /ws/replay socket."""
    year: int
    round: int
    session: str
    drivers: list[str] = Field(min_length=1, max_length=5)   # e.g. ["VER","NOR"]
    lap_numbers: Optional[dict[str, int]] = None   # driver -> lap, None = best
    baseline_mode: Literal["session_optimal", "personal_best"] = "session_optimal"
    tick_rate_hz: Optional[float] = None     # override server default


class TelemetryFrame(BaseModel):
    """One resampled telemetry point for one driver at one distance step."""
    driver: str
    distance: float                          # metres from start line
    speed: float                             # km/h
    rpm: float
    gear: int
    throttle: float                          # 0..100
    brake: float                             # 0 / 100 (FastF1 brake is boolean)
    drs: int
    time_s: float                            # lap time elapsed at this point
    anomaly_score: float = 0.0               # 0..1
    anomaly: bool = False
    anomaly_label: Optional[str] = None      # e.g. "Possible lock-up"


class AnomalyEvent(BaseModel):
    """One contiguous anomaly region, used by the sidebar event log."""
    driver: str
    start_distance: float
    end_distance: float
    peak_score: float
    label: str
    diagnosis: str
