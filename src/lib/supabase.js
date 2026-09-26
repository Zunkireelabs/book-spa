import { createClient } from '@supabase/supabase-js';
import { createRetryingFetch } from './supabaseRetry';
import { captureApiError } from './analytics';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
}

// One wrapper shared by all three clients. Retries the transient Postgres errors
// that a poisoned PostgREST pool connection produces, and reports every API error
// to PostHog. Placing it here rather than in services/api.js covers every call
// site in the app — including ones added later — with no per-call changes.
//
// Exported (not module-private) so the one raw-fetch PostgREST call outside the
// supabase-js clients — AuthContext.jsx's direct /rest/v1/users fetch, used right
// after signInWithPassword before the client's own session state is ready — can
// share this exact wrapper instead of a second, divergent one.
export const retryingFetch = createRetryingFetch({ onError: captureApiError });

// Customer auth is now email-OTP (a 6-digit code typed inline, verified via
// supabaseCustomer.auth.verifyOtp) rather than email-link redirects, so no
// client actually needs to consume tokens out of a URL anymore. This was a
// real bug when it did apply, though: all three clients used to default to
// detectSessionInUrl: true, so each independently raced to parse the same
// #access_token=... fragment from a confirmation-link redirect — whichever
// client won grabbed the session, which was wrong whenever it wasn't
// supabaseCustomer (e.g. the staff AuthContext would end up "signed in" as
// the customer and 406 trying to look up a non-existent `users` row, while
// CustomerAuthContext never saw the session at all). Staff uses PIN login
// and platform uses password login — neither ever needs URL-token parsing —
// so it stays disabled here as defense-in-depth even though nothing should
// land on these routes with tokens in the URL now.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false },
  global: { fetch: retryingFetch },
});

// Separate client for customer-facing auth (own storage key) so a customer
// logging in on /:orgSlug/book doesn't clobber a staff session in the same
// browser, and vice versa.
export const supabaseCustomer = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-customer-auth' },
  global: { fetch: retryingFetch },
});

// Isolated client for the platform super-admin area (own storage key) so a
// platform login never triggers the staff AuthContext listener (which would
// look up a non-existent org profile and bounce to /login). Mirrors
// supabaseCustomer's isolation. Never used for email-link flows, so it's
// excluded from the URL-token race for the same reason as `supabase` above.
export const supabasePlatform = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-platform-auth', detectSessionInUrl: false },
  global: { fetch: retryingFetch },
});
