# Staff permissions — phase 2

**Status:** not started. Deferred deliberately on 2026-11-15 so phase 1 (login access,
role, branch access, calendar visibility) could ship first.

## Why this is its own project

Phase 1 answers "can this person sign in, and as what role". This phase answers "what can
they actually do once inside" — roughly **50 individual permissions** replacing the four-value
`user_role` enum as the primary authorization mechanism.

The cost is not the UI. It is enforcement:

- `src/services/api.js` carries **104 `profile.role` checks** and **510 `.from()` calls**
- every permission needs an enforcement point, and most need an RLS policy behind it
- a toggle that renders but does not enforce is **worse than no toggle** — an admin would
  believe they had restricted someone when they had not

That is the whole risk of this project, and it is why it was not bolted onto phase 1.

## Reference: Timely's model

Captured from `app.gettimely.com/Account/StaffAccessEdit/…` on 2026-11-15. Twelve sections.
The first three already exist in Zenly's phase 1.

| section | shape |
|---|---|
| Login access | Email access · Only PIN access · No login access — **shipped** |
| Locations | All · Selected — **shipped** |
| Calendar | Personal · Personal (view only) · All · All (view only) — **shipped** |
| Calendar privacy | Hide prices. Note: *"Hiding prices will remove the ability to access the sales, dashboard and reports areas"* — permissions have dependencies |
| Dashboard | All / Some / No access, then per sub-area: Business overview, Staff overview, Targets (+ add/edit, delete), Activity — each **self-only vs all staff** |
| Sales | No access · For all staff · For self only; sub-toggles: process refunds, void payments and invoices, edit prices on the sale |
| Customers | No access (name only) · Contact details and notes only · All customer database; sub-toggles: contact details, blocking, photos, documents, adjust rewards points |
| Messages | Sent messages, SMS campaigns |
| Reports | Five families — business performance, financial, appointment, staff, customer — each No access / All staff / Self only |
| Stock | All / Some / No, then Products (view, edit, delete, edit stock levels), Suppliers (view, add/edit, delete), Stock orders (view, create/receive, edit, cancel), stock reports |
| Setup | No · Full · Some (own roster only, Promote section, Consult templates) |
| Account | No · Full (billing, SMS credits) · Some (**manage staff access** — the permission that grants this screen) |

## Do not copy this list

Timely's sections describe Timely's product. Several have no Zenly equivalent — Suppliers,
Stock orders, Consult templates, SMS campaigns as a distinct area.

Zenly has areas Timely does not: **Payroll, Memberships, Vouchers, Packages, Outreach,
Attendance, Transfers, Daily Report, Discounts, Due/Outstanding reports.** Copying Timely
would ship permissions for features that do not exist and none for the ones that do.

What to take is the **pattern**, applied to Zenly's own nav (`StaffSidebar.jsx`, ~40 areas):

1. Three-state access per area — All / Some / None
2. Granular sub-permissions under "Some"
3. The **self-vs-all-staff** axis, which recurs everywhere and is the most useful single idea
   on the page — most spa permissions are really "can they see other people's data"
4. Declared dependencies between permissions, as Timely's price-hiding note shows

## Design notes for whoever picks this up

**Storage.** A `jsonb` column on `users` is tempting and wrong for this: it cannot be
referenced from an RLS policy without a function call per row, and these checks sit in the
hot path. Prefer a `user_permissions` table keyed `(user_id, permission_key)`, or a set of
boolean columns if the list stabilises.

**Enforcement must be server-side.** Phase 1 already sets the pattern — `assertCanGrantRole`
in `api.js` enforces the role ceiling, and `grantableRolesFor` feeds the UI from the same
list so the two cannot drift. Repeat that shape: one definition, enforced in the API,
consumed by the UI.

**Roles do not disappear.** They become presets that set a bundle of permissions, which is
how Timely's "All access / Some access / No access" works. Existing `staff`/`manager`/`admin`
behaviour must survive untouched for every tenant that never opens this screen.

**The discount ceiling is already a permission** in all but name — `DISCOUNT_LIMITS` in
`api.js` keys off role. It should fold into this model rather than sitting beside it.

## Open questions

1. Does the `admin_viewer` role survive, or become "all areas, view only" as a preset?
2. Who may grant permissions they do not themselves hold? Timely has an explicit
   "Manage staff access" permission; Zenly currently uses the role ceiling.
3. Per-branch permissions, or org-wide only? A manager at one branch with reports access —
   does that mean reports for their branch or all branches?
4. What happens to a logged-in session when their permissions change mid-shift?
