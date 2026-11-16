// User-facing copy for an error coming back from the API / a Postgres RPC.
//  - network failures ("TypeError: Failed to fetch" and friends, matched by message only) become one plain sentence;
//  - any other JS TypeError is a bug, not a network problem, so it gets the fallback copy instead of leaking its message;
//  - the "function_name: " prefix the SQL functions put on their RAISE EXCEPTION messages is stripped
//    ("reschedule_booking: slot no longer available" -> "Slot no longer available").
const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out/i;

// Deliberately does not promise "nothing was changed": a request can commit before the connection drops.
export const NETWORK_ERROR_COPY = "Couldn't reach the server. Check your connection and try again.";

// For non-idempotent writes (reschedule, rebook) whose request may have committed before the connection dropped.
export const NETWORK_CHECK_CALENDAR_COPY = "Couldn't reach the server. Check the calendar before trying again.";

export const isNetworkError = (err) => NETWORK.test((typeof err === 'string' ? err : err?.message) || '');

export const friendlyError = (err, fallback = 'Something went wrong. Please try again.') => {
  const raw = (typeof err === 'string' ? err : err?.message) || '';
  if (!raw.trim()) return fallback;
  if (NETWORK.test(raw)) return NETWORK_ERROR_COPY;
  if (err?.name === 'TypeError') return fallback;
  const msg = raw.replace(/^\s*(?:[a-z][a-z0-9_]*|[A-Z][A-Z0-9_]{2,}):\s+/, '').trim();   // 'fn_name: ' and 'ERROR_CODE: ' (LOCATION_INACTIVE, DAY_LOCKED) prefixes
  if (!msg) return fallback;
  return msg.charAt(0).toUpperCase() + msg.slice(1);
};
