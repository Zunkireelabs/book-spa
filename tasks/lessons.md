# Lessons

Patterns captured after a correction from the user, per CLAUDE.md § Self-Improvement Loop.
Each entry: what went wrong, why, and the rule that prevents the repeat. Review at session start.

---

## 1. Query the database before writing a spec that quotes numbers

**2026-11-13.** Briefed a mockup with "82 therapists / 22 login accounts". Those were totals
across all five tenants in the staging database. Staff access is org-scoped, so the only
numbers that mattered were Nuad Thai Spa's: **63 therapists (61 active) / 16 accounts**. The
whole board was built on the wrong base, and every derived figure had to be rescaled.

Repeated the same mistake twice more in one session: estimated the role mix as "~4/4/6/2"
when the real spread was 6 staff / 5 manager / 3 admin / 2 admin_viewer, and scaled support
staff from a stale ratio (13) when the true count was 15.

**Why it happened:** aggregating without filtering by `org_id`, then trusting the memory of a
query instead of re-running it.

**Rule:** any number that will appear in a spec, mockup or plan gets queried first, filtered
to the relevant org. `~/.pgpass` is configured for both stage and prod — a count is one
command. Never scale, estimate, or carry a figure forward from an earlier message. If a
number can't be queried, label it as invented in the artifact itself.

---

## 2. An aggregate target never overrides a known-correct specific value

**2026-11-13.** Gave a subagent a role-mix target (which was itself wrong — see above). To hit
it, the agent changed Muskan Shrestha from `staff` to `manager`. Her row had been **correct**
the round before; satisfying the aggregate broke a verified fact.

**Rule:** when a distribution target and an individually-verified value conflict, the
individual wins. Adjust the invented/filler entries to reach the target, never the ones
checked against a source. State this explicitly in any brief that includes both real and
seeded data, and leave a comment in the file next to the seed so the next edit doesn't repeat
it.

---

## 3. Fix the category, not the instance the user pointed at

