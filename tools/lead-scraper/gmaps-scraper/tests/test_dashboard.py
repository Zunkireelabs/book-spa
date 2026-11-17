import json
import re
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gmaps import config, dashboard, demo, serve  # noqa: E402,F401
import db  # noqa: E402


class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path, _ = demo.build(Path(cls.tmp.name) / "demo.db")
        cls.server, cls.token = serve.make_server(cls.path, port=18780)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=10) as r:
            return r.status, r.read().decode()

    def post(self, body, token=None, host=None, origin=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/mark", data=json.dumps(body).encode(), method="POST")
        req.add_header("Content-Type", "application/json")
        if token is not None:
            req.add_header("X-Token", token)
        if host:
            req.add_header("Host", host)
        if origin:
            req.add_header("Origin", origin)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_data_has_ours_and_to_contact(self):
        conn = db.connect(str(self.path))
        d = dashboard.build_data(conn)
        statuses = [l["status"] for l in d["leads"]]
        self.assertEqual(len(d["leads"]), 98)
        self.assertGreater(statuses.count("customer"), 0)          # the "Ours" tab has rows
        self.assertGreater(statuses.count("new"), 0)               # the "To contact" tab has rows
        self.assertTrue(any(l["wa"] for l in d["leads"]))
        self.assertTrue(d["runs"])                                 # the demo seeded search runs

    def test_pages_served_and_data_embedded(self):
        code, html = self.get("/dashboard")
        self.assertEqual(code, 200)
        self.assertIn("Demo", html)
        self.assertNotIn("/*__DATA__*/null", html)
        self.assertIn(self.token, html)                            # the page carries the token it needs
        self.assertEqual(self.get("/")[0], 200)                    # the map still works
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/nope")

    def test_mark_requires_token_and_local_host(self):
        self.assertEqual(self.post({"id": 1, "status": "contacted"})[0], 403)                       # no token
        self.assertEqual(self.post({"id": 1, "status": "contacted"}, token="wrong")[0], 403)        # wrong token
        self.assertEqual(self.post({"id": 1, "status": "contacted"}, token=self.token, origin="http://evil.example")[0], 403)
        self.assertEqual(self.post({"id": 1, "status": "contacted"}, token=self.token, host="evil.example")[0], 403)

    def test_mark_changes_status_and_validates(self):
        conn = db.connect(str(self.path))
        bid = conn.execute("SELECT id FROM businesses WHERE status='new' LIMIT 1").fetchone()["id"]
        code, body = self.post({"id": bid, "status": "contacted", "note": "called"}, token=self.token)
        self.assertEqual((code, body["status"]), (200, "contacted"))
        self.assertEqual(conn.execute("SELECT status FROM businesses WHERE id=?", (bid,)).fetchone()[0], "contacted")
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM touches WHERE business_id=?", (bid,)).fetchone()[0], 1)
        self.assertEqual(self.post({"id": bid, "status": "bogus"}, token=self.token)[0], 400)
        self.assertEqual(self.post({"id": 999999, "status": "contacted"}, token=self.token)[0], 400)
        self.assertEqual(self.post({"status": "contacted"}, token=self.token)[0], 400)

    def test_template_javascript_has_no_unfilled_placeholders(self):
        _, html = self.get("/dashboard")
        self.assertIsNone(re.search(r"__TOKEN__|__DATA__", html))


if __name__ == "__main__":
    unittest.main()
