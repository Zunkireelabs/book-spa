"""python3 -m gmaps <command>   (run from the gmaps-scraper folder)

  open [--demo]          start the coverage map in your browser
  demo                   (re)create demo.db with fake leads
  coverage [--demo]      write out/coverage_map.html and print a per-area table
  assign                 put businesses that have coordinates into their named area
  mark ID STATUS         record that a lead was contacted / replied / ... (--note, --channel)
  import-customers CSV   mark Zennly's own customers (name, phone, lat, lng)
  areas                  list the named areas and how many search cells each needs
  list [--area A]        the businesses that are NOT ours yet (the call list), with phone numbers
  collect --area A       find new businesses in an area (opens Chrome; --dry-run shows the plan only)
"""
import argparse

import db

from . import areas as areas_mod
from . import config, coverage, customers, demo, grid, mark, serve


def _db_path(args):
    if getattr(args, "demo", False):
        if not config.DEMO_DB.exists():
            demo.build()
        return config.DEMO_DB
    return config.LIVE_DB


def main(argv=None):
    p = argparse.ArgumentParser(prog="gmaps", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    o = sub.add_parser("open"); o.add_argument("--demo", action="store_true"); o.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    o.add_argument("--no-browser", action="store_true")
    sub.add_parser("demo")
    c = sub.add_parser("coverage"); c.add_argument("--demo", action="store_true")
    sub.add_parser("assign")
    m = sub.add_parser("mark"); m.add_argument("id", type=int); m.add_argument("status", choices=config.STATUSES)
    m.add_argument("--note"); m.add_argument("--channel", default="whatsapp")
    i = sub.add_parser("import-customers"); i.add_argument("csv")
    sub.add_parser("areas")
    ls = sub.add_parser("list"); ls.add_argument("--area"); ls.add_argument("--status", default="new", choices=config.STATUSES)
    ls.add_argument("--limit", type=int, default=50); ls.add_argument("--phone-only", action="store_true"); ls.add_argument("--demo", action="store_true")
    co = sub.add_parser("collect"); co.add_argument("--area", required=True)
    co.add_argument("--query", action="append", help="repeat for several; default is every term in inputs/pilot_kathmandu.json")
    co.add_argument("--limit", type=int, default=20, help="max NEW businesses to save in this run (default 20)")
    co.add_argument("--cell-m", type=int, default=None); co.add_argument("--headed", action="store_true", help="show the Chrome window")
    co.add_argument("--dry-run", action="store_true"); co.add_argument("--force", action="store_true", help="search cells again even if done recently")
    args = p.parse_args(argv)

    if args.cmd == "open":
        serve.serve(_db_path(args), port=args.port, open_browser=not args.no_browser)
    elif args.cmd == "demo":
        path, n = demo.build()
        print(f"Created {path} with {n} fake leads. View it with: python3 -m gmaps open --demo")
    elif args.cmd == "coverage":
        path = _db_path(args)
        out = coverage.write(path)
        conn = db.connect(str(path))
        data = coverage.build_data(conn)
        print(f"Wrote {out}\n")
        print(f"{'Area':<14}{'State':<12}{'Found':>6}{'Reached':>9}{'Customers':>11}")
        for a in data["areas"]:
            print(f"{a['name']:<14}{a['state']:<12}{a['found']:>6}{a['reached']:>9}{a['customers']:>11}")
        print(f"\nTotal: {data['totals']['found']} mapped, {data['totals']['reached']} reached, "
              f"{data['totals']['areas_searched']}/{data['totals']['areas_total']} areas searched")
    elif args.cmd == "assign":
        conn = db.connect(str(config.LIVE_DB))
        print(f"Assigned {areas_mod.assign_all(conn, areas_mod.load())} businesses to areas")
    elif args.cmd == "mark":
        conn = db.connect(str(config.LIVE_DB))
        print(f"{mark.mark(conn, args.id, args.status, channel=args.channel, note=args.note)} -> {args.status}")
    elif args.cmd == "import-customers":
        conn = db.connect(str(config.LIVE_DB))
        matched, added = customers.import_csv(conn, args.csv)
        print(f"{matched} matched existing leads, {added} added as new customers")
    elif args.cmd == "list":
        conn = db.connect(str(_db_path(args)))
        sql = "SELECT id, business_name, category, area, phone, rating, reviews_count FROM businesses WHERE status=?"
        params = [args.status]
        if args.area:
            sql += " AND area=?"; params.append(args.area)
        if args.phone_only:
            sql += " AND phone IS NOT NULL AND phone<>''"
        sql += " ORDER BY (phone IS NULL), reviews_count DESC LIMIT ?"; params.append(args.limit)
        rows = conn.execute(sql, params).fetchall()
        print(f"{'ID':>6}  {'Business':<34}{'Type':<12}{'Area':<12}{'Phone':<16}{'Rating':>6}")
        for r in rows:
            print(f"{r['id']:>6}  {(r['business_name'] or '')[:32]:<34}{(r['category'] or ''):<12}{(r['area'] or ''):<12}"
                  f"{(r['phone'] or '-'):<16}{(str(r['rating']) if r['rating'] else '-'):>6}")
        print(f"\n{len(rows)} shown (status = {args.status}). Contacted one? python3 -m gmaps mark ID contacted")
    elif args.cmd == "collect":
        import json
        from .collect import run as collector
        cfg = json.load(open(config.AREAS_FILE))
        area = next((a for a in areas_mod.load() if a["name"].lower() == args.area.lower()), None)
        if not area:
            raise SystemExit(f"Unknown area '{args.area}'. Choose from: " + ", ".join(a["name"] for a in areas_mod.load()))
        queries = args.query or cfg["queries"]
        cell_m = args.cell_m or cfg.get("cell_m", 600)
        cells, searches = collector.plan(area, queries, cell_m)
        print(f"{area['name']}: {len(cells)} cells x {len(queries)} search terms = up to {searches} searches; "
              f"will save at most {args.limit} new businesses this run.")
        if args.dry_run:
            print("Dry run: nothing opened, nothing saved.")
            return
        from .collect.browser import MapsSession
        conn = db.connect(str(config.LIVE_DB))
        with MapsSession(headless=not args.headed) as session:
            s = collector.collect_area(conn, area, queries, session, limit=args.limit, cell_m=cell_m, force=args.force)
        db.log_run(conn, f"gmaps:{area['name']}", s["new"])
        print(f"\nSaved {s['new']} new, merged {s['merged']} into existing, {s['no_phone']} without a phone, "
              f"skipped {s['skipped_cells']} cells searched recently, {s['irrelevant']} not our type, "
              f"{s['closed']} closed, {s['errors']} unreadable."
              + ("  STOPPED: blocked by Google." if s["blocked"] else "") + ("  Reached the limit." if s["hit_limit"] else ""))
        print(f"See them: python3 -m gmaps list --area {area['name']}")
    elif args.cmd == "areas":
        for a in areas_mod.load():
            cells = len(grid.cells_for_area(a["lat"], a["lng"], a["radius_m"]))
            print(f"{a['name']:<14}{'pilot' if a.get('pilot') else '':<7}radius {a['radius_m']:>5} m  ->  {cells:>3} search cells")
