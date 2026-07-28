-- One-time cleanup: simplify the verbose notes left on rows already inserted
-- by supabase/data-import-nuad-membership-history.sql (Nuad Thai Club
-- membership history backfill).
--
-- The import script originally wrote notes like:
--   "Imported from historical Excel (row 92). Original code: NT_PCM_0073_8042.
--    'Date of Birth' field (raw, unverified, not a confirmed DOB): '28TH SEP'.
--    Remark: FRONT TEAM. Other sheet notes: CARD  DONE."
-- for memberships, and:
--   "Historical initial deposit imported from Excel (row 92)."
-- for the matching deposit transaction. Both read as internal import
-- metadata when shown on the membership card / transaction history, so this
-- trims them down to just the useful bit (the DOB, if the sheet had one) --
-- matching the generator script, which was fixed to write the same shape for
-- any future run (e.g. against production).
--
-- Staging-only: this data was imported into staging only (see CLAUDE.md --
-- staging and production are separate databases and never share rows), so
-- there is nothing to run against production for this cleanup. Safe to
-- run more than once -- after the first run no row still matches the
-- 'Imported from historical Excel (row%' / 'Historical initial deposit...'
-- prefixes, so later runs are no-ops.

UPDATE public.memberships
SET notes = CASE
  WHEN notes ~ $rex$'Date of Birth' field \(raw, unverified, not a confirmed DOB\): '([^']*)'$rex$
    THEN 'DOB: ' || substring(notes from $rex$'Date of Birth' field \(raw, unverified, not a confirmed DOB\): '([^']*)'$rex$)
  ELSE NULL
END
WHERE notes LIKE 'Imported from historical Excel (row%';

UPDATE public.membership_transactions
SET notes = NULL
WHERE notes LIKE 'Historical initial deposit imported from Excel (row%';
