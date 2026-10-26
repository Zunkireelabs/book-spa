# Zennly tracker

**The one file for open work.** Plane (project **Zennly WebApp**, key `ZNLY`) is the board. This file mirrors it
for anyone working in the repo. Every line carries its `ZNLY-n` id. If this file and Plane disagree, Plane wins:
fix this file.

Last synced with Plane: **2026-10-26**

---

## How we track work (SOP, same for every project)

1. **One board, one file.** Plane holds every task and its state. `tasks/TRACKER.md` is the only to-do file in
   the repo. No `todo.md`, no to-do lists inside handoffs, briefs or session logs; a to-do found anywhere else
   moves here and to Plane.
2. **No work without a ticket.** Search Plane first; create the ticket if it's missing (parent epic, labels,
   priority, acceptance criteria). Add it to this file in the right section.
3. **States** (they mirror the git flow): `Backlog → Todo → In Progress → In Review (PR open to stage) →
   On Stage (merged to stage) → Done (live on main)`. *Cancelled* = won't do. We cancel, we don't delete.
4. **Move the ticket when the work moves**, and update this file in the same sitting.
5. **Decisions only the owner can make** are tickets titled `DECIDE …`, listed under *Waiting on owner*.
6. **New work found mid-task** becomes a new ticket, not scope creep.
7. **Logs are narrative, not to-do lists.** `docs/session-logs/YYYY-MM-DD.md` says what happened and links the
   ticket ids. Any loose end in a log becomes a ticket.
8. **Unverified ≠ done.** If it can't be proven, it gets the `needs-verification` label.

---

## Now (in progress)

| Ticket | What | Next step |
|---|---|---|
| ZNLY-81 | **UI-15: renumber our migrations 282–293 → 301+.** PR #413 (Anish) already put 282–298 on the staging DB; ours would be skipped. | Owner runs the read-only staging ledger query (in the ticket) → executor renumbers → lead review → owner commit OK. |
| ZNLY-75 | **UI-9 (V19): cross-tenant RLS fix.** Built, committed (0c25948). | After ZNLY-81: apply on STAGE, click-test per role. Prod after the holidays. |
| ZNLY-40 | Retire stale docs now superseded by Plane. | This cleanup. |
| ZNLY-66 | **Epic: UI/UX Upgrade** (`feat/ui-port-from-clinicmd`, 78 local commits, never pushed). | Keep going page by page; one PR to stage at the end (ZNLY-82). |

**Built on the UI branch (committed locally, In Progress until the PR):**
ZNLY-67 calendar port · ZNLY-68 panels (V5–V9) · ZNLY-69 Customers (V11–V13) · ZNLY-70 money model (V14) ·
ZNLY-71 Bookings + inbox (V15–V16) · ZNLY-72 admin delete bug · ZNLY-73 checkout (V17) · ZNLY-74 storage
security (V18) · ZNLY-76 Packages + Memberships (V20–V21) · ZNLY-77 member discount (V22) · ZNLY-78 Vouchers
(V23) · ZNLY-79 Products (V25) · ZNLY-80 products in checkout + commission (V26, 29aa908).

## Next

| Ticket | What |
|---|---|
| ZNLY-83 | UI-17: next pages: Therapists, Reports, Dashboard, Calendar polish, Settings lists. |
| ZNLY-82 | UI-16: release prep: regression pass, stage re-merge, PR to stage. Last step. |

## Waiting on owner

