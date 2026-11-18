-- migration-395-spa-staff-plural-label.sql  (ZNLY-251)
--
-- WHY: the production row industries.id = 'spa' was hand-edited to staff_label_plural = 'All Staffs' (staff_label stays 'Staff'),
--      so Nuad sees "All Staffs" and "Search all staffs..." in the UI. 'Staffs' is not a word; the plural of 'Staff' is 'Staff'.
-- WHAT: set staff_label_plural back to 'Staff' for id = 'spa', ONLY where it still holds the bad value. Local / stage rows
--       (Therapist / Therapists) do not match the guard and are untouched. Data fix only, no schema change.
-- IDEMPOTENT: the WHERE guard makes a re-run change 0 rows.
-- ROLLBACK: UPDATE public.industries SET staff_label_plural = 'All Staffs' WHERE id = 'spa' AND staff_label_plural = 'Staff';
--           (only if the old hand-edited text is really wanted back).

BEGIN;

UPDATE public.industries
   SET staff_label_plural = 'Staff'
 WHERE id = 'spa'
   AND staff_label_plural = 'All Staffs';

INSERT INTO public.schema_migrations (version, name) VALUES ('395', 'spa-staff-plural-label')
ON CONFLICT (version) DO NOTHING;
COMMIT;
