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

import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { DIAL_CODES, countryByDial } from './countries';

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

/**
 * Display with a Nepal mobile number grouped 3-3-4: `+977 980-000-0026`. Any other number (other country, other length)
 * falls back to formatPhoneDisplay's plain `+dial national`. Empty / invalid → ''.
 */
export function formatPhoneGrouped(value, fallbackDial = DEFAULT_DIAL) {
  if (typeof value === 'string' && value.includes('•')) return value; // already masked by the server (ZNLY-235): show as is
  const e164 = toE164(value, fallbackDial);
  if (!e164) return '';
  const { dial, national } = splitE164(e164, fallbackDial);
  if (dial === '+977' && /^\d{10}$/.test(national)) return `${dial} ${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  return national ? `${dial} ${national}` : dial;
}

/**
 * Phone value to save from an edit form that shows `dial` + `national` (ZNLY-324). Saved the way New booking saves
 * (`dial` + digits); a number the user did not touch is returned exactly as it was stored, so it round-trips unchanged.
 */
export function phoneToSave({ dial, national, initialDial, initialNational, original }) {
  if (dial === initialDial && national === initialNational) return String(original || '').trim() || null;
  const digits = String(national || '').replace(/\D/g, '');
  return digits ? `${dial}${digits}` : null;
}

// ZNLY-327: one validator for a typed phone number, any country. A number is rejected when it is not a valid number for the dial code's country
// (too short / too long / a pattern no carrier uses: libphonenumber-js, min metadata), when every digit is the same, or when it is a plain
// run (123456..., 9876543210). Only for numbers someone TYPED: a stored number is never re-checked (see phoneToSave's "untouched" rule).
const isRun = (d) => {
  if (d.length < 6) return false;
  const steps = new Set();
  for (let i = 1; i < d.length; i += 1) steps.add((Number(d[i]) - Number(d[i - 1]) + 10) % 10);
  return steps.size === 1 && (steps.has(1) || steps.has(9));
};
export function isValidPhone(dial, national) {
  const d = String(national || '').replace(/\D/g, '');
  if (!d) return false;
  if (/^(\d)\1+$/.test(d) || isRun(d)) return false;
  const parsed = parsePhoneNumberFromString(`${dial}${d}`);
  return !!parsed && parsed.isValid();
}

/** The plain-language reason a typed number is rejected, or '' when it is fine (or empty: "required" is the caller's rule). */
export function phoneProblem(dial, national) {
  if (!String(national || '').replace(/\D/g, '')) return '';
  if (isValidPhone(dial, national)) return '';
  return `This number isn't valid for ${countryByDial(dial).name}. Use Walk-in if the customer has no number.`;
}

/** Edit forms: the reason to block a save, only when the number was changed from what was loaded ('' = fine; an untouched number always saves). */
export function phoneEditProblem({ dial, national, initialDial, initialNational }) {
  if (dial === initialDial && national === initialNational) return '';
  return phoneProblem(dial, national);
}
