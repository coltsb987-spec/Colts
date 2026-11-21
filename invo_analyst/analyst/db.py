"""SQLite storage. Every snapshot, trade event and explanation is kept so patterns can be reviewed later."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS traders (
    portfolio_id TEXT PRIMARY KEY,
    name TEXT,
    rank INTEGER,
    stats_json TEXT,
    first_seen REAL,
    last_seen REAL,
    baseline_done INTEGER DEFAULT 0
);
-- What we believe each trader currently has open (one row per Invo baseId).
CREATE TABLE IF NOT EXISTS open_positions (
    base_id TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL,
    coin TEXT, is_long INTEGER, leverage REAL, entry_size REAL, entry_price REAL,
    opened_at TEXT, raw_json TEXT,
    missing_polls INTEGER DEFAULT 0,
    open_event_id INTEGER
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    portfolio_id TEXT NOT NULL,
    trader_name TEXT,
    base_id TEXT,
    kind TEXT NOT NULL,          -- opened | closed | size_changed | leverage_changed
    coin TEXT, is_long INTEGER,
    leverage REAL, prev_leverage REAL,
    entry_size REAL, prev_entry_size REAL,
    entry_price REAL, exit_price REAL,
    pnl_pct REAL, hold_seconds REAL, reason_closed TEXT,
    cluster_json TEXT,
    raw_json TEXT,
    alerted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS explanations (
    event_id INTEGER PRIMARY KEY REFERENCES events(id),
    ts REAL,
    model TEXT,
    confidence TEXT,
    reason TEXT,
    evidence_json TEXT,
    context_json TEXT
);
CREATE TABLE IF NOT EXISTS health (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated REAL
);
CREATE INDEX IF NOT EXISTS ix_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS ix_events_coin ON events(coin, is_long, ts);
"""


class DB:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ---- traders ------------------------------------------------------------
    def upsert_trader(self, pid: str, name: str, rank: int | None, stats: dict) -> None:
        now = time.time()
        self.conn.execute(
            """INSERT INTO traders(portfolio_id, name, rank, stats_json, first_seen, last_seen)
               VALUES(?,?,?,?,?,?)
               ON CONFLICT(portfolio_id) DO UPDATE SET name=excluded.name, rank=excluded.rank,
               stats_json=excluded.stats_json, last_seen=excluded.last_seen""",
            (pid, name, rank, json.dumps(stats, default=str), now, now))
        self.conn.commit()

    def trader(self, pid: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM traders WHERE portfolio_id=?", (pid,)).fetchone()

    def mark_baseline_done(self, pid: str) -> None:
        now = time.time()
        self.conn.execute(
            """INSERT INTO traders(portfolio_id, first_seen, last_seen, baseline_done) VALUES(?,?,?,1)
               ON CONFLICT(portfolio_id) DO UPDATE SET baseline_done=1""", (pid, now, now))
        self.conn.commit()

    # ---- open positions -----------------------------------------------------
    def open_positions(self, pid: str | None = None) -> list[sqlite3.Row]:
        if pid:
            return self.conn.execute("SELECT * FROM open_positions WHERE portfolio_id=?", (pid,)).fetchall()
        return self.conn.execute("SELECT * FROM open_positions").fetchall()

    def save_position(self, pos: dict, open_event_id: int | None = None) -> None:
        self.conn.execute(
            """INSERT INTO open_positions(base_id, portfolio_id, coin, is_long, leverage, entry_size, entry_price,
                                          opened_at, raw_json, missing_polls, open_event_id)
               VALUES(?,?,?,?,?,?,?,?,?,0,?)
               ON CONFLICT(base_id) DO UPDATE SET leverage=excluded.leverage, entry_size=excluded.entry_size,
               entry_price=excluded.entry_price, raw_json=excluded.raw_json, missing_polls=0,
               open_event_id=COALESCE(open_positions.open_event_id, excluded.open_event_id)""",
            (pos["base_id"], pos["portfolio_id"], pos["coin"], int(pos["is_long"]), pos["leverage"],
             pos["entry_size"], pos["entry_price"], pos["opened_at"], json.dumps(pos.get("raw", {}), default=str),
             open_event_id))
        self.conn.commit()

    def bump_missing(self, base_id: str) -> int:
        self.conn.execute("UPDATE open_positions SET missing_polls=missing_polls+1 WHERE base_id=?", (base_id,))
        self.conn.commit()
        row = self.conn.execute("SELECT missing_polls FROM open_positions WHERE base_id=?", (base_id,)).fetchone()
        return row["missing_polls"] if row else 0

    def delete_position(self, base_id: str) -> None:
        self.conn.execute("DELETE FROM open_positions WHERE base_id=?", (base_id,))
        self.conn.commit()

    # ---- events -------------------------------------------------------------
    def add_event(self, ev: dict) -> int:
        cols = ["ts", "portfolio_id", "trader_name", "base_id", "kind", "coin", "is_long", "leverage",
                "prev_leverage", "entry_size", "prev_entry_size", "entry_price", "exit_price", "pnl_pct",
                "hold_seconds", "reason_closed", "cluster_json", "raw_json"]
        vals = [ev.get(c) for c in cols]
        vals[0] = vals[0] or time.time()
        if ev.get("is_long") is not None:
            vals[cols.index("is_long")] = int(ev["is_long"])
        cur = self.conn.execute(f"INSERT INTO events({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)
        self.conn.commit()
        return cur.lastrowid

    def set_event_cluster(self, event_id: int, cluster: list[dict]) -> None:
        self.conn.execute("UPDATE events SET cluster_json=? WHERE id=?", (json.dumps(cluster), event_id))
        self.conn.commit()

    def mark_alerted(self, event_id: int) -> None:
        self.conn.execute("UPDATE events SET alerted=1 WHERE id=?", (event_id,))
        self.conn.commit()

    def event(self, event_id: int) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()

    def events_since(self, ts: float) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM events WHERE ts>=? ORDER BY ts", (ts,)).fetchall()

    def unalerted_events(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM events WHERE alerted=0 ORDER BY ts").fetchall()

    def recent_same_side_opens(self, coin: str, is_long: bool, since: float) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM events WHERE kind='opened' AND coin=? AND is_long=? AND ts>=? ORDER BY ts",
            (coin, int(is_long), since)).fetchall()

    # ---- explanations -------------------------------------------------------
    def save_explanation(self, event_id: int, model: str, confidence: str, reason: str, evidence: list,
                         context: dict) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO explanations VALUES(?,?,?,?,?,?,?)",
            (event_id, time.time(), model, confidence, reason, json.dumps(evidence), json.dumps(context, default=str)))
        self.conn.commit()

    def explanation(self, event_id: int) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM explanations WHERE event_id=?", (event_id,)).fetchone()

    # ---- health -------------------------------------------------------------
    def get_health(self, key: str, default: str | None = None) -> str | None:
        row = self.conn.execute("SELECT value FROM health WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set_health(self, key: str, value: str) -> None:
        self.conn.execute("INSERT OR REPLACE INTO health VALUES(?,?,?)", (key, value, time.time()))
        self.conn.commit()
