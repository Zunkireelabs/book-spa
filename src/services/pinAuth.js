import { supabase } from '../lib/supabase';

// Request a fresh OTP from the pin-login Edge Function.
// (service role key stays server-side, never exposed to browser)
async function requestPinOtp(userEmail, pin, orgSlug) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pin-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Edge Function has verify_jwt enabled — the public anon key is a valid JWT.
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email: userEmail, pin, org_slug: orgSlug || null }),
  });

  const pinData = await res.json();
  // The Edge Function has shipped under two response shapes across
  // deployments (`otp` and `email_otp`); accept either so login works
  // regardless of which version a given environment is running.
  const otp = pinData.email_otp || pinData.otp;
  if (!pinData.success || !otp) {
    return { otp: null, error: pinData.error || 'PIN login failed.' };
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
    const { otp, error: otpReqError } = await requestPinOtp(email, pin, orgSlug);
    if (!otp) {
      // A bad PIN won't succeed on retry — fail fast.
      return { success: false, error: otpReqError };
    }

    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });

    if (!otpError && otpData?.session) {
      return { success: true, session: otpData.session, user: otpData.user };
    }
    lastError = otpError?.message || 'Session creation failed.';
  }

  return { success: false, error: lastError };
}
