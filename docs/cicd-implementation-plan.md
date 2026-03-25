# BookSpa CI/CD Implementation Plan

**Date:** 2026-03-25
**Repository:** [Zunkireelabs/book-spa](https://github.com/Zunkireelabs/book-spa)
**Reference Pattern:** lead-gen-crm (edgexcrm) CI/CD pipeline

---

## Domains

| Environment | Domain |
|-------------|--------|
| Production  | `bookings.zunkireelabs.com` |
| Development | `dev-bookings.zunkireelabs.com` |

## Architecture Decision

**Shared Supabase project for dev and prod** (same pattern as lead-gen-crm).
- Supabase project: `pmbvogiphelmpjdalmtv`
- BookSpa will be multi-tenant in future — RLS with branch-scoped access already handles data isolation
- Migrations are manual SQL files, so no risk of dev auto-migrations breaking prod
- One fewer project to manage/pay for; swap env var later if separation ever needed

---

## Phase 1: Git & Branch Cleanup

| # | Task | Details |
|---|------|---------|
| 1 | Commit uncommitted changes | 27 modified + 9 untracked files on current branch |
| 2 | Rename `master` → `main` | Local + GitHub remote default branch |
| 3 | Create `stage` branch | From `main`, push to remote |
| 4 | Set `stage` as working branch | Dev clone stays on `stage` |

**Post-state:** Two branches — `main` (production) and `stage` (development)

---

## Phase 2: Docker & Deployment Config

| # | Task | Details |
|---|------|---------|
| 5 | Update `docker-compose.dev.yml` | Change domain from `dev-nuad.zunkireelabs.com` → `dev-bookings.zunkireelabs.com`, update Traefik labels |
| 6 | Create `docker-compose.yml` (production) | Container: `nuad-thai-prod`, domain: `bookings.zunkireelabs.com`, Traefik + Let's Encrypt, `hosting` network |
| 7 | Add health checks to both compose files | `wget --spider http://127.0.0.1:80/` — interval 30s, timeout 10s, retries 3, start_period 15s |
| 8 | Update/retire `deploy.sh` | Either update domains or remove (CI/CD replaces manual deploy) |
| 9 | Create `.env.example` | Placeholder `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| 10 | Update `vite.config.mjs` | Add `bookings.zunkireelabs.com` to allowed hosts |
| 11 | Update `nginx.conf` if needed | Ensure `/` returns 200 for health checks (already does via SPA fallback) |

### Production `docker-compose.yml` (target)

```yaml
services:
  app:
    container_name: nuad-thai-prod
    build:
      context: .
      dockerfile: Dockerfile
    env_file:
      - .env
    networks:
      - hosting
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:80/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.nuad-thai-prod.rule=Host(`bookings.zunkireelabs.com`)"
      - "traefik.http.routers.nuad-thai-prod.entrypoints=websecure"
      - "traefik.http.routers.nuad-thai-prod.tls=true"
      - "traefik.http.routers.nuad-thai-prod.tls.certresolver=letsencrypt"
      - "traefik.http.routers.nuad-thai-prod-http.rule=Host(`bookings.zunkireelabs.com`)"
      - "traefik.http.routers.nuad-thai-prod-http.entrypoints=web"
      - "traefik.http.routers.nuad-thai-prod-http.middlewares=nuad-thai-prod-redirect"
      - "traefik.http.middlewares.nuad-thai-prod-redirect.redirectscheme.scheme=https"
      - "traefik.http.services.nuad-thai-prod.loadbalancer.server.port=80"

networks:
  hosting:
    external: true
```

---

## Phase 3: GitHub Actions CI/CD (4 workflows)

### 3a. `.github/workflows/ci.yml` — PR Checks

- **Trigger:** Pull requests to `main` or `stage`
- **Concurrency:** Cancel in-progress runs for same ref
- **Job:** Build validation
  1. Checkout code
  2. Setup Node 22
  3. `npm ci`
  4. `npm run build` (Vite build catches broken imports, JSX errors)
- **Note:** No lint/typecheck jobs — project is vanilla JS without ESLint or TypeScript configured. Can add later.

### 3b. `.github/workflows/deploy-staging.yml` — Staging Deploy

- **Trigger:** Push to `stage` branch
- **Concurrency:** No cancellation (preserve deploy order)
- **Environment:** `staging`
- **Steps:**
  1. Pre-deploy: same build check as CI
  2. SSH to `94.136.189.213`:
     ```bash
     cd /home/zunkireelabs/devprojects/nuad-thai-web-app
     git pull origin stage
     docker compose -f docker-compose.dev.yml up -d --build
     # Health check: 12 attempts x 10s = 2 min timeout
     for i in $(seq 1 12); do
       STATUS=$(docker inspect nuad-thai-dev --format='{{.State.Health.Status}}' 2>/dev/null)
       [ "$STATUS" = "healthy" ] && break
       sleep 10
     done
     [ "$STATUS" = "healthy" ] || exit 1
     ```
  3. HTTP health verify: `curl -sf https://dev-bookings.zunkireelabs.com` → expect 200

### 3c. `.github/workflows/deploy.yml` — Production Deploy

- **Trigger:** Push to `main` branch
- **Concurrency:** No cancellation
- **Environment:** `production` (requires approval)
- **Steps:**
  1. Pre-deploy: build check
  2. SSH to `94.136.189.213`:
     ```bash
     cd /home/zunkireelabs/devprojects/nuad-thai-web-app-prod
     git pull origin main
     docker compose up -d --build
     # Health check: 12 attempts x 10s
     for i in $(seq 1 12); do
       STATUS=$(docker inspect nuad-thai-prod --format='{{.State.Health.Status}}' 2>/dev/null)
       [ "$STATUS" = "healthy" ] && break
       sleep 10
     done
     [ "$STATUS" = "healthy" ] || exit 1
     ```
  3. HTTP health verify: `curl -sf https://bookings.zunkireelabs.com` → expect 200

### 3d. `.github/workflows/rollback.yml` — Manual Rollback

- **Trigger:** Manual workflow dispatch
- **Inputs:** `commit_sha` (required), `reason` (optional)
- **Environment:** `production`
- **Steps:**
  1. SSH to server:
     ```bash
     cd /home/zunkireelabs/devprojects/nuad-thai-web-app-prod
     git fetch origin
     git checkout <commit_sha>
     docker compose up -d --build
     # Same health check loop
     ```
  2. HTTP health verify

---

## Phase 4: Server Setup (Manual Steps)

| # | Task | Details |
|---|------|---------|
| 16 | Add DNS A records | `bookings` → `94.136.189.213` and `dev-bookings` → `94.136.189.213` at dns-parking.com |
| 17 | Clone prod directory on server | `cd /home/zunkireelabs/devprojects && git clone git@github.com:Zunkireelabs/book-spa.git nuad-thai-web-app-prod` |
| 18 | Checkout `main` in prod clone | `cd nuad-thai-web-app-prod && git checkout main` |
| 19 | Copy `.env` to prod clone | Same Supabase project (`pmbvogiphelmpjdalmtv`), same keys |
| 20 | First prod deploy | `docker compose up -d --build` |
| 21 | Verify Traefik picks up new container | Check `https://bookings.zunkireelabs.com` loads |

---

## Phase 5: GitHub Repository Config

| # | Task | Where |
|---|------|-------|
| 22 | Add repository secrets | `SSH_HOST` (`94.136.189.213`), `SSH_USERNAME`, `SSH_PRIVATE_KEY` in GitHub → Settings → Secrets |
| 23 | Create `production` environment | GitHub → Settings → Environments → Add approval gate |
| 24 | Create `staging` environment | GitHub → Settings → Environments (no approval needed) |
| 25 | Set default branch to `main` | GitHub → Settings → General → Default branch |

**Note:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are public values baked into the SPA build. They don't need to be GitHub secrets since they're already in `.env` which is committed for the build. However, if you want to keep `.env` out of git, add them as secrets and inject at build time.

---

## Post-Setup Workflow

```
Feature work on `stage` branch
    → Push to origin/stage
    → CI checks (build validation)
    → Auto-deploy to dev-bookings.zunkireelabs.com
    → Test & verify

PR from stage → main
    → CI checks on PR
    → Code review
    → Merge to main
    → Auto-deploy to bookings.zunkireelabs.com (after approval)
    → Health verified

If broken → Manual rollback via GitHub Actions (rollback.yml)
```

---

## GitHub Secrets Required

| Secret | Value | Used By |
|--------|-------|---------|
| `SSH_HOST` | `94.136.189.213` | All deploy workflows |
| `SSH_USERNAME` | `zunkireelabs` | All deploy workflows |
| `SSH_PRIVATE_KEY` | Server SSH private key | All deploy workflows |

---

## Files to Create/Modify

| Action | File |
|--------|------|
| **Create** | `.github/workflows/ci.yml` |
| **Create** | `.github/workflows/deploy.yml` |
| **Create** | `.github/workflows/deploy-staging.yml` |
| **Create** | `.github/workflows/rollback.yml` |
| **Create** | `docker-compose.yml` (production) |
| **Create** | `.env.example` |
| **Modify** | `docker-compose.dev.yml` (update domain) |
| **Modify** | `vite.config.mjs` (add allowed host) |
| **Modify/Remove** | `deploy.sh` (replaced by CI/CD) |
