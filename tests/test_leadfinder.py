"""Tests for the Lead Finder (stage one). Uses the made-up demo data: no network, no cost."""
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from leadfinder import classify, config, db, geo, scoring, search  # noqa: E402
from leadfinder.demo import FakePlaces, fake_site_check  # noqa: E402
from leadfinder.google_places import normalise_place  # noqa: E402


def settings(**over):
    s = config.load_settings()
    s.update(over)
    return s


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.con = db.connect(Path(self.tmp.name) / "t.sqlite")
        self.client = FakePlaces()

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def run_search(self, place="Ilford", radius=2, btype="barbers", **over):
        return search.run_search(self.con, self.client, settings(**over), place, radius, btype,
                                 site_checker=fake_site_check)


class TestGeo(unittest.TestCase):
    def test_tiles_cover_the_whole_circle(self):
        lat, lng = 51.559, 0.0741
        tiles = geo.tiles_for_circle(lat, lng, 5, 2)
        for b in range(0, 360, 15):  # points just inside the edge of the circle are inside some tile
            import math
            dlat, dlng = geo.miles_to_deg(lat, 4.95)
            p = (lat + dlat * math.sin(math.radians(b)), lng + dlng * math.cos(math.radians(b)))
            self.assertTrue(any(t.south <= p[0] <= t.north and t.west <= p[1] <= t.east for t in tiles), b)

    def test_corner_tiles_outside_circle_are_dropped(self):
        self.assertLess(len(geo.tiles_for_circle(51.5, 0, 10, 2)), 100)

    def test_split_makes_four_quarters(self):
        t = geo.Tile(0, 0, 2, 2)
        kids = t.split()
        self.assertEqual(len(kids), 4)
        self.assertTrue(all(k.depth == 1 for k in kids))

    def test_distance(self):
        self.assertAlmostEqual(geo.miles_between(51.559, 0.0741, 51.5492, 0.0245), 2.2, delta=0.2)


class TestClassify(unittest.TestCase):
    def test_url_kinds(self):
        cases = {"": "no_website", "https://www.facebook.com/x": "social_only", "instagram.com/x": "social_only",
                 "https://x.fresha.com": "booking_only", "https://booksy.com/en-gb/1": "booking_only",
                 "https://www.yell.com/biz/x": "directory_only", "https://x.business.site": "broken_site",
                 "https://x.wixsite.com/home": "outdated_site", "https://example.co.uk": None}
        for url, kind in cases.items():
            self.assertEqual(classify.classify_url(url)[0], kind, url)

    def test_not_fooled_by_lookalike_domains(self):
        self.assertIsNone(classify.classify_url("https://notfacebook.com")[0])

    def test_html_assessment(self):
        good = '<html><meta name="viewport" content="width=device-width">' + "x" * 300 + "© 2026</html>"
        self.assertEqual(classify.assess_html("https://a.co.uk", 200, good, now_year=2026)[0], "has_website")
        self.assertEqual(classify.assess_html("http://a.co.uk", 200, good, now_year=2026)[0], "outdated_site")
        old = good.replace("2026", "2018")
        self.assertIn("2018", classify.assess_html("https://a.co.uk", 200, old, now_year=2026)[1])
        self.assertEqual(classify.assess_html("https://a.co.uk", 404, "", now_year=2026)[0], "broken_site")
        parked = "<html>This domain is for sale!" + " " * 300
        self.assertEqual(classify.assess_html("https://a.co.uk", 200, parked)[0], "broken_site")
        self.assertEqual(classify.assess_html("https://facebook.com/a", 200, good)[0], "social_only")


class TestScoring(unittest.TestCase):
    def test_busier_open_listing_with_phone_scores_higher(self):
        base = dict(review_count=5, rating=4.2, business_status="OPERATIONAL", phone="020", hours=["x"],
                    website_kind="no_website")
        hi, _ = scoring.score_lead({**base, "review_count": 300})
        lo, _ = scoring.score_lead({**base, "phone": ""})
        self.assertGreater(hi, scoring.score_lead(base)[0])
        self.assertGreater(scoring.score_lead(base)[0], lo)
        self.assertTrue(0 <= lo <= 100 and 0 <= hi <= 100)


