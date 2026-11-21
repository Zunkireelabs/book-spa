import { useEffect, useMemo, useState } from 'react';
import { useBranch } from 'contexts/BranchContext';
import { fetchBusinessHealth } from 'services/api';
import { getReportRange } from 'utils/reportPeriod';

// Business health numbers for the header's branch scope (one branch, or every branch under All branches) and the chosen period.
// Shared by the Reports home (its key number) and the report itself, so both always agree.
export function useBusinessHealth(periodId, enabled = true, custom = null) {
  const { branchId, branches, isOverall, loading: branchLoading } = useBranch();
  const range = useMemo(() => getReportRange(periodId, new Date(), custom), [periodId, custom?.from, custom?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => (isOverall ? branches.map((b) => b.id) : [branchId]).filter(Boolean), [isOverall, branches, branchId]);
  const key = ids.join(',');
  const [state, setState] = useState({ data: null, error: null, loading: true, key: '' });

  useEffect(() => {
    if (!enabled || branchLoading || !ids.length) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchBusinessHealth({ branchIds: ids, from: range.from, to: range.to }).then(({ data, error }) => {
      if (!alive) return;
      const empty = !error && !data?.current; // no branch in scope for this caller
      setState({ data: error || empty ? null : data, error: error || (empty ? new Error('No data') : null), loading: false, key: `${key}|${range.from}|${range.to}` });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, branchLoading, key, range.from, range.to]);

  return { ...state, range, branchCount: branches.length };
}
