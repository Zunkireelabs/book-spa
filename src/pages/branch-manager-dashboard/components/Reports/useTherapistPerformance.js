import { useEffect, useMemo, useState } from 'react';
import { useBranch } from 'contexts/BranchContext';
import { fetchTherapistPerformance } from 'services/api';
import { getReportRange } from 'utils/reportPeriod';
import { nepalLocalDate } from 'utils/periodPresets';

// Therapist performance numbers for the header's branch scope (one branch, or every branch under All branches) and the chosen period.
export function useTherapistPerformance(periodId, custom = null) {
  const { branchId, branches, isOverall, loading: branchLoading } = useBranch();
  const range = useMemo(() => getReportRange(periodId, nepalLocalDate(), custom), [periodId, custom?.from, custom?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => (isOverall ? branches.map((b) => b.id) : [branchId]).filter(Boolean), [isOverall, branches, branchId]);
  const key = ids.join(',');
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    if (branchLoading || !ids.length) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchTherapistPerformance({ branchIds: ids, from: range.from, to: range.to }).then(({ data, error }) => {
      if (!alive) return;
      const empty = !error && !data?.current; // no branch in scope for this caller
      setState({ data: error || empty ? null : data, error: error || (empty ? new Error('No data') : null), loading: false });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchLoading, key, range.from, range.to]);

  return { ...state, range, branchCount: branches.length };
}
