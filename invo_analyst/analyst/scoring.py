"""Scoring: (1) every closed trade, (2) a rolling 7/30/90-day score per trader.

All scores are 0-100 where higher is better. `None` means "not enough data" and is never guessed.
Every formula is plain arithmetic so the working can be shown and checked.

Units:
  move_pct            price move in the trade's favour, %  (e.g. +2 = price went 2% the right way)
  pnl_pct (on margin) move_pct x leverage
  account_return_pct  pnl_pct x entry_size% / 100 = effect on the trader's whole balance, %
                      (entry_size is Invo's margin as % of balance). This is the fair way to compare
                      traders: a 50x trade with 0.5% of the balance risks less than a 5x all-in trade.
"""

from __future__ import annotations

import math
import statistics
import time
from collections import defaultdict

from .detector import _f, normalize_coin, parse_ts

WINDOWS = (7, 30, 90)

# ---- helpers ------------------------------------------------------------------

def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def account_return(pnl_on_margin_pct: float | None, entry_size_pct: float | None) -> float | None:
    if pnl_on_margin_pct is None or not entry_size_pct:
        return None
    return pnl_on_margin_pct * entry_size_pct / 100


def excursions(candles: list[dict], entry: float, is_long: bool) -> tuple[float, float] | None:
    """Worst move against (MAE) and best move for (MFE) the trade while it was open, in % (both >= 0)."""
    hi = [float(c["h"]) for c in candles if "h" in c]
    lo = [float(c["l"]) for c in candles if "l" in c]
    if not hi or not entry:
        return None
    up, down = (max(hi) / entry - 1) * 100, (1 - min(lo) / entry) * 100
    mfe, mae = (up, down) if is_long else (down, up)
    return max(0.0, mae), max(0.0, mfe)


# ---- (1) per-trade score ------------------------------------------------------

TRADE_WEIGHTS = {"pnl": 25, "risk": 15, "entry": 15, "exit": 15, "reasoning": 15, "hold": 15}
REASONING_POINTS = {"yes": 90, "partly": 60, "no": 20}


def score_trade(*, is_long: bool, entry: float | None, exit_: float | None, leverage: float | None,
                entry_size: float | None, hold_hours: float | None, usual_hold_hours: float | None,
                had_stop_loss: bool, excursion: tuple[float, float] | None, reasoning_played_out: str | None) -> dict:
    lev = leverage or 1.0
    move = None if not (entry and exit_) else (exit_ / entry - 1) * 100 * (1 if is_long else -1)
    pnl = None if move is None else move * lev
    acct = account_return(pnl, entry_size)
    s: dict = {"move_pct": _r(move), "pnl_on_margin_pct": _r(pnl), "account_return_pct": _r(acct, 3)}
    notes: list[str] = []

    # Profit/loss: judged on the whole balance when we know the size, else on margin (scaled down).
    basis = acct if acct is not None else (pnl / 10 if pnl is not None else None)
    s["score_pnl"] = None if basis is None else _r(clamp(50 + 50 * math.tanh(basis / 2)))

    # Risk taken: exposure = leverage x share of balance. 10% of balance exposed is calm; 200%+ is extreme.
    exposure = lev * entry_size if entry_size else None
    risk = 100 - clamp(25 * math.log2(max(lev, 1)))  # leverage alone: 1x=100, 4x=50, 16x=0
    if exposure is not None:
        risk = 0.5 * risk + 0.5 * (100 - clamp(30 * math.log2(max(exposure, 1) / 10 + 1)))
    if not had_stop_loss:
        risk -= 10
        notes.append("no stop-loss set")
    s["exposure_pct_of_balance"] = _r(exposure)
    s["score_risk"] = _r(clamp(risk))

    # Entry and exit quality need the price path while the trade was open.
    if excursion and move is not None:
        mae, mfe = excursion
        s["mae_pct"], s["mfe_pct"] = _r(mae), _r(mfe)
        # Entry: how little it went against them compared with how far it went their way.
        s["score_entry"] = _r(100 * mfe / (mae + mfe)) if mae + mfe > 0 else 50.0
        # Exit: where the exit sits between the worst (-MAE) and best (+MFE) price seen.
        span = mae + mfe
        s["score_exit"] = _r(clamp(100 * (move + mae) / span)) if span > 0 else 50.0
    else:
        s["score_entry"] = s["score_exit"] = None
        notes.append("price path unavailable: entry/exit quality not scored")

    s["score_reasoning"] = REASONING_POINTS.get(reasoning_played_out or "")

    # Holding time: winners held at least as long as usual and losers cut quicker is the healthy pattern.
    if hold_hours and usual_hold_hours and pnl is not None:
        ratio = math.log2(max(hold_hours, 0.01) / max(usual_hold_hours, 0.01))
        s["score_hold"] = _r(clamp(60 + 20 * ratio if pnl > 0 else 60 - 20 * ratio))
    else:
        s["score_hold"] = None

    parts = {k: s[f"score_{k}"] for k in TRADE_WEIGHTS if s.get(f"score_{k}") is not None}
    w = sum(TRADE_WEIGHTS[k] for k in parts)
    s["overall"] = _r(sum(TRADE_WEIGHTS[k] * v for k, v in parts.items()) / w) if w else None
    s["components_used"] = sorted(parts)
    s["notes"] = notes
    return s


