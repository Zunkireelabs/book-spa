"""Fill missing phone / website / Facebook / Instagram from Google Places (Text Search, Places API New).
Usage: GOOGLE_PLACES_API_KEY=... python3 places_enrich.py [country=NP] [max_requests=900]
Safety: stops at max_requests (default 900, under the free monthly allowance). Chairlyo/Fresha rows go first,
then rows missing a phone. Only accepts a result whose name is similar to ours (>=0.7), so wrong matches are skipped.
"""
import difflib
import json
import os
import re
import sys
import time
import urllib.request

import db
import normalize

KEY = os.environ.get("GOOGLE_PLACES_API_KEY")
URL = "https://places.googleapis.com/v1/places:searchText"
MASK = "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri"
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", (s or "").lower())


def search(query):
    body = json.dumps({"textQuery": query, "maxResultCount": 3}).encode()
    req = urllib.request.Request(URL, body, {"Content-Type": "application/json", "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": MASK})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("places", [])


def main(country="NP", cap=900):
    if not KEY:
        sys.exit("Set GOOGLE_PLACES_API_KEY first.")
    conn = db.connect()
    rows = conn.execute(
        "SELECT id,business_name,city FROM businesses WHERE country=? AND (phone IS NULL OR website IS NULL) AND google_place_id IS NULL "
        "ORDER BY (platform_used IN ('Chairlyo','Fresha')) DESC, (platform_used IS NOT NULL) DESC LIMIT ?", (country, cap)).fetchall()
    used = hit = 0
    for r in rows:
        used += 1
        try:
            places = search(f"{r['business_name']} {r['city'] or ''} {country}")
        except Exception as e:
            print("stop:", e); break
        best = max(places, key=lambda p: difflib.SequenceMatcher(None, norm(r["business_name"]), norm(p["displayName"]["text"])).ratio(), default=None)
        if best and difflib.SequenceMatcher(None, norm(r["business_name"]), norm(best["displayName"]["text"])).ratio() >= 0.7:
            site = best.get("websiteUri")
            fb = site if site and "facebook.com" in site else None
            ig = site if site and "instagram.com" in site else None
            site = None if fb or ig else site
            conn.execute(
                "UPDATE businesses SET google_place_id=?, phone=COALESCE(phone,?), website=COALESCE(website,?), domain=COALESCE(domain,?),"
                " facebook=COALESCE(facebook,?), instagram=COALESCE(instagram,?), address=COALESCE(address,?) WHERE id=?",
                (best["id"], normalize.phone(best.get("internationalPhoneNumber"), country), site, normalize.domain(site), fb, ig,
                 best.get("formattedAddress"), r["id"]))
            hit += 1
        else:
            conn.execute("UPDATE businesses SET google_place_id=? WHERE id=?", ("none:" + str(r["id"]), r["id"]))  # don't retry
        if used % 25 == 0:
            conn.commit(); print(f"{used} searched, {hit} matched")
        time.sleep(0.2)
    conn.commit()
    print(f"done: {used} requests used, {hit} matched")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "NP", int(sys.argv[2]) if len(sys.argv) > 2 else 900)
