# ZNLY-245 brief: import Sami's Fresha export (executor: bookx-60)

**Do not start until the lead sends "GO 245".** Owner gate: no import runs anywhere real until the release is live,
CP8 has passed, and the import has been rehearsed with a balanced reconciliation (local fresh org, then the prod copy).
The owner re-exports on Thu 19 Nov. The script must accept those files unchanged.

## Hard rules
- **Client data never enters git** (the repo is public, see ZNLY-203). The script reads the 4 CSVs from a path argument.
  Its outputs (SQL, reports) go to `temp_ss/client-data/` (gitignored). Only the script and its tests are committed,
  with no real rows in fixtures (made-up rows only).
- **One transaction per run.** Any error writes nothing, so a re-run is safe. Dry-run mode prints the reconciliation
  and rolls back.
- **The target org is given by slug.** The script refuses if the org is missing, isn't industry `beauty`, or already has
  customers / services / staff (no silent merge into existing data).
- **No logins and no passwords.** The owner or Sami's adds logins in each team member's Access section after the import.
- No payments, bookings, vouchers or memberships: none are in the export, and new bookings are entered in Zennly.

## Inputs (Fresha export, 15 Nov profile)
| File | Rows | Notes |
|---|---|---|
| export_customer_list_*.csv | 1,420 (+1 blank) | multiline-safe CSV parsing; skip the blank/footer row, counted as "skipped: empty" |
| employees_export_*.csv | 9 (6 Active, 2 Archived, 1 blank) | import Active only |
| export_service_list_*.csv | 53 (+1 blank) | 11 categories |
| product_list_export_*.csv | 96 (+1 blank) | stock in column "Sami's brow and lashes" / "Total Stock" |

## Mapping (owner-approved 17 Nov, see the ZNLY-245 comments)
**Customers → `customers`** (org_id, branch_id = the org's location)
- full_name = trim(First + ' ' + Last); a missing last name is fine (237 rows).
- phone: digits only, then E.164 by the real dialling code (+977 Nepal, +61, +44, +31, +1, +971 …). **Never force +977.**
  `country` comes from the dialling code.
- **Shared mobile (14 extra rows):** the customer added first in Fresha ("Added") keeps `phone`; later ones store it in
  `additional_phone` and get the tag `shared-mobile`. Nobody is merged. The DB index `customers_org_nphone_uniq` must never fire.
- No mobile (93): phone null, kept.
- email → email (blank → null). Gender only if Male/Female, else null. DOB only if a valid date.
- Referral Source → client_source. Tags → tags[] (+ `fresha-import`). Blocked=Yes → is_active false + notes "Blocked in
  Fresha: <reason>". created_at = Fresha "Added" if parseable.

**Staff → `therapists`** (Active only)
- name, phone (same normalization), email, position = Job Title as typed, is_service_staff = true, is_active = true.
- **gender is required (Male/Female) and is NOT in the export.** Owner, 17 Nov: all of Sami's active staff are Female.
  The script takes a `--staff-gender Female` argument applied to every active staff member (no per-name guessing),
  and refuses if it is missing or not Male/Female.
- Role mapping (for the later Access setup only, nothing written now): Owner → admin, High → manager, Basic → staff.
  Print it in the report for the owner.

**Services → `service_categories` + `services`**
- Categories: the 11 distinct names, display_order in file order. A service with a blank category goes under "Other",
  listed in the report.
- duration: "1h 30m" / "45m" / "3h" → minutes; anything that doesn't parse → refuse the run.
- price_npr = Retail Price, price_type fixed. **No tier prices**: Sami's sets them in Zennly; ZNLY-246 will flag them.
- bookable_online from "Online Booking" (Enabled → true). Tax is "No tax" everywhere, so nothing to map; if a later
  export has tax, refuse and report.
- Staff link: all active staff can do every service (Fresha "Available For: Everyone").

**Products → `products` + `product_variants` + stock**
- name, description, category, brand, price_npr = Full price (blank → refuse the run, listed), track_stock = true.
- Stock "∞" → track_stock = false. Negative → 0, listed in the report "count these". Stock goes in through the
  existing stock path (product_branch_stock / product_stock_movements as one "Opening stock (Fresha import)" movement),
  never as a raw number with no movement.
- 1 duplicate product name: both kept, the second gets " (2)", listed in the report.

## Reconciliation report (printed every run, saved to temp_ss/client-data/)
For each file: rows read = created + skipped (each skip with its reason). Shared-mobile pairs. Negative or ∞ stock list.
Blank-category services. Role list. Sums: total retail value of services and products (CSV sum = DB sum).
Before/after `scripts/qc-snapshot.sql`: only the target org's lines change; **every other org's lines are identical.**

## Proof (lead re-checks)
1. Unit tests: phone normalization (each country seen, shared-mobile ordering), duration parsing, CSV edge cases
   (multiline, quotes, blank row), all on made-up rows.
2. Dry run on a fresh local beauty org: the report balances.
3. Real run locally, then on screen: 10 random customers, 3 staff, 10 services, 10 products match the CSV. Search finds a
   foreign-number customer. A shared-mobile pair shows both people.
4. Re-run on the same org: refused ("org not empty"), nothing written.
5. Then the prod copy (CP8), same checks. Then, after GO from the owner, prod with Thursday's export.

Report ≤10 lines, label anything unproven "not verified". No commit until the lead accepts.
