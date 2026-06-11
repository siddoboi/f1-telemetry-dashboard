"""
Static driver-code -> team color map for history mode.

Saved laps don't store driver metadata, and the whole point of Phase 3 is
serving them WITHOUT FastF1 - so colors come from this lookup. Codes cover
2023-2025 grids; unknown codes fall back to grey. Update when grids change.
"""

DRIVER_COLORS: dict[str, str] = {
    # Red Bull
    "VER": "#3671C6", "PER": "#3671C6", "LAW": "#3671C6", "TSU": "#3671C6",
    # Ferrari
    "LEC": "#E8002D", "SAI": "#E8002D", "HAM": "#E8002D",
    # Mercedes
    "RUS": "#27F4D2", "ANT": "#27F4D2",
    # McLaren
    "NOR": "#FF8000", "PIA": "#FF8000",
    # Aston Martin
    "ALO": "#229971", "STR": "#229971",
    # Alpine
    "GAS": "#0093CC", "OCO": "#0093CC", "DOO": "#0093CC", "COL": "#0093CC",
    # Williams
    "ALB": "#64C4FF", "SAR": "#64C4FF",
    # RB / AlphaTauri
    "RIC": "#6692FF", "HAD": "#6692FF",
    # Sauber / Alfa Romeo
    "BOT": "#52E252", "ZHO": "#52E252", "HUL": "#52E252", "BOR": "#52E252",
    # Haas
    "MAG": "#B6BABD", "BEA": "#B6BABD",
}

FALLBACK = "#888888"


def color_for(code: str) -> str:
    return DRIVER_COLORS.get(code.upper(), FALLBACK)
