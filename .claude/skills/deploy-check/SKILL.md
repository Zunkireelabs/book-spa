---
name: deploy-check
description: Pre-deployment validator for BooX. Checks build, environment variables, Docker config, code quality, and security before deploying.
disable-model-invocation: true
argument-hint: "[environment]"
---

# BooX Pre-Deployment Check

Run comprehensive pre-deployment validation before deploying BooX. Environment target: `$ARGUMENTS` (defaults to production).

## Validation Steps

Execute each check below and report results. Stop on any CRITICAL failure.

### Step 1: Environment Variables

Verify `.env` contains required variables:

```
Required:
  VITE_SUPABASE_URL        → must start with https://
  VITE_SUPABASE_ANON_KEY   → must be a valid JWT (starts with eyJ)
```

Check for leaked secrets:
- Search all `.js`, `.jsx` files for hardcoded API keys, passwords, or tokens
- Verify `.env` is in `.gitignore`
- Verify no `.env` files are tracked in git

### Step 2: Build Validation

Run the production build:

```bash
npm run build
```

Check for:
- Build completes without errors
- No TypeScript/ESLint errors
- Output in `dist/` directory
- `dist/index.html` exists
- Bundle size is reasonable (< 5MB total)

### Step 3: Code Quality Scan

Search for common issues:

```
console.log statements    → Should be removed for production
debugger statements       → Must be removed
TODO/FIXME/HACK comments → Flag for review
alert() calls            → Must be removed
Mock data references      → mockBookings, mockTherapists should be replaced
```

### Step 4: Security Audit

Check for:
- No exposed credentials in source code
- All routes that need protection have `<ProtectedRoute>`
- No `dangerouslySetInnerHTML` usage
- Supabase RLS is enabled (check via MCP: `mcp__supabase__get_advisors`)
- CORS settings appropriate

### Step 5: Supabase Health

Use MCP tools to verify:
- Database is reachable (`mcp__supabase__execute_sql` with `SELECT 1`)
- All tables exist (`mcp__supabase__list_tables`)
- RLS enabled on all tables (`mcp__supabase__get_advisors` type: security)
- Performance advisors clean (`mcp__supabase__get_advisors` type: performance)
- Seed data present (at least 1 branch, rooms, services, therapists)

### Step 6: Docker Configuration (if applicable)

If deploying via Docker:
- `Dockerfile` exists and is valid
- `docker-compose.dev.yml` uses correct ports
- `nginx.conf` has proper proxy settings
- SPA routing configured (all paths → index.html)

### Step 7: Git Status & Branching

**CRITICAL BRANCHING RULES:**
```
feature/* ──► stage ──► main
              │          │
           (testing)  (production)
```

Check:
- No uncommitted changes
- On correct branch for deployment
- No merge conflicts
- Remote is up to date

**Branch Validation:**
- Feature branches (`feature/*`) → MUST target `stage`, NEVER `main`
- PRs from feature branches → base must be `stage`
- Only `stage` branch can be merged to `main`
- **BLOCK** any attempt to merge feature branches directly to `main`

```bash
# CORRECT: PR targeting stage
gh pr create --base stage ...

# WRONG: Never do this for feature branches
gh pr create --base main ...
```

## Output Format

```
========================================
  BooX Pre-Deployment Report
  Target: [environment]
  Date: [timestamp]
========================================

[PASS] Environment Variables    — All required vars present
[PASS] Build Validation         — Build succeeded (2.1MB)
[WARN] Code Quality             — 3 console.log statements found
[PASS] Security Audit           — No exposed credentials
[PASS] Supabase Health          — All tables present, RLS enabled
[SKIP] Docker Configuration     — Not deploying via Docker
[PASS] Git Status               — Clean, on main branch

========================================
  Result: READY TO DEPLOY (1 warning)
========================================

Warnings:
1. [WARN] Remove console.log statements before production
   - src/pages/branch-staff-dashboard/index.jsx:42
   - src/contexts/AuthContext.jsx:98
   - src/contexts/AuthContext.jsx:104
```

### Status Codes
- **PASS** — check passed
- **WARN** — non-blocking issue, should fix but won't prevent deploy
- **FAIL** — blocking issue, must fix before deploy
- **SKIP** — check not applicable
- **CRITICAL** — security issue, deployment MUST be blocked

### Final Verdict
- **READY TO DEPLOY** — all checks passed (warnings are acceptable)
- **FIX REQUIRED** — one or more FAIL items need resolution
- **BLOCKED** — CRITICAL security issue found
