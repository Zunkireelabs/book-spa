import { useEffect, useState } from 'react';
import { fetchServiceBookingCounts, fetchServiceCategoryOrder, fetchServiceMinTierPrices } from '../services/api';

// ZNLY-320: the extras the service picker needs beyond the service list: booking counts (MOST BOOKED), category order, tier prices.
// Shared 60 s cache per branch so eight pickers on one screen load once. Every failure resolves to empty data: no group, no error on screen.
const TTL = 60000;
const cache = new Map();
const EMPTY = { counts: [], categoryOrder: {}, tiers: {} };

const load = (branchId) => {
  const hit = cache.get(branchId || '');
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = Promise.all([fetchServiceBookingCounts(branchId), fetchServiceCategoryOrder(), fetchServiceMinTierPrices()])
    .then(([c, o, t]) => ({ counts: c?.data || [], categoryOrder: o?.data || {}, tiers: t?.data || {} }))
    .catch(() => EMPTY);
  cache.set(branchId || '', { at: Date.now(), p });
  return p;
};

export default function useServicePickerData(branchId) {
  const [data, setData] = useState(EMPTY);
  useEffect(() => {
    let alive = true;
    load(branchId).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [branchId]);
  return data;
}
