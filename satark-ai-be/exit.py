"""
/ws/exit — safest-exit routing for the mobile app.

Mirrors server2.js: on EXIT_REQUEST, finds the nearest hardcoded exit
gate and returns its distance + compass bearing from the user.

TODO(real-routing): "nearest" is a straight-line haversine distance
today. Once the control-room dashboard reports per-zone density
between the user and each gate, swap `find_best_exit()` for a
least-crowded-path calculation instead of pure distance.
"""
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import config
from geo import bearing_degrees, haversine_metres
from schemas import ExitGate, ExitRequestIn, ExitResponseOut

logger = logging.getLogger("satark.exit")
router = APIRouter()


def find_best_exit(latitude: float, longitude: float) -> ExitGate | None:
    if not config.EXIT_GATES:
        return None

    best_gate = min(
        config.EXIT_GATES,
        key=lambda gate: haversine_metres(latitude, longitude, gate["latitude"], gate["longitude"]),
    )

    distance = haversine_metres(latitude, longitude, best_gate["latitude"], best_gate["longitude"])
    bearing = bearing_degrees(latitude, longitude, best_gate["latitude"], best_gate["longitude"])

    return ExitGate(
        id=best_gate["id"],
        name=best_gate["name"],
        latitude=best_gate["latitude"],
        longitude=best_gate["longitude"],
        distance=round(distance),
        bearing=round(bearing),
    )


@router.websocket("/ws/exit")
async def exit_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("Client connected")

    try:
        while True:
            raw_message = await websocket.receive_text()

            try:
                message = ExitRequestIn.model_validate_json(raw_message)
            except Exception:
                logger.warning("Ignoring invalid message: %s", raw_message)
                await websocket.send_text(
                    ExitResponseOut(success=False, message="Invalid JSON message").model_dump_json()
                )
                continue

            exit_gate = find_best_exit(message.latitude, message.longitude)

            if exit_gate is None:
                await websocket.send_text(
                    ExitResponseOut(success=False, message="No exit available").model_dump_json()
                )
                continue

            response = ExitResponseOut(success=True, exit=exit_gate)
            await websocket.send_text(response.model_dump_json())
            logger.info("Sent exit response: %s", response.exit.name)

    except WebSocketDisconnect:
        logger.info("Client disconnected")