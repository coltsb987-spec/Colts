#!/usr/bin/env python3
"""AI Business Influencer Factory - command-line helper.

Uses only the Python standard library. FFmpeg/FFprobe are used for the
video steps (assemble, burn captions, quality check) when installed.

Run `python3 factory.py --help` for the list of commands, or see README.md.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import random
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "config"

DIRS = {
    "planning": "00_planning",
    "research": "01_research",
    "ideas": "02_ideas",
    "scripts": "03_scripts",
    "approved": "04_approved_scripts",
    "prompts": "05_higgsfield_prompts",
    "raw": "06_raw_videos",
    "edited": "07_edited_videos",
    "captions": "08_captions_thumbnails",
    "published": "09_published",
    "analytics": "10_analytics",
}

CATEGORIES = {
    "ai_business_ideas": "AI business ideas",
    "make_money_with_ai": "Ways to make money with AI",
    "beginner_tutorials": "Beginner business tutorials",
    "business_mistakes": "Business mistakes",
    "case_studies": "Case studies",
    "ai_tools_demos": "AI tools and demonstrations",
    "entrepreneurship_productivity": "Entrepreneurship and productivity",
}

HOOK_TYPES = [
    "question", "bold_claim", "mistake_warning", "list_number", "story",
    "demo_result", "contrarian", "curiosity_gap", "before_after",
]

RESEARCH_COLUMNS = [
    "date_logged", "creator_username", "video_url", "posted_date", "category",
    "topic", "hook_paraphrase", "hook_type", "presentation_style", "structure",
    "length_sec", "cta", "views", "likes", "comments", "shares", "saves",
    "audience_questions", "recurring_theme", "inspiration_idea", "source",
]

TRACKER_COLUMNS = [
    "date_published", "platform", "script_id", "topic", "category", "hook",
    "hook_type", "video_length_sec", "views", "avg_watch_time_sec",
    "completion_rate_pct", "likes", "comments", "shares", "saves",
    "profile_visits", "followers_gained", "link_clicks", "conversions",
    "post_url", "notes",
]

# (pattern, level, message). "error" blocks approval; "warn" needs a human look.
RISKY_PATTERNS = [
    (r"\bguarantee[ds]?\b", "error", "No guarantees about income or results."),
    (r"\bget rich\b", "error", "'Get rich' framing is misleading."),
    (r"\brisk[- ]free\b", "error", "Nothing in business is risk-free."),
    (r"\b(easy|quick|fast|free) money\b", "warn", "'Easy/quick money' framing - reword honestly."),
    (r"\bpassive income\b", "warn", "'Passive income' is rarely passive - add context or remove."),
    (r"[£$€]\s?\d[\d,.]*k?\s*(/|a|per)\s*(day|week|month|year)\b", "warn",
     "Income figure - needs a source and must not imply typical results."),
    (r"\b(i|we) (made|earned|make|earn|generated)\b", "error",
     "Personal results claim - only allowed if true and evidenced (set personal_claims_confirmed)."),
    (r"\bmy (clients|customers|students)\b", "error",
     "Personal experience claim - only allowed if true (set personal_claims_confirmed)."),
    (r"\b(everyone|anyone) can\b", "warn", "Over-generalisation - results vary."),
    (r"\bovernight\b", "warn", "Unrealistic timescale."),
    (r"\bno (skills?|experience|money) (needed|required)\b", "warn", "Likely misleading - most businesses need some."),
    (r"\b100 ?%", "warn", "Absolute claim - check it's literally true."),
]

PERSONAL_PATTERN_MESSAGES = {RISKY_PATTERNS[6][2], RISKY_PATTERNS[7][2]}


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def d(key: str) -> Path:
    return ROOT / DIRS[key]


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def settings() -> dict:
    return load_json(CONFIG / "settings.json")


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [
            {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(f)
        ]


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def append_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    exists = path.exists() and path.stat().st_size > 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        if not exists:
            w.writeheader()
        w.writerows(rows)


def num(value) -> float | None:
    """Parse '12,300', '12.3k', '1.2m', '45%' -> float; blank -> None."""
    if value is None:
        return None
    s = str(value).strip().lower().replace(",", "").replace("%", "")
    if not s:
        return None
    mult = 1
    if s.endswith("k"):
        mult, s = 1_000, s[:-1]
    elif s.endswith("m"):
        mult, s = 1_000_000, s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


def slugify(text: str, max_len: int = 48) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:max_len].rstrip("-") or "untitled"


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9£$€%][A-Za-z0-9£$€%'’.,-]*", text or "")


def today() -> dt.date:
    return dt.date.today()


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def have(tool: str) -> bool:
    return shutil.which(tool) is not None


def load_env() -> None:
    """Load KEY=VALUE pairs from .env into os.environ without printing them."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# --------------------------------------------------------------------------
# Module 1: research
# --------------------------------------------------------------------------

def research_rows() -> list[dict]:
    return read_csv(d("research") / "research_log.csv")


def validate_research(rows: list[dict], creators: list[dict]) -> list[str]:
    problems = []
    known = {c["instagram_username"].lstrip("@").lower() for c in creators if c.get("instagram_username")}
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        cat = r.get("category", "")
        if cat and cat not in CATEGORIES:
            problems.append(f"row {i}: unknown category '{cat}' (see config/research_fields.md)")
        ht = r.get("hook_type", "")
        if ht and ht not in HOOK_TYPES:
            problems.append(f"row {i}: unknown hook_type '{ht}'")
        user = r.get("creator_username", "").lstrip("@").lower()
        if not user:
            problems.append(f"row {i}: creator_username is empty")
        elif known and user not in known:
            problems.append(f"row {i}: '{user}' is not listed in config/creators.csv")
        for col in ("length_sec", "views", "likes", "comments", "shares", "saves"):
            if r.get(col) and num(r[col]) is None:
                problems.append(f"row {i}: {col} '{r[col]}' is not a number")
    return problems


def engagement_rate(r: dict) -> float | None:
    views = num(r.get("views"))
    if not views:
        return None
    total = sum(num(r.get(k)) or 0 for k in ("likes", "comments", "shares", "saves"))
    return total / views


def confidence_label(n: int) -> str:
    if n < 3:
        return "anecdote (too little data)"
    if n < 10:
        return "early signal - treat as a hypothesis"
    return "pattern - still a hypothesis until your own tests confirm it"


def analyze_research(rows: list[dict]) -> dict:
    by_creator = defaultdict(list)
    for r in rows:
        by_creator[r.get("creator_username", "").lstrip("@")].append(r)

    def summarise(group: list[dict]) -> dict:
        lengths = [num(r.get("length_sec")) for r in group if num(r.get("length_sec"))]
        ers = [e for e in (engagement_rate(r) for r in group) if e is not None]
        questions = Counter()
        for r in group:
            for q in r.get("audience_questions", "").split(";"):
                if q.strip():
                    questions[q.strip()] += 1
        return {
            "videos_logged": len(group),
            "categories": Counter(r["category"] for r in group if r.get("category")).most_common(),
            "hook_types": Counter(r["hook_type"] for r in group if r.get("hook_type")).most_common(),
            "styles": Counter(r["presentation_style"] for r in group if r.get("presentation_style")).most_common(5),
            "structures": Counter(r["structure"] for r in group if r.get("structure")).most_common(5),
            "ctas": Counter(r["cta"] for r in group if r.get("cta")).most_common(5),
            "themes": Counter(r["recurring_theme"] for r in group if r.get("recurring_theme")).most_common(5),
            "median_length_sec": statistics.median(lengths) if lengths else None,
            "median_engagement_rate": statistics.median(ers) if ers else None,
            "engagement_sample": len(ers),
            "top_questions": questions.most_common(10),
            "inspiration": [r["inspiration_idea"] for r in group if r.get("inspiration_idea")],
        }

    # Category performance where public view counts exist
    cat_perf = {}
    for cat in CATEGORIES:
        ers = [engagement_rate(r) for r in rows if r.get("category") == cat]
        ers = [e for e in ers if e is not None]
        cat_perf[cat] = {
            "videos": sum(1 for r in rows if r.get("category") == cat),
            "with_views": len(ers),
            "median_engagement_rate": statistics.median(ers) if ers else None,
        }
    evidence = defaultdict(list)
    for r in rows:
        if r.get("category") and r.get("video_url"):
            evidence[r["category"]].append(r["video_url"])

    return {
        "generated": today().isoformat(),
        "total_videos": len(rows),
        "overall": summarise(rows) if rows else {},
        "creators": {k: summarise(v) for k, v in by_creator.items() if k},
        "category_performance": cat_perf,
        "evidence_links": dict(evidence),
    }


