"""Where the server keeps its data. Override with environment variables."""

import os
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent          # KherveOS/server
PROJECTS_DIR = SERVER_DIR.parent.parent                      # the folder that holds KherveOS and the games
DATA_DIR = Path(os.environ.get("KHERVEOS_DATA", SERVER_DIR / "data"))
DB_PATH = DATA_DIR / "kherveos.db"
SECRET_KEY_PATH = DATA_DIR / "secret.key"
SESSION_COOKIE = "kherveos_session"
SESSION_DAYS = 30

DATA_DIR.mkdir(parents=True, exist_ok=True)
