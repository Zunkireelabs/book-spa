import { supabase } from '../lib/supabase';
import { isLoginAllowed, LOGIN_OFF_MESSAGE, isLoginOffHookError, LOGIN_OFF_HOOK_MESSAGE } from './loginAccess';

export const PIN_UNAVAILABLE_MESSAGE = "Can't check your PIN right now. Check your connection and try again.";

// Request a fresh OTP from the pin-login Edge Function.
// (service role key stays server-side, never exposed to browser)
async function requestPinOtp(userEmail, pin, orgSlug) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let res;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pin-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Edge Function has verify_jwt enabled — the public anon key is a valid JWT.
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email: userEmail, pin, org_slug: orgSlug || null }),
    });
  } catch {
    // No answer at all (offline, DNS, blocked): says nothing about the PIN.
    return { otp: null, error: PIN_UNAVAILABLE_MESSAGE, kind: 'unavailable' };
  }

  let pinData;
  try {
    pinData = await res.json();
  } catch {
    return { otp: null, error: PIN_UNAVAILABLE_MESSAGE, kind: 'unavailable' };   // not JSON: a proxy or crash page, not an answer about the PIN
  }
  // A server error (5xx) is not an answer about the PIN either.
  if (res.status >= 500) return { otp: null, error: PIN_UNAVAILABLE_MESSAGE, kind: 'unavailable' };
  // The Edge Function has shipped under two response shapes across
  // deployments (`otp` and `email_otp`); accept either so login works
  // regardless of which version a given environment is running.
  const otp = pinData.email_otp || pinData.otp;
  if (!pinData.success || !otp) {
    // success:false below 5xx is treated as a wrong PIN. The Edge Function (not in this repo) sends only { success:false, error:'<text>' } and
    // no code, so a wrong PIN cannot be told from other refusals (401/404/misconfig) here. If it ever sends a code, narrow this.
    return { otp: null, error: pinData.error || 'PIN login failed.', kind: 'wrong_pin' };
  }
  return { otp, error: null };
}

/**
 * Log in (or re-authenticate) with a 4-digit PIN.
 *
 * Shared by the login form and the lock-screen unlock flow — both need the
 * exact same OTP-request + verify dance against the `pin-login` Edge
 * Function, so the logic lives here once rather than being duplicated.
 *
 * @param {string} email
 * @param {string} pin
 * @param {string|null} orgSlug
 * @returns {Promise<{ success: boolean, session?: object, user?: object, error?: string }>}
 */
export async function loginWithPin(email, pin, orgSlug) {
  // The recovery OTP is single-use and is rotated on every pin-login call,
  // so a transient verify failure (network blip, races) can leave a stale
  // token. Retry once with a fresh OTP before surfacing the error.
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { otp, error: otpReqError, kind } = await requestPinOtp(email, pin, orgSlug);
    if (!otp) {
      // A bad PIN won't succeed on retry — fail fast. `kind` tells the lock screen whether this counts as a wrong PIN.
      return { success: false, error: otpReqError, kind };
    }

    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });

    if (!otpError && otpData?.session) {
      // Login off (Staff access) blocks PIN sign-in too. The Edge Function cannot be changed from this repo, so the check is made
      // here, right after the session exists; a lookup failure lets the sign-in through (never lock someone out on a blip).
      const { data: accessRow } = await supabase.from('users').select('login_access').eq('id', otpData.user?.id).maybeSingle();
      if (!isLoginAllowed(accessRow)) {
        await supabase.auth.signOut();
        return { success: false, error: LOGIN_OFF_MESSAGE, kind: 'login_off' };
      }
      return { success: true, session: otpData.session, user: otpData.user };
    }
    // The Auth hook refused the login (login turned off): final, not a blip, so no retry.
    if (isLoginOffHookError(otpError)) return { success: false, error: LOGIN_OFF_HOOK_MESSAGE, kind: 'login_off' };
    lastError = otpError?.message || 'Session creation failed.';
  }

  // The PIN was accepted (we got an OTP) but the session could not be made: not a wrong PIN.
  return { success: false, error: lastError, kind: 'unavailable' };
}