def research_report_md(insights: dict) -> str:
    out = [f"# Research summary - {insights['generated']}", ""]
    n = insights["total_videos"]
    out += [f"Videos logged: **{n}** - overall confidence: *{confidence_label(n)}*", "",
            "> Counts describe what you logged, not what performs best. Engagement uses only "
            "publicly visible numbers. Treat every conclusion here as a hypothesis to test with your own videos.", ""]
    if not n:
        out.append("No research rows yet. Fill in `01_research/research_log.csv` (see `config/research_fields.md`).")
        return "\n".join(out) + "\n"
    ov = insights["overall"]
    out += ["## Across all creators", "", "| Category | Videos logged | With public views | Median engagement rate |",
            "|---|---|---|---|"]
    for cat, p in insights["category_performance"].items():
        er = f"{p['median_engagement_rate']:.1%}" if p["median_engagement_rate"] is not None else "n/a"
        out.append(f"| {CATEGORIES[cat]} | {p['videos']} | {p['with_views']} | {er} |")
    out += ["", "**Hook types used:** " + (", ".join(f"{k} ({v})" for k, v in ov["hook_types"]) or "n/a"),
            f"**Median length:** {ov['median_length_sec'] or 'n/a'} sec",
            "**Common CTAs:** " + ("; ".join(f"{k} ({v})" for k, v in ov["ctas"]) or "n/a"),
            "**Common structures:** " + ("; ".join(f"{k} ({v})" for k, v in ov["structures"]) or "n/a"), "",
            "### Questions the audience keeps asking", ""]
    out += [f"- {q} ({c})" for q, c in ov["top_questions"]] or ["- none logged"]
    out += ["", "## Per creator", ""]
    for name, s in sorted(insights["creators"].items()):
        er = f"{s['median_engagement_rate']:.1%}" if s["median_engagement_rate"] is not None else "n/a"
        out += [f"### @{name}", "",
                f"- Videos logged: {s['videos_logged']} ({confidence_label(s['videos_logged'])})",
                "- Main categories: " + (", ".join(f"{CATEGORIES.get(k, k)} ({v})" for k, v in s["categories"]) or "n/a"),
                "- Hook types: " + (", ".join(f"{k} ({v})" for k, v in s["hook_types"]) or "n/a"),
                "- Presentation: " + ("; ".join(k for k, _ in s["styles"]) or "n/a"),
                f"- Typical length: {s['median_length_sec'] or 'n/a'} sec",
                "- CTAs: " + ("; ".join(k for k, _ in s["ctas"]) or "n/a"),
                "- Recurring themes: " + ("; ".join(k for k, _ in s["themes"]) or "n/a"),
                f"- Median public engagement rate: {er} (from {s['engagement_sample']} videos with views)",
                "- Ideas this inspired (make them your own): " + ("; ".join(s["inspiration"]) or "n/a"), ""]
    return "\n".join(out) + "\n"


def cmd_research(args) -> int:
    creators = read_csv(CONFIG / "creators.csv")
    filled = [c for c in creators if c.get("instagram_username")]
    rows = research_rows()
    print(f"Creators configured: {len(filled)}/10   Research rows: {len(rows)}")
    problems = validate_research(rows, creators)
    for p in problems:
        print("  ! " + p)
    if problems and not args.ignore_errors:
        print("Fix the rows above (or re-run with --ignore-errors).")
        return 1
    insights = analyze_research(rows)
    save_json(d("research") / "insights.json", insights)
    report = d("research") / "reports" / f"research_summary_{today().isoformat()}.md"
    report.write_text(research_report_md(insights), encoding="utf-8")
    print(f"Wrote {rel(report)} and {rel(d('research') / 'insights.json')}")
    return 0


def cmd_research_import(args) -> int:
    """Append rows from another CSV (e.g. a Google Sheet export) into the research log."""
    src = Path(args.file)
    incoming = read_csv(src)
    if not incoming:
        print(f"No rows found in {src}")
        return 1
    missing = [c for c in ("creator_username", "category") if c not in incoming[0]]
    if missing:
        print(f"Import file is missing columns: {', '.join(missing)}. Use 01_research/research_log.csv as the template.")
        return 1
    existing = {r.get("video_url") for r in research_rows() if r.get("video_url")}
    new = []
    for r in incoming:
        if r.get("video_url") and r["video_url"] in existing:
            continue
        r.setdefault("source", "manual")
        r["date_logged"] = r.get("date_logged") or today().isoformat()
        new.append(r)
    problems = validate_research(new, read_csv(CONFIG / "creators.csv"))
    for p in problems:
        print("  ! " + p)
    append_csv(d("research") / "research_log.csv", new, RESEARCH_COLUMNS)
    print(f"Imported {len(new)} new rows ({len(incoming) - len(new)} duplicates skipped).")
    return 0


def graph_business_discovery(username: str, ig_user_id: str, token: str, version: str, limit: int) -> dict:
    fields = (f"business_discovery.username({username}){{username,name,followers_count,media_count,"
              f"media.limit({limit}){{caption,like_count,comments_count,media_type,media_product_type,"
              f"permalink,timestamp}}}}")
    url = f"https://graph.facebook.com/{version}/{ig_user_id}?" + urllib.parse.urlencode(
        {"fields": fields, "access_token": token})
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace").replace(token, "***")
        raise RuntimeError(f"Graph API error {e.code}: {body[:300]}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error: {e.reason}") from None


def discovery_to_rows(payload: dict) -> list[dict]:
    bd = payload.get("business_discovery", {})
    rows = []
    for m in bd.get("media", {}).get("data", []):
        if m.get("media_product_type") != "REELS" and m.get("media_type") != "VIDEO":
            continue
        rows.append({
            "date_logged": today().isoformat(),
            "creator_username": bd.get("username", ""),
            "video_url": m.get("permalink", ""),
            "posted_date": (m.get("timestamp") or "")[:10],
            "likes": m.get("like_count", ""),
            "comments": m.get("comments_count", ""),
            "source": "instagram_graph_api",
        })
    return rows


def cmd_research_fetch(args) -> int:
    load_env()
    ig_user_id, token = os.environ.get("IG_USER_ID"), os.environ.get("IG_ACCESS_TOKEN")
    if not ig_user_id or not token:
        print("Optional feature not configured: set IG_USER_ID and IG_ACCESS_TOKEN in a .env file "
              "(see docs/platform_apis.md). Until then, use the manual research log.")
        return 1
    cfg = settings()["research"]
    creators = [c for c in read_csv(CONFIG / "creators.csv") if c.get("instagram_username")]
    known = {r.get("video_url") for r in research_rows()}
    added = 0
    for c in creators:
        user = c["instagram_username"].lstrip("@")
        try:
            payload = graph_business_discovery(user, ig_user_id, token, cfg["graph_api_version"], cfg["media_per_creator"])
        except RuntimeError as e:
            print(f"  @{user}: skipped - {e}")
            continue
        save_json(d("research") / "api_snapshots" / f"{user}_{today().isoformat()}.json", payload)
        rows = [r for r in discovery_to_rows(payload) if r["video_url"] not in known]
        append_csv(d("research") / "research_log.csv", rows, RESEARCH_COLUMNS)
        added += len(rows)
        print(f"  @{user}: {len(rows)} new video rows (categorise them by hand)")
        time.sleep(1)  # be gentle with rate limits
    print(f"Added {added} rows. Views are not available through this API for other accounts - leave blank.")
    return 0


# --------------------------------------------------------------------------
# Module 2: content intelligence - daily ideas
# --------------------------------------------------------------------------

