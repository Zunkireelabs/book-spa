import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, retryingFetch } from '../lib/supabase';
import { identify, reset, setGroup } from '../lib/analytics';
import { isTransientStatus, ServiceUnavailableError } from '../lib/supabaseRetry';
import { isLoginAllowed, LOGIN_OFF_MESSAGE, isLoginOffHookError, LOGIN_OFF_HOOK_MESSAGE } from '../services/loginAccess';
import { setRestrictedReads } from '../lib/restrictedReads';
import { isRestricted } from '../services/dataMasking';

// Ceiling on how long the profile fetch may run before we give up and treat it
// as "service unavailable" rather than leaving the app on a spinner forever.
// A poisoned/unreachable database (503 / TCP connect timeout) is exactly the
// case this bounds — without it, a down database leaves logged-in staff staring
// at "Loading..." indefinitely.
const PROFILE_FETCH_TIMEOUT_MS = 12000;

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Get the dashboard path for a user based on their role and org.
 * @param {string} role - User's role (staff, manager, admin)
 * @param {string} orgSlug - Organization slug (e.g., 'nuad-thai-spa')
 * @returns {string} - Dashboard path
 */
export const getDashboardPath = (role, orgSlug) => {
  // If no orgSlug provided, fall back to legacy path (for backwards compatibility during transition)
  if (!orgSlug) {
    switch (role) {
      case 'manager':
      case 'admin':
      case 'admin_viewer':
        return '/branch-manager-dashboard';
      case 'staff':
      default:
        return '/branch-staff-dashboard';
    }
  }

  // New org-scoped path - role determines the view, not the URL
  return `/${orgSlug}/dashboard`;
};

/**
 * Where to send a freshly authenticated user: the page they originally asked for, but only if it is a plain in-app path
 * inside their OWN org (`/<their-org>/...`). Anything else (another org, an absolute URL, protocol-relative `//host`,
 * the login page itself) is ignored and the caller falls back to the default dashboard.
 * @param {{pathname?: string, search?: string, hash?: string}|string|undefined} from - `location.state.from`
 * @param {string} orgSlug - the authenticated user's org slug
 * @returns {string|null}
 */
