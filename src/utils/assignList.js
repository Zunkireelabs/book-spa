// Staff list for the booking panel's assign tab (ZNLY-286): who is shown, in what order.
// rows = people matching the search (all when the search is empty), the currently assigned first, original order otherwise.
// pinned = selected people that do NOT match the search; they stay visible so a selection is never hidden.
export function arrangeAssignees(people, { assignedIds = [], selectedIds = [], query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const assigned = new Set(assignedIds);
  const selected = new Set(selectedIds);
  const byAssigned = (list) => [...list.filter((p) => assigned.has(p.id)), ...list.filter((p) => !assigned.has(p.id))];
  const matches = (p) => !q || String(p.name || '').toLowerCase().includes(q);
  const rows = byAssigned(people.filter(matches));
  const pinned = q ? byAssigned(people.filter((p) => !matches(p) && selected.has(p.id))) : [];
  // Selected people that are in this list vs. ones the login cannot see (kept in the selection, never shown or dropped).
  const ids = new Set(people.map((p) => p.id));
  const selectedVisible = [...selected].filter((id) => ids.has(id)).length;
  return { rows, pinned, matchCount: rows.length, total: people.length, filtering: !!q, selectedVisible, hiddenSelected: selected.size - selectedVisible };
}

export const STICKY_SEARCH_MIN = 8; // search sticks under the tabs from this many people
