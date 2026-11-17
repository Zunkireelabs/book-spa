import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from gmaps import areas, config, dashboard, demo, jobs, serve  # noqa: E402
import db  # noqa: E402
from test_collect import blob  # noqa: E402


class Gate:
    """A stand-in browser. `hold` makes search() wait, so a run can be caught mid-way."""
    def __init__(self, hold=None):
        self.hold = hold
        self.pages = {"u/a": blob("Glow Salon", place_id="A", phone="9801112223"),
                      "u/b": blob("Quiet Barber", cats=("Barber shop",), place_id="B", phone="9801112224")}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def search(self, q, lat, lng):
        if self.hold:
            self.hold.wait(5)
        return ["u/a", "u/b"]

    def place(self, url):
        return self.pages[url]


class ToolsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path, _ = demo.build(Path(self.tmp.name) / "demo.db")
        self.custom = Path(self.tmp.name) / "custom_areas.json"
        self.patch = mock.patch.object(config, "CUSTOM_AREAS_FILE", self.custom)
        self.patch.start()
        self.gate = Gate()
        self.runner = jobs.Runner(self.path, session_factory=lambda headed: self.gate, delay=(0, 0), sleep=lambda s: None)
        self.server, self.token = serve.make_server(self.path, port=18790, runner=self.runner)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.runner.stop()
        if self.gate.hold:
            self.gate.hold.set()
        self.runner.wait(5)
        self.server.shutdown()
        self.server.server_close()
        self.patch.stop()
        self.tmp.cleanup()

    def call(self, method, path, body=None, token=True, host=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("X-Token", self.token)
        if host:
            req.add_header("Host", host)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            finally:
                e.close()

    # ---- searches ----
    def test_preview_runs_without_opening_anything(self):
        self.assertEqual(self.call("POST", "/api/run", {"area": "Lazimpat", "queries": ["salon"], "limit": 5, "dry_run": True})[0], 200)
        self.runner.wait()
        snap = self.call("GET", "/api/run", token=False)[1]
        self.assertEqual(snap["state"], "done")
        self.assertTrue(any("Preview only" in l for l in snap["log"]))
        self.assertEqual(self.call("GET", "/api/run", token=False)[1]["stats"], None)

    def test_real_run_saves_businesses_and_logs_a_run(self):
        before = db.connect(str(self.path)).execute("SELECT COUNT(*) FROM businesses").fetchone()[0]
        self.assertEqual(self.call("POST", "/api/run", {"area": "Thamel", "queries": ["salon"], "limit": 5})[0], 200)
        self.runner.wait()
        snap = self.call("GET", "/api/run", token=False)[1]
        self.assertEqual((snap["state"], snap["stats"]["new"]), ("done", 2))
        conn = db.connect(str(self.path))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM businesses").fetchone()[0], before + 2)
        self.assertEqual(conn.execute("SELECT area FROM businesses WHERE google_place_id='A'").fetchone()[0], "Thamel")
        self.assertTrue(conn.execute("SELECT 1 FROM runs WHERE source='gmaps:Thamel'").fetchone())

    def test_second_search_while_running_is_refused_and_stop_works(self):
        self.gate.hold = threading.Event()
        self.assertEqual(self.call("POST", "/api/run", {"area": "Sanepa", "queries": ["salon"], "limit": 5})[0], 200)
        code, body = self.call("POST", "/api/run", {"area": "Sanepa", "queries": ["salon"], "limit": 5})
        self.assertEqual(code, 409)
        self.assertIn("already running", body["error"])
        self.call("POST", "/api/run/stop", {})
        self.gate.hold.set()
        self.runner.wait()
        self.assertEqual(self.call("GET", "/api/run", token=False)[1]["state"], "stopped")

    def test_playwright_missing_is_reported_not_crashed(self):
        def broken(headed):
            raise SystemExit("Playwright is not installed. Run once: ...")
        self.runner.session_factory = broken
        self.call("POST", "/api/run", {"area": "Sanepa", "queries": ["salon"], "limit": 3})
        self.runner.wait()
        snap = self.call("GET", "/api/run", token=False)[1]
        self.assertEqual(snap["state"], "error")
        self.assertIn("Playwright", snap["error"])

    def test_bad_search_requests_are_rejected(self):
        bad = [{"area": "Nowhere", "queries": ["salon"], "limit": 5}, {"area": "Thamel", "queries": [], "limit": 5},
               {"area": "Thamel", "queries": ["salon"], "limit": 0}, {"area": "Thamel", "queries": ["salon"], "limit": 9999},
               {"area": "Thamel", "queries": ["x" * 80], "limit": 5}, {"queries": ["salon"]}]
        for b in bad:
            self.assertEqual(self.call("POST", "/api/run", b)[0], 400, b)

    # ---- places ----
    def test_add_place_validates_and_shows_up(self):
        code, body = self.call("POST", "/api/areas", {"name": "Lakeside", "lat": 28.2096, "lng": 83.9586, "radius_m": 1200})
        self.assertEqual((code, body["area"]["name"]), (200, "Lakeside"))
        self.assertIn("Lakeside", [a["name"] for a in areas.load()])
        conn = db.connect(str(self.path))
        self.assertIn("Lakeside", [a["name"] for a in dashboard.build_data(conn)["areas_list"]])
        for bad in ({"name": "Lakeside", "lat": 28.2, "lng": 83.9, "radius_m": 800},       # duplicate
                    {"name": "London", "lat": 51.5, "lng": -0.1, "radius_m": 800},          # not in Nepal
                    {"name": "X", "lat": 28.2, "lng": 83.9, "radius_m": 800},               # name too short
                    {"name": "Big", "lat": 28.2, "lng": 83.9, "radius_m": 99999}):          # radius too big
            self.assertEqual(self.call("POST", "/api/areas", bad)[0], 400, bad)

    # ---- customers ----
    def test_customer_import_matches_by_phone_and_adds_new(self):
        conn = db.connect(str(self.path))
        existing = conn.execute("SELECT id, phone FROM businesses WHERE status='new' LIMIT 1").fetchone()
        text = f"name,phone,lat,lng,city\nSomebody Else,{existing['phone']},,,\nBrand New Customer,9841234567,27.72,85.32,Kathmandu\n"
        code, body = self.call("POST", "/api/customers", {"csv": text})
        self.assertEqual((code, body["matched"], body["added"]), (200, 1, 1))
        conn = db.connect(str(self.path))
        self.assertEqual(conn.execute("SELECT status FROM businesses WHERE id=?", (existing["id"],)).fetchone()[0], "customer")
        self.assertEqual(conn.execute("SELECT status FROM businesses WHERE business_name='Brand New Customer'").fetchone()[0], "customer")
        self.assertEqual(self.call("POST", "/api/customers", {})[0], 400)

    # ---- safety ----
    def test_changing_routes_need_the_token_and_a_local_host(self):
        for path, body in [("/api/run", {"area": "Thamel", "queries": ["salon"], "limit": 1}), ("/api/run/stop", {}),
                           ("/api/areas", {"name": "Zed Place", "lat": 28, "lng": 84, "radius_m": 500}), ("/api/customers", {"csv": "name\nA"})]:
            self.assertEqual(self.call("POST", path, body, token=False)[0], 403, path)
            self.assertEqual(self.call("POST", path, body, host="evil.example")[0], 403, path)
        self.assertEqual(self.call("GET", "/api/run", token=False, host="evil.example")[0], 403)

    def test_dashboard_data_has_what_the_new_pages_need(self):
        d = dashboard.build_data(db.connect(str(self.path)))
        self.assertIsInstance(d["can_run"], bool)
        thamel = next(a for a in d["areas_list"] if a["name"] == "Thamel")
        self.assertGreater(thamel["cells"], 5)
        self.assertTrue(thamel["pilot"])


if __name__ == "__main__":
    unittest.main()
