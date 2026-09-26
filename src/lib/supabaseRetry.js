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

// Codes that are routine application-level outcomes, never signal a poisoned
// pool connection, and must not fire onError even though they arrive on a 4xx.
// PGRST116 ("no rows returned") is ordinary control flow — api.js has 121
// `.single()` call sites — and an unfiltered PGRST116 would bury the
// transient-DB signal this event exists to surface. 23505/23503 (unique/FK
// violation) and 42501 (RLS denial) are expected validation outcomes, not
// database health signals. P0001-P0005 and 22007 are this application's own
// `RAISE EXCEPTION` business-rule codes raised from Postgres functions (104
// migration files use RAISE EXCEPTION; a bare RAISE EXCEPTION defaults to
// P0001), surfaced as HTTP 400 through the ~55 `.rpc()` call sites in
// api.js — e.g. invalid status transition, double-book, bad date. These are
// expected validation outcomes, not infrastructure faults, and must not bury
// the transient-DB signal either.
export const BENIGN_PG_CODES = new Set([
  'PGRST116',
  'PGRST301',
  '23505',
  '23503',
  '42501',
  'P0001',
  'P0002',
  'P0003',
  'P0004',
  'P0005',
  '22007',
]);

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
  // Known limitations of this telemetry, recorded rather than fixed because the
  // fix isn't free and the blind spot is understood:
  //
  // - postgrest-js has its OWN retry layer (`shouldRetry`: GET/HEAD/OPTIONS on
  //   503 and 520, up to 4 attempts) that runs OUTSIDE this wrapper, invisible
  //   to it. A 503 therefore produces up to four separate `api_error` events
  //   for one logical query, each with `attempts: 1` — a PostHog insight built
  //   on raw event counts overstates 503-class incidents ~4x. The 25P02 path is
  //   unaffected: PostgREST maps that to HTTP 500, which is not in postgrest-js's
  //   retryable status list, so this wrapper is the only retry layer for it.
  //
  // - A network-level throw (attempt N+1 goes offline/DNS failure after attempt
  //   N already saw a retryable code) propagates the throw untouched — see the
  //   comment above the fetchImpl call — but is now reported first, with
  //   `status: 0` and the already-observed `lastCode` if one exists, so total
  //   Supabase unreachability is no longer invisible to telemetry.
  //
  // Telemetry must never break a request.
  const report = payload => {
    if (!onError) return;
    try {
      onError(payload);
    } catch {
      /* swallowed on purpose */
    }
  };

  // Fail open on a bad option, not just a bad response. An invalid maxRetries
  // (NaN, negative, non-number) must never turn every request in the app into
  // a thrown error via the "unreachable" guard below.
  const retries = Number.isFinite(maxRetries) && maxRetries >= 0
    ? Math.floor(maxRetries)
    : DEFAULT_MAX_RETRIES;

  return async function retryingFetch(input, init) {
    const method = init?.method ?? 'GET';
    let lastCode = null;
    let lastStatus = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // A throw here is a network failure: propagate it untouched, exactly as an
      // unwrapped fetch would. Never re-issue, since we cannot know whether a
      // write landed. We DO report it first so total unreachability isn't
      // invisible to telemetry — and so an already-observed `lastCode` from an
      // earlier attempt in this same sequence isn't lost — but the report is
      // best-effort (report() swallows onError's own failures) and the
      // original error is always re-thrown unchanged.
      let response;
      try {
        response = await fetchImpl(input, init);
      } catch (err) {
        report({
          code: lastCode,
          status: 0,
          table: extractTable(input),
          method,
          attempts: attempt + 1,
          recovered: false,
        });
        throw err;
      }

      if (response.ok) {
        if (lastCode) {
          report({
            code: lastCode,
            status: lastStatus,
            table: extractTable(input),
            method,
            attempts: attempt + 1,
            recovered: true,
          });
        }
        return response;
      }

      const code = await readPgCode(response);

      // A Request object's body, once used by fetchImpl, is unreadable on retry
      // even when `init` (and so `init?.body`) is undefined — the body lives on
      // `input` itself. Only a plain URL string is safe to hand to fetchImpl a
      // second time.
      const retryable =
        code !== null &&
        RETRYABLE_PG_CODES.has(code) &&
        typeof input === 'string' &&
        isReplayableBody(init?.body) &&
        attempt < retries;

      if (!retryable) {
        // Report retryable codes (even ones we're out of attempts for),
        // codes seen partway through a retry sequence that ends differently,
        // genuine server failures (5xx) even with no parseable code — e.g. an
        // HTML 502 from the proxy — and any OTHER parseable code that isn't on
        // the benign denylist above. That last clause matters: PostgREST maps a
        // Parse/Bind-class error (42xxx — undefined column/table, often from a
        // stale schema cache) to HTTP 400, not 5xx, and that class is exactly
        // the "originating error" the spec wants named ahead of the next 25P02
        // cluster. A blanket "ignore all 4xx" would suppress it. Denylisting
        // the known-benign codes instead of allowlisting the known-bad ones
        // means an unrecognized code reports by default, fail-open toward
        // visibility rather than toward silence.
        const shouldReport =
          (code !== null && RETRYABLE_PG_CODES.has(code)) ||
          lastCode !== null ||
          response.status >= 500 ||
          (code !== null && !BENIGN_PG_CODES.has(code));

        if (shouldReport) {
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
      lastStatus = response.status;
      await sleep(BASE_DELAY_MS * 2 ** attempt + Math.floor(random() * JITTER_MS));
    }

    // Unreachable: the loop always returns, and `retries` is validated above to
    // be a non-negative integer. Present so a future edit that changes the loop
    // bounds fails loudly in tests rather than returning undefined.
    throw new Error('retryingFetch: exhausted loop without returning');
  };
}
