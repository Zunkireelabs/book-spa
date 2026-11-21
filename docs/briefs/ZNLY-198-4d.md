# Brief: ZNLY-198 step 4d: Anish's features in our design (UI only, from the approved boards)

**From:** lead/QC bookx-eb · **To:** executor bookx-60 · **Date:** 2026-11-17 · **Owner OK:** Sadin (boards B1–B8 approved 16 Nov)
**UI only.** The logic is done and accepted (4a–4c, migrations 376–386). Do not change any rule, RPC or migration; if a board needs
a rule that does not exist, stop and tell me. Canvas: https://claude.ai/artifact/MX1KoaC6ot2uBQWVXgqWs2 (read the board files
named per item with the Artifact `read` action, `paths`, `out_dir` = your scratchpad).

## Process
Items in this order. After each item: leave it **uncommitted**, report in 3 lines, stop. I check it in the browser against the
board; the owner OKs; then you commit (one commit per item). No push, no PR, don't move tickets.
Build with our kit only: SidePanel, PanelFormKit, ListToolbarKit, ModalShell, ConfirmDialog, CustomSelect (never a native
`<select>`), our tokens, `useIndustry` labels. No new look-alike components.

## 0. Inventory first (no code): the service editor
Both branches had a service editor: our side panel (`ServiceFormPanel`) and Anish's full page (`pages/service-detail`). Tell me in
5 lines: which one the Services list opens today after the merge, which sections each has (basics, price type + tiers, branch
scope, eligible staff, offer, online booking, combo, padding, image), and your proposal for ONE editor. Board B2.1 is a side panel.
Wait for my answer before item 1.

## 1. B2: service pricing and price tiers (boards B2.1, B2.2)
- The one service editor gets the Pricing section of B2.1: price type (CustomSelect, 5 types), **"Standard price"** (rename
  "Unassigned" everywhere it is shown, including tier lists), price by tier with the blank-means-standard hint and "Manage tiers"
  link, the online range note; Branches; Who can do it + "Needs a team member".
- Settings → Price Tiers restyled as B2.2: list with drag, rename, delete confirm with impact (and "appointments already booked
  keep their price"), assign side panel, empty, read-only, error.
- New **Price tier** row on the team member panel (B2.2 #7, admin/manager), using the existing assign function.

## 2. B3: invoice dialog and Billing settings (boards B3.1, B3.3)
Print invoice as our ModalShell (layout A4 / thermal, copy Original / Duplicate, bill to, errors). Billing settings in our form kit
with the live header preview and the tax-mode confirm. The printed documents themselves (B3.2) do not change.

## 3. B5: waitlist (boards B5.1–B5.3)
Our side-panel look on the calendar; collapsed rail with count; **drop the empty "Upcoming" tab**; masked names for restricted
staff; All-locations gate. **Phone:** a Waitlist button with the count in the calendar header opens a full-width sheet; Edit and
Remove under "⋯"; 44 px targets; Book in closes the sheet and opens the new-appointment panel.

## 4. B7: Locations (board B7)
List with the one-line hours summary and status; Edit location as a side panel (photo, details, Active, weekly hours) instead of
the full page; the empty state; the form error "Closes before it opens".

## 5. B4 + B6 polish
Lock screen in our tokens (B4.1, no behaviour change). The "Needs a PIN" hint: for an admin say "Set your PIN in your Access
settings" instead of "Ask your manager". Check the Settings menu matches B6 for both tenants (Rooms only when rooms are on).

## Gates (I re-run each one)
`npm run build`; `npm test`; `scripts/qc-4a.sh` and `scripts/qc-4c.sh` stay ALL PASSED. 4 screenshots per item at most
(desktop 1440 and phone 390), both tenants' wording where the item shows it.

## Token rules
No forks; never read `api.js` whole; no re-reads after edits; tail outputs; 3-line reports; a **Not verified** list at the end.
