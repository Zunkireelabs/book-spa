// Initials-avatar fallback, shared by the professional cards and the profile modal.
// Every sbal staff member currently has photo_url NULL, so this is the default path
// rather than an edge case — the tint is picked deterministically from a char-code sum
// of the name so the same person always gets the same colour across renders and
// sessions, without needing a stored colour column.
const AVATAR_TINTS = [
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-pink-100', text: 'text-pink-700' },
];

export function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getTint(name) {
  const sum = (name || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_TINTS[sum % AVATAR_TINTS.length];
}
