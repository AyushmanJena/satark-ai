"""
Pure crowd-detection logic — grid math, YOLO inference, density/heatmap/
risk calculations. No FastAPI, no threading, no I/O beyond reading a
video frame that's handed to it. Ported line-for-line in behavior from
the old Streamlit main.py so results don't change, just where the code
runs.

monitor_session.py calls into this on a background thread; monitor.py
never touches these functions directly.
"""
import math
from collections import deque

import cv2
import numpy as np


# =========================================================
# Geometry
# =========================================================
def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def build_grid(frame_width, frame_height, grid_rows, grid_cols,
                top_left_lat, top_left_lon, bottom_right_lat, bottom_right_lon):
    """Same grid-building loop as main.py - pixel bounds + real-world lat/lon
    bounds for each zone, laid out row-major."""
    cell_w_px = frame_width / grid_cols
    cell_h_px = frame_height / grid_rows

    grid_cells = []
    for r in range(grid_rows):
        for c in range(grid_cols):
            px1 = int(c * cell_w_px)
            py1 = int(r * cell_h_px)
            px2 = int((c + 1) * cell_w_px)
            py2 = int((r + 1) * cell_h_px)

            lat_top = top_left_lat + (bottom_right_lat - top_left_lat) * (r / grid_rows)
            lat_bottom = top_left_lat + (bottom_right_lat - top_left_lat) * ((r + 1) / grid_rows)
            lon_left = top_left_lon + (bottom_right_lon - top_left_lon) * (c / grid_cols)
            lon_right = top_left_lon + (bottom_right_lon - top_left_lon) * ((c + 1) / grid_cols)

            grid_cells.append({
                "id": r * grid_cols + c + 1,
                "row": r, "col": c,
                "px1": px1, "py1": py1, "px2": px2, "py2": py2,
                "lat_top": lat_top, "lat_bottom": lat_bottom,
                "lon_left": lon_left, "lon_right": lon_right,
            })
    return grid_cells


def cell_area_m2(grid_cells, use_real_area):
    """Real-world area (m²) of one grid cell, or None if not using real coords."""
    if not use_real_area or not grid_cells:
        return None
    g0 = grid_cells[0]
    width_m = haversine_m(g0["lat_top"], g0["lon_left"], g0["lat_top"], g0["lon_right"])
    height_m = haversine_m(g0["lat_top"], g0["lon_left"], g0["lat_bottom"], g0["lon_left"])
    return width_m * height_m


# =========================================================
# Detection
# =========================================================
def merge_boxes_nms(boxes, scores, iou_threshold=0.4, score_threshold=0.01):
    """Merge overlapping boxes (e.g. from adjacent tiles) with OpenCV NMS."""
    if len(boxes) == 0:
        return np.empty((0, 4)), np.empty((0,))
    bboxes_xywh = [[int(b[0]), int(b[1]), int(b[2] - b[0]), int(b[3] - b[1])] for b in boxes]
    indices = cv2.dnn.NMSBoxes(bboxes_xywh, list(map(float, scores)), score_threshold, iou_threshold)
    if len(indices) == 0:
        return np.empty((0, 4)), np.empty((0,))
    indices = np.array(indices).flatten()
    return boxes[indices], np.array(scores)[indices]


def detect_persons(frame, model, conf, imgsz):
    """Standard single-pass detection (good for normal CCTV / eye-level footage)."""
    results = model(frame, classes=[0], conf=conf, imgsz=imgsz, verbose=False)
    b = results[0].boxes
    if len(b) == 0:
        return np.empty((0, 4)), np.empty((0,))
    return b.xyxy.cpu().numpy(), b.conf.cpu().numpy()


