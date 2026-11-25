"""Runs a town + radius search: tiles the area, asks Google for each tile (splitting busy tiles so the
60-result cap never hides businesses), checks websites, scores, and saves everything to the database."""
import datetime as dt
import re
from concurrent.futures import ThreadPoolExecutor

from . import db
from .classify import LEAD_KINDS, check_site, classify_url
from .geo import miles_between, tiles_for_circle
from .google_places import PAGE_CAP, PlacesError, normalise_place
from .scoring import score_lead

ALL = "all types"
LATLNG = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


class BudgetExceeded(Exception):
    pass


def queries_for(settings, business_type):
    types = settings["business_types"]
    if business_type == ALL:
        return list(types.items())
    if business_type not in types:
        raise ValueError(f"Unknown business type '{business_type}'. Choose from: {', '.join(types)} or '{ALL}'.")
    return [(business_type, types[business_type])]


def resolve_place(con, client, place):
    """Town name -> centre point. Uses the cache first, so re-searching a town costs nothing extra."""
    m = LATLNG.match(place)
    if m:
        return {"lat": float(m.group(1)), "lng": float(m.group(2)), "label": place.strip()}, False
    hit = db.cached_geocode(con, place)
    if hit:
        return hit, False
    g = client.geocode(place)
    db.save_geocode(con, place, g)
    return g, True


def validate(place, radius):
    if not place or not place.strip():
        raise ValueError("Type a town or area, for example Ilford.")
    radius = float(radius)
    if not 1 <= radius <= 10:
        raise ValueError("Radius must be between 1 and 10 miles.")
    return place.strip(), radius


def estimate(con, client, settings, place, radius, business_type):
    """What a search will cost before it runs. Geocoding an uncached town is one (cheap) request."""
    place, radius = validate(place, radius)
    queries = queries_for(settings, business_type)
    loc, geocoded = resolve_place(con, client, place)
    tiles = tiles_for_circle(loc["lat"], loc["lng"], radius, settings["tile_miles"])
    min_req = len(tiles) * len(queries)
    cap = settings["max_requests_per_search"]
    price = settings["cost_per_text_search_usd"]
    return {
        "place": place, "label": loc["label"], "lat": loc["lat"], "lng": loc["lng"], "radius_miles": radius,
        "business_type": business_type, "tiles": len(tiles), "queries": len(queries),
        "min_requests": min_req, "request_cap": cap, "too_big": min_req > cap,
        "min_cost_usd": round(min(min_req, cap) * price, 2), "max_cost_usd": round(cap * price, 2),
        "geocode_cost_usd": settings["cost_per_geocode_usd"] if geocoded else 0,
    }


def too_big_message(needed, cap):
    return (f"Too big: this needs at least {needed} Google requests but the safety limit is {cap}. "
            "Choose a smaller radius or one business type (or raise max_requests_per_search in settings.json).")


def _fetch_tile(client, query, tile, budget):
    """All pages for one tile. Returns (places, hit_cap)."""
    found, token = [], None
    while True:
        if budget["used"] >= budget["cap"]:
            raise BudgetExceeded()
        budget["used"] += 1
        places, token = client.text_search_page(query, tile, token)
        found.extend(places)
        if not token:
            return found, len(found) >= PAGE_CAP


def _recheck_needed(old, website):
    if not old or old.get("website") != website or not old.get("website_checked_at"):
        return True
    age = dt.datetime.now() - dt.datetime.fromisoformat(old["website_checked_at"])
    return age.days > 30


