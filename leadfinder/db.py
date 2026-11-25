"""SQLite storage. One row per business (deduplicated across every search), linked to each search
that found it. The database file lives in leadfinder/data/, which is git-ignored (personal data)."""
import datetime as dt
import json
import re
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_query TEXT NOT NULL, place_label TEXT, lat REAL, lng REAL,
  radius_miles REAL NOT NULL, business_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',  -- running | done | partial | failed
  message TEXT DEFAULT '', requests_used INTEGER DEFAULT 0, tiles_done INTEGER DEFAULT 0,
  tiles_total INTEGER DEFAULT 0, businesses_seen INTEGER DEFAULT 0, leads_found INTEGER DEFAULT 0,
  new_leads INTEGER DEFAULT 0, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS leads (
  place_id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, postcode TEXT, lat REAL, lng REAL,
  phone TEXT, phone_intl TEXT, website TEXT, website_kind TEXT, website_note TEXT, website_checked_at TEXT,
  rating REAL, review_count INTEGER, business_status TEXT, primary_type TEXT, types_json TEXT,
  hours_json TEXT, maps_url TEXT, business_type TEXT, score INTEGER, score_reasons TEXT,
  qualifies INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_called', notes TEXT DEFAULT '', follow_up_date TEXT,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS leads_dedupe ON leads(dedupe_key);
CREATE TABLE IF NOT EXISTS search_leads (
  search_id INTEGER NOT NULL REFERENCES searches(id), place_id TEXT NOT NULL REFERENCES leads(place_id),
  distance_miles REAL, PRIMARY KEY (search_id, place_id)
);
CREATE TABLE IF NOT EXISTS geocode_cache (query TEXT PRIMARY KEY, lat REAL, lng REAL, label TEXT);
"""


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def connect(path):
    con = sqlite3.connect(str(path), check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.executescript(SCHEMA)
    return con


def dedupe_key(name, phone):
    """Same name + same phone = same business, even if Google lists it twice."""
    digits = re.sub(r"\D", "", phone or "")[-10:]
    if not digits:
        return None
    n = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return f"{n}|{digits}"


def cached_geocode(con, query):
    r = con.execute("SELECT lat, lng, label FROM geocode_cache WHERE query = ?", (query.strip().lower(),)).fetchone()
    return dict(r) if r else None


def save_geocode(con, query, g):
    with con:
        con.execute("INSERT OR REPLACE INTO geocode_cache VALUES (?,?,?,?)",
                    (query.strip().lower(), g["lat"], g["lng"], g["label"]))


def create_search(con, **f):
    with con:
        cur = con.execute(
            "INSERT INTO searches (place_query, place_label, lat, lng, radius_miles, business_type, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (f["place_query"], f["place_label"], f["lat"], f["lng"], f["radius_miles"], f["business_type"], now()))
    return cur.lastrowid


def update_search(con, search_id, **f):
    cols = ", ".join(f"{k} = ?" for k in f)
    with con:
        con.execute(f"UPDATE searches SET {cols} WHERE id = ?", (*f.values(), search_id))


def existing_lead(con, place_id, key):
    r = con.execute("SELECT * FROM leads WHERE place_id = ?", (place_id,)).fetchone()
    if not r and key:
        r = con.execute("SELECT * FROM leads WHERE dedupe_key = ?", (key,)).fetchone()
    return dict(r) if r else None


def upsert_lead(con, lead, search_id, distance):
    """Insert a new business or refresh Google's details on a known one. Call status, notes and
    follow-up dates are never overwritten. Returns (place_id, is_new)."""
    key = dedupe_key(lead["name"], lead["phone"])
    old = existing_lead(con, lead["place_id"], key)
    t = now()
    vals = dict(
        name=lead["name"], address=lead["address"], postcode=lead["postcode"], lat=lead["lat"], lng=lead["lng"],
        phone=lead["phone"], phone_intl=lead["phone_intl"], website=lead["website"],
        website_kind=lead["website_kind"], website_note=lead["website_note"],
        website_checked_at=lead.get("website_checked_at"), rating=lead["rating"],
        review_count=lead["review_count"], business_status=lead["business_status"],
        primary_type=lead["primary_type"], types_json=json.dumps(lead["types"]),
        hours_json=json.dumps(lead["hours"]), maps_url=lead["maps_url"], business_type=lead["business_type"],
        score=lead["score"], score_reasons=lead["score_reasons"], qualifies=int(lead["qualifies"]),
        last_seen=t, dedupe_key=key)
    with con:
        if old:
            pid = old["place_id"]
            con.execute(f"UPDATE leads SET {', '.join(k + ' = ?' for k in vals)} WHERE place_id = ?",
                        (*vals.values(), pid))
        else:
            pid = lead["place_id"]
            vals.update(place_id=pid, first_seen=t)
            con.execute(f"INSERT INTO leads ({', '.join(vals)}) VALUES ({', '.join('?' * len(vals))})",
                        tuple(vals.values()))
        con.execute("INSERT OR IGNORE INTO search_leads VALUES (?,?,?)", (search_id, pid, distance))
    return pid, old is None


def list_searches(con):
    return [dict(r) for r in con.execute("SELECT * FROM searches ORDER BY id DESC")]


def get_search(con, search_id):
    r = con.execute("SELECT * FROM searches WHERE id = ?", (search_id,)).fetchone()
    return dict(r) if r else None


def leads_for_search(con, search_id, only_leads=True):
    q = ("SELECT l.*, sl.distance_miles FROM leads l JOIN search_leads sl ON sl.place_id = l.place_id "
         "WHERE sl.search_id = ?" + (" AND l.qualifies = 1" if only_leads else "") +
         " ORDER BY l.score DESC, l.review_count DESC")
    out = []
    for r in con.execute(q, (search_id,)):
        d = dict(r)
        d["types"] = json.loads(d.pop("types_json") or "[]")
        d["hours"] = json.loads(d.pop("hours_json") or "[]")
        out.append(d)
    return out
