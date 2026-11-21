"""Turn two snapshots of a trader's open trades into events.

Events: opened, closed, size_changed, leverage_changed.

Rules that keep false alarms down:
  * The first time we see a trader, whatever is already open is recorded silently as a baseline
    (unless alert_on_existing_positions_at_start is on) - we did not see those trades happen.
  * A trade is only called "closed" when it shows up in the trader's closed list, or after it has
    been missing for `close_confirm_polls` successful polls in a row. A FAILED fetch never counts.
  * Size changes under `min_size_change_pct` are ignored (Invo's entrySize wobbles slightly).
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from .db import DB


def _f(x) -> float | None:
    try:
        return float(x) if x is not None and x != "" else None
    except (TypeError, ValueError):
        return None


def parse_ts(s) -> float | None:
    if not s:
        return None
    if isinstance(s, (int, float)):
        return float(s) / (1000 if s > 1e12 else 1)
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError:
        return None


def normalize_coin(ticker: str) -> str:
    t = (ticker or "").upper().strip()
    for suffix in ("-PERP", "/USDT", "/USDC", "/USD", "USDT", "-USD"):
        if t.endswith(suffix) and len(t) > len(suffix):
            return t[: -len(suffix)]
    return t


def normalize(inv: dict, portfolio_id: str) -> dict | None:
    """Raw Invo investment -> our position dict. None if it lacks an id."""
    base_id = inv.get("baseId") or inv.get("id")
    if not base_id:
        return None
    return {
        "base_id": str(base_id),
        "portfolio_id": portfolio_id,
        "coin": normalize_coin(str(inv.get("ticker") or "")),
        "is_long": bool(inv.get("directionLong", True)),
        "leverage": _f(inv.get("leverage")) or 1.0,
        "entry_size": _f(inv.get("entrySize")),   # % of the trader's balance used as margin
        "entry_price": _f(inv.get("entryPrice")),
        "current_price": _f(inv.get("currentPrice")),
        "stop_loss": _f(inv.get("stopLoss")),
        "price_target": _f(inv.get("priceTarget")),
        "opened_at": inv.get("createdAt"),
        "raw": inv,
    }


def pnl_pct(is_long: bool, entry: float | None, exit_: float | None, leverage: float | None) -> float | None:
    """Return on margin, in %, ignoring fees and funding."""
    if not entry or not exit_:
        return None
    move = (exit_ - entry) / entry * (1 if is_long else -1)
    return round(move * (leverage or 1) * 100, 2)


def detect(db: DB, portfolio_id: str, trader_name: str, open_invs: list[dict], recent_closed: list[dict],
           *, min_size_change_pct: float, close_confirm_polls: int, alert_existing: bool,
           now: float | None = None) -> list[int]:
    """Compare the fresh snapshot with what we stored; write events; return new event ids."""
    now = now or time.time()
    trader = db.trader(portfolio_id)
    first_time = not (trader and trader["baseline_done"])
    current = {p["base_id"]: p for p in (normalize(i, portfolio_id) for i in open_invs) if p}
    known = {r["base_id"]: r for r in db.open_positions(portfolio_id)}
    closed_by_id = {str(c.get("baseId") or c.get("id")): c for c in recent_closed}
    new_ids: list[int] = []

    def ev(kind: str, pos: dict, **extra) -> int:
        e = {"ts": now, "portfolio_id": portfolio_id, "trader_name": trader_name, "base_id": pos["base_id"],
             "kind": kind, "coin": pos["coin"], "is_long": pos["is_long"], "leverage": pos["leverage"],
             "entry_size": pos["entry_size"], "entry_price": pos["entry_price"], "raw_json": None}
        e.update(extra)
        eid = db.add_event(e)
        new_ids.append(eid)
        return eid

    # New and changed positions
    for bid, pos in current.items():
        old = known.get(bid)
        if old is None:
            if first_time and not alert_existing:
                db.save_position(pos)  # baseline: no alert
                continue
            db.save_position(pos, open_event_id=ev("opened", pos))
            continue
        if old["leverage"] and pos["leverage"] and abs(pos["leverage"] - old["leverage"]) >= 0.5:
            ev("leverage_changed", pos, prev_leverage=old["leverage"])
        if old["entry_size"] and pos["entry_size"]:
            change = abs(pos["entry_size"] - old["entry_size"]) / old["entry_size"] * 100
            if change >= min_size_change_pct:
                ev("size_changed", pos, prev_entry_size=old["entry_size"])
        db.save_position(pos)

    # Disappeared positions -> closed (confirmed)
    for bid, old in known.items():
        if bid in current:
            continue
        closed = closed_by_id.get(bid)
        if closed is None and db.bump_missing(bid) < close_confirm_polls:
            continue
        pos = {"base_id": bid, "coin": old["coin"], "is_long": bool(old["is_long"]), "leverage": old["leverage"],
               "entry_size": old["entry_size"], "entry_price": old["entry_price"]}
        exit_px = _f(closed.get("closingPrice")) if closed else None
        closed_at = parse_ts(closed.get("closedAt") or closed.get("updatedAt")) if closed else None
        opened_at = parse_ts(old["opened_at"])
        hold = (closed_at or now) - opened_at if opened_at else None
        ev("closed", pos, exit_price=exit_px, hold_seconds=hold,
           pnl_pct=pnl_pct(pos["is_long"], pos["entry_price"], exit_px, pos["leverage"]),
           reason_closed=(closed or {}).get("reasonClosed") if closed else "not in closed list (confirmed missing)",
           raw_json=json.dumps({"open_event_id": old["open_event_id"], "opened_ts": opened_at,
                                "closed_ts": closed_at or now, "exit_time_known": closed_at is not None,
                                "stop_loss": (json.loads(old["raw_json"] or "{}") or {}).get("stopLoss")}))
        db.delete_position(bid)

    if first_time:
        db.mark_baseline_done(portfolio_id)
    return new_ids


def find_cluster(db: DB, event_id: int, window_hours: float, min_traders: int) -> list[dict]:
    """Other tracked traders on the same coin and side: recent opens or currently-open positions."""
    e = db.event(event_id)
    if not e or e["kind"] != "opened":
        return []
    since = e["ts"] - window_hours * 3600
    members = {e["portfolio_id"]: e["trader_name"]}
    for row in db.recent_same_side_opens(e["coin"], bool(e["is_long"]), since):
        members.setdefault(row["portfolio_id"], row["trader_name"])
    for row in db.open_positions():
        if row["coin"] == e["coin"] and bool(row["is_long"]) == bool(e["is_long"]):
            t = db.trader(row["portfolio_id"])
            members.setdefault(row["portfolio_id"], t["name"] if t else row["portfolio_id"][:8])
    if len(members) < min_traders:
        return []
    return [{"portfolio_id": k, "name": v} for k, v in members.items()]
