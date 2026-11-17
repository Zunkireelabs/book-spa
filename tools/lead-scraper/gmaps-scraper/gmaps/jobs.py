"""Run a Google Maps search in the background so the dashboard can start it, watch it and stop it.

One search at a time. The browser work happens in a worker thread; the dashboard polls `snapshot()`.
"""
import threading
import time
from datetime import datetime

import db

from . import areas as areas_mod
from .collect import run as collector

MAX_LOG = 400


class Runner:
    def __init__(self, db_path, session_factory=None, delay=(2.0, 5.0), sleep=time.sleep):
        self.db_path = db_path
        self.session_factory = session_factory or self._default_factory
        self.delay, self.sleep = delay, sleep
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.state = self._blank()

    @staticmethod
    def _blank():
        return {"state": "idle", "area": None, "queries": [], "limit": 0, "dry_run": False,
                "started": None, "finished": None, "log": [], "stats": None, "error": None}

    @staticmethod
    def _default_factory(headed):
        from .collect.browser import MapsSession
        return MapsSession(headless=not headed)

    # ---- called from the web server ----
    def snapshot(self):
        with self._lock:
            s = dict(self.state)
            s["log"] = list(s["log"][-MAX_LOG:])
            return s

    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self, area_name, queries, limit, headed=True, dry_run=False, cell_m=600):
        area = next((a for a in areas_mod.load() if a["name"].lower() == str(area_name).lower()), None)
        if not area:
            raise ValueError(f"Unknown place: {area_name}")
        queries = [str(q).strip() for q in (queries or []) if str(q).strip()]
        if not 1 <= len(queries) <= 10 or any(len(q) > 60 for q in queries):
            raise ValueError("Choose between 1 and 10 search words (up to 60 characters each)")
        limit = int(limit)
        if not 1 <= limit <= 200:
            raise ValueError("The number of businesses must be between 1 and 200")
        with self._lock:
            if self.running():
                raise RuntimeError("A search is already running. Stop it or wait for it to finish.")
            self._stop.clear()
            self.state = self._blank()
            self.state.update(state="running", area=area["name"], queries=queries, limit=limit, dry_run=bool(dry_run),
                              started=datetime.now().isoformat(timespec="seconds"))
            self._thread = threading.Thread(target=self._work, args=(area, queries, limit, bool(headed), bool(dry_run), cell_m),
                                            daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()

    def wait(self, timeout=10):
        """For tests."""
        if self._thread:
            self._thread.join(timeout)

    # ---- worker thread ----
    def _log(self, msg):
        with self._lock:
            self.state["log"].append(f"{datetime.now():%H:%M:%S}  {msg}")

    def _finish(self, state, **extra):
        with self._lock:
            self.state.update(state=state, finished=datetime.now().isoformat(timespec="seconds"), **extra)

    def _work(self, area, queries, limit, headed, dry_run, cell_m):
        conn = None
        try:
            cells, searches = collector.plan(area, queries, cell_m)
            self._log(f"{area['name']}: {len(cells)} cells x {len(queries)} search words = up to {searches} searches. "
                      f"It will save at most {limit} new businesses.")
            if dry_run:
                self._log("Preview only: nothing was opened and nothing was saved.")
                return self._finish("done")
            self._log("Opening the browser...")
            session = self.session_factory(headed)
            conn = db.connect(str(self.db_path))
            with session as s:
                stats = collector.collect_area(conn, area, queries, s, limit=limit, cell_m=cell_m, log=self._log,
                                               sleep=self.sleep, delay=self.delay, should_stop=self._stop.is_set)
            db.log_run(conn, f"gmaps:{area['name']}", stats["new"])
            self._log(f"Saved {stats['new']} new, merged {stats['merged']} into existing, {stats['no_phone']} without a phone, "
                      f"{stats['skipped_cells']} cells skipped (searched recently), {stats['irrelevant']} not our type, "
                      f"{stats['closed']} closed, {stats['errors']} unreadable.")
            state = "blocked" if stats["blocked"] else "stopped" if stats["stopped"] else "done"
            self._finish(state, stats=stats)
        except SystemExit as e:                        # e.g. Playwright is not installed: the message says what to run
            self._finish("error", error=str(e))
        except Exception as e:
            self._log(f"Error: {e}")
            self._finish("error", error=str(e))
        finally:
            if conn is not None:
                conn.close()
