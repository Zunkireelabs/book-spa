// Pure helpers: durations, money, dates, phones, names. No I/O.
import { createHash } from 'node:crypto';

// "1h 30m" | "45m" | "3h" | "45" (bare minutes) -> minutes; anything else throws.
export function parseDuration(s) {
  const t = String(s ?? '').trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:m|min))?$/.exec(t);
  if (!m || (m[1] === undefined && m[2] === undefined)) throw new Error(`Unparseable duration: "${s}"`);
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

// Money in integer paisa to avoid float drift in reconciliation.
export function toPaisa(s) {
  const t = String(s ?? '').replace(/[, ]/g, '').trim();
  if (t === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`Bad amount: "${s}"`);
  return Math.round(Number(t) * 100);
}
export const fromPaisa = (p) => p / 100;

// "2026-11-22" + "6:30 pm" -> { date:'2026-11-22', time:'18:30:00' }
export function parseDateTime(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  if (!d) throw new Error(`Bad date: "${dateStr}"`);
  const date = `${d[1]}-${d[2]}-${d[3]}`;
  const t = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(String(timeStr).trim());
  if (!t) throw new Error(`Bad time: "${timeStr}"`);
  let h = Number(t[1]); const mer = (t[3] || '').toLowerCase();
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return { date, time: `${String(h).padStart(2, '0')}:${t[2]}:00` };
}
// "2026-11-22 7:11 PM" -> { date, time }
export function parseStamp(s) {
  const m = /^(\S+)\s+(.+)$/.exec(String(s).trim());
  if (!m) throw new Error(`Bad timestamp: "${s}"`);
  return parseDateTime(m[1], m[2]);
}

// Fresha appointment ref ("#C8BFE7D9") and payment ref ("c8bfe7d9") compare equal.
export const normRef = (s) => String(s ?? '').replace(/^#/, '').trim().toLowerCase();

export const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Dialling codes seen in the export; longest-match first. Country = ISO-ish label.
const CODES = [['977', 'Nepal'], ['971', 'United Arab Emirates'], ['61', 'Australia'], ['44', 'United Kingdom'],
  ['31', 'Netherlands'], ['91', 'India'], ['86', 'China'], ['81', 'Japan'], ['82', 'South Korea'], ['65', 'Singapore'],
  ['49', 'Germany'], ['33', 'France'], ['1', 'United States']];
// Returns { phone:'+97798...', country } or null for blank. Never forces +977.
export function normalizePhone(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  const plus = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);
  if (!d) return null;
  if (plus) {
    const hit = CODES.find(([c]) => d.startsWith(c));
    return { phone: `+${d}`, country: hit ? hit[1] : null };
  }
  if (d.startsWith('0')) d = d.slice(1);
  if (/^9[78]\d{8}$/.test(d)) return { phone: `+977${d}`, country: 'Nepal' }; // Nepal mobile with no prefix
  const hit = CODES.find(([c]) => d.startsWith(c) && d.length > c.length + 6);
  if (hit) return { phone: `+${d}`, country: hit[1] };
  return { phone: null, country: null, unparsed: raw }; // caller lists it; never invent a code
}

// Deterministic uuid v5 from a Fresha key.
const NS = 'zennly-fresha-import:v1';
export function uuid5(name) {
  const h = createHash('sha1').update(NS + '|' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// DB booking_status has no 'Booked': Fresha Booked -> Confirmed (stays an open booking).
export const STATUS_MAP = { completed: 'Completed', canceled: 'Cancelled', cancelled: 'Cancelled', 'did not show': 'No Show', booked: 'Confirmed' };
export function mapStatus(s) {
  const v = STATUS_MAP[String(s).trim().toLowerCase()];
  if (!v) throw new Error(`Unknown Fresha status: "${s}"`);
  return v;
}