def run_search(con, client, settings, place, radius, business_type, site_checker=check_site,
               on_progress=lambda s: None, search_id=None):
    """Runs the whole search and returns the finished search row. Never exceeds max_requests_per_search."""
    place, radius = validate(place, radius)
    queries = queries_for(settings, business_type)
    cap = settings["max_requests_per_search"]
    budget = {"used": 0, "cap": cap}
    loc, geocoded = resolve_place(con, client, place)
    geocode_reqs = int(geocoded)
    tiles = tiles_for_circle(loc["lat"], loc["lng"], radius, settings["tile_miles"])
    if len(tiles) * len(queries) > cap:
        raise ValueError(too_big_message(len(tiles) * len(queries), cap))
    if search_id is None:
        search_id = db.create_search(con, place_query=place, place_label=loc["label"], lat=loc["lat"],
                                     lng=loc["lng"], radius_miles=radius, business_type=business_type)
    else:
        db.update_search(con, search_id, place_label=loc["label"], lat=loc["lat"], lng=loc["lng"])

    def progress(**f):
        db.update_search(con, search_id, **f)
        on_progress(db.get_search(con, search_id))

    status, message = "done", ""
    seen = {}  # place_id -> (raw place, business type label)
    total, done = len(tiles) * len(queries), 0
    progress(tiles_total=total, message="Searching Google Maps...")
    try:
        for label, query in queries:
            for top in tiles:
                stack = [top]
                while stack:
                    tile = stack.pop()
                    places, capped = _fetch_tile(client, query, tile, budget)
                    for p in places:
                        seen.setdefault(p["id"], (p, label))
                    if capped and tile.depth < settings["max_split_depth"]:
                        stack.extend(tile.split())  # busy area: look again in 4 smaller pieces
                    elif capped:
                        message = "Some very busy spots hit Google's 60-result limit even after splitting."
                done += 1
                progress(tiles_done=done, requests_used=budget["used"] + geocode_reqs, businesses_seen=len(seen))
    except BudgetExceeded:
        status = "partial"
        message = (f"Stopped at the {budget['cap']}-request safety limit. Results so far are saved; "
                   "try a smaller radius or one business type.")
    except PlacesError as e:
        status, message = ("partial" if seen else "failed"), str(e)

    leads = []
    for p, label in seen.values():
        lead = normalise_place(p)
        if lead["lat"] is None:
            continue
        d = miles_between(loc["lat"], loc["lng"], lead["lat"], lead["lng"])
        if d > radius:
            continue
        lead["business_type"], lead["distance"] = label, round(d, 2)
        lead["website_kind"], lead["website_note"] = classify_url(lead["website"])
        leads.append(lead)

    to_check = []
    for lead in leads:
        if lead["website_kind"]:
            continue
        old = db.existing_lead(con, lead["place_id"], db.dedupe_key(lead["name"], lead["phone"]))
        if settings.get("check_websites", True) and _recheck_needed(old, lead["website"]):
            to_check.append(lead)
        elif old and old.get("website") == lead["website"] and old.get("website_kind"):
            lead["website_kind"], lead["website_note"] = old["website_kind"], old["website_note"]
            lead["website_checked_at"] = old["website_checked_at"]
        else:
            lead["website_kind"], lead["website_note"] = "unchecked_site", "Website not checked"
    if to_check:
        progress(message=f"Checking {len(to_check)} websites...")
        years = settings.get("outdated_after_years", 3)
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda l: site_checker(l["website"], outdated_years=years), to_check))
        for lead, (kind, note) in zip(to_check, results):
            lead["website_kind"], lead["website_note"] = kind, note
            lead["website_checked_at"] = db.now()

    found = new = 0
    for lead in leads:
        lead["score"], lead["score_reasons"] = score_lead(lead)
        lead["qualifies"] = lead["website_kind"] in LEAD_KINDS and lead["business_status"] != "CLOSED_PERMANENTLY"
        _, is_new = db.upsert_lead(con, lead, search_id, lead["distance"])
        if lead["qualifies"]:
            found += 1
            new += int(is_new)
    progress(status=status, message=message or f"Found {found} leads ({new} new).",
             requests_used=budget["used"] + geocode_reqs, businesses_seen=len(seen), leads_found=found, new_leads=new,
             finished_at=db.now())
    return db.get_search(con, search_id)
