"""Evening picks: who is most likely to make the best trades tomorrow - and an honest check the next day.

The pick score is a transparent sum (every part is shown in the working):
  recent form      0.6 x 7-day score + 0.4 x 30-day score (30-day only if 7-day has too few trades)
  trend            half the gap between the 7-day and 30-day score, capped at +/-5
  style fit        does their long/short habit, and how it paid lately, match today's BTC trend? (+/-8)
                   high leverage while the market is unusually volatile: -5
  overnight book   open positions in profit: up to +4; in loss over 3% of balance: -3;
                   total exposure above 100% of balance: -5 (they could get hurt overnight)
  consensus        their open positions agree with the net side of the strong traders: +3 each
                   (max +6), against it: -3 each (max -6)

A trader is picked only if their score is >= 60 AND at least 8 points above the group median
(max 3 picks). Otherwise the report says plainly that nobody stands out.

Next-day check, 24h later: each trader's result = realised P/L of trades closed in the 24h
(minus what was already showing at pick time) + change in open-position P/L, as % of their balance.
A pick is a HIT if it finished in the top third of the watched traders AND made money.
"Chance" is what random picking would score, so you can see whether the method beats luck.
"""

from __future__ import annotations

import json
import math
import statistics
import time

from .db import DB
from .scoring import account_return, clamp

PICK_MIN_SCORE = 60
PICK_MIN_LEAD = 8
MAX_PICKS = 3
STRONG_TRADER = 60


def position_unrealized(row) -> float | None:
    """Open position's P/L as % of the trader's balance, from Invo's latest currentPrice."""
    raw = json.loads(row["raw_json"] or "{}")
    try:
        cur = float(raw.get("currentPrice"))
    except (TypeError, ValueError):
        return None
    entry = row["entry_price"]
    if not entry:
        return None
    pnl = (cur / entry - 1) * 100 * (1 if row["is_long"] else -1) * (row["leverage"] or 1)
    return account_return(pnl, row["entry_size"])


def book(db: DB, pid: str) -> dict:
    rows = db.open_positions(pid)
    unreal = {r["base_id"]: position_unrealized(r) for r in rows}
    return {
        "positions": [{"coin": r["coin"], "side": "long" if r["is_long"] else "short", "leverage": r["leverage"],
                       "size_pct": r["entry_size"], "unrealized_pct_of_balance": _r(unreal[r["base_id"]], 3)}
                      for r in rows],
        "unrealized_by_id": {k: v for k, v in unreal.items() if v is not None},
        "exposure_pct": _r(sum((r["leverage"] or 1) * (r["entry_size"] or 0) for r in rows)),
    }


def strong_consensus(traders: list[dict]) -> dict[str, float]:
    """coin -> net lean of strong traders' open positions (+1 all long ... -1 all short)."""
    votes: dict[str, list[int]] = {}
    for t in traders:
        s30 = t["scores"][30].get("score")
        if s30 is None or s30 < STRONG_TRADER:
            continue
        for p in t["book"]["positions"]:
            votes.setdefault(p["coin"], []).append(1 if p["side"] == "long" else -1)
    return {c: sum(v) / len(v) for c, v in votes.items() if len(v) >= 2}


