// ZNLY-320: pure logic behind the shared service picker (ServicePicker / ServicePickRow).
import { formatNPR } from '../services/bookingTransformers';

export const MOST_BOOKED_MIN_EACH = 5;
export const MOST_BOOKED_MIN_TOTAL = 20;
export const MOST_BOOKED_MAX = 3;
export const HEADERS_MIN_CATEGORIES = 2;
export const HEADERS_MIN_SERVICES = 8; // headers show when there are MORE than this many services

// counts: [{ service_id, booking_count, last_booked_at }] (last 90 days, one branch). bookable: the services this picker may offer.
// Returns up to 3 service ids: ≥5 bookings each, [] when the branch total in the window is <20. Ties: later last_booked_at, then name.
export function mostBooked(counts, bookable) {
  if (!Array.isArray(counts) || !Array.isArray(bookable) || bookable.length === 0) return [];
  const total = counts.reduce((n, c) => n + (Number(c.booking_count) || 0), 0);
  if (total < MOST_BOOKED_MIN_TOTAL) return [];
  const byId = new Map(bookable.map((s) => [s.id, s]));
  return counts
    .filter((c) => byId.has(c.service_id) && Number(c.booking_count) >= MOST_BOOKED_MIN_EACH)
    .sort((a, b) =>
      (Number(b.booking_count) - Number(a.booking_count))
      || ((Date.parse(b.last_booked_at) || 0) - (Date.parse(a.last_booked_at) || 0))
      || String(byId.get(a.service_id).name).localeCompare(String(byId.get(b.service_id).name)))
    .slice(0, MOST_BOOKED_MAX)
    .map((c) => c.service_id);
}

// categoryOrder: { [categoryName]: display_order }. Ordered categories first (by display_order), unordered ones A–Z after them.
export function categoryGroups(services, categoryOrder = {}) {
  const key = (c) => (Object.prototype.hasOwnProperty.call(categoryOrder, c) ? [0, Number(categoryOrder[c]), ''] : [1, 0, String(c).toLowerCase()]);
  const names = [...new Set(services.map((s) => s.category || 'Other'))];
  names.sort((a, b) => { const x = key(a); const y = key(b); return (x[0] - y[0]) || (x[1] - y[1]) || x[2].localeCompare(y[2]) || String(a).localeCompare(String(b)); });
  return names.map((name) => ({ name, items: services.filter((s) => (s.category || 'Other') === name) }));
}

// Headers rule: 2+ categories AND more than 8 services.
export const showCategoryHeaders = (services) =>
  new Set(services.map((s) => s.category || 'Other')).size >= HEADERS_MIN_CATEGORIES && services.length > HEADERS_MIN_SERVICES;

// tiers: [price_npr, ...] of the service's tier rows. "from" only for price_type='tiered' WITH tier rows: lowest of base and tiers.
export function priceLine(service, tiers, canViewPrices = true) {
  const dur = service.duration_minutes ? `${service.duration_minutes} min` : '';
  if (!canViewPrices) return dur;
  const base = service.effective_price_npr ?? service.price_npr;
  if (base == null) return dur;
  let price = formatNPR(Number(base));
  if (service.price_type === 'tiered' && Array.isArray(tiers) && tiers.length > 0) {
    const lo = Math.min(Number(service.price_npr ?? base), ...tiers.map(Number));
    price = `from ${formatNPR(lo)}`;
  }
  return [dur, price].filter(Boolean).join(' · ');
}

// Search: case-insensitive name match, today's order, no grouping.
export const searchServices = (services, q) => {
  const t = String(q || '').trim().toLowerCase();
  return t ? services.filter((s) => String(s.name).toLowerCase().includes(t)) : services;
};

// ZNLY-322: "Fill free staff" only makes sense once a service (so a length) exists: Same = the group service; Different = at least one guest has one.
export const shouldShowFillFree = ({ serviceMode, groupServiceId, people }) =>
  serviceMode === 'same' ? !!groupServiceId : (people || []).some((p) => !!p.serviceId);
