"""Loads settings.json and the Google API key from the repo's .env file."""
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DATA_DIR = HERE / "data"  # git-ignored: holds the leads database (personal data)


def load_settings(path=None):
    with open(path or HERE / "settings.json", encoding="utf-8") as f:
        return json.load(f)


def api_key():
    """GOOGLE_MAPS_API_KEY from the environment or the repo's .env file. Never printed."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if key:
        return key
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("GOOGLE_MAPS_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""
