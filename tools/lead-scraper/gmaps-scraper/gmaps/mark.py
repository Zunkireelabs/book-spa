"""Record what happened with a lead. Every touch is kept; the lead's status is the latest one."""
from datetime import datetime, timezone

from . import config


def mark(conn, business_id, status, channel=None, note=None):
    if status not in config.STATUSES:
        raise ValueError(f"status must be one of {', '.join(config.STATUSES)}")
    row = conn.execute("SELECT business_name FROM businesses WHERE id=?", (business_id,)).fetchone()
    if not row:
        raise LookupError(f"no business with id {business_id}")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO touches (business_id, touched_at, channel, outcome, note) VALUES (?,?,?,?,?)",
        (business_id, now, channel, status, note),
    )
    conn.execute("UPDATE businesses SET status=?, last_updated=? WHERE id=?", (status, now, business_id))
    conn.commit()
    return row["business_name"]
