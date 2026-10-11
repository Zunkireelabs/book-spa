import { isOverallBranch } from '../../../../services/api';

// Manual Merge needs either a real, single branch id or the '__overall__'
// sentinel to resolve the org for fetchCustomersLightweight() — a missing
// branchId can't do either (see PR #314 review, 2026-09-24 session log).
// fetchCustomersLightweight now resolves the Overall sentinel via the
// logged-in user's own profile instead of silently falling back to a
// hardcoded default branch belonging to a specific tenant, so the sentinel
// is safe to let through here too.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canSearchForMerge({ isOverall, branchId }) {
  if (isOverallBranch(branchId)) return true;
  if (!branchId || !UUID_RE.test(branchId)) return false;
  return true;
}
