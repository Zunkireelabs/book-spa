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
    let lastStatus = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // A throw here is a network failure: propagate it untouched, exactly as an
      // unwrapped fetch would. Never re-issue, since we cannot know whether a
      // write landed.
      const response = await fetchImpl(input, init);

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
      lastStatus = response.status;
      await sleep(BASE_DELAY_MS * 2 ** attempt + Math.floor(random() * JITTER_MS));
    }

    // Unreachable: the loop always returns. Present so a future edit that changes
    // the loop bounds fails loudly in tests rather than returning undefined.
    throw new Error('retryingFetch: exhausted loop without returning');
  };
}
