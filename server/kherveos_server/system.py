"""The machine's processor and memory, for the menu bar of KherveOS.

GET /api/system/stats  ->  {cpu_percent, cores, memory_percent, memory_used, memory_total}

Only numbers about the computer running the server: no names, no processes.
"""

import psutil
from fastapi import APIRouter

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/stats")
def stats() -> dict:
    # A short sample (0.2 s) gives a real reading each time; the page polls every few seconds.
    mem = psutil.virtual_memory()
    return {
        "cpu_percent": round(psutil.cpu_percent(interval=0.2), 1),
        "cores": psutil.cpu_count(logical=True) or 1,
        "memory_percent": round(mem.percent, 1),
        "memory_used": mem.used,
        "memory_total": mem.total,
    }
