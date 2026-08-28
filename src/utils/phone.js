// Canonical phone handling — one format everywhere: E.164 "+<countrycode><national>",
// digits only after the leading "+".
//
// Why this exists: the app used to normalize every number to "last 10 digits"
// (`.replace(/\D/g,'').slice(-10)`), which is correct only for Nepal (+977 + a
// 10-digit national number). Any other country's number lost or mangled its
// country code in the `customers` table and in every phone-based lookup, so an
// international customer could not be matched to themselves and two different
// countries' numbers sharing their last 10 digits collided into one record.
//
// The DB stores E.164 (`bookings.customer_phone`, `customers.phone`), a BEFORE
// INSERT/UPDATE trigger canonicalises it there too (see
// supabase/migration-128-phone-e164.sql), and every JS comparison runs both
// sides through `toE164()` so a legacy bare-national straggler still matches a
// freshly-normalised value.

const DEFAULT_DIAL = '+977'; // Nepal — the app's home country

// Bare national numbers up to this length are assumed to be missing their
// country code and get `fallbackDial` prepended. Nepal mobile numbers are
// exactly 10 digits; nothing shorter is a valid full international number.
const MAX_BARE_NATIONAL = 10;

/**
 * Normalise any user/DB phone value to canonical E.164: `+` followed by digits.
 *
 * - `"+977 984-123-4567"`      -> `"+9779841234567"`
 * - `"9841234567"`             -> `"+9779841234567"` (bare national, default dial)
 * - `"9779841234567"`          -> `"+9779841234567"` (national already carries 977)
 * - `"+1"` + `"5551234567"`    -> `"+15551234567"`
 * - `""` / `null` / no digits  -> `null`
 *
 * @param {string|null|undefined} raw
 * @param {string} [fallbackDial='+977'] dial code to assume when `raw` has no `+`
 *   and looks like a bare national number
 * @returns {string|null}
 */
export function toE164(raw, fallbackDial = DEFAULT_DIAL) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const hadPlus = str.startsWith('+');
  const digits = str.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) return `+${digits}`;

  const fbDigits = String(fallbackDial || DEFAULT_DIAL).replace(/\D/g, '') || '977';

  // Bare national number (no country code typed) — prepend the fallback dial.
  if (digits.length <= MAX_BARE_NATIONAL) return `+${fbDigits}${digits}`;

  // Longer: it already includes some country code (either the fallback, or a
  // real one the caller passed inline). Trust it as-is.
  return `+${digits}`;
}

/** Digits-only form of an E.164 value, for equality checks. `null`-safe. */
export function phoneDigits(value) {
  const e164 = toE164(value);
  return e164 ? e164.slice(1) : null;
}

/**
 * True when two phone values refer to the same number, tolerant of formatting
 * and of one side being a legacy bare-national string.
 */
export function samePhone(a, b, fallbackDial = DEFAULT_DIAL) {
  const da = toE164(a, fallbackDial);
  const db = toE164(b, fallbackDial);
  return da != null && da === db;
}

// Country dial codes we recognise, longest first — so `+1` doesn't shadow
// `+977` style matches. Kept in sync with CountryCodeSelect's COUNTRIES list.
const DIAL_CODES = [
  '+977', '+975', '+974', '+973', '+972', '+971', '+968', '+966', '+965', '+960', '+880', '+852', '+353',
  '+91', '+44', '+61', '+86', '+81', '+82', '+65', '+60', '+66', '+92', '+94', '+95', '+62', '+63', '+84',
  '+64', '+49', '+33', '+39', '+34', '+31', '+41', '+46', '+47', '+45', '+90', '+27', '+20', '+55', '+52',
  '+98', '+93',
  '+7', '+1',
].sort((a, b) => b.length - a.length);

/**
 * Split a canonical E.164 value into `{ dial, national }` for display or for
 * seeding a country-code picker. Falls back to `{ dial: fallbackDial, national }`
 * when no known dial-code prefix matches.
 */
export function splitE164(value, fallbackDial = DEFAULT_DIAL) {
  const e164 = toE164(value, fallbackDial);
  if (!e164) return { dial: fallbackDial, national: '' };

  for (const dial of DIAL_CODES) {
    const code = dial.slice(1);
    if (e164.startsWith(`+${code}`) && e164.length - 1 - code.length >= 4) {
      return { dial, national: e164.slice(1 + code.length) };
    }
  }
  return { dial: fallbackDial, national: e164.slice(1) };
}

/** Human-readable `+977 9841234567`. */
export function formatPhoneDisplay(value, fallbackDial = DEFAULT_DIAL) {
  const e164 = toE164(value, fallbackDial);
  if (!e164) return '';
  const { dial, national } = splitE164(e164, fallbackDial);
  return national ? `${dial} ${national}` : dial;
}
