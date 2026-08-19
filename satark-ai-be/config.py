"""
Central configuration for the Satark AI backend.

All values can be overridden with environment variables so the same
code runs the same way on your laptop, a teammate's laptop, or a
proper server later. Nothing here should need to be hardcoded again.
"""
import os


def _float_env(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value is not None else default


def _int_env(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value is not None else default


# ------------------------------------------------------------------
# Server
# ------------------------------------------------------------------
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = _int_env("PORT", 8000)

# ------------------------------------------------------------------
# Crowd density (mock generator, until real CV is wired in)
# ------------------------------------------------------------------
# How often a fresh crowd update is pushed to each connected phone.
# The mobile-frontend plan mentioned "every 10 seconds maybe".
CROWD_UPDATE_INTERVAL_SECONDS = _float_env("CROWD_UPDATE_INTERVAL_SECONDS", 10.0)

# Degrees of lat/lon each grid cell spans around the user.
# ~0.00035 degrees is roughly 35-40 metres at the equator.
REGION_CELL_SIZE_DEGREES = _float_env("REGION_CELL_SIZE_DEGREES", 0.00035)

# Density (0-100 mock scale) thresholds that decide low/moderate/extreme.
CROWD_LEVEL_MODERATE_AT = _int_env("CROWD_LEVEL_MODERATE_AT", 50)
CROWD_LEVEL_EXTREME_AT = _int_env("CROWD_LEVEL_EXTREME_AT", 80)

# ------------------------------------------------------------------
# Exit routing
# ------------------------------------------------------------------
# Hardcoded for now — the control-room dashboard will let an admin
# configure these per-venue instead of editing code.
EXIT_GATES = [
    {"id": "gate-1", "name": "Main Gate", "latitude": 20.295644, "longitude": 85.836251},
    {"id": "gate-2", "name": "North Gate", "latitude": 20.297200, "longitude": 85.836900},
    {"id": "gate-3", "name": "South Gate", "latitude": 20.293800, "longitude": 85.836500},
    {"id": "gate-4", "name": "East Gate", "latitude": 20.295500, "longitude": 85.839000},
    {"id": "gate-5", "name": "West Gate", "latitude": 20.295700, "longitude": 85.833900},
]