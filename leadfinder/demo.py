"""Pretend Google + pretend websites, for demo mode and tests. Costs nothing, touches no network.
Every business is made up. Phone numbers use Ofcom's 020 7946 0xxx range, reserved for fiction."""
import hashlib
import random

from .google_places import PAGE_CAP

TOWNS = {"ilford": (51.5590, 0.0741), "forest gate": (51.5492, 0.0245), "stratford": (51.5416, -0.0034),
         "romford": (51.5751, 0.1821), "barking": (51.5362, 0.0808)}
WEBSITES = ["", "", "", "https://www.facebook.com/demo{n}", "https://instagram.com/demo{n}",
            "https://demo{n}.fresha.com", "https://www.yell.com/biz/demo{n}", "https://demo{n}.business.site",
            "https://demo{n}.wixsite.com/home", "https://www.demo-good-{n}.co.uk", "https://www.demo-old-{n}.co.uk"]
STREETS = ["High Road", "Romford Road", "Cranbrook Road", "Green Street", "Woodgrange Road", "Ley Street"]


def _seed(*parts):
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)


class FakePlaces:
    def __init__(self, density=40):
        self.density = density  # businesses per query per (roughly) square mile
        self.requests_made = 0
        self._cache = {}

    def geocode(self, place):
        self.requests_made += 1
        key = place.strip().lower()
        lat, lng = TOWNS.get(key, (51.5 + (_seed(key) % 1000) / 10000, -0.1 + (_seed(key, 1) % 1000) / 5000))
        return {"lat": lat, "lng": lng, "label": f"{place.strip().title()}, UK (demo)"}

    def _world(self, query, tile):
        """Businesses on a fixed 0.01-degree grid of cells, so overlapping searches see the same ones."""
        out = []
        for ci in range(int(tile.south * 100) - 1, int(tile.north * 100) + 2):
            for cj in range(int(tile.west * 100) - 1, int(tile.east * 100) + 2):
                k = (query, ci, cj)
                if k not in self._cache:
                    rnd = random.Random(_seed(*k))
                    cell = []
                    for i in range(rnd.randint(0, max(1, self.density // 10))):
                        n = _seed(query, ci, cj, i) % 100000
                        lat, lng = (ci + rnd.random()) / 100, (cj + rnd.random()) / 100
                        cell.append(self._business(rnd, query, n, lat, lng))
                    self._cache[k] = cell
                out.extend(p for p in self._cache[k]
                           if tile.south <= p["location"]["latitude"] < tile.north
                           and tile.west <= p["location"]["longitude"] < tile.east)
        return sorted(out, key=lambda p: p["id"])

    def _business(self, rnd, query, n, lat, lng):
        site = rnd.choice(WEBSITES).format(n=n)
        p = {
            "id": f"demo_{query.replace(' ', '_')}_{n}",
            "displayName": {"text": f"Demo {query.title()} {n}"},
            "formattedAddress": f"{rnd.randint(1, 400)} {rnd.choice(STREETS)}, London IG1 {rnd.randint(1, 9)}AA, UK",
            "addressComponents": [{"types": ["postal_code"], "longText": f"IG1 {rnd.randint(1, 9)}AA"}],
            "location": {"latitude": lat, "longitude": lng},
            "nationalPhoneNumber": f"020 7946 0{n % 1000:03d}" if rnd.random() > 0.1 else "",
            "rating": round(rnd.uniform(3.0, 5.0), 1),
            "userRatingCount": int(rnd.expovariate(1 / 60)),
            "businessStatus": "OPERATIONAL" if rnd.random() > 0.05 else "CLOSED_PERMANENTLY",
            "regularOpeningHours": {"weekdayDescriptions": ["Monday: 9:00 AM – 6:00 PM"]} if rnd.random() > 0.2 else {},
            "googleMapsUri": "https://maps.google.com/?cid=0",
            "primaryType": query.replace(" ", "_"),
            "types": [query.replace(" ", "_")],
        }
        if site:
            p["websiteUri"] = site
        return p

    def text_search_page(self, query, tile, page_token=None):
        self.requests_made += 1
        allp = self._world(query, tile)[:PAGE_CAP]
        start = int(page_token or 0)
        nxt = start + 20
        return allp[start:nxt], (str(nxt) if nxt < len(allp) else None)


def fake_site_check(url, **kw):
    if "demo-good" in url:
        return "has_website", "Website looks current"
    if "demo-old" in url:
        return "outdated_site", "Website not mobile-friendly, copyright says 2017"
    return "broken_site", "Website won't load (demo)"
