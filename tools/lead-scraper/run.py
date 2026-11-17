"""Usage: python3 run.py export        -> rewrite leads.csv from leads.db
         python3 run.py demo          -> load 3 fake rows to test dedupe/export
Collectors (collectors/*.py) expose collect(config) -> iterable of raw dicts; wire them in COLLECTORS below.
"""
import sys

import yaml

import db
import export
import normalize

from collectors import osm

COLLECTORS = {}  # name -> collect(config); filled as collectors are built


def ingest(conn, source, raws):
    n = 0
    for raw in raws:
        rec = normalize.record(raw)
        if rec["business_name"]:
            db.upsert(conn, rec)
            n += 1
    conn.commit()
    db.log_run(conn, source, n)
    return n


def run_osm(conn):
    cfg = yaml.safe_load(open("config.yaml"))
    for country, cities in cfg["regions"].items():
        n = ingest(conn, f"osm:{country}", osm.collect(country, cities))
        print(f"{country}: {n} businesses")


def demo(conn):
    rows = [
        {"business_name": "Demo Salon", "country": "NP", "city": "Kathmandu", "phone": "9801234567",
         "address": "Thamel", "website": "https://www.demosalon.com.np", "category": "salon"},
        {"business_name": "Demo Salon (Lalitpur)", "country": "NP", "city": "Lalitpur", "phone": "+977 9801234567",
         "address": "Pulchowk", "website": "demosalon.com.np", "email": "Hello@demosalon.com.np", "platform_used": "Chairlyo"},
        {"business_name": "Zen Spa", "country": "GB", "city": "London", "phone": "020 7946 0000",
         "address": "1 High St", "category": "spa"},
    ]
    print("ingested", ingest(conn, "demo", rows))


if __name__ == "__main__":
    conn = db.connect()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "export"
    if cmd == "osm":
        run_osm(conn)
    if cmd == "demo":
        demo(conn)
    print("exported", export.to_csv(conn), "rows -> leads.csv")
