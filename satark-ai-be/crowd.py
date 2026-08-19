"""
/ws/crowd - crowd density feed for the mobile app.
POST /api/crowd/regions - where the admin app pushes real zone data
after running YOLO detection on uploaded CCTV footage.

The websocket should stream the exact admin-defined regions stored in
crowd_state, so the mobile frontend can render the same cells regardless
of the device's current location.
"""
import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import config
import crowd_state
from schemas import CrowdRegion, CrowdRegionsPushIn, CrowdUpdateOut

logger = logging.getLogger("satark.crowd")
router = APIRouter()


def _current_regions() -> tuple[list[CrowdRegion], str]:
    """
    Return the latest backend-defined regions.

    If fresh admin data exists, mark it as CCTV-backed. If there is
    stored data but it is stale, still return the same geometry so the
    mobile app keeps showing the admin-defined area, but label it as a
    mock/stale fallback.
    """
    regions = [CrowdRegion.model_validate(region) for region in crowd_state.get_regions_payload()]

    if not regions:
        return [], "mock"

    if crowd_state.has_fresh_regions():
        return regions, "cctv"

    return regions, "mock"


async def _send_periodic_updates(websocket: WebSocket) -> None:
    """Push the latest regions at the configured interval."""
    while True:
        await asyncio.sleep(config.CROWD_UPDATE_INTERVAL_SECONDS)

        regions, source = _current_regions()
        update = CrowdUpdateOut(
            latitude=0.0,
            longitude=0.0,
            regions=regions,
            source=source,
        )
        await websocket.send_text(update.model_dump_json())
        logger.info("Sent crowd update (%s) with %s regions", source, len(regions))


@router.websocket("/ws/crowd")
async def crowd_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("Client connected")

    periodic_task = asyncio.create_task(_send_periodic_updates(websocket))

    try:
        regions, source = _current_regions()
        await websocket.send_text(
            CrowdUpdateOut(
                latitude=0.0,
                longitude=0.0,
                regions=regions,
                source=source,
            ).model_dump_json()
        )

        while True:
            try:
                raw_message = await websocket.receive_text()
            except WebSocketDisconnect:
                raise

            logger.info("Ignoring client message on /ws/crowd: %s", raw_message)

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    finally:
        periodic_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await periodic_task


# ------------------------------------------------------------------
# Admin push endpoint - the admin app calls this after each detection
# pass on the uploaded CCTV footage.
# ------------------------------------------------------------------
@router.post("/api/crowd/regions")
def push_crowd_regions(payload: CrowdRegionsPushIn):
    regions = [r.model_dump(exclude_none=True) for r in payload.regions]
    crowd_state.update_regions(regions)
    return {"status": "ok", "region_count": len(regions)}
