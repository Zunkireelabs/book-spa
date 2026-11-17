"""OpenStreetMap collector (free, no key) via the Overpass API."""
import json
import time
import urllib.parse
import urllib.request

ENDPOINTS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"]

# Bounding boxes (south,west,north,east) beat name lookups: "London" otherwise matches only the City of London.
BBOX = {
    "Kathmandu": "27.62,85.25,27.80,85.50",  # whole Kathmandu valley incl. Lalitpur/Bhaktapur
    "Lalitpur": None, "Bhaktapur": None,  # covered by the Kathmandu valley box
    "Pokhara": "28.15,83.92,28.30,84.05",
    "Chitwan": "27.60,84.35,27.75,84.50",
    "Biratnagar": "26.42,87.24,26.50,87.31",
    "Butwal": "27.66,83.42,27.73,83.50",
    "Birgunj": "27.00,84.85,27.04,84.90",
    "Delhi": "28.40,76.85,28.88,77.35",
    "Mumbai": "18.89,72.77,19.28,73.00",
    "Bangalore": "12.83,77.46,13.14,77.75",
    "London": "51.28,-0.51,51.69,0.33",
    "Manchester": "53.40,-2.35,53.55,-2.13",
    "New York": "40.49,-74.26,40.92,-73.70",
    "Los Angeles": "33.70,-118.67,34.34,-118.15",
    "Toronto": "43.58,-79.64,43.86,-79.12",
    "Vancouver": "49.20,-123.23,49.32,-123.02",
}

# category label -> Overpass tag filters
TAGS = {
    "salon": ['["shop"="hairdresser"]', '["shop"="beauty"]'],
    "spa": ['["leisure"="spa"]', '["amenity"="spa"]', '["shop"="massage"]'],
    "gym": ['["leisure"="fitness_centre"]'],
    "pilates/yoga": ['["sport"~"pilates|yoga"]', '["name"~"pilates|yoga",i]["leisure"]', '["name"~"pilates|yoga",i]["shop"]'],
}


def _query(city, filters):
    if city in BBOX:
        parts = "".join(f"nwr{f}({BBOX[city]});" for f in filters)
        return f"[out:json][timeout:90];({parts});out center tags;"
    parts = "".join(f"nwr{f}(area.a);" for f in filters)
    return f'[out:json][timeout:90];area["name"="{city}"]["boundary"="administrative"]->.a;({parts});out center tags;'


def _fetch(q, retries=3):
    data = urllib.parse.urlencode({"data": q}).encode()
    for i in range(retries):
        try:
            req = urllib.request.Request(ENDPOINTS[i % len(ENDPOINTS)], data=data, headers={"User-Agent": "zennly-leads/0.1"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)["elements"]
        except Exception as e:
            print(f"  overpass retry {i + 1}: {e}")
            time.sleep(10 * (i + 1))
    return []


def _addr(t, city):
    street = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
    parts = [street, t.get("addr:suburb"), t.get("addr:city") or city]
    return ", ".join(p for p in parts if p) or None


def _social(v, base):
    if not v:
        return None
    return v if v.startswith("http") else base + v.lstrip("@/")


def collect(country, cities, categories=("salon", "spa", "gym", "pilates/yoga")):
    for city in cities:
        if BBOX.get(city, 1) is None:
            continue
        for cat in categories:
            if cat not in TAGS:
                continue
            for el in _fetch(_query(city, TAGS[cat])):
                t = el.get("tags", {})
                name = t.get("name")
                if not name:
                    continue
                # nodes carry lat/lon directly; ways and relations carry a "center" (we ask for `out center`)
                pt = el.get("center") or el
                yield {
                    "lat": pt.get("lat"),
                    "lng": pt.get("lon"),
                    "business_name": name,
                    "category": cat,
                    "country": country,
                    "city": t.get("addr:city") or city,
                    "address": _addr(t, city),
                    "phone": t.get("phone") or t.get("contact:phone") or t.get("contact:mobile"),
                    "email": t.get("email") or t.get("contact:email"),
                    "website": t.get("website") or t.get("contact:website"),
                    "facebook": _social(t.get("contact:facebook") or t.get("facebook"), "https://facebook.com/"),
                    "instagram": _social(t.get("contact:instagram") or t.get("instagram"), "https://instagram.com/"),
                    "source_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
                }
            time.sleep(2)  # be polite to the free server
