import { useEffect, useRef, useState } from 'react';
import { fetchServicePriceForTherapist } from '../services/api';
import { customerFacingServicePriceLabel, formatNPR } from '../services/bookingTransformers';

// A tiered service (migration-323/325) has no single price until a specific
// therapist is known — bookingTransformers.js's customerFacingServicePriceLabel
// returns the range in that case, same as the service list. This hook is what
// resolves it to an actual number once a therapist IS known
// (service_price_for_therapist, wrapped as fetchServicePriceForTherapist),
// for every cart/summary/confirmation screen that shows a total — so a
// tiered line only ever becomes one precise figure, never a guess.
//
// items: Array<{ key, service, therapistId }> — one entry per priced line.
// therapistId is null/undefined for "any"/unassigned; group bookings pass a
// different therapistId per person.
export function useResolvedServicePricing(items) {
  const [resolved, setResolved] = useState({}); // `${serviceId}:${therapistId}` -> number
  const cacheRef = useRef(resolved);
  cacheRef.current = resolved;

  // Primitive dependency key, not the `items` array itself — callers rebuild
  // that array literal every render, which would otherwise refire the fetch
  // effect every render even when nothing actually changed.
  const depKey = items.map((i) => `${i.service?.id ?? ''}:${i.service?.price_type ?? ''}:${i.therapistId ?? ''}`).join('|');

  useEffect(() => {
    const toFetch = [];
    for (const { service, therapistId } of items) {
      if (service?.price_type === 'tiered' && therapistId) {
        const cacheKey = `${service.id}:${therapistId}`;
        if (!(cacheKey in cacheRef.current)) toFetch.push({ serviceId: service.id, therapistId, cacheKey });
      }
    }
    if (toFetch.length === 0) return;

    let cancelled = false;
    Promise.all(
      toFetch.map(({ serviceId, therapistId, cacheKey }) =>
        fetchServicePriceForTherapist(serviceId, therapistId).then(({ data }) => [cacheKey, data])
      )
    ).then((pairs) => {
      if (cancelled) return;
      setResolved((prev) => {
        const next = { ...prev };
        for (const [key, value] of pairs) next[key] = value;
        return next;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const perItem = items.map(({ key, service, therapistId }) => {
    if (!service) return { key, label: null, amount: null };

    if (service.price_type === 'tiered') {
      if (therapistId) {
        const amount = resolved[`${service.id}:${therapistId}`];
        if (amount != null) return { key, label: formatNPR(amount), amount };
      }
      // No therapist yet, or still resolving — same range the list showed,
      // never the Unassigned rate standing in for a real price.
      return { key, label: customerFacingServicePriceLabel(service), amount: null };
    }

    if (service.price_type === 'free') return { key, label: 'Free', amount: 0 };
    if (service.price_type === 'calendar_only' || service.price_type === 'no_default') {
      return { key, label: customerFacingServicePriceLabel(service), amount: null };
    }

    const amount = Number(service.effective_price_npr ?? service.price_npr ?? service.price ?? 0);
    return { key, label: formatNPR(amount), amount };
  });

  let sumKnown = 0;
  let rangeLow = 0;
  let rangeHigh = 0;
  let hasUnresolvedRange = false;
  for (const { key, amount } of perItem) {
    const item = items.find((i) => i.key === key);
    if (amount != null) {
      sumKnown += amount;
      rangeLow += amount;
      rangeHigh += amount;
    } else if (item?.service?.price_type === 'tiered') {
      hasUnresolvedRange = true;
      rangeLow += Number(item.service.min_price ?? 0);
      rangeHigh += Number(item.service.max_price ?? 0);
    }
    // calendar_only/no_default contribute nothing to the total, same as before.
  }

  const totalLabel = hasUnresolvedRange
    ? (rangeLow === rangeHigh
        ? formatNPR(rangeLow)
        : `NPR ${rangeLow.toLocaleString('en-IN')} - ${rangeHigh.toLocaleString('en-IN')}`)
    : formatNPR(sumKnown);

  return { perItem, totalLabel, totalIsRange: hasUnresolvedRange };
}
