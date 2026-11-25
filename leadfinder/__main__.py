"""Lead Finder command line.

  python3 -m leadfinder serve                 open the web app (real Google searches, costs money)
  python3 -m leadfinder serve --demo          web app with made-up businesses (free)
  python3 -m leadfinder estimate Ilford 3 barbers
  python3 -m leadfinder search Ilford 3 barbers      (shows the cost and asks before spending)
  python3 -m leadfinder searches              list past searches
  python3 -m leadfinder leads <search id>     show the leads from one search
"""
import argparse
import csv
import sys

from . import config, db
from .classify import KIND_LABEL, check_site
from .scoring import band
from .search import ALL, estimate, run_search, too_big_message


def build(demo):
    settings = config.load_settings()
    config.DATA_DIR.mkdir(exist_ok=True)
    if demo:
        from .demo import FakePlaces, fake_site_check
        return config.DATA_DIR / "demo.sqlite", FakePlaces(), settings, fake_site_check
    from .google_places import GooglePlaces
    return config.DATA_DIR / "leads.sqlite", GooglePlaces(config.api_key()), settings, check_site


def describe_estimate(e):
    lines = [f"Area: {e['label']} ({e['radius_miles']} mile radius), type: {e['business_type']}",
             f"Search pieces: {e['tiles']} tiles x {e['queries']} business type(s)",
             f"Google requests: at least {e['min_requests']}, never more than {e['request_cap']} (safety limit)",
             f"Estimated cost: ${e['min_cost_usd']:.2f} to ${e['max_cost_usd']:.2f} at list price "
             "(Google's monthly free allowance may cover it)"]
    if e["too_big"]:
        lines.append(too_big_message(e["min_requests"], e["request_cap"]))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="leadfinder", description="Find local businesses with no good website.")
    ap.add_argument("--demo", action="store_true", help="use made-up businesses (free, no API key)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve"); s.add_argument("--port", type=int, default=8765)
    for name in ("estimate", "search"):
        p = sub.add_parser(name)
        p.add_argument("place"); p.add_argument("radius", type=float)
        p.add_argument("business_type", nargs="?", default=ALL)
        if name == "search":
            p.add_argument("--yes", action="store_true", help="skip the cost question")
    sub.add_parser("searches")
    l = sub.add_parser("leads"); l.add_argument("search_id", type=int); l.add_argument("--csv")
    for p in sub.choices.values():
        p.add_argument("--demo", action="store_true", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)

    db_path, client, settings, checker = build(a.demo)
    if a.cmd == "serve":
        from .server import App, serve
        return serve(App(db_path, client, settings, checker, demo=a.demo), a.port)
    con = db.connect(db_path)
    if a.cmd in ("estimate", "search"):
        e = estimate(con, client, settings, a.place, a.radius, a.business_type)
        print(describe_estimate(e))
        if a.cmd == "estimate" or e["too_big"]:
            return
        if not (a.demo or a.yes) and input("Go ahead and spend this? Type yes: ").strip().lower() != "yes":
            return print("Cancelled. Nothing spent.")
        r = run_search(con, client, settings, a.place, a.radius, a.business_type, site_checker=checker,
                       on_progress=lambda s: print(f"  {s['tiles_done']}/{s['tiles_total']} tiles, "
                                                   f"{s['requests_used']} requests", end="\r"))
        print(f"\nSearch #{r['id']} {r['status']}: {r['message']} Requests used: {r['requests_used']}.")
        return
    if a.cmd == "searches":
        for r in db.list_searches(con):
            print(f"#{r['id']:<4} {r['created_at'][:16]}  {r['place_query']} {r['radius_miles']:g}mi "
                  f"{r['business_type']:<14} {r['status']:<8} {r['leads_found']} leads ({r['new_leads']} new)")
        return
    if a.cmd == "leads":
        leads = db.leads_for_search(con, a.search_id)
        if a.csv:
            cols = ["score", "name", "phone", "address", "website_kind", "website", "review_count", "rating",
                    "business_type", "distance_miles", "maps_url"]
            with open(a.csv, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, cols, extrasaction="ignore"); w.writeheader(); w.writerows(leads)
            return print(f"Saved {len(leads)} leads to {a.csv}")
        for x in leads:
            print(f"{x['score']:>3} {band(x['score']):<4}  {x['name'][:34]:<34} {x['phone'] or '-':<15} "
                  f"{KIND_LABEL.get(x['website_kind'], ''):<24} {x['review_count']} reviews")


if __name__ == "__main__":
    sys.exit(main())
