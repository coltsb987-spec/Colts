"""Decides whether a business is a lead, based on its website (or lack of one)."""
import datetime as dt
import re
import urllib.error
import urllib.request
from urllib.parse import urlparse

SOCIAL = {"facebook.com", "fb.com", "fb.me", "instagram.com", "tiktok.com", "twitter.com", "x.com",
          "linkedin.com", "youtube.com", "linktr.ee", "linkin.bio", "beacons.ai", "wa.me", "whatsapp.com"}
BOOKING = {"fresha.com", "booksy.com", "treatwell.co.uk", "setmore.com", "square.site", "squareup.com",
           "vagaro.com", "gettimely.com", "booker.com", "simplybook.me", "simplybook.it", "phorest.com",
           "salonized.com", "calendly.com", "acuityscheduling.com", "as.me", "styleseat.com", "shedul.com",
           "mindbodyonline.com", "booksteam.com", "bookafy.com", "zenoti.com", "opentable.co.uk",
           "opentable.com", "resdiary.com", "sevenrooms.com", "squareup.co.uk"}
DIRECTORY = {"yell.com", "checkatrade.com", "mybuilder.com", "ratedpeople.com", "bark.com",
             "trustatrade.com", "just-eat.co.uk", "deliveroo.co.uk", "ubereats.com", "foodhub.co.uk",
             "thomsonlocal.com", "freeindex.co.uk", "hotfrog.co.uk", "yelp.co.uk", "tripadvisor.co.uk",
             "tripadvisor.com", "google.com"}
FREE_BUILDER = ("wixsite.com", "weebly.com", "wordpress.com", "godaddysites.com", "webnode.page",
                "jimdosite.com", "site123.me", "blogspot.com", "carrd.co", "mystrikingly.com")
DEAD = ("business.site",)  # Google's free business sites, switched off in 2024

PARKED = re.compile(r"domain (is )?for sale|buy this domain|this domain (has expired|is parked)|"
                    r"parked free|domain parking|account suspended|website coming soon", re.I)

LEAD_KINDS = {"no_website", "social_only", "booking_only", "directory_only", "outdated_site", "broken_site"}
KIND_LABEL = {
    "no_website": "No website",
    "social_only": "Only social media",
    "booking_only": "Only a booking page",
    "directory_only": "Only a directory listing",
    "outdated_site": "Outdated website",
    "broken_site": "Broken website",
    "has_website": "Has a working website",
    "unchecked_site": "Has a website (not checked)",
}


def _host(url):
    if not url:
        return ""
    if "://" not in url:
        url = "http://" + url
    h = (urlparse(url).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def _matches(host, domains):
    return any(host == d or host.endswith("." + d) for d in domains)


def classify_url(url):
    """Quick classification from the URL alone. Returns (kind, note); kind is None if it needs a site check."""
    host = _host(url)
    if not host:
        return "no_website", "No website on the Google listing"
    if _matches(host, SOCIAL):
        return "social_only", f"Listing links to {host}"
    if _matches(host, BOOKING):
        return "booking_only", f"Listing links to booking page on {host}"
    if _matches(host, DIRECTORY):
        return "directory_only", f"Listing links to {host}"
    if _matches(host, DEAD):
        return "broken_site", f"{host} sites were switched off by Google in 2024"
    if _matches(host, FREE_BUILDER):
        return "outdated_site", f"Free website-builder address ({host})"
    return None, ""


def assess_html(final_url, status, html, now_year=None, outdated_years=3):
    """Judge a fetched home page. Returns (kind, note)."""
    now_year = now_year or dt.date.today().year
    if status >= 400:
        return "broken_site", f"Website returns error {status}"
    kind, note = classify_url(final_url)
    if kind:  # redirected to Facebook, a booking page, etc.
        return kind, note + " (website redirects there)"
    if len(html.strip()) < 200 or PARKED.search(html[:20000]):
        return "broken_site", "Website is empty, parked or suspended"
    problems = []
    if not final_url.lower().startswith("https://"):
        problems.append("not secure (no https)")
    if not re.search(r"<meta[^>]+name=[\"']?viewport", html, re.I):
        problems.append("not mobile-friendly")
    years = [int(y) for y in re.findall(r"(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})", html, re.I)]
    if years and max(years) <= now_year - outdated_years:
        problems.append(f"copyright says {max(years)}")
    if problems:
        return "outdated_site", "Website " + ", ".join(problems)
    return "has_website", "Website looks current"


def check_site(url, timeout=8, max_bytes=400_000, **kw):
    """Fetch the home page (free, no Google cost) and judge it."""
    if "://" not in url:
        url = "http://" + url
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; LeadFinder/0.1)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html = r.read(max_bytes).decode(r.headers.get_content_charset() or "utf-8", "replace")
            return assess_html(r.geturl(), r.status, html, **kw)
    except urllib.error.HTTPError as e:
        return assess_html(url, e.code, "", **kw)
    except Exception as e:  # DNS failure, timeout, bad certificate...
        return "broken_site", f"Website won't load ({type(e).__name__})"
