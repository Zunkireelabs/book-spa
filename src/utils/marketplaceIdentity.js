// Display-only identity handoff from the Zennly marketplace, for customers who arrive via
// its proxy (localhost:3001/book/* -> this app, same-origin from the browser's point of
// view). The marketplace and book-spa are different Supabase projects
// (fninbtezzrzsmszorfgt vs snzcckzfmpboeqkktmwy) -- book-spa cannot and does not verify the
// marketplace's session. It just asks, same-origin, "who is this" and the marketplace
// answers from its own cookie. This is NOT a book-spa session: never write it to
// customer_account_id, never treat it as authenticated here, never let it skip or alter
// any booking validation. Prefill and header display only -- the booking still identifies
// the customer by phone/email exactly as it always has.
//
// Trigger is deliberately narrow: only attempted when there's a concrete signal this visit
// came through the marketplace (the base-path env var is set, or ?source=zennly is on the
// URL) -- a plain app.zennly.io visit must never even issue this request. Any failure (no
// proxy, no cookie, non-200, malformed body, network error) resolves to null silently; this
// must never block or alter booking.

function isMarketplaceContext() {
  const basePath = import.meta.env.VITE_BASE_PATH;
  if (basePath && basePath !== '/') return true;
  try {
    return new URLSearchParams(window.location.search).get('source') === 'zennly';
  } catch {
    return false;
  }
}

// Response shape per the marketplace's src/lib/supabase/api.ts toAuthUser():
// { id, email, name, phoneVerified, emailVerified }. Deliberately no phone -- prefill
// leaves phone to the customer, same as book-spa's own CustomerAuthContext prefill does
// for an email-only profile.
export async function fetchMarketplaceIdentity() {
  if (!isMarketplaceContext()) return null;

  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.ok || !body?.data) return null;
    const { name, email } = body.data;
    if (!name && !email) return null;
    return { name: name || '', email: email || '' };
  } catch {
    return null;
  }
}
