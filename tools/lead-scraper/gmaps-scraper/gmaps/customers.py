"""Import Zennly's own customers so the map can show where we already are.

CSV columns (header row required): name, phone, lat, lng, city   (phone / lat / lng / city optional).
A customer matching an existing lead by phone is marked `customer`; otherwise it is added as a new business.
"""
import csv
import io

import db
import normalize

from . import mark


def import_csv(conn, path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return _import_rows(conn, csv.DictReader(f))


def import_text(conn, text):
    """Same as import_csv for pasted text. The first line must be a header that includes `name`."""
    return _import_rows(conn, csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def _import_rows(conn, reader):
    matched = added = 0
    for row in reader:
        name = (row.get("name") or row.get("business_name") or "").strip()
        if not name:
            continue
        raw = {"business_name": name, "country": "NP", "city": (row.get("city") or "Kathmandu").strip(),
               "phone": row.get("phone"), "category": row.get("category")}
        for k in ("lat", "lng"):
            try:
                raw[k] = float(row[k]) if row.get(k) else None
            except ValueError:
                raw[k] = None
        rec = normalize.record(raw)
        existing = None
        if rec.get("phone"):
            existing = conn.execute("SELECT id FROM businesses WHERE phone=?", (rec["phone"],)).fetchone()
        if existing:
            bid, matched = existing["id"], matched + 1
        else:
            bid, added = db.upsert(conn, rec, force_new=True), added + 1
        mark.mark(conn, bid, "customer", channel="import", note="Zennly customer")
    return matched, added
