// Propagates a completed marketplace email change onto this org's customer record -- called from
// src/app/api/account/email/verify/route.ts in zennly-marketplace, once per connected org, after
// BOTH verification codes have been accepted. Thin by design, same shape as
// marketplace-customer-lookup: all logic lives in public.marketplace_update_customer_email()
// (migration-339); this verifies the caller, shapes the request, calls that one RPC, and maps the
// result to HTTP.
//
// Auth: the same shared server-to-server secret as the lookup function. book-spa cannot verify a
// token signed by the marketplace's own, separate Supabase project, so the secret is what
// separates "the marketplace reporting a change it verified with two codes" from "anyone who
// knows two email addresses rewriting a studio's client record." That makes this strictly more
// dangerous than the lookup if the secret leaks -- the lookup reads, this writes -- which is why
// it is gated on its own org flag (marketplace_contact_sync_enabled) rather than reusing the
// lookup's.
//
// EMAIL ONLY. Do not add a phone branch here until the marketplace can verify phone numbers:
// customers has a unique index on (org_id, normalized phone) and none on email, so a phone write
// can collide with another client or silently repoint whose bookings attach where. See
// migration-339's header.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorized } from '../_shared/marketplace.ts';

interface UpdateRequest {
  org_slug: string;
  old_email: string;
  new_email: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ updated: false, error_code: 'METHOD_NOT_ALLOWED', message: 'POST only' }, 405);
  }

  const expectedSecret = Deno.env.get('MARKETPLACE_LOOKUP_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!expectedSecret) {
    console.error('MARKETPLACE_LOOKUP_SECRET is not configured');
    return json({ updated: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }
  if (!isAuthorized(authHeader, expectedSecret)) {
    return json({ updated: false, error_code: 'UNAUTHORIZED', message: 'Unauthorized' }, 401);
  }

  let body: UpdateRequest;
  try {
    body = (await req.json()) as UpdateRequest;
  } catch (_err) {
    return json({ updated: false, error_code: 'INVALID_JSON', message: 'Invalid JSON body' }, 400);
  }

  if (!body?.org_slug || !body?.old_email || !body?.new_email) {
    return json(
      { updated: false, error_code: 'MISSING_FIELD', message: 'org_slug, old_email and new_email are required' },
      400
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured');
    return json({ updated: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.rpc('marketplace_update_customer_email', {
    p_org_slug: body.org_slug,
    p_old_email: body.old_email,
    p_new_email: body.new_email,
  });

  if (error) {
    // BSNF1 is the migration's own "org not found or not contact-sync-enabled". Distinct from a
    // genuine failure: an org that hasn't opted in is a configuration answer, not an outage, and
    // the caller treats it as "nothing to do here" rather than retrying.
    if (error.code === 'BSNF1') {
      return json({ updated: false, error_code: 'ORG_NOT_ENABLED', message: error.message }, 404);
    }
    console.error('marketplace_update_customer_email failed', error);
    return json({ updated: false, error_code: 'UNEXPECTED_ERROR', message: 'Unexpected error' }, 500);
  }

  // { matched, updated }. `matched: false` is the normal case for an org this customer has never
  // visited -- the marketplace fans out to every connected org without knowing which ones know
  // them, so "no row here" is an answer, not a failure.
  return json(data, 200);
});
