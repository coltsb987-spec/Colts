"""READ-ONLY client for Invo's private web API (app.invoapp.com).

Invo publishes no API. The endpoints, headers and refresh-token flow below are the ones
documented by the open-source projects cforecki/invo-copytrader and plungarini/invo-sentinel,
which traced them from the web app's own network traffic.

Safety: this client can only call paths on READ_ONLY_PATHS (plus the token refresh and any
read path the owner explicitly configures). Anything that looks like a trade action
(create / modify / sell / close / position / mimic / repost) is refused before a request
is made, even if someone puts it in config.json.

Failure kinds are kept distinct on purpose, so "no trades" never looks like "feed broken":
  InvoAuthError        token missing/expired/rejected -> owner must re-capture the token
  InvoRateLimitError   still 429 after backing off
  InvoFeedChangedError the response no longer has the shape we expect (Invo changed something)
  InvoError            anything else (network, 5xx)
"""

from __future__ import annotations

import base64
import json
import logging
import os
import stat
import time
from pathlib import Path
from typing import Any

import requests

from .ratelimit import SlidingWindowLimiter

log = logging.getLogger("analyst.invo")

BASE_URL = os.environ.get("INVO_API_BASE", "https://api.invoapp.com")
APP_HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://app.invoapp.com",
    "Referer": "https://app.invoapp.com/",
    "x-app-version": "0.0.75",
    "x-platform": "web",
}
TIMEOUT_S = 15
MAX_429_RETRIES = 3

READ_ONLY_PATHS = {
    "/v1_0/portfolios/get_portfolio_by_id",
    "/v1_0/portfolios/get_users_followed_portfolios",
    "/v1_0/investments/get_investments",
}
# Action words that must never appear in a path we call. "/dex/" is where Invo records real trades.
FORBIDDEN_WORDS = ("/dex/", "create", "modify", "sell", "buy", "close", "mimic", "repost", "follow",
                   "delete", "update", "withdraw", "deposit", "transfer", "cancel", "ticker/", "sims")

REAUTH_HELP = (
    "Invo login failed. Re-capture your refresh token: log in at app.invoapp.com in a desktop "
    "browser, open DevTools (F12) > Network, filter 'api.invoapp.com', find the request to "
    "'auth/refresh_token' and copy the JWT after 'Bearer ' from its Authorization header into "
    "INVO_REFRESH_TOKEN in invo_analyst/.env (see README Step 2)."
)


class InvoError(RuntimeError):
    pass


class InvoAuthError(InvoError):
    pass


class InvoRateLimitError(InvoError):
    pass


class InvoFeedChangedError(InvoError):
    pass


def _strip_bearer(tok: str | None) -> str | None:
    if not tok:
        return None
    tok = tok.strip()
    return tok[7:].strip() if tok.lower().startswith("bearer ") else tok


def _jwt_claims(token: str | None) -> dict:
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:
        return {}


def jwt_expiry(token: str | None) -> float | None:
    c = _jwt_claims(token)
    exp = c.get("expires", c.get("exp"))
    try:
        return float(exp) if exp is not None else None
    except (TypeError, ValueError):
        return None