def recent_idea_ids(before: dt.date, days: int = 6) -> set[str]:
    ids = set()
    for p in d("ideas").glob("ideas_*.json"):
        try:
            when = dt.date.fromisoformat(p.stem.split("_", 1)[1])
        except ValueError:
            continue
        if 0 < (before - when).days <= days:
            ids.update(i["seed_id"] for i in load_json(p).get("ideas", []))
    for p in list(d("scripts").glob("*.json")) + list(d("approved").glob("*.json")):
        try:
            sid = load_json(p).get("seed_id")
        except (json.JSONDecodeError, OSError):
            continue
        if sid:
            ids.add(sid)
    return ids


def generate_ideas(date: dt.date, count: int = 10, insights: dict | None = None) -> list[dict]:
    bank = load_json(CONFIG / "topic_bank.json")["ideas"]
    insights = insights or {}
    cat_counts = {k: v["videos"] for k, v in insights.get("category_performance", {}).items()}
    cat_er = {k: v["median_engagement_rate"] for k, v in insights.get("category_performance", {}).items()
              if v.get("median_engagement_rate") is not None}
    evidence = insights.get("evidence_links", {})
    top_count = max(cat_counts.values(), default=0) or 1
    top_er = max(cat_er.values(), default=0) or 1
    recent = recent_idea_ids(date)
    rng = random.Random(date.isoformat())

    scored = []
    for seed in bank:
        score = rng.random()
        score += 0.4 * cat_counts.get(seed["category"], 0) / top_count
        score += 0.4 * (cat_er.get(seed["category"], 0) / top_er)
        if seed["id"] in recent:
            score -= 1.5
        scored.append((score, seed))
    scored.sort(key=lambda t: t[0], reverse=True)

    picked, per_cat = [], Counter()
    for limit in (1, 2, 99):  # spread across categories first
        for _, seed in scored:
            if len(picked) == count:
                break
            if seed in picked or per_cat[seed["category"]] >= limit:
                continue
            picked.append(seed)
            per_cat[seed["category"]] += 1

    ideas = []
    for n, seed in enumerate(picked, start=1):
        links = evidence.get(seed["category"], [])[:3]
        logged = cat_counts.get(seed["category"], 0)
        if logged:
            status = (f"Hypothesis supported by {logged} logged competitor video(s) in this category "
                      f"({confidence_label(logged)}).")
        else:
            status = "Hypothesis - no research data logged for this category yet."
        ideas.append({
            "number": n,
            "seed_id": seed["id"],
            "category": seed["category"],
            "topic": seed["topic"],
            "target_audience": seed["audience"],
            "audience_problem": seed["problem"],
            "suggested_hook": rng.choice(seed["hooks"]),
            "why_it_may_attract_attention": seed["why"],
            "evidence_status": status,
            "evidence_links": links + seed.get("sources", []),
            "suggested_cta": seed["cta"],
            "verification_note": seed.get("verify", ""),
        })
    return ideas


def ideas_md(date: dt.date, ideas: list[dict]) -> str:
    out = [f"# 10 content opportunities - {date.isoformat()}", "",
           "Pick 1-3, then ask Claude Code: *\"Write a script for idea N from today's ideas file\"* "
           "or run `python3 factory.py new-script --idea N`.", ""]
    for i in ideas:
        out += [f"## {i['number']}. {i['topic']}",
                f"- **Category:** {CATEGORIES[i['category']]}",
                f"- **Target audience:** {i['target_audience']}",
                f"- **Audience problem:** {i['audience_problem']}",
                f"- **Suggested opening hook:** \"{i['suggested_hook']}\"",
                f"- **Why it may attract attention:** {i['why_it_may_attract_attention']}",
                f"- **Evidence:** {i['evidence_status']}"]
        out += [f"  - {link}" for link in i["evidence_links"]]
        out += [f"- **Suggested CTA:** {i['suggested_cta']}",
                f"- **Check before filming:** {i['verification_note'] or 'n/a'}", ""]
    return "\n".join(out)


def cmd_ideas(args) -> int:
    date = dt.date.fromisoformat(args.date) if args.date else today()
    ins_path = d("research") / "insights.json"
    insights = load_json(ins_path) if ins_path.exists() else {}
    ideas = generate_ideas(date, args.count, insights)
    save_json(d("ideas") / f"ideas_{date.isoformat()}.json", {"date": date.isoformat(), "ideas": ideas})
    md = d("ideas") / f"ideas_{date.isoformat()}.md"
    md.write_text(ideas_md(date, ideas), encoding="utf-8")
    print(f"Wrote {rel(md)}")
    for i in ideas:
        print(f"  {i['number']:>2}. [{i['category']}] {i['topic']}")
    return 0


# --------------------------------------------------------------------------
# Module 3: scripts - skeleton, checks, rendering
# --------------------------------------------------------------------------

def find_script(ref: str) -> Path:
    p = Path(ref)
    if p.exists():
        return p.resolve()
    for folder in ("approved", "scripts"):
        cand = d(folder) / f"{ref}.json"
        if cand.exists():
            return cand
    raise SystemExit(f"Script not found: {ref}")


def script_text(s: dict) -> str:
    return " ".join(b.get("voiceover", "") for b in s.get("beats", []))


def estimate_seconds(s: dict, wps: float) -> float:
    return len(words(script_text(s))) / wps


