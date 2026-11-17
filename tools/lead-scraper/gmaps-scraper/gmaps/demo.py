"""Fake leads in a separate demo.db so the map can be seen working without touching real data."""
import math
import random

import db

from . import areas as areas_mod
from . import config

KINDS = [("salon", "Salon"), ("spa", "Spa"), ("barbershop", "Barber"), ("gym", "Gym"), ("salon", "Beauty Parlour")]
WORDS = ["Glow", "Lotus", "Serene", "Himalayan", "Urban", "Royal", "Bliss", "Velvet", "Aura", "Classic", "Sunrise", "Muse"]

# area -> (how many businesses, share contacted, share replied/customers)
PLAN = {
    "Thamel":    (34, .55, .20),
    "Lazimpat":  (22, .60, .25),
    "Sanepa":    (16, .90, .20),
    "Baluwatar": (14, .08, .00),
    "Patan":     (12, .00, .00),     # found earlier but nobody contacted
}


def build(path=None, seed=7):
    path = path or config.DEMO_DB
    if path.exists():
        path.unlink()
    rnd = random.Random(seed)
    conn = db.connect(str(path))
    areas = {a["name"]: a for a in areas_mod.load()}
    n = 0
    for name, (count, p_contact, p_reply) in PLAN.items():
        a = areas[name]
        for _ in range(count):
            n += 1
            ang, dist = rnd.random() * 6.283, (rnd.random() ** 0.5) * a["radius_m"] * 0.85
            lat = a["lat"] + (dist * math.sin(ang)) / 111320
            lng = a["lng"] + (dist * math.cos(ang)) / (111320 * math.cos(math.radians(a["lat"])))
            cat, kind = rnd.choice(KINDS)
            bid = db.upsert(conn, {
                "business_name": f"Demo {rnd.choice(WORDS)} {kind}", "category": cat, "country": "NP", "city": "Kathmandu",
                "phone": f"+97798000{n:05d}", "source_url": f"demo://{n}", "lat": lat, "lng": lng,
                "rating": round(3.8 + rnd.random() * 1.1, 1), "reviews_count": rnd.randint(4, 220),
            })
            r = rnd.random()
            status = "new"
            if r < p_contact:
                status = "contacted"
                x = rnd.random()
                if x < p_reply * 0.5:
                    status = "customer"
                elif x < p_reply:
                    status = rnd.choice(["replied", "demo"])
                elif x > 0.9:
                    status = "no"
            conn.execute("UPDATE businesses SET status=?, area=? WHERE id=?", (status, name, bid))
            if status != "new":
                conn.execute("INSERT INTO touches (business_id, touched_at, channel, outcome, note) "
                             "VALUES (?, datetime('now', ?), 'whatsapp', ?, NULL)",
                             (bid, f"-{int(rnd.random() ** 1.6 * 13)} days", status))
    # areas we have actually searched (pilot areas); Patan has leads but no recorded search, which is fine
    for a in areas.values():
        if a.get("pilot"):
            conn.execute("INSERT INTO cell_searches (run_id, area, cell_lat, cell_lng, query, searched_at, results_found) "
                         "VALUES ('demo', ?, ?, ?, 'salon', datetime('now'), 1)", (a["name"], a["lat"], a["lng"]))
    conn.commit()
    conn.close()
    return path, n