def detect_persons_tiled(frame, model, conf, imgsz, tile_size, overlap):
    """
    Slicing-aided inference for drone / aerial footage. A single full-frame
    pass shrinks a wide aerial shot down to `imgsz` px, so people who are
    already small top-down blobs lose almost all their pixels and get
    missed. Instead we run the model on overlapping tiles at full
    resolution and merge the results with NMS.
    """
    h, w = frame.shape[:2]
    if h <= tile_size and w <= tile_size:
        return detect_persons(frame, model, conf, imgsz)

    step = max(1, int(tile_size * (1 - overlap)))
    all_boxes, all_scores = [], []

    y = 0
    while True:
        y1 = max(0, min(y, h - tile_size)) if h > tile_size else 0
        y2 = min(y1 + tile_size, h)
        x = 0
        while True:
            x1 = max(0, min(x, w - tile_size)) if w > tile_size else 0
            x2 = min(x1 + tile_size, w)
            tile = frame[y1:y2, x1:x2]
            if tile.shape[0] >= 10 and tile.shape[1] >= 10:
                tb, ts = detect_persons(tile, model, conf, imgsz)
                if len(tb):
                    tb = tb.copy()
                    tb[:, [0, 2]] += x1
                    tb[:, [1, 3]] += y1
                    all_boxes.append(tb)
                    all_scores.append(ts)
            if x2 >= w:
                break
            x += step
        if y2 >= h:
            break
        y += step

    if not all_boxes:
        return np.empty((0, 4)), np.empty((0,))
    return merge_boxes_nms(np.vstack(all_boxes), np.concatenate(all_scores))


def assign_zone_counts(boxes_xyxy, grid_cells, heat_map, frame_width, frame_height):
    """
    For each detected box, take its foot point (bottom-center), stamp it
    onto the heatmap, and count it into whichever zone contains it.
    Returns {zone_id: count}.
    """
    zone_counts = {g["id"]: 0 for g in grid_cells}

    for box in boxes_xyxy:
        bx1, by1, bx2, by2 = box
        foot_x = (bx1 + bx2) / 2
        foot_y = by2

        fx = int(np.clip(foot_x, 0, frame_width - 1))
        fy = int(np.clip(foot_y, 0, frame_height - 1))
        cv2.circle(heat_map, (fx, fy), 18, 1.0, -1)

        for g in grid_cells:
            if g["px1"] <= foot_x < g["px2"] and g["py1"] <= foot_y < g["py2"]:
                zone_counts[g["id"]] += 1
                break

    return zone_counts


# =========================================================
# Density / level
# =========================================================
def density_bgr_color(value, low_threshold, high_threshold):
    if value > high_threshold:
        return (0, 0, 255)      # red (BGR)
    elif value > low_threshold:
        return (0, 255, 255)    # yellow
    else:
        return (0, 200, 0)      # green


def level_label(value, low_threshold, high_threshold):
    if value > high_threshold:
        return "High"
    elif value > low_threshold:
        return "Medium"
    return "Low"


def level_to_crowd_level(level_label_str):
    """Maps High/Medium/Low to the mobile app's CrowdLevel type (low/moderate/extreme)."""
    return {"High": "extreme", "Medium": "moderate", "Low": "low"}.get(level_label_str, "low")


