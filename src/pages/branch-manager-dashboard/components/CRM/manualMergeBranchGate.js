// Manual Merge needs a real, single branch id to resolve the org for
// fetchCustomersLightweight() — the '__overall__' sentinel (or a missing
// branchId) can't do that (see PR #314 review, 2026-09-24 session log): it
// silently falls back to a hardcoded default branch belonging to a specific
// tenant, so search returns nothing for every other org with no visible
// error. Block the search UI instead of letting that happen quietly.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canSearchForMerge({ isOverall, branchId }) {
  if (!branchId || !UUID_RE.test(branchId)) return false;
  return true;
}
