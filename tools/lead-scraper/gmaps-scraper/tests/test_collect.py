import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gmaps import config  # noqa: E402,F401  (puts zennly-leads on the path)
import db  # noqa: E402
from gmaps.collect import parse, run  # noqa: E402
from gmaps.collect.browser import Blocked  # noqa: E402

AREA = {"name": "Testville", "lat": 27.7154, "lng": 85.3123, "radius_m": 100}   # one search cell


def blob(name="Glow Salon", cats=("Beauty salon",), phone="01-4410000", lat=27.7155, lng=85.3124,
         place_id="ChIJ-1", closed=False, website=None):
    """A hand-made payload with values at the positions parse.py reads. SYNTHETIC: not real Google data."""
    d = [None] * 200
    d[4] = [None, None, None, None, None, None, None, 4.6, 212]
    d[7] = [website] if website else None
    d[9] = [None, None, lat, lng]
    d[11] = name
    d[13] = list(cats)
    d[18] = f"{name}, Lazimpat, Kathmandu"
    d[27] = f"https://www.google.com/maps/place/?q=place_id:{place_id}"
    d[78] = place_id
    d[88] = ["CLOSED"] if closed else None
    d[178] = [[phone]] if phone else None
    jd = [None] * 7
    jd[6] = d
    return ")]}'\n" + json.dumps(jd)


class FakeSession:
    def __init__(self, results, pages, block_on=None):
        self.results, self.pages, self.block_on, self.search_calls = results, pages, block_on, 0

    def search(self, q, lat, lng):
        self.search_calls += 1
        if self.block_on == "search":
            raise Blocked("captcha")
        return self.results.get(q, [])

    def place(self, url):
        if self.block_on == url:
            raise Blocked("captcha")
        return self.pages.get(url)


class ParseTests(unittest.TestCase):
    def test_fields(self):
        p = parse.parse_place(blob(website="/url?q=https://glow.com.np/&sa=U"))
        self.assertEqual((p["name"], p["place_id"], p["reviews"], p["rating"]), ("Glow Salon", "ChIJ-1", 212, 4.6))
        self.assertEqual((p["lat"], p["lng"]), (27.7155, 85.3124))
        self.assertEqual(p["phone_raw"], "01-4410000")
        self.assertEqual(p["address"], "Lazimpat, Kathmandu")       # the repeated name is trimmed
        self.assertEqual(p["website"], "https://glow.com.np/")
        self.assertFalse(p["closed"])

    def test_closed_and_missing_phone(self):
        p = parse.parse_place(blob(closed=True, phone=None))
        self.assertTrue(p["closed"])
        self.assertIsNone(p["phone_raw"])

    def test_bad_payloads_raise_not_crash(self):
        for bad in ("[]", ")]}'\n[1,2,3]", blob(name="")):
            with self.assertRaises(ValueError):
                parse.parse_place(bad)

    def test_categorize(self):
        c = parse.categorize
        self.assertEqual(c(["Beauty salon"]), "salon")
        self.assertEqual(c(["Nail salon"]), "nail")
        self.assertEqual(c(["Barber shop"]), "barbershop")
        self.assertEqual(c(["Day spa"]), "spa")
        self.assertEqual(c(["Gym"]), "gym")
        self.assertIsNone(c(["Restaurant"]))
        self.assertIsNone(c([]))


class CollectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(str(Path(self.tmp.name) / "t.db"))

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def go(self, session, **kw):
        kw.setdefault("sleep", lambda s: None)
        kw.setdefault("log", lambda *a: None)
        return run.collect_area(self.conn, AREA, ["salon"], session, all_areas=[AREA], **kw)

    def pages(self):
        return {
            "u/glow": blob("Glow Salon", place_id="P1", phone="9801234567"),
            "u/pizza": blob("Pizza Corner", cats=("Restaurant",), place_id="P2", phone="9800000001"),
            "u/shut": blob("Old Spa", cats=("Spa",), place_id="P3", closed=True, phone="9800000002"),
            "u/nophone": blob("Quiet Barber", cats=("Barber shop",), place_id="P4", phone=None),
        }

    def test_saves_only_wanted_places(self):
        s = self.go(FakeSession({"salon": ["u/glow", "u/pizza", "u/shut", "u/nophone"]}, self.pages()))
        self.assertEqual((s["new"], s["irrelevant"], s["closed"], s["no_phone"]), (2, 1, 1, 1))
        rows = {r["business_name"]: r for r in self.conn.execute("SELECT * FROM businesses")}
        self.assertEqual(set(rows), {"Glow Salon", "Quiet Barber"})
        g = rows["Glow Salon"]
        self.assertEqual((g["phone"], g["category"], g["area"], g["status"]), ("+9779801234567", "salon", "Testville", "new"))
        self.assertEqual(g["reviews_count"], 212)

    def test_second_run_skips_searched_cells_and_known_places(self):
        sess = FakeSession({"salon": ["u/glow"]}, self.pages())
        self.go(sess)
        again = self.go(sess)
        self.assertEqual((again["searches"], again["skipped_cells"], again["new"]), (0, 1, 0))
        forced = self.go(sess, force=True)
        self.assertEqual((forced["known"], forced["new"]), (1, 0))      # place already saved, not re-opened

    def test_limit_stops_and_cell_stays_open_for_next_time(self):
        sess = FakeSession({"salon": ["u/glow", "u/nophone"]}, self.pages())
        s = self.go(sess, limit=1)
        self.assertTrue(s["hit_limit"])
        self.assertEqual(s["new"], 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cell_searches").fetchone()[0], 0)
        s2 = self.go(sess, limit=5)                                     # picks up where it stopped
        self.assertEqual(s2["new"], 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cell_searches").fetchone()[0], 1)

    def test_shared_phone_different_salons_stay_separate(self):
        pages = {"u/a": blob("Lotus Beauty Parlour", place_id="A", phone="9801112223"),
                 "u/b": blob("Himalayan Hair Studio", place_id="B", phone="9801112223", lat=27.7300, lng=85.3300)}
        s = self.go(FakeSession({"salon": ["u/a", "u/b"]}, pages))
        self.assertEqual((s["new"], s["merged"]), (2, 0))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM businesses").fetchone()[0], 2)

    def test_google_result_merges_into_matching_osm_row_and_keeps_status(self):
        osm_id = db.upsert(self.conn, {"business_name": "Glow Salon", "country": "NP", "source_url": "osm://1",
                                       "lat": 27.7156, "lng": 85.3125, "category": "salon"})
        self.conn.execute("UPDATE businesses SET status='contacted' WHERE id=?", (osm_id,))
        self.conn.commit()
        s = self.go(FakeSession({"salon": ["u/glow"]}, self.pages()))
        self.assertEqual((s["new"], s["merged"]), (0, 1))
        row = self.conn.execute("SELECT * FROM businesses").fetchall()
        self.assertEqual(len(row), 1)
        self.assertEqual((row[0]["status"], row[0]["phone"], row[0]["google_place_id"]), ("contacted", "+9779801234567", "P1"))

    def test_blocked_stops_cleanly_and_records_nothing_for_that_cell(self):
        s = self.go(FakeSession({"salon": ["u/glow"]}, self.pages(), block_on="u/glow"))
        self.assertTrue(s["blocked"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cell_searches").fetchone()[0], 0)

    def test_unreadable_place_is_counted_not_fatal(self):
        s = self.go(FakeSession({"salon": ["u/missing", "u/glow"]}, self.pages()))
        self.assertEqual((s["errors"], s["new"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
