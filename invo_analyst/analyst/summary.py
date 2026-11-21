"""Daily summary: who traded what, clusters, closed results, patterns. Always ends with the risk reminder."""

from __future__ import annotations

import json
import time
from collections import defaultdict

from .alerts import RISK_REMINDER
from .db import DB


def collect(db: DB, since: float) -> dict:
    events = db.events_since(since)
    by_trader: dict[str, list[str]] = defaultdict(list)
    side_votes: dict[tuple, set] = defaultdict(set)
    closes, conf = [], defaultdict(int)
    for e in events:
        side = "long" if e["is_long"] else "short"
        name = e["trader_name"] or e["portfolio_id"][:8]
        if e["kind"] == "opened":
            by_trader[name].append(f"opened {e['coin']} {side} {e['leverage']:g}x")
            side_votes[(e["coin"], side)].add(name)
            x = db.explanation(e["id"])
            if x:
                conf[x["confidence"]] += 1
        elif e["kind"] == "closed":
            r = "?" if e["pnl_pct"] is None else f"{e['pnl_pct']:+.1f}%"
            by_trader[name].append(f"closed {e['coin']} {side} ({r})")
            x = db.explanation(e["id"])
            closes.append({"trader": name, "coin": e["coin"], "side": side, "pnl_pct_on_margin": e["pnl_pct"],
                           "hold_hours": round(e["hold_seconds"] / 3600, 1) if e["hold_seconds"] else None,
                           "reasoning_played_out": json.loads(x["evidence_json"]).get("played_out") if x else None})
        else:
            by_trader[name].append(f"{e['kind'].replace('_', ' ')} on {e['coin']} {side}")
    # Clusters: same coin+side by 2+ traders today, plus open positions shared right now.
    open_now: dict[tuple, set] = defaultdict(set)
    for p in db.open_positions():
        t = db.trader(p["portfolio_id"])
        open_now[(p["coin"], "long" if p["is_long"] else "short")].add(t["name"] if t else p["portfolio_id"][:8])
    clusters = {f"{c} {s}": sorted(v) for (c, s), v in side_votes.items() if len(v) >= 2}
    held = {f"{c} {s}": sorted(v) for (c, s), v in open_now.items() if len(v) >= 2}
    return {"moves_by_trader": dict(by_trader), "clusters_opened_today": clusters,
            "shared_open_positions_now": held, "closed_trades": closes,
            "explanation_confidence_counts": dict(conf), "events_total": len(events)}


def render(facts: dict, ai: dict | None, feed_status: str) -> str:
    out = [f"DAILY SUMMARY ({time.strftime('%Y-%m-%d', time.gmtime())} UTC)", f"Data feed: {feed_status}", ""]
    if not facts["events_total"]:
        out.append("No trade moves detected in the last 24 hours.")
    for name, moves in facts["moves_by_trader"].items():
        out.append(f"- {name}: " + "; ".join(moves))
    if facts["clusters_opened_today"] or facts["shared_open_positions_now"]:
        out += ["", "Where traders agree:"]
        for k, v in facts["clusters_opened_today"].items():
            out.append(f"- Opened today: {k} by {', '.join(v)}")
        for k, v in facts["shared_open_positions_now"].items():
            out.append(f"- Currently holding {k}: {', '.join(v)}")
    closes = facts["closed_trades"]
    if closes:
        known = [c["pnl_pct_on_margin"] for c in closes if c["pnl_pct_on_margin"] is not None]
        wins = sum(p > 0 for p in known)
        out += ["", f"Closed trades: {len(closes)} ({wins} winners of {len(known)} with a known exit price)"]
    if ai:
        if ai.get("patterns"):
            out += ["", "Recurring patterns (hypotheses, small sample):"] + [f"- {p}" for p in ai["patterns"]]
        if ai.get("what_seems_to_work"):
            out += ["", "What seems to be working (hypotheses, not facts):"] + [f"- {p}" for p in ai["what_seems_to_work"]]
    c = facts["explanation_confidence_counts"]
    if c:
        out += ["", "Explanation confidence today: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items()))]
    out += ["", RISK_REMINDER]
    return "\n".join(out)
