"""Likely-to-buy score, 0-100, with plain-English reasons. A guess to help order calls, not a fact."""
import math

KIND_POINTS = {"no_website": 20, "social_only": 20, "directory_only": 18, "broken_site": 18,
               "outdated_site": 15, "booking_only": 12}


def score_lead(lead):
    pts, why = 0, []
    n = lead.get("review_count") or 0
    rp = min(35, round(12 * math.log10(1 + n)))
    pts += rp
    why.append(f"{n} Google reviews (+{rp})")
    r = lead.get("rating")
    if r is not None and r >= 4.0:
        pts += 10; why.append(f"rated {r} (+10)")
    elif r is not None and r >= 3.5:
        pts += 5; why.append(f"rated {r} (+5)")
    status = lead.get("business_status")
    if status == "OPERATIONAL":
        pts += 15; why.append("open for business (+15)")
    elif status == "CLOSED_TEMPORARILY":
        why.append("temporarily closed (+0)")
    if lead.get("phone"):
        pts += 15; why.append("phone number listed (+15)")
    else:
        pts -= 15; why.append("no phone number (-15)")
    if lead.get("hours"):
        pts += 5; why.append("opening hours listed (+5)")
    kp = KIND_POINTS.get(lead.get("website_kind"), 0)
    pts += kp
    if kp:
        why.append(f"{lead['website_kind'].replace('_', ' ')} (+{kp})")
    return max(0, min(100, pts)), "; ".join(why)


def band(score):
    return "hot" if score >= 70 else "warm" if score >= 45 else "cool"
