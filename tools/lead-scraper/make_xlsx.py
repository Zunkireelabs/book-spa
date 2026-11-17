"""Build platform_customers.xlsx: 'All' tab + one tab per booking platform, filters and frozen header."""
import sqlite3
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
import export

COUNTRY = {"NP": "Nepal", "IN": "India", "GB": "United Kingdom", "US": "United States", "CA": "Canada"}

conn = sqlite3.connect("leads.db"); conn.row_factory = sqlite3.Row
q = export.QUERY.replace("FROM businesses b ORDER BY", "FROM businesses b WHERE b.platform_used IS NOT NULL ORDER BY b.platform_used, ")
rows = [tuple(r) for r in conn.execute(q)]
head = [d[0] for d in conn.execute(q).description]
wb = Workbook(); wb.remove(wb.active)

def sheet(title, data):
    ws = wb.create_sheet(title[:31]); ws.append(head)
    ci = head.index("country")
    for r in data:
        r = list(r); r[ci] = COUNTRY.get(r[ci], r[ci]); ws.append(r)
    for c in ws[1]: c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F4E78")
    ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
    for col, w in zip("ABCDEFGHIJKLMNO", (32, 12, 14, 14, 40, 16, 28, 34, 34, 30, 16, 8, 50, 40, 20)): ws.column_dimensions[col].width = w

sheet("All", rows)
pi = head.index("platform_used")
for p in sorted({r[pi] for r in rows}): sheet(p, [r for r in rows if r[pi] == p])
pq = export.QUERY.replace("FROM businesses b ORDER BY", "FROM businesses b WHERE b.category LIKE 'pilates%' ORDER BY")
sheet("Pilates & Yoga", [tuple(r) for r in conn.execute(pq)])
nq = export.QUERY.replace("COALESCE(b.platform_used, 'none detected') AS platform_used",
    "CASE WHEN b.platform_used IS NOT NULL THEN b.platform_used WHEN b.website IS NOT NULL AND b.enriched_at IS NOT NULL THEN 'None found on website' WHEN b.website IS NOT NULL THEN 'Not checked' ELSE 'No website - unknown' END AS platform_used")
nq = nq.replace("FROM businesses b ORDER BY", "FROM businesses b WHERE b.country='NP' ORDER BY (b.platform_used IS NOT NULL), (b.phone IS NULL), ")
sheet("Nepal Prospects", [tuple(r) for r in conn.execute(nq)])
g = wb.create_sheet("Guide", 0)
for line in [
    ("Column", "Meaning"),
    ("country", "Nepal, India, United Kingdom (GB), United States (US), Canada (CA)"),
    ("category", "salon, spa, gym, pilates/yoga"),
    ("platform_used", "Booking software found for this business. 'None found on website' = site checked, nothing found. 'No website - unknown' = could not check."),
    ("facebook / instagram", "Public page links, where known. Blank = not found yet."),
    ("branch_count / branches", "Locations found under the same business"),
    ("source_url", "Where the record came from (OpenStreetMap, Fresha, Chairlyo site)"),
    ("Tabs", "One tab per software = businesses using it. 'Nepal Prospects' = all Nepal businesses, likeliest to need Zennly first."),
]: g.append(line)
g.column_dimensions["A"].width = 26; g.column_dimensions["B"].width = 120
for c in g[1]: c.font = Font(bold=True)
wb.save("platform_customers.xlsx"); print(len(rows), "rows,", len(wb.sheetnames), "tabs:", wb.sheetnames)
