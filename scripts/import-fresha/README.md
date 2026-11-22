# Fresha import (ZNLY-391, child of ZNLY-245)

Imports a Fresha export (Clients, Team members, Service Menu, Products, Appointments, Sales, Payments) into ONE beauty org.
**Client data never enters git**: the script reads the export from `--export <dir>`; reports go to `temp_ss/client-data/` (gitignored).

```
node scripts/import-fresha/import.mjs --export <dir> --org <slug> --admin-email <org admin> --staff-gender Female \
     --db postgresql://... [--phase setup|history|all] [--dry-run]
```
- Phase B (setup) refuses a non-empty org. Phase C (history) is idempotent: `bookings.client_request_id` = uuid5 of the Fresha appointment ref;
  payments by note `Fresha pay <no> inv <no> appt <ref>`, tips by `Fresha tip inv <no>`. A re-run or the final delta inserts only new refs and
  REPORTS changed ones (never overwrites). Money not attached to a booking is never imported and is re-listed on every run.
- Prerequisites on the org: `allow_staff_overlap = true`, `require_customer_phone = false` (mig 424/425), an active admin user.
- Phase C disables a named list of triggers inside its one transaction (list + reasons in `lib/history.js`), re-enables them and asserts
  `tgenabled = 'O'` before commit. Every imported booking is re-read and must equal Fresha price/discount/duration.
- Refuses a non-local DB host without `--allow-remote`.
- Tests: `npx vitest run scripts/import-fresha` (made-up rows only). Local rehearsal on a scratch DB copy:
  `scripts/import-fresha/test/rehearse-local.sh <export-dir>` (stubs the 424/425 flags, qc-snapshot before/after, `WRITER=1` adds the concurrent-writer proof);
  `test/spotcheck.mjs` compares a random sample with the CSV.
