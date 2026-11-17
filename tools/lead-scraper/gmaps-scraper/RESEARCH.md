# Research: existing Google Maps scrapers (2026-10-29)

Findings are from web search only. Nothing below has been installed or tested. Check repo activity and licence before relying on any option.

## Option A: Apify actors (hosted, called from Python with `apify-client`)
- `compass/crawler-google-places`: the official, most used actor. Listed from about $1.50 per 1,000 places, with add-ons billed separately (contact details about $0.002 per place, reviews and images about $0.001 each). Third-party guides quote $2–5 per 1,000 depending on plan tier, so check the live price.
- Many community "lead" actors exist (e.g. `aleksandar77/google-maps-lead-scraper` at about $3 per 1,000, with emails and socials). Some are marked as under maintenance.
- Pros: no proxies or blocking to manage, Python client ready, handles scale. Cons: pay per place; free tier is limited.

## Option B: Open-source on GitHub (self-hosted, free)
- `gosom/google-maps-scraper`: about 3.9k stars. Written in Go, runs as a CLI or web UI, with Docker and prebuilt binaries. Extracts name, address, phone, website, rating, reviews, lat/lng and email. Not Python.
- `omkarcloud/google-maps-scraper`: about 2.8k stars, Python. Not verified.
- Other smaller repos exist (e.g. DeDucKnight, Polliog). Quality unknown.
- Pros: free, no per-place cost. Cons: Google blocks and changes its page layout, so you handle proxies, maintenance and breakage yourself.

## Recommendation
Start with Apify `compass/crawler-google-places` for the pilot. Kathmandu has maybe a few thousand relevant places, so the cost is a few dollars. Keep `gosom` as the free fallback if cost becomes a problem. The scraper code stays thin, so we can swap sources.

## Legal and practical note
Scraping public business listings (name, phone, address) for B2B outreach is common, but it can breach Google's terms of service. Keep outreach low-volume and personal, and honour opt-outs.

## Coverage tracking: your main motive
The goal is to know, area by area, where we have reached out and where we have not. The scraper is only the input.

Design (add to the CSV or `leads.db`):
- Every lead gets an `area` (Patan, Thamel, Baneshwor, …). Use the address, then lat/lng as a fallback.
- Every lead has a `status`: new / contacted / replied / demo / customer / no.
- A coverage report per area × business type:

| Area | Found | Contacted | Replied | Customers | % reached |
|---|---|---|---|---|---|
| Patan | 84 | 31 | 6 | 1 | 37% |
| Thamel | 120 | 0 | 0 | 0 | 0% |

- "Where we haven't reached" is any area with a low % reached, or leads still marked `new`.
- Re-scrape each area every few months. New places come in as `new`, and existing ones keep their status because we dedupe on `place_id`.

Output: a simple `coverage.csv`, and later possibly an HTML page.
