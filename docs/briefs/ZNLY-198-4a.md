# Brief: ZNLY-198 step 4a: merge stage, logic only (with ZNLY-204 and the logic half of ZNLY-205)

**From:** lead/QC session bookx-eb · **To:** executor bookx-60 · **Date:** 2026-11-16 · **Owner OK:** Sadin, 2026-11-16

## Why
Thursday 19 Nov ships to ALL production tenants (Nuad Thai and others). Sami's Brows and Lashes is onboarded right after.
The bar: no conflicts, no data loss, no lost features. **Logic first, visuals later** (4b = Access UI, 4c = P1s 206-210,
4d = restyle Anish's features). Nothing in this step is a redesign.

## Read first (ranged reads only)
1. `docs/SITEMAP.md` §8 (critical path) and §9 G-1. 2. `docs/USER-JOURNEYS.md` §5 and §7 (CP checks).
3. Plane ZNLY-198, ZNLY-204, ZNLY-205 (the 205 text holds the owner's decision).

## Branch
`feature/ZNLY-198-ui-integration` (HEAD 47fad2a). Local commits only: **no push, no PR, no stage/main.**

## Task
### A. Merge `origin/stage` (d202472) into the branch
31 conflicts (stage hasn't moved since the 16 Nov count). Rules:
- **Logic conflict → stage's logic wins** (Anish's features: staff access, price types and tiers, waitlist, VAT invoices
  and billing settings, PIN lock screen, group booking, Locations, per-branch service scope ZNLY-186).
  **Layout conflict → our UI wins.** If a feature has no place in our UI yet, keep stage's component working as is;
  4d restyles it. A stage feature must never be dropped.
- **Watch the 4 modify/delete conflicts.** We deleted these files and stage changed them:
  `OperationalCalendar.jsx`, `branch-staff-dashboard/components/StaffHeader.jsx`,
  `staff-detail/components/PersonalInfoFields.jsx`, `staff-detail/components/StaffDetailsFields.jsx`.
  For each one, diff stage's change (`git diff <merge-base> origin/stage -- <file>`) and carry it into the
  component that replaced it. Then delete the file. List each carried change in your report.
- `src/services/api.js`: resolve hunk by hunk. Keep both sides' functions. Where the same function differs, merge the
  rules; don't pick one side wholesale. Grep and ranged reads only (the file is ~730 KB).
- `tasks/TRACKER.md`: take ours (it's generated). `docs/session-logs/2026-10-26.md`: keep both texts.
- Commit the merge as one commit: `ZNLY-198: merge origin/stage (4a)`.

### B. ZNLY-204: one migration, `supabase/migration-376-*.sql`
DROP every overload of `public_get_bookable_therapists` and `public_check_branch_bookings_range`, then recreate each
function **once**, with stage's signature (including `p_for_group_booking boolean DEFAULT false`) and stage's rules
(299 full-capacity blocks, 301 online capacity, 305/306 group bypass + PII fix, 307 gender reserve), **plus** our
354/361 changes (now_at etc.). Keep grants as they are on stage. Self-record into `schema_migrations`.

### C. ZNLY-205 logic half: `supabase/migration-377-*.sql` plus code
1. Copy every `users.therapist_id` link into `therapists.user_id` where that column is empty and the match is
   unambiguous. **Don't overwrite and don't guess:** before the drop, save every link that wasn't copied (user id,
   their therapist_id, the therapist's current user_id, the reason) into a kept table `public.znly205_link_conflicts`
   (RLS on, admin read only). Also emit a `RAISE NOTICE` with the count. No link is lost silently.
2. Repoint everything that reads `users.therapist_id` (My day, Front desk, Branch dashboard views, RPC from mig 369,
   anything else a grep finds) to `therapists.user_id`. Then drop `users.therapist_id`.
3. **Login off blocks sign-in:** a user whose `login_access` is off can't sign in by password or by PIN. Enforce it
   in the app's sign-in path and in whatever the PIN path calls. If enforcement needs the `pin-login` Edge Function
   (it isn't in this repo), STOP that sub-part and write exactly what has to change in the function into the Not
   verified list. Don't guess its code.
4. Users with no `login_access` value (created outside Staff access, G-16) must **not** be locked out. Treat them as
   allowed, or backfill them in 377.
5. Leave the UI alone (Access section, removing Staff access and the "Login" field are 4b). Just make sure no
   screen still writes `users.therapist_id`.

## Gates (run them all; I re-run each one)
- `npm run build` (tail) and `npm test` (full suite, once, at the end).
- `bash scripts/check-migrations.sh`.
- Reset the local DB and replay **002..377** cleanly.
- A SQL test file (e.g. `supabase/tests/znly-204-205.sql`, run with psql) that asserts:
  one overload of each RPC; 3-arg and 4-arg calls both succeed; group booking with staff selection off returns no
  names; a manual block fills full room capacity; online capacity is respected; gender reserve holds;
  `users.therapist_id` gone; a linked restricted staff member sees the same booking set via RLS and via the My day
  query; login off → sign-in refused; no `login_access` value → sign-in allowed.
- Smoke-test the local app (4 or 5 screenshots at most): sign in as admin and as staff; calendar loads; a group
  booking reaches the team step on `/:orgSlug/book`; Locations opens; a tiered service shows its range.

## Token rules
No forks or sub-agents. Never read `api.js` or other big files whole: grep and ranged reads only. Don't re-read files
after editing them. Tail build and test output. Run the full vitest only at the end. Use DOM assertions instead of
screenshots for text. Decide small things alone.

## Report (10 lines or fewer, then the lists)
Commits (hashes) · gates with real counts (tests passed/total, migrations replayed) · the modify/delete carry-overs ·
conflicts that 377 listed · **Not verified** list (mandatory). Move ZNLY-198/204/205 nowhere: I move tickets after my
QC.
