"""Free social/website finder: searches DuckDuckGo (HTML) for "<name> <city> facebook" and saves the business's
Facebook page, Instagram profile and own website. No key, no cost. Deliberately slow (~1 query / 4 s) and stops if blocked.
Usage: python3 -u social_search.py [country=NP] [limit]
Matching rule: a result is accepted only if a distinctive word from the business name appears in its URL or title.
"""
import html
import re
import sys
import time
import urllib.parse
import urllib.request

import db
import normalize

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"
GENERIC = {"salon", "saloon", "unisex", "beauty", "parlour", "parlor", "spa", "studio", "hair", "nail", "nails", "the", "and",
           "makeup", "academy", "gym", "fitness", "center", "centre", "house", "care", "pvt", "ltd", "massage", "barber", "shop", "cuts", "wellness"}
SKIP_SITES = ("facebook.com", "instagram.com", "yandex.", "tripadvisor", "yelp.", "justdial", "foursquare", "google.", "youtube.", "tiktok",
              "linkedin", "twitter.com", "x.com", "pinterest", "wikipedia", "bsky.app", "linktr.ee", "linktree", "beacons.ai", "wa.me", "whatsapp", "fresha.com", "booksy", "treatwell", "yellowpages", "nepalyellow")
BAD_FB = {"posts", "photos", "reel", "reels", "videos", "watch", "groups", "events", "p", "story.php", "permalink.php", "public", "sharer", "share"}
BAD_IG = {"p", "reel", "reels", "explore", "stories", "tv"}


def search(q):
    data = urllib.parse.urlencode({"q": q}).encode()
    req = urllib.request.Request("https://html.duckduckgo.com/html/", data, {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        h = r.read().decode("utf-8", "ignore")
    if "anomaly" in h.lower() or "captcha" in h.lower():
        raise RuntimeError("blocked")
    out = []
    for u, t in re.findall(r'class="result__a" href="([^"]+)">(.*?)</a>', h):
        u = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("uddg", [u])[0]
        out.append((u, re.sub("<.*?>", "", html.unescape(t))))
    return out


def tokens(name):
    return [w for w in re.findall(r"[a-z0-9]{3,}", name.lower()) if w not in GENERIC]


COUNTRY_TLD = ('.np',)  # Nepal; other countries accept any TLD


def country_ok(host):
    return host.endswith(COUNTRY_TLD) or not host.endswith(('.za', '.pk', '.bd'))


def classify(name, results):
    toks = tokens(name) or re.findall(r"[a-z0-9]{3,}", name.lower())
    found = {}
    for u, title in results:
        p = urllib.parse.urlparse(u)
        host, parts = p.netloc.lower(), [x for x in p.path.split("/") if x]
        text = (u + " " + title).lower()
        if not any(t in text for t in toks):
            continue
        if "facebook.com" in host and parts and parts[0].lower() not in BAD_FB and "fb" not in found:
            found["fb"] = f"https://www.facebook.com/{parts[0]}"
        elif "instagram.com" in host and parts and parts[0].lower() not in BAD_IG and "ig" not in found:
            found["ig"] = f"https://www.instagram.com/{parts[0]}"
        elif (not any(s in host for s in SKIP_SITES) and "web" not in found
              and (country_ok(host) and any(t in host for t in toks))):
            found["web"] = f"{p.scheme}://{p.netloc}"
    return found


def main(country="NP", limit=None):
    conn = db.connect()
    rows = conn.execute(
        "SELECT id,business_name,city FROM businesses WHERE country=? AND facebook IS NULL AND instagram IS NULL AND social_checked IS NULL "
        "ORDER BY (platform_used='Chairlyo') DESC, (platform_used IS NOT NULL) DESC, (phone IS NOT NULL) DESC"
        + (f" LIMIT {int(limit)}" if limit else ""), (country,)).fetchall()
    print(f"searching {len(rows)} businesses")
    found_n = 0
    for i, r in enumerate(rows, 1):
        try:
            f = classify(r["business_name"], search(f"{r['business_name']} {r['city'] or ''} {'Nepal' if country == 'NP' else ''} facebook instagram"))
        except RuntimeError:
            print("blocked by search engine, stopping; re-run later to continue"); break
        except Exception as e:
            print("error:", e); time.sleep(20); continue
        web = f.get("web")
        conn.execute(
            "UPDATE businesses SET facebook=COALESCE(facebook,?), instagram=COALESCE(instagram,?), website=COALESCE(website,?),"
            " domain=COALESCE(domain,?), social_checked=datetime('now') WHERE id=?",
            (f.get("fb"), f.get("ig"), web, normalize.domain(web), r["id"]))
        found_n += bool(f)
        if i % 20 == 0:
            conn.commit(); print(f"{i}/{len(rows)} searched, {found_n} with something found", flush=True)
        time.sleep(4)
    conn.commit()
    print(f"done: {found_n} of {len(rows)} had a Facebook/Instagram/website match")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "NP", sys.argv[2] if len(sys.argv) > 2 else None)
