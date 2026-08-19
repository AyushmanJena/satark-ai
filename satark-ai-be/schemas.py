"""
Message schemas.

These mirror the TypeScript types in the mobile app exactly
(services/crowd-api.ts, services/crowd-websocket.ts, services/exit-service.ts)
so the JSON going over the wire needs zero changes on the frontend.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

CrowdLevel = Literal["low", "moderate", "extreme"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------
# Crowd density
# ------------------------------------------------------------------
class CrowdRegion(BaseModel):
    id: str
    level: CrowdLevel
    north: float
    south: float
    east: float
    west: float
    label: Optional[str] = None
    density: Optional[int] = None  # 0-100 mock scale, extra info for debugging/UI


class LocationUpdateIn(BaseModel):
    type: Literal["LOCATION_UPDATE"]
    latitude: float
    longitude: float
    timestamp: Optional[str] = None


class CrowdUpdateOut(BaseModel):
    type: Literal["CROWD_UPDATE"] = "CROWD_UPDATE"
    latitude: float
    longitude: float
    regions: list[CrowdRegion]
    source: Literal["cctv", "mock"] = "mock"
    timestamp: str = Field(default_factory=utc_now_iso)


class CrowdRegionsPushIn(BaseModel):
    """What the admin (Streamlit) app POSTs after running detection on
    the uploaded CCTV footage - real zones with real lat/lon bounds."""
    regions: list[CrowdRegion]


# ------------------------------------------------------------------
# Exit routing
# ------------------------------------------------------------------
class ExitGate(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    distance: float
    bearing: float


class ExitRequestIn(BaseModel):
    type: Literal["EXIT_REQUEST"]
    latitude: float
    longitude: float
    timestamp: Optional[str] = None


class ExitResponseOut(BaseModel):
    type: Literal["EXIT_RESPONSE"] = "EXIT_RESPONSE"
    success: bool
    exit: Optional[ExitGate] = None
    message: Optional[str] = None
    timestamp: str = Field(default_factory=utc_now_iso)


# ------------------------------------------------------------------
# SOS alerts
# ------------------------------------------------------------------
SosStatus = Literal["active", "resolved"]


class SosCreateIn(BaseModel):
    """What the mobile app POSTs when the user hits the SOS button."""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    note: Optional[str] = None


class SosAlertOut(BaseModel):
    """What the backend returns to both the mobile app (on create) and
    the control-room dashboard (on poll)."""
    id: int
    latitude: float
    longitude: float
    note: Optional[str] = None
    status: SosStatus
    created_at: str
    resolved_at: Optional[str] = None


class SosListOut(BaseModel):
    alerts: list[SosAlertOut]