| Ticket | Question |
|---|---|
| ZNLY-81 | Run the read-only staging ledger query, send a screenshot. |
| ZNLY-12 | Merge PR #415 (stage copy of the search-booking revoke; the prod fix is already live). |
| ZNLY-84 | A-2: viewer sees write buttons on customer-detail (Anish's page). Hand to Anish, or fix here? |
| ZNLY-85 | V-4: staff voucher limits. Match bookings (50% cap)? Recommended: yes. |
| ZNLY-86 | V-6: staff can't use member discount / wallet when issuing vouchers. Intended? |
| ZNLY-87 | V-7: let admins edit live membership tiers? |
| ZNLY-88 | V-8: room on/off switch? |
| ZNLY-89 | V-9: win-back emails guests who are already booked. Align with the At-risk rule? |

## Follow-ups (Backlog)

| Ticket | What |
|---|---|
| ZNLY-90 | V19 security follow-ups: views not security_invoker, SECURITY DEFINER param audit, anon insert policy. |
| ZNLY-91 | Products follow-ups: vouchers paying for products, receptionist commission, product discounts, payroll vs booking_therapists, SKU wipe. |
| ZNLY-92 | V20–V24 follow-ups: % coupons at checkout, package dues, tier pill, khems-cleaning voucher types. |
| ZNLY-93 | Small UI backlog: calendar min/max, dead panel, bounded customer lookup, a11y, legacy BookingsList, V10c. |

## Rest of the board (other epics, not on this branch)

Open tickets owned outside the UI branch. See Plane for detail.

- **Security & Auth:** ZNLY-12 search-booking revoke (In Review, #415) · ZNLY-14 PIN login Edge Function (In Review, PR #30) · ZNLY-15 rotate accounts exposed by dev-info.html · ZNLY-16 RLS access harness.
- **CI/CD & Release:** ZNLY-13 migration-289 collision · ZNLY-30 linear history · ZNLY-31 staging ledger anomalies · ZNLY-32 repo housekeeping.
- **Booking & Calendar:** ZNLY-34 PR #413 combo services (In Review) · ZNLY-33 PR #350 gaps.
- **Customers / CRM:** ZNLY-41 promote stage → main (customer/staff detail + 275–281, On Stage) · ZNLY-38 centralise data phase 2.
- **Perf / DB health:** ZNLY-26 verify 503 screen (Todo) · ZNLY-27 re-measure perf · ZNLY-28 idle-tab polling · ZNLY-29 dashboard cleanup.
- **Domain & Rebrand:** ZNLY-17 staging domain flip (Todo) · ZNLY-18 auth URL allowlists · ZNLY-19 "Zenly" strings · ZNLY-20 legacy redirect.
- **Outreach / Email:** ZNLY-21 Resend SMTP · ZNLY-22 booking emails · ZNLY-23 click-through new prod pages.
- **Memberships / Payments:** ZNLY-24 admin corrections log page · ZNLY-25 generic package system.
- **Multi-tenant:** ZNLY-36 sbal provider profile · ZNLY-37 Phase 9 governance.
- **Docs & Tech Debt:** ZNLY-35 manual verification debt · ZNLY-39 PostHog status · ZNLY-40 this cleanup.

---

## Reference (not tasks)

**Read-only prod query before shipping ZNLY-77 (member discount).** Paste it alone in the prod SQL editor:

```
select o.slug as org, 'service category' as kind, coalesce(s.category,'(none)') as value, count(*)::text as detail
from public.services s join public.organizations o on o.id = s.org_id
group by 1, 2, 3
union all
select o.slug, 'tier: ' || t.name, coalesce(t.discount_rules::text, '{}'), case when t.is_active then 'on sale' else 'off sale' end
from public.membership_tiers t join public.organizations o on o.id = t.org_id
union all
select o.slug, 'active members', t.name, count(*)::text
from public.memberships m join public.membership_tiers t on t.id = m.tier_id join public.organizations o on o.id = m.org_id
where m.expiry_date >= current_date
group by 1, 2, 3
order by 1, 2, 3;
```

**Where the rest lives:** briefs `temp_ss/briefs/` · mockups `temp_ss/mockups/` · screenshots `temp_ss/cal-port/`
(next number 67) · lead resume notes `temp_ss/HANDOFF-lead-resume.md` (session state and rules only, no
to-dos) · DB promotion `supabase/PROMOTION.md` · session logs `docs/session-logs/` · old handoffs
`docs/archive/`.
