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
