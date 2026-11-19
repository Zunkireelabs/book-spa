# Zennly Domain Migration + Transactional Email

**Decided:** rebrand `Zenly` → `Zennly` · marketing site out of scope · auth email first
**Target:** `zennly.io` (marketing, external) · `app.zennly.io` (prod) · `dev-app.zennly.io` (stage)
**Cutover rule:** new domain verified working → clients notified → then old domain retired

---

## Phase 0 — Verified infrastructure facts (checked 2026-08-18)

```
zenly.zunkireelabs.com       -> 94.136.189.213
dev-zenly.zunkireelabs.com   -> 94.136.189.213   (SAME VPS, confirmed)
zennly.io                    -> 2.57.91.91  NS: nebula/aurora.dns-parking.com (Hostinger, parked)
app.zennly.io                -> NXDOMAIN
dev-app.zennly.io            -> NXDOMAIN
```

- **VPS:** `94.136.189.213` — Contabo Ubuntu, shared box, ~53 containers, single Traefik
  on external `hosting` network. Stage + prod for bookX are BOTH on this box
  (`nuad-thai-dev` / `nuad-thai-prod`).
- **DNS registrar/host:** Hostinger (zone is on `dns-parking.com` nameservers).
- **Disk pressure is chronic** on this box (86–94% across recent audits). Not a blocker
  for this work, but do not add anything image-heavy during cutover.

### Ownership split (per office guardrails)
| Piece | Owner |
|---|---|
| DNS records, domain registration | Sadin |
| Workflow/compose/Traefik-label edits (as a PR) | `deployment-ops` |
| Applying `docker compose up -d` on the box | `infrastructure-ops` handoff |

### Pre-state verified on the box (2026-08-18, force-resolved to the VPS)

```
app.zennly.io      http=301  https=404   <- Traefik reachable, no router yet (expected)
dev-app.zennly.io  http=301  https=404   <- same
TLS for unknown host: CN=TRAEFIK DEFAULT CERT (self-signed)
```

Old domains are healthy (`https=200` on both). Nothing blocks Phase 2 on the VPS side —
the only missing piece is the router labels themselves.

⚠️ Apex `zennly.io` + `www` were pointed at the VPS too, but marketing is on separate
hosting. Until a router exists for them, visitors get a cert warning + 404. Decide:
remove the records, or add a temporary apex → `app.zennly.io` redirect.

⚠️ TTLs were set to 14400 (4h), not the recommended 300. A mid-cutover correction will
take 4 hours to propagate.

### Remaining prerequisites
- [ ] Confirm Resend account + which team/domain it sits under
- [ ] Decide sending identity (recommendation below)

**Sending domain recommendation:** send from a **subdomain**, not the apex.
- Transactional (auth + booking): `no-reply@mail.zennly.io`, Reply-To a real inbox
- Later marketing/newsletter: a *separate* subdomain e.g. `news.zennly.io`

Why: a marketing blast that gets spam-flagged must not be able to take booking
confirmations and password resets down with it. Separate subdomains = separate
reputation. Apex stays clean for the website.

---

## Phase 1 — DNS (do first, propagation lag)

Add in the **Hostinger DNS zone** for `zennly.io`:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `app` | `94.136.189.213` | 300 |
| A | `dev-app` | `94.136.189.213` | 300 |

- [ ] Add both A records (TTL 300 during cutover; raise after)
- [ ] ⚠️ If the zone moves to Cloudflare: keep these **DNS-only (grey cloud)**.
      Traefik uses LetsEncrypt HTTP-01, which cannot complete behind Cloudflare's proxy.
      LetsEncrypt rate-limits **5 failed validations per hostname per hour** — a
      misconfigured proxy locks you out of retrying.
- [ ] **GATE:** `dig +short app.zennly.io` and `dig +short dev-app.zennly.io` must both
      return `94.136.189.213` from 2+ resolvers **before** Phase 2 touches Traefik.
- [ ] Resend domain `mail.zennly.io`: add the DKIM `CNAME`/`TXT` + SPF `TXT` + `MX` records Resend generates
- [ ] `TXT _dmarc.zennly.io` → `v=DMARC1; p=none; rua=mailto:dmarc@zennly.io`
      (start at `p=none`, review reports ~2 weeks, then move to `p=quarantine`)
- [ ] Verify domain in Resend dashboard
- [ ] Apex `zennly.io` + `www` → point at marketing host (out of scope, but do not leave apex dangling)

---

## Phase 2 — Serve the app on the new domain (old still live)

Additive only. Nothing breaks while this lands.

🚨 **Host rules are ADDITIVE, never a replacement.** Traefik matches multiple hosts with
`||` and issues one cert with a SAN for all of them, so old and new serve simultaneously:

```
rule=Host(`app.zennly.io`) || Host(`zenly.zunkireelabs.com`)
```

