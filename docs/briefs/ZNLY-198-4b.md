# Brief: ZNLY-198 step 4b: Access section UI (ZNLY-205, UI half), built from board B1

**From:** lead/QC bookx-eb · **To:** executor bookx-60 · **Date:** 2026-11-16 · **Owner OK:** Sadin, 2026-11-16
4a is QC Accepted (commits up to 418ee6d). This step is **UI only**: the data model and rules are done (migrations 376-378).

## Boards (the source of truth for how it looks)
Canvas https://claude.ai/artifact/MX1KoaC6ot2uBQWVXgqWs2 (read it with the Artifact `read` action, `paths` = the files below, `out_dir` = scratchpad):
`project/B1-1-AccessSummary.dc.html`, `B1-2-AccessEdit.dc.html`, `B1-3-AccessFirstLogin.dc.html`, `B1-4-AccessStates.dc.html`. All approved 2026-11-16.
Also read `docs/DESIGN-DIRECTION.md` and ZNLY-205 in Plane (the owner's decision is in its text).

## Build
1. **Team member panel** (`TherapistPeekPanel.jsx`): replace `<TherapistLoginField/>` with an **Access** section (B1.1): rows Login on/off, Signs in with, PIN set/not set, Role, Calendar, Client details, Prices, Branches, plus an Edit access button. Managers and admins only.
2. **Edit access** side panel (B1.2) and **Give login access** side panel (B1.3, when the person has no login). Fields: Can sign in (switch), Email, Password (new login only; for an existing login show the "Forgot password" note, never a field), new PIN, Role cards, Calendar (CustomSelect: own / own view only / all / all view only), the two "hide" checkboxes (Staff role only), Branches (all / selected, home branch always included). Use SidePanel, PanelFormKit and CustomSelect (no native select).
3. **States** (B1.4): login off, no PIN, loading skeleton, load error with Retry, save error (incl. "that email already has a login for another team member"), Admin viewer read-only (no Edit button).
4. **Link needs review** prompt (B1.4 state 3): admins only, at the top of the team member list page while unresolved rows exist in `znly205_link_conflicts` (exclude reason `login_access_backfilled_to_email`). Show one plain sentence per reason and two actions: link as the row suggests (use `set_user_therapist`, which already refuses conflicts) or "Keep as is". Resolving must mark the row resolved: add migration 379 with `resolved_at timestamptz` and an admin-only RPC that does the link and the mark in one transaction. If the board wording does not fit a reason, say so in the report; do not invent a different flow.
5. **Remove** Settings → Staff access (registry entry, route, `StaffAccessPanel`) and `TherapistLoginField`; nothing in the app may call `set_user_therapist` from a "Login" field any more. Keep Anish's logic: **reuse his api functions** (`grantStaffAccess`, the update function around `api.js:19642`, `grantableRolesFor`); do not rewrite them. Grep and ranged reads only.
6. **Wording from the tenant** (`useIndustry`): staffLabel, sessionLabel; no "spa", no hard-coded "Therapist".
7. **Rules:** a manager can only grant roles up to their own and may only edit Staff-role people at their own branches. I wrote this on the board from `grantableRolesFor` by name only. Check what the code and RLS really allow and report any difference; build what the code allows and tell me.

## Not in this step
Lock screen changes (B4), price tier row and service pricing (B2), VAT/Billing (B3). If you see something missing from the boards, list it in the report; don't add it.

## Gates (I re-run each one)
`npm run build`; `npm test` (full, once, at the end); `scripts/qc-4a.sh` stays ALL PASSED; a new test for each rule you can test without a browser (role limits, link-conflict resolve RPC, removed routes). Smoke: sign in as admin, open a team member, add a login, edit access, turn login off, check the Link-needs-review prompt with a seeded conflict. 6 screenshots at most, both tenants (Nuad Thai wording and a beauty tenant: Team member / Appointment), at desktop width and at phone width (panel full width).

## Process
**Leave the changes UNCOMMITTED.** After my check against the boards the owner tests it in the local app and OKs the commit. No push, no PR, don't move tickets.
Token rules as before: no forks; never read `api.js` whole; no re-reads after edits; tail outputs; full vitest once; reports of 10 lines or fewer, then a **Not verified** list.
