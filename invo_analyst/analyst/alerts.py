"""Send alerts to Telegram, email, or just the console/log. Message formatting lives here too."""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

import requests

log = logging.getLogger("analyst.alerts")

RISK_REMINDER = ("Reminder: these traders use leverage and can lose money fast. Their past results do not "
                 "guarantee future ones. This is research only, not advice, and nothing here places trades.")


class Alerter:
    def __init__(self, channel: str, session=None):
        self.channel = channel
        self.http = session or requests.Session()
        if channel == "telegram" and not (os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID")):
            log.warning("Telegram selected but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing: printing to console instead")
            self.channel = "console"
        if channel == "email" and not all(os.environ.get(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_TO")):
            log.warning("Email selected but SMTP settings missing in .env: printing to console instead")
            self.channel = "console"

    def send(self, text: str, subject: str = "Invo analyst") -> bool:
        log.info("ALERT\n%s", text)
        try:
            if self.channel == "telegram":
                return self._telegram(text)
            if self.channel == "email":
                return self._email(subject, text)
            print("\n" + text + "\n", flush=True)
            return True
        except Exception as e:  # never let an alert failure kill the loop
            log.error("alert send failed via %s: %s", self.channel, type(e).__name__)
            return False

    def _telegram(self, text: str) -> bool:
        url = f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage"
        ok = True
        for chunk in [text[i:i + 3900] for i in range(0, len(text), 3900)] or [""]:
            r = self.http.post(url, json={"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": chunk,
                                          "disable_web_page_preview": True}, timeout=15)
            if r.status_code != 200:
                log.error("Telegram HTTP %s", r.status_code)  # URL contains the token: never log it
                ok = False
        return ok

    def _email(self, subject: str, text: str) -> bool:
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, os.environ["SMTP_USER"], os.environ["EMAIL_TO"]
        msg.set_content(text)
        with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587")), timeout=20) as s:
            s.starttls()
            s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
            s.send_message(msg)
        return True


def _fmt_px(x) -> str:
    if x is None:
        return "?"
    return f"{x:,.2f}" if x >= 1 else f"{x:.6g}"


def _hold(sec) -> str:
    if sec is None:
        return "unknown"
    h = sec / 3600
    return f"{h * 60:.0f} min" if h < 1 else f"{h:.1f} h" if h < 48 else f"{h / 24:.1f} days"


def format_open(ev, expl: dict, cluster: list[dict]) -> str:
    side = "LONG" if ev["is_long"] else "SHORT"
    lines = [f"NEW TRADE: {ev['trader_name']}",
             f"{ev['coin']} {side} | {ev['leverage']:g}x leverage | size {ev['entry_size'] or '?'}% of their balance",
             f"Entry: {_fmt_px(ev['entry_price'])}",
             f"Likely reason ({expl['confidence'].upper()} confidence): {expl['reason']}"]
    if cluster:
        lines.append(f"CLUSTER: {len(cluster)} watched traders are {side} {ev['coin']}: "
                     + ", ".join(c["name"] or c["portfolio_id"][:8] for c in cluster))
    return "\n".join(lines)


def format_change(ev) -> str:
    side = "LONG" if ev["is_long"] else "SHORT"
    if ev["kind"] == "leverage_changed":
        what = f"leverage {ev['prev_leverage']:g}x -> {ev['leverage']:g}x"
    else:
        direction = "added to" if (ev["entry_size"] or 0) > (ev["prev_entry_size"] or 0) else "reduced"
        what = f"{direction} position: size {ev['prev_entry_size']}% -> {ev['entry_size']}% of balance"
    return f"POSITION CHANGE: {ev['trader_name']}\n{ev['coin']} {side}: {what}"


def format_close(ev, review: dict) -> str:
    side = "LONG" if ev["is_long"] else "SHORT"
    res = "unknown (exit price not reported)" if ev["pnl_pct"] is None else (
        f"{'+' if ev['pnl_pct'] >= 0 else ''}{ev['pnl_pct']:.1f}% on margin (before fees/funding)")
    return "\n".join([
        f"TRADE CLOSED: {ev['trader_name']}",
        f"{ev['coin']} {side} {ev['leverage']:g}x | entry {_fmt_px(ev['entry_price'])} -> exit {_fmt_px(ev['exit_price'])}",
        f"Result: {res} | held {_hold(ev['hold_seconds'])}" + (f" | {ev['reason_closed']}" if ev["reason_closed"] else ""),
        f"Did the original reasoning play out? {review['reasoning_played_out']} ({review['confidence']} confidence): {review['note']}",
    ])
