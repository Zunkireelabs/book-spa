// supabase/functions/pin-login/index.ts
//
// Secure PIN login flow. Replaces the previous client-side use of the service-role
// key (which was being exposed to browsers via VITE_SUPABASE_SERVICE_KEY).
//
// Flow:
//   1. Client posts { email, pin, org_slug? } to this function
//   2. Function calls login_with_pin() RPC to verify PIN (SECURITY DEFINER, bypasses RLS)
//   3. Function calls admin.generateLink() with service-role to mint a magic-link OTP
//   4. Function returns { success, email, otp, user_id, role, full_name } to client
//   5. Client exchanges the OTP via supabase.auth.verifyOtp() to obtain a real session
//
// The service-role key never leaves the Supabase Edge runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  let payload: { email?: string; pin?: string; org_slug?: string | null };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const email = (payload.email || '').trim().toLowerCase();
  const pin = (payload.pin || '').trim();
  const orgSlug = payload.org_slug?.trim() || null;

  if (!email || !/^\d{4}$/.test(pin)) {
    return jsonResponse({ success: false, error: 'Email and 4-digit PIN required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Step 1: Verify PIN via SECURITY DEFINER RPC
  const { data: pinResult, error: pinError } = await admin.rpc('login_with_pin', {
    p_email: email,
    p_pin: pin,
    p_org_slug: orgSlug,
  });

  if (pinError) {
    return jsonResponse({ success: false, error: 'PIN verification failed' }, 500);
  }
  if (!pinResult?.success) {
    return jsonResponse({ success: false, error: pinResult?.error || 'Invalid PIN' }, 401);
  }

  // Step 2: Mint a one-time magic-link OTP for this email (admin-only Supabase Auth call)
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  const otp = (linkData as { properties?: { email_otp?: string } } | null)?.properties?.email_otp;
  if (linkError || !otp) {
    return jsonResponse({ success: false, error: 'Failed to generate session token' }, 500);
  }

  return jsonResponse({
    success: true,
    email,
    otp,
    user_id: pinResult.user_id,
    role: pinResult.role,
    full_name: pinResult.full_name,
  });
});
