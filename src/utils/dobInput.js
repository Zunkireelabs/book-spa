// Masked "DD/MM/YYYY" date-of-birth entry (a month picker is unusable for birthdays). The text is what the user sees; the
// ISO "YYYY-MM-DD" is what is stored.

// Keep digits only (max 8) and insert the slashes: "15031990" -> "15/03/1990".
export const maskDob = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

export const MAX_AGE_YEARS = 120;

// "" -> no value; otherwise { iso } for a real, past date at most 120 years ago, or { error } in plain words.
export const parseDob = (text, today = new Date()) => {
  const t = String(text ?? '').trim();
  if (!t) return { iso: '', error: null };
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return { iso: null, error: 'Enter the date as DD/MM/YYYY.' };
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return { iso: null, error: "That date doesn't exist." };
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (d > startOfToday) return { iso: null, error: "Date of birth can't be in the future." };
  const oldest = new Date(startOfToday.getFullYear() - MAX_AGE_YEARS, startOfToday.getMonth(), startOfToday.getDate());
  if (d < oldest) return { iso: null, error: `Check the year — that is more than ${MAX_AGE_YEARS} years ago.` };
  return { iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, error: null };
};

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Month | Day | Year fields (month 1-12 as a number/string, day and year as typed). Same rules as parseDob.
// All three empty -> no value. A partly filled date is an error; the year must be 4 digits (customers.date_of_birth is a full date).
export const parseDobParts = ({ month, day, year } = {}, today = new Date()) => {
  const m = String(month ?? '').trim(), d = String(day ?? '').trim(), y = String(year ?? '').trim();
  if (!m && !d && !y) return { iso: '', error: null };
  if (!m || !d || !y) return { iso: null, error: 'Pick the month, day and year.' };
  if (!/^\d{4}$/.test(y)) return { iso: null, error: 'Check the year.' };
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m)) return { iso: null, error: "That date doesn't exist." };
  const r = parseDob(`${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`, today);
  if (r.error && r.error.startsWith('Check the year')) return { iso: null, error: 'Check the year.' };
  return r;
};

// "2026-11-22" -> { month: 11, day: 22, year: 2026 } (null for anything else).
export const splitIsoDob = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
};

// "12 Mar" for a stored ISO date of birth ('' if none).
export const formatBirthdayShort = (iso) => {
  const p = splitIsoDob(iso);
  return p ? `${p.day} ${MONTH_NAMES[p.month - 1].slice(0, 3)}` : '';
};

export const BIRTHDAY_SOON_DAYS = 7;

// Days from `todayIso` (Nepal date, "YYYY-MM-DD") to the next birthday: 0 = today. null if no valid DOB.
// A 29 Feb birthday is celebrated on 1 Mar in non-leap years.
export const daysUntilBirthday = (dobIso, todayIso) => {
  const p = splitIsoDob(dobIso), t = splitIsoDob(todayIso);
  if (!p || !t) return null;
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const at = (y) => (p.month === 2 && p.day === 29 && !leap(y) ? Date.UTC(y, 2, 1) : Date.UTC(y, p.month - 1, p.day));
  const todayMs = Date.UTC(t.year, t.month - 1, t.day);
  let next = at(t.year);
  if (next < todayMs) next = at(t.year + 1);
  return Math.round((next - todayMs) / 86400000);
};

// Gold chip text when the birthday is today or within 7 days, else ''.
export const birthdaySoonLabel = (dobIso, todayIso) => {
  const n = daysUntilBirthday(dobIso, todayIso);
  if (n === null || n > BIRTHDAY_SOON_DAYS) return '';
  if (n === 0) return 'Birthday today';
  return n === 1 ? 'Birthday tomorrow' : `Birthday in ${n} days`;
};
