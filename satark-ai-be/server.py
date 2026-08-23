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
    import uvicorn

    uvicorn.run("server:app", host=config.HOST, port=config.PORT, reload=True)