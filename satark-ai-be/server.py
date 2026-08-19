"""
Satark AI — backend.

Single FastAPI app serving:

    ws://<host>:8000/ws/crowd        crowd density feed (mobile)
    ws://<host>:8000/ws/exit         safest-exit routing (mobile)
    POST /api/sos                    SOS alert creation (mobile)
    GET  /api/sos/active             active SOS alerts (admin, polled)
    POST /api/sos/{id}/resolve       mark an alert handled (admin)
    POST /api/monitor/upload         video upload (admin)
    WS   /ws/monitor                 live detection/heatmap/risk feed (admin)

The admin dashboard itself (index.html/app.js/styles.css) is served
separately by `python main.py` on its own port — this app only serves
JSON/WebSocket APIs, nothing static. CORS is wide open below because
of that: the admin page (e.g. http://localhost:8501) and this backend
(e.g. http://localhost:8000) are different origins as far as the
browser is concerned, even on the same machine.
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from crowd import router as crowd_router
from exit import router as exit_router
from monitor import router as monitor_router
from Sos import router as sos_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("satark.server")

app = FastAPI(title="Satark AI — Backend")

# Wide open on purpose for local dev — the admin dashboard (main.py,
# its own port) and the Expo app both need to reach this from a
# different origin. Restrict this before this goes anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(crowd_router)
app.include_router(exit_router)
app.include_router(sos_router)
app.include_router(monitor_router)


@app.get("/health")
def health_check():
    """Quick sanity check from a browser: http://<host>:8000/health"""
    return {
        "status": "ok",
        "crowd_update_interval_seconds": config.CROWD_UPDATE_INTERVAL_SECONDS,
        "exit_gates": len(config.EXIT_GATES),
    }


if __name__ == "__main__":
    # This block only runs with `python server.py`. Since your workflow
    # runs `uvicorn server:app --reload` directly from the terminal
    # instead, this is just a fallback for running it directly.
    import uvicorn

    uvicorn.run("server:app", host=config.HOST, port=config.PORT, reload=True)