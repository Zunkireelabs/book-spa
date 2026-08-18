-- Backfill public.schema_migrations with every version already applied in
-- production, as of 2026-08-13 (queried directly from the live prod ledger —
-- see supabase/baseline/schema.sql for how that dump was taken).
--
-- Local dev seeds from ./schema.sql (full current prod schema) then this file,
-- so scripts/migrate-apply.sh treats all 60 historical versions as already
-- applied and only replays genuinely NEW migrations locally — same pattern as
-- migration 027's original in-repo backfill, just extended to cover every
-- version, including the 13 that were applied directly in the Supabase
-- dashboard SQL editor and only reconstructed into git afterward (045-047,
-- 052-055, 058-063 — see those files' header comments).
--
-- '013' and '045'-'047' gaps: '013' never existed (baseline predates numbering
-- past '012'). '056'/'057' never existed either — production's ledger jumps
-- straight from '055' to '058'.
INSERT INTO public.schema_migrations(version, name) VALUES
  ('001','baseline schema (schema.sql + rls.sql)'),
  ('002','missing-tables'),
  ('003','add-discount-reason'),
  ('004','backfill-customers'),
  ('005','admin-write-policies'),
  ('006','enable-realtime'),
  ('007','room-delete-policy'),
  ('008a','anon-booking-policies'),
  ('008b','staff-service-delete-policies'),
  ('009','create-organizations'),
  ('010','add-org-id-to-tables'),
  ('011','org-rls-helper'),
  ('012','org-rls-policies'),
  ('014','service-images-storage'),
  ('015','add-industries'),
  ('016','therapist-display-order'),
  ('017','room-display-order'),
  ('018','user-pin'),
  ('019','room-amenities'),
  ('020','booking-therapists'),
  ('021','therapist-position'),
  ('022','service-staff-flag'),
  ('023','booking-therapist-times'),
  ('024','branch-excluded-service-categories'),
  ('025','booking-number-race-fix'),
  ('026','discount-on-completed-unpaid'),
  ('027','schema-migrations-tracking'),
  ('028','split-half-day-attendance'),
  ('029','discount-request-workflow'),
  ('030','booking-group-id'),
  ('031','booking-referred-by'),
  ('032','notifications'),
  ('033','customers-org-id'),
  ('034','customers-merge-dryrun'),
  ('035','customers-merge'),
  ('036','customers-dup-guard'),
  ('037','customers-rls-org'),
  ('038','staff-org-id-and-transfers'),
  ('039','staff-transfer-fn'),
  ('040','left-behind-booking-reminders'),
  ('041','scheduled-staff-transfers'),
  ('042','split-payments-outstanding'),
  ('043','referral-commission'),
  ('044','payroll'),
  ('045','memberships'),
  ('046','membership-payment-mode'),
  ('047','membership-card-numbers'),
  ('048','transfer-syncs-user-branch'),
  ('049','services-manager-write'),
  ('051','staff-reorder-columns'),
  ('052','custom-payment-methods'),
  ('053','add-admin-viewer-role'),
  ('054','admin-viewer-rls-policies'),
  ('055','fix-payment-mode-constraint-name'),
  ('058','customers-gender'),
  ('059','renew-membership'),
  ('060','membership-payment-mode'),
  ('061','renew-membership-forfeit-balance'),
  ('062','extend-membership'),
  ('063','multi-branch-manager-access')
ON CONFLICT (version) DO NOTHING;
