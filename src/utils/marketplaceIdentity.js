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
// { id, email, name, firstName, lastName, phone, gender, country, phoneVerified,
// emailVerified }. Destructured with `|| ''` defaults deliberately -- this must stay
// backward- AND forward-compatible with a marketplace deployment that hasn't shipped the
// newer fields yet (they just come back as '', same as today) and with one that has.
//
// Phone arriving here is UNVERIFIED on the marketplace side -- a plain self-asserted text
// field with no OTP behind it (the marketplace has no SMS provider). Prefill only: it must
// still pass isValidPhoneForCountry and the customer's own review before anything is
// submitted. It is never written anywhere as a trusted value on book-spa's side.
//
// The invariant from the header comment stays true regardless of which fields this
// returns: never write any of this to customer_account_id, never treat it as an
// authenticated session, never let it skip or alter any booking validation. The booking
// still identifies the customer by phone/email exactly as it always has -- this just
// saves them retyping what the marketplace already has on file.
export async function fetchMarketplaceIdentity() {
  if (!isMarketplaceContext()) return null;

  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.ok || !body?.data) return null;
    const { name, email, firstName, lastName, phone, gender, country } = body.data;
    if (!name && !email) return null;
    return {
      name: name || '',
      email: email || '',
      firstName: firstName || '',
      lastName: lastName || '',
      phone: phone || '',
      gender: gender || '',
      country: country || '',
    };
  } catch {
    return null;
  }
}
