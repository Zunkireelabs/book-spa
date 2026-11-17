# Zennly Lead Scraper: Plan

Status: planning only. Nothing built yet.

## Goal
Find salons and similar beauty/wellness businesses in Kathmandu from Google Maps, collect their phone numbers and basic details, then contact them to pitch Zennly.

## Approach
Python script that calls an Apify Google Maps actor (`compass/crawler-google-places`) through the `apify-client` package. Apify does the scraping, so we don't scrape Google ourselves. The output is saved to CSV.

## Phase 1: Scrape (Kathmandu only)
1. Create an Apify account and get an API token. Store it in `lead-scraper/.env` as `APIFY_TOKEN`. The file is gitignored and the token is never committed.
2. Search terms (one run each): `salon`, `beauty parlour`, `barbershop`, `spa`, `nail studio`, `tattoo studio`, `makeup artist`, `gym`/`fitness` (optional, matches the Zennly solution pages).
3. Location: `Kathmandu, Nepal`. Later we can split by area (Thamel, Baneshwor, Lazimpat, Patan, Bhaktapur) to get past Google's ~120 results per search.
4. Fields to keep: name, category, phone, address, website, Google Maps URL, rating, review count, opening hours.
5. Cost control: first run with `maxCrawledPlacesPerSearch = 20` to check data quality and cost. Then scale up.

## Phase 2: Clean the data
- Drop rows with no phone number.
- Normalise numbers to `+977…`. Separate mobile (98/97…) from landlines (01…).
- De-duplicate by phone number and by Maps place ID, since the same place shows up across searches.
- Tag each lead:
  - has a website or not
  - rating and review count (more reviews means a busier business)
  - category, which maps to the matching `/solutions/{slug}/` page
- Output: `data/kathmandu_leads.csv`

## Phase 3: Follow-up (the "then" part)
Decide the channel. This is the open question.
- **WhatsApp or call:** most natural in Nepal. Do it manually at first, from a prioritised list.
- **SMS:** possible later through a bulk SMS provider.
- Message template per category, pointing to the matching solution page.
- Track status per lead in the CSV or a sheet: `new → contacted → replied → demo → customer / no`.
- Keep outreach small and personal, not mass blasts. This avoids spam flags and keeps replies high.

## Folder layout (when we build)
```
lead-scraper/
  PLAN.md
  .env               # APIFY_TOKEN (gitignored)
  .gitignore         # .env, data/
  requirements.txt   # apify-client, pandas, python-dotenv
  scrape.py          # Phase 1
  clean.py           # Phase 2
  data/
    raw/             # Apify JSON per run
    kathmandu_leads.csv
```

## Detail docs
- `RESEARCH.md`: existing Apify actors and GitHub scrapers, pricing, coverage-tracking design
- `DATA_SCHEMA.md`: search matrix, areas, CSV columns, lead scoring, filters
- `OUTREACH.md`: channel, message template, follow-up cadence, tracking

## Working defaults (change any of these)
1. Business types: salon, beauty parlour and spa first, then the rest.
2. Channel: WhatsApp first, call second.
3. Folder stays in this repo for now. It is gitignored for secrets and data.

## Still to confirm
- Do you have an Apify account and token? The free tier is enough for the 20-result test.

## Next step
Answer the open questions, then build `scrape.py` and do a 20-result test run.
