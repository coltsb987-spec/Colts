"""The main loop: leaderboard -> poll each trader -> detect moves -> explain -> alert -> daily summary.

Recovery rules:
  * Any error on one trader is logged and that trader is skipped this cycle; the others continue.
  * Login problems and "Invo changed its API" problems send ONE alert, then retry slowly, and send a
    "feed restored" alert when it works again.
  * Events are written to SQLite before alerting, so a crash never loses a move; unsent alerts are
    retried on the next cycle.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

from . import alerts as A
from .config import Config
from .db import DB
from .detector import detect, find_cluster
from .history import fit, profile
from .invo_client import (InvoAuthError, InvoClient, InvoError, InvoFeedChangedError, InvoRateLimitError)
from .leaderboard import top_traders
from .market import MarketContext
from .reasoner import Reasoner
from .summary import collect, render

log = logging.getLogger("analyst.runner")

AUTH_RETRY_SECONDS = 900
HISTORY_TTL_SECONDS = 12 * 3600
FEED_FAIL_ALERT_AFTER = 3  # consecutive failed cycles before we tell the owner


class Analyst:
    def __init__(self, cfg: Config, client: InvoClient, db: DB, reasoner: Reasoner, alerter: A.Alerter,
                 market: MarketContext):
        self.cfg, self.client, self.db, self.reasoner, self.alerter, self.market = cfg, client, db, reasoner, alerter, market
        self.watch: list[dict] = []
        self.watch_at = 0.0
        self._history: dict[str, tuple[float, dict]] = {}
        self._fail_streak = 0

    # ---- feed health --------------------------------------------------------
    def _feed_problem(self, kind: str, msg: str) -> None:
        log.error("%s: %s", kind, msg)
        if self.db.get_health("feed_status", "ok") != kind:
            self.db.set_health("feed_status", kind)
            self.alerter.send(f"DATA FEED PROBLEM ({kind})\n{msg}\n\nThe analyst keeps retrying automatically and "
                              "will tell you when it works again. No trades are missed silently: anything that "
                              "happened meanwhile is detected on recovery (but alerts will be late).",
                              subject="Invo analyst: data feed problem")

    def _feed_ok(self) -> None:
        if self.db.get_health("feed_status", "ok") != "ok":
            self.alerter.send("DATA FEED RESTORED - Invo data is flowing again.", subject="Invo analyst: feed restored")
            self.db.set_health("feed_status", "ok")
        self.db.set_health("last_good_poll", str(time.time()))

    # ---- one cycle ----------------------------------------------------------
    def refresh_watchlist(self, force: bool = False) -> None:
        if not force and self.watch and time.time() - self.watch_at < self.cfg.leaderboard_refresh_minutes * 60:
            return
        new = top_traders(self.cfg, self.client)
        old_ids = {t["portfolio_id"] for t in self.watch}
        for t in new:
            self.db.upsert_trader(t["portfolio_id"], t["name"], t["rank"], t["stats"])
            if self.watch and t["portfolio_id"] not in old_ids:
                log.info("new trader in the top list: %s", t["name"])
        self.watch, self.watch_at = new, time.time()
        log.info("watching %d trader(s): %s", len(new), ", ".join(t["name"] for t in new))

    def cycle(self) -> int:
        """One full pass. Returns number of new events."""
        self.refresh_watchlist()
        new_events, failures = 0, 0
        for t in self.watch:
            pid, name = t["portfolio_id"], t["name"]
            try:
                open_invs = self.client.get_open_investments(pid)
                closed = self.client.get_recent_closed(pid)
            except (InvoAuthError, InvoFeedChangedError):
                raise
            except InvoError as e:
                failures += 1
                log.warning("could not fetch %s this cycle: %s", name, e)
                continue
            ids = detect(self.db, pid, name, open_invs, closed,
                         min_size_change_pct=self.cfg.min_size_change_pct,
                         close_confirm_polls=self.cfg.close_confirm_polls,
                         alert_existing=self.cfg.alert_on_existing_positions_at_start)
            new_events += len(ids)
        if failures == len(self.watch) and self.watch:
            self._fail_streak += 1
            if self._fail_streak >= FEED_FAIL_ALERT_AFTER:
                self._feed_problem("unreachable", f"Every Invo request failed for {self._fail_streak} cycles in a row.")
        else:
            self._fail_streak = 0
            self._feed_ok()
        self.process_pending()
        return new_events

    # ---- explaining + alerting ----------------------------------------------
    def process_pending(self) -> None:
        for ev in self.db.unalerted_events():
            try:
                self._process(ev)
            except Exception:
                log.exception("failed to process event %s; will retry next cycle", ev["id"])

    def _trader_history(self, pid: str) -> dict:
        cached = self._history.get(pid)
        if cached and time.time() - cached[0] < HISTORY_TTL_SECONDS:
            return cached[1]
        try:
            prof = profile(self.client.get_closed_history(pid))
        except InvoError as e:
            prof = {"closed_trades_seen": 0, "note": f"history unavailable ({e})"}
        self._history[pid] = (time.time(), prof)
        return prof

    def _posts(self, pid: str, coin: str, raw: dict) -> list[str]:
        """The trader's own words about this trade, if Invo exposes any. Never guessed."""
        texts = []
        for k in ("description", "comment", "note", "text", "caption", "thesis"):
            v = raw.get(k) if isinstance(raw, dict) else None
            if isinstance(v, str) and v.strip():
                texts.append(v.strip()[:500])
        cfg = self.cfg.posts or {}
        if cfg.get("endpoint_path"):
            try:
                body = json.loads(json.dumps(cfg.get("endpoint_body") or {}).replace("{portfolioId}", pid))
                data = self.client.post(cfg["endpoint_path"], body)
                for s in _strings(data):
                    if coin.lower() in s.lower():
                        texts.append(s[:500])
            except (InvoError, PermissionError) as e:
                log.info("posts unavailable for %s: %s", pid[:8], e)
        return texts[:5]

    def _process(self, ev) -> None:
        e = dict(ev)
        if e["kind"] == "opened":
            cluster = find_cluster(self.db, e["id"], self.cfg.cluster_window_hours, self.cfg.cluster_min_traders)
            if cluster:
                self.db.set_event_cluster(e["id"], cluster)
            pos = next((p for p in self.db.open_positions(e["portfolio_id"]) if p["base_id"] == e["base_id"]), None)
            raw = json.loads(pos["raw_json"]) if pos else {}
            prof = self._trader_history(e["portfolio_id"])
            evidence = {
                "market": self.market.for_trade(e["coin"], e["entry_price"]),
                "trader_history": prof,
                "fit_with_usual_behaviour": fit(prof, e["coin"], bool(e["is_long"]), e["leverage"], e["entry_size"]),
                "trader_stats_on_invo": json.loads((self.db.trader(e["portfolio_id"]) or {"stats_json": "{}"})["stats_json"] or "{}"),
                "trader_own_posts_about_this_trade": self._posts(e["portfolio_id"], e["coin"], raw) or "none found",
                "stop_loss": raw.get("stopLoss"), "take_profit_target": raw.get("priceTarget"),
                "other_watched_traders_same_side": [c["name"] for c in cluster if c["portfolio_id"] != e["portfolio_id"]],
            }
            move = {k: e[k] for k in ("trader_name", "coin", "leverage", "entry_size", "entry_price")}
            move["side"] = "long" if e["is_long"] else "short"
            move["time_utc"] = datetime.fromtimestamp(e["ts"], timezone.utc).isoformat(timespec="minutes")
            expl = self.reasoner.explain_move(move, evidence)
            self.db.save_explanation(e["id"], expl.get("model", "none"), expl["confidence"], expl["reason"],
                                     expl.get("evidence_used", []), evidence)
            text = A.format_open(e, expl, cluster)
        elif e["kind"] == "closed":
            open_id = json.loads(e["raw_json"] or "{}").get("open_event_id")
            orig = self.db.explanation(open_id) if open_id else None
            original = {"reason": orig["reason"], "confidence": orig["confidence"]} if orig else None
            price_now = self.market.for_trade(e["coin"], e["exit_price"]).get("asset", {})
            review = self.reasoner.review_close(
                {k: e[k] for k in ("trader_name", "coin", "is_long", "leverage", "entry_price", "exit_price",
                                   "pnl_pct", "hold_seconds", "reason_closed")}, original, price_now)
            self.db.save_explanation(e["id"], review.get("model", "none"), review["confidence"], review["note"],
                                     {"played_out": review["reasoning_played_out"]}, {"price_at_close": price_now})
            text = A.format_close(e, review)
        else:
            text = A.format_change(e)
        if self.alerter.send(text, subject=f"Invo: {e['trader_name']} {e['kind']} {e['coin']}"):
            self.db.mark_alerted(e["id"])

    # ---- daily summary ------------------------------------------------------
    def maybe_daily_summary(self, now: float | None = None, force: bool = False) -> str | None:
        now = now or time.time()
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        if not force and (time.gmtime(now).tm_hour < self.cfg.daily_summary_hour_utc
                          or self.db.get_health("last_summary_date") == today):
            return None
        facts = collect(self.db, now - 86400)
        ai = self.reasoner.summarise_day(facts) if facts["events_total"] else None
        text = render(facts, ai, self.db.get_health("feed_status", "ok"))
        if self.alerter.send(text, subject="Invo analyst: daily summary") and not force:
            self.db.set_health("last_summary_date", today)
        return text

    # ---- forever ------------------------------------------------------------
    def run_forever(self) -> None:
        log.info("analyst started (read-only). Poll every %ss.", self.cfg.poll_interval_seconds)
        days = self.client.refresh_token_days_left()
        if days is not None and days < 14:
            self.alerter.send(f"Heads up: your Invo refresh token expires in {days:.0f} days. Capture a new one (README Step 2).")
        while True:
            started = time.time()
            wait = self.cfg.poll_interval_seconds
            try:
                n = self.cycle()
                log.info("cycle done: %d new event(s); %d Invo calls so far", n, self.client.calls_made)
                self.maybe_daily_summary()
            except InvoAuthError as e:
                self._feed_problem("login", str(e))
                wait = AUTH_RETRY_SECONDS
            except InvoFeedChangedError as e:
                self._feed_problem("api_changed", f"{e}\nInvo seems to have changed its private API. The code in "
                                                  "analyst/invo_client.py probably needs updating.")
                wait = AUTH_RETRY_SECONDS
            except InvoRateLimitError as e:
                log.warning("rate limited: %s; doubling the wait", e)
                wait *= 2
            except KeyboardInterrupt:
                raise
            except Exception:
                log.exception("unexpected error; continuing after a pause")
            time.sleep(max(30, wait - (time.time() - started)))


def _strings(obj, depth: int = 0) -> list[str]:
    if depth > 5:
        return []
    if isinstance(obj, str):
        return [obj] if len(obj) > 15 else []
    if isinstance(obj, dict):
        return [s for k, v in obj.items() if k in ("text", "content", "body", "description", "caption") or not isinstance(v, str)
                for s in _strings(v, depth + 1)]
    if isinstance(obj, list):
        return [s for v in obj for s in _strings(v, depth + 1)]
    return []