**2026-11-13.** The user flagged mockup scaffolding rendering inside a panel meant to be an
exact replica of a real screen — three separate times:
1. a `MOCKUP ONLY` note inside the simulated viewport
2. a green explanatory callout plus two capability cards
3. a paragraph under a section heading ("still I am finding the one paragraph lines of
   suggestion")

Each round removed only the specific element named. Two of the three were elements that had
been specified in the original brief.

**Why it happened:** treating each report as a defect rather than as evidence of a rule being
broken repeatedly.

**Rule:** when a correction describes a *kind* of problem, sweep the whole artifact for that
kind before replying. Say what the general rule is, apply it everywhere, and report the
instances found beyond the one reported. A user pointing at the same category twice means the
first fix was too narrow.

---

## 4. Verify a claim in the artifact, not in the report

**2026-11-13.** Subagent reports were accurate in substance but twice described work that
hadn't been checked the way the wording implied: a "scrolled all 6 panels to confirm layout"
claim that missed ~1,500px of dead space in the first panel, and a file reported complete
that had a JavaScript syntax error making its entire script fail to parse.

Both were caught by independently loading the page and measuring, not by reading the report
more carefully.

**Rule:** before accepting delegated work, re-run the check yourself on the artifact —
measure geometry in the DOM, grep the file, click the control. Reports describe intent;
artifacts carry truth. Equally: when *writing* a report, scope the claim to exactly what was
done ("checked panels 1–2 closely, did not re-open 3–6") rather than a blanket statement.

---

## 5. Re-check that referenced files still exist

**2026-11-13.** Briefed a subagent to model an app shell from two screenshots read earlier in
the same session. The user had deleted them in the meantime. The agent checked, found them
missing, and built from the real source components instead — which was the better input
anyway.

**Rule:** a file read earlier in a session may be gone. `ls` before citing a path in a brief,
especially user-supplied screenshots in a scratch directory. And prefer the source of truth
(the actual component) over a screenshot of it when both are available.

---

## 6. Native browser APIs now shadow custom global functions in inline handlers

**2026-11-13.** A mockup's `togglePopover(...)` in an inline `onclick` silently did nothing.
Every `HTMLElement` now exposes a native `togglePopover()` via the Popover API, and inside an
inline handler the element's own method shadows the page's global of the same name.

**Rule:** `showPopover`, `hidePopover`, `togglePopover`, `showModal` and `close` are unsafe as
custom function names in any page using inline handlers. Prefix them (`toggleTierPopover`).
Applies to mockups and production JSX alike.

---

## 7. Don't conflate "unconfigured" with a real value

**2026-11-13, production bug.** `fetchTherapistWorkingHours` returns `isDayOff: true` for any
weekday with no row, and the staff-detail form defaults to all-seven-days-off. The form then
writes working hours on *every* save, so editing a staff member's phone number silently
recorded "never works" and blanked their calendar column. Two therapists hit this in
production.

**Rule:** a missing row and a meaningful value must stay distinguishable — return `null` for
"not configured" and let the caller decide. And never write a sub-form the user did not
interact with; dirty-track it.

---

## 8. Cross-session work needs the same ticket discipline as inline work

**2026-11-13.** A full session of work — a PIN lock screen, two mockup boards, a production
data fix — produced zero ZNLY tickets, because the `plane` MCP server was not connected and
the gap was mentioned rather than resolved.

**Rule:** if `plane` tools are missing at session start, say so and ask the user to
authenticate (`/mcp` → plane) *before* starting work, not after. CLAUDE.md's hard rule is
explicit: no work without a ticket, and a PR without a ZNLY id in its title doesn't merge.
Noting the gap repeatedly is not the same as closing it.

## 2026-11-21: PR to stage failed CI three ways that local checks hid
- **Pattern:** local `npm test` + `npm run build` passed; CI failed on (1) `npm ci` because the lockfile was regenerated with npm 11 while CI uses node 22 / npm 10, (2) ESLint parse error on a duplicate import that Vitest tolerates, (3) a test that relied on a flag from the untracked local `.env` (CI only has the tracked `.env.local`).
- **Rule:** before opening any PR, run the CI sequence from clean: `rm -rf node_modules && npm ci && npm run lint && npm test && npm run build`, with any untracked `.env*` moved aside. Regenerate lockfiles with `npx npm@10` when adding a dependency. Tests that depend on feature flags must mock `lib/featureFlags`.

## 2026-11-21: review every line of a new runtime file, not just a grep
- ZNLY-332: I reviewed the edge functions by grepping for secret/auth lines. A block pasted twice (lines 67–89 of marketplace-create-booking/index.ts) slipped through, and the function failed to BOOT on staging. Its tests only covered the _shared helpers, so nothing parsed index.ts.
- Rule: every new runtime entry file (edge function, route, migration) gets a full read in review, and a parse/compile check in the test suite. A harness that never loads the entry file doesn't prove the entry file works.

## 2026-11-21: run every CI migration check locally before a PR, not only the ones I remember
- ZNLY-358: PR #469 passed build/test/check-migrations, but the staging deploy failed at `scripts/check-rls-initplan.sh` (migration 411 policy called `auth.uid()` unwrapped). The frontend did not deploy.
- Rule: before committing any migration, run every check the deploy workflow runs against a DB (`grep -n "scripts/" .github/workflows/deploy*.yml`), including check-rls-initplan.sh, against the local DB with the migration applied.
- macOS bash 3.2 can't run `migrate-apply.sh` (`declare -A`). Run it in a container: `docker run --rm -v "$PWD":/w:ro -w /w -e PGHOST=host.docker.internal -e PGPORT=56422 -e PGUSER=postgres -e PGPASSWORD=postgres -e PGDATABASE=postgres -e PGSSLMODE=disable postgres:16 bash scripts/migrate-apply.sh local --dry-run`.

## 2026-11-24: a mockup must be built from the real app, not from tokens (ZNLY-401/402)
- Correction (owner): "is this mockup actually how our UI is? I can't approve a mockup if I don't see how it will actually look."
- Cause: the Gate 3 mockup reused our colour tokens but invented the layout (centred modal, plain calendar, no sidebar/avatars, wrong card style). Lead did not compare it with the running app before presenting it.
- Rule: before showing ANY mockup, the lead screenshots the real screen (agent-browser on the local app) and compares it with the mockup. A mockup must reuse the real markup/classes/stylesheet of the screen it changes (right-side slide-over, sidebar, toolbar, staff header, card style), show CURRENT next to NEW, and mark only the real changes as NEW.
