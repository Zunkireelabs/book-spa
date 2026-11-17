"""Fresha customers: businesses listed on Fresha's public landing pages (schema.org JSON-LD in the HTML).
Every record is tagged platform_used='Fresha'. Phone/website come later from the venue page."""
import json
import re
import time
import urllib.request

BASE = "https://www.fresha.com/lp/en/bt/{cat}/in/{place}"
CATS = ["beauty-salons", "hair-salons", "barbershops", "nail-salons", "spas", "massage", "waxing-salons", "pilates", "gyms"]
UA = {"User-Agent": "Mozilla/5.0 (compatible; zennly-leads/0.1)"}
LD = re.compile(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', re.S)


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception:
        return ""


def _nodes(html):
    for blob in LD.findall(html):
        try:
            data = json.loads(blob)
        except Exception:
            continue
        stack = [data]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                if "@graph" in x:
                    stack.extend(x["@graph"])
                yield x


def venue_details(url):
    """Venue page -> phone / website if Fresha publishes them."""
    out = {}
    html = _get(url)
    for n in _nodes(html):
        if n.get("telephone"):
            out["phone"] = n["telephone"]
    return out


def collect(country, places, cats=CATS):
    seen = set()
    for place in places:
        for cat in cats:
            html = _get(BASE.format(cat=cat, place=place.lower().replace(" ", "-")))
            for n in _nodes(html):
                types = n.get("@type")
                types = types if isinstance(types, list) else [types]
                if not n.get("url") or "/a/" not in n["url"] or n["url"] in seen:
                    continue
                seen.add(n["url"])
                a = n.get("address") or {}
                yield {
                    "business_name": n.get("name"),
                    "country": a.get("addressCountry") or country,
                    "city": a.get("addressLocality"),
                    "address": ", ".join(x for x in (a.get("streetAddress"), a.get("addressLocality")) if x),
                    "category": cat,
                    "platform_used": "Fresha",
                    "source_url": n["url"],
                    "website": None,
                }
            time.sleep(1.5)