class TestSearch(Base):
    def test_saves_only_real_leads_within_radius(self):
        r = self.run_search()
        self.assertEqual(r["status"], "done")
        leads = db.leads_for_search(self.con, r["id"])
        self.assertGreater(len(leads), 0)
        self.assertEqual(r["leads_found"], len(leads))
        for l in leads:
            self.assertIn(l["website_kind"], classify.LEAD_KINDS)
            self.assertNotEqual(l["business_status"], "CLOSED_PERMANENTLY")
            self.assertLessEqual(l["distance_miles"], 2)
        everything = db.leads_for_search(self.con, r["id"], only_leads=False)
        self.assertTrue(any(l["website_kind"] == "has_website" for l in everything))
        self.assertEqual([l["score"] for l in leads], sorted([l["score"] for l in leads], reverse=True))

    def test_no_duplicates_across_overlapping_searches_and_call_notes_kept(self):
        a = self.run_search("Ilford", 2)
        first = db.leads_for_search(self.con, a["id"])[0]
        with self.con:
            self.con.execute("UPDATE leads SET status='interested', notes='ring after 3' WHERE place_id=?",
                             (first["place_id"],))
        b = self.run_search("Ilford", 3)
        ids = [l["place_id"] for l in db.leads_for_search(self.con, b["id"])]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn(first["place_id"], ids)
        self.assertLess(b["new_leads"], b["leads_found"])  # the 2-mile ones aren't new any more
        row = self.con.execute("SELECT status, notes FROM leads WHERE place_id=?", (first["place_id"],)).fetchone()
        self.assertEqual(tuple(row), ("interested", "ring after 3"))
        total = self.con.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
        distinct = self.con.execute("SELECT COUNT(DISTINCT place_id) FROM leads").fetchone()[0]
        self.assertEqual(total, distinct)
        self.assertEqual(len(db.list_searches(self.con)), 2)  # both searches remembered

    def test_same_business_listed_twice_is_merged(self):
        lead = dict(place_id="A", name="Joe's Barbers", address="", postcode="", lat=51.5, lng=0, phone="020 7946 0001",
                    phone_intl="", website="", website_kind="no_website", website_note="", rating=4, review_count=3,
                    business_status="OPERATIONAL", primary_type="", types=[], hours=[], maps_url="",
                    business_type="barbers", score=50, score_reasons="", qualifies=True)
        sid = db.create_search(self.con, place_query="x", place_label="x", lat=0, lng=0, radius_miles=1,
                               business_type="barbers")
        db.upsert_lead(self.con, lead, sid, 0.1)
        _, is_new = db.upsert_lead(self.con, {**lead, "place_id": "B", "name": "JOE'S BARBERS"}, sid, 0.1)
        self.assertFalse(is_new)
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 1)

    def test_busy_tiles_are_split_so_cap_hides_nothing(self):
        self.client = FakePlaces(density=400)
        r = self.run_search("Ilford", 1, tile_miles=2.0)
        seen = r["businesses_seen"]
        self.assertGreater(seen, 60)  # one unsplit tile could only ever return 60
        self.assertGreater(r["requests_used"], 3)

    def test_request_cap_stops_search_and_keeps_results(self):
        self.client = FakePlaces(density=400)  # busy area: tile splitting would need many requests
        r = self.run_search("Ilford", 1, max_requests_per_search=4)
        self.assertEqual(r["status"], "partial")
        self.assertLessEqual(self.client.requests_made, 5)  # 4 searches + 1 geocode
        self.assertIn("safety limit", r["message"])
        self.assertGreater(r["businesses_seen"], 0)

    def test_search_too_big_for_limit_is_refused_before_spending(self):
        with self.assertRaises(ValueError):
            self.run_search("Ilford", 10, "all types")
        self.assertEqual(self.client.requests_made, 1)  # only the town lookup
        e = search.estimate(self.con, self.client, settings(), "Ilford", 10, "all types")
        self.assertTrue(e["too_big"])
        self.assertLessEqual(e["min_cost_usd"], e["max_cost_usd"])

    def test_estimate_and_geocode_cache(self):
        e = search.estimate(self.con, self.client, settings(), "Forest Gate", 3, "cafes")
        self.assertEqual(e["min_requests"], e["tiles"])
        self.assertGreater(e["geocode_cost_usd"], 0)
        before = self.client.requests_made
        e2 = search.estimate(self.con, self.client, settings(), "forest gate ", 3, "cafes")
        self.assertEqual(self.client.requests_made, before)  # cached: free
        self.assertEqual(e2["geocode_cost_usd"], 0)

    def test_bad_input(self):
        for args in (("", 3, "cafes"), ("Ilford", 11, "cafes"), ("Ilford", 0, "cafes"), ("Ilford", 3, "zoos")):
            with self.assertRaises(ValueError):
                search.estimate(self.con, self.client, settings(), *args)

    def test_normalise_place(self):
        p = normalise_place({"id": "x", "displayName": {"text": "A"}, "location": {"latitude": 1, "longitude": 2},
                             "addressComponents": [{"types": ["postal_code"], "longText": "IG1 1AA"}]})
        self.assertEqual((p["name"], p["postcode"], p["website"], p["review_count"]), ("A", "IG1 1AA", "", 0))


class TestServer(Base):
    def setUp(self):
        super().setUp()
        from leadfinder.server import App, make_handler
        self.app = App(Path(self.tmp.name) / "t.sqlite", self.client, settings(), fake_site_check, demo=True)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.app))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def call(self, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_search_needs_confirmation_then_runs(self):
        form = {"place": "Ilford", "radius": 1, "business_type": "barbers"}
        self.assertEqual(self.call("/api/searches", form)[0], 400)
        code, est = self.call("/api/estimate", form)
        self.assertEqual(code, 200)
        self.assertIn("min_cost_usd", est)
        code, r = self.call("/api/searches", {**form, "confirm": True})
        self.assertEqual(code, 200)
        import time
        for _ in range(100):
            s = self.call(f"/api/searches/{r['id']}")[1]
            if s["status"] != "running":
                break
            time.sleep(0.05)
        self.assertEqual(s["status"], "done")
        code, leads = self.call(f"/api/searches/{r['id']}/leads")
        self.assertEqual(len(leads), s["leads_found"])
        self.assertIn("band", leads[0])

    def test_other_websites_cannot_start_searches(self):
        code, _ = self.call("/api/searches", {"place": "Ilford", "radius": 1, "business_type": "barbers",
                                              "confirm": True}, {"Origin": "https://evil.example"})
        self.assertEqual(code, 403)

    def test_page_loads(self):
        with urllib.request.urlopen(self.base + "/") as r:
            self.assertIn(b"Lead Finder", r.read())


if __name__ == "__main__":
    unittest.main()
