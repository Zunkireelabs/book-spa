# Production Transient-DB Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transient Postgres errors (`25P02` and friends) invisible to users, self-announcing to operators, and blocked from re-entering via RLS regressions.

**Architecture:** A fail-open `fetch` wrapper injected into all three Supabase clients retries the three SQLSTATEs that guarantee a rolled-back transaction, and reports every API error to the existing PostHog wrapper. A tracked migration cuts the self-heal window from 60s to 5s. A live `pg_policies` assertion in both deploy workflows blocks RLS performance regressions. A scheduled GitHub Actions job probes production and fails loudly.

**Tech Stack:** React 18, Vite 5, vitest, `@supabase/supabase-js`, posthog-js, bash + psql, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md`

## Global Constraints

- Absolute imports: `jsconfig.json` sets `baseUrl: "./src"` — import as `lib/analytics`, never `./src/lib/analytics`.
- `npm run build` must pass without errors. `npm test` must pass.
- Git attribution: commit co-author line is `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`. **Never** use "Generated with Claude Code" or any Claude branding.
- Branching: feature branches merge to `stage` ONLY. PRs target `stage`, never `main`.
- Every `supabase/migration-NNN-*.sql` must self-record into `public.schema_migrations` with `ON CONFLICT (version) DO NOTHING` and a version string matching its own filename — enforced by `scripts/check-migrations.sh`.
- Retryable SQLSTATEs are exactly `25P02`, `40001`, `40P01`. No others.
- Max 2 retries (3 total attempts).
- Never transmit a PostgREST URL query string to PostHog — pathname only.
- The retry wrapper must fail open: a defect in it must degrade to normal `fetch` behavior, never to a thrown request.

## Review Focus

These are failure modes the spec implies but which no task's happy path exercises. Each has a test assigned to the task that owns the code.

1. **Non-JSON error body** — Traefik/nginx can return an HTML `502` page. `response.clone().json()` throws on it. If that escapes, every request in the app fails. Expected: treat as non-retryable, return the response untouched. *(Task 1)*
2. **PostHog uninitialized** — staging has no `VITE_POSTHOG_KEY`, so `_initialized` is false. `captureApiError` must no-op silently, never throw into the request path. *(Task 2)*
3. **Response body consumed by inspection** — a `Response` body reads once. If the wrapper reads the original instead of a clone, callers receive an empty body and every error message in the UI goes blank. *(Task 1)*
4. **PII in the URL** — `/rest/v1/bookings?customer_phone=eq.977...` must never reach PostHog. Expected: only the table name is sent. *(Task 2)*
5. **Non-replayable request body** — a `FormData`/`Blob` body cannot be replayed. Retrying one risks a duplicate write. Expected: skip retry, return the error. *(Task 1)*

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/supabaseRetry.js` *(create)* | Retry decision logic + fetch wrapper factory. Pure, injectable, no imports from `analytics`. |
| `src/lib/supabaseRetry.test.js` *(create)* | Unit tests for the above. |
| `src/lib/analytics.js` *(modify)* | Add `captureApiError`. |
| `src/lib/analytics.test.js` *(create)* | Tests that `captureApiError` no-ops uninitialized. |
| `src/lib/supabase.js` *(modify)* | Wire the wrapper into all three clients. |
| `supabase/migration-226-authenticator-idle-timeout.sql` *(create)* | Lower `idle_in_transaction_session_timeout` for `authenticator`. |
| `scripts/check-rls-initplan.sh` *(create)* | Live `pg_policies` assertion. |
| `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy.yml` *(modify)* | Run the assertion after migrations. |
| `.github/workflows/healthcheck-prod.yml` *(create)* | Scheduled synthetic probe. |

`supabaseRetry.js` deliberately does **not** import `analytics`. It receives an `onError` callback. This keeps it pure and testable without mocking posthog-js, and is why Task 1 and Task 2 are separate.

---

### Task 1: Retry decision logic and fetch wrapper

**Files:**
- Create: `src/lib/supabaseRetry.js`
- Test: `src/lib/supabaseRetry.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `RETRYABLE_PG_CODES: Set<string>` — exactly `{'25P02','40001','40P01'}`
  - `isReplayableBody(body: unknown) => boolean`
  - `extractTable(input: string | Request) => string`
  - `readPgCode(response: Response) => Promise<string | null>`
  - `createRetryingFetch(options?: { fetchImpl?, sleep?, random?, onError?, maxRetries? }) => (input, init) => Promise<Response>`
  - `onError` callback signature: `({ code, status, table, method, attempts, recovered }) => void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/supabaseRetry.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import {
  RETRYABLE_PG_CODES,
  isReplayableBody,
  extractTable,
  readPgCode,
  createRetryingFetch,
} from './supabaseRetry';

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const noSleep = () => Promise.resolve();

