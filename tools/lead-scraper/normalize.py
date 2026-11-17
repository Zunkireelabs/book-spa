import re
from urllib.parse import urlparse

DIAL = {"NP": "977", "IN": "91", "GB": "44", "US": "1", "CA": "1"}


def phone(raw, country=None):
    """Best-effort E.164. Handles +977 / 98xxxxxxxx (Nepal), 10-digit India/US/CA, UK leading 0."""
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", raw)
    if s.startswith("00"):
        s = "+" + s[2:]
    if s.startswith("+"):
        return s if 8 <= len(s) <= 16 else None
    code = DIAL.get(country or "")
    if not code:
        return None
    digits = s.lstrip("0") if country in ("NP", "IN", "GB") else s
    if country in ("US", "CA") and len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return f"+{code}{digits}" if 7 <= len(digits) <= 11 else None


def domain(url):
    if not url:
        return None
    if "//" not in url:
        url = "//" + url
    host = (urlparse(url).netloc or "").lower()
    return re.sub(r"^www\.", "", host) or None


def record(raw):
    """Turn a collector's raw dict into a DB-ready record."""
    r = dict(raw)
    r["business_name"] = (r.get("business_name") or "").strip()
    r["phone"] = phone(r.get("phone"), r.get("country"))
    r["domain"] = domain(r.get("website"))
    if r.get("email"):
        r["email"] = r["email"].strip().lower()
    return r
