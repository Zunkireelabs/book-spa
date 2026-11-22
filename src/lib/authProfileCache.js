// Short-lived share of "who is the signed-in user + their users row" (see getAuthenticatedUser in services/api.js).
// Kept in its own module so AuthContext can clear it on sign-out without importing the whole API layer.
import { clearCalendarStatic } from './calendarStaticCache';

const TTL_MS = 30000;
let entry = null; // { key, at, promise }

/** The in-flight or recent lookup for this user+token, or null. */
export function getCachedAuthProfile(key) {
  return entry && entry.key === key && Date.now() - entry.at < TTL_MS ? entry.promise : null;
}
export function setCachedAuthProfile(key, promise) { entry = { key, at: Date.now(), promise }; }
/** Drop the lookup only if it is still this one (a failed lookup must not stay cached). */
export function dropCachedAuthProfile(promise) { if (entry?.promise === promise) entry = null; }
/** Forget everything: after anything that can change the user's own role/visibility, and on sign-out. */
export function invalidateAuthenticatedUser() {
  entry = null;
  clearCalendarStatic(); // the calendar's saved team/rooms/hours depend on the same user + visibility (ZNLY-372)
}