- [ ] `docker-compose.yml` — both prod rules carry new **and** old host
- [ ] `docker-compose.dev.yml` — both stage rules carry new **and** old host
- [ ] Confirm LetsEncrypt issues certs for both new hosts before touching anything else
- [ ] `vite.config.mjs:15` — `allowedHosts: ['dev-app.zennly.io', 'app.zennly.io']`

⚠️ **Router names must be namespaced.** `CONVENTIONS.md`: Traefik router name = container
name. This is ONE Traefik serving ~53 containers from other projects — a generic router
name (`legacy`, `app`, `web`) risks a silent cross-project conflict. Keep the existing
`nuad-thai-prod` / `nuad-thai-dev` router names; suffix any new router.

**Stop hardcoding the domain.** `CONVENTIONS.md` mandates GitHub Variables
`STAGING_DOMAIN` / `PROD_DOMAIN`, but bookX hardcodes the host in 3 workflow health
checks. Since all three are being edited anyway:
- [x] ~~Create repo variables `PROD_DOMAIN` / `STAGING_DOMAIN`~~ — **done 2026-08-18**,
      deliberately set to the **OLD** domains. The health check runs seconds after
      `compose up`; pointing it at the new host before LetsEncrypt has issued that cert
      would fail the deploy on a healthy app. Flipping these two values is the actual
      cutover switch in Phase 6 — one field, no code change, no redeploy.
- [ ] Health checks reference `${{ vars.PROD_DOMAIN }}` / `${{ vars.STAGING_DOMAIN }}`

After this, the next domain change is a variable edit, not a code change.

**Do NOT rename** (infra identifiers, renaming adds rollback risk for zero user benefit):
`ghcr.io/zunkireelabs/book-spa` · container names `nuad-thai-prod` / `nuad-thai-dev` ·
server paths `/home/zunkireelabs/devprojects/...`

---

## Phase 3 — External services allowlists  ⚠️ SILENT-FAILURE ZONE

These fail *quietly and only on the new domain*. Password reset appears to work
(no error shown) but the link 404s or redirects to the old host. Do these BEFORE
telling anyone to use the new URL.

Supabase — **both projects separately** (staging `snzcckzfmpboeqkktmwy`, prod `pmbvogiphelmpjdalmtv`):
- [ ] Auth → URL Configuration → **Site URL** → new domain
- [ ] Auth → URL Configuration → **Redirect URLs** allowlist → add `https://app.zennly.io/auth/callback`
      (stage: `https://dev-app.zennly.io/auth/callback`). Keep old entries until cutover.
      Consumed by `src/pages/login/components/LoginForm.jsx:61`
- [ ] `pin-login` Edge Function — check for a hardcoded CORS origin allowlist.
      Source is **not in this repo**; edit in the Supabase dashboard, deploy to both projects.

- [ ] PostHog → project settings → add new domains to authorized/allowed domains

---

## Phase 4 — Rebrand Zenly → Zennly

**Rename (user-visible):**
- [ ] `index.html:5,8` — `<title>` + meta description
- [ ] `public/manifest.json` — `short_name`, `name`
- [ ] `src/components/ui/StaffSidebar.jsx:403`
- [ ] `src/components/ui/AuthenticationModal.jsx:127`
- [ ] `src/components/ui/CustomerHeader.jsx:11,57` — default/fallback org name
- [ ] `src/components/ui/AIAssistant/AIAssistantPanel.jsx:14,39,121`
- [ ] `src/pages/org-finder/index.jsx:115,159,231` — incl. footer copyright
- [ ] `src/pages/branch-staff-dashboard/components/StaffHeader.jsx:82`
- [ ] `src/pages/branch-manager-dashboard/index.jsx:405,406`
- [ ] `src/pages/attendance-calendar/index.jsx:434` — PDF export footer
- [ ] `src/pages/booking-details-assignment-modal/components/CustomerCommunicationPanel.jsx:14-31`
      — SMS + email template copy (reused in Phase 5, do it here once)
- [x] ~~`public/dev-info.html`~~ — **deleted 2026-08-18**, published live admin
      credentials at a public prod URL. Rotate/remove those Supabase Auth accounts.
- [ ] `.claude/skills/creative-director/SKILL.md:30` — footer branding rule

**Leave alone:**
- `src/styles/tailwind.css` `.zenly-wc-*` (~60 internal CSS class names, zero user impact,
  high diff noise). Comments in that file are also internal.
- `docs/session-logs/*` — historical record, do not rewrite history.

**Assets:**
- [ ] Check `favicon.svg` / `favicon.ico` for a wordmark that needs redrawing

**Docs:**
- [ ] `CLAUDE.md:82,83,329,330` — env + deploy tables
- [ ] `supabase/PROMOTION.md:24,25`

---

## Phase 5 — Auth email via Resend SMTP  ← FIRST EMAIL DELIVERABLE

Config-only, no code. Fixes the current state: auth mail goes out over Supabase's
**shared** SMTP (`noreply@mail.app.supabase.io`, ~2 emails/hour rate limit).

