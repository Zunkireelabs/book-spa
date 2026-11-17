"""Turn leads.db into the data behind the coverage map, and render the map page."""
import json
from datetime import datetime, timezone
from pathlib import Path

import db

from . import areas as areas_mod
from . import config, links

TEMPLATE = Path(__file__).parent / "templates" / "coverage_map.html"


def area_state(found, reached, customers, searched):
    """reached = green, partial = amber, untouched = red, empty = searched but nothing there, unsearched = never looked."""
    if found == 0:
        return "empty" if searched else "unsearched"
    if customers > 0 or reached / found >= 0.5:
        return "reached"
    if reached > 0:
        return "partial"
    return "untouched"


def build_data(conn, areas=None):
    areas = areas or areas_mod.load()
    searched = {r["area"] for r in conn.execute("SELECT DISTINCT area FROM cell_searches WHERE area IS NOT NULL")}
    reached_sql = ",".join("'%s'" % s for s in config.REACHED)

    stats = {}
    for r in conn.execute(
        f"""SELECT area, COUNT(*) AS found,
                   SUM(status IN ({reached_sql})) AS reached,
                   SUM(status='customer') AS customers
            FROM businesses WHERE area IS NOT NULL GROUP BY area"""
    ):
        stats[r["area"]] = r

    out_areas = []
    for a in areas:
        s = stats.get(a["name"])
        found, reached, cust = (s["found"], s["reached"] or 0, s["customers"] or 0) if s else (0, 0, 0)
        out_areas.append({
            "name": a["name"], "lat": a["lat"], "lng": a["lng"], "radius_m": a["radius_m"],
            "pilot": bool(a.get("pilot")), "found": found, "reached": reached, "customers": cust,
            "state": area_state(found, reached, cust, a["name"] in searched),
        })

    leads = []
    for r in conn.execute(
        """SELECT id, business_name, category, phone, lat, lng, status, area
           FROM businesses WHERE lat IS NOT NULL AND lng IS NOT NULL"""
    ):
        leads.append({
            "id": r["id"], "name": r["business_name"], "cat": r["category"], "area": r["area"],
            "lat": r["lat"], "lng": r["lng"], "status": r["status"] or "new", "phone": r["phone"],
            "wa": links.whatsapp_url(r["phone"]), "page": links.solution_url(r["category"]),
        })

    totals = {
        "found": len(leads),
        "reached": sum(1 for l in leads if l["status"] in config.REACHED),
        "customers": sum(1 for l in leads if l["status"] == "customer"),
        "areas_searched": sum(1 for a in out_areas if a["state"] != "unsearched"),
        "areas_total": len(out_areas),
    }
    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "areas": out_areas, "leads": leads, "totals": totals}


def render(db_path, areas=None):
    conn = db.connect(str(db_path))
    try:
        data = build_data(conn, areas)
    finally:
        conn.close()
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return TEMPLATE.read_text(encoding="utf-8").replace("/*__DATA__*/null", payload)


def write(db_path, out_path=None):
    out = Path(out_path or config.OUT_DIR / "coverage_map.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(db_path), encoding="utf-8")
    return out
