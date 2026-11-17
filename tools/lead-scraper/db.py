import sqlite3
from datetime import datetime, timezone

DB_PATH = "leads.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT NOT NULL,
    website TEXT,
    domain TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    country TEXT,
    category TEXT,
    platform_used TEXT,
    source_url TEXT,
    google_place_id TEXT,
    first_seen TEXT,
    last_updated TEXT,
    enriched_at TEXT,
    facebook TEXT,
    instagram TEXT,
    social_checked TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_place ON businesses(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_domain ON businesses(domain);
CREATE INDEX IF NOT EXISTS ix_phone ON businesses(phone);

CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    branch_name TEXT,
    address TEXT,
    phone TEXT,
    city TEXT,
    UNIQUE(business_id, address)
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    started_at TEXT,
    records_found INTEGER
);
"""

FIELDS = ["business_name", "website", "domain", "phone", "email", "address", "city",
          "country", "category", "platform_used", "source_url", "google_place_id", "facebook", "instagram",
          "lat", "lng", "rating", "reviews_count"]

# Added after the first release; applied idempotently by migrate() so existing databases upgrade in place.
# area/score/status are deliberately NOT in FIELDS: collectors must never overwrite a hand-set status.
NEW_COLUMNS = {
    "lat": "REAL", "lng": "REAL", "area": "TEXT", "rating": "REAL",
    "reviews_count": "INTEGER", "score": "INTEGER", "status": "TEXT DEFAULT 'new'",
}

NEW_TABLES = """
CREATE TABLE IF NOT EXISTS cell_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    area TEXT,
    cell_lat REAL,
    cell_lng REAL,
    query TEXT,
    searched_at TEXT,
    results_found INTEGER
);
CREATE INDEX IF NOT EXISTS ix_cell ON cell_searches(cell_lat, cell_lng);

CREATE TABLE IF NOT EXISTS touches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    touched_at TEXT,
    channel TEXT,
    outcome TEXT,
    note TEXT
);
CREATE INDEX IF NOT EXISTS ix_touch_biz ON touches(business_id);

CREATE TABLE IF NOT EXISTS api_usage (
    day TEXT,
    service TEXT,
    calls INTEGER DEFAULT 0,
    est_cost_usd REAL DEFAULT 0,
    PRIMARY KEY (day, service)
);
"""


def migrate(conn):
    """Idempotent schema upgrade. Safe to call on every connect."""
    have = {r["name"] for r in conn.execute("PRAGMA table_info(businesses)")}
    for col, ddl in NEW_COLUMNS.items():
        if col not in have:
            conn.execute(f"ALTER TABLE businesses ADD COLUMN {col} {ddl}")
    conn.executescript(NEW_TABLES)
    conn.execute("CREATE INDEX IF NOT EXISTS ix_geo ON businesses(lat, lng)")
    conn.execute("UPDATE businesses SET status='new' WHERE status IS NULL")
    conn.commit()


def connect(path=DB_PATH):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    migrate(conn)
    return conn


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _find(conn, rec):
    """Dedupe order: google_place_id, then domain, then phone."""
    for col in ("google_place_id", "source_url", "domain", "phone"):
        if rec.get(col):
            row = conn.execute(f"SELECT id FROM businesses WHERE {col}=?", (rec[col],)).fetchone()
            if row:
                return row["id"]
    return None


def upsert(conn, rec, into_id=None, force_new=False):
    """Insert or merge a normalized record; fills blanks, never overwrites with empty. Returns business id.

    into_id   merge into this exact row (caller already decided it is the same business)
    force_new insert a separate row even if phone/domain match, e.g. two salons sharing one owner's number
    """
    now = _now()
    bid = into_id if into_id is not None else (None if force_new else _find(conn, rec))
    if bid is None:
        cols = [f for f in FIELDS if rec.get(f)]
        conn.execute(
            f"INSERT INTO businesses ({','.join(cols)},first_seen,last_updated) "
            f"VALUES ({','.join('?' * len(cols))},?,?)",
            [rec[c] for c in cols] + [now, now],
        )
        bid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    else:
        sets = [f for f in FIELDS if rec.get(f)]
        if sets:
            conn.execute(
                "UPDATE businesses SET " + ",".join(f"{c}=COALESCE(NULLIF({c},''),?)" for c in sets)
                + ",last_updated=? WHERE id=?",
                [rec[c] for c in sets] + [now, bid],
            )
    if rec.get("address"):
        conn.execute(
            "INSERT OR IGNORE INTO branches (business_id,branch_name,address,phone,city) VALUES (?,?,?,?,?)",
            (bid, rec.get("branch_name") or rec["business_name"], rec["address"], rec.get("phone"), rec.get("city")),
        )
    return bid


def log_run(conn, source, count):
    conn.execute("INSERT INTO runs (source,started_at,records_found) VALUES (?,?,?)", (source, _now(), count))
    conn.commit()
