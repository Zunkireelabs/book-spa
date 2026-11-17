"""Free website enricher (stdlib only).
For every business with a website: fetch homepage + contact page, extract email/phone,
and tag which booking software the site uses (from config.yaml `platforms`).
Usage: python3 enrich.py [limit]
"""
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin

import yaml

import db
import normalize

EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,24}\b")
BAD_EMAIL = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", "sentry", "example.", "wixpress", "domain.com", "yourname", "segmenter", "noreply", "no-reply")
TEL = re.compile(r'href=["\']tel:([^"\']+)', re.I)
CONTACT = re.compile(r'href=["\']([^"\']*contact[^"\']*)["\']', re.I)
PLATFORMS = yaml.safe_load(open("config.yaml"))["platforms"]


def fetch(url, timeout=12):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; zennly-leads/0.1)"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if "html" not in r.headers.get("Content-Type", ""):
                return ""
            return r.read(600_000).decode("utf-8", "ignore")
    except Exception:
        return ""


def analyze(website, country):
    base = website if website.startswith("http") else "https://" + website
    html = fetch(base)
    if not html:
        return None
    m = CONTACT.search(html)
    if m:
        html += fetch(urljoin(base, m.group(1)))
    emails = [e.lower() for e in EMAIL.findall(html) if not any(b in e.lower() for b in BAD_EMAIL)]
    low = html.lower()
    platform = next((label for key, label in PLATFORMS.items() if key in low), None)
    tel = next((normalize.phone(t, country) for t in TEL.findall(html) if normalize.phone(t, country)), None)
    return {"email": emails[0] if emails else None, "phone": tel, "platform": platform}


def main(limit=None):
    conn = db.connect()
    rows = conn.execute(
        "SELECT id,website,country FROM businesses WHERE website IS NOT NULL AND enriched_at IS NULL"
        + (f" LIMIT {int(limit)}" if limit else "")
    ).fetchall()
    print(f"enriching {len(rows)} sites")
    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(lambda r: analyze(r["website"], r["country"]), rows))
    got = 0
    for r, res in zip(rows, results):
        conn.execute("UPDATE businesses SET enriched_at=datetime('now') WHERE id=?", (r["id"],))
        if res:
            got += 1
            conn.execute(
                "UPDATE businesses SET email=COALESCE(NULLIF(email,''),?), phone=COALESCE(NULLIF(phone,''),?),"
                " platform_used=COALESCE(?,platform_used) WHERE id=?",
                (res["email"], res["phone"], res["platform"], r["id"]),
            )
    conn.commit()
    print(f"reachable: {got}/{len(rows)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
