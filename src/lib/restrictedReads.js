// ZNLY-235: a restricted login (own-only calendar, hidden customer details or hidden prices) gets NOTHING from the sensitive base
// tables (migration 393 RLS); it reads the masked *_safe views instead. This wraps fetch so every GET/HEAD for those tables
// is pointed at the view, with no change at any call site. Writes (POST/PATCH/DELETE) still go to the base table.
// Normal roles never set the flag, so for them this wrapper is a pass-through.
const SAFE_VIEWS = {
  bookings: 'bookings_safe',
  customers: 'customers_safe',
  payments: 'payments_safe',
  payment_refunds: 'payment_refunds_safe',
  booking_tips: 'booking_tips_safe',
  product_sales: 'product_sales_safe',
  notifications: 'notifications_safe',
};

let restricted = false;
export const setRestrictedReads = (value) => { restricted = !!value; };
export const isReadingViaSafeViews = () => restricted;

// Embedded joins in the select (booking:bookings(...), payments(...)) would hit the blocked base tables: point them at the views too,
// keeping the key the caller reads ("bookings(" becomes "bookings:bookings_safe("). Hinted embeds (table!fk) are left alone.
const EMBED_RE = new RegExp(`(^|[,(])((?:[a-z_]+:)?)(${Object.keys(SAFE_VIEWS).join('|')})(?=\\()`, 'g');
export const rewriteSelect = (sel) => sel.replace(EMBED_RE, (_, pre, alias, table) => `${pre}${alias || `${table}:`}${SAFE_VIEWS[table]}`);
// supabase-js percent-encodes the select string, so rewrite the decoded parameter, not the raw query string.
export const rewriteEmbeds = (qs) => {
  const p = new URLSearchParams(qs.replace(/^\?/, ''));
  const sel = p.get('select');
  if (sel == null) return qs;
  p.set('select', rewriteSelect(sel));
  return `?${p.toString()}`;
};

export function rewriteForRestricted(url, method = 'GET') {
  if (!restricted || !['GET', 'HEAD'].includes(String(method).toUpperCase())) return url;
  const m = String(url).match(/^(.*\/rest\/v1\/)([a-z_]+)(\?.*)?$/);
  if (!m || !SAFE_VIEWS[m[2]]) return url;
  return `${m[1]}${SAFE_VIEWS[m[2]]}${m[3] ? rewriteEmbeds(m[3]) : ''}`;
}

export const withRestrictedReads = (baseFetch) => (input, init) => {
  const isReq = typeof input !== 'string' && !(input instanceof URL);
  const url = isReq ? input.url : String(input);
  const method = (init && init.method) || (isReq ? input.method : 'GET');
  const next = rewriteForRestricted(url, method);
  if (next === url) return baseFetch(input, init);
  return baseFetch(isReq ? new Request(next, input) : next, init);
};
