// User-facing copy for an error coming back from the API / a Postgres RPC.
//  - network failures ("TypeError: Failed to fetch" and friends) become one plain sentence;
//  - the "function_name: " prefix the SQL functions put on their RAISE EXCEPTION messages is stripped
//    ("reschedule_booking: slot no longer available" -> "Slot no longer available").
const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out/i;

export const NETWORK_ERROR_COPY = "Couldn't reach the server — nothing was changed.";

export const friendlyError = (err, fallback = 'Something went wrong. Please try again.') => {
  const raw = (typeof err === 'string' ? err : err?.message) || '';
  if (!raw.trim()) return fallback;
  if (err?.name === 'TypeError' || NETWORK.test(raw)) return NETWORK_ERROR_COPY;
  const msg = raw.replace(/^\s*[a-z][a-z0-9_]*:\s+/, '').trim();
  if (!msg) return fallback;
  return msg.charAt(0).toUpperCase() + msg.slice(1);
};
