// User-facing copy for an error coming back from the API / a Postgres RPC.
//  - network failures ("TypeError: Failed to fetch" and friends, matched by message only) become one plain sentence;
//  - any other JS TypeError is a bug, not a network problem, so it gets the fallback copy instead of leaking its message;
//  - the "function_name: " prefix the SQL functions put on their RAISE EXCEPTION messages is stripped
//    ("reschedule_booking: slot no longer available" -> "Slot no longer available").
import { localizeTerms } from './industryTerms';

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out/i;

// Deliberately does not promise "nothing was changed": a request can commit before the connection drops.
export const NETWORK_ERROR_COPY = "Couldn't reach the server. Check your connection and try again.";

// For non-idempotent writes (reschedule, rebook) whose request may have committed before the connection dropped.
export const NETWORK_CHECK_CALENDAR_COPY = "Couldn't reach the server. Check the calendar before trying again.";

export const isNetworkError = (err) => NETWORK.test((typeof err === 'string' ? err : err?.message) || '');

// Generic copy for anything that reads like database/engine text (snake_case identifiers, constraint / schema /
// permission wording, PostgREST codes). The technical detail goes to the console only, never on screen.
export const GENERIC_SAVE_ERROR_COPY = "Couldn't save. Please try again, or contact support if it keeps happening.";

const TECHNICAL = new RegExp([
  '\\b[a-z]+(?:_[a-z0-9]+)+\\b',                 // snake_case identifier (column, key, function, table)
  'violates|constraint|schema cache|relation "|column "|function public',
  'permission denied|row-level security|\\brls\\b|jwt|pgrst|sqlstate|syntax error|invalid input syntax',
  'null value in|duplicate key|unique key|foreign key|could not find the|unknown (?:setting )?key|not-null',
  'cannot read prop|undefined is not|is not a function|unexpected token',
].join('|'), 'i');

// Known booking / customer failures that reach the screen as raw Postgres text, mapped to the sentence staff need.
const KNOWN = [
  [/P0275|FUTURE_BOOKING/, (raw) => String(raw).replace(/^[\s\S]*?(This booking is for [^.]+\. Move it to today to [^.]+\.)[\s\S]*$/, '$1')],
  [/excl_therapist_overlap|conflicting key value violates exclusion constraint/i,
    () => localizeTerms('This therapist already has a booking at that time. Pick another time or person.')],
  // ZNLY-266: a staff Confirm / Start / Complete refused because the room is full (the DB guard's CODE: text).
  [/ROOM_AT_CAPACITY/, () => 'That room is fully booked at this time. Choose another time or room.'],
  // set_user_pin (migration-416): a refused PIN save, in plain words.
  [/set_user_pin: (?:not allowed|no such user)/i, () => "You can't set this person's PIN. Ask an admin."],
  [/PIN must be exactly 4 digits/i, () => 'PIN must be 4 digits.'],
  [/customers_org_nphone_uniq|duplicate key[\s\S]*phone|phone[\s\S]*duplicate key/i,
    () => 'A customer with this phone number already exists.'],
];

export const looksTechnical = (msg) => TECHNICAL.test(msg || '');

export const friendlyError = (err, fallback = GENERIC_SAVE_ERROR_COPY) => {
  const raw = (typeof err === 'string' ? err : err?.message) || '';
  if (!raw.trim()) return fallback;
  // 23P01 = exclusion_violation: the therapist-overlap guard (migration-414), whatever text it carries.
  if (err?.code === '23P01') return localizeTerms('This therapist already has a booking at that time. Pick another time or person.');
  for (const [re, say] of KNOWN) if (re.test(raw)) return say(raw);
  if (NETWORK.test(raw)) return NETWORK_ERROR_COPY;
  if (err?.name === 'TypeError') return fallback;
  const msg = raw.replace(/^\s*(?:[a-z][a-z0-9_]*|[A-Z][A-Z0-9_]{2,}):\s+/, '').trim();   // 'fn_name: ' and 'ERROR_CODE: ' (LOCATION_INACTIVE, DAY_LOCKED) prefixes
  if (!msg) return fallback;
  // CODE_PREFIXED errors (DAY_LOCKED, ROOM_AT_CAPACITY, THERAPIST_ABSENT...) are written for staff on purpose: never hidden.
  const authored = /^\s*[A-Z][A-Z0-9_]{2,}:\s/.test(raw);
  if (!authored && looksTechnical(msg)) {
    // eslint-disable-next-line no-console
    console.error('[friendlyError] raw error hidden from the screen:', raw);
    return fallback;
  }
  return localizeTerms(msg.charAt(0).toUpperCase() + msg.slice(1));
};
