"""Named areas (centre + radius) and putting each business into one of them."""
import json
import math

from . import config


def _custom():
    try:
        with open(config.CUSTOM_AREAS_FILE) as f:
            return json.load(f).get("areas", [])
    except FileNotFoundError:
        return []


def load(path=None):
    """Named areas: the shipped list plus any places added from the dashboard."""
    with open(path or config.AREAS_FILE) as f:
        base = json.load(f)["areas"]
    return base + ([] if path else _custom())


def add_custom(name, lat, lng, radius_m):
    """Save a new place to search. Nepal only (the dashboard is about Nepal). Returns the saved area."""
    name = (name or "").strip()
    if not 2 <= len(name) <= 40:
        raise ValueError("Give the place a name between 2 and 40 characters")
    lat, lng, radius_m = float(lat), float(lng), int(radius_m)
    if not (26.2 <= lat <= 30.6 and 80.0 <= lng <= 88.3):
        raise ValueError("That position is outside Nepal")
    if not 200 <= radius_m <= 3000:
        raise ValueError("The search radius must be between 200 and 3000 metres")
    if any(a["name"].lower() == name.lower() for a in load()):
        raise ValueError(f"There is already a place called {name}")
    area = {"name": name, "lat": round(lat, 6), "lng": round(lng, 6), "radius_m": radius_m, "custom": True}
    items = _custom() + [area]
    config.CUSTOM_AREAS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(config.CUSTOM_AREAS_FILE, "w") as f:
        json.dump({"areas": items}, f, indent=2)
    return area


def distance_m(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def assign(areas, lat, lng):
    """Name of the nearest area whose circle contains the point, else None."""
    best, best_d = None, None
    for a in areas:
        d = distance_m(lat, lng, a["lat"], a["lng"])
        if d <= a["radius_m"] and (best_d is None or d < best_d):
            best, best_d = a["name"], d
    return best


def assign_all(conn, areas, only_missing=True):
    """Fill businesses.area from coordinates. Returns how many rows were assigned."""
    where = "lat IS NOT NULL AND lng IS NOT NULL" + (" AND area IS NULL" if only_missing else "")
    n = 0
    for r in conn.execute(f"SELECT id, lat, lng FROM businesses WHERE {where}").fetchall():
        name = assign(areas, r["lat"], r["lng"])
        if name:
            conn.execute("UPDATE businesses SET area=? WHERE id=?", (name, r["id"]))
            n += 1
    conn.commit()
    return n
