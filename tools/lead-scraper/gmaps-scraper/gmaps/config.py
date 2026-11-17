"""Paths and constants. The system reads and writes the same leads.db as the older zennly-leads scripts."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # .../zennly-leads/gmaps-scraper
LEADS_DIR = ROOT.parent                            # .../zennly-leads  (db.py, normalize.py live here)
if str(LEADS_DIR) not in sys.path:
    sys.path.insert(0, str(LEADS_DIR))

LIVE_DB = LEADS_DIR / "leads.db"
DEMO_DB = ROOT / "demo.db"                         # fake data, so the live database is never touched by the demo
OUT_DIR = ROOT / "out"
AREAS_FILE = ROOT / "inputs" / "pilot_kathmandu.json"
CUSTOM_AREAS_FILE = ROOT / "inputs" / "custom_areas.json"   # places added from the dashboard

SITE_URL = "https://zennly.io"
DEFAULT_PORT = 8780

STATUSES = ("new", "contacted", "replied", "demo", "customer", "no")
REACHED = ("contacted", "replied", "demo", "customer", "no")   # we have been in touch, whatever the answer