describe('RETRYABLE_PG_CODES', () => {
  it('contains exactly the three rolled-back-transaction codes', () => {
    expect([...RETRYABLE_PG_CODES].sort()).toEqual(['25P02', '40001', '40P01']);
  });
});

describe('isReplayableBody', () => {
  it('accepts undefined, null and string bodies', () => {
    expect(isReplayableBody(undefined)).toBe(true);
    expect(isReplayableBody(null)).toBe(true);
    expect(isReplayableBody('{"a":1}')).toBe(true);
  });

  it('rejects FormData and Blob bodies', () => {
    expect(isReplayableBody(new FormData())).toBe(false);
    expect(isReplayableBody(new Blob(['x']))).toBe(false);
  });
});

describe('extractTable', () => {
  it('returns the table name from a PostgREST URL', () => {
    expect(extractTable('https://x.supabase.co/rest/v1/bookings')).toBe('bookings');
  });

  // Review Focus 4: PII must never leave the browser.
  it('never includes the query string, which can carry customer PII', () => {
    const url = 'https://x.supabase.co/rest/v1/bookings?customer_phone=eq.9779800000000';
    const result = extractTable(url);
    expect(result).toBe('bookings');
    expect(result).not.toContain('9779800000000');
    expect(result).not.toContain('customer_phone');
  });

  it('accepts a Request object', () => {
    expect(extractTable(new Request('https://x.supabase.co/rest/v1/payments'))).toBe('payments');
  });

  it('returns "unknown" for an unparseable input rather than throwing', () => {
    expect(extractTable('not a url')).toBe('unknown');
  });
});

describe('readPgCode', () => {
  it('reads the code field from a PostgREST error body', async () => {
    await expect(readPgCode(jsonResponse(500, { code: '25P02' }))).resolves.toBe('25P02');
  });

  // Review Focus 1: a proxy HTML error page must not blow up the request path.
  it('returns null for a non-JSON body instead of throwing', async () => {
    const html = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(readPgCode(html)).resolves.toBeNull();
  });

  // Review Focus 3: bodies read once — inspection must use a clone.
  it('leaves the original response body readable by the caller', async () => {
    const response = jsonResponse(500, { code: '25P02', message: 'aborted' });
    await readPgCode(response);
    await expect(response.json()).resolves.toEqual({ code: '25P02', message: 'aborted' });
  });
});