export const getSafeRedirect = (from, orgSlug) => {
  if (!from || !orgSlug) return null;
  const pathname = typeof from === 'string' ? from.split(/[?#]/)[0] : from.pathname;
  if (typeof pathname !== 'string' || !pathname.startsWith(`/${orgSlug}/`)) return null;
  const rest = typeof from === 'string' ? from.slice(pathname.length) : `${from.search || ''}${from.hash || ''}`;
  if (/[\\]|:\/\//.test(pathname + rest)) return null;
  if (/(^|\/)\.\.?(\/|$)/.test(pathname)) return null; // no dot-segments
  if (pathname === `/${orgSlug}/login`) return null;
  return `${pathname}${rest}`;
};

/**
 * Fetch a user's staff profile from public.users with branch name.
 *
 * When called with an explicit accessToken (e.g. right after signIn),
 * we use a direct REST call because the supabase-js client's internal
 * session state may not be ready yet after signInWithPassword.
 *
 * When called without a token (page refresh), the supabase client reads
 * the stored session from localStorage automatically — this path works fine.
 */
// ZNLY-216: an explicit column list, never '*': users.pin is not readable by the app (migration-384), so '*' would be refused.
// ZNLY-235: the restricted-read flag is set HERE, before the profile reaches React, so no child query can fire first.
async function fetchProfile(userId, accessToken) {
  const p = await fetchProfileRaw(userId, accessToken);
  setRestrictedReads(isRestricted(p));
  return p;
}

async function fetchProfileRaw(userId, accessToken) {
  try {
    if (accessToken) {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/users`
        + `?select=id,email,full_name,role,branch_id,is_active,created_at,org_id,login_access,calendar_visibility,can_view_customer_details,can_view_prices,branches!users_branch_id_fkey(name),organizations(id,name,code,slug,industry_type,industries(id,name,staff_label,staff_label_plural,location_label,location_label_plural,enable_rooms,enable_staff_gender))&id=eq.${userId}`;
      // Routed through the shared retryingFetch (not a raw fetch) so this PostgREST
      // call gets the same 25P02/40001/40P01 retry + telemetry as every request
      // issued through the supabase-js clients — this is the same poisoned-pool
      // traffic, just reached via a direct URL instead of the client.
      //
      // Bounded by an AbortController: when the database is unreachable (503 /
      // TCP connect timeout, the 2026-09-26 outage) the request can otherwise
      // hang until the browser's default timeout, leaving the user on a spinner.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROFILE_FETCH_TIMEOUT_MS);
      let res;
      try {
        res = await retryingFetch(url, {
          signal: controller.signal,
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.pgrst.object+json',
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const body = await res.text();
        console.error('[Auth] Profile fetch failed:', res.status, body);
        // Distinguish "database is down" from "this account has no profile":
        // a transient/5xx status means the user should be told to retry, not
        // that their account is broken. A genuine 4xx (e.g. 406 no row) falls
        // through to `return null` and is handled as a missing profile.
        if (isTransientStatus(res.status) || res.status >= 500) {
          throw new ServiceUnavailableError(undefined, { status: res.status });
        }
        return null;
      }
      return await res.json();
    }

    // Fallback: use supabase client (session from localStorage)
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, branch_id, is_active, created_at, org_id, login_access, calendar_visibility, can_view_customer_details, can_view_prices, branches!users_branch_id_fkey(name), organizations(id, name, code, slug, industry_type, industries(id, name, staff_label, staff_label_plural, location_label, location_label_plural, enable_rooms, enable_staff_gender))')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[Auth] Profile fetch error:', error.message);
      // PostgREST surfaces the SQLSTATE/status on the error object. A transient
      // infrastructure failure (503/network) must be reported as unavailable so
      // the caller can prompt a retry instead of logging the user out.
      const status = Number(error.status ?? error.code);
      if (isTransientStatus(status) || status >= 500 || error.message === 'Failed to fetch') {
        throw new ServiceUnavailableError(undefined, { status: Number.isFinite(status) ? status : 0, cause: error });
      }
      return null;
    }
    return data;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    // A network throw or AbortController timeout — the database was unreachable,
    // not a missing profile. Surface it as unavailable, not as null.
    console.error('[Auth] Profile fetch exception:', err);
    throw new ServiceUnavailableError(undefined, { status: 0, cause: err });
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // True once supabase has reported the stored session (INITIAL_SESSION), so "no user yet" can be told apart from "no session".
  const [sessionResolved, setSessionResolved] = useState(false);
  // True when we have an authenticated session but the profile could not be
  // loaded because the database was unreachable (503 / timeout), NOT because the
  // profile is missing. Lets the UI show "reconnecting, retry" instead of
  // bouncing the user to login or hanging on a spinner during a DB outage.
  const [authUnavailable, setAuthUnavailable] = useState(false);

  // Guard: when signIn() is actively running, the useEffect must not
  // race with its own profile fetch.
  const signInActiveRef = useRef(false);

  const signIn = async (email, password) => {
    signInActiveRef.current = true;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw isLoginOffHookError(error) ? new Error(LOGIN_OFF_HOOK_MESSAGE) : error;

      const userProfile = await fetchProfile(
        data.user.id,
        data.session.access_token
      );

      // Login off (Staff access) blocks sign-in: drop the session that was just created and say why.
      if (!isLoginAllowed(userProfile)) {
        await supabase.auth.signOut();
        throw new Error(LOGIN_OFF_MESSAGE);
      }

      setUser(data.user);
      setProfile(userProfile);
      setAuthUnavailable(false);
      setLoading(false);

      if (userProfile) {
        identify(userProfile.id, {
          email: userProfile.email,
          role: userProfile.role,
          branch_id: userProfile.branch_id,
          org_slug: userProfile.organizations?.slug,
        });
        if (userProfile.org_id) {
          setGroup('organization', userProfile.org_id, {
            name: userProfile.organizations?.name,
            slug: userProfile.organizations?.slug,
          });
        }
      }

      return { user: data.user, profile: userProfile };
    } finally {
      signInActiveRef.current = false;
    }
  };

  const signOut = async () => {
    reset();
    setRestrictedReads(false);
    setProfile(null);
    setUser(null);
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[Auth] Sign out error:', error.message);
  };

  // Bootstrap: listen for auth state changes.
  // The callback MUST stay synchronous — supabase-js awaits all listeners
  // inside signInWithPassword, so any await here would deadlock.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // During signIn(), we handle user + profile ourselves.
        // Only update state from the listener when signIn is NOT active.
        if (signInActiveRef.current) return;

        setSessionResolved(true);
        if (session?.user) {
          setUser(session.user);
        } else {
          setUser(null);
          setProfile(null);
          setRestrictedReads(false);
        }

        if (event === 'INITIAL_SESSION' && !session?.user) {
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Load the profile for the current session. Shared by the refresh effect and
  // by retryProfile() (the "Try again" button shown during a DB outage).
  // Distinguishes a genuinely missing profile (setProfile(null)) from an
  // unreachable database (setAuthUnavailable(true)) so the UI can respond
  // differently to each.
  const loadProfile = useCallback(async (userId) => {
    setLoading(true);
    try {
      const p = await fetchProfile(userId);
      // A session that is still open when an admin turns the login off ends here (page refresh / return visit).
      if (p && !isLoginAllowed(p)) {
        await supabase.auth.signOut();
        setProfile(null);
        setUser(null);
        return null;
      }
      setProfile(p);
      setAuthUnavailable(false);
      return p;
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        // Database unreachable — keep the session, don't wipe to "no profile"
        // (which would bounce the user to login). Let the UI offer a retry.
        setAuthUnavailable(true);
        return null;
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const retryProfile = useCallback(() => {
    if (user?.id) return loadProfile(user.id);
    return Promise.resolve(null);
  }, [user?.id, loadProfile]);

  // Fetch profile on page refresh (INITIAL_SESSION with an existing session).
  // Skipped when signIn already set both user + profile in the same render.
  useEffect(() => {
    let cancelled = false;

    if (!user) {
      // Until the stored session has been reported there is simply no user *yet*; staying in `loading` stops ProtectedRoute
      // from bouncing a signed-in user (hard reload / deep link) through /login before their session has been restored.
      if (sessionResolved) setLoading(false);
      return;
    }

    // signIn() is handling auth + profile — don't compete
    if (signInActiveRef.current) return;

    // Profile already loaded for this user
    if (profile && profile.id === user.id) {
      setLoading(false);
      return;
    }

    // No explicit token — supabase client uses localStorage session.
    // loadProfile swallows ServiceUnavailableError into authUnavailable state;
    // guard the promise so nothing rejects unhandled if state changed meanwhile.
    loadProfile(user.id).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user?.id, loadProfile, sessionResolved]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, authUnavailable, retryProfile, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
