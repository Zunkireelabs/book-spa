import csv

QUERY = """
SELECT b.business_name, b.category, b.country, b.city, b.address, b.phone, b.email, b.website, b.facebook, b.instagram,
       COALESCE(b.platform_used, 'none detected') AS platform_used,
       (SELECT COUNT(*) FROM branches br WHERE br.business_id = b.id) AS branch_count,
       (SELECT GROUP_CONCAT(COALESCE(br.city, '') || ': ' || br.address, ' | ')
          FROM branches br WHERE br.business_id = b.id) AS branches,
       b.source_url, b.first_seen
FROM businesses b ORDER BY b.country, b.city, b.business_name
"""


def to_csv(conn, path="leads.csv"):
    rows = conn.execute(QUERY).fetchall()
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(rows[0].keys() if rows else [d[0] for d in conn.execute(QUERY).description])
        w.writerows([tuple(r) for r in rows])
    return len(rows)
