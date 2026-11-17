# Zennly coverage system

Shows on a map **where Zennly has reached and where it has not**, per area, and keeps track of every business we find and every message we send.
It uses the same `leads.db` as the older scripts in the parent folder. Standard-library Python only, nothing to install.

## Open it

Run these from this folder (`zennly-leads/gmaps-scraper/`):

```bash
python3 -m gmaps open --demo     # fake data: see how it works, touches nothing real
python3 -m gmaps open            # your real leads.db
```

A browser tab opens at `http://127.0.0.1:8780/`. Refresh the page after any change to see it. Use that address, not the saved `.html` file, because the map pictures are refused on `file://` pages.

On the map: green = reached, amber = partly, red = found but nobody contacted, grey dashed = never searched. The buttons at the top switch between all, where we are, and where we are not. The card on the left searches areas and cities. Click a pin for the business, its phone, a WhatsApp link and the matching Zennly solutions page.

## Everything from the browser

`python3 -m gmaps open` opens the dashboard. The left sidebar has:
- **Overview**: charts and key numbers.
- **Find places**: pick a place (or look up and save a new one anywhere in Nepal), tick what to look for, press *Start search*, watch the log, press *Stop* any time. *Preview plan* shows what it would do without opening anything. Starting a real search needs Playwright installed once (see "First live run"); until then the button is greyed out.
- **Zennly customers**: paste or upload your customers (name, phone). Phone numbers already in the list become customers; the rest are added.
- **Ours / To contact / In progress / All leads**: the lists, with search, filters, a status dropdown per row, WhatsApp links and CSV export.
- **Runs**: the search history.

Anything that changes data needs the one-time code the server puts in the page, so other websites cannot trigger it.

## Everyday commands (the same things from the terminal)

| Command | What it does |
|---|---|
| `python3 -m gmaps areas` | the named areas and how many search cells each needs |
| `python3 -m gmaps coverage [--demo]` | per-area table in the terminal, and writes `out/coverage_map.html` |
| `python3 -m gmaps collect --area Lazimpat --dry-run` | show what a collection would do; opens nothing |
| `python3 -m gmaps collect --area Lazimpat --query salon --limit 20 --headed` | **finds new businesses** with Chrome (see "First live run") |
| `python3 -m gmaps list --area Thamel` | the businesses that are not ours yet, with phones: your call list |
| `python3 -m gmaps assign` | put every business that has coordinates into its named area |
| `python3 -m gmaps mark 123 contacted --note "no answer"` | record a touch; the pin turns green |
| `python3 -m gmaps import-customers customers.csv` | mark Zennly's own customers (columns: `name, phone, lat, lng`) |
| `python3 -m unittest discover -s tests` | run the tests |

Statuses: `new → contacted → replied → demo → customer`, or `no`. Every change is kept in the `touches` table, so you can see the history; the lead only shows its latest status.

## How it links to Zennly

- **Where we are:** a Zennly customer or any contacted lead counts as "reached". Import the customer list once with `import-customers`. (There is no Zennly customer list in this project yet; `platform_customers.csv` in the parent folder is businesses using *competitor* software, i.e. leads.)
- **Which page to send:** each business type maps to its `/solutions/{slug}/` page on zennly.io (`gmaps/links.py`), shown in every pin and ready for the first message.
- **WhatsApp:** `wa.me` links are only built for mobile numbers (98/97...), not landlines.

## What exists and what does not yet

Built and tested: schema upgrade (`db.py`), areas and search-cell grid, coverage logic and map, local server, status tracking, customer import, demo data.

Also built: the collector (`gmaps/collect/`), with name-aware matching so a shared phone number never merges two different salons, and a save-nothing-for-a-cell-that-was-cut-short rule so runs can be stopped and resumed. It is tested offline with a stand-in browser and hand-made data.

**First live run (not done yet):** the Google page reading follows the open-source reference but has **never been run against the real site**, so the selectors may need one adjustment.
```bash
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -m playwright install chromium
.venv/bin/python -m gmaps collect --area Lazimpat --query salon --limit 3 --headed    # watch it work, 3 businesses
python3 -m gmaps list --area Lazimpat                                         # check the phones by hand on Google Maps
```
If Google shows a CAPTCHA the run stops by itself. Wait a few hours and do not retry in a loop. Collecting is against Google's terms of service; keep volumes small.

**Not built yet:**
1. Coordinates for the existing 910 Kathmandu rows. `collectors/osm.py` now saves them, but it has not been re-run, so those rows are not on the map. (Rows the collector saves already have coordinates.)
2. The optional, off-by-default Google Places phone fill-in with a spending cap.
3. A real Zennly customer list, and automatic reply tracking.

## Files

```
gmaps/            the code (cli, coverage, grid, areas, serve, mark, customers, links, demo)
gmaps/templates/  coverage_map.html  (the map page)
inputs/           pilot_kathmandu.json  (named areas, search terms, cell size)
tests/            test_system.py
reference/        open-source scrapers cloned for study only (gitignored, never run)
mockups/          the design mockup
PLAN.md ...       planning notes
```
