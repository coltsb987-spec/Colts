#!/usr/bin/env python3
"""Invo Top 10 Trade Analyst - research and reporting only. It NEVER places trades.

  python3 invo.py check        # Step 1: can we log in to Invo and read the traders? (few API calls)
  python3 invo.py test-alert   # send a test message to Telegram/email
  python3 invo.py once         # one poll cycle, then stop
  python3 invo.py run          # run forever (Ctrl-C to stop)
  python3 invo.py summary      # send today's summary now
  python3 invo.py status       # what's in the database
  python3 invo.py debug <id or link>   # show exactly what Invo returns for one trader (safe to paste)
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from logging.handlers import RotatingFileHandler

from analyst.alerts import RISK_REMINDER, Alerter
from analyst.config import Config
from analyst.db import DB
from analyst.invo_client import InvoAuthError, InvoClient, InvoError
from analyst.leaderboard import top_traders
from analyst.market import MarketContext
from analyst.reasoner import Reasoner
from analyst.runner import Analyst


def setup_logging(cfg: Config) -> None:
    path = cfg.resolve(cfg.log_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = RotatingFileHandler(path, maxBytes=5_000_000, backupCount=3)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[fh, sh])
    for noisy in ("urllib3", "httpx", "httpx2", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def build(cfg: Config) -> Analyst:
    extra = {p for p in (cfg.leaderboard.get("endpoint_path"), (cfg.posts or {}).get("endpoint_path")) if p}
    client = InvoClient(cfg.resolve("data/tokens.json"), extra_read_paths={"/" + p.lstrip("/") for p in extra})
    return Analyst(cfg, client, DB(cfg.resolve(cfg.db_path)), Reasoner(cfg.claude), Alerter(cfg.alert_channel),
                   MarketContext())


def cmd_check(cfg: Config) -> int:
    client = InvoClient(cfg.resolve("data/tokens.json"),
                        extra_read_paths={"/" + cfg.leaderboard["endpoint_path"].lstrip("/")}
                        if cfg.leaderboard.get("endpoint_path") else set())
    print("1) Logging in to Invo with your refresh token...")
    try:
        client.refresh()
    except InvoAuthError as e:
        print(f"   FAILED: {e}")
        return 2
    except InvoError as e:
        print(f"   FAILED (network/API): {e}")
        return 1
    days = client.refresh_token_days_left()
    print(f"   OK. Token valid for about {days:.0f} more days." if days else "   OK.")
    print(f"2) Reading the leaderboard (mode: {cfg.leaderboard['mode']}, watching {cfg.traders_to_watch})...")
    try:
        traders = top_traders(cfg, client)
    except (InvoError, ValueError) as e:
        print(f"   FAILED: {e}")
        return 1
    for t in traders:
        s = t["stats"]
        print(f"   #{t['rank']} {t['name']}  win rate {s.get('winRate', '?')}  closed trades "
              f"{s.get('closedPositions', '?')}  open {s.get('openPositions', '?')}  id {t['portfolio_id']}")
    print("3) Reading open trades of the first trader...")
    try:
        opens = client.get_open_investments(traders[0]["portfolio_id"])
    except InvoError as e:
        print(f"   FAILED: {e}")
        return 1
    for o in opens[:10]:
        print(f"   {o.get('ticker')} {'LONG' if o.get('directionLong', True) else 'SHORT'} "
              f"{o.get('leverage')}x entry {o.get('entryPrice')}")
    print(f"   {len(opens)} open trade(s). Invo API calls used: {client.calls_made}.")
    s = traders[0]["stats"]
    if not opens and not any(s.get(k) for k in ("closedPositions", "openPositions", "wonPositions", "lostPositions")):
        print("   WARNING: Invo returned no trades and zero stats for this ID. It may be a user/profile ID or an")
        print(f"   empty portfolio. Run:  python3 invo.py debug {traders[0]['portfolio_id']}")
        return 1
    print("   All good.")
    return 0


def cmd_status(cfg: Config) -> int:
    db = DB(cfg.resolve(cfg.db_path))
    c = db.conn
    print(f"Feed status: {db.get_health('feed_status', 'ok')}")
    last = db.get_health("last_good_poll")
    print(f"Last good poll: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(float(last))) if last else 'never'}")
    print(f"Traders tracked: {c.execute('SELECT COUNT(*) FROM traders').fetchone()[0]}")
    print(f"Open positions known: {c.execute('SELECT COUNT(*) FROM open_positions').fetchone()[0]}")
    for row in c.execute("SELECT kind, COUNT(*) n FROM events GROUP BY kind"):
        print(f"Events {row['kind']}: {row['n']}")
    for row in c.execute("SELECT confidence, COUNT(*) n FROM explanations GROUP BY confidence"):
        print(f"Explanations with {row['confidence']} confidence: {row['n']}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "test-alert", "once", "run", "summary", "status", "debug"])
    ap.add_argument("target", nargs="?", help="for debug: a portfolio ID or the trader's page link")
    ap.add_argument("--config", help="path to config.json (default: invo_analyst/config.json)")
    a = ap.parse_args(argv)
    cfg = Config.load(a.config)
    setup_logging(cfg)
    if cfg.dry_run_single_trader and a.command in ("once", "run", "check"):
        logging.getLogger("analyst").info("DRY RUN: watching 1 trader. Set dry_run_single_trader=false to watch %d.",
                                          cfg.num_traders)
    if a.command == "check":
        return cmd_check(cfg)
    if a.command == "status":
        return cmd_status(cfg)
    if a.command == "debug":
        from analyst import debug
        if not a.target:
            print("Usage: python3 invo.py debug <portfolio id or the trader's page link in quotes>")
            return 2
        return debug.run(InvoClient(cfg.resolve("data/tokens.json")), a.target, cfg.resolve("data"))
    if a.command == "test-alert":
        ok = Alerter(cfg.alert_channel).send("Test alert from your Invo analyst. If you can read this, alerts work.\n\n"
                                             + RISK_REMINDER)
        print("sent" if ok else "FAILED - see data/analyst.log")
        return 0 if ok else 1
    analyst = build(cfg)
    if a.command == "once":
        n = analyst.cycle()
        print(f"Cycle complete: {n} new event(s). Invo API calls used: {analyst.client.calls_made}.")
        return 0
    if a.command == "summary":
        analyst.maybe_daily_summary(force=True)
        return 0
    try:
        analyst.run_forever()
    except KeyboardInterrupt:
        print("Stopped. Everything is saved in the database.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