# ---- (2) rolling trader score -------------------------------------------------

ROLLING_WEIGHTS = {"win_rate": 15, "payoff": 15, "risk_adjusted": 25, "consistency": 15, "drawdown": 20, "quality": 10}
MIN_TRADES = 3
FULL_CONFIDENCE_TRADES = 20


def closed_trades(raw: list[dict]) -> list[dict]:
    """Invo closed-trade dicts -> [{closed_ts, coin, is_long, lev, size, pnl, acct, hold_h}], oldest first."""
    out = []
    for t in raw:
        entry, exit_ = _f(t.get("entryPrice")), _f(t.get("closingPrice"))
        closed = parse_ts(t.get("closedAt") or t.get("updatedAt"))
        if not (entry and exit_ and closed):
            continue
        is_long = bool(t.get("directionLong", True))
        lev = _f(t.get("leverage")) or 1.0
        pnl = (exit_ / entry - 1) * 100 * (1 if is_long else -1) * lev
        size = _f(t.get("entrySize"))
        opened = parse_ts(t.get("createdAt"))
        out.append({"closed_ts": closed, "coin": normalize_coin(str(t.get("ticker") or "")), "is_long": is_long,
                    "lev": lev, "size": size, "pnl": pnl, "acct": account_return(pnl, size),
                    "hold_h": (closed - opened) / 3600 if opened and closed >= opened else None})
    return sorted(out, key=lambda x: x["closed_ts"])


