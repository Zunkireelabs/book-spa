# Data Schema & Search Plan

## Search matrix (Phase 1)
Each row is one Apify run, with `locationQuery = "<area>, Kathmandu, Nepal"`.

| Priority | Search term | Zennly solution page |
|---|---|---|
| 1 | salon | /solutions/salon/ |
| 1 | beauty parlour | /solutions/salon/ |
| 1 | spa | /solutions/spa/ |
| 2 | barbershop | /solutions/barbershop/ |
| 2 | nail studio | /solutions/nail/ |
| 2 | makeup artist | /solutions/bridal-makeup/ |
| 3 | tattoo studio | /solutions/tattoo/ |
| 3 | gym / fitness | /solutions/fitness/ |

Areas, to get past the ~120 results cap per search: Thamel, Lazimpat, Baneshwor, Koteshwor, Baluwatar, Maharajgunj, Boudha, Patan/Lalitpur, Bhaktapur, Kalanki, Chabahil.

Run order: Priority 1 terms × all areas first, then review results before running priority 2 and 3.

## Raw fields kept from Apify
`placeId`, `title`, `categoryName`, `phone`, `address`, `neighborhood`, `website`, `url`, `totalScore`, `reviewsCount`, `openingHours`, `location (lat/lng)`, `permanentlyClosed`, `temporarilyClosed`

## Cleaned CSV columns (`data/kathmandu_leads.csv`)
| Column | Notes |
|---|---|
| place_id | dedupe key |
| name | |
| category | from Google, mapped to a Zennly solution slug |
| solution_slug | salon, spa, barbershop, … |
| phone_raw | as scraped |
| phone_e164 | `+977…` |
| phone_type | mobile / landline |
| whatsapp_link | `https://wa.me/977…` (mobile only) |
| address / area | |
| website | blank means no site |
| maps_url | |
| rating / reviews | |
| score | see below |
| status | new / contacted / replied / demo / customer / no |
| contacted_on / notes | filled by hand |

## Lead scoring (simple, 0–100)
- Reviews: 50+ → +30, 20–49 → +20, 5–19 → +10
- Rating ≥ 4.0 → +15
- Mobile number (reachable on WhatsApp) → +25
- No website → +15 (they need an online presence and booking)
- Multiple branches (same name, several places) → +15

Contact the highest scores first.

## Filters
Drop: permanently or temporarily closed, no phone, and categories unrelated to our solutions.
