# Zennly tracker

**The one to-do file for the whole team.** Plane (project **Zennly WebApp**, key `ZNLY`) is the board. This file
mirrors it for everyone working in the repo, every developer and every Claude session. Every line carries its
`ZNLY-n` id and its owner. If this file and Plane disagree, Plane wins: fix this file.

Last synced with Plane: **2026-10-26** (by Sadin's lead session)

---

## How we track work (HARD RULE for every developer; the same SOP for every project)

1. **One board, one file, whole team.** Plane holds every task and its state. `tasks/TRACKER.md` is the only
   to-do file in the repo. No `todo.md`, no to-do lists in handoffs, briefs, PR descriptions or session logs; a
   to-do found anywhere else moves to Plane and here.
2. **Your work is in Plane before you start it.** Every fix, feature, migration, data fix, hotfix, investigation
   or follow-up has a ZNLY ticket with an assignee, however small. Untracked work is not allowed.
3. **No duplicates.** Search Plane before creating. If a ticket already covers it (even someone else's), comment
   on it or add a child ticket.
4. **Every line here names its owner.** Update this file in the same PR or commit that changes the ticket.
5. **States** mirror the git flow: `Backlog → Todo → In Progress → In Review (PR open to stage) →
   On Stage (merged to stage) → Done (live on main)`. *Cancelled* = won't do. Cancel, don't delete.
6. **Branch and PR carry the id:** `feature/ZNLY-123-short-name`, PR title `ZNLY-123: …`. No id, no merge.
7. **Claim migration numbers in the ticket** after checking `supabase/` on `stage` and open PRs.
8. **Questions only the owner can answer** are `DECIDE …` tickets, listed under *Waiting on owner*.
9. **New work found mid-task** becomes a new ticket, not scope creep.
10. **Logs are narrative, not to-do lists.** `docs/session-logs/YYYY-MM-DD.md` links ticket ids; loose ends
    become tickets.
11. **Unverified ≠ done.** If it can't be proven, it gets the `needs-verification` label.

---

## Now (in progress)

| Ticket | Owner | What | Next step |
|---|---|---|---|
| ZNLY-81 | Sadin | **UI-15: renumber the UI branch's migrations 282–293 → 301+.** PR #413 already put 282–298 on the staging DB. | Staging ledger query → renumber → review → commit. |
| ZNLY-75 | Sadin | **UI-9 (V19): cross-tenant RLS fix.** Built (local commit 0c25948). | After ZNLY-81: apply on STAGE, click-test per role. Prod after the holidays. |
| ZNLY-40 | Sadin | Retire stale docs; set up this tracker. | This PR. |
| ZNLY-66 | Sadin | **Epic: UI/UX Upgrade** (`feat/ui-port-from-clinicmd`, local, never pushed). | Page by page; one PR to stage at the end (ZNLY-82). |
| ZNLY-34 | Anish | **PR #413:** combo-service bookings, calendar full-day view, service/staff admin upgrades. In Review. | Review + merge to stage. |

**Built on the UI branch (committed locally, In Progress until its PR), owner Sadin:**
ZNLY-67 calendar port · ZNLY-68 panels (V5–V9) · ZNLY-69 Customers (V11–V13) · ZNLY-70 money model (V14) ·
ZNLY-71 Bookings + inbox (V15–V16) · ZNLY-72 admin delete bug · ZNLY-73 checkout (V17) · ZNLY-74 storage
security (V18) · ZNLY-76 Packages + Memberships (V20–V21) · ZNLY-77 member discount (V22) · ZNLY-78 Vouchers
(V23) · ZNLY-79 Products (V25) · ZNLY-80 products in checkout + commission (V26).

## In review / on stage

| Ticket | Owner | What | State |
|---|---|---|---|
| ZNLY-12 | Sadin | Revoke anon search-booking (prod fix already live; PR #415 is the stage copy). | In Review |
| ZNLY-14 | unassigned | PR #30: PIN login service-role usage → Edge Function. | In Review |
| ZNLY-41 | unassigned | Promote stage → main: customer/staff detail rebuild + migrations 275–281. | On Stage |

## Next

| Ticket | Owner | What |
|---|---|---|
| ZNLY-83 | Sadin | UI-17: next pages: Therapists, Reports, Dashboard, Calendar polish, Settings lists. |
| ZNLY-82 | Sadin | UI-16: release prep: regression pass, stage re-merge, PR to stage. Last step. |
| ZNLY-26 | unassigned | Verify the 503 "Reconnecting" screen against a real failure (Todo). |
| ZNLY-17 | unassigned | Flip STAGING_DOMAIN to dev-app.zennly.io + verify stage health check (Todo). |

## Waiting on owner (Sadin)

| Ticket | Question |
|---|---|
| ZNLY-81 | Run the read-only staging ledger query, send a screenshot. |
| ZNLY-12 | Merge PR #415. |
| ZNLY-84 | A-2: viewer sees write buttons on customer-detail (Anish's page). Hand to Anish, or fix in the UI branch? |
| ZNLY-85 | V-4: staff voucher limits. Match bookings (50% cap)? Recommended: yes. |
| ZNLY-86 | V-6: staff can't use member discount / wallet when issuing vouchers. Intended? |
| ZNLY-87 | V-7: let admins edit live membership tiers? |
| ZNLY-88 | V-8: room on/off switch? |
| ZNLY-89 | V-9: win-back emails guests who are already booked. Align with the At-risk rule? |

## Backlog

Owner "unassigned" = no one has claimed it. Claim it in Plane (assign yourself) and here before starting.

| Ticket | Owner | What |
|---|---|---|
| ZNLY-90 | Sadin | V19 security follow-ups: views not security_invoker, SECURITY DEFINER param audit, anon insert policy. |
| ZNLY-91 | Sadin | Products follow-ups: vouchers paying for products, receptionist commission, product discounts, payroll vs booking_therapists, SKU wipe. |
| ZNLY-92 | Sadin | V20–V24 follow-ups: % coupons at checkout, package dues, tier pill, khems-cleaning voucher types. |
| ZNLY-93 | Sadin | Small UI backlog: calendar min/max, dead panel, bounded customer lookup, a11y, legacy BookingsList, V10c. |
| ZNLY-13 | unassigned | Renumber colliding migration-289 (PR #413 vs PR #415). |
| ZNLY-15 | unassigned | Rotate/remove accounts exposed by the deleted dev-info.html. **High.** |
| ZNLY-16 | unassigned | RLS access harness (6 principals × 64 tables): confirm merged. |
| ZNLY-18 | unassigned | Supabase Auth URL allowlists for the new domain (both projects). **High.** |
| ZNLY-19 | unassigned | Remaining "Zenly" strings. |
| ZNLY-20 | unassigned | Legacy-domain redirect + retire old domains. |
| ZNLY-21 | unassigned | Auth email via Resend SMTP + DKIM/SPF/DMARC. |
| ZNLY-22 | unassigned | Booking confirmation + reminder emails; wire 2 stub "Send Email" buttons. |
| ZNLY-23 | unassigned | Click-through the four newly flag-enabled prod pages. |
| ZNLY-24 | unassigned | Admin corrections log page. |
| ZNLY-25 | unassigned | Decide on the generic Package (bundle) booking system; may be superseded by combos. |
| ZNLY-27 | unassigned | Perf follow-ups: re-measure in Nepal business hours. |
| ZNLY-28 | unassigned | Idle-tab polling fan-out. |
| ZNLY-29 | unassigned | Supabase dashboard cleanup (ERROR logging, 25P02 trigger). |
| ZNLY-30 | unassigned | Decide on required_linear_history for main/stage. |
| ZNLY-31 | unassigned | Staging migration-ledger anomalies (e.g. non-numeric version `008a`). |
| ZNLY-32 | unassigned | Repo housekeeping: stale branches, temp_ss diagnostics, untracked files. |
| ZNLY-33 | unassigned | PR #350 follow-up gaps. |
| ZNLY-35 | unassigned | Manual verification debt: features shipped but never click-tested. |
| ZNLY-36 | unassigned | sbal provider-profile content + live click-through. |
| ZNLY-37 | unassigned | Phase 9 Platform Governance: establish status. |
| ZNLY-38 | unassigned | Centralise customer/staff data, phase 2. |
| ZNLY-39 | unassigned | PostHog adoption status. |

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

**Where the rest lives:** Plane rules in `.claude/skills/project-pm/SKILL.md` · DB promotion `supabase/PROMOTION.md`
· session logs `docs/session-logs/` · old handoffs `docs/archive/`.
