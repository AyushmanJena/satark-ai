import base64
import logging
import queue
import threading
import time

import cv2
import numpy as np

import crowd_state
from detection import (
    RiskTracker,
    assign_zone_counts,
    build_grid,
    cell_area_m2,
    detect_persons,
    detect_persons_tiled,
    draw_zone_overlay,
    level_to_crowd_level,
    render_heatmap,
)

logger = logging.getLogger("satark.monitor")

PUSH_INTERVAL_SECONDS = 2.0


def encode_jpg_base64(frame_bgr) -> str:
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return ""
    return base64.b64encode(buf).decode("ascii")


def _push_regions_to_crowd_state(grid_cells, zone_rows):
    zone_row_by_id = {str(row["zone"]): row for row in zone_rows}
    regions = []
    for g in grid_cells:
        zone_row = zone_row_by_id.get(str(g["id"]))
        if zone_row is None:
            continue

        regions.append({
            "id": str(g["id"]),
            "level": level_to_crowd_level(zone_row["level"]),
            "north": g["lat_top"],
            "south": g["lat_bottom"],
            "east": g["lon_right"],
            "west": g["lon_left"],
            "density": zone_row.get("density"),
        })
    crowd_state.update_regions(regions)


class MonitorSession:
    def __init__(self, *, video_path: str, model, config: dict):
        self.video_path = video_path
        self.model = model
        self.config = config

        self.frame_width = 0
        self.frame_height = 0
        self.fps = 25.0

        self.aerial_mode = bool(config.get("aerial_mode"))
        self.conf_threshold = float(config.get("conf_threshold", 0.25))
        self.imgsz = int(config.get("imgsz", 640))
        self.tile_size = int(config.get("tile_size", 640))
        self.tile_overlap = float(config.get("tile_overlap", 0.2))

        self.grid_rows = int(config.get("grid_rows", 3))
        self.grid_cols = int(config.get("grid_cols", 3))
        self.top_left_lat = float(config.get("top_left_lat", 0))
        self.top_left_lon = float(config.get("top_left_lon", 0))
        self.bottom_right_lat = float(config.get("bottom_right_lat", 0))
        self.bottom_right_lon = float(config.get("bottom_right_lon", 0))
        self.use_real_area = not (
            self.top_left_lat == 0 and self.top_left_lon == 0
            and self.bottom_right_lat == 0 and self.bottom_right_lon == 0
        )
        self.low_threshold = float(config.get("low_threshold", 3))
        self.high_threshold = float(config.get("high_threshold", 8))

        self.decay = float(config.get("decay", 0.97))
        self.heatmap_only = bool(config.get("heatmap_only"))

        self.history_window_sec = float(config.get("history_window_sec", 15))
        self.eta_alert_sec = float(config.get("eta_alert_sec", 20))
        self.min_confirm_frames = int(config.get("min_confirm_frames", 3))

        self.push_to_backend = bool(config.get("push_to_backend", True))

        self.queue: queue.Queue = queue.Queue(maxsize=4)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

        probe = cv2.VideoCapture(self.video_path)
        ok, _ = probe.read()
        self.frame_width = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.frame_height = int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps = probe.get(cv2.CAP_PROP_FPS) or 25.0
        probe.release()
        if not ok:
            raise ValueError("Could not read video file")

        self.grid_cells = build_grid(
            self.frame_width, self.frame_height, self.grid_rows, self.grid_cols,
            self.top_left_lat, self.top_left_lon, self.bottom_right_lat, self.bottom_right_lon,
        )
        self.cell_area_m2 = cell_area_m2(self.grid_cells, self.use_real_area)

    def grid_cells_public(self):
        """Just the fields the frontend's `zones` message needs."""
        return [
            {"id": g["id"], "row": g["row"], "col": g["col"],
             "lat_top": g["lat_top"], "lat_bottom": g["lat_bottom"],
             "lon_left": g["lon_left"], "lon_right": g["lon_right"]}
            for g in self.grid_cells
        ]

    def start(self):
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def _emit(self, message: dict):
        try:
            self.queue.put(message, timeout=1.0)
        except queue.Full:
            logger.warning("Monitor queue full, dropping a frame update")

    def _run(self):
        try:
            cap = cv2.VideoCapture(self.video_path)
            heat_map = np.zeros((self.frame_height, self.frame_width), dtype=np.float32)
            risk_tracker = RiskTracker(
                self.grid_cells, self.fps, self.history_window_sec,
                self.eta_alert_sec, self.min_confirm_frames,
            )
            last_push_time = 0.0

            while cap.isOpened() and not self._stop_event.is_set():
                ret, frame = cap.read()
                if not ret:
                    break

                if self.aerial_mode:
                    boxes_xyxy, _ = detect_persons_tiled(
                        frame, self.model, self.conf_threshold, self.imgsz,
                        self.tile_size, self.tile_overlap
                    )
                else:
                    boxes_xyxy, _ = detect_persons(frame, self.model, self.conf_threshold, self.imgsz)

                heat_map *= self.decay
                zone_counts = assign_zone_counts(boxes_xyxy, self.grid_cells, heat_map,
                                                  self.frame_width, self.frame_height)

                zone_values = {g["id"]: zone_counts[g["id"]] for g in self.grid_cells}

                overlay = frame.copy()
                zone_rows, red_zones = draw_zone_overlay(
                    frame, overlay, self.grid_cells, zone_counts, zone_values,
                    self.low_threshold, self.high_threshold,
                )
                annotated = cv2.addWeighted(overlay, 0.35, frame, 0.65, 0)

                heat_display = render_heatmap(heat_map, frame, self.heatmap_only)

                now = time.time()
                risk_rows, active_alerts, chart = risk_tracker.update(
                    self.grid_cells, zone_values, self.high_threshold, now
                )

                push_status = None
                if self.push_to_backend and (now - last_push_time) >= PUSH_INTERVAL_SECONDS:
                    try:
                        _push_regions_to_crowd_state(self.grid_cells, zone_rows)
                        push_status = {"ok": True, "time": time.strftime("%H:%M:%S")}
                    except Exception as e:
                        push_status = {"ok": False, "message": str(e)}
                    last_push_time = now

                self._emit({
                    "type": "frame",
                    "frame": encode_jpg_base64(annotated),
                    "heatmap_frame": encode_jpg_base64(heat_display),
                    "total_count": int(sum(zone_counts.values())),
                    "red_zones": red_zones,
                    "zone_rows": zone_rows,
                    "risk_rows": risk_rows,
                    "alerts": active_alerts,
                    "chart": chart,
                    "push_status": push_status,
                })

                time.sleep(1 / self.fps)

            cap.release()

        except Exception as e:
            logger.exception("Monitor session crashed")
            self._emit({"type": "error", "message": str(e)})
        finally:
            self._emit(None)
