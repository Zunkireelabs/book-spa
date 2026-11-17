"""Collect businesses for one named area: search every cell, open every new place, save it to leads.db.

The browser is passed in (`session`), so everything here is tested offline with a fake one.
"""
import difflib
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import db
import normalize

from .. import areas as areas_mod
from .. import config, grid
from .parse import categorize, parse_place

GENERIC = re.compile(r"\b(salon|spa|beauty|parlou?r|studio|unisex|hair|the|and|&|nepal|kathmandu|lalitpur|pvt|ltd)\b")


def _key(name):
    return re.sub(r"\s+", " ", GENERIC.sub(" ", name.lower())).strip() or name.lower()


def same_name(a, b):
    return difflib.SequenceMatcher(None, _key(a), _key(b)).ratio() >= 0.75


def find_existing(conn, rec):
    """Id of the row that is genuinely this business, else None.

    A matching phone number or website is NOT enough on its own: one owner often lists a single mobile for
    several unrelated salons. The names must also look alike (or it is the same Google place id).
    """
    if rec.get("google_place_id"):
        row = conn.execute("SELECT id FROM businesses WHERE google_place_id=?", (rec["google_place_id"],)).fetchone()
        if row:
            return row["id"]
    sql, args = ["country='NP'"], []
    ors = []
    if rec.get("phone"):
        ors.append("phone=?"); args.append(rec["phone"])
    if rec.get("domain"):
        ors.append("domain=?"); args.append(rec["domain"])
    if rec.get("lat") is not None and rec.get("lng") is not None:       # ~170 m box around the point
        ors.append("(lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?)")
        args += [rec["lat"] - .0015, rec["lat"] + .0015, rec["lng"] - .0015, rec["lng"] + .0015]
    if not ors:
        return None
    rows = conn.execute(f"SELECT id, business_name FROM businesses WHERE {sql[0]} AND ({' OR '.join(ors)})", args)
    for r in rows:
        if same_name(r["business_name"], rec["business_name"]):
            return r["id"]
    return None


def plan(area, queries, cell_m):
    cells = grid.cells_for_area(area["lat"], area["lng"], area["radius_m"], cell_m)
    return cells, len(cells) * len(queries)


def _searched_recently(conn, area_name, lat, lng, query, days):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
    return conn.execute(
        "SELECT 1 FROM cell_searches WHERE area=? AND cell_lat=? AND cell_lng=? AND query=? AND searched_at>=? LIMIT 1",
        (area_name, lat, lng, query, since)).fetchone() is not None


def collect_area(conn, area, queries, session, *, limit=20, cell_m=600, skip_days=30, force=False,
                 delay=(2.0, 5.0), sleep=time.sleep, log=print, all_areas=None, should_stop=lambda: False):
    """Returns a dict of counts. Stops cleanly when `limit` new businesses are saved, or on Blocked."""
    from .browser import Blocked  # local import: browser.py is only needed for real runs
    run_id = uuid.uuid4().hex[:8]
    all_areas = all_areas or areas_mod.load()
    cells, _ = plan(area, queries, cell_m)
    stats = dict(run_id=run_id, searches=0, skipped_cells=0, new=0, merged=0, no_phone=0,
                 irrelevant=0, closed=0, known=0, errors=0, blocked=False, hit_limit=False, stopped=False)

    def pause():
        sleep(random.uniform(*delay))

    for (lat, lng) in cells:
        for q in queries:
            if should_stop():
                stats["stopped"] = True
                return stats
            if not force and _searched_recently(conn, area["name"], lat, lng, q, skip_days):
                stats["skipped_cells"] += 1
                continue
            try:
                urls = session.search(q, lat, lng)
            except Blocked as e:
                stats["blocked"] = True
                log(f"STOPPED: {e}. Wait a few hours (or change network) before trying again.")
                return stats
            stats["searches"] += 1
            cell_done = True
            for url in urls:
                if conn.execute("SELECT 1 FROM businesses WHERE source_url=?", (url,)).fetchone():
                    stats["known"] += 1
                    continue
                if should_stop():
                    stats["stopped"], cell_done = True, False
                    break
                if stats["new"] >= limit:
                    stats["hit_limit"], cell_done = True, False
                    break
                pause()
                try:
                    raw = session.place(url)
                    if raw is None:
                        stats["errors"] += 1
                        continue
                    p = parse_place(raw)
                except Blocked as e:
                    stats["blocked"] = True
                    log(f"STOPPED: {e}. Wait a few hours (or change network) before trying again.")
                    return stats
                except Exception as e:
                    stats["errors"] += 1
                    log(f"  could not read {url[-60:]}: {e}")
                    continue
                if p["closed"]:
                    stats["closed"] += 1
                    continue
                cat = categorize(p["categories"])
                if not cat:
                    stats["irrelevant"] += 1
                    continue
                rec = normalize.record({
                    "business_name": p["name"], "category": cat, "country": "NP", "city": "Kathmandu",
                    "address": p["address"], "phone": p["phone_raw"], "website": p["website"],
                    "lat": p["lat"], "lng": p["lng"], "rating": p["rating"], "reviews_count": p["reviews"],
                    "google_place_id": p["place_id"], "source_url": url,
                })
                if not rec.get("phone"):
                    stats["no_phone"] += 1            # still saved: it is a lead we can find a number for later
                existing = find_existing(conn, rec)
                bid = db.upsert(conn, rec, into_id=existing, force_new=existing is None)
                stats["merged" if existing else "new"] += 1
                name = areas_mod.assign(all_areas, rec["lat"], rec["lng"]) if rec.get("lat") is not None else None
                conn.execute("UPDATE businesses SET area=COALESCE(area, ?) WHERE id=?", (name or area["name"], bid))
                conn.commit()
                log(f"  + {p['name']}  [{cat}]  {rec.get('phone') or 'no phone'}")
            if cell_done:
                conn.execute(
                    "INSERT INTO cell_searches (run_id, area, cell_lat, cell_lng, query, searched_at, results_found) "
                    "VALUES (?,?,?,?,?,datetime('now'),?)", (run_id, area["name"], lat, lng, q, len(urls)))
                conn.commit()
            if stats["hit_limit"] or stats["stopped"]:
                return stats
            pause()
    return stats