def window_metrics(trades: list[dict], days: int, now: float, quality_scores: list[float] | None = None) -> dict:
    ts = [t for t in trades if t["closed_ts"] >= now - days * 86400]
    m: dict = {"window_days": days, "trades": len(ts)}
    if len(ts) < MIN_TRADES:
        m["score"] = None
        m["note"] = f"only {len(ts)} closed trade(s) in {days}d - not scored"
        return m
    # Per-trade return on the whole balance; fall back to margin return / 10 when size is unknown.
    r = [t["acct"] if t["acct"] is not None else t["pnl"] / 10 for t in ts]
    m["size_known_share"] = _r(sum(t["acct"] is not None for t in ts) / len(ts), 2)
    wins, losses = [x for x in r if x > 0], [x for x in r if x <= 0]
    m["win_rate_pct"] = _r(100 * len(wins) / len(r))
    m["avg_win_pct"] = _r(statistics.mean(wins), 3) if wins else 0.0
    m["avg_loss_pct"] = _r(statistics.mean(losses), 3) if losses else 0.0
    payoff = (m["avg_win_pct"] / abs(m["avg_loss_pct"])) if losses and m["avg_loss_pct"] else (10.0 if wins else 0.0)
    m["payoff_ratio"] = _r(payoff, 2)
    eq, peak, mdd = 1.0, 1.0, 0.0
    for x in r:
        eq *= 1 + x / 100
        peak = max(peak, eq)
        mdd = max(mdd, 1 - eq / peak)
    m["total_return_pct"] = _r((eq - 1) * 100, 2)
    m["max_drawdown_pct"] = _r(mdd * 100, 2)
    sd = statistics.pstdev(r)
    m["risk_adjusted"] = _r(statistics.mean(r) / sd * math.sqrt(len(r)), 2) if sd > 0 else None  # t-stat style
    by_day: dict[str, float] = defaultdict(float)
    for t, x in zip(ts, r):
        by_day[time.strftime("%Y-%m-%d", time.gmtime(t["closed_ts"]))] += x
    m["active_days"] = len(by_day)
    m["green_day_pct"] = _r(100 * sum(v > 0 for v in by_day.values()) / len(by_day))
    levs = [t["lev"] for t in ts]
    m["median_leverage"], m["max_leverage"] = statistics.median(levs), max(levs)
    if quality_scores:
        m["avg_trade_quality"] = _r(statistics.mean(quality_scores))
        m["trades_quality_scored"] = len(quality_scores)

    comp = {
        "win_rate": m["win_rate_pct"],
        "payoff": 100 * payoff / (payoff + 1),
        "risk_adjusted": None if m["risk_adjusted"] is None else 50 + 50 * math.tanh(m["risk_adjusted"] / 3),
        "consistency": m["green_day_pct"],
        "drawdown": clamp(100 - 2 * m["max_drawdown_pct"]),  # 0% -> 100, 25% -> 50, 50%+ -> 0
        "quality": m.get("avg_trade_quality") if quality_scores and len(quality_scores) >= 3 else None,
    }
    comp = {k: _r(v) for k, v in comp.items() if v is not None}
    w = sum(ROLLING_WEIGHTS[k] for k in comp)
    raw = sum(ROLLING_WEIGHTS[k] * v for k, v in comp.items()) / w
    m["components"] = comp

    penalties = {}
    net = sum(r)
    best = max(r)
    if net > 0 and best > 0:
        share = best / net
        m["best_trade_share_of_profit"] = _r(share, 2)
        if net - best <= 0:
            penalties["profit_from_one_lucky_trade"] = 25.0
        elif share > 0.5:
            penalties["profit_concentrated_in_one_trade"] = _r(min(20, 40 * (share - 0.5)))
    if m["median_leverage"] > 20:
        penalties["very_high_typical_leverage"] = _r(min(20, m["median_leverage"] - 20))
    if m["max_leverage"] >= 50:
        penalties["extreme_max_leverage"] = 10.0
    m["penalties"] = penalties
    score = raw - sum(penalties.values())
    # Few trades = more luck: pull the score towards neutral 50.
    trust = min(1.0, len(ts) / FULL_CONFIDENCE_TRADES)
    m["sample_trust"] = _r(trust, 2)
    m["score"] = _r(clamp(50 + (score - 50) * trust))
    return m


def rolling_scores(raw_closed: list[dict], now: float, quality_by_window: dict[int, list[float]] | None = None) -> dict:
    trades = closed_trades(raw_closed)
    return {d: window_metrics(trades, d, now, (quality_by_window or {}).get(d)) for d in WINDOWS}


def side_performance(raw_closed: list[dict], now: float, days: int = 30) -> dict:
    """Return on balance and trade count by direction, for the style-fit check."""
    out = {"long": {"n": 0, "ret": 0.0}, "short": {"n": 0, "ret": 0.0}}
    for t in closed_trades(raw_closed):
        if t["closed_ts"] < now - days * 86400:
            continue
        side = out["long" if t["is_long"] else "short"]
        side["n"] += 1
        side["ret"] += t["acct"] if t["acct"] is not None else t["pnl"] / 10
    for v in out.values():
        v["ret"] = _r(v["ret"], 3)
    return out


def _r(x, nd: int = 1):
    return None if x is None else round(float(x), nd)
