import { useEffect, useMemo, useState } from 'react';
import { fetchBlocksForRange, fetchTransferOccurrences } from '../services/api';
import { findBlockOverlap, describeBlockOverlap } from '../utils/blockOverlap';

// Block + transfer-window occurrences for one branch/day. Fails open: if blocks can't be loaded (table missing, no
// permission, network) the result is [] so a booking is never blocked by a cosmetic feature.
export function useDayBlocks(branchId, date) {
  const [blocks, setBlocks] = useState([]);
  useEffect(() => {
    if (!branchId || !date) { setBlocks([]); return undefined; }
    let cancelled = false;
    // Manual blocks + transfer windows (as pseudo-blocks). Each part fails open independently.
    Promise.all([
      fetchBlocksForRange(branchId, date, date),
      fetchTransferOccurrences(branchId, date, date),
    ]).then(([blocksRes, transferRes]) => {
      if (!cancelled) setBlocks([...(blocksRes.data || []), ...(transferRes.data || [])]);
    });
    return () => { cancelled = true; };
  }, [branchId, date]);
  return blocks;
}

// { overlap, message } for a proposed booking interval. `query` fields: date, startTime,
// durationMinutes, therapistIds / therapistId, roomId. `enabled` false skips the fetch (returns none).
export function useBlockOverlap(branchId, query, enabled = true) {
  const blocks = useDayBlocks(enabled ? branchId : null, query?.date);
  const key = [query?.date, query?.startTime, query?.durationMinutes, (query?.therapistIds || []).join(','), query?.therapistId, query?.roomId].join('|');
  const overlap = useMemo(
    () => (enabled ? findBlockOverlap(blocks, query) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, key, enabled]
  );
  return { overlap, message: describeBlockOverlap(overlap) };
}
