// Server-to-server booking creation for the Zennly marketplace (zennly-marketplace, a
// separate Supabase project). Thin by design: all orchestration lives in
// public.public_create_booking() (migration-335) -- this function only verifies the
// caller, shapes the request, calls that one RPC, and maps its result to HTTP. See the
// migration's header comment for why the logic lives in SQL rather than here.
//
// Auth: a shared server-to-server secret (MARKETPLACE_BOOKING_SECRET), not a verified
// end-user JWT -- book-spa cannot verify a token signed by a different Supabase project.
// Same Bearer-token pattern as supabase/functions/send-message. Unlike a read endpoint, a
// leaked secret here lets a caller occupy real room/therapist capacity, not just read
// data -- rotate this secret on any suspected leak, don't treat it as a someday task.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  collapseTherapistIds,
  isAuthorized,
  statusForBookingResult,
  validateCreateBookingBody,
  type CreateBookingBody,
} from '../_shared/marketplace.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ success: false, error_code: 'METHOD_NOT_ALLOWED', message: 'POST only' }, 405);
  }

  const expectedSecret = Deno.env.get('MARKETPLACE_BOOKING_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!expectedSecret) {
    console.error('MARKETPLACE_BOOKING_SECRET is not configured');
    return json({ success: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }
  if (!isAuthorized(authHeader, expectedSecret)) {
    return json({ success: false, error_code: 'UNAUTHORIZED', message: 'Unauthorized' }, 401);
  }

  let body: CreateBookingBody;
  try {
    body = (await req.json()) as CreateBookingBody;
  } catch (_err) {
    return json({ success: false, error_code: 'INVALID_JSON', message: 'Invalid JSON body' }, 400);
  }

  const problem = validateCreateBookingBody(body);
  if (problem) {
    return json({ success: false, error_code: 'MISSING_FIELD', message: problem }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing Supabase configuration');
    return json({ success: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // therapist_id / therapist_ids mirror createBooking's own dual input shape (single vs
  // multi) -- collapse to one array here so the SQL function only has to handle one form.
  const therapistIds = collapseTherapistIds(body);

  try {
    body = (await req.json()) as CreateBookingBody;
  } catch (_err) {
    return json({ success: false, error_code: 'INVALID_JSON', message: 'Invalid JSON body' }, 400);
  }

  const problem = validateCreateBookingBody(body);
  if (problem) {
    return json({ success: false, error_code: 'MISSING_FIELD', message: problem }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing Supabase configuration');
    return json({ success: false, error_code: 'SERVER_MISCONFIGURED', message: 'Server misconfigured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // therapist_id / therapist_ids mirror createBooking's own dual input shape (single vs
  // multi) -- collapse to one array here so the SQL function only has to handle one form.
  const therapistIds = body.therapist_ids?.filter(Boolean)
    ?? (body.therapist_id ? [body.therapist_id] : null);

  try {
    const { data, error } = await supabase.rpc('public_create_booking', {
      p_org_slug: body.org_slug,
      p_branch_id: body.branch_id,
      p_service_id: body.service_id,
      p_date: body.date,
      p_start_time: body.start_time,
      p_customer_name: body.customer.full_name,
      p_customer_email: body.customer.email ?? null,
      p_customer_phone: body.customer.phone,
      p_customer_gender: body.customer.gender ?? null,
      p_special_requests: body.special_requests ?? null,
      p_gender_preference: body.gender_preference ?? null,
      p_therapist_ids: therapistIds,
      p_room_id: body.room_id ?? null,
      p_therapist_room_overrides: body.therapist_room_overrides ?? null,
      p_idempotency_key: body.idempotency_key,
    });

    if (error) {
      // An unhandled exception inside public_create_booking (anything not mapped to a
      // known error_code there) surfaces here as a plain RPC error -- infra/unexpected,
      // not a business outcome, so this is the one path that returns 500.
      console.error('public_create_booking RPC error:', error.message);
      return json({ success: false, error_code: 'UNEXPECTED_ERROR', message: 'Something went wrong creating the booking.' }, 500);
    }

    // The RPC itself distinguishes "org not accepting marketplace bookings" (a setup
    // problem, not a per-request business outcome) from every other business error —
    // map that one to 404, everything else from a structured {success:false,...} result
    // is a normal, expected, handleable outcome and stays 200 so the marketplace can
    // switch on error_code without treating it as a transport failure.
    return json(data, statusForBookingResult(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('marketplace-create-booking unhandled error:', message);
    return json({ success: false, error_code: 'UNEXPECTED_ERROR', message: 'Something went wrong creating the booking.' }, 500);
  }
});