- [ ] Resend → create SMTP credentials
- [ ] Supabase → Auth → SMTP Settings → enable custom SMTP (`smtp.resend.com:465`,
      user `resend`, pass = API key), sender `no-reply@mail.zennly.io`, name `Zennly`
- [ ] Do this in **both** projects
- [ ] Auth → Email Templates → rebrand + point links at the new domain
- [ ] Test: trigger a password reset on stage, confirm delivery + header alignment
      (SPF pass, DKIM pass, DMARC aligned)

---

## Phase 6 — Verify on new domain, old domain still live

- [ ] `.github/workflows/deploy.yml` health check → `https://app.zennly.io`
- [ ] `.github/workflows/rollback.yml:75` → `https://app.zennly.io`
- [ ] `.github/workflows/deploy-staging.yml:129` → `https://dev-app.zennly.io/login`
- [ ] Manual pass on `dev-app.zennly.io`: staff login, PIN login, password reset,
      customer booking flow `/{orgSlug}/book`, realtime updates
- [ ] Repeat on `app.zennly.io`
- [ ] **CUTOVER SWITCH:** flip the repo variables to the new domains —
      `gh variable set PROD_DOMAIN --body app.zennly.io` and
      `gh variable set STAGING_DOMAIN --body dev-app.zennly.io`
- [ ] Re-run a deploy and confirm the health check passes against the new host
- [ ] **Only then** notify clients

Old domains are still fully live at this point. Nothing has broken for anyone.

---

## Phase 7 — Retire old domain

Old URLs are in the wild and we do not control them: tenant booking links
(`/{orgSlug}/book`) are printed, in bios, in WhatsApp threads.

**Recommended — redirect, not hard cut.** This is NOT a second deployment:
it is ~5 Traefik labels on the *same* container. Zero extra RAM, zero extra containers.

```yaml
- "traefik.http.routers.legacy.rule=Host(`zenly.zunkireelabs.com`)"
- "traefik.http.routers.legacy.entrypoints=websecure"
- "traefik.http.routers.legacy.tls.certresolver=letsencrypt"
- "traefik.http.routers.nuad-thai-prod-legacy.middlewares=nuad-thai-prod-legacy-redirect"
- "traefik.http.middlewares.nuad-thai-prod-legacy-redirect.redirectregex.regex=^https://zenly\\.zunkireelabs\\.com/(.*)"
- "traefik.http.middlewares.nuad-thai-prod-legacy-redirect.redirectregex.replacement=https://app.zennly.io/$${1}"
- "traefik.http.middlewares.nuad-thai-prod-legacy-redirect.redirectregex.permanent=true"
```

Path-preserving, so `/nuad-thai-spa/book` keeps resolving.

- [ ] Add redirect rules for prod + stage old hosts
- [ ] Remove old domains from Supabase Redirect URL allowlists
- [ ] Verify a deep link redirects correctly

---

## Phase 8 — Later (explicitly deferred)

- [ ] Booking confirmation email — new Edge Function + Resend API.
      Templates already drafted as strings in `CustomerCommunicationPanel.jsx:14-31`.
- [ ] Day-before reminders — needs a scheduled trigger (pg_cron / scheduled function)
- [ ] Wire the two stub "Send Email" buttons
      (`CustomerCommunicationPanel.jsx:292`, `booking-details-assignment-modal/index.jsx:323`)
- [ ] DMARC `p=none` → `p=quarantine` after reports look clean

---

## ⚠️ Sequencing — do NOT stack this on the unmerged CI/CD branch

Current branch `deploy/book-spa-cicd-and-migrations` is **unmerged** and carries:
- build-on-VPS → build-in-CI + GHCR migration
- rollback.yml rewritten to re-point image tags
- 45 migrations restructured + **13 reconstructed** from live prod schema
- 3 of those (046, 055, 060) flagged low/medium confidence, pending Sadin's review

Landing the domain migration on top means that if prod breaks after cutover, the cause is
ambiguous across four independent changes: domain, CI build location, rollback mechanism,
schema reconstruction. That is an unfalsifiable failure.

**Required order:**
1. Review 046/055/060 → merge `deploy/book-spa-cicd-and-migrations` → verify staging healthy
2. Branch fresh off `stage` for domain work
3. DNS (Phase 1) can proceed **in parallel today** — A records are inert until a Traefik
   router matches them

---

## Notes

- Deploys ship **frontend only**. Nothing in this migration is a DB schema change,
  so no migration files and no prod SQL handoff required.
- `supabase/functions/` is not tracked in this repo — the `pin-login` function is
  managed in the Supabase dashboard and must be updated per project.
- Branch strategy: `feature/*` → `stage` → `main`. PRs target `stage`.
- Do NOT rename VPS dirs / containers to the `book-spa-app-*` convention as part of this.
  `CONVENTIONS.md` grandfathers `nuad-thai-*` and says do not rename existing dirs.
  Changing the domain does not unlock that; bundling it doubles the blast radius.