def _decode_body(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        pass
    try:  # some Invo responses are base64-encoded JSON (seen by invo-sentinel)
        return json.loads(base64.b64decode(text))
    except Exception:
        return text


def assert_read_only(path: str, extra_allowed: set[str] = frozenset()) -> None:
    p = "/" + path.lstrip("/")
    if p in READ_ONLY_PATHS:
        return
    if p in extra_allowed and not any(w in p.lower() for w in FORBIDDEN_WORDS):
        return
    raise PermissionError(f"Refusing to call {p}: this tool is read-only and that path is not on the read list.")


class TokenStore:
    """Keeps the newest tokens in a 0600 file so restarts don't fall back to a stale .env token."""

    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict:
        try:
            if self.path.exists():
                return json.loads(self.path.read_text())
        except (OSError, ValueError):
            log.warning("token file unreadable; ignoring it")
        return {}

    def save(self, refresh: str | None, access: str | None) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump({"refresh_token": refresh, "access_token": access, "updated_at": time.time()}, fh)
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
        os.replace(tmp, self.path)


class InvoClient:
    def __init__(self, token_file: Path, refresh_token: str | None = None, limiter: SlidingWindowLimiter | None = None,
                 session: requests.Session | None = None, extra_read_paths: set[str] | None = None, sleep=time.sleep):
        self.store = TokenStore(token_file)
        saved = self.store.load()
        env_tok = _strip_bearer(refresh_token or os.environ.get("INVO_REFRESH_TOKEN"))
        file_tok = _strip_bearer(saved.get("refresh_token"))
        # Prefer whichever refresh token expires later (Invo may rotate it on refresh).
        cands = [t for t in (env_tok, file_tok) if t]
        self.refresh_token = max(cands, key=lambda t: jwt_expiry(t) or 0) if cands else None
        self.access_token = _strip_bearer(saved.get("access_token"))
        # Budget: Invo allows ~250 requests / 5 min per IP. We use a small slice of that.
        self.limiter = limiter or SlidingWindowLimiter(int(os.environ.get("INVO_RATE_LIMIT", "60")), 300.0)
        self.http = session or requests.Session()
        self.extra_read_paths = extra_read_paths or set()
        self.calls_made = 0
        self._sleep = sleep

    # ---- auth ---------------------------------------------------------------
    def refresh_token_days_left(self) -> float | None:
        exp = jwt_expiry(self.refresh_token)
        return None if exp is None else (exp - time.time()) / 86400

    def user_id(self) -> str | None:
        return _jwt_claims(self.access_token or self.refresh_token).get("user_id")

    def refresh(self) -> None:
        if not self.refresh_token:
            raise InvoAuthError("INVO_REFRESH_TOKEN is not set. " + REAUTH_HELP)
        exp = jwt_expiry(self.refresh_token)
        if exp is not None and exp < time.time():
            raise InvoAuthError(f"Refresh token expired on {time.strftime('%Y-%m-%d', time.gmtime(exp))}. " + REAUTH_HELP)
        self.limiter.acquire()
        self.calls_made += 1
        try:
            resp = self.http.get(f"{BASE_URL}/v1_0/auth/refresh_token",
                                 headers={**APP_HEADERS, "Authorization": f"Bearer {self.refresh_token}"}, timeout=TIMEOUT_S)
        except requests.RequestException as e:
            raise InvoError(f"network error refreshing token: {type(e).__name__}") from e
        data = _decode_body(resp.text)
        if resp.status_code in (401, 403):
            raise InvoAuthError(f"Invo rejected the refresh token (HTTP {resp.status_code}). " + REAUTH_HELP)
        if resp.status_code != 200 or not isinstance(data, dict) or not data.get("accessToken"):
            raise InvoFeedChangedError(f"token refresh returned an unexpected response (HTTP {resp.status_code})")
        self.access_token = _strip_bearer(data["accessToken"])
        if data.get("refreshToken"):
            self.refresh_token = _strip_bearer(data["refreshToken"])
        self.store.save(self.refresh_token, self.access_token)
        log.info("Invo access token refreshed")

    def _access_valid(self) -> bool:
        if not self.access_token:
            return False
        exp = jwt_expiry(self.access_token)
        return exp is None or exp - time.time() > 30

    # ---- transport ----------------------------------------------------------
    def post(self, path: str, body: dict) -> dict:
        path = "/" + path.lstrip("/")
        assert_read_only(path, self.extra_read_paths)
        if not self._access_valid():
            self.refresh()
        retried_auth, attempt = False, 0
        while True:
            self.limiter.acquire()
            self.calls_made += 1
            try:
                resp = self.http.post(f"{BASE_URL}{path}", json=body, timeout=TIMEOUT_S,
                                      headers={**APP_HEADERS, "Authorization": f"Bearer {self.access_token}"})
            except requests.RequestException as e:
                raise InvoError(f"network error on {path}: {type(e).__name__}") from e
            if resp.status_code == 401 and not retried_auth:
                self.refresh()
                retried_auth = True
                continue
            if resp.status_code == 401:
                raise InvoAuthError(f"{path} still 401 after refreshing. " + REAUTH_HELP)
            if resp.status_code == 429:
                if attempt >= MAX_429_RETRIES:
                    raise InvoRateLimitError(f"{path} still rate-limited after {MAX_429_RETRIES} retries")
                try:
                    delay = float(resp.headers.get("retry-after", ""))
                except ValueError:
                    delay = 5.0 * 2 ** attempt
                log.warning("Invo rate limit on %s; backing off %.0fs", path, min(delay, 60))
                self._sleep(min(delay, 60))
                attempt += 1
                continue
            if resp.status_code == 404:
                raise InvoFeedChangedError(f"{path} returned 404 - Invo may have moved this endpoint")
            data = _decode_body(resp.text)
            if resp.status_code >= 400:
                raise InvoError(f"{path} HTTP {resp.status_code}")
            if not isinstance(data, dict):
                raise InvoFeedChangedError(f"{path} returned non-JSON")
            if data.get("success") is False or data.get("error"):
                raise InvoError(f"{path} returned an error: {str(data.get('error'))[:200]}")
            return data

    # ---- read endpoints -----------------------------------------------------
    def get_portfolio(self, portfolio_id: str) -> dict:
        data = self.post("/v1_0/portfolios/get_portfolio_by_id", {"portfolioId": portfolio_id})
        p = data.get("portfolio")
        if not isinstance(p, dict):
            raise InvoFeedChangedError("get_portfolio_by_id: no 'portfolio' object in response")
        return p

    def _investments(self, portfolio_id: str, is_open: bool, page: int, size: int) -> list[dict]:
        data = self.post("/v1_0/investments/get_investments",
                         {"portfolioId": portfolio_id, "isOpen": is_open, "params": {"page": page, "size": size}})
        if "investmentsTicker" not in data:
            raise InvoFeedChangedError("get_investments: 'investmentsTicker' missing from response")
        return list(data.get("investmentsTicker") or [])

    def get_open_investments(self, portfolio_id: str) -> list[dict]:
        return self._investments(portfolio_id, True, 1, 50)

    def get_recent_closed(self, portfolio_id: str, size: int = 20) -> list[dict]:
        return self._investments(portfolio_id, False, 1, size)

    def get_closed_history(self, portfolio_id: str, max_pages: int = 6) -> list[dict]:
        out, seen = [], set()
        for page in range(1, max_pages + 1):
            batch = self._investments(portfolio_id, False, page, 50)
            new = [b for b in batch if str(b.get("baseId")) not in seen]
            for b in new:
                seen.add(str(b.get("baseId")))
            out.extend(new)
            if len(batch) < 50 or not new:
                break
        return out

    def get_followed_portfolios(self) -> list[dict]:
        data = self.post("/v1_0/portfolios/get_users_followed_portfolios",
                         {"context": {"filter": "following"}, "userId": self.user_id(),
                          "params": {"sinceTimestamp": 0, "size": 100}})
        if "savedPortfolios" not in data:
            raise InvoFeedChangedError("get_users_followed_portfolios: 'savedPortfolios' missing")
        return [sp.get("portfolio") for sp in data.get("savedPortfolios") or [] if isinstance(sp, dict) and sp.get("portfolio")]
