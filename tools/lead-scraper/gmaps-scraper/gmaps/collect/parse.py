"""Read one Google Maps place out of the page's embedded data (`window.APP_INITIALIZATION_STATE`).

The data is a big nested list with no field names; each value sits at a fixed position. The positions below
come from the open-source gosom/google-maps-scraper (MIT), `gmaps/entry.go`. Google can move them at any time,
so every lookup is defensive: a missing or moved field gives None, never a crash, and a payload with no name
is rejected so a layout change is noticed instead of saving junk.
"""
import json
import re
from urllib.parse import parse_qs, urlparse

PREFIX = ")]}'"


def nth(arr, *idx, default=None):
    """arr[i][j][k]... without IndexError/TypeError. Returns default when any step is missing or None."""
    cur = arr
    for i in idx:
        if isinstance(cur, list) and -len(cur) <= i < len(cur):
            cur = cur[i]
        else:
            return default
        if cur is None:
            return default
    return cur


def load(raw):
    """Accept the raw string Google embeds (with its `)]}'` guard), bytes, or an already-decoded list."""
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        raw = raw.strip()
        if raw.startswith(PREFIX):
            raw = raw[len(PREFIX):].strip()
        raw = json.loads(raw)
    return raw


def real_url(u):
    """Google wraps outbound links as /url?q=<real>&...; unwrap them."""
    if not u:
        return None
    if u.startswith("/url?"):
        q = parse_qs(urlparse(u).query).get("q")
        return q[0] if q else None
    return u


def parse_place(raw):
    jd = load(raw)
    d = nth(jd, 6)
    if not isinstance(d, list):
        raise ValueError("not a place payload (no data at position 6)")
    name = nth(d, 11)
    if not isinstance(name, str) or not name.strip():
        raise ValueError("place payload has no name (Google may have changed its layout)")

    categories = [c for c in (nth(d, 13, default=[]) or []) if isinstance(c, str)]
    address = nth(d, 18)
    if isinstance(address, str) and address.startswith(name + ","):
        address = address[len(name) + 1:]
    status_text = nth(d, 88, 0) or ""
    return {
        "name": name.strip(),
        "categories": categories,
        "address": address.strip() if isinstance(address, str) else None,
        "website": real_url(nth(d, 7, 0)),
        "phone_raw": nth(d, 178, 0, 0),
        "rating": nth(d, 4, 7),
        "reviews": int(nth(d, 4, 8, default=0) or 0),
        "lat": nth(d, 9, 2),
        "lng": nth(d, 9, 3),
        "place_id": nth(d, 78),
        "link": nth(d, 27),
        # [88][0] is "CLOSED" for permanently closed places (as of the reference's Nov 2025 notes); unverified live
        "closed": isinstance(status_text, str) and status_text.upper() == "CLOSED",
    }


# ---- our own business-type labels (the same ones config.yaml / links.py use) ----
RULES = [
    (r"\bbarber", "barbershop"), (r"\btattoo", "tattoo"), (r"\bnail", "nail"),
    (r"\bmake-?up", "makeup"), (r"\bmassage|\bspa\b|\bsauna", "spa"),
    (r"\bgym\b|\bfitness|\bhealth club", "gym"), (r"\byoga|\bpilates", "pilates/yoga"),
    (r"\bphysio", "physiotherapy"), (r"\bhair|\bbeauty|\bsalon|\bparlou?r", "salon"),
]


def categorize(google_categories):
    """Our label for the first Google category that matches a rule, else None (business is not one we want)."""
    for cat in google_categories:
        text = cat.lower()
        for pattern, label in RULES:
            if re.search(pattern, text):
                return label
    return None
