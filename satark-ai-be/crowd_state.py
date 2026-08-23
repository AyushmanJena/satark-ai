import threading
import time

_lock = threading.Lock()
_state = {
    "regions": [],       # list of dicts shaped like schemas.CrowdRegion
    "last_updated": None,
}

# If the admin app hasn't pushed anything in this long, treat the data
# as stale and fall back to mock generation instead of showing a frozen
# frame from 10 minutes ago as if it were live.
STALE_AFTER_SECONDS = 15.0


def update_regions(regions: list[dict]) -> None:
    with _lock:
        _state["regions"] = regions
        _state["last_updated"] = time.time()


def get_regions() -> list[dict]:
    with _lock:
        return list(_state["regions"])


def get_regions_payload() -> list[dict]:
    with _lock:
        return [dict(region) for region in _state["regions"]]


def has_fresh_regions() -> bool:
    with _lock:
        last_updated = _state["last_updated"]
    if last_updated is None:
        return False
    return (time.time() - last_updated) <= STALE_AFTER_SECONDS
