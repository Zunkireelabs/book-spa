"""Data behind the dashboard: the leads table (ours / to contact / in progress) and the run history."""
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import db

from . import areas as areas_mod
from . import config, grid, links

TEMPLATE = Path(__file__).parent / "templates" / "dashboard.html"
COUNTRY = "NP"           # the dashboard is about Nepal; leads.db also holds UK/US/CA/IN rows from older runs


def _maps_url(source_url, lat, lng):
    if source_url and source_url.startswith("http") and "google." in source_url:
        return source_url
    if lat is not None and lng is not None:
        return f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
    return None


def build_data(conn):
    rows = []
    for r in conn.execute(
        """SELECT b.id, b.business_name, b.category, b.area, b.status, b.phone, b.email, b.website, b.address,
                  b.city, b.rating, b.reviews_count, b.score, b.lat, b.lng, b.platform_used, b.source_url,
                  b.first_seen, b.last_updated,
                  (SELECT touched_at FROM touches t WHERE t.business_id=b.id ORDER BY t.id DESC LIMIT 1) AS last_touch,
                  (SELECT note FROM touches t WHERE t.business_id=b.id ORDER BY t.id DESC LIMIT 1) AS note
           FROM businesses b WHERE b.country=?
           ORDER BY (b.reviews_count IS NULL), b.reviews_count DESC, b.business_name""", (COUNTRY,)):
        rows.append({
            "id": r["id"], "name": r["business_name"], "cat": r["category"], "area": r["area"],
            "status": r["status"] or "new", "phone": r["phone"], "email": r["email"], "website": r["website"],
            "address": r["address"], "city": r["city"], "rating": r["rating"], "reviews": r["reviews_count"],
            "score": r["score"], "lat": r["lat"], "lng": r["lng"], "platform": r["platform_used"],
            "first_seen": r["first_seen"], "updated": r["last_updated"], "last_touch": r["last_touch"],
            "note": r["note"], "wa": links.whatsapp_url(r["phone"]), "page": links.solution_url(r["category"]),
            "maps": _maps_url(r["source_url"], r["lat"], r["lng"]),
        })

    runs = []
    for r in conn.execute(
        """SELECT run_id, area, MIN(searched_at) AS at, COUNT(*) AS searches, SUM(results_found) AS seen
           FROM cell_searches GROUP BY run_id ORDER BY at DESC LIMIT 15"""):
        runs.append({"kind": "Google Maps search", "name": r["area"], "at": r["at"],
                     "searches": r["searches"], "found": r["seen"] or 0})
    for r in conn.execute("SELECT source, started_at, records_found FROM runs ORDER BY id DESC LIMIT 15"):
        runs.append({"kind": "Collector", "name": r["source"], "at": r["started_at"],
                     "searches": None, "found": r["records_found"] or 0})
    runs.sort(key=lambda x: x["at"] or "", reverse=True)

    activity = [{"day": r["d"], "count": r["n"]} for r in conn.execute(
        """SELECT date(touched_at) AS d, COUNT(*) AS n FROM touches
           WHERE touched_at >= date('now', '-13 days') GROUP BY d ORDER BY d""")]
    searched = conn.execute("SELECT COUNT(DISTINCT area) FROM cell_searches WHERE area IS NOT NULL").fetchone()[0]

    found_by_area = {r["area"]: r["n"] for r in conn.execute(
        "SELECT area, COUNT(*) AS n FROM businesses WHERE area IS NOT NULL GROUP BY area")}
    searched_areas = {r["area"] for r in conn.execute("SELECT DISTINCT area FROM cell_searches WHERE area IS NOT NULL")}
    area_list = [{"name": a["name"], "lat": a["lat"], "lng": a["lng"], "radius_m": a["radius_m"],
                  "pilot": bool(a.get("pilot")), "custom": bool(a.get("custom")),
                  "cells": len(grid.cells_for_area(a["lat"], a["lng"], a["radius_m"])),
                  "found": found_by_area.get(a["name"], 0), "searched": a["name"] in searched_areas}
                 for a in areas_mod.load()]

    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "leads": rows, "runs": runs[:20], "statuses": list(config.STATUSES), "activity": activity,
            "areas_searched": searched, "areas_total": len(area_list), "areas_list": area_list,
            "can_run": importlib.util.find_spec("playwright") is not None}


def render(db_path, token):
    conn = db.connect(str(db_path))
    try:
        data = build_data(conn)
    finally:
        conn.close()
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = TEMPLATE.read_text(encoding="utf-8")
    return html.replace("/*__DATA__*/null", payload).replace("__TOKEN__", token)
