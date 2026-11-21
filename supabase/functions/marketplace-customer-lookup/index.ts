// Server-to-server customer lookup for the Zennly marketplace -- called from
// src/app/api/account/studio-history/route.ts in zennly-marketplace. Thin by design, same
// shape as marketplace-create-booking: all logic lives in
// public.marketplace_lookup_customer() (migration-336), this just verifies the caller,
// shapes the request, calls that one RPC, and maps its result to HTTP.
//
// Auth: a shared server-to-server secret (MARKETPLACE_LOOKUP_SECRET) -- book-spa cannot
// verify a token signed by the marketplace's own, separate Supabase project. Email is not
// a secret, so this endpoint is not anon-reachable at any layer: the secret check here is
// the only thing standing between "the marketplace asking about a user it verified" and
// "anyone who knows an email reading that person's membership balance."
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorized } from '../_shared/marketplace.ts';

interface LookupRequest {
  org_slug: string;
  email?: string;
  // 'status' = is this studio live on the marketplace? (ZNLY-345). Same secret, same function: one deploy,
  // one env var, and the marketplace already knows this URL. go_live is deliberately NOT reachable from here.
  action?: 'lookup' | 'status';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ found: false, error_code: 'METHOD_NOT_ALLOWED', message: 'POST only' }, 405);
  }

  const expectedSecret = Deno.env.get('MARKETPLACE_LOOKUP_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!expectedSecret) {
    console.error('MARKETPLACE_LOOKUP_SECRET is not configured');
    return json({ found: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }
  if (!isAuthorized(authHeader, expectedSecret)) {
    return json({ found: false, error_code: 'UNAUTHORIZED', message: 'Unauthorized' }, 401);
  }

  let body: LookupRequest;
  try {
    body = (await req.json()) as LookupRequest;
  } catch (_err) {
    return json({ found: false, error_code: 'INVALID_JSON', message: 'Invalid JSON body' }, 400);
  }

  const isStatus = body?.action === 'status';
  if (body?.action !== undefined && body.action !== 'lookup' && !isStatus) {
    return json({ found: false, error_code: 'INVALID_ACTION', message: 'Unknown action' }, 400);
  }
  if (!body?.org_slug || (!isStatus && !body?.email)) {
    return json({ found: false, error_code: 'MISSING_FIELD', message: isStatus ? 'org_slug is required' : 'org_slug and email are required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing Supabase configuration');
    return json({ found: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (isStatus) {
    try {
      const { data, error } = await supabase.rpc('marketplace_status', { p_org_slug: body.org_slug });
      if (error) {
        console.error('marketplace_status RPC error:', error.message);
        return json({ status: 'error', error_code: 'UNEXPECTED_ERROR', message: 'Something went wrong checking the studio.' }, 500);
      }
      return json(data, 200);
    } catch (err) {
      console.error('marketplace-customer-lookup status error:', err instanceof Error ? err.message : String(err));
      return json({ status: 'error', error_code: 'UNEXPECTED_ERROR', message: 'Something went wrong checking the studio.' }, 500);
    }
  }

  try {
    const { data, error } = await supabase.rpc('marketplace_lookup_customer', {
      p_org_slug: body.org_slug,
      p_identifier_kind: 'email',
      p_identifier_value: body.email,
    });

    if (error) {
      // org-not-enabled is the one expected business outcome that comes back as a thrown
      // Postgres exception rather than a structured {found:false,...} result (see the
      // migration's RAISE EXCEPTION ... USING ERRCODE = 'BSNF1') -- map it to 404, same as
      // marketplace-create-booking's ORG_NOT_ENABLED. Anything else is unexpected.
      if (error.code === 'BSNF1') {
        return json({ found: false, error_code: 'ORG_NOT_ENABLED', message: 'This business is not accepting marketplace lookups.' }, 404);
      }
      console.error('marketplace_lookup_customer RPC error:', error.message);
      return json({ found: false, error_code: 'UNEXPECTED_ERROR', message: 'Something went wrong looking up the customer.' }, 500);
    }

    return json(data, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('marketplace-customer-lookup unhandled error:', message);
    return json({ found: false, error_code: 'UNEXPECTED_ERROR', message: 'Something went wrong looking up the customer.' }, 500);
  }
});
