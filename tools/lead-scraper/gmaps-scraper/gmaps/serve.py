"""`python3 -m gmaps open` : serve the map and the dashboard on localhost.

Served over http://127.0.0.1, not opened as files: map-tile servers refuse requests from file:// pages.
Pages are rebuilt from the database on every refresh.

The dashboard can change data (mark a lead, add a place, import customers, start a search). Because any website
you visit could try to send requests to localhost, every route that changes anything only accepts a request that
carries this server's one-time token (put into the dashboard page when it is served), comes from a local Host,
and, if it has an Origin, from this same server.
"""
import json
import secrets
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db

from . import areas as areas_mod
from . import config, coverage, customers, dashboard, jobs, mark

MAX_BODY = 200_000          # customer lists can be a few thousand lines


def make_server(db_path, port=config.DEFAULT_PORT, session_factory=None, runner=None):
    token = secrets.token_urlsafe(16)
    state = {}                                           # filled with the bound port below
    runner = runner or jobs.Runner(db_path, session_factory=session_factory)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, body, ctype="text/html; charset=utf-8"):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _json(self, code, obj):
            self._send(code, json.dumps(obj), "application/json")

        def _local(self):
            p = state["port"]
            ok_hosts = {f"127.0.0.1:{p}", f"localhost:{p}"}
            if self.headers.get("Host", "") not in ok_hosts:
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in {f"http://{h}" for h in ok_hosts}

        def _authorized(self):
            return self._local() and secrets.compare_digest(self.headers.get("X-Token", ""), token)

        def _body(self):
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("The request was empty or too large")
            return json.loads(self.rfile.read(size))

        def do_GET(self):
            path = self.path.split("?")[0]
            try:
                if path in ("/", "/index.html", "/coverage_map.html"):
                    return self._send(200, coverage.render(db_path))
                if path in ("/dashboard", "/dashboard/"):
                    return self._send(200, dashboard.render(db_path, token))
                if path == "/api/run":
                    if not self._local():
                        return self._json(403, {"error": "forbidden"})
                    return self._json(200, runner.snapshot())
            except Exception as e:                       # show the problem in the browser, not a blank page
                return self._send(500, f"<pre>Could not build the page:\n{e}</pre>")
            self._send(404, "Not found", "text/plain")

        def do_POST(self):
            path = self.path.split("?")[0]
            routes = {"/api/mark", "/api/run", "/api/run/stop", "/api/areas", "/api/customers"}
            if path not in routes:
                return self._json(404, {})
            if not self._authorized():
                return self._json(403, {"error": "forbidden"})
            try:
                if path == "/api/run/stop":
                    runner.stop()
                    return self._json(200, {"ok": True})
                body = self._body()
                if path == "/api/mark":
                    conn = db.connect(str(db_path))
                    try:
                        name = mark.mark(conn, int(body["id"]), str(body["status"]), channel="dashboard",
                                         note=(str(body.get("note") or "")[:500]) or None)
                    finally:
                        conn.close()
                    return self._json(200, {"ok": True, "name": name, "status": str(body["status"])})
                if path == "/api/run":
                    runner.start(body["area"], body["queries"], body.get("limit", 20), headed=body.get("headed", True),
                                 dry_run=body.get("dry_run", False))
                    return self._json(200, {"ok": True})
                if path == "/api/areas":
                    area = areas_mod.add_custom(body["name"], body["lat"], body["lng"], body.get("radius_m", 800))
                    return self._json(200, {"ok": True, "area": area})
                if path == "/api/customers":
                    conn = db.connect(str(db_path))
                    try:
                        matched, added = customers.import_text(conn, str(body["csv"]))
                    finally:
                        conn.close()
                    return self._json(200, {"ok": True, "matched": matched, "added": added})
            except RuntimeError as e:                    # a search is already running
                return self._json(409, {"error": str(e)})
            except (ValueError, KeyError, TypeError, LookupError) as e:
                return self._json(400, {"error": str(e)})

        def log_message(self, *a):
            pass

    server = None
    for p in range(port, port + 10):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit(f"Ports {port}-{port + 9} are all busy. Close the other server or pass --port.")
    state["port"] = server.server_address[1]
    server.runner = runner
    return server, token


def serve(db_path, port=config.DEFAULT_PORT, open_browser=True):
    server, _ = make_server(db_path, port)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    print(f"Map:       {base}/\nDashboard: {base}/dashboard\n(database: {db_path})\nPress Ctrl+C to stop.")
    if open_browser:
        webbrowser.open(base + "/dashboard")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