def score_trader(t: dict, market: dict, consensus: dict[str, float]) -> dict:
    working, total = [], 0.0
    s7, s30 = t["scores"][7].get("score"), t["scores"][30].get("score")
    if s30 is None and s7 is None:
        return {"score": None, "working": ["not enough closed trades in the last 30 days to judge"]}
    if s7 is None:
        recent = s30
        working.append(f"recent form {s30:.0f} (30-day score; too few trades in 7 days)")
    elif s30 is None:
        recent = s7
        working.append(f"recent form {s7:.0f} (7-day score only)")
    else:
        recent = 0.6 * s7 + 0.4 * s30
        working.append(f"recent form {recent:.0f} (7-day {s7:.0f}, 30-day {s30:.0f})")
        trend = max(-5.0, min(5.0, (s7 - s30) / 2))
        if abs(trend) >= 1:
            working.append(f"{'improving' if trend > 0 else 'fading'} lately {trend:+.0f}")
        total += trend
    total += recent

    # Style fit with current market conditions
    btc_trend = market.get("trend_1h", "unknown")
    long_share = t.get("profile", {}).get("long_share_pct")
    sides = t.get("side_perf", {})
    if btc_trend in ("up", "down") and long_share is not None:
        side = "long" if btc_trend == "up" else "short"
        share = long_share / 100 if side == "long" else 1 - long_share / 100
        perf = sides.get(side, {})
        paid = 1 if perf.get("ret", 0) > 0 else -1 if perf.get("n", 0) >= 3 else 0
        fit = round(8 * (share - 0.5) * 2 * (1 if paid >= 0 else -0.5) + (2 * paid), 1)
        fit = max(-8.0, min(8.0, fit))
        total += fit
        working.append(f"style fit {fit:+.0f}: BTC is trending {btc_trend}; they go {side} {share:.0%} of the time"
                       + (f", and their {side}s returned {perf.get('ret', 0):+.2f}% of balance over 30 days"
                          if perf.get("n") else ""))
    else:
        working.append("style fit 0: no clear market trend (or no history) to match against")
    atr = market.get("atr_1h_pct")
    med_lev = t["scores"][30].get("median_leverage")
    if atr is not None and atr >= 1.0 and med_lev and med_lev >= 15:
        total -= 5
        working.append(f"-5: market is volatile (BTC hourly range {atr}%) and they usually use {med_lev:g}x")

    # Overnight book
    b = t["book"]
    if b["positions"]:
        u = sum(b["unrealized_by_id"].values())
        if u > 0:
            bonus = min(4.0, round(u, 1))
            total += bonus
            working.append(f"+{bonus:g}: {len(b['positions'])} open position(s) currently in profit ({u:+.2f}% of balance)")
        elif u < -3:
            total -= 3
            working.append(f"-3: open positions are down {u:.2f}% of balance overnight")
        else:
            working.append(f"0: {len(b['positions'])} open position(s), roughly flat ({u:+.2f}% of balance)")
        if (b["exposure_pct"] or 0) > 100:
            total -= 5
            working.append(f"-5: total exposure {b['exposure_pct']:.0f}% of balance - risky overnight")
    else:
        working.append("0: no open positions overnight")

    # Agreement with strong traders
    agree = 0.0
    for p in b["positions"]:
        lean = consensus.get(p["coin"])
        if lean is None or abs(lean) < 0.5:
            continue
        mine = 1 if p["side"] == "long" else -1
        agree += 3 if mine * lean > 0 else -3
    agree = max(-6.0, min(6.0, agree))
    if agree:
        total += agree
        working.append(f"{agree:+.0f}: their positions {'agree with' if agree > 0 else 'go against'} the strong traders' lean")
    for name, pts in t["scores"][30].get("penalties", {}).items():
        working.append(f"(30-day score already includes -{pts:g} for {name.replace('_', ' ')})")
    return {"score": round(clamp(total), 1), "working": working}


