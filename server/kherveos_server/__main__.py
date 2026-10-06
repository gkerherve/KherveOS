"""python -m kherveos_server  — start the KherveOS server (default http://127.0.0.1:8787)."""

import os

import uvicorn


def main() -> None:
    host = os.environ.get("KHERVEOS_HOST", "127.0.0.1")
    port = int(os.environ.get("KHERVEOS_PORT", "8787"))
    print(f"KherveOS server on http://{host}:{port}  (the OS reaches it through Vite at /api)", flush=True)
    uvicorn.run("kherveos_server.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
