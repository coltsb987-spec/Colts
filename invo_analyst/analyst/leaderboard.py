"""Which traders to watch.

Invo has no documented leaderboard endpoint, and none of the open-source projects call one. So there
are three modes (config.json -> leaderboard.mode):

  manual    You paste the top-10 portfolio IDs/URLs from the Invo leaderboard page into config.json.
            Most reliable. Re-paste when the leaderboard changes.
  followed  You follow the top 10 in the Invo app; we read your followed list (a known endpoint)
            and rank it by `rank_by` (e.g. plSnapshot, winRate).
  endpoint  You copy the leaderboard request from your browser's DevTools (README Step 3) into
            endpoint_path / endpoint_body. We call it read-only and pull the portfolio list out.
"""

from __future__ import annotations

import logging

from .config import Config, parse_portfolio_id
from .invo_client import InvoClient, InvoFeedChangedError

log = logging.getLogger("analyst.leaderboard")


def _name(p: dict) -> str:
    owner = p.get("owner") or {}
    return owner.get("username") or owner.get("name") or p.get("title") or str(p.get("id", ""))[:8]


def _num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return float("-inf")


def _find_portfolios(obj, depth: int = 0) -> list[dict]:
    """Find the first list of dicts that look like portfolios (have an id plus owner/title)."""
    if depth > 4:
        return []
    if isinstance(obj, list) and obj and all(isinstance(x, dict) for x in obj):
        flat = [x.get("portfolio") if isinstance(x.get("portfolio"), dict) else x for x in obj]
        if all(parse_portfolio_id(str(x.get("id") or x.get("portfolioId") or "")) for x in flat):
            return flat
    if isinstance(obj, dict):
        for v in obj.values():
            found = _find_portfolios(v, depth + 1)
            if found:
                return found
    return []


def top_traders(cfg: Config, client: InvoClient) -> list[dict]:
    """Return [{portfolio_id, name, rank, stats}] for the traders to watch, best first."""
    lb = cfg.leaderboard
    n = cfg.traders_to_watch
    mode = lb.get("mode")
    if mode == "manual":
        ids = [parse_portfolio_id(x) for x in lb.get("portfolio_ids", [])]
        ids = [i for i in ids if i]
        if not ids:
            raise ValueError("leaderboard.portfolio_ids in config.json has no valid portfolio IDs/URLs yet")
        out = []
        for rank, pid in enumerate(ids[:n], 1):
            p = client.get_portfolio(pid)
            out.append({"portfolio_id": pid, "name": _name(p), "rank": rank, "stats": _stats(p)})
        return out
    if mode == "followed":
        ports = client.get_followed_portfolios()
    else:
        path = lb.get("endpoint_path")
        if not path:
            raise ValueError("leaderboard.mode is 'endpoint' but endpoint_path is empty")
        data = client.post(path, lb.get("endpoint_body") or {})
        ports = _find_portfolios(data)
        if not ports:
            raise InvoFeedChangedError(f"leaderboard endpoint {path} returned no recognisable portfolio list")
    key = lb.get("rank_by")
    if key and mode == "followed":
        ports = sorted(ports, key=lambda p: _num(p.get(key)), reverse=True)
    out = []
    for rank, p in enumerate(ports[:n], 1):
        pid = parse_portfolio_id(str(p.get("id") or p.get("portfolioId")))
        out.append({"portfolio_id": pid, "name": _name(p), "rank": rank, "stats": _stats(p)})
    return out


def _stats(p: dict) -> dict:
    keys = ("winRate", "wonPositions", "lostPositions", "closedPositions", "openPositions", "followerCount",
            "plSnapshot", "avgPlRealized", "avgHoldTimeSeconds", "liquidated", "currentWinStreak")
    return {k: p.get(k) for k in keys if k in p}
