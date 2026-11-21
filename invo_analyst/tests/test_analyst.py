"""Offline tests: no network, no API keys, no money. Run: python3 -m unittest discover -s tests"""

from __future__ import annotations

import base64
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analyst import alerts as A  # noqa: E402
from analyst.config import Config, parse_portfolio_id  # noqa: E402
from analyst.db import DB  # noqa: E402
from analyst.detector import detect, find_cluster, pnl_pct  # noqa: E402
from analyst.history import fit, profile  # noqa: E402
from analyst.invo_client import (InvoAuthError, InvoClient, InvoFeedChangedError, assert_read_only)  # noqa: E402
from analyst.leaderboard import _find_portfolios  # noqa: E402
from analyst.market import features  # noqa: E402
from analyst.ratelimit import SlidingWindowLimiter  # noqa: E402
from analyst.runner import Analyst  # noqa: E402
from analyst.summary import collect, render  # noqa: E402

P1 = "11111111-1111-1111-1111-111111111111"
P2 = "22222222-2222-2222-2222-222222222222"


def inv(base_id, ticker="BTC", long=True, lev=5, size=2.0, entry=100.0, created="2026-11-20T10:00:00Z", **kw):
    d = {"baseId": base_id, "ticker": ticker, "directionLong": long, "leverage": lev, "entrySize": size,
         "entryPrice": entry, "createdAt": created, "isOpen": True}
    d.update(kw)
    return d


def jwt(claims: dict) -> str:
    b = lambda x: base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip("=")
    return f"{b({'alg': 'none'})}.{b(claims)}.sig"


KW = dict(min_size_change_pct=10, close_confirm_polls=2, alert_existing=False)


class DetectorTests(unittest.TestCase):
    def setUp(self):
        self.db = DB(":memory:")

    def kinds(self, ids):
        return [self.db.event(i)["kind"] for i in ids]

    def test_first_snapshot_is_silent_baseline(self):
        self.assertEqual(detect(self.db, P1, "alice", [inv("a")], [], **KW), [])
        self.assertEqual(len(self.db.open_positions(P1)), 1)

    def test_existing_positions_alert_when_configured(self):
        ids = detect(self.db, P1, "alice", [inv("a")], [], **{**KW, "alert_existing": True})
        self.assertEqual(self.kinds(ids), ["opened"])

    def test_new_open_after_baseline(self):
        detect(self.db, P1, "alice", [], [], **KW)
        ids = detect(self.db, P1, "alice", [inv("a", ticker="eth-perp", long=False)], [], **KW)
        e = self.db.event(ids[0])
        self.assertEqual((e["kind"], e["coin"], e["is_long"]), ("opened", "ETH", 0))

    def test_size_and_leverage_changes(self):
        detect(self.db, P1, "alice", [inv("a")], [], **KW)
        self.assertEqual(detect(self.db, P1, "alice", [inv("a", size=2.1)], [], **KW), [])  # 5% wobble ignored
        ids = detect(self.db, P1, "alice", [inv("a", size=3.0, lev=10)], [], **KW)
        self.assertEqual(sorted(self.kinds(ids)), ["leverage_changed", "size_changed"])

    def test_close_found_in_closed_list(self):
        detect(self.db, P1, "alice", [], [], **KW)
        detect(self.db, P1, "alice", [inv("a", entry=100, lev=5)], [], **KW)
        closed = [inv("a", entry=100, lev=5, isOpen=False, closingPrice=110, closedAt="2026-11-20T14:00:00Z",
                      reasonClosed="take_profit")]
        ids = detect(self.db, P1, "alice", [], closed, **KW)
        e = self.db.event(ids[0])
        self.assertEqual(e["kind"], "closed")
        self.assertAlmostEqual(e["pnl_pct"], 50.0)
        self.assertAlmostEqual(e["hold_seconds"], 4 * 3600)
        self.assertIsNotNone(json.loads(e["raw_json"])["open_event_id"])
        self.assertEqual(self.db.open_positions(P1), [])

    def test_close_needs_confirmation_when_not_in_closed_list(self):
        detect(self.db, P1, "alice", [inv("a")], [], **KW)
        self.assertEqual(detect(self.db, P1, "alice", [], [], **KW), [])  # 1st miss: wait
        ids = detect(self.db, P1, "alice", [], [], **KW)  # 2nd miss: closed, exit unknown
        self.assertEqual(self.kinds(ids), ["closed"])
        self.assertIsNone(self.db.event(ids[0])["pnl_pct"])

    def test_reappearing_position_resets_missing_count(self):
        detect(self.db, P1, "alice", [inv("a")], [], **KW)
        detect(self.db, P1, "alice", [], [], **KW)
        detect(self.db, P1, "alice", [inv("a")], [], **KW)
        self.assertEqual(detect(self.db, P1, "alice", [], [], **KW), [])

    def test_short_pnl(self):
        self.assertAlmostEqual(pnl_pct(False, 100, 90, 3), 30.0)
        self.assertIsNone(pnl_pct(True, 100, None, 3))

    def test_cluster(self):
        for p, n in ((P1, "alice"), (P2, "bob")):
            self.db.upsert_trader(p, n, 1, {})
            detect(self.db, p, n, [], [], **KW)
        detect(self.db, P1, "alice", [inv("a", ticker="SOL")], [], **KW)
        ids = detect(self.db, P2, "bob", [inv("b", ticker="SOL")], [], **KW)
        names = sorted(c["name"] for c in find_cluster(self.db, ids[0], 24, 2))
        self.assertEqual(names, ["alice", "bob"])
        ids = detect(self.db, P2, "bob", [inv("b", ticker="SOL"), inv("c", ticker="DOGE")], [], **KW)
        self.assertEqual(find_cluster(self.db, ids[0], 24, 2), [])