def make_picks(traders: list[dict], market: dict) -> dict:
    consensus = strong_consensus(traders)
    ranked = []
    for t in traders:
        res = score_trader(t, market, consensus)
        ranked.append({"portfolio_id": t["portfolio_id"], "name": t["name"], **res,
                       "trades_30d": t["scores"][30].get("trades", 0), "book": t["book"]})
    scored = sorted([r for r in ranked if r["score"] is not None], key=lambda r: -r["score"])
    unscored = [r for r in ranked if r["score"] is None]
    median = statistics.median([r["score"] for r in scored]) if scored else None
    picks = [r for r in scored if r["score"] >= PICK_MIN_SCORE and r["score"] - median >= PICK_MIN_LEAD][:MAX_PICKS]
    for i, r in enumerate(scored, 1):
        r["rank"] = i
        r["is_pick"] = r in picks
    best_other = next((r["score"] for r in scored if not r["is_pick"]), median)
    for r in picks:
        lead = r["score"] - (best_other or 0)
        if r["score"] >= 75 and lead >= 10 and r["trades_30d"] >= 20:
            r["confidence"] = "high"
        elif r["score"] >= 65 and lead >= 5 and r["trades_30d"] >= 10:
            r["confidence"] = "medium"
        else:
            r["confidence"] = "low"
    reason = None
    if not picks:
        if not scored:
            reason = "Nobody stands out: none of the traders has enough recent closed trades to judge."
        else:
            top = scored[0]
            reason = (f"Nobody stands out tonight. Best score is {top['name']} at {top['score']:.0f}, which is "
                      f"{'below the 60 bar' if top['score'] < PICK_MIN_SCORE else 'not clearly ahead of the group'} "
                      f"(group median {median:.0f}).")
    return {"ranked": scored + unscored, "picks": picks, "median": median, "nobody_reason": reason,
            "consensus": consensus, "market": market}


def save_run(db: DB, day: str, result: dict, now: float) -> None:
    db.conn.execute("INSERT OR REPLACE INTO pick_runs(day, made_ts, nobody_stands_out, n_traders, reason, market_json) "
                    "VALUES(?,?,?,?,?,?)", (day, now, int(not result["picks"]), len(result["ranked"]),
                                             result["nobody_reason"], json.dumps(result["market"], default=str)))
    db.conn.execute("DELETE FROM picks WHERE day=?", (day,))
    for r in result["ranked"]:
        db.conn.execute(
            "INSERT INTO picks(day, made_ts, portfolio_id, trader_name, rank, pick_score, is_pick, confidence, "
            "working_json, unrealized_at_pick_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (day, now, r["portfolio_id"], r["name"], r.get("rank"), r["score"], int(bool(r.get("is_pick"))),
             r.get("confidence"), json.dumps(r["working"]), json.dumps(r["book"]["unrealized_by_id"])))
    db.conn.commit()


def next_day_result(db: DB, pid: str, start: float, end: float, at_pick: dict[str, float]) -> float:
    """Trader's P/L over [start, end] as % of balance (realised + change in open P/L)."""
    total = 0.0
    for e in db.conn.execute("SELECT * FROM events WHERE portfolio_id=? AND kind='closed' AND ts>=? AND ts<?",
                             (pid, start, end)):
        realised = account_return(e["pnl_pct"], e["entry_size"]) or 0.0
        total += realised - at_pick.get(e["base_id"], 0.0)
    for row in db.open_positions(pid):
        u = position_unrealized(row)
        if u is not None:
            total += u - at_pick.get(row["base_id"], 0.0)
    return round(total, 4)