describe('createRetryingFetch', () => {
  it('retries a 25P02 and returns the eventual success', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: '25P02' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 total attempts and returns the final error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(res.json()).resolves.toEqual({ code: '25P02' });
  });

  it('does not retry a non-retryable Postgres code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { code: '23505' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 4xx with no code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { message: 'bad' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Review Focus 5: replaying a stream body could double-apply a write.
  it('does not retry when the request body is not replayable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {
      method: 'POST',
      body: new FormData(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a POST with a string body, since 25P02 guarantees nothing committed', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: '25P02' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'b1' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {
      method: 'POST',
      body: '{"customer_name":"A"}',
    });

    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('propagates a network-level throw without retrying', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await expect(wrapped('https://x.supabase.co/rest/v1/bookings', {})).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a silent recovery with recovered=true and the attempt count', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: '25P02' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep, onError });

    await wrapped('https://x.supabase.co/rest/v1/bookings', { method: 'GET' });

    expect(onError).toHaveBeenCalledWith({
      code: '25P02',
      status: 500,
      table: 'bookings',
      method: 'GET',
      attempts: 2,
      recovered: true,
    });
  });

  it('reports an unrecovered failure with recovered=false', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep, onError });

    await wrapped('https://x.supabase.co/rest/v1/bookings', { method: 'GET' });

    expect(onError).toHaveBeenLastCalledWith(
      expect.objectContaining({ recovered: false, attempts: 3 })
    );
  });

  // Fail-open: analytics must never break a request.
  it('still returns the response when onError throws', async () => {
    const onError = vi.fn(() => { throw new Error('posthog exploded'); });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep, onError });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(res.status).toBe(500);
  });

  it('defaults to 3 total attempts without an explicit maxRetries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '40001' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('backs off with increasing delays between attempts', async () => {
    const delays = [];
    const sleep = ms => { delays.push(ms); return Promise.resolve(); };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep, random: () => 0 });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(delays).toEqual([150, 300]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/supabaseRetry.test.js`
Expected: FAIL — `Failed to resolve import "./supabaseRetry"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/supabaseRetry.js`:

```js
// A fail-open fetch wrapper for the Supabase clients.
//
// Background: PostgREST holds a pool of long-lived `authenticator` connections.
// When one is left inside an aborted transaction and returned to the pool
// without a ROLLBACK, every later request routed to it returns 25P02 until the
// connection is terminated. With a pool of ~10 that is 10-20% of requests, which
// is why a dashboard fanning out ~10 parallel queries shows several broken
// widgets while the rest render fine. See
// docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md
//
// Only these three SQLSTATEs are retried. All three guarantee the transaction
// rolled back with nothing committed, which is what makes retrying a *write*
// provably safe rather than merely probably safe. Network errors, timeouts and
// 57014 are deliberately excluded: there the write may have landed before the
// response was lost, so a retry could double-apply it.
export const RETRYABLE_PG_CODES = new Set(['25P02', '40001', '40P01']);

const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 150;
const JITTER_MS = 100;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A request body can only be replayed if it is a string (or absent). supabase-js
// always sends strings, so this is a guard against a future caller handing us a
// stream, not a current limitation.
export function isReplayableBody(body) {
  return body === undefined || body === null || typeof body === 'string';
}

// Returns the table name only. The query string is deliberately dropped: PostgREST
// encodes filters into it (e.g. ?customer_phone=eq.977...), so forwarding a raw URL
// to analytics would leak customer PII into a third-party system.
export function extractTable(input) {
  try {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Always inspects a clone: a Response body reads exactly once, and consuming the
// original here would hand callers an empty body.
export async function readPgCode(response) {
  try {
    const data = await response.clone().json();
    return typeof data?.code === 'string' ? data.code : null;
  } catch {
    // Non-JSON body — e.g. an HTML 502 page from the proxy. Not retryable.
    return null;
  }
}

export function createRetryingFetch({
  fetchImpl = (...args) => fetch(...args),
  sleep = defaultSleep,
  random = Math.random,
  onError = null,
  maxRetries = DEFAULT_MAX_RETRIES,
} = {}) {
  // Telemetry must never break a request.
  const report = payload => {
    if (!onError) return;
    try {
      onError(payload);
    } catch {
      /* swallowed on purpose */
    }
  };

  return async function retryingFetch(input, init) {
    const method = init?.method ?? 'GET';
    let lastCode = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // A throw here is a network failure: propagate it untouched, exactly as an
      // unwrapped fetch would. Never re-issue, since we cannot know whether a
      // write landed.
      const response = await fetchImpl(input, init);

      if (response.ok) {
        if (lastCode) {
          report({
            code: lastCode,
            status: response.status,
            table: extractTable(input),
            method,
            attempts: attempt + 1,
            recovered: true,
          });
        }
        return response;
      }

      const code = await readPgCode(response);

      const retryable =
        code !== null &&
        RETRYABLE_PG_CODES.has(code) &&
        isReplayableBody(init?.body) &&
        attempt < maxRetries;

      if (!retryable) {
        if (code !== null || lastCode !== null) {
          report({
            code: code ?? lastCode,
            status: response.status,
            table: extractTable(input),
            method,
            attempts: attempt + 1,
            recovered: false,
          });
        }
        return response;
      }

      lastCode = code;
      await sleep(BASE_DELAY_MS * 2 ** attempt + Math.floor(random() * JITTER_MS));
    }

    // Unreachable: the loop always returns. Present so a future edit that changes
    // the loop bounds fails loudly in tests rather than returning undefined.
    throw new Error('retryingFetch: exhausted loop without returning');
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/supabaseRetry.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseRetry.js src/lib/supabaseRetry.test.js
git commit -m "feat(db): add fail-open retry wrapper for transient Postgres errors

Retries only 25P02, 40001 and 40P01 — the three SQLSTATEs that guarantee the
transaction rolled back with nothing committed, which makes retrying a write
provably safe. Network errors, timeouts and 57014 are excluded because there
the write may have landed before the response was lost.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

---

### Task 2: Error telemetry

**Files:**
- Modify: `src/lib/analytics.js`
- Test: `src/lib/analytics.test.js` (create)

**Interfaces:**
- Consumes: the `onError` payload shape from Task 1 — `{ code, status, table, method, attempts, recovered }`.
- Produces: `captureApiError(payload) => void`, exported from `src/lib/analytics.js`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/analytics.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { captureApiError } from './analytics';

// Staging intentionally ships without VITE_POSTHOG_KEY, so init() never runs and
// _initialized stays false. captureApiError sits on the request path, so a throw
// here would turn a silent recovery into a broken page — on staging only, which
// is exactly where it would go unnoticed.
describe('captureApiError', () => {
  it('no-ops without throwing when PostHog was never initialized', () => {
    expect(() =>
      captureApiError({
        code: '25P02',
        status: 500,
        table: 'bookings',
        method: 'GET',
        attempts: 2,
        recovered: true,
      })
    ).not.toThrow();
  });

  it('tolerates a completely empty payload', () => {
    expect(() => captureApiError({})).not.toThrow();
    expect(() => captureApiError()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/analytics.test.js`
Expected: FAIL — `captureApiError is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/analytics.js`, after the existing `capture` function:

```js
// Emitted from the Supabase fetch wrapper (see lib/supabaseRetry.js), which is the
// single choke point every request in the app passes through.
//
// `table` is a bare table name, never a URL — PostgREST encodes filters into the
// query string (?customer_phone=eq.977...), so forwarding a URL would leak customer
// PII into PostHog.
//
// `recovered: true` means the retry worked and the user saw nothing. That is the
// early-warning signal: it says the problem is happening while it is still
// invisible. `recovered: false` means the user saw an error.
export function captureApiError(payload = {}) {
  if (!_initialized) return;
  const { code, status, table, method, attempts, recovered } = payload;
  posthog.capture('api_error', { code, status, table, method, attempts, recovered });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/analytics.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.js src/lib/analytics.test.js
git commit -m "feat(analytics): capture API errors with retry outcome

Distinguishes recovered:true (retry worked, user saw nothing, problem is
ongoing) from recovered:false (user saw an error). Sends the table name only —
never the PostgREST query string, which carries customer PII.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

---

### Task 3: Wire the wrapper into the Supabase clients

**Files:**
- Modify: `src/lib/supabase.js`

**Interfaces:**
- Consumes: `createRetryingFetch` (Task 1), `captureApiError` (Task 2).
- Produces: no new exports. `supabase`, `supabaseCustomer` and `supabasePlatform` keep their existing names and behavior.

This is the step that makes the previous two tasks take effect across all 173 `if (error)` sites in the 13,472-line `src/services/api.js`, plus every customer and platform call, without editing any of them.

- [ ] **Step 1: Add the shared fetch and wire all three clients**

In `src/lib/supabase.js`, add these imports at the top of the file, directly under the existing `import { createClient } ...` line:

```js
import { createRetryingFetch } from './supabaseRetry';
import { captureApiError } from './analytics';
```

Then, immediately after the `if (!supabaseUrl || !supabaseAnonKey) { ... }` guard, add:

```js
// One wrapper shared by all three clients. Retries the transient Postgres errors
// that a poisoned PostgREST pool connection produces, and reports every API error
// to PostHog. Placing it here rather than in services/api.js covers every call
// site in the app — including ones added later — with no per-call changes.
const retryingFetch = createRetryingFetch({ onError: captureApiError });
```

Now add `global: { fetch: retryingFetch }` to each of the three `createClient` calls. The three calls become:

```js
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false },
  global: { fetch: retryingFetch },
});
```

```js
export const supabaseCustomer = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-customer-auth' },
  global: { fetch: retryingFetch },
});
```

```js
export const supabasePlatform = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-platform-auth', detectSessionInUrl: false },
  global: { fetch: retryingFetch },
});
```

Leave every existing comment in the file intact — they document a real past auth bug.

- [ ] **Step 2: Verify the full test suite still passes**

Run: `npm test`
Expected: PASS — all existing tests plus the new ones.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: completes with no errors.

- [ ] **Step 4: Verify by hand in the running app**

Run: `npm start` (serves on port 4028). Log in and load the dashboard.
Expected: the dashboard loads normally, and the browser Network tab shows the usual requests with no added failures. This confirms the wrapper is transparent on the happy path — the single most important property, since it now sits in front of every request.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.js
git commit -m "feat(db): route all three Supabase clients through the retry wrapper

Covers every call site in services/api.js plus the customer and platform
clients with no per-call changes.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

---

### Task 4: Migration — shrink the self-heal window

**Files:**
- Create: `supabase/migration-226-authenticator-idle-timeout.sql`

**Interfaces:**
- Consumes: nothing. Independent of Tasks 1-3.
- Produces: ledger entry `'226'`.

Context: the 2026-09-25 remediation set this to 60s at the database level, which bounds how long a poisoned connection keeps failing but does not prevent poisoning. 5s is safe because PostgREST transactions are per-request and sub-second — nothing legitimately idles 5s inside a transaction.

- [ ] **Step 1: Write the migration**

Create `supabase/migration-226-authenticator-idle-timeout.sql`:

```sql
-- Migration 226: shrink the authenticator idle-in-transaction abort window to 5s
-- Idempotent: ALTER ROLE ... SET is last-write-wins, safe to re-run.
-- Applied: stage <YYYY-MM-DD> / prod <YYYY-MM-DD>.
--
-- When a PostgREST pool connection is left inside an aborted transaction, every
-- later request routed to it returns 25P02 until the connection is terminated.
-- The database-level default was raised from 0 (never) to 60s on 2026-09-25,
-- which is what stopped the failure being permanent. 5s is the same control,
-- tightened: PostgREST transactions are per-request and sub-second, so nothing
-- legitimate idles that long inside one.
--
-- This bounds the blast radius. It is not a root-cause fix — see
-- docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md

BEGIN;

ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '5s';

INSERT INTO public.schema_migrations (version, name)
VALUES ('226', 'authenticator-idle-timeout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Verify the migration lint passes**

Run: `scripts/check-migrations.sh origin/stage`
Expected: `OK: supabase/migration-226-authenticator-idle-timeout.sql (version 226)`

- [ ] **Step 3: Apply to staging and confirm it took effect**

Run:
```bash
psql "postgresql://postgres.snzcckzfmpboeqkktmwy@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/migration-226-authenticator-idle-timeout.sql

psql "postgresql://postgres.snzcckzfmpboeqkktmwy@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
  -X -q -c "SELECT rolname, rolconfig FROM pg_roles WHERE rolname='authenticator';"
```
Expected: `rolconfig` includes `idle_in_transaction_session_timeout=5s`.

**If `ALTER ROLE` fails with a permissions error:** stop and report it. Do not silently skip it. The fallback is a manual dashboard application per `supabase/PROMOTION.md` — say so explicitly in the PR description so the handoff is not lost. Passwords are already in `~/.pgpass`; do not ask for connection strings.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-226-authenticator-idle-timeout.sql
git commit -m "feat(db): migration 226 — authenticator idle-abort window 60s to 5s

Bounds how long a poisoned PostgREST pool connection keeps returning 25P02.
Blast-radius control, not a root-cause fix.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

---

### Task 5: Live RLS InitPlan assertion in CI

**Files:**
- Create: `scripts/check-rls-initplan.sh`
- Modify: `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: standard libpq `PG*` env vars, matching `scripts/migrate-apply.sh`.
- Produces: exit code 0 (clean) or 1 (unwrapped policy found).

Why live rather than a static grep over migration files: migration 225 was authored as a `DO` block emitting dynamic SQL, because prod and stage had diverged on 20 policies. A grep cannot see policies that never exist as literal text — a static lint would have missed the very migration that fixed the original outage.

**Known coverage limit, to state in the PR:** prod's `migrate` job is gated on `if: needs.migrate-check.outputs.has_migrations == 'true'`, so on a prod deploy with no pending migrations this assertion does not run. Staging's `migrate` job has no such guard and always runs. Making it always run on prod would need a job outside the `production-db` environment, which carries a required reviewer that would then gate every deploy. Accepted tradeoff: the assertion fires whenever migrations are applied, which is when a regression can be introduced. Ad-hoc dashboard drift on prod is not covered automatically.

- [ ] **Step 1: Write the script**

Create `scripts/check-rls-initplan.sh`:

```bash
#!/usr/bin/env bash
# CI-time assertion: no public-schema RLS policy may call get_user_role(),
# get_user_org_id(), get_user_branch_id(), get_user_branch_ids() or auth.uid()
# *unwrapped*.
#
# Unwrapped, Postgres re-evaluates the call once per row. get_user_role() is
# `SELECT role FROM users WHERE id = auth.uid()`, so each call is a table lookup;
# across policies on every table this turned a 27-row users table into the hottest
# relation in the production database (94.9M sequential scans) and took the whole
# staff dashboard down on 2026-09-25. Wrapped as (SELECT fn()), the planner hoists
# it to an InitPlan and evaluates it once per query.
#
# Checked live against pg_policies rather than by grepping migration files:
# migration-225 was authored as a DO block emitting dynamic SQL, which a static
# lint cannot see at all.
#
# Connection is via standard libpq PG* env vars, matching scripts/migrate-apply.sh.
set -euo pipefail

: "${PGHOST:?PGHOST not set}"
: "${PGUSER:?PGUSER not set}"
: "${PGDATABASE:?PGDATABASE not set}"
export PGSSLMODE="${PGSSLMODE:-require}"

# Strategy: concatenate qual and with_check, delete every correctly-wrapped
# `( SELECT fn() ... )` occurrence, then look for any bare call left behind.
# Checking with_check matters — it carries the identical per-row penalty as qual,
# and the 2026-09-26 investigation scanned only qual.
read -r -d '' QUERY <<'SQL' || true
WITH pol AS (
  SELECT schemaname, tablename, policyname,
         coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
  FROM pg_policies
  WHERE schemaname = 'public'
),
stripped AS (
  SELECT schemaname, tablename, policyname,
         regexp_replace(
           expr,
           '\( *SELECT +(public\.)?(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids|auth\.uid)\(\)[^)]*\)',
           '',
           'gi'
         ) AS rest
  FROM pol
)
SELECT schemaname || '.' || tablename || ' :: ' || policyname
FROM stripped
WHERE rest ~* '(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids|auth\.uid)[[:space:]]*\('
ORDER BY 1;
SQL

echo "Checking RLS policies on $PGUSER@$PGHOST/$PGDATABASE for unwrapped helper calls..."

OFFENDERS="$(psql -v ON_ERROR_STOP=1 -tAc "$QUERY")"

if [ -n "$OFFENDERS" ]; then
  COUNT="$(printf '%s\n' "$OFFENDERS" | grep -c . || true)"
  echo ""
  echo "FAIL: $COUNT policy/policies call an RLS helper unwrapped:"
  # Read line-by-line: policy identifiers contain spaces (" :: "), so an
  # unquoted printf would word-split them into mangled output.
  while IFS= read -r line; do
    [ -n "$line" ] && echo "  $line"
  done <<< "$OFFENDERS"
  echo ""
  echo "Wrap each call so the planner hoists it to an InitPlan:"
  echo "  get_user_role()        ->  (SELECT get_user_role())"
  echo "  auth.uid()             ->  (SELECT auth.uid())"
  echo ""
  echo "Note: '= ANY ((SELECT fn()))' parses as ANY's subquery form. When fn()"
  echo "returns uuid[], cast it: '= ANY ((SELECT fn())::uuid[])'."
  echo ""
  echo "See supabase/migration-225-rls-initplan-sweep.sql for the established pattern."
  exit 1
fi

echo "OK: no unwrapped RLS helper calls found."
```

Then: `chmod +x scripts/check-rls-initplan.sh`

- [ ] **Step 2: Verify it reports clean against staging**

Run:
```bash
PGHOST=aws-1-ap-south-1.pooler.supabase.com \
PGUSER=postgres.snzcckzfmpboeqkktmwy \
PGDATABASE=postgres \
scripts/check-rls-initplan.sh
```
Expected: `OK: no unwrapped RLS helper calls found.` (exit 0)

- [ ] **Step 3: Prove the script can actually fail**

A lint that cannot fail is worthless, and this one passes trivially on a clean database. Plant a deliberate violation on staging, confirm detection, then remove it.

Run:
```bash
STAGE="postgresql://postgres.snzcckzfmpboeqkktmwy@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"

psql "$STAGE" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS public._rls_lint_canary (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public._rls_lint_canary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canary_bad ON public._rls_lint_canary;
CREATE POLICY canary_bad ON public._rls_lint_canary FOR SELECT USING (get_user_role() = 'admin');
"

PGHOST=aws-1-ap-south-1.pooler.supabase.com \
PGUSER=postgres.snzcckzfmpboeqkktmwy \
PGDATABASE=postgres \
scripts/check-rls-initplan.sh; echo "exit=$?"
```
Expected: `FAIL: 1 policy/policies ...` listing `public._rls_lint_canary :: canary_bad`, and `exit=1`.

Then confirm the wrapped form passes:
```bash
psql "$STAGE" -v ON_ERROR_STOP=1 -c "
DROP POLICY canary_bad ON public._rls_lint_canary;
CREATE POLICY canary_good ON public._rls_lint_canary FOR SELECT USING ((SELECT get_user_role()) = 'admin');
"

PGHOST=aws-1-ap-south-1.pooler.supabase.com \
PGUSER=postgres.snzcckzfmpboeqkktmwy \
PGDATABASE=postgres \
scripts/check-rls-initplan.sh; echo "exit=$?"
```
Expected: `OK: ...` and `exit=0`.

Now clean up completely:
```bash
psql "$STAGE" -v ON_ERROR_STOP=1 -c "DROP TABLE public._rls_lint_canary CASCADE;"
psql "$STAGE" -X -q -c "SELECT count(*) AS should_be_zero FROM pg_tables WHERE tablename='_rls_lint_canary';"
```
Expected: `should_be_zero` is `0`. Do not proceed while the canary table still exists on staging.

- [ ] **Step 4: Wire into the staging deploy workflow**

In `.github/workflows/deploy-staging.yml`, inside the `migrate` job, add a step directly after the `Apply pending migrations to staging` step, at the same indentation:

```yaml
      - name: Assert no unwrapped RLS helper calls
        env:
          PGHOST: ${{ secrets.STAGE_PGHOST }}
          PGUSER: ${{ secrets.STAGE_PGUSER }}
          PGPASSWORD: ${{ secrets.STAGE_PGPASSWORD }}
          PGDATABASE: ${{ secrets.STAGE_PGDATABASE }}
        run: scripts/check-rls-initplan.sh
```

- [ ] **Step 5: Wire into the production deploy workflow**

In `.github/workflows/deploy.yml`, inside the `migrate` job, add a step directly after the `Apply pending migrations to production` step, at the same indentation:

```yaml
      - name: Assert no unwrapped RLS helper calls
        env:
          PGHOST: ${{ secrets.PROD_PGHOST }}
          PGUSER: ${{ secrets.PROD_PGUSER }}
          PGPASSWORD: ${{ secrets.PROD_PGPASSWORD }}
          PGDATABASE: ${{ secrets.PROD_PGDATABASE }}
        run: scripts/check-rls-initplan.sh
```

- [ ] **Step 6: Validate both workflow files parse**

Run:
```bash
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/deploy.yml','.github/workflows/deploy-staging.yml']]; print('both workflows parse OK')"
```
Expected: `both workflows parse OK`

- [ ] **Step 7: Commit**

```bash
git add scripts/check-rls-initplan.sh .github/workflows/deploy-staging.yml .github/workflows/deploy.yml
git commit -m "ci: assert no unwrapped RLS helper calls after migrations

Unwrapped get_user_*()/auth.uid() in a policy is re-evaluated per row and took
production down on 2026-09-25. Checked live against pg_policies rather than by
grepping migration files, because migration-225 was authored as a DO block
emitting dynamic SQL that a static lint cannot see. Checks with_check as well as
qual — the earlier manual sweep only looked at qual.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

---

### Task 6: Scheduled synthetic monitor

**Files:**
- Create: `.github/workflows/healthcheck-prod.yml`

**Interfaces:**
- Consumes: existing repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Produces: a failing workflow run (which GitHub emails about by default) when production returns `25P02`.

Two constraints shape this design, and both matter:

1. **It must not use the `production-db` environment.** That environment carries a required reviewer, so a scheduled job targeting it would block on approval indefinitely. The check therefore runs over HTTPS with the anon key, not psql.
2. **One probe is not enough.** With one poisoned connection in a pool of ten, a single request has roughly a 90% chance of missing it and reporting false health. This is the difference between a monitor that catches the incident and one that reports green throughout it.

- [ ] **Step 1: Confirm the probe endpoint is anon-readable in production**

A probe against an endpoint that RLS hides would return an empty array forever and the monitor would be permanently, uselessly green. Verify before relying on it.

Run (substitute the production values from the GitHub secrets, or from `.env.production`):
```bash
curl -s -o /tmp/probe.json -w '%{http_code}\n' \
  -H "apikey: $PROD_ANON_KEY" \
  -H "Authorization: Bearer $PROD_ANON_KEY" \
  "$PROD_SUPABASE_URL/rest/v1/branches?select=id&limit=1"
cat /tmp/probe.json
```
Expected: HTTP `200` and a **non-empty** JSON array, e.g. `[{"id":"..."}]`.

If the array is empty, try `services` instead of `branches` (the public `/:orgSlug/book` flow reads both). Use whichever returns a non-empty array, and use that table name in Step 2. Do not proceed with an endpoint that returns `[]`.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/healthcheck-prod.yml`. Replace `branches` in the URL if Step 1 selected a different table:

```yaml
name: Production Health Check

on:
  schedule:
    # Every 10 minutes. GitHub emails the repo owner when a scheduled run fails.
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  probe:
    name: Probe production PostgREST
    runs-on: ubuntu-latest
    steps:
      # Deliberately NOT using the production-db environment: it carries a
      # required reviewer, so a scheduled job would block on approval forever.
      # The anon key over HTTPS is enough to detect what users actually see.
      - name: Send 20 probes and fail on any aborted transaction
        env:
          SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
        run: |
          set -uo pipefail

          # 20 probes, not 1. A poisoned PostgREST pool connection is roughly 1
          # in 10, so a single request has about a 90% chance of missing it and
          # reporting false health.
          ATTEMPTS=20
          failures=0
          aborted=0

          for i in $(seq 1 $ATTEMPTS); do
            body="$(curl -s --max-time 15 \
              -H "apikey: $ANON_KEY" \
              -H "Authorization: Bearer $ANON_KEY" \
              "$SUPABASE_URL/rest/v1/branches?select=id&limit=1" || echo '{"code":"CURL_FAILED"}')"

            if printf '%s' "$body" | grep -q '25P02'; then
              aborted=$((aborted + 1))
              echo "probe $i: ABORTED TRANSACTION -> $body"
            elif printf '%s' "$body" | grep -q '"code"'; then
              failures=$((failures + 1))
              echo "probe $i: error -> $body"
            fi
          done

          echo ""
          echo "=== $ATTEMPTS probes: $aborted aborted, $failures other errors ==="

          if [ "$aborted" -gt 0 ]; then
            echo "FAIL: production is returning 25P02 on $aborted/$ATTEMPTS probes."
            echo "A PostgREST pool connection is stuck in an aborted transaction."
            echo "Pull Postgres ERROR logs now (Supabase -> Logs -> Postgres) — the"
            echo "originating error is only visible there, and only briefly."
            exit 1
          fi

          if [ "$failures" -gt 0 ]; then
            echo "FAIL: $failures/$ATTEMPTS probes returned an error."
            exit 1
          fi

          echo "OK: production healthy."
```

- [ ] **Step 3: Validate the workflow parses**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/healthcheck-prod.yml')); print('workflow parses OK')"
```
Expected: `workflow parses OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/healthcheck-prod.yml
git commit -m "ci: add scheduled production health check

Sends 20 probes rather than 1: a poisoned PostgREST pool connection is roughly
1 in 10, so a single request has about a 90% chance of reporting false health.
Uses the anon key over HTTPS rather than psql, because the production-db
environment carries a required reviewer that would block a scheduled job.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

- [ ] **Step 5: Run it once by hand after the PR merges**

The `schedule` trigger only becomes active once the workflow is on the default branch. After merge, trigger it manually:
```bash
gh workflow run healthcheck-prod.yml
gh run list --workflow=healthcheck-prod.yml --limit 1
```
Expected: the run completes green with `OK: production healthy.`

---

### Task 7: Open the PR

**Files:** none.

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
npm test && npm run build
```
Expected: both pass. Do not open the PR otherwise.

- [ ] **Step 2: Push and open the PR against `stage`**

Feature branches merge to `stage` only — never to `main`.

```bash
git push -u origin HEAD

gh pr create --base stage \
  --title "Production transient-DB resilience: retry, telemetry, RLS gate, monitor" \
  --body "$(cat <<'BODY'
Implements `docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md`.

Addresses the recurring `25P02` "current transaction is aborted" incidents on
2026-09-25 and 2026-09-26.

## What this does

- **Retry wrapper** (`lib/supabaseRetry.js`) on all three Supabase clients. Retries
  only `25P02`, `40001`, `40P01` — the three SQLSTATEs that guarantee the transaction
  rolled back with nothing committed, which is what makes retrying a write provably
  safe. Fails open by design.
- **Error telemetry** via the existing PostHog wrapper, distinguishing
  `recovered:true` (retry worked, user saw nothing, problem is ongoing) from
  `recovered:false`. Sends the table name only — never the PostgREST query string,
  which carries customer PII.
- **Migration 226** lowers the `authenticator` idle-abort window from 60s to 5s.
- **`scripts/check-rls-initplan.sh`** asserts no policy calls an RLS helper
  unwrapped, checked live against `pg_policies` after migrations apply.
- **Scheduled production health check**, 20 probes per run.

## What this does NOT do

It does not identify the root cause of the 2026-09-26 incident. Both poisoned
backends showed `query = 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY'`, meaning
the failure occurred at Parse/Bind — a phase that does not update `pg_stat_activity`.
Naming it requires Postgres ERROR logs, which were not accessible.

The telemetry and monitor exist so the next occurrence is named automatically.

## Known coverage limit

Production's `migrate` job is gated on `has_migrations == 'true'`, so the RLS
assertion does not run on a prod deploy with no pending migrations. Staging's runs
every deploy. Making it unconditional on prod would require a job outside the
`production-db` environment, whose required reviewer would then gate every deploy.

## Manual follow-up still required

Configure Postgres ERROR log access (Supabase → Logs → Postgres, saved
`severity = ERROR` query). No code closes this gap, and it is the reason the
2026-09-25 incident repeated on 2026-09-26.

Created by @sthasadin
BODY
)"
```

- [ ] **Step 3: Confirm CI is green**

Run: `gh pr checks --watch`
Expected: Promotion Guard, Migration Guard, Lint, Test and Build all pass.

---

## Post-merge manual checklist

Not implementable from this repository. Track separately.

- [ ] Configure Postgres ERROR log access: Supabase → Logs → Postgres, saved query `severity = ERROR`. **This is the highest-value item in the whole plan** — it is the gap that turned one incident into two.
- [ ] Build a PostHog insight on the `api_error` event, broken down by `code` and `recovered`. A rising `recovered:true` count is an incident in progress that users cannot see.
- [ ] Best-effort: enable `pg_stat_statements.track_planning`. During the 2026-09-26 investigation every `plan_time` column read `0`, making it impossible to separate planning cost from execution cost on the observed multi-second spikes. Supabase may not permit this GUC; report if unavailable rather than assuming it worked.
- [ ] After migration 226 reaches production, confirm it took effect:
  `SELECT rolname, rolconfig FROM pg_roles WHERE rolname='authenticator';`
  Expected: `rolconfig` contains `idle_in_transaction_session_timeout=5s`.
