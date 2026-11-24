"""`python3 invo.py debug <portfolio id or URL>`: show what Invo actually returns for one trader.

Read-only, 3 Invo requests (plus a token refresh if needed). Prints a short report that is safe to
paste into a chat: tokens are never printed, and fields that could be private (email, phone,
wallet/address, anything with key/token/secret/password) are replaced with [hidden].
A redacted copy of the raw responses is saved to data/debug_<id>.json for deeper digging.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .config import UUID_RE, parse_portfolio_id
from .invo_client import InvoClient, InvoError

PRIVATE = re.compile(r"email|phone|token|secret|password|apikey|api_key|privatekey|address|wallet|\bip\b", re.I)
STAT_KEYS = ("winRate", "wonPositions", "lostPositions", "closedPositions", "openPositions", "followerCount",
             "plSnapshot", "avgPlRealized", "avgHoldTimeSeconds", "liquidated")


def redact(obj, depth: int = 0):
    if depth > 8:
        return "..."
    if isinstance(obj, dict):
        return {k: "[hidden]" if PRIVATE.search(k) else redact(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v, depth + 1) for v in obj[:20]] + ([f"... {len(obj) - 20} more"] if len(obj) > 20 else [])
    if isinstance(obj, str) and len(obj) > 120:
        return obj[:120] + "..."
    return obj


def shape(obj, depth: int = 0) -> str:
    """One-line description of a value's structure: keys and list sizes, no contents."""
    if isinstance(obj, dict):
        if depth >= 1:
            return "{" + ", ".join(sorted(obj)[:25]) + (", ..." if len(obj) > 25 else "") + "}"
        return "{" + ", ".join(f"{k}: {shape(v, depth + 1)}" for k, v in sorted(obj.items())) + "}"
    if isinstance(obj, list):
        return f"list[{len(obj)}]" + (f" of {shape(obj[0], depth + 1)}" if obj and depth < 1 else "")
    return type(obj).__name__


def find_portfolio_lists(obj, path: str = "") -> list[tuple[str, list[dict]]]:
    """Any list of portfolio-looking dicts nested in the response (e.g. the trader's OTHER portfolios)."""
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            found += find_portfolio_lists(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list) and obj and all(isinstance(x, dict) for x in obj):
        if any("openPositions" in x or "title" in x or "closedPositions" in x for x in obj):
            found.append((path, obj))
    return found


def run(client: InvoClient, raw_input: str, out_dir: Path) -> int:
    ids_in_input = [m.group(0) for m in UUID_RE.finditer(raw_input or "")]
    pid = parse_portfolio_id(raw_input)
    print(f"Input: {raw_input}")
    print(f"IDs found in it: {len(ids_in_input)} -> using {pid}")
    if not pid:
        print("No portfolio ID found. Paste the trader's page address from the Invo website.")
        return 1
    if "/portfolio" not in raw_input and "-" in raw_input and "/" in raw_input:
        print("NOTE: this link does not contain '/portfolio/'. It may be a profile/user link, not a portfolio link.")

    raw: dict = {}
    try:
        raw["get_portfolio_by_id"] = client.post("/v1_0/portfolios/get_portfolio_by_id", {"portfolioId": pid})
        for label, is_open in (("open", True), ("closed", False)):
            raw[f"get_investments_{label}"] = client.post(
                "/v1_0/investments/get_investments",
                {"portfolioId": pid, "isOpen": is_open, "params": {"page": 1, "size": 50}})
    except InvoError as e:
        print(f"Invo request failed: {e}")
        if raw:
            print("(partial results below)")
        else:
            return 1

    print("\n--- 1) Portfolio ---")
    resp = raw.get("get_portfolio_by_id", {})
    print(f"Response shape: {shape(redact(resp))}")
    p = resp.get("portfolio") if isinstance(resp, dict) else None
    if not isinstance(p, dict):
        print("No 'portfolio' object in the response. Invo may have changed this endpoint.")
    else:
        owner = p.get("owner") or {}
        print(f"Returned portfolio id: {p.get('id')}  (matches requested: {str(p.get('id')).lower() == pid})")
        print(f"Title: {p.get('title')!r}  Owner: {owner.get('username') or owner.get('name')!r}  "
              f"ownerId: {p.get('ownerId') or owner.get('id')}")
        if str(p.get("ownerId") or owner.get("id") or "").lower() == pid:
            print("!! The ID you gave is the trader's USER id, not a portfolio id.")
        print("Stats: " + ", ".join(f"{k}={p.get(k)!r}" for k in STAT_KEYS if k in p))
        missing = [k for k in STAT_KEYS if k not in p]
        if missing:
            print(f"Stats fields NOT present: {', '.join(missing)}")
        nested = {k: shape(v) for k, v in p.items() if isinstance(v, (dict, list)) and k != "owner"}
        if nested:
            print(f"Nested data in portfolio: {nested}")
        for path, items in find_portfolio_lists(resp):
            print(f"Other portfolios listed at '{path}':")
            for it in items[:10]:
                print(f"   id {it.get('id')}  title {it.get('title')!r}  open {it.get('openPositions')}  "
                      f"closed {it.get('closedPositions')}")

    for label in ("open", "closed"):
        r = raw.get(f"get_investments_{label}")
        if r is None:
            continue
        print(f"\n--- {2 if label == 'open' else 3}) {label.capitalize()} trades ---")
        print(f"Response shape: {shape(redact(r))}")
        lst = r.get("investmentsTicker") if isinstance(r, dict) else None
        if lst is None:
            lists = {k: len(v) for k, v in r.items() if isinstance(v, list)} if isinstance(r, dict) else {}
            print(f"'investmentsTicker' is MISSING. Lists in the response instead: {lists or 'none'}")
        else:
            print(f"{len(lst)} {label} trade(s) returned")
            for t in lst[:5]:
                print(f"   {t.get('ticker')} {'LONG' if t.get('directionLong', True) else 'SHORT'} "
                      f"{t.get('leverage')}x entry {t.get('entryPrice')} portfolio {(t.get('portfolio') or {}).get('id')}")

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"debug_{pid[:8]}.json"
    out.write_text(json.dumps(redact(raw), indent=1, default=str))
    print(f"\nRedacted raw responses saved to {out}")
    print(f"Invo API calls used: {client.calls_made}")
    return 0