def evaluate_due(db: DB, now: float | None = None) -> list[str]:
    """Score every pick run that is at least 24h old and not yet checked. Returns plain-English lines."""
    now = now or time.time()
    lines = []
    runs = db.conn.execute("SELECT * FROM pick_runs WHERE evaluated_ts IS NULL AND made_ts<=?", (now - 86400,)).fetchall()
    for run in runs:
        rows = db.conn.execute("SELECT * FROM picks WHERE day=?", (run["day"],)).fetchall()
        results = {r["portfolio_id"]: next_day_result(db, r["portfolio_id"], run["made_ts"], run["made_ts"] + 86400,
                                                      json.loads(r["unrealized_at_pick_json"] or "{}")) for r in rows}
        order = sorted(results, key=lambda p: -results[p])
        n = len(order)
        top_k = max(1, math.ceil(n / 3))
        for r in rows:
            res = results[r["portfolio_id"]]
            rank = order.index(r["portfolio_id"]) + 1
            hit = int(bool(r["is_pick"]) and rank <= top_k and res > 0) if r["is_pick"] else None
            db.conn.execute("UPDATE picks SET evaluated_ts=?, next_day_return_pct=?, next_day_rank=?, hit=? WHERE id=?",
                            (now, res, rank, hit, r["id"]))
            if r["is_pick"]:
                lines.append(f"{run['day']} pick {r['trader_name']}: next day {res:+.2f}% of balance, "
                             f"finished #{rank} of {n} -> {'HIT' if hit else 'miss'}")
        if run["nobody_stands_out"]:
            best = rows[[r["portfolio_id"] for r in rows].index(order[0])] if order else None
            lines.append(f"{run['day']}: no pick was made" + (f" (best next day was {best['trader_name']} "
                                                               f"{results[order[0]]:+.2f}%)" if best else ""))
        chance = top_k / n if n else None
        db.conn.execute("UPDATE pick_runs SET evaluated_ts=?, chance_rate=? WHERE day=?", (now, chance, run["day"]))
    db.conn.commit()
    return lines


def track_record(db: DB) -> dict:
    rows = db.conn.execute("SELECT p.hit, r.chance_rate FROM picks p JOIN pick_runs r ON p.day=r.day "
                           "WHERE p.is_pick=1 AND p.evaluated_ts IS NOT NULL").fetchall()
    n = len(rows)
    hits = sum(r["hit"] or 0 for r in rows)
    chance = statistics.mean([r["chance_rate"] for r in rows if r["chance_rate"] is not None]) if rows else None
    no_pick = db.conn.execute("SELECT COUNT(*) FROM pick_runs WHERE nobody_stands_out=1 AND evaluated_ts IS NOT NULL").fetchone()[0]
    return {"picks_checked": n, "hits": hits, "hit_rate_pct": round(100 * hits / n, 1) if n else None,
            "chance_pct": round(100 * chance, 1) if chance is not None else None, "nights_without_pick": no_pick}


def render(result: dict, record: dict, evaluated: list[str]) -> str:
    out = ["TONIGHT'S PICKS (who looks most likely to trade best tomorrow)"]
    m = result["market"]
    out.append(f"Market now: BTC trend {m.get('trend_1h', '?')}, 24h {m.get('change_24h_pct', '?')}%, "
               f"hourly range {m.get('atr_1h_pct', '?')}%")
    if result["picks"]:
        for r in result["picks"]:
            out.append(f"\nPICK: {r['name']} - score {r['score']:.0f}, {r['confidence'].upper()} confidence")
            out += [f"  - {w}" for w in r["working"]]
    else:
        out.append("\n" + result["nobody_reason"])
    out.append("\nFull ranking: " + ", ".join(
        f"#{r['rank']} {r['name']} {r['score']:.0f}" if r["score"] is not None else f"{r['name']} (not enough data)"
        for r in result["ranked"]))
    if result["consensus"]:
        out.append("Strong traders lean: " + ", ".join(f"{c} {'long' if v > 0 else 'short'} ({abs(v):.0%})"
                                                       for c, v in result["consensus"].items()))
    if evaluated:
        out += ["", "Yesterday's picks vs what happened:"] + [f"- {x}" for x in evaluated]
    out.append("")
    if record["picks_checked"]:
        out.append(f"PICK TRACK RECORD: {record['hits']} hits from {record['picks_checked']} picks "
                   f"({record['hit_rate_pct']}%). Random picking would score about {record['chance_pct']}%."
                   + (" Too few picks to judge yet - wait for 30+." if record["picks_checked"] < 30 else ""))
    else:
        out.append("PICK TRACK RECORD: no picks checked yet (each pick is checked 24 hours after it is made).")
    if record["nights_without_pick"]:
        out.append(f"Nights with no pick: {record['nights_without_pick']}.")
    return "\n".join(out)


def _r(x, nd: int = 1):
    return None if x is None else round(float(x), nd)