def check_script(s: dict, cfg: dict | None = None) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Errors block approval."""
    cfg = cfg or settings()
    sc = cfg["script"]
    errors, warns = [], []

    for key in ("id", "title", "topic", "category", "target_audience", "audience_problem", "beats",
                "instagram", "youtube", "hashtags", "claims", "disclosure"):
        if key not in s or s[key] in ("", None):
            errors.append(f"missing field '{key}'")
    if errors:
        return errors, warns
    if s["category"] not in CATEGORIES:
        errors.append(f"unknown category '{s['category']}'")

    beats = s["beats"]
    sections = [b.get("section") for b in beats]
    if not beats or sections[0] != "hook":
        errors.append("first beat must be the hook")
    else:
        hook_words = len(words(beats[0].get("voiceover", "")))
        if hook_words > sc["max_hook_words"]:
            errors.append(f"hook is {hook_words} words - keep it under {sc['max_hook_words']} (1-3 seconds)")
    if "problem" not in sections:
        errors.append("add a 'problem' beat (the problem or curiosity gap)")
    points = sections.count("point")
    if not sc["min_points"] <= points <= sc["max_points"]:
        errors.append(f"{points} point beats - need {sc['min_points']}-{sc['max_points']}")
    if "example" not in sections:
        warns.append("no 'example' beat - add a practical example where possible")
    if not sections or sections[-1] != "cta":
        errors.append("last beat must be the call to action ('cta')")
    for n, b in enumerate(beats, start=1):
        for f in ("voiceover", "on_screen_text", "visual"):
            if not b.get(f):
                errors.append(f"beat {n} ({b.get('section')}) is missing '{f}'")

    secs = estimate_seconds(s, sc["words_per_second"])
    if not sc["min_seconds"] <= secs <= sc["max_seconds"]:
        errors.append(f"estimated length {secs:.0f}s - must be {sc['min_seconds']}-{sc['max_seconds']}s")

    tags = s["hashtags"]
    if not sc["min_hashtags"] <= len(tags) <= sc["max_hashtags"]:
        errors.append(f"{len(tags)} hashtags - use {sc['min_hashtags']}-{sc['max_hashtags']} (no keyword stuffing)")
    if len({t.lower() for t in tags}) != len(tags):
        errors.append("duplicate hashtags")
    for t in tags:
        if not re.fullmatch(r"#[A-Za-z0-9_]+", t):
            errors.append(f"bad hashtag '{t}'")

    ig, yt = s["instagram"], s["youtube"]
    for block, name, fields in ((ig, "instagram", ("caption", "cover_text", "cta")),
                                (yt, "youtube", ("title", "description", "cta"))):
        for f in fields:
            if not block.get(f):
                errors.append(f"{name}.{f} is empty")
    if len(ig.get("caption", "")) > 2200:
        errors.append("Instagram caption is over 2,200 characters")
    if len(yt.get("title", "")) > 100:
        errors.append("YouTube title is over 100 characters")
    if len(ig.get("cover_text", "").split()) > 7:
        warns.append("cover text is long - aim for 7 words or fewer")

    disc = s["disclosure"]
    if disc.get("affiliate") or disc.get("sponsored"):
        if not ig.get("caption", "").lower().lstrip().startswith(("#ad", "ad ", "ad:", "ad |")):
            errors.append("affiliate/sponsored: Instagram caption must START with 'Ad' or '#ad' (ASA/CAP guidance)")
        if "#ad" not in yt.get("description", "").lower()[:120] and not yt.get("description", "").lower().startswith("ad"):
            errors.append("affiliate/sponsored: put 'Ad' / '#ad' at the start of the YouTube description and tick "
                          "'paid promotion' when uploading")

    all_text = " ".join([script_text(s), s.get("title", ""), ig.get("caption", ""), yt.get("title", ""),
                         yt.get("description", ""), " ".join(b.get("on_screen_text", "") for b in beats)])
    for pattern, level, message in RISKY_PATTERNS:
        for m in re.finditer(pattern, all_text, flags=re.IGNORECASE):
            note = f"'{m.group(0)}': {message}"
            before = all_text[max(0, m.start() - 25):m.start()].lower()
            if re.search(r"\b(not|no|never|won't|can't|doesn't|don't|isn't|without)\b", before):
                warns.append(note + " (negated - check the wording reads honestly)")
            elif message in PERSONAL_PATTERN_MESSAGES and s.get("personal_claims_confirmed"):
                warns.append(note + " (confirmed true by you)")
            elif level == "error":
                errors.append(note)
            else:
                warns.append(note)
            break

    for c in s["claims"]:
        status = c.get("status")
        if status not in ("verified", "opinion", "needs_verification"):
            errors.append(f"claim '{c.get('claim', '')[:40]}' has invalid status '{status}'")
        elif status == "verified" and not c.get("source"):
            errors.append(f"claim '{c.get('claim', '')[:40]}' is marked verified but has no source")
        elif status == "needs_verification":
            errors.append(f"claim needs verification before approval: '{c.get('claim', '')[:60]}'")
    return errors, warns


def render_script_md(s: dict, wps: float) -> str:
    secs = estimate_seconds(s, wps)
    out = [f"# {s['title']}", "",
           f"`{s['id']}` - status: **{s.get('status', 'draft')}** - est. **{secs:.0f}s** - "
           f"category: {CATEGORIES.get(s['category'], s['category'])}", "",
           f"**Audience:** {s['target_audience']}  ", f"**Problem:** {s['audience_problem']}", "",
           "| # | Section | Voiceover (say this) | On-screen text | Visual |", "|---|---|---|---|---|"]
    for n, b in enumerate(s["beats"], start=1):
        out.append(f"| {n} | {b['section']} | {b['voiceover']} | {b['on_screen_text']} | {b['visual']} |")
    out += ["", "## Teleprompter (read this aloud)", ""]
    out += [b["voiceover"] for b in s["beats"]]
    out += ["", "## Claims and sources", ""]
    for c in s["claims"]:
        src = f" - {c['source']}" if c.get("source") else ""
        out.append(f"- [{c['status']}] {c['claim']}{src}")
    if not s["claims"]:
        out.append("- No factual claims.")
    out += ["", "## Instagram", f"- Cover text: {s['instagram']['cover_text']}", f"- CTA: {s['instagram']['cta']}",
            "", s["instagram"]["caption"], "", " ".join(s["hashtags"]), "",
            "## YouTube Shorts", f"- Title: {s['youtube']['title']}", f"- CTA: {s['youtube']['cta']}", "",
            s["youtube"]["description"], ""]
    return "\n".join(out)


def print_check(path: Path, s: dict) -> bool:
    errors, warns = check_script(s)
    secs = estimate_seconds(s, settings()["script"]["words_per_second"]) if s.get("beats") else 0
    print(f"{rel(path)}  (~{secs:.0f}s)")
    for e in errors:
        print(f"  ERROR  {e}")
    for w in warns:
        print(f"  check  {w}")
    print("  READY TO APPROVE" if not errors else f"  {len(errors)} error(s) - fix before approval")
    return not errors


def cmd_check(args) -> int:
    paths = [find_script(a) for a in args.scripts] if args.scripts else sorted(d("scripts").glob("*.json"))
    ok = True
    for p in paths:
        ok = print_check(p, load_json(p)) and ok
    return 0 if ok else 1


def cmd_new_script(args) -> int:
    date = dt.date.fromisoformat(args.date) if args.date else today()
    ideas_file = d("ideas") / f"ideas_{date.isoformat()}.json"
    if not ideas_file.exists():
        print(f"No ideas file for {date}. Run: python3 factory.py ideas")
        return 1
    idea = next((i for i in load_json(ideas_file)["ideas"] if i["number"] == args.idea), None)
    if not idea:
        print(f"Idea {args.idea} not found in {rel(ideas_file)}")
        return 1
    sid = f"{date.isoformat()}_{slugify(idea['topic'], 40)}"
    template = load_json(ROOT / "templates" / "script_template.json")
    template.update({
        "id": sid, "seed_id": idea["seed_id"], "title": idea["topic"], "topic": idea["topic"],
        "category": idea["category"], "target_audience": idea["target_audience"],
        "audience_problem": idea["audience_problem"], "created": date.isoformat(),
        "research_evidence": idea["evidence_links"], "verification_note": idea["verification_note"],
    })
    template["beats"][0]["voiceover"] = idea["suggested_hook"]
    template["beats"][-1]["voiceover"] = idea["suggested_cta"] + "."
    template["instagram"]["cta"] = template["youtube"]["cta"] = idea["suggested_cta"]
    out = d("scripts") / f"{sid}.json"
    if out.exists() and not args.force:
        print(f"{rel(out)} already exists (use --force to overwrite)")
        return 1
    save_json(out, template)
    print(f"Created skeleton {rel(out)}\nFill in the beats (or ask Claude Code to), then run: "
          f"python3 factory.py check {sid}")
    return 0


# --------------------------------------------------------------------------
# Captions (SRT)
# --------------------------------------------------------------------------

def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{sec:02},{ms:03}"


def caption_cues(s: dict, wps: float, max_words: int, total_seconds: float | None = None,
                 uppercase: bool = False) -> list[tuple[float, float, str]]:
    chunks = []
    for b in s["beats"]:
        cur = []
        for w in b["voiceover"].split():
            cur.append(w)
            if len(cur) >= max_words or re.search(r"[.?!:]['’\"]?$", w):
                chunks.append(" ".join(cur))
                cur = []
        if cur:
            chunks.append(" ".join(cur))
    lengths = [max(1, len(words(c))) / wps for c in chunks]
    est = sum(lengths) or 1
    scale = (total_seconds / est) if total_seconds else 1.0
    cues, t = [], 0.0
    for c, ln in zip(chunks, lengths):
        start, end = t, t + ln * scale
        cues.append((start, end, c.upper() if uppercase else c))
        t = end
    return cues


def write_srt(path: Path, cues) -> None:
    lines = []
    for n, (a, b, text) in enumerate(cues, start=1):
        lines += [str(n), f"{srt_time(a)} --> {srt_time(b)}", text, ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------
# Modules 4 & 6: production package (Higgsfield prompts + platform posts)
# --------------------------------------------------------------------------

def segments(s: dict, wps: float, max_secs: float) -> list[dict]:
    """Group beats into clips short enough for one lip-sync generation each."""
    beats = s["beats"]
    lengths = [len(words(b["voiceover"])) / wps for b in beats]
    # Scripts have few beats, so try every split: fewest clips first, then the most even lengths.
    best_key, best_cuts = None, []
    for mask in range(2 ** max(0, len(beats) - 1)):
        cuts = [i + 1 for i in range(len(beats) - 1) if mask >> i & 1]
        bounds = [0] + cuts + [len(beats)]
        groups = [sum(lengths[a:z]) for a, z in zip(bounds, bounds[1:])]
        if any(g > max_secs and z - a > 1 for g, a, z in zip(groups, bounds, bounds[1:])):
            continue
        key = (len(groups), max(groups) - min(groups))
        if best_key is None or key < best_key:
            best_key, best_cuts = key, cuts
    bounds = [0] + best_cuts + [len(beats)]
    segs = [beats[a:z] for a, z in zip(bounds, bounds[1:])]
    out = []
    for n, group in enumerate(segs, start=1):
        text = " ".join(b["voiceover"] for b in group)
        secs = len(words(text)) / wps
        out.append({"n": n, "beats": group, "text": text, "seconds": secs,
                    "sections": [b["section"] for b in group]})
    return out


ENERGY = {
    "hook": "high energy, leans slightly toward the camera, raised eyebrows, confident direct eye contact",
    "problem": "empathetic, slight head tilt, measured pace",
    "point": "clear and confident, small explanatory hand gestures at chest height",
    "example": "animated, counts on fingers or gestures as if showing something",
    "cta": "warm, friendly smile, small nod, relaxed shoulders",
}


def higgsfield_md(s: dict, cfg: dict) -> str:
    hf, wps = cfg["higgsfield"], cfg["script"]["words_per_second"]
    look = hf["look"]
    segs = segments(s, wps, hf["max_segment_seconds"])
    subject = "The person in the start image"
    raw_dir = f"{DIRS['raw']}/{s['id']}"
    out = [f"# Higgsfield production prompts - {s['title']}", "",
           f"Script: `{s['id']}` - {len(segs)} clip(s) - total ~{sum(g['seconds'] for g in segs):.0f}s - "
           f"aspect ratio {hf['aspect_ratio']} - {hf['resolution']}", "",
           "Read `docs/digital_twin_workflow.md` once before your first video. Credits are charged by "
           "Higgsfield for every generation: check the price shown before you press Generate.", "",
           "## Step 1 - Record your voice (free, about 5 minutes)", "",
           "Record each clip below as a **separate** voice memo on your phone. Quiet room, phone 20 cm "
           "from your mouth, speak a little faster and more energetically than normal. Leave half a second "
           "of silence at the start and end. Name the files exactly as shown.", ""]
    for g in segs:
        out += [f"**Clip {g['n']:02} -> `voice_{g['n']:02}.m4a`** (~{g['seconds']:.0f}s, {', '.join(g['sections'])})", "",
                f"> {g['text']}", ""]
    out += ["## Step 2 - Generate each talking-head clip in Higgsfield", "",
            f"**Recommended route (your real voice):** model **{hf['lipsync_model_name']}**. Upload your start "
            f"photo as the *start image* and the clip's voice file as the *audio reference*. Aspect ratio "
            f"{hf['aspect_ratio']}, resolution {hf['resolution']}, duration = clip length rounded up.", "",
            f"**Alternative if Wan 2.7 looks stiff:** {hf['alt_lipsync_model_name']} - add the same photo as an "
            "*image reference* and the voice file as an *audio reference*, and use the same prompt.", ""]
    for g in segs:
        mood = "; ".join(dict.fromkeys(ENERGY[sec] for sec in g["sections"]))
        visual = " / ".join(b["visual"] for b in g["beats"])
        prompt = (f"{subject} speaking directly to camera, {look['camera']}. Setting: {look['setting']}. "
                  f"Wardrobe: {look['wardrobe']}. Lighting: {look['lighting']}. Performance: {mood}. "
                  "Accurate lip-sync to the provided audio, natural blinking, subtle realistic head and shoulder "
                  "movement, steady framing, no camera cuts. No on-screen text, no captions, no logos, no "
                  "watermarks, no extra people, hands natural with five fingers.")
        out += [f"### Clip {g['n']:02} ({max(4, math.ceil(g['seconds']))}s)", "",
                "```text", prompt, "```", "",
                f"- Audio reference: `voice_{g['n']:02}.m4a`",
                f"- Save the result as: `{raw_dir}/seg{g['n']:02}.mp4`",
                f"- B-roll / edit ideas for this clip (added in editing, not generated): {visual}", ""]
    out += ["## Step 3 - Quality check each clip before moving on", "",
            "- Lips match the words (watch with sound at full screen)",
            "- Face looks like you; no warping around teeth, eyes or hands",
            "- Voice is clear with no echo or clipping",
            "- If a clip fails: regenerate once with the same settings; if it fails again, "
            "re-record the audio slower or use a clearer start photo.", "",
            "## Step 4 - Assemble, caption and check (free, on your computer)", "",
            "```bash", f"python3 factory.py assemble {s['id']}", "```", "",
            f"This joins `{raw_dir}/seg01.mp4, seg02.mp4...`, burns in captions, and runs the quality check. "
            f"Output: `{DIRS['edited']}/{s['id']}_final.mp4`.", "",
            "## Ask Claude Code to do Step 2 for you (optional)", "",
            "If the Higgsfield connector is enabled in your Claude Code session, you can say:", "",
            f"> Generate the Higgsfield clips for `{s['id']}` using my start photo and the voice files I "
            f"upload. Quote the credit cost and wait for my approval before generating.", "",
            "Claude must show you the credit cost and get your OK before every paid generation.", ""]
    return "\n".join(out)


def instagram_post(s: dict) -> str:
    ig = s["instagram"]
    lines = [ig["caption"].strip(), "", " ".join(s["hashtags"])]
    return "\n".join([
        "INSTAGRAM REEL", "=" * 40,
        f"Cover text: {ig['cover_text']}",
        f"Call to action: {ig['cta']}",
        f"AI label: {'Turn ON the AI label (AI-generated likeness)' if s['disclosure'].get('ai_generated_likeness') else 'not required'}",
        f"Paid partnership / affiliate: {'YES - start caption with Ad, use the Paid partnership label' if s['disclosure'].get('affiliate') or s['disclosure'].get('sponsored') else 'no'}",
        "", "CAPTION (copy everything below this line)", "-" * 40, *lines, ""])


def youtube_post(s: dict) -> str:
    yt = s["youtube"]
    tags = s.get("hashtags_youtube") or s["hashtags"][:3]
    return "\n".join([
        "YOUTUBE SHORT", "=" * 40,
        f"Title: {yt['title']}",
        f"Call to action: {yt['cta']}",
        f"Altered or synthetic content: {'YES - answer Yes to the altered/synthetic content question' if s['disclosure'].get('ai_generated_likeness') else 'No'}",
        f"Paid promotion box: {'TICK IT' if s['disclosure'].get('affiliate') or s['disclosure'].get('sponsored') else 'leave unticked'}",
        f"Pinned comment idea: {yt.get('pinned_comment', yt['cta'])}",
        "", "DESCRIPTION (copy everything below this line)", "-" * 40,
        yt["description"].strip(), "", " ".join(tags), ""])


def thumbnail_brief(s: dict, cfg: dict) -> str:
    ig = s["instagram"]
    look = cfg["higgsfield"]["look"]
    return "\n".join([
        f"# Cover / thumbnail brief - {s['title']}", "",
        f"- **Cover text (max 5-7 words):** {ig['cover_text']}",
        f"- **Expression:** {s.get('thumbnail', {}).get('expression', 'curious, slightly raised eyebrow, mouth closed')}",
        f"- **Layout:** face on the right third, text on the left two-thirds in the middle of the frame "
        "(the top and bottom get covered by app buttons)",
        f"- **Background:** {look['setting']} - blur it, keep it uncluttered",
        f"- **Colours:** {s.get('thumbnail', {}).get('colours', 'white bold text with a black outline; one accent colour on the key word')}",
        "- **Instagram:** pick a cover frame or upload a 1080x1920 image; check the 3:4 grid crop in the preview",
        "- **YouTube Shorts:** choose the best frame in the upload screen (custom thumbnail options for Shorts vary by app version)", "",
        "## Quick option (free)", "",
        f"Pause on a frame from `{DIRS['edited']}/{s['id']}_final.mp4` where your face is expressive and add the cover "
        "text in Instagram's or Canva's free editor.", "",
        "## Higgsfield option (uses credits - check the price first)", "",
        "```text",
        f"Vertical 9:16 social media cover. {cfg['higgsfield'].get('reference_element_id') and '<<<' + cfg['higgsfield']['reference_element_id'] + '>>>' or '<<<YOUR_ELEMENT_ID>>>'} "
        f"on the right third, chest-up, {s.get('thumbnail', {}).get('expression', 'curious expression')}, looking at camera. "
        f"{look['setting']}. {look['lighting']}. Leave clean empty space on the left two-thirds for text. "
        "Photorealistic, no text, no logos.",
        "```", ""])


def build_package(s: dict, cfg: dict) -> list[Path]:
    wps = cfg["script"]["words_per_second"]
    cap = cfg["captions"]
    sid = s["id"]
    out_dir = d("captions") / sid
    made = []
    hf = d("prompts") / f"{sid}_higgsfield.md"
    hf.write_text(higgsfield_md(s, cfg), encoding="utf-8")
    made.append(hf)
    srt = out_dir / "captions.srt"
    write_srt(srt, caption_cues(s, wps, cap["max_words_per_cue"], uppercase=cap.get("uppercase", False)))
    made.append(srt)
    for name, text in (("instagram_post.txt", instagram_post(s)), ("youtube_post.txt", youtube_post(s)),
                       ("thumbnail_brief.md", thumbnail_brief(s, cfg)),
                       ("on_screen_text.txt", "\n".join(f"{n}. {b['on_screen_text']}" for n, b in
                                                        enumerate(s["beats"], start=1)) + "\n")):
        (out_dir / name).write_text(text, encoding="utf-8")
        made.append(out_dir / name)
    (d("raw") / sid).mkdir(parents=True, exist_ok=True)
    return made


def cmd_package(args) -> int:
    path = find_script(args.script)
    s, cfg = load_json(path), settings()
    if not print_check(path, s) and not args.force:
        print("Fix the errors first (or --force to build a preview package anyway).")
        return 1
    md = path.with_suffix(".md")
    md.write_text(render_script_md(s, cfg["script"]["words_per_second"]), encoding="utf-8")
    for p in [md] + build_package(s, cfg):
        print(f"  wrote {rel(p)}")
    return 0


def cmd_approve(args) -> int:
    path = find_script(args.script)
    s, cfg = load_json(path), settings()
    if not print_check(path, s):
        print("Not approved - fix the errors above.")
        return 1
    s["status"] = "approved"
    s["approved_by"] = args.by
    s["approved_date"] = today().isoformat()
    dest = d("approved") / f"{s['id']}.json"
    save_json(dest, s)
    (d("approved") / f"{s['id']}.md").write_text(render_script_md(s, cfg["script"]["words_per_second"]), encoding="utf-8")
    if path.parent == d("scripts"):
        path.unlink()
        stale_md = path.with_suffix(".md")
        if stale_md.exists():
            stale_md.unlink()
    for p in build_package(s, cfg):
        print(f"  wrote {rel(p)}")
    print(f"Approved -> {rel(dest)}. Next: open {DIRS['prompts']}/{s['id']}_higgsfield.md")
    return 0


# --------------------------------------------------------------------------
# Module 5: video - assemble, burn captions, quality check
# --------------------------------------------------------------------------

def ffprobe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format",
                          str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def media_duration(path: Path) -> float:
    return float(ffprobe(path)["format"]["duration"])


def run_ffmpeg(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit("FFmpeg failed:\n" + proc.stderr[-1500:])


def subtitle_style(cap: dict) -> str:
    return (f"Fontname={cap['font']},Fontsize={cap['font_size']},Bold={1 if cap.get('bold') else 0},"
            f"PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline={cap['outline']},"
            f"Shadow=0,Alignment=2,MarginV={cap['margin_v']}")


def burn_captions(video: Path, srt: Path, out: Path, cfg: dict) -> None:
    v = cfg["video"]
    srt_escaped = str(srt).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
    vf = (f"scale={v['width']}:{v['height']}:force_original_aspect_ratio=decrease,"
          f"pad={v['width']}:{v['height']}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={v['fps']},"
          f"subtitles='{srt_escaped}':force_style='{subtitle_style(cfg['captions'])}'")
    out.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vf", vf, "-c:v", "libx264",
                "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart", str(out)])


def concat_segments(seg_files: list[Path], out: Path, cfg: dict) -> None:
    v = cfg["video"]
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for f in seg_files:
        cmd += ["-i", str(f)]
    filters = []
    for i in range(len(seg_files)):
        filters.append(f"[{i}:v]scale={v['width']}:{v['height']}:force_original_aspect_ratio=decrease,"
                       f"pad={v['width']}:{v['height']}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={v['fps']}[v{i}]")
        filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}]")
    joined = "".join(f"[v{i}][a{i}]" for i in range(len(seg_files)))
    filters.append(f"{joined}concat=n={len(seg_files)}:v=1:a=1[v][a]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]", "-c:v", "libx264",
            "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", str(out)]
    run_ffmpeg(cmd)


def quality_check(video: Path, cfg: dict) -> tuple[list[str], list[str], dict]:
    info = ffprobe(video)
    vstreams = [st for st in info["streams"] if st["codec_type"] == "video"]
    astreams = [st for st in info["streams"] if st["codec_type"] == "audio"]
    errors, warns = [], []
    duration = float(info["format"].get("duration", 0))
    facts = {"duration_sec": round(duration, 2)}
    if not vstreams:
        return ["no video stream"], warns, facts
    w, h = int(vstreams[0]["width"]), int(vstreams[0]["height"])
    facts.update(width=w, height=h, video_codec=vstreams[0].get("codec_name"), has_audio=bool(astreams))
    if abs(w / h - 9 / 16) > 0.01:
        errors.append(f"aspect ratio is {w}x{h}, not 9:16")
    if h < 1280:
        warns.append(f"resolution {w}x{h} is low - aim for 1080x1920")
    if not astreams:
        errors.append("no audio track")
    sc = cfg["script"]
    if not sc["min_seconds"] - 2 <= duration <= sc["max_seconds"] + 5:
        warns.append(f"duration {duration:.1f}s is outside your {sc['min_seconds']}-{sc['max_seconds']}s target")
    if duration > 180:
        errors.append("over 3 minutes - too long for a Short/Reel")
    if astreams:
        proc = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-af", "volumedetect", "-vn",
                               "-f", "null", "-"], capture_output=True, text=True)
        mean = re.search(r"mean_volume: (-?[\d.]+) dB", proc.stderr)
        peak = re.search(r"max_volume: (-?[\d.]+) dB", proc.stderr)
        if mean and peak:
            facts.update(mean_volume_db=float(mean.group(1)), peak_volume_db=float(peak.group(1)))
            if float(mean.group(1)) < -30:
                warns.append("audio is very quiet (mean below -30 dB)")
            if float(peak.group(1)) >= -0.1:
                warns.append("audio may be clipping (peak at 0 dB)")
    return errors, warns, facts


def print_qc(video: Path, cfg: dict) -> bool:
    errors, warns, facts = quality_check(video, cfg)
    print(f"Quality check: {rel(video)}")
    print("  " + ", ".join(f"{k}={v}" for k, v in facts.items()))
    for e in errors:
        print(f"  FAIL   {e}")
    for w in warns:
        print(f"  check  {w}")
    print("  Manual checks: lip-sync, face looks like you, captions readable and correctly spelled, "
          "nothing hidden under the app buttons.")
    print("  PASS (automatic checks)" if not errors else "  FAIL")
    return not errors


def require_ffmpeg() -> None:
    if not (have("ffmpeg") and have("ffprobe")):
        raise SystemExit("FFmpeg is not installed. See README.md -> 'Install FFmpeg'.")


def cmd_assemble(args) -> int:
    require_ffmpeg()
    cfg = settings()
    s = load_json(find_script(args.script))
    seg_dir = d("raw") / s["id"]
    seg_files = sorted(seg_dir.glob("seg*.mp4"))
    if not seg_files:
        print(f"No clips found. Save your Higgsfield clips as {rel(seg_dir)}/seg01.mp4, seg02.mp4 ...")
        return 1
    joined = d("edited") / f"{s['id']}_joined.mp4"
    print(f"Joining {len(seg_files)} clip(s)...")
    concat_segments(seg_files, joined, cfg)
    total = media_duration(joined)
    cap = cfg["captions"]
    srt = d("captions") / s["id"] / "captions.srt"
    write_srt(srt, caption_cues(s, cfg["script"]["words_per_second"], cap["max_words_per_cue"], total,
                                cap.get("uppercase", False)))
    final = d("edited") / f"{s['id']}_final.mp4"
    print("Burning captions...")
    burn_captions(joined, srt, final, cfg)
    joined.unlink()
    print(f"Wrote {rel(final)}")
    return 0 if print_qc(final, cfg) else 1


def cmd_burn(args) -> int:
    require_ffmpeg()
    cfg = settings()
    s = load_json(find_script(args.script))
    video = Path(args.video)
    cap = cfg["captions"]
    srt = d("captions") / s["id"] / "captions.srt"
    write_srt(srt, caption_cues(s, cfg["script"]["words_per_second"], cap["max_words_per_cue"],
                                media_duration(video), cap.get("uppercase", False)))
    out = Path(args.out) if args.out else d("edited") / f"{s['id']}_final.mp4"
    burn_captions(video, srt, out, cfg)
    print(f"Wrote {rel(out)}")
    return 0 if print_qc(out, cfg) else 1


def cmd_qc(args) -> int:
    require_ffmpeg()
    return 0 if print_qc(Path(args.video), settings()) else 1


# --------------------------------------------------------------------------
# Module 6: calendar and publishing log
# --------------------------------------------------------------------------

def published_ids() -> set[str]:
    return {r["script_id"] for r in read_csv(d("analytics") / "content_tracker.csv") if r.get("script_id")}


def cmd_calendar(args) -> int:
    cfg = settings()["publishing"]
    days = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}
    wanted = {days[x] for x in cfg["posting_days"]}
    done = published_ids()
    queue = [load_json(p) for p in sorted(d("approved").glob("*.json"))]
    drafts = [load_json(p) for p in sorted(d("scripts").glob("*.json"))]
    queue += [s for s in drafts if not check_script(s)[0]]  # drafts that pass checks, after approved ones
    queue = sorted((s for s in queue if s["id"] not in done),
                   key=lambda s: (s.get("status") != "approved", s.get("priority", 99), s["id"]))
    start = dt.date.fromisoformat(args.start) if args.start else today()
    rows = []
    for offset in range(args.days):
        day = start + dt.timedelta(days=offset)
        if day.weekday() not in wanted:
            continue
        s = queue.pop(0) if queue else None
        for platform in cfg["platforms"]:
            rows.append({
                "date": day.isoformat(), "day": day.strftime("%a"), "time": cfg["post_time"],
                "timezone": cfg["timezone"], "platform": platform,
                "script_id": s["id"] if s else "", "topic": s["topic"] if s else "",
                "category": s["category"] if s else "",
                "status": ("EMPTY - pick an idea and write a script" if not s else
                           "approved - needs video" if s.get("status") == "approved" else
                           "draft - needs your approval"),
                "approved_by_me": "",
            })
    out = d("planning") / "content_calendar.csv"
    write_csv(out, rows, ["date", "day", "time", "timezone", "platform", "script_id", "topic", "category",
                          "status", "approved_by_me"])
    print(f"Wrote {rel(out)} ({len(rows)} slots, {sum(1 for r in rows if r['script_id'])} filled)")
    return 0


def cmd_published(args) -> int:
    s = load_json(find_script(args.script))
    cfg = settings()
    final = d("edited") / f"{s['id']}_final.mp4"
    dest = d("published") / s["id"]
    dest.mkdir(parents=True, exist_ok=True)
    if final.exists() and not (dest / final.name).exists():
        shutil.copy2(final, dest / final.name)
    length = ""
    if final.exists() and have("ffprobe"):
        length = round(media_duration(final))
    else:
        length = round(estimate_seconds(s, cfg["script"]["words_per_second"]))
    row = {k: "" for k in TRACKER_COLUMNS}
    row.update(date_published=args.date or today().isoformat(), platform=args.platform, script_id=s["id"],
               topic=s["topic"], category=s["category"], hook=s["beats"][0]["voiceover"],
               hook_type=s.get("hook_type", ""), video_length_sec=length, post_url=args.url or "")
    append_csv(d("analytics") / "content_tracker.csv", [row], TRACKER_COLUMNS)
    print(f"Logged {s['id']} on {args.platform}. Fill in the numbers in "
          f"{DIRS['analytics']}/content_tracker.csv after 48 hours and again after 7 days.")
    return 0


# --------------------------------------------------------------------------
# Module 7: analytics
# --------------------------------------------------------------------------

def per_k(value, views):
    v, n = num(value), num(views)
    if v is None or not n:
        return None
    return v / n * 1000


def video_metrics(r: dict) -> dict:
    views = num(r.get("views"))
    length = num(r.get("video_length_sec"))
    watch = num(r.get("avg_watch_time_sec"))
    retention = None
    if num(r.get("completion_rate_pct")) is not None:
        retention = num(r["completion_rate_pct"]) / 100
    elif watch is not None and length:
        retention = min(watch / length, 1.5)
    return {
        "views": views,
        "retention": retention,
        "shares_per_1k": per_k(r.get("shares"), views),
        "saves_per_1k": per_k(r.get("saves"), views),
        "follows_per_1k": per_k(r.get("followers_gained"), views),
        "comments_per_1k": per_k(r.get("comments"), views),
        "clicks_per_1k": per_k(r.get("link_clicks"), views),
        "conversions": num(r.get("conversions")),
    }


WEIGHTS = {"retention": 0.30, "shares_per_1k": 0.20, "saves_per_1k": 0.20, "follows_per_1k": 0.20,
           "comments_per_1k": 0.05, "views": 0.05}


def score_rows(rows: list[dict]) -> list[dict]:
    """Quality score: each metric relative to the median of your own videos on the same
    platform (platforms report different metrics). Views are deliberately only 5% of the score."""
    by_platform = defaultdict(list)
    for r in rows:
        by_platform[r.get("platform", "")].append(r)
    if len(by_platform) > 1:
        return [r for group in by_platform.values() for r in score_rows(group)]
    metrics = [video_metrics(r) for r in rows]
    medians = {}
    for key in WEIGHTS:
        vals = [m[key] for m in metrics if m[key] is not None]
        medians[key] = statistics.median(vals) if vals else None
    scored = []
    for r, m in zip(rows, metrics):
        total, weight = 0.0, 0.0
        for key, w in WEIGHTS.items():
            if m[key] is not None and medians[key]:
                total += w * min(m[key] / medians[key], 3.0)
                weight += w
        scored.append({**r, "_m": m, "_score": total / weight if weight else None})
    return scored


def fmt(v, pct=False):
    if v is None:
        return "n/a"
    return f"{v:.0%}" if pct else (f"{v:,.0f}" if v >= 100 else f"{v:.1f}")


def weekly_report(rows: list[dict], end: dt.date) -> str:
    start = end - dt.timedelta(days=6)
    week = [r for r in rows if r.get("date_published") and start <= dt.date.fromisoformat(r["date_published"]) <= end]
    with_data = [r for r in rows if num(r.get("views"))]
    out = [f"# Weekly analysis - week ending {end.isoformat()}", "",
           f"Posts this week: **{len(week)}** - posts with data (all time): **{len(with_data)}** - "
           f"confidence: *{confidence_label(len(with_data))}*", "",
           "> **How to read this:** the score compares each video with your own median *on the same platform* for retention (30%), "
           "shares (20%), saves (20%), follows (20%), comments (5%) and views (5%). 1.0 = typical for you. "
           "Views alone never decide whether a topic 'works'.", ""]
    if not with_data:
        out.append("No numbers yet. Fill in `10_analytics/content_tracker.csv` 48 hours after posting.")
        return "\n".join(out) + "\n"

    scored = [r for r in score_rows(with_data) if r["_score"] is not None]
    scored.sort(key=lambda r: r["_score"], reverse=True)
    out += ["## All videos ranked by quality score", "",
            "| Score | Date | Platform | Topic | Views | Retention | Shares/1k | Saves/1k | Follows/1k |",
            "|---|---|---|---|---|---|---|---|---|"]
    for r in scored:
        m = r["_m"]
        out.append(f"| {r['_score']:.2f} | {r['date_published']} | {r['platform']} | {r['topic'][:45]} | "
                   f"{fmt(m['views'])} | {fmt(m['retention'], True)} | {fmt(m['shares_per_1k'])} | "
                   f"{fmt(m['saves_per_1k'])} | {fmt(m['follows_per_1k'])} |")

    flags = []
    for r in scored:
        m = r["_m"]
        med_views = statistics.median(x["_m"]["views"] for x in scored if x.get("platform") == r.get("platform"))
        if m["views"] and m["views"] > 1.5 * med_views and r["_score"] < 1:
            flags.append(f"**{r['topic'][:50]}** ({r['platform']}) got above-average views but below-average "
                         "quality - reach without retention/follows. Don't copy it blindly.")
        if m["views"] and m["views"] < med_views and r["_score"] > 1.2:
            flags.append(f"**{r['topic'][:50]}** ({r['platform']}) had fewer views but strong quality - "
                         "a candidate to remake with a sharper hook.")
    out += ["", "## Things to notice", ""] + ([f"- {f}" for f in flags] or ["- Nothing unusual."])

    def group_table(key: str, label: str) -> list[str]:
        groups = defaultdict(list)
        for r in scored:
            groups[r.get(key) or "unlabelled"].append(r["_score"])
        lines = ["", f"## By {label}", "", f"| {label} | Videos | Avg score | Confidence |", "|---|---|---|---|"]
        for k, vals in sorted(groups.items(), key=lambda kv: -statistics.mean(kv[1])):
            lines.append(f"| {CATEGORIES.get(k, k)} | {len(vals)} | {statistics.mean(vals):.2f} | "
                         f"{confidence_label(len(vals))} |")
        return lines

    out += group_table("category", "Category")
    out += group_table("hook_type", "Hook type")
    out += group_table("platform", "Platform")

    biz = [r for r in scored if (r["_m"]["clicks_per_1k"] or 0) > 0 or (r["_m"]["conversions"] or 0) > 0]
    out += ["", "## Business outcomes", ""]
    if biz:
        for r in biz:
            out.append(f"- {r['topic'][:50]}: {fmt(r['_m']['clicks_per_1k'])} link clicks per 1k views, "
                       f"{fmt(r['_m']['conversions'])} conversions")
    else:
        out.append("- No link clicks or conversions recorded yet.")

    exps = []
    cats = defaultdict(list)
    for r in scored:
        cats[r.get("category", "")].append(r["_score"])
    best_cat = max(cats.items(), key=lambda kv: statistics.mean(kv[1]))[0] if cats else None
    if best_cat:
        exps.append(f"Make 2 more videos in **{CATEGORIES.get(best_cat, best_cat)}** with *different* hooks, to "
                    "see if it's the topic or the hook doing the work.")
    hooks = defaultdict(list)
    for r in scored:
        if r.get("hook_type"):
            hooks[r["hook_type"]].append(r["_score"])
    if hooks:
        best_hook = max(hooks.items(), key=lambda kv: statistics.mean(kv[1]))[0]
        exps.append(f"Reuse the **{best_hook}** hook style on a new topic (A/B: same topic, two hook styles).")
    tried = {r.get("category") for r in rows}
    untried = [c for c in CATEGORIES if c not in tried]
    if untried:
        exps.append(f"Try one video in an untested category: **{CATEGORIES[untried[0]]}**.")
    rets = [r["_m"]["retention"] for r in scored if r["_m"]["retention"] is not None]
    if rets and statistics.median(rets) < 0.5:
        exps.append("Median retention is under 50%: cut the first sentence after the hook and get to point 1 faster.")
    follows = [r["_m"]["follows_per_1k"] for r in scored if r["_m"]["follows_per_1k"] is not None]
    if follows and statistics.median(follows) < 1:
        exps.append("Follows are low: end with a specific reason to follow (e.g. 'part 2 tomorrow') instead of a generic ask.")
    out += ["", "## Experiments for next week", ""] + [f"{n}. {e}" for n, e in enumerate(exps, start=1)]
    out += ["", f"_Sample sizes are small until you have 10+ videos per group. Hypotheses, not facts._", ""]
    return "\n".join(out)


def cmd_weekly(args) -> int:
    end = dt.date.fromisoformat(args.week_ending) if args.week_ending else today()
    tracker = Path(args.tracker) if args.tracker else d("analytics") / "content_tracker.csv"
    report = weekly_report(read_csv(tracker), end)
    out = d("analytics") / "reports" / f"weekly_{end.isoformat()}.md"
    out.write_text(report, encoding="utf-8")
    print(f"Wrote {rel(out)}")
    return 0


# --------------------------------------------------------------------------
# Status
# --------------------------------------------------------------------------

def cmd_status(args) -> int:
    cfg = settings()
    creators = [c for c in read_csv(CONFIG / "creators.csv") if c.get("instagram_username")]
    ideas = sorted(d("ideas").glob("ideas_*.md"))
    print("AI Business Influencer Factory - status\n")
    print(f"  FFmpeg installed:          {'yes' if have('ffmpeg') else 'NO - see README'}")
    print(f"  Your name in settings:     {'NOT SET' if cfg['creator']['display_name'] == 'YOUR NAME' else cfg['creator']['display_name']}")
    print(f"  Higgsfield element ID:     {cfg['higgsfield']['reference_element_id'] or 'not set (one-time setup)'}")
    print(f"  Creators to research:      {len(creators)}/10")
    print(f"  Research rows logged:      {len(research_rows())}")
    print(f"  Latest ideas file:         {rel(ideas[-1]) if ideas else 'none - run: python3 factory.py ideas'}")
    print(f"  Draft scripts:             {len(list(d('scripts').glob('*.json')))}")
    print(f"  Approved scripts:          {len(list(d('approved').glob('*.json')))}")
    print(f"  Raw clip folders:          {sum(1 for p in d('raw').iterdir() if p.is_dir())}")
    print(f"  Finished videos:           {len(list(d('edited').glob('*_final.mp4')))}")
    print(f"  Posts logged in tracker:   {len(read_csv(d('analytics') / 'content_tracker.csv'))}")
    return 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="factory.py", description="AI Business Influencer Factory")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="show what's set up and what's in the pipeline").set_defaults(fn=cmd_status)

    r = sub.add_parser("research", help="validate the research log and write a summary report")
    r.add_argument("--ignore-errors", action="store_true")
    r.set_defaults(fn=cmd_research)
    ri = sub.add_parser("research-import", help="append rows from another CSV into the research log")
    ri.add_argument("file")
    ri.set_defaults(fn=cmd_research_import)
    sub.add_parser("research-fetch", help="optional: fetch public reel stats via the Instagram Graph API"
                   ).set_defaults(fn=cmd_research_fetch)

    i = sub.add_parser("ideas", help="generate today's 10 content opportunities")
    i.add_argument("--date")
    i.add_argument("--count", type=int, default=10)
    i.set_defaults(fn=cmd_ideas)

    n = sub.add_parser("new-script", help="create a script skeleton from an idea number")
    n.add_argument("--idea", type=int, required=True)
    n.add_argument("--date")
    n.add_argument("--force", action="store_true")
    n.set_defaults(fn=cmd_new_script)

    c = sub.add_parser("check", help="check scripts for length, structure and risky claims")
    c.add_argument("scripts", nargs="*")
    c.set_defaults(fn=cmd_check)

    pk = sub.add_parser("package", help="build the production package (preview, no approval)")
    pk.add_argument("script")
    pk.add_argument("--force", action="store_true")
    pk.set_defaults(fn=cmd_package)

    a = sub.add_parser("approve", help="approve a script and build its production package")
    a.add_argument("script")
    a.add_argument("--by", required=True, help="your name - approval is your decision")
    a.set_defaults(fn=cmd_approve)

    asm = sub.add_parser("assemble", help="join Higgsfield clips, burn captions, quality-check")
    asm.add_argument("script")
    asm.set_defaults(fn=cmd_assemble)

    b = sub.add_parser("burn", help="burn captions onto a single finished video")
    b.add_argument("script")
    b.add_argument("--video", required=True)
    b.add_argument("--out")
    b.set_defaults(fn=cmd_burn)

    q = sub.add_parser("qc", help="quality-check a video file")
    q.add_argument("video")
    q.set_defaults(fn=cmd_qc)

    cal = sub.add_parser("calendar", help="build a content calendar from approved scripts")
    cal.add_argument("--days", type=int, default=14)
    cal.add_argument("--start")
    cal.set_defaults(fn=cmd_calendar)

    pub = sub.add_parser("published", help="log a video you have published (you upload it yourself)")
    pub.add_argument("script")
    pub.add_argument("--platform", required=True, choices=["instagram", "youtube"])
    pub.add_argument("--url")
    pub.add_argument("--date")
    pub.set_defaults(fn=cmd_published)

    w = sub.add_parser("weekly", help="write the weekly analytics report")
    w.add_argument("--week-ending")
    w.add_argument("--tracker")
    w.set_defaults(fn=cmd_weekly)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