class SafetyTests(unittest.TestCase):
    def test_trade_paths_are_refused(self):
        for p in ("/dex/position/create", "/v1_0/investments/ticker/create", "/v1_0/investments/sell",
                  "/v1_0/investments/ticker/modify", "/v1_0/posts/repost_investment"):
            with self.assertRaises(PermissionError):
                assert_read_only(p, {p})  # refused even when the owner whitelists it

    def test_read_paths_allowed(self):
        assert_read_only("/v1_0/investments/get_investments")
        assert_read_only("/v1_0/leaderboard/get_top", {"/v1_0/leaderboard/get_top"})
        with self.assertRaises(PermissionError):
            assert_read_only("/v1_0/leaderboard/get_top")  # not configured -> refused

    def test_no_trading_code_anywhere(self):
        src = "".join(p.read_text() for p in (Path(__file__).parent.parent / "analyst").glob("*.py"))
        for bad in ("/dex/", "ticker/create", "investments/sell"):
            self.assertNotIn(f'post("{bad}', src)
            self.assertNotIn(f"post('{bad}", src)

    def test_config_floor_on_poll_interval(self):
        with self.assertRaises(ValueError):
            Config(poll_interval_seconds=10).validate()
        with self.assertRaises(ValueError):
            Config(num_traders=50).validate()


class FakeResp:
    def __init__(self, status, body, headers=None):
        self.status_code, self.text, self.headers = status, json.dumps(body), headers or {}


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def get(self, url, **kw):
        self.calls.append(("GET", url))
        return self.responses.pop(0)

    def post(self, url, **kw):
        self.calls.append(("POST", url))
        return self.responses.pop(0)


class ClientTests(unittest.TestCase):
    def make(self, responses, token=None):
        d = tempfile.mkdtemp()
        token = token or jwt({"expires": time.time() + 86400 * 300, "user_id": "u1"})
        return InvoClient(Path(d) / "tokens.json", refresh_token=token, session=FakeSession(responses),
                          limiter=SlidingWindowLimiter(100, 1), sleep=lambda s: None)

    def test_refresh_then_read_and_token_saved(self):
        access = jwt({"expires": time.time() + 600})
        c = self.make([FakeResp(200, {"accessToken": access}), FakeResp(200, {"investmentsTicker": [inv("a")]})])
        self.assertEqual(len(c.get_open_investments(P1)), 1)
        self.assertEqual(json.loads(c.store.path.read_text())["access_token"], access)
        self.assertEqual(c.store.path.stat().st_mode & 0o077, 0)  # owner-only file

    def test_401_triggers_one_refresh(self):
        a = jwt({"expires": time.time() + 600})
        c = self.make([FakeResp(200, {"accessToken": a}), FakeResp(401, {}), FakeResp(200, {"accessToken": a}),
                       FakeResp(200, {"investmentsTicker": []})])
        self.assertEqual(c.get_open_investments(P1), [])

    def test_expired_refresh_token(self):
        c = self.make([], token=jwt({"expires": time.time() - 10}))
        with self.assertRaises(InvoAuthError):
            c.refresh()

    def test_rejected_token(self):
        with self.assertRaises(InvoAuthError):
            self.make([FakeResp(401, {"error": "nope"})]).refresh()

    def test_schema_change_detected(self):
        a = jwt({"expires": time.time() + 600})
        c = self.make([FakeResp(200, {"accessToken": a}), FakeResp(200, {"somethingElse": []})])
        with self.assertRaises(InvoFeedChangedError):
            c.get_open_investments(P1)

    def test_429_backoff_then_success(self):
        a = jwt({"expires": time.time() + 600})
        c = self.make([FakeResp(200, {"accessToken": a}), FakeResp(429, {}, {"retry-after": "1"}),
                       FakeResp(200, {"investmentsTicker": []})])
        self.assertEqual(c.get_open_investments(P1), [])


