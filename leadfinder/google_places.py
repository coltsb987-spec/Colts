"""Google Maps Platform client (official APIs only: Geocoding + Places Text Search (New)).
No scraping. Every call that costs money goes through here and is counted."""
import json
import urllib.error
import urllib.parse
import urllib.request

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PAGE_CAP = 60  # Google never returns more than 60 results for one text search

FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents",
    "places.location", "places.websiteUri", "places.nationalPhoneNumber",
    "places.internationalPhoneNumber", "places.rating", "places.userRatingCount",
    "places.businessStatus", "places.regularOpeningHours.weekdayDescriptions",
    "places.googleMapsUri", "places.primaryType", "places.types", "nextPageToken",
])


class PlacesError(Exception):
    pass


class GooglePlaces:
    def __init__(self, key, timeout=20):
        if not key:
            raise PlacesError("No Google API key. Add GOOGLE_MAPS_API_KEY=... to the .env file.")
        self._key = key
        self.timeout = timeout
        self.requests_made = 0

    def _http(self, req):
        self.requests_made += 1
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:500].replace(self._key, "***")
            raise PlacesError(f"Google returned HTTP {e.code}: {body}") from None
        except urllib.error.URLError as e:
            raise PlacesError(f"Could not reach Google: {e.reason}") from None

    def geocode(self, place):
        q = urllib.parse.urlencode({"address": place, "region": "uk", "components": "country:GB", "key": self._key})
        data = self._http(urllib.request.Request(f"{GEOCODE_URL}?{q}"))
        if data.get("status") != "OK" or not data.get("results"):
            raise PlacesError(f"Couldn't find '{place}' ({data.get('status')}).")
        top = data["results"][0]
        loc = top["geometry"]["location"]
        return {"lat": loc["lat"], "lng": loc["lng"], "label": top.get("formatted_address", place)}

    def text_search_page(self, query, tile, page_token=None):
        """One page (up to 20) of results inside the tile rectangle. Returns (places, next_token)."""
        body = {
            "textQuery": query, "pageSize": 20, "regionCode": "GB", "languageCode": "en-GB",
            "locationRestriction": {"rectangle": {
                "low": {"latitude": tile.south, "longitude": tile.west},
                "high": {"latitude": tile.north, "longitude": tile.east}}},
        }
        if page_token:
            body["pageToken"] = page_token
        req = urllib.request.Request(
            TEXT_SEARCH_URL, data=json.dumps(body).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": self._key,
                     "X-Goog-FieldMask": FIELD_MASK})
        data = self._http(req)
        return data.get("places", []), data.get("nextPageToken")


def normalise_place(p):
    """Turn a Places API result into a flat lead record."""
    postcode = ""
    for c in p.get("addressComponents", []) or []:
        if "postal_code" in c.get("types", []):
            postcode = c.get("longText") or c.get("shortText") or ""
    loc = p.get("location", {})
    return {
        "place_id": p["id"],
        "name": (p.get("displayName") or {}).get("text", ""),
        "address": p.get("formattedAddress", ""),
        "postcode": postcode,
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "phone": p.get("nationalPhoneNumber", ""),
        "phone_intl": p.get("internationalPhoneNumber", ""),
        "website": p.get("websiteUri", ""),
        "rating": p.get("rating"),
        "review_count": p.get("userRatingCount") or 0,
        "business_status": p.get("businessStatus", ""),
        "primary_type": p.get("primaryType", ""),
        "types": p.get("types", []),
        "hours": (p.get("regularOpeningHours") or {}).get("weekdayDescriptions", []),
        "maps_url": p.get("googleMapsUri", ""),
    }
