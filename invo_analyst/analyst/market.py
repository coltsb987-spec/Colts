"""Market context for a trade, from Hyperliquid's free public /info API (no key, read-only).

Invo trades are Hyperliquid perpetuals, so Hyperliquid is the right price source.
Everything here is plain arithmetic on real candles - nothing is estimated or invented.
If a fetch fails, the field is left out and the explanation is told the data was unavailable.

News: there is no free, reliable, key-less crypto news feed, so news is NOT fetched.
The explanation prompt is told this explicitly so Claude never claims a news reason.
"""

from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger("analyst.market")

HL_INFO = "https://api.hyperliquid.xyz/info"
HOUR_MS = 3_600_000


class MarketDataError(RuntimeError):
    pass


def _info(body: dict, session=None):
    try:
        r = (session or requests).post(HL_INFO, json=body, timeout=15)
    except requests.RequestException as e:
        raise MarketDataError(f"Hyperliquid unreachable: {type(e).__name__}") from e
    if r.status_code != 200:
        raise MarketDataError(f"Hyperliquid HTTP {r.status_code}")
    return r.json()


def candles(coin: str, interval: str, bars: int, end_ms: int | None = None, session=None) -> list[dict]:
    step = {"15m": HOUR_MS // 4, "1h": HOUR_MS, "4h": 4 * HOUR_MS, "1d": 24 * HOUR_MS}[interval]
    end_ms = end_ms or int(time.time() * 1000)
    out = _info({"type": "candleSnapshot", "req": {"coin": coin, "interval": interval,
                                                    "startTime": end_ms - bars * step, "endTime": end_ms}}, session)
    if not isinstance(out, list):
        raise MarketDataError(f"candleSnapshot {coin}: unexpected response")
    return out


def asset_contexts(session=None) -> dict[str, dict]:
    """coin -> {funding_rate_hourly, open_interest, prev_day_px, mark_px, day_volume_usd}."""
    meta, ctxs = _info({"type": "metaAndAssetCtxs"}, session)
    out = {}
    for asset, ctx in zip(meta.get("universe", []), ctxs):
        def f(k):
            try:
                return float(ctx.get(k))
            except (TypeError, ValueError):
                return None
        out[asset["name"]] = {"funding_rate_hourly": f("funding"), "open_interest": f("openInterest"),
                              "prev_day_px": f("prevDayPx"), "mark_px": f("markPx"), "day_volume_usd": f("dayNtlVlm")}
    return out


# ---- pure feature maths (unit-tested) -------------------------------------------

def ema(values: list[float], n: int) -> float | None:
    if len(values) < n:
        return None
    k = 2 / (n + 1)
    e = sum(values[:n]) / n
    for v in values[n:]:
        e = v * k + e * (1 - k)
    return e


def features(raw: list[dict], entry_price: float | None) -> dict:
    """Trend, support/resistance, breakout/pullback, volatility and volume from 1h candles."""
    bars = [{k: float(b[k]) for k in ("o", "h", "l", "c", "v")} for b in raw if all(k in b for k in "ohlcv")]
    if len(bars) < 30:
        return {"note": f"only {len(bars)} hourly candles available - too few for trend analysis"}
    closes = [b["c"] for b in bars]
    last = closes[-1]
    px = entry_price or last
    e20, e50 = ema(closes, 20), ema(closes, 50)
    lookback = bars[-73:-1]  # previous ~3 days, excluding the current bar
    hi = max(b["h"] for b in lookback)
    lo = min(b["l"] for b in lookback)
    trs = [max(b["h"] - b["l"], abs(b["h"] - p["c"]), abs(b["l"] - p["c"])) for p, b in zip(bars[-25:-1], bars[-24:])]
    atr_pct = sum(trs) / len(trs) / last * 100
    vol_recent = sum(b["v"] for b in bars[-6:]) / 6
    vol_base = sum(b["v"] for b in bars[-78:-6]) / max(1, len(bars[-78:-6]))
    ret = lambda n: round((last / closes[-1 - n] - 1) * 100, 2) if len(closes) > n else None

    if e20 and e50:
        trend = "up" if last > e20 > e50 else "down" if last < e20 < e50 else "mixed/sideways"
    else:
        trend = "unknown"
    rng = hi - lo
    pos_in_range = (px - lo) / rng if rng else 0.5
    if px > hi:
        setup = "breakout above the 3-day high"
    elif px < lo:
        setup = "breakdown below the 3-day low"
    elif trend == "up" and pos_in_range < 0.5:
        setup = "pullback within an uptrend"
    elif trend == "down" and pos_in_range > 0.5:
        setup = "bounce within a downtrend"
    elif pos_in_range > 0.85:
        setup = "near resistance (top of 3-day range)"
    elif pos_in_range < 0.15:
        setup = "near support (bottom of 3-day range)"
    else:
        setup = "middle of the 3-day range"
    return {
        "last_price": last,
        "trend_1h": trend,
        "ema20_1h": round(e20, 6) if e20 else None,
        "ema50_1h": round(e50, 6) if e50 else None,
        "change_4h_pct": ret(4), "change_24h_pct": ret(24), "change_72h_pct": ret(72),
        "resistance_3d": hi, "support_3d": lo,
        "entry_position_in_3d_range_pct": round(pos_in_range * 100, 1),
        "setup": setup,
        "atr_1h_pct": round(atr_pct, 2),
        "volume_last_6h_vs_prior_3d_avg": round(vol_recent / vol_base, 2) if vol_base else None,
    }


class MarketContext:
    def __init__(self, session=None):
        self.session = session or requests.Session()
        self._ctx_cache: tuple[float, dict] | None = None

    def _ctxs(self) -> dict:
        if not self._ctx_cache or time.time() - self._ctx_cache[0] > 120:
            self._ctx_cache = (time.time(), asset_contexts(self.session))
        return self._ctx_cache[1]

    def for_trade(self, coin: str, entry_price: float | None) -> dict:
        out: dict = {"news": "NOT AVAILABLE - no news source is connected; do not cite news."}
        try:
            out["asset"] = features(candles(coin, "1h", 120, session=self.session), entry_price)
        except MarketDataError as e:
            out["asset"] = {"note": f"price data unavailable ({e}) - possibly not a Hyperliquid-listed asset"}
        if coin != "BTC":
            try:
                btc = features(candles("BTC", "1h", 120, session=self.session), None)
                out["btc"] = {k: btc.get(k) for k in ("trend_1h", "change_4h_pct", "change_24h_pct", "atr_1h_pct")}
            except MarketDataError as e:
                out["btc"] = {"note": f"unavailable ({e})"}
        try:
            ctxs = self._ctxs()
            c = ctxs.get(coin)
            if c:
                fr = c.get("funding_rate_hourly")
                out["derivatives"] = {
                    "funding_rate_hourly_pct": round(fr * 100, 5) if fr is not None else None,
                    "funding_annualised_pct": round(fr * 24 * 365 * 100, 1) if fr is not None else None,
                    "who_pays_funding": None if fr is None else ("longs pay shorts" if fr > 0 else "shorts pay longs"),
                    "open_interest_coins": c.get("open_interest"),
                    "day_volume_usd": c.get("day_volume_usd"),
                    "note": "open interest is a current snapshot; its change over time is not available",
                }
            # breadth: how many of the 20 biggest-volume coins are up on the day
            top = sorted((v for v in ctxs.values() if v.get("day_volume_usd")), key=lambda v: -v["day_volume_usd"])[:20]
            up = sum(1 for v in top if v.get("mark_px") and v.get("prev_day_px") and v["mark_px"] > v["prev_day_px"])
            out["market_breadth"] = f"{up} of the top {len(top)} Hyperliquid coins by volume are up over 24h"
        except (MarketDataError, ValueError, TypeError) as e:
            out["derivatives"] = {"note": f"unavailable ({e})"}
        return out