def draw_zone_overlay(frame, overlay, grid_cells, zone_counts, zone_values, low_threshold, high_threshold):
    """Draws the colored zone rectangles + labels. Returns (zone_rows, red_zones)."""
    zone_rows = []
    red_zones = 0

    for g in grid_cells:
        value = zone_values[g["id"]]
        count = zone_counts[g["id"]]
        color = density_bgr_color(value, low_threshold, high_threshold)
        level = level_label(value, low_threshold, high_threshold)
        if level == "High":
            red_zones += 1

        cv2.rectangle(overlay, (g["px1"], g["py1"]), (g["px2"], g["py2"]), color, -1)
        cv2.rectangle(frame, (g["px1"], g["py1"]), (g["px2"], g["py2"]), color, 2)
        cv2.putText(frame, f"Z{g['id']}: {count}", (g["px1"] + 5, g["py1"] + 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

        zone_rows.append({
            "zone": g["id"],
            "count": count,
            "density": round(value, 3),
            "level": level,
        })

    return zone_rows, red_zones


def render_heatmap(heat_map, frame, heatmap_only):
    """Blurs + colormaps the accumulated heatmap, optionally blended over the frame."""
    blurred = cv2.GaussianBlur(heat_map, (0, 0), sigmaX=15)
    max_val = blurred.max()
    norm = (blurred / max_val * 255).astype(np.uint8) if max_val > 0 else blurred.astype(np.uint8)
    color_heat = cv2.applyColorMap(norm, cv2.COLORMAP_JET)
    return color_heat if heatmap_only else cv2.addWeighted(color_heat, 0.6, frame, 0.4, 0)


# =========================================================
# Risk prediction
# =========================================================
class RiskTracker:
    """
    Per-zone rolling history + trend fitting, so a zone climbing fast
    toward the high-density threshold gets flagged before it actually
    crosses it. One instance per monitor session (holds state across
    frames), stateless otherwise.
    """

    def __init__(self, grid_cells, fps, history_window_sec, eta_alert_sec, min_confirm_frames):
        self.history_window_sec = history_window_sec
        self.eta_alert_sec = eta_alert_sec
        self.min_confirm_frames = min_confirm_frames

        self.history = {g["id"]: deque() for g in grid_cells}
        chart_maxlen = max(50, int(history_window_sec * fps))
        self.chart_history = {g["id"]: deque(maxlen=chart_maxlen) for g in grid_cells}
        self.rising_streak = {g["id"]: 0 for g in grid_cells}

    def update(self, grid_cells, zone_values, high_threshold, now):
        """Returns (risk_rows, active_alerts, chart_dict)."""
        active_alerts = []
        risk_rows = []

        for g in grid_cells:
            zid = g["id"]
            value = zone_values[zid]

            self.history[zid].append((now, value))
            while self.history[zid] and now - self.history[zid][0][0] > self.history_window_sec:
                self.history[zid].popleft()
            self.chart_history[zid].append(value)

            slope = 0.0
            if len(self.history[zid]) >= 3:
                times = np.array([t for t, _ in self.history[zid]])
                vals = np.array([v for _, v in self.history[zid]])
                span = times.max() - times.min()
                if span > 0.5:
                    slope = float(np.polyfit(times - times.min(), vals, 1)[0])

            if slope > 1e-4:
                self.rising_streak[zid] += 1
            else:
                self.rising_streak[zid] = 0

            trend = "Rising" if slope > 1e-4 else ("Falling" if slope < -1e-4 else "Stable")

            eta = None
            if slope > 1e-4 and value < high_threshold:
                eta = (high_threshold - value) / slope

            confirmed_rising = self.rising_streak[zid] >= self.min_confirm_frames
            predicted_alert = confirmed_rising and eta is not None and eta <= self.eta_alert_sec
            already_high = value > high_threshold

            if predicted_alert:
                active_alerts.append(f"Zone {zid}: predicted to reach High density in ~{eta:.0f}s")
            elif already_high and confirmed_rising:
                active_alerts.append(f"Zone {zid}: already High and still rising — crush risk")

            risk_rows.append({
                "zone": zid,
                "density": round(value, 3),
                "trend": trend,
                "slope": round(slope, 4),
                "eta": f"~{eta:.0f}s" if eta is not None else None,
                "risk": "Predicted Crush" if predicted_alert
                        else ("High & Rising" if already_high and confirmed_rising
                              else ("Watch" if already_high else "Normal")),
            })

        top_zone_ids = sorted(zone_values, key=lambda k: zone_values[k], reverse=True)[:4]
        chart = {
            "labels": list(range(len(self.chart_history[top_zone_ids[0]]))) if top_zone_ids else [],
            "series": {f"Zone {zid}": list(self.chart_history[zid]) for zid in top_zone_ids},
        }

        return risk_rows, active_alerts, chart