# Zennly design direction

**Status:** v1, 2026-11-16. Records the owner's (Sadin's) decisions only; nothing here is the lead's invention.
Change it only when the owner decides something new, and date the change.

## Decisions (owner, 2026-11-16)

1. **Zennly keeps its own design: the one on our UI branch** (`feat/ui-port-from-clinicmd`, now on
   `feature/ZNLY-198-ui-integration`). The 19 Nov work integrates that design with Anish's features. No restyle to
   any other system.
2. **The Zone POS canvas is a method reference only:** how boards are made, indexed and QC'd. Its look (violet-blue,
   Plus Jakarta Sans, `zone.css`) is **not** Zennly's. Zennly gets **its own** design canvas for its boards.
3. **Anish's features keep their logic and take our design:** staff access, price tiers and price types, waitlist,
   VAT invoices and billing settings, PIN lock screen, plus the main-only features our branch lacks (group booking,
   Locations, per-branch service scope).
4. **Wording comes from the tenant, never hard-coded.** Industry labels (`staffLabel`, `sessionLabel`, `locationLabel`,
   `productLabel`) drive every screen. Sami's Brows and Lashes: **Team member** for staff, **Appointment** for a
   booked treatment ("Session" as the fallback). Nuad Thai: Therapist / Session. No screen says "spa" unless the
   tenant is a spa.
5. **Meta Astryx: not now.** Evaluate after go-live (ZNLY-202: React 19 upgrade, one-screen pilot, go / no-go).
6. **Scope for Thursday:** mockup boards and QC for the critical path only (`docs/SITEMAP.md` §8). The rest of the
   product follows after go-live.
7. **Global, not tenant-specific:** every screen must work for every industry and every tenant on production.

8. **Client online booking is moving out of the app** (owner, 2026-11-16): it will live on **zennly.io**, the
   marketplace Anish is building, and connect to the app later. The app (app.zennly.io) stays the business side.
   The public booking database functions are still fixed now (ZNLY-204), because the marketplace will use them.
9. **The Settings "Spa" group is renamed "Business" for every tenant** (owner, 2026-11-16).

## What "our design" is today (from the code, for reference)

- **Tokens** (`tailwind.config.js`): primary `#2D5A27` (forest green), background `#FAFAFB`, surface `#FFFFFF`,
  text `#0E0D0C`, sidebar `#F9F9F9`; semantic success / warning / error; **Inter** for every family; semantic
  z-index tokens (`z-header`, `z-modal`, …); `shadow-spa-*`, `rounded-spa` / `rounded-spa-lg`.
- **Shell:** `AppShell` + `StaffSidebar` generated from `src/navigation/navRegistry.js` (flat items under section
  labels, Settings pinned, mobile pills + "More" sheet), ⌘K palette, `BranchSwitcher`, `NotificationBell`.
- **Building blocks:** `SidePanel`, `PanelFormKit`, `ListToolbarKit`, `ModalShell`, `ConfirmDialog`, `Spotlight`,
  wallet cards. **Every dropdown uses `CustomSelect`, never a native `<select>`** (CLAUDE.md quality standard 8).
- **Area pattern:** one sidebar item → an area with tabs (`areaTabsRegistry.js`); Reports and Settings as hubs
  with their own registries.

## Working rules that follow from this

- The build must match the approved board for its screen (lead compares before the owner check).
- After each UI step the owner tests it in the local app, then OKs the commit.
- New UI from Anish's features is built from the existing building blocks above, not new look-alike components.

## Open (owner to decide)

- Where staff access lives in the UI (ZNLY-205): proposed as an **Access** section on each team member's profile.