class MarketAndHistoryTests(unittest.TestCase):
    def bars(self, closes):
        return [{"o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 100} for c in closes]

    def test_uptrend_breakout(self):
        f = features(self.bars([100 + i for i in range(100)]), entry_price=210)
        self.assertEqual(f["trend_1h"], "up")
        self.assertIn("breakout", f["setup"])

    def test_downtrend(self):
        f = features(self.bars([300 - i for i in range(100)]), entry_price=None)
        self.assertEqual(f["trend_1h"], "down")

    def test_too_few_candles(self):
        self.assertIn("too few", features(self.bars([1, 2, 3]), 1)["note"])

    def test_profile_and_fit(self):
        closed = [inv(str(i), ticker="BTC", lev=5, size=2, entry=100, closingPrice=101 if i % 2 else 99,
                      closedAt="2026-11-20T12:00:00Z") for i in range(10)]
        prof = profile(closed)
        self.assertEqual(prof["win_rate_pct"], 50.0)
        self.assertEqual(prof["median_hold_hours"], 2.0)
        notes = " ".join(fit(prof, "PEPE", False, 20, 5))
        self.assertIn("unusual", notes)
        self.assertIn("high for them", notes)
        self.assertIn("bigger than usual", notes)

    def test_find_portfolios_in_unknown_response(self):
        data = {"data": {"items": [{"portfolio": {"id": P1, "owner": {"username": "a"}}}, {"id": P2}]}}
        self.assertEqual([p["id"] for p in _find_portfolios(data)], [P1, P2])

    def test_parse_portfolio_url(self):
        self.assertEqual(parse_portfolio_id(f"https://app.invoapp.com/portfolio/{P1}"), P1)
        self.assertIsNone(parse_portfolio_id("PASTE-PORTFOLIO-ID-OR-URL-HERE"))


# ---- end-to-end with fakes ------------------------------------------------------------

class FakeInvo:
    def __init__(self):
        self.open = {P1: [], P2: []}
        self.closed = {P1: [], P2: []}
        self.calls_made = 0
        self.fail = None

    def get_portfolio(self, pid):
        return {"id": pid, "owner": {"username": {P1: "alice", P2: "bob"}[pid]}, "winRate": 60}

    def get_open_investments(self, pid):
        if self.fail:
            raise self.fail
        return self.open[pid]

    def get_recent_closed(self, pid):
        return self.closed[pid]

    def get_closed_history(self, pid):
        return []

    def refresh_token_days_left(self):
        return 300


class FakeReasoner:
    def explain_move(self, move, evidence):
        self.last_evidence = evidence
        return {"reason": "Likely a breakout.", "confidence": "medium", "reason_unclear": False,
                "evidence_used": ["breakout"], "fits_usual_pattern": "unknown", "model": "fake"}

    def review_close(self, ev, original, price):
        self.last_original = original
        return {"note": "Breakout held.", "reasoning_played_out": "yes", "confidence": "medium", "model": "fake"}

    def summarise_day(self, facts):
        return {"patterns": ["Both traders favoured SOL longs"], "what_seems_to_work": ["Holding breakouts"]}


class FakeMarket:
    def for_trade(self, coin, px):
        return {"asset": {"trend_1h": "up"}, "news": "NOT AVAILABLE"}


class FakeAlerter:
    def __init__(self):
        self.sent = []

    def send(self, text, subject=""):
        self.sent.append(text)
        return True


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.cfg = Config(dry_run_single_trader=False, num_traders=2,
                          leaderboard={"mode": "manual", "portfolio_ids": [P1, P2]})
        self.invo, self.alerts, self.reasoner = FakeInvo(), FakeAlerter(), FakeReasoner()
        self.an = Analyst(self.cfg, self.invo, DB(":memory:"), self.reasoner, self.alerts, FakeMarket())

    def test_full_flow(self):
        self.an.cycle()  # baseline
        self.assertEqual(self.alerts.sent, [])
        self.invo.open[P1] = [inv("a", ticker="SOL", entry=150)]
        self.invo.open[P2] = [inv("b", ticker="SOL", entry=151)]
        self.assertEqual(self.an.cycle(), 2)
        self.assertIn("NEW TRADE: alice", self.alerts.sent[0])
        self.assertIn("MEDIUM confidence", self.alerts.sent[0])
        self.assertIn("CLUSTER", self.alerts.sent[1])
        self.assertEqual(self.reasoner.last_evidence["other_watched_traders_same_side"], ["alice"])
        # close
        self.invo.open[P1] = []
        self.invo.closed[P1] = [inv("a", ticker="SOL", entry=150, isOpen=False, closingPrice=165,
                                    closedAt="2026-11-20T12:00:00Z")]
        self.an.cycle()
        self.assertIn("TRADE CLOSED: alice", self.alerts.sent[-1])
        self.assertEqual(self.reasoner.last_original["reason"], "Likely a breakout.")
        # daily summary
        text = self.an.maybe_daily_summary(force=True)
        self.assertIn("SOL long", text)
        self.assertIn("past results do not guarantee", text)
        self.assertIn("hypotheses", text)

    def test_feed_change_alerts_once_and_recovers(self):
        self.an.cycle()
        self.invo.fail = InvoFeedChangedError("investmentsTicker missing")
        for _ in range(2):
            try:
                self.an.cycle()
            except InvoFeedChangedError as e:
                self.an._feed_problem("api_changed", str(e))
        self.assertEqual(sum("DATA FEED PROBLEM" in s for s in self.alerts.sent), 1)
        self.invo.fail = None
        self.an.cycle()
        self.assertIn("RESTORED", self.alerts.sent[-1])

    def test_failed_fetch_never_counts_as_close(self):
        from analyst.invo_client import InvoError
        self.an.cycle()
        self.invo.open[P1] = [inv("a")]
        self.an.cycle()
        self.invo.fail = InvoError("timeout")
        for _ in range(4):
            self.an.cycle()
        self.assertFalse(any("CLOSED" in s for s in self.alerts.sent))


class ReasonerTests(unittest.TestCase):
    def test_calls_claude_with_schema_and_parses(self):
        from types import SimpleNamespace
        from analyst.reasoner import Reasoner
        seen = {}

        class Msgs:
            def create(self, **kw):
                seen.update(kw)
                body = {"reason": "Possibly a pullback buy.", "confidence": "low", "reason_unclear": True,
                        "evidence_used": [], "fits_usual_pattern": "unknown"}
                return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(body))])

        client = SimpleNamespace(beta=SimpleNamespace(messages=Msgs()))
        r = Reasoner({"enabled": True, "model": "claude-opus-5-5"}, client=client)
        out = r.explain_move({"coin": "BTC"}, {"news": "NOT AVAILABLE"})
        self.assertEqual(out["confidence"], "low")
        self.assertEqual(seen["model"], "claude-opus-5-5")
        self.assertEqual(seen["output_config"]["format"]["type"], "json_schema")
        self.assertIn("Never invent", seen["system"])

    def test_disabled_reasoner_says_not_analysed(self):
        from analyst.reasoner import Reasoner
        out = Reasoner({"enabled": False}).explain_move({}, {})
        self.assertEqual(out["confidence"], "low")
        self.assertIn("Not analysed", out["reason"])


class SummaryTests(unittest.TestCase):
    def test_empty_day_still_has_risk_reminder(self):
        text = render(collect(DB(":memory:"), 0), None, "ok")
        self.assertIn("No trade moves", text)
        self.assertIn(A.RISK_REMINDER, text)


if __name__ == "__main__":
    unittest.main()
