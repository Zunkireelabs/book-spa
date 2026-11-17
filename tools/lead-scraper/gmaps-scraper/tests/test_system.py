import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gmaps import areas, config, coverage, demo, grid, links, mark  # noqa: E402  (also puts zennly-leads on the path)
import db  # noqa: E402


class GridTests(unittest.TestCase):
    def test_cells_cover_area_and_include_centre(self):
        cells = grid.cells_for_area(27.7154, 85.3123, 900, 600)
        self.assertIn((27.7154, 85.3123), cells)
        self.assertGreater(len(cells), 8)
        self.assertLess(len(cells), 40)
        for lat, lng in cells:
            self.assertLessEqual(areas.distance_m(27.7154, 85.3123, lat, lng), 900 + 600 * 0.7 + 1)

    def test_smaller_cells_means_more_cells(self):
        self.assertGreater(len(grid.cells_for_area(27.7, 85.3, 900, 300)), len(grid.cells_for_area(27.7, 85.3, 900, 600)))


class AreaTests(unittest.TestCase):
    def test_assign_inside_and_outside(self):
        A = areas.load()
        self.assertEqual(areas.assign(A, 27.7156, 85.3125), "Thamel")
        self.assertIsNone(areas.assign(A, 28.2, 83.98))          # Pokhara is in no Valley area


class StateTests(unittest.TestCase):
    def test_states(self):
        s = coverage.area_state
        self.assertEqual(s(0, 0, 0, False), "unsearched")
        self.assertEqual(s(0, 0, 0, True), "empty")
        self.assertEqual(s(10, 0, 0, True), "untouched")
        self.assertEqual(s(10, 2, 0, True), "partial")
        self.assertEqual(s(10, 5, 0, True), "reached")
        self.assertEqual(s(10, 1, 1, True), "reached")           # one customer is enough to call it reached


class LinkTests(unittest.TestCase):
    def test_solution_url(self):
        self.assertEqual(links.solution_url("gym"), "https://zennly.io/solutions/fitness/")
        self.assertTrue(links.solution_url("unknown").endswith("/solutions/"))

    def test_whatsapp_only_for_mobiles(self):
        self.assertEqual(links.whatsapp_url("+9779801234567"), "https://wa.me/9779801234567")
        self.assertIsNone(links.whatsapp_url("+97714441234"))     # landline
        self.assertIsNone(links.whatsapp_url(None))


class DbTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "t.db"

    def tearDown(self):
        self.tmp.cleanup()

    def test_migration_is_repeatable_and_keeps_rows(self):
        c = db.connect(str(self.path))
        db.upsert(c, {"business_name": "A", "source_url": "x://1", "lat": 27.7, "lng": 85.3})
        c.commit(); c.close()
        for _ in range(3):
            c = db.connect(str(self.path)); c.close()
        c = db.connect(str(self.path))
        self.assertEqual(c.execute("SELECT COUNT(*) FROM businesses").fetchone()[0], 1)
        self.assertEqual(c.execute("SELECT lat FROM businesses").fetchone()[0], 27.7)
        self.assertEqual(c.execute("SELECT status FROM businesses").fetchone()[0], "new")

    def test_mark_keeps_history_and_sets_status(self):
        c = db.connect(str(self.path))
        bid = db.upsert(c, {"business_name": "A", "source_url": "x://1"})
        mark.mark(c, bid, "contacted", channel="whatsapp")
        mark.mark(c, bid, "replied", note="asked for demo")
        self.assertEqual(c.execute("SELECT status FROM businesses WHERE id=?", (bid,)).fetchone()[0], "replied")
        self.assertEqual(c.execute("SELECT COUNT(*) FROM touches WHERE business_id=?", (bid,)).fetchone()[0], 2)
        with self.assertRaises(ValueError):
            mark.mark(c, bid, "bogus")

    def test_collector_rewrite_does_not_reset_status(self):
        c = db.connect(str(self.path))
        bid = db.upsert(c, {"business_name": "A", "source_url": "x://1"})
        mark.mark(c, bid, "contacted")
        db.upsert(c, {"business_name": "A", "source_url": "x://1", "lat": 27.7, "lng": 85.3})   # a re-scrape
        row = c.execute("SELECT status, lat FROM businesses WHERE id=?", (bid,)).fetchone()
        self.assertEqual((row["status"], row["lat"]), ("contacted", 27.7))


class DemoCoverageTests(unittest.TestCase):
    def test_demo_map_states(self):
        with tempfile.TemporaryDirectory() as d:
            path, n = demo.build(Path(d) / "demo.db")
            self.assertGreater(n, 50)
            conn = db.connect(str(path))
            data = {a["name"]: a for a in coverage.build_data(conn)["areas"]}
            self.assertEqual(data["Sanepa"]["state"], "reached")
            self.assertEqual(data["Patan"]["state"], "untouched")       # found, nobody contacted
            self.assertEqual(data["Boudha"]["state"], "unsearched")     # never looked
            html = coverage.render(path)
            self.assertIn("Thamel", html)
            self.assertNotIn("/*__DATA__*/null", html)


if __name__ == "__main__":
    unittest.main()
