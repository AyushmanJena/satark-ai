
import itertools
import logging
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from schemas import SosAlertOut, SosCreateIn, SosListOut

logger = logging.getLogger("satark.sos")
router = APIRouter()

_lock = threading.Lock()
_alerts: dict[int, dict] = {}
_id_counter = itertools.count(1)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_out(alert: dict) -> SosAlertOut:
    return SosAlertOut(**alert)


@router.post("/api/sos", response_model=SosAlertOut)
def create_sos(payload: SosCreateIn) -> SosAlertOut:
    with _lock:
        alert_id = next(_id_counter)
        alert = {
            "id": alert_id,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "note": payload.note,
            "status": "active",
            "created_at": _utc_now_iso(),
            "resolved_at": None,
        }
        _alerts[alert_id] = alert

    logger.info("New SOS alert #%s at (%s, %s)", alert_id, payload.latitude, payload.longitude)
    return _to_out(alert)


@router.get("/api/sos/active", response_model=SosListOut)
def list_active_sos() -> SosListOut:
    with _lock:
        active = [_to_out(a) for a in _alerts.values() if a["status"] == "active"]
    return SosListOut(alerts=active)


@router.get("/api/sos/all", response_model=SosListOut)
def list_all_sos() -> SosListOut:
    with _lock:
        all_alerts = [_to_out(a) for a in _alerts.values()]
    return SosListOut(alerts=all_alerts)


@router.post("/api/sos/{alert_id}/resolve", response_model=SosAlertOut)
def resolve_sos(alert_id: int) -> SosAlertOut:
    with _lock:
        alert = _alerts.get(alert_id)
        if alert is None:
            raise HTTPException(status_code=404, detail="Alert not found")
        if alert["status"] != "active":
            raise HTTPException(status_code=409, detail="Alert already resolved")

        alert["status"] = "resolved"
        alert["resolved_at"] = _utc_now_iso()

    logger.info("Resolved SOS alert #%s", alert_id)
    return _to_out(alert)