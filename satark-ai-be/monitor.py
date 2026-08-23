import asyncio
import json
import logging
import tempfile
import threading
import uuid

import cv2
from fastapi import APIRouter, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from ultralytics import YOLO

from monitor_session import MonitorSession, encode_jpg_base64

logger = logging.getLogger("satark.monitor.routes")
router = APIRouter()

_uploaded_videos: dict[str, str] = {}

_model_cache: dict[str, object] = {}
_model_cache_lock = threading.Lock()


def _load_model(model_path: str):
    with _model_cache_lock:
        if model_path not in _model_cache:
            logger.info("Loading YOLO model: %s", model_path)
            _model_cache[model_path] = YOLO(model_path)
        return _model_cache[model_path]


@router.post("/api/monitor/upload")
async def upload_video(video: UploadFile = File(...)):
    suffix = "." + video.filename.rsplit(".", 1)[-1] if video.filename and "." in video.filename else ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    contents = await video.read()
    tmp.write(contents)
    tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    ret, first_frame = cap.read()
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.release()

    if not ret:
        return JSONResponse(status_code=400, content={"detail": "Could not read uploaded video"})

    video_id = uuid.uuid4().hex
    _uploaded_videos[video_id] = tmp.name
    logger.info("Video uploaded: id=%s, %sx%s @ %.1f fps", video_id, width, height, fps)

    return {
        "video_id": video_id,
        "width": width,
        "height": height,
        "fps": fps,
        "first_frame": encode_jpg_base64(first_frame),
    }


@router.websocket("/ws/monitor")
async def monitor_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    session: MonitorSession | None = None

    try:
        raw = await websocket.receive_text()
        start_msg = json.loads(raw)

        if start_msg.get("type") != "start":
            await websocket.send_json({"type": "error", "message": "Expected a 'start' message first"})
            return

        video_path = _uploaded_videos.get(start_msg.get("video_id"))
        if not video_path:
            await websocket.send_json({"type": "error", "message": "Unknown video_id — upload the video again"})
            return

        model = _load_model(start_msg.get("model_path") or "yolov8n.pt")

        try:
            session = MonitorSession(video_path=video_path, model=model, config=start_msg)
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"Could not start session: {e}"})
            return

        await websocket.send_json({"type": "zones", "grid_cells": session.grid_cells_public()})
        session.start()
        logger.info("Monitor session started")

        async def drain_queue():
            """Forwards every message the session thread produces to the browser."""
            while True:
                message = await asyncio.to_thread(session.queue.get)
                if message is None:  # sentinel - session thread has finished
                    break
                await websocket.send_json(message)

        async def listen_for_stop():
            """Watches for the client sending {"type": "stop"} (or disconnecting)."""
            while True:
                raw_in = await websocket.receive_text()
                try:
                    data = json.loads(raw_in)
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "stop":
                    session.stop()
                    break

        drain_task = asyncio.create_task(drain_queue())
        listen_task = asyncio.create_task(listen_for_stop())

        _done, pending = await asyncio.wait({drain_task, listen_task}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

        await websocket.send_json({"type": "done"})
        logger.info("Monitor session finished")

    except WebSocketDisconnect:
        logger.info("Monitor client disconnected")
    except Exception as e:
        logger.exception("Monitor websocket error")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if session is not None:
            session.stop()