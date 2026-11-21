"""A trader's habits, from their own closed-trade history on Invo, and whether a new trade fits them."""

from __future__ import annotations

import statistics
from collections import Counter

from .detector import _f, normalize_coin, parse_ts, pnl_pct


def profile(closed: list[dict]) -> dict:
    trades = []
    for t in closed:
        o, c = parse_ts(t.get("createdAt")), parse_ts(t.get("closedAt") or t.get("updatedAt"))
        is_long = bool(t.get("directionLong", True))
        lev = _f(t.get("leverage")) or 1.0
        trades.append({"coin": normalize_coin(str(t.get("ticker") or "")), "is_long": is_long, "lev": lev,
                       "size": _f(t.get("entrySize")),
                       "hold_h": (c - o) / 3600 if o and c and c >= o else None,
                       "pnl": pnl_pct(is_long, _f(t.get("entryPrice")), _f(t.get("closingPrice")), lev)})
    if not trades:
        return {"closed_trades_seen": 0, "note": "no closed-trade history available"}
    coins = Counter(t["coin"] for t in trades)
    levs = [t["lev"] for t in trades]
    holds = [t["hold_h"] for t in trades if t["hold_h"] is not None]
    sizes = [t["size"] for t in trades if t["size"]]
    pnls = [t["pnl"] for t in trades if t["pnl"] is not None]
    return {
        "closed_trades_seen": len(trades),
        "top_assets": [f"{c} ({n})" for c, n in coins.most_common(5)],
        "asset_share": {c: round(n / len(trades), 3) for c, n in coins.most_common(10)},
        "long_share_pct": round(100 * sum(t["is_long"] for t in trades) / len(trades), 1),
        "median_leverage": statistics.median(levs),
        "max_leverage": max(levs),
        "median_hold_hours": round(statistics.median(holds), 1) if holds else None,
        "median_entry_size_pct": round(statistics.median(sizes), 3) if sizes else None,
        "win_rate_pct": round(100 * sum(p > 0 for p in pnls) / len(pnls), 1) if pnls else None,
        "note": "computed from price moves x leverage; fees, funding and drawdown inside trades are not included",
    }


def fit(prof: dict, coin: str, is_long: bool, leverage: float | None, entry_size: float | None) -> list[str]:
    """Plain-English notes on whether this trade matches the trader's usual behaviour."""
    if not prof.get("closed_trades_seen"):
        return ["no history to compare against"]
    notes = []
    share = prof.get("asset_share", {}).get(coin, 0)
    notes.append(f"{coin} is one of their usual assets ({share:.0%} of past trades)" if share >= 0.1
                 else f"{coin} is unusual for them ({share:.0%} of past trades)")
    ls = prof.get("long_share_pct")
    if ls is not None and ((is_long and ls < 30) or (not is_long and ls > 70)):
        notes.append(f"direction is against their habit (they go long {ls}% of the time)")
    ml = prof.get("median_leverage")
    if leverage and ml:
        if leverage >= 1.5 * ml:
            notes.append(f"leverage {leverage:g}x is high for them (usual {ml:g}x)")
        elif leverage <= 0.67 * ml:
            notes.append(f"leverage {leverage:g}x is low for them (usual {ml:g}x)")
        else:
            notes.append(f"leverage {leverage:g}x is normal for them")
    ms = prof.get("median_entry_size_pct")
    if entry_size and ms:
        if entry_size >= 1.5 * ms:
            notes.append(f"position size is bigger than usual ({entry_size:g}% vs typical {ms:g}% of balance)")
        elif entry_size <= 0.67 * ms:
            notes.append(f"position size is smaller than usual ({entry_size:g}% vs typical {ms:g}% of balance)")
    return notes
