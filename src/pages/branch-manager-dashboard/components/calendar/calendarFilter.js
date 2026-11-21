// Team filter helpers (pure). State is the list of UNTICKED people (hidden); empty = everyone ticked = nothing narrowed.

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// Only ids that are in the universe count (stale ids for people no longer listed are ignored).
const hiddenIn = (hiddenIds = [], universe = []) => universe.filter((p) => hiddenIds.includes(p.id));
export const tickedCount = (hiddenIds, universe = []) => universe.length - hiddenIn(hiddenIds, universe).length;
export const isTicked = (hiddenIds = [], id) => !hiddenIds.includes(id);

// Untick/tick one person. Unticking the last ticked person is refused (state returned unchanged): the calendar is never empty.
export function toggleStaff(hiddenIds = [], id, universe = []) {
  if (hiddenIds.includes(id)) return hiddenIds.filter((x) => x !== id);
  if (tickedCount(hiddenIds, universe) <= 1) return hiddenIds;
  return [...hiddenIds, id];
}
export const isLastTicked = (hiddenIds, id, universe) => isTicked(hiddenIds, id) && tickedCount(hiddenIds, universe) <= 1;

// Narrowed = someone unticked (among listed staff) or a position picked.
export const isTeamFilterActive = ({ hiddenStaffIds = [], selectedPositions = [], universe = [] }) => hiddenIn(hiddenStaffIds, universe).length + selectedPositions.length > 0;

// Button label: everyone -> "All {plural}"; one person left -> first name; otherwise "N of M {plural}". Positions only -> "N selected".
export function teamFilterLabel({ hiddenStaffIds = [], selectedPositions = [], universe = [], allLabel, plural = 'staff' }) {
  const hidden = hiddenIn(hiddenStaffIds, universe).length;
  if (hidden === 0) return selectedPositions.length ? `${selectedPositions.length} selected` : allLabel;
  const n = universe.length - hidden;
  if (n === 1) { const p = universe.find((s) => !hiddenStaffIds.includes(s.id)); return firstName(p?.name) || `1 of ${universe.length} ${plural}`; }
  return `${n} of ${universe.length} ${plural}`;
}

export const teamAllLabel = (staffLabel, staffLabelPlural) => `All ${(staffLabelPlural || 'staff').toLowerCase()}`;

export const staffInitials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
