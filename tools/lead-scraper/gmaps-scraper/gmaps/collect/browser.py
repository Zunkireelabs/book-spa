"""Drive a real Chromium window through Google Maps with Playwright.

Two jobs: `search` (scroll one results list and return the place links) and `place` (open one place and
return the raw data blob for parse.py). Playwright is imported only when a session starts, so the rest of
the system works without it installed.

NOT yet verified against the live site: the selectors and the data lookup follow the open-source reference
(gosom/google-maps-scraper) and standard Maps markup. Do the first run with --headed and a tiny --limit.
"""
import random
import re
import time
from urllib.parse import quote

# Adapted from gosom/google-maps-scraper gmaps/place.go: find the embedded string that starts with the )]}' guard.
GRAB_JS = """
(function () {
  if (!window.APP_INITIALIZATION_STATE || !window.APP_INITIALIZATION_STATE[3]) return null;
  const st = window.APP_INITIALIZATION_STATE[3];
  for (const key of Object.keys(st)) {
    const arr = st[key];
    if (Array.isArray(arr)) {
      for (const idx of [6, 5]) {
        const item = arr[idx];
        if (typeof item === 'string' && item.startsWith(")]}'")) return item;
      }
    }
  }
  return null;
})()
"""

BLOCK_MARKERS = ("/sorry/", "unusual traffic", "recaptcha")


class Blocked(Exception):
    """Google is asking for a CAPTCHA or refusing us. Stop the run; do not retry harder."""


class MapsSession:
    def __init__(self, headless=True, slow_mo_ms=0):
        self.headless, self.slow_mo = headless, slow_mo_ms
        self._pw = self._browser = self._ctx = self.page = None

    def __enter__(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise SystemExit(
                "Playwright is not available to this Python. Set it up once, in this folder:\n"
                "  python3 -m venv .venv\n  .venv/bin/python -m pip install -r requirements.txt\n"
                "  .venv/bin/python -m playwright install chromium\n"
                "then start the dashboard with:  .venv/bin/python -m gmaps open"
            )
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self.headless, slow_mo=self.slow_mo)
        self._ctx = self._browser.new_context(
            locale="en-US", timezone_id="Asia/Kathmandu", viewport={"width": 1280, "height": 900})
        self.page = self._ctx.new_page()
        self.page.set_default_timeout(20000)
        return self

    def __exit__(self, *exc):
        for closer in (self._ctx, self._browser):
            try:
                closer and closer.close()
            except Exception:
                pass
        if self._pw:
            self._pw.stop()

    # ---- helpers ----
    def _check_blocked(self):
        url = self.page.url.lower()
        if any(m in url for m in BLOCK_MARKERS):
            raise Blocked(f"Google showed a verification page ({self.page.url[:80]})")
        try:
            body = (self.page.inner_text("body", timeout=1500) or "").lower()
        except Exception:
            return
        if "unusual traffic" in body:
            raise Blocked("Google says it saw unusual traffic from this network")

    def _handle_consent(self):
        """EU-style cookie wall. Click the reject button if one is shown; harmless if not."""
        if "consent.google" not in self.page.url:
            return
        for label in ("Reject all", "Accept all"):
            btn = self.page.get_by_role("button", name=re.compile(label, re.I))
            if btn.count():
                btn.first.click()
                self.page.wait_for_load_state("domcontentloaded")
                return

    # ---- the two jobs ----
    def search(self, query, lat, lng, max_results=40, max_scrolls=12):
        """Place links for `query` around (lat, lng). Returns [(url, ...)] de-duplicated, in page order."""
        url = f"https://www.google.com/maps/search/{quote(query)}/@{lat},{lng},17z?hl=en"
        self.page.goto(url, wait_until="domcontentloaded")
        self._handle_consent()
        self._check_blocked()

        if "/maps/place/" in self.page.url:                       # Google jumped straight to the only result
            return [self.page.url.split("?")[0]]

        feed = self.page.locator('div[role="feed"]')
        try:
            feed.first.wait_for(timeout=12000)
        except Exception:
            return []                                              # no results list: nothing here

        seen, stale = [], 0
        for _ in range(max_scrolls):
            hrefs = self.page.eval_on_selector_all(
                'a[href*="/maps/place/"]', "els => els.map(e => e.href)")
            for h in hrefs:
                h = h.split("?")[0]
                if h not in seen:
                    seen.append(h)
            if len(seen) >= max_results:
                break
            before = len(seen)
            feed.first.evaluate("el => el.scrollTo(0, el.scrollHeight)")
            time.sleep(random.uniform(1.0, 2.0))
            if "reached the end" in (feed.first.inner_text() or "").lower():
                break
            stale = stale + 1 if len(seen) == before else 0
            if stale >= 2:
                break
        return seen[:max_results]

    def place(self, url, retries=2):
        """Raw data blob for one place page (a string for parse.parse_place), or None if it never appeared."""
        for attempt in range(retries + 1):
            self.page.goto(url, wait_until="domcontentloaded")
            self._check_blocked()
            try:
                self.page.wait_for_function(
                    "() => window.APP_INITIALIZATION_STATE && window.APP_INITIALIZATION_STATE[3]", timeout=15000)
            except Exception:
                if attempt < retries:
                    continue
                return None
            raw = self.page.evaluate(GRAB_JS)
            if raw:
                return raw
        return None
