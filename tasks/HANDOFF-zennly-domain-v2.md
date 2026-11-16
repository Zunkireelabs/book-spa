# HANDOFF v2 — Zennly domain migration (rebased on real `stage`)

**Planner:** Opus · **Executor:** Sonnet · **Date:** 2026-08-18
**Target repo:** `/Users/sadinshrestha/Projects/bookX`
**Base:** `origin/stage` @ `7740b08` (v1 was cut from a stale base 265 commits behind — that
branch is closed, PR #107 closed. Ignore `tasks/HANDOFF-zennly-domain-2026-08-18.md`.)

Execute exactly as written, in order. Report each gate. If a gate fails, **STOP and
report** — do not diagnose, do not adapt, do not try the next thing.

---

## The one rule that outranks everything else

🚨 **`zenly.zunkireelabs.com` and `dev-zenly.zunkireelabs.com` MUST KEEP WORKING.**
Clients are actively using both right now. Every change here is **additive**: the new
zennly.io hosts are added *alongside* the old ones. Nothing in this handoff may make an
existing URL stop responding. If any edit you make would take an old URL down, you have
done it wrong — stop and report.

---

## Context

`app.zennly.io` and `dev-app.zennly.io` DNS already resolve to the VPS (`94.136.189.213`)
and are verified propagated. Both environments run on that one shared box behind **one
Traefik** serving ~53 containers from other projects. **Do not touch DNS.**

Product rename: `Zenly` → `Zennly` (the new domain is double-n).

---

## Scope

### ✅ In scope
Compose Traefik labels, `vite.config.mjs`, three workflow health checks, the
`Zenly` → `Zennly` rename, docs. Deliverable is **an unmerged PR to `stage`**.

### 🚫 NOT in scope
- **SSH to the VPS.** You produce config; `infrastructure-ops` applies it.
- **DNS changes.** Done.
- **Supabase dashboard config** (Site URL, Redirect URLs, SMTP). Sadin does this.
- **Renaming containers, VPS dirs, GHCR image, or Traefik router names.**
  `CONVENTIONS.md` grandfathers `nuad-thai-*`.
- **`src/styles/tailwind.css`** — 68 internal `.zenly-wc-*` / comment hits. Leave untouched.
- **Anything touching migrations or the DB.** Not part of this task.
- **Merging.** Sadin reviews.

---

## Step 0 — Branch

```bash
cd /Users/sadinshrestha/Projects/bookX
git checkout stage && git pull origin stage --ff-only
git checkout -b feature/zennly-domain
```

**GATE:** `git branch --show-current` → `feature/zennly-domain`, tree clean apart from
untracked `tasks/` and `docs/report-for-client/`.

---

## Step 1 — Traefik host rules (ADDITIVE)

Traefik matches multiple hosts with `||` and the cert resolver issues one cert with a SAN
covering every `Host()` in the rule — so old and new both serve with valid TLS.

`docker-compose.yml` lines **18** and **22** — change the rule value only:
```
Host(`app.zennly.io`) || Host(`zenly.zunkireelabs.com`)
```

`docker-compose.dev.yml` lines **16** and **20**:
```
Host(`dev-app.zennly.io`) || Host(`dev-zenly.zunkireelabs.com`)
```

Router names (`nuad-thai-prod`, `nuad-thai-prod-http`, `nuad-thai-dev`,
`nuad-thai-dev-http`) stay exactly as they are.

**GATE:**
```bash
grep -n 'Host(' docker-compose.yml docker-compose.dev.yml
```
All 4 rules must contain **both** a `zennly.io` host and a `zunkireelabs.com` host.
Any rule with only one host → STOP AND REPORT.

---

## Step 2 — Vite allowed hosts

`vite.config.mjs` line 15 — **add**, don't replace:
```js
allowedHosts: ['dev-app.zennly.io', 'app.zennly.io', 'dev-zenly.zunkireelabs.com', 'zenly.zunkireelabs.com'],
```

---

## Step 3 — Health checks → repo variables

| File | Line | Replace host with |
|---|---|---|
| `.github/workflows/deploy.yml` | 163 | `${{ vars.PROD_DOMAIN }}` |
| `.github/workflows/rollback.yml` | 74 | `${{ vars.PROD_DOMAIN }}` |
| `.github/workflows/deploy-staging.yml` | 139 | `${{ vars.STAGING_DOMAIN }}` (keep the `/login` path) |

🚨 **The variables deliberately hold the OLD domains** — verified current values:
```
PROD_DOMAIN      zenly.zunkireelabs.com
STAGING_DOMAIN   dev-zenly.zunkireelabs.com
```
**Do not "correct" them to zennly.io.** The health check runs seconds after
`docker compose up -d`; pointing it at a host whose LetsEncrypt cert may not be issued yet
would fail the deploy on a healthy app. Flipping these two values is the deliberate
cutover switch, done later by Sadin.

📋 **REPORT-ONLY — verify only.** `gh variable list`. If values differ → STOP AND REPORT.

**GATE:**
```bash
grep -rn 'zunkireelabs\.com' .github/workflows/
```
Expect zero. (`ghcr.io/zunkireelabs/book-spa` has no `.com` — if your grep hits it, your
pattern is wrong. Do NOT change the image name.)

---

## Step 4 — Rebrand `Zenly` → `Zennly`

⚠️ **Do NOT run a blanket `sed` across `src/`.** `src/styles/tailwind.css` has 68 hits
(`.zenly-wc-*` class names, `@keyframes`, and capitalised `Zenly` in comments). Rewriting
it breaks the animation CSS.

Enumerate the real targets yourself — do not trust a hardcoded line list, it goes stale:
```bash
grep -rIn 'Zenly' src/ public/ index.html | grep -v 'src/styles/tailwind.css'
```
That is ~51 hits across ~20 files (org-finder, sidebar, headers, auth modal, customer
signup/login/reset/forgot-password, booking flow, management portal, customer account,
AI assistant, attendance-calendar PDF footer, communication templates, `index.html`,
`public/manifest.json`). Change the brand token only; leave surrounding markup identical.

Note `src/components/ui/CustomerHeader.jsx` uses `'Zenly'` as a **tenant fallback org
name** — rename it, but keep it a fallback.

**GATES:**
```bash
git diff --stat -- src/styles/tailwind.css     # must be EMPTY
grep -rIn 'Zenly' src/ public/ index.html | grep -v 'src/styles/tailwind.css'   # must be EMPTY
```
If `tailwind.css` shows any diff → STOP AND REPORT.

---

## Step 5 — Delete the credential-leaking page

```bash
git rm public/dev-info.html
```
It is served at `/dev-info.html` on production with **no authentication** and lists working
Supabase Auth logins for staff, manager and admin (its own footnote confirms they are real;
the admin entry carries Platform Admin + branch-switcher access). Nothing links to it and
its content is stale. Do not rebrand it, do not keep a copy.

**GATE:** `git status --short | grep dev-info` → shows `D  public/dev-info.html`

---

## Step 6 — Docs

`CLAUDE.md` — the env table (staging/production domain rows) and the deploy table
(`deploy-staging.yml` / `deploy.yml` target columns). Find them with:
```bash
grep -n 'zenly\.zunkireelabs\|dev-zenly\.zunkireelabs' CLAUDE.md supabase/PROMOTION.md
```
Domain values only. Do not touch the Supabase project refs
(`snzcckzfmpboeqkktmwy`, `pmbvogiphelmpjdalmtv`).

---

## Step 7 — Build

```bash
npm run build
```
Primary validation gate for this repo — there is no test or lint script, do not invent one.
**GATE:** exit 0. If it fails → STOP AND REPORT with the full error.

---

## Step 8 — PR

```bash
git add -A
git commit -m "$(cat <<'MSG'
chore(domain): serve zennly.io alongside zunkireelabs.com, rebrand to Zennly

Traefik rules now match BOTH the new zennly.io host and the existing
zunkireelabs.com host, so every existing URL keeps working with valid TLS.
No existing URL changes behaviour with this commit.

Health checks read PROD_DOMAIN / STAGING_DOMAIN repo variables per
CONVENTIONS.md instead of hardcoding the host; the variables still point at
the old domains, and flipping them is the later cutover switch.

Rebrand user-visible "Zenly" to "Zennly"; internal .zenly-wc-* CSS untouched.
Container names, VPS directories, Traefik router names and the GHCR image are
unchanged per CONVENTIONS.md.

Removes public/dev-info.html, which served working staff/manager/admin
Supabase Auth credentials at an unauthenticated production URL.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
MSG
)"
git push -u origin feature/zennly-domain
gh pr create --base stage \
  --title "chore(domain): serve zennly.io alongside existing domains + rebrand to Zennly" \
  --body "**No existing URL changes behaviour.** Traefik matches new and old hosts
simultaneously; PROD_DOMAIN / STAGING_DOMAIN still hold the old domains. Cutover later is
flipping those two variables — no further code change.

Also removes public/dev-info.html (unauthenticated prod URL serving real admin credentials).
The exposed accounts still need deleting/rotating in the prod Supabase project.

Follow-up, not in this PR: infrastructure-ops applies the compose change on the VPS,
staging first, confirming BOTH dev-app.zennly.io and dev-zenly.zunkireelabs.com return 200.

Created by @sthasadin"
```

**PR targets `stage`, never `main`.**

---

## Report back

Per step: what changed, which gates passed, anything skipped. Explicitly confirm:
1. All 4 Traefik rules carry **both** new and old hosts
2. `tailwind.css` diff is empty
3. Zero `zunkireelabs.com` in `.github/workflows/`
4. Repo variables still hold the **old** domains
5. `npm run build` exit code
6. `public/dev-info.html` deleted
7. You did **not** SSH anywhere, touch DNS, touch migrations, or merge
