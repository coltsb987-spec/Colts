"""Settings: config.json (non-secret knobs) + .env (secrets). Secrets are never logged."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Hard floors so a typo in config.json can never hammer Invo.
MIN_POLL_SECONDS = 120
MAX_TRADERS = 10

UUID_RE = re.compile(r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}")


def load_dotenv(path: Path) -> None:
    """Tiny .env reader (KEY=VALUE lines). Real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip().strip('"').strip("'")
        if val and key.strip() not in os.environ:
            os.environ[key.strip()] = val


def parse_portfolio_id(raw: str) -> str | None:
    """Accept a bare UUID or a full https://app.invoapp.com/portfolio/<uuid> URL."""
    m = UUID_RE.search(raw or "")
    if not m:
        return None
    s = m.group(0).replace("-", "").lower()
    return f"{s[:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:]}"


@dataclass
class Config:
    dry_run_single_trader: bool = True
    num_traders: int = 10
    poll_interval_seconds: int = 300
    leaderboard_refresh_minutes: int = 60
    alert_channel: str = "console"
    alert_on_existing_positions_at_start: bool = False
    min_size_change_pct: float = 10.0
    close_confirm_polls: int = 2
    cluster_min_traders: int = 2
    cluster_window_hours: float = 24.0
    daily_summary_hour_utc: int = 20
    db_path: str = "data/analyst.db"
    log_path: str = "data/analyst.log"
    leaderboard: dict = field(default_factory=lambda: {"mode": "manual", "portfolio_ids": []})
    posts: dict = field(default_factory=dict)
    claude: dict = field(default_factory=lambda: {"enabled": True, "model": "claude-opus-5-5", "effort": "medium"})

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Config":
        load_dotenv(ROOT / ".env")
        p = Path(path) if path else ROOT / "config.json"
        if not p.exists():
            p = ROOT / "config.example.json"
        data = json.loads(p.read_text())
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        cfg = cls(**known)
        cfg.validate()
        return cfg

    def validate(self) -> None:
        if self.poll_interval_seconds < MIN_POLL_SECONDS:
            raise ValueError(f"poll_interval_seconds must be >= {MIN_POLL_SECONDS} (be gentle with Invo)")
        if not 1 <= self.num_traders <= MAX_TRADERS:
            raise ValueError(f"num_traders must be between 1 and {MAX_TRADERS}")
        if self.alert_channel not in ("telegram", "email", "console"):
            raise ValueError("alert_channel must be telegram, email or console")
        if self.leaderboard.get("mode") not in ("manual", "followed", "endpoint"):
            raise ValueError("leaderboard.mode must be manual, followed or endpoint")

    @property
    def traders_to_watch(self) -> int:
        return 1 if self.dry_run_single_trader else self.num_traders

    def resolve(self, rel: str) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else ROOT / p
