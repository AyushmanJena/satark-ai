/* =========================================================================
   CrowdShield admin dashboard — frontend only.

   This file assumes the FastAPI backend exposes the following endpoints.
   The three under "EXISTING" match main.py exactly (same paths, same
   payload shape). The two under "NEW — needs implementing" replace the
   in-process Streamlit video loop (OpenCV + YOLO) that used to run
   frame-by-frame inside the Python script; that compute has to live on
   the server now, so the dashboard talks to it over HTTP (upload) and a
   WebSocket (live per-frame results) instead of drawing straight into a
   Streamlit widget.

   EXISTING (unchanged, called straight from the browser):
     GET  {backendUrl}/api/sos/active            -> { alerts: [...] }
     POST {backendUrl}/api/sos/{id}/resolve      -> resolves an alert
     POST {backendUrl}/api/crowd/regions         -> pushed by the SERVER
                                                     during a monitor
                                                     session, not by this
                                                     file — kept here only
                                                     as a comment for
                                                     context.

   NEW — needs implementing on the FastAPI side:
     POST {backendUrl}/api/monitor/upload
       multipart/form-data, field "video"
       -> { video_id, width, height, fps, first_frame: "<base64 jpg>" }

     WS   {backendUrl (ws://)}/ws/monitor
       Client -> server:
         { type: "start", video_id, grid_rows, grid_cols,
           top_left_lat, top_left_lon, bottom_right_lat, bottom_right_lon,
           low_threshold, high_threshold, aerial_mode, model_path,
           conf_threshold, imgsz, tile_size, tile_overlap,
           push_to_backend, backend_url, decay, heatmap_only,
           history_window_sec, eta_alert_sec, min_confirm_frames }
         { type: "stop" }

       Server -> client:
         { type: "zones", grid_cells: [{ id, row, col, lat_top, lat_bottom,
                                          lon_left, lon_right }] }
         { type: "frame",
           frame: "<base64 jpg>", heatmap_frame: "<base64 jpg>",
           total_count, red_zones,
           zone_rows: [{ zone, count, density, level }],
           risk_rows: [{ zone, density, trend, slope, eta, risk }],
           alerts: ["..."],
           chart: { labels: [...], series: { "Zone 1": [...], ... } },
           push_status: { ok: true|false, message: "...", time: "HH:MM:SS" } }
         { type: "done" }
         { type: "error", message: "..." }

   Everything below degrades gracefully (clear inline errors, no crashes)
   if those two endpoints aren't wired up yet.
   ========================================================================= */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
     DOM refs
     --------------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const backendUrlInput = $("backendUrl");
  const pushToBackendChk = $("pushToBackend");
  const connDot = $("connDot");
  const connLabel = $("connLabel");

  const fileDrop = $("fileDrop");
  const videoFileInput = $("videoFile");
  const fileDropText = $("fileDropText");
  const fileMeta = $("fileMeta");

  const aerialModeChk = $("aerialMode");
  const tileFields = $("tileFields");
  const modelPathInput = $("modelPath");
  const confThreshold = $("confThreshold");
  const confVal = $("confVal");
  const imgszSelect = $("imgsz");
  const tileSizeSelect = $("tileSize");
  const tileOverlap = $("tileOverlap");
  const tileOverlapVal = $("tileOverlapVal");

  const gridRowsInput = $("gridRows");
  const gridColsInput = $("gridCols");

  // Setup tab
  const setupEmpty = $("setupEmpty");
  const setupContent = $("setupContent");
  const firstFrameImg = $("firstFrame");
  const frameCaption = $("frameCaption");
  const tlLat = $("tlLat"), tlLon = $("tlLon"), brLat = $("brLat"), brLon = $("brLon");
  const zoneCountNote = $("zoneCountNote");
  const lowThresholdInput = $("lowThreshold");
  const highThresholdInput = $("highThreshold");
  const zoneTableHeading = $("zoneTableHeading");
  const zoneCoordTable = $("zoneCoordTable").querySelector("tbody");
  const coordsWarning = $("coordsWarning");

  // Monitor tab
  const monitorEmpty = $("monitorEmpty");
  const monitorContent = $("monitorContent");
  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const totalCountEl = $("totalCount");
  const redZonesEl = $("redZones");
  const pushStatusEl = $("pushStatus");
  const monitorFrame = $("monitorFrame");
  const videoPlaceholder = $("videoPlaceholder");
  const zoneLiveTable = $("zoneLiveTable").querySelector("tbody");

  // Heatmap tab
  const heatmapEmpty = $("heatmapEmpty");
  const heatmapContent = $("heatmapContent");
  const decaySlider = $("decay");
  const decayVal = $("decayVal");
  const heatmapOnlyChk = $("heatmapOnly");
  const heatmapFrame = $("heatmapFrame");
  const heatmapPlaceholder = $("heatmapPlaceholder");

  // Risk tab
  const riskEmpty = $("riskEmpty");
  const riskContent = $("riskContent");
  const historyWindow = $("historyWindow");
  const historyWindowVal = $("historyWindowVal");
  const etaAlert = $("etaAlert");
  const etaAlertVal = $("etaAlertVal");
  const minConfirm = $("minConfirm");
  const minConfirmVal = $("minConfirmVal");
  const riskBanner = $("riskBanner");
  const riskTable = $("riskTable").querySelector("tbody");

  // SOS tab
  const sosLiveChk = $("sosLive");
  const sosRefreshBtn = $("sosRefresh");
  const sosLastChecked = $("sosLastChecked");
  const sosBody = $("sosBody");
  const sosMapWrap = $("sosMapWrap");

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */
  const state = {
    videoId: null,
    videoName: null,
    frameWidth: 0,
    frameHeight: 0,
    ws: null,
    running: false,
    sosTimer: null,
    sosMap: null,
    sosMarkers: [],
    riskChart: null,
  };

  const backendUrl = () => backendUrlInput.value.trim().replace(/\/+$/, "");
  const wsUrl = () => backendUrl().replace(/^http/i, "ws") + "/ws/monitor";

  /* ---------------------------------------------------------------------
     Tabs
     --------------------------------------------------------------------- */
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = {
    setup: $("panel-setup"),
    monitor: $("panel-monitor"),
    heatmap: $("panel-heatmap"),
    risk: $("panel-risk"),
    sos: $("panel-sos"),
  };

  function activateTab(name) {
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle("active", key === name));
    if (name === "risk" && state.riskChart) state.riskChart.resize();
    if (name === "sos" && state.sosMap) setTimeout(() => state.sosMap.invalidateSize(), 50);
  }

  tabs.forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

  /* ---------------------------------------------------------------------
     Sidebar dynamic bits
     --------------------------------------------------------------------- */
  aerialModeChk.addEventListener("change", () => {
    tileFields.classList.toggle("hidden", !aerialModeChk.checked);
    confThreshold.value = aerialModeChk.checked ? 0.15 : 0.25;
    imgszSelect.value = aerialModeChk.checked ? 960 : 640;
    confVal.textContent = Number(confThreshold.value).toFixed(2);
  });

  confThreshold.addEventListener("input", () => { confVal.textContent = Number(confThreshold.value).toFixed(2); });
  tileOverlap.addEventListener("input", () => { tileOverlapVal.textContent = Number(tileOverlap.value).toFixed(2); });
  decaySlider.addEventListener("input", () => { decayVal.textContent = Number(decaySlider.value).toFixed(3); });
  historyWindow.addEventListener("input", () => { historyWindowVal.textContent = historyWindow.value; });
  etaAlert.addEventListener("input", () => { etaAlertVal.textContent = etaAlert.value; });
  minConfirm.addEventListener("input", () => { minConfirmVal.textContent = minConfirm.value; });

  [gridRowsInput, gridColsInput, tlLat, tlLon, brLat, brLon].forEach((el) =>
    el.addEventListener("input", renderZoneTable)
  );

  /* ---------------------------------------------------------------------
     Connection status pill
     --------------------------------------------------------------------- */
  function setConnStatus(kind, label) {
    connDot.className = "dot" + (kind ? " " + kind : "");
    connLabel.textContent = label;
  }

  /* ---------------------------------------------------------------------
     Grid math — mirrors haversine_m() / the grid-building loop in main.py.
     Pure client-side; only needs rows/cols + corner lat/lon, not pixels,
     so the zone-coordinate table renders immediately without a backend
     round-trip.
     --------------------------------------------------------------------- */
  function buildGrid() {
    const rows = Math.max(1, parseInt(gridRowsInput.value || "1", 10));
    const cols = Math.max(1, parseInt(gridColsInput.value || "1", 10));
    const t = { lat: parseFloat(tlLat.value) || 0, lon: parseFloat(tlLon.value) || 0 };
    const b = { lat: parseFloat(brLat.value) || 0, lon: parseFloat(brLon.value) || 0 };

    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const latTop = t.lat + (b.lat - t.lat) * (r / rows);
        const latBottom = t.lat + (b.lat - t.lat) * ((r + 1) / rows);
        const lonLeft = t.lon + (b.lon - t.lon) * (c / cols);
        const lonRight = t.lon + (b.lon - t.lon) * ((c + 1) / cols);
        cells.push({ id: r * cols + c + 1, row: r, col: c, latTop, latBottom, lonLeft, lonRight });
      }
    }
    return { rows, cols, cells };
  }

  function renderZoneTable() {
    const { rows, cols, cells } = buildGrid();
    zoneCountNote.textContent = `Total zones: ${rows * cols} (set rows/cols in the sidebar)`;
    zoneTableHeading.textContent = `Zone coordinates (${rows}×${cols} grid = ${rows * cols} zones)`;

    zoneCoordTable.innerHTML = cells
      .map(
        (g) => `<tr>
          <td>${g.id}</td>
          <td>(${g.latTop.toFixed(6)}, ${g.lonLeft.toFixed(6)})</td>
          <td>(${g.latBottom.toFixed(6)}, ${g.lonRight.toFixed(6)})</td>
        </tr>`
      )
      .join("");

    const coordsSet = !(
      parseFloat(tlLat.value) === 0 &&
      parseFloat(tlLon.value) === 0 &&
      parseFloat(brLat.value) === 0 &&
      parseFloat(brLon.value) === 0
    );
    coordsWarning.style.display = coordsSet ? "none" : "block";
  }

  /* ---------------------------------------------------------------------
     Video upload
     --------------------------------------------------------------------- */
  fileDrop.addEventListener("click", () => videoFileInput.click());
  ["dragover", "dragenter"].forEach((ev) =>
    fileDrop.addEventListener(ev, (e) => { e.preventDefault(); fileDrop.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    fileDrop.addEventListener(ev, (e) => { e.preventDefault(); fileDrop.classList.remove("dragover"); })
  );
  fileDrop.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleVideoFile(file);
  });
  videoFileInput.addEventListener("change", () => {
    if (videoFileInput.files[0]) handleVideoFile(videoFileInput.files[0]);
  });

  async function handleVideoFile(file) {
    state.videoName = file.name;
    fileDropText.textContent = file.name;
    fileMeta.textContent = "Uploading…";

    const form = new FormData();
    form.append("video", file);

    try {
      const res = await fetch(`${backendUrl()}/api/monitor/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();

      state.videoId = data.video_id;
      state.frameWidth = data.width;
      state.frameHeight = data.height;

      fileMeta.textContent = `${data.width}×${data.height} @ ${Math.round(data.fps || 0)} fps`;
      if (data.first_frame) firstFrameImg.src = `data:image/jpeg;base64,${data.first_frame}`;
      frameCaption.textContent = `Frame size: ${data.width} x ${data.height}`;

      revealContent();
      renderZoneTable();
    } catch (err) {
      fileMeta.textContent = `Could not reach backend for upload: ${err.message}`;
      // Still let the operator configure zones/thresholds even if the
      // upload endpoint isn't live yet.
      revealContent();
      renderZoneTable();
    }
  }

  function revealContent() {
    setupEmpty.classList.add("hidden");
    setupContent.classList.remove("hidden");
    monitorEmpty.classList.add("hidden");
    monitorContent.classList.remove("hidden");
    heatmapEmpty.classList.add("hidden");
    heatmapContent.classList.remove("hidden");
    riskEmpty.classList.add("hidden");
    riskContent.classList.remove("hidden");
  }

  /* ---------------------------------------------------------------------
     Live Monitor — WebSocket session
     --------------------------------------------------------------------- */
  function currentConfig() {
    const { rows, cols } = buildGrid();
    return {
      type: "start",
      video_id: state.videoId,
      grid_rows: rows,
      grid_cols: cols,
      top_left_lat: parseFloat(tlLat.value) || 0,
      top_left_lon: parseFloat(tlLon.value) || 0,
      bottom_right_lat: parseFloat(brLat.value) || 0,
      bottom_right_lon: parseFloat(brLon.value) || 0,
      low_threshold: parseInt(lowThresholdInput.value, 10) || 0,
      high_threshold: parseInt(highThresholdInput.value, 10) || 0,
      aerial_mode: aerialModeChk.checked,
      model_path: modelPathInput.value,
      conf_threshold: parseFloat(confThreshold.value),
      imgsz: parseInt(imgszSelect.value, 10),
      tile_size: parseInt(tileSizeSelect.value, 10),
      tile_overlap: parseFloat(tileOverlap.value),
      push_to_backend: pushToBackendChk.checked,
      backend_url: backendUrl(),
      decay: parseFloat(decaySlider.value),
      heatmap_only: heatmapOnlyChk.checked,
      history_window_sec: parseInt(historyWindow.value, 10),
      eta_alert_sec: parseInt(etaAlert.value, 10),
      min_confirm_frames: parseInt(minConfirm.value, 10),
    };
  }

  startBtn.addEventListener("click", () => {
    if (!state.videoId) {
      setConnStatus("error", "Upload a video first");
      return;
    }
    try {
      const socket = new WebSocket(wsUrl());
      state.ws = socket;

      socket.addEventListener("open", () => {
        state.running = true;
        setConnStatus("live", "Streaming");
        videoPlaceholder.classList.add("hidden");
        heatmapPlaceholder.classList.add("hidden");
        socket.send(JSON.stringify(currentConfig()));
      });

      socket.addEventListener("message", (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }
        handleWsMessage(msg);
      });

      socket.addEventListener("close", () => {
        state.running = false;
        setConnStatus(null, "Not connected");
      });

      socket.addEventListener("error", () => {
        setConnStatus("error", "Connection failed — is the /ws/monitor endpoint live?");
      });
    } catch (err) {
      setConnStatus("error", err.message);
    }
  });

  stopBtn.addEventListener("click", () => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "stop" }));
      state.ws.close();
    }
    state.running = false;
    setConnStatus(null, "Not connected");
  });

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "zones":
        renderBackendZones(msg.grid_cells);
        break;
      case "frame":
        renderFrame(msg);
        break;
      case "done":
        setConnStatus(null, "Finished");
        break;
      case "error":
        setConnStatus("error", msg.message || "Backend error");
        break;
    }
  }

  function renderBackendZones(cells) {
    if (!cells || !cells.length) return;
    zoneTableHeading.textContent = `Zone coordinates (${cells.length} zones)`;
    zoneCoordTable.innerHTML = cells
      .map(
        (g) => `<tr>
          <td>${g.id}</td>
          <td>(${Number(g.lat_top).toFixed(6)}, ${Number(g.lon_left).toFixed(6)})</td>
          <td>(${Number(g.lat_bottom).toFixed(6)}, ${Number(g.lon_right).toFixed(6)})</td>
        </tr>`
      )
      .join("");
  }

  function levelClass(level) {
    if (level === "High") return "level-high";
    if (level === "Medium") return "level-med";
    return "level-low";
  }

  function riskClass(risk) {
    if (!risk) return "";
    if (risk.includes("Crush")) return "level-high";
    if (risk.includes("Rising")) return "level-high";
    if (risk.includes("Watch")) return "level-med";
    return "level-low";
  }

  function renderFrame(msg) {
    if (msg.frame) monitorFrame.src = `data:image/jpeg;base64,${msg.frame}`;
    if (msg.heatmap_frame) heatmapFrame.src = `data:image/jpeg;base64,${msg.heatmap_frame}`;

    if (typeof msg.total_count === "number") totalCountEl.textContent = msg.total_count;
    if (typeof msg.red_zones === "number") redZonesEl.textContent = msg.red_zones;

    if (Array.isArray(msg.zone_rows)) {
      zoneLiveTable.innerHTML = msg.zone_rows
        .map(
          (z) => `<tr>
            <td>Z${z.zone}</td><td>${z.count}</td><td>${z.density}</td>
            <td class="${levelClass(z.level)}">${z.level}</td>
          </tr>`
        )
        .join("");
    }

    if (Array.isArray(msg.risk_rows)) {
      riskTable.innerHTML = msg.risk_rows
        .map(
          (r) => `<tr>
            <td>Z${r.zone}</td><td>${r.density}</td><td>${r.trend}</td>
            <td>${r.slope}</td><td>${r.eta || "—"}</td>
            <td class="${riskClass(r.risk)}">${r.risk}</td>
          </tr>`
        )
        .join("");
    }

    if (Array.isArray(msg.alerts) && msg.alerts.length) {
      riskBanner.textContent = "⚠️ " + msg.alerts.join("  |  ");
      riskBanner.className = "banner banner-danger";
    } else {
      riskBanner.textContent = "No zones currently trending toward high density.";
      riskBanner.className = "banner banner-success";
    }

    if (msg.push_status) {
      pushStatusEl.style.display = "block";
      pushStatusEl.textContent = msg.push_status.ok
        ? `Pushed zone data to backend at ${msg.push_status.time || ""}`
        : `Backend push failed: ${msg.push_status.message || "unknown error"}`;
      pushStatusEl.className = "banner " + (msg.push_status.ok ? "banner-success" : "banner-danger");
    }

    if (msg.chart) updateRiskChart(msg.chart);
  }

  /* ---------------------------------------------------------------------
     Risk trend chart (top zones by current reading)
     --------------------------------------------------------------------- */
  const CHART_COLORS = ["#F2C14E", "#3ECF8E", "#6EA8FE", "#F0616B"];

  function ensureChart() {
    if (state.riskChart) return state.riskChart;
    const ctx = $("riskChart").getContext("2d");
    state.riskChart = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#a3a5b3", font: { family: "Inter", size: 11 } } },
        },
        scales: {
          x: { ticks: { color: "#5f6270", font: { size: 10 } }, grid: { color: "#1c1f2b" } },
          y: { ticks: { color: "#5f6270", font: { size: 10 } }, grid: { color: "#1c1f2b" }, beginAtZero: true },
        },
      },
    });
    return state.riskChart;
  }

  function updateRiskChart(chart) {
    if (typeof Chart === "undefined") return;
    const c = ensureChart();
    c.data.labels = chart.labels || [];
    const zoneNames = Object.keys(chart.series || {});
    c.data.datasets = zoneNames.map((name, i) => ({
      label: name,
      data: chart.series[name],
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
    }));
    c.update("none");
  }

  /* ---------------------------------------------------------------------
     SOS Alerts tab
     --------------------------------------------------------------------- */
  function ensureSosMap() {
    if (state.sosMap || typeof L === "undefined") return state.sosMap;
    state.sosMap = L.map("sosMap", { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.sosMap);
    return state.sosMap;
  }

  function renderSosMap(alerts) {
    const map = ensureSosMap();
    if (!map) return;
    state.sosMarkers.forEach((m) => map.removeLayer(m));
    state.sosMarkers = [];

    if (!alerts.length) { sosMapWrap.classList.add("hidden"); return; }
    sosMapWrap.classList.remove("hidden");
    setTimeout(() => map.invalidateSize(), 50);

    const bounds = [];
    alerts.forEach((a) => {
      const marker = L.circleMarker([a.latitude, a.longitude], {
        radius: 8,
        color: "#DC2626",
        weight: 2,
        fillColor: "#DC2626",
        fillOpacity: 0.55,
      }).addTo(map);
      marker.bindPopup(`Alert #${a.id}`);
      state.sosMarkers.push(marker);
      bounds.push([a.latitude, a.longitude]);
    });
    if (bounds.length === 1) map.setView(bounds[0], 14);
    else map.fitBounds(bounds, { padding: [30, 30] });
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour12: false });
    } catch {
      return "unknown time";
    }
  }

  async function fetchActiveSos() {
    try {
      const res = await fetch(`${backendUrl()}/api/sos/active`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { alerts: data.alerts || [], error: null };
    } catch (err) {
      return { alerts: [], error: err.message };
    }
  }

  async function resolveSosAlert(id) {
    try {
      const res = await fetch(`${backendUrl()}/api/sos/${id}/resolve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function refreshSos() {
    const { alerts, error } = await fetchActiveSos();
    sosLastChecked.textContent = `Last checked: ${new Date().toLocaleTimeString([], { hour12: false })}`;

    if (error) {
      sosBody.innerHTML = `<p class="banner banner-danger">Could not reach backend: ${error}</p>`;
      sosMapWrap.classList.add("hidden");
      return;
    }

    if (!alerts.length) {
      sosBody.innerHTML = `<p class="banner banner-success">No active SOS alerts.</p>`;
      sosMapWrap.classList.add("hidden");
      return;
    }

    sosBody.innerHTML =
      `<p class="banner" style="color:var(--accent-strong); background:var(--warning-dim); border-color:rgba(242,193,78,0.25);">${alerts.length} active alert(s)</p>` +
      alerts
        .map(
          (a) => `
        <div class="sos-alert-row" data-id="${a.id}">
          <div class="sos-alert-info">
            <b>Alert #${a.id}</b> — (${Number(a.latitude).toFixed(6)}, ${Number(a.longitude).toFixed(6)})
            — received ${fmtTime(a.created_at)}
            ${a.note ? `<span class="sos-alert-note"> — ${escapeHtml(a.note)}</span>` : ""}
          </div>
          <button class="btn btn-ghost sos-resolve-btn" data-id="${a.id}">Resolve</button>
        </div>`
        )
        .join("");

    sosBody.querySelectorAll(".sos-resolve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Resolving…";
        const result = await resolveSosAlert(btn.dataset.id);
        if (result.ok) {
          refreshSos();
        } else {
          btn.disabled = false;
          btn.textContent = "Resolve";
          alert(`Failed to resolve: ${result.error}`);
        }
      });
    });

    renderSosMap(alerts);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  sosRefreshBtn.addEventListener("click", refreshSos);

  sosLiveChk.addEventListener("change", () => {
    if (state.sosTimer) { clearInterval(state.sosTimer); state.sosTimer = null; }
    if (sosLiveChk.checked) {
      state.sosTimer = setInterval(refreshSos, 3000);
    }
  });

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */
  renderZoneTable();
  refreshSos();
})();