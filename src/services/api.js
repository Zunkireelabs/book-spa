import { supabase, supabaseCustomer } from '../lib/supabase';
import { transformMembership, transformMemberships } from './bookingTransformers';
import { capture } from '../lib/analytics';
import { MEMBERSHIP_ENABLED, CUSTOMER_REFERRALS_ENABLED, VOUCHER_ENABLED } from '../lib/featureFlags';
import { toE164, samePhone } from '../utils/phone';

// Sentinel "branch" meaning "all branches in the admin's org" (the Overall view).
// Admin RLS is already org-scoped, so dropping the per-branch filter for this value
// returns exactly the org's rows across every branch (never other orgs).
export const OVERALL_BRANCH_ID = '__overall__';
export const isOverallBranch = (branchId) => branchId === OVERALL_BRANCH_ID;

// MVP: single branch — resolve mock branch IDs to real DB UUID
function resolveBranchId(branchId) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) {
    return branchId;
  }
  return 'b0000000-0000-0000-0000-000000000001';
}

// Conditionally apply a branch_id equality filter to a Supabase query builder.
// In the Overall view (sentinel branchId) the filter is omitted so org-wide RLS applies.
// NOTE: never route the sentinel through resolveBranchId — it would coerce to a default branch.
function withBranch(query, branchId, col = 'branch_id') {
  return isOverallBranch(branchId) ? query : query.eq(col, resolveBranchId(branchId));
}

function addMinutesToTime(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24; // Handle midnight overflow
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// ============================================================
// Phase 6: Centralized Lifecycle Helpers
// ============================================================

const VALID_TRANSITIONS = {
  'Pending':      ['Confirmed', 'Cancelled', 'No Show'],
  'Confirmed':    ['In-Progress', 'Cancelled', 'No Show'],
  'In-Progress':  ['Completed'],
  'Completed':    [],
  'Cancelled':    [],
  'No Show':      [],
};

const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'No Show'];

const DISCOUNT_LIMITS = {
  // TEMPORARY (2026-08-31): raised from 0.15 to match STAFF_REQUEST_CEILING, so staff
  // can direct-apply up to 50% with no manager approval step. Revert by setting this
  // back to 0.15 — the request-to-manager path (STAFF_REQUEST_CEILING below) reactivates
  // automatically once this drops below it again.
  staff:        0.50,
  manager:      1.00, // 100%
  admin:        1.00, // 100%
  admin_viewer: 0,    // view-only role — RLS blocks writes regardless, this is just a safe default
};

// Staff can request a discount up to this band (above their direct-apply limit).
// Manager/admin direct-apply is bounded by DISCOUNT_LIMITS above.
const STAFF_REQUEST_CEILING = 0.50;

/**
 * Fetch authenticated user + profile in one call.
 * Returns { user, profile } or a structured error.
 */
async function getAuthenticatedUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, profile: null, error: { code: 'UNAUTHENTICATED', message: 'You must be logged in.' } };
  }
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, role, branch_id, org_id')
    .eq('id', user.id)
    .single();

  if (profileError) {
    return { user, profile: null, error: { code: 'PROFILE_ERROR', message: 'Could not load user profile.' } };
  }
  return { user, profile, error: null };
}

/**
 * Centralized booking mutation validator.
 * Checks: lock, completed immutability, terminal status.
 * Returns null if valid, or a structured error object.
 */
export function getRoomCapacity(room) {
  return room?.capacity ?? 1;
}

function validateBookingMutation(booking) {
  if (booking.is_locked) {
    return { code: 'DAY_LOCKED', message: 'This day has been closed. No further modifications allowed.' };
  }
  if (TERMINAL_STATUSES.includes(booking.status)) {
    return { code: 'BOOKING_IMMUTABLE', message: `${booking.status} bookings cannot be modified.` };
  }
  return null;
}

/**
 * Validate a status transition against the state machine.
 * Returns null if valid, or a structured error object.
 */
function validateStatusTransition(currentStatus, newStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    return { code: 'INVALID_STATUS_TRANSITION', message: `Cannot transition from ${currentStatus} to ${newStatus}.` };
  }
  return null;
}

// ============================================================
// Read-only queries
// ============================================================

export async function fetchServices(branchId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError || !profile?.org_id) {
      console.warn('[API] fetchServices: No authenticated user or org_id', authError);
      return { data: [], error: null };
    }

    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr, description, image_url, category')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    const resolvedBranchId = resolveBranchId(branchId || profile.branch_id);
    if (resolvedBranchId && data) {
      const { data: branch } = await supabase
        .from('branches')
        .select('excluded_service_categories')
        .eq('id', resolvedBranchId)
        .single();
      const excluded = branch?.excluded_service_categories;
      if (excluded?.length > 0) {
        return { data: data.filter(s => !excluded.includes(s.category)), error: null };
      }
    }

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchServices error:', error.message);
    return { data: null, error };
  }
}

export async function fetchRooms(branchId) {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, name, amenities, floor, capacity')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchRooms error:', error.message);
    return { data: null, error };
  }
}

// Real, room-capacity-aware availability for the customer booking flow — fetches active rooms
// (with capacity) plus every non-cancelled booking in the branch across a date range in one call,
// so the client can compute per-service, duration-aware slot availability without a fetch per date.
export async function fetchBranchAvailabilityWindow(branchId, startDate, endDate) {
  const [{ data: rooms, error: roomsError }, { data: bookings, error: bookingsError }] =
    await Promise.all([
      fetchRooms(branchId),
      supabase.rpc('public_check_branch_bookings_range', {
        p_branch_id: branchId,
        p_start_date: startDate,
        p_end_date: endDate,
      }),
    ]);

  if (roomsError) throw roomsError;
  if (bookingsError) throw bookingsError;

  return { rooms: rooms || [], bookings: bookings || [] };
}

export async function fetchTherapists(branchId, { date } = {}) {
  try {
    let therapistsQuery = supabase
      .from('therapists')
      .select('id, name, gender, specialties, position, is_service_staff')
      .eq('is_active', true)
      .eq('is_service_staff', true)
      .order('name');
    therapistsQuery = withBranch(therapistsQuery, branchId);

    let attendancePromise;
    if (date) {
      let attendanceQuery = supabase
        .from('therapist_attendance')
        .select('therapist_id, status')
        .eq('date', date)
        .in('status', ['Absent', ...LEAVE_LIKE_ATTENDANCE_STATUSES]);
      attendanceQuery = withBranch(attendanceQuery, branchId);
      attendancePromise = attendanceQuery;
    } else {
      attendancePromise = Promise.resolve({ data: [] });
    }

    const [therapistsResult, attendanceResult] = await Promise.all([
      therapistsQuery,
      attendancePromise,
    ]);

    if (therapistsResult.error) throw therapistsResult.error;

    const absentIds = new Set(
      (attendanceResult.data || []).map(a => a.therapist_id)
    );
    const data = absentIds.size > 0
      ? therapistsResult.data.filter(t => !absentIds.has(t.id))
      : therapistsResult.data;

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchTherapists error:', error.message);
    return { data: null, error };
  }
}

export async function fetchBookings(branchId, { date, dateFrom, dateTo, status } = {}) {
  try {
    let query = supabase
      .from('bookings')
      .select(`
        *,
        service:services(id, name, duration_minutes),
        therapist:therapists(id, name, gender),
        room:rooms(id, name),
        payments(amount)
      `)
      .order('start_time');
    query = withBranch(query, branchId);

    if (date) {
      query = query.eq('date', date);
    } else if (dateFrom && dateTo) {
      query = query.gte('date', dateFrom).lte('date', dateTo);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBookings error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch who created a booking + when. Returns { createdByName, createdAt }.
 * createdByName is null for anonymous customer self-bookings (online).
 */
export async function fetchBookingCreator(bookingId) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('created_at, creator:users!created_by(full_name)')
      .eq('id', bookingId)
      .single();

    if (error) throw error;

    return {
      data: {
        createdByName: data.creator?.full_name || null,
        createdAt: data.created_at || null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchBookingCreator error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Booking Mutations (Phase 4 + Phase 6 hardened)
// ============================================================

export const PAYMENT_MODES = ['Cash', 'Card', 'MobileBanking', 'Cheque', 'Esewa', 'Khalti', 'Membership'];

// Bucket key ('cash' | 'card' | 'fonepay') for the simple 3-way cash/card/other
// split used by getDailySummary() and getDailyOperationalReport() (both the
// booking-payments and voucher-payments loops in each). Not used by
// getTodayInsights(), which needs a richer wallet/digital breakdown via its own
// CARD_MODES/WALLET_MODES/DIGITAL_MODES sets further down this file.
function classifyPaymentMode(mode) {
  if (mode === 'Cash') return 'cash';
  if (mode.includes('Card')) return 'card';
  return 'fonepay'; // MobileBanking, Esewa, Khalti, Cheque (+ legacy Fonepay) → digital/other
}

// Persists the org's admin-configured payment method list (organizations.settings
// .paymentMethods) via a SECURITY DEFINER RPC scoped to just that key — see
// migration-052-custom-payment-methods.sql. Each entry is either a plain string
// (leaf method) or { name, subMethods: string[] } (a group, e.g. Card -> Mastercard).
// Every name at any level is independently usable as a payment_mode value, so
// uniqueness is enforced across the whole flattened value space.
export async function updateOrgPaymentMethods(methods) {
  const seen = new Set();
  const cleanName = (raw) => {
    const name = (raw || '').trim();
    if (!name || name.length > 40) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return name;
  };

  const cleaned = (methods || [])
    .map((m) => {
      if (typeof m === 'string') return cleanName(m);
      if (m && typeof m === 'object') {
        const name = cleanName(m.name);
        if (!name) return null;
        const subMethods = (Array.isArray(m.subMethods) ? m.subMethods : [])
          .map((s) => cleanName(s))
          .filter(Boolean);
        return subMethods.length > 0 ? { name, subMethods } : name;
      }
      return null;
    })
    .filter(Boolean);

  if (cleaned.length === 0) {
    return { data: null, error: { code: 'EMPTY_LIST', message: 'At least one payment method is required.' } };
  }

  const { data, error } = await supabase.rpc('update_org_payment_methods', { p_methods: cleaned });
  if (error) {
    return { data: null, error: { code: error.code || 'UPDATE_FAILED', message: error.message || 'Failed to update payment methods.' } };
  }
  return { data, error: null };
}

// Record one or more payment tenders against a booking. Supports split payments
// (e.g. part cash + part card) and leaving a remaining balance as a due, which is
// attributed to a free-typed responsible person (dueHolderName).
//   recordPayment({ bookingId, tenders: [{ amount, paymentMode }], dueHolderName, notes })
// Backward-compatible single full payment: { bookingId, paymentMode, notes }.
export async function recordPayment({ bookingId, tenders, paymentMode, dueHolderName, notes }) {
  try {
    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, payment_status, final_amount, is_locked, due_holder_name')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // 2. Lock check
    if (booking.is_locked) {
      return { data: null, error: { code: 'DAY_LOCKED', message: 'This day has been closed. No further modifications allowed.' } };
    }

    // 3. Already fully paid check (partial/unpaid may still receive tenders)
    if (booking.payment_status === 'paid') {
      return { data: null, error: { code: 'ALREADY_PAID', message: 'Payment has already been recorded for this booking.' } };
    }

    // 4. Status check — payment allowed for Confirmed, In-Progress, Completed
    if (!['Confirmed', 'In-Progress', 'Completed'].includes(booking.status)) {
      return { data: null, error: { code: 'INVALID_PAYMENT_STATE', message: 'Payment can only be recorded for Confirmed, In-Progress, or Completed bookings.' } };
    }

    // 5. Auth
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // 6. Determine already-collected and remaining
    const finalAmount = Number(booking.final_amount);
    const { data: existing, error: sumError } = await supabase
      .from('payments')
      .select('amount')
      .eq('booking_id', bookingId);
    if (sumError) throw sumError;
    const collected = (existing || []).reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Math.round((finalAmount - collected) * 100) / 100;

    if (remaining <= 0) {
      // payment_status isn't 'paid' yet (checked in step 3) but there's genuinely
      // nothing left to collect — e.g. a 100% discount left final_amount at 0.
      // Settle it with a zero-amount row (same trigger-driven path applyDiscount's
      // auto-settle uses) instead of blocking a bundled payment that includes a
      // real balance on another booking.
      const { error: settleError } = await supabase
        .from('payments')
        .insert({
          booking_id: bookingId,
          amount: 0,
          payment_mode: (Array.isArray(tenders) && tenders[0]?.paymentMode) || paymentMode || 'No Charge',
          recorded_by: user.id,
          notes: notes || 'Auto-settled — no balance due',
        });
      if (settleError) throw settleError;
      return { data: { success: true, settledWithoutPayment: true }, error: null };
    }

    // 7. Normalize tenders. An explicit empty array means "leave the full
    // amount due" (no tenders to collect) — only fall back to a single
    // full-remaining tender when tenders wasn't provided at all (legacy
    // single-paymentMode callers).
    let tenderList = Array.isArray(tenders)
      ? tenders
      : [{ amount: remaining, paymentMode }];

    tenderList = tenderList
      .map(t => ({
        amount: Math.round(Number(t.amount) * 100) / 100,
        paymentMode: t.paymentMode,
        ...(t.paymentMode === 'ReferralVoucher' ? { referralId: t.referralId } : {}),
        ...(t.paymentMode === 'VoucherWallet' ? { voucherId: t.voucherId } : {}),
      }))
      .filter(t => t.amount > 0);

    // Zero tenders is valid — it's how a booking gets left 100% due (dueHolderName
    // requirement enforced below at step 8). Only a genuinely malformed tender
    // (bad paymentMode, missing voucher ref) is rejected, in the loop below.
    for (const t of tenderList) {
      const mode = (t.paymentMode || '').trim();
      if (!mode || mode.length > 40) {
        return { data: null, error: { code: 'INVALID_PAYMENT_MODE', message: `Invalid payment method: ${t.paymentMode}.` } };
      }
      if (mode === 'ReferralVoucher' && !t.referralId) {
        return { data: null, error: { code: 'INVALID_PAYMENT_MODE', message: 'Missing voucher reference for referral voucher tender.' } };
      }
      // A VoucherWallet tender with no voucherId is a pooled combined-balance
      // draw (migration-090) — deliberately allowed, see voucherWalletPooledTenders below.
    }

    const tenderTotal = Math.round(tenderList.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    if (tenderTotal > remaining) {
      return { data: null, error: { code: 'OVERPAYMENT', message: `Payment (NPR ${tenderTotal}) exceeds the remaining balance (NPR ${remaining}).` } };
    }

    const leftover = Math.round((remaining - tenderTotal) * 100) / 100;
    const resolvedDueHolder = (dueHolderName || '').trim() || booking.due_holder_name || null;

    // 8. If a balance is being left as due, a responsible person is required
    if (leftover > 0 && !resolvedDueHolder) {
      return { data: null, error: { code: 'DUE_HOLDER_REQUIRED', message: 'Enter who the remaining due is under before leaving a balance unpaid.' } };
    }

    // 9. Insert tenders (notes attached to the first row). Membership and referral-
    // reward tenders are routed through their own SECURITY DEFINER RPCs so the
    // payments INSERT and the wallet/voucher deduction happen in the same
    // transaction. Multiple Membership/ReferralWallet tenders in one submission are
    // batched into a single ledger deduction to keep the audit log tidy. Each
    // ReferralVoucher tender is a discrete reward row (not poolable), so it's
    // redeemed one RPC call per tender.
    const membershipTenders = tenderList.filter((t) => t.paymentMode === 'Membership');
    const referralWalletTenders = tenderList.filter((t) => t.paymentMode === 'ReferralWallet');
    const referralVoucherTenders = tenderList.filter((t) => t.paymentMode === 'ReferralVoucher');
    // A VoucherWallet tender with a voucherId targets one specific voucher (a
    // walk-in/gift voucher, redeemed individually); one with no voucherId is a
    // pooled combined-balance draw against this booking's customer's own linked
    // vouchers (migration-090) — batched together just like Membership/ReferralWallet.
    const voucherWalletTenders = tenderList.filter((t) => t.paymentMode === 'VoucherWallet' && t.voucherId);
    const voucherWalletPooledTenders = tenderList.filter((t) => t.paymentMode === 'VoucherWallet' && !t.voucherId);
    const otherTenders = tenderList.filter((t) =>
      !['Membership', 'ReferralWallet', 'ReferralVoucher', 'VoucherWallet'].includes(t.paymentMode)
    );
    const insertedIds = [];

    if (otherTenders.length > 0) {
      const insertRows = otherTenders.map((t, i) => ({
        booking_id: bookingId,
        amount: t.amount,
        payment_mode: t.paymentMode,
        recorded_by: user.id,
        notes: i === 0 ? (notes || null) : null,
      }));
      const { data: inserted, error: insertError } = await supabase
        .from('payments')
        .insert(insertRows)
        .select('id');
      if (insertError) throw insertError;
      insertedIds.push(...(inserted || []).map((r) => r.id));
    }

    if (membershipTenders.length > 0) {
      const membershipTotal = Math.round(
        membershipTenders.reduce((s, t) => s + t.amount, 0) * 100
      ) / 100;
      const noteText = otherTenders.length === 0 ? (notes || null) : null;
      const { data: paymentId, error: rpcError } = await supabase.rpc('record_membership_payment', {
        p_booking_id: bookingId,
        p_amount: membershipTotal,
        p_notes: noteText,
      });
      if (rpcError) throw rpcError;
      if (paymentId) insertedIds.push(paymentId);
    }

    if (referralWalletTenders.length > 0) {
      const referralWalletTotal = Math.round(
        referralWalletTenders.reduce((s, t) => s + t.amount, 0) * 100
      ) / 100;
      const noteText = otherTenders.length === 0 && membershipTenders.length === 0
        ? (notes || null)
        : null;
      const { data: paymentId, error: rpcError } = await supabase.rpc('record_referral_wallet_payment', {
        p_booking_id: bookingId,
        p_amount: referralWalletTotal,
        p_notes: noteText,
      });
      if (rpcError) throw rpcError;
      if (paymentId) insertedIds.push(paymentId);
    }

    for (const t of referralVoucherTenders) {
      const { data: paymentId, error: rpcError } = await supabase.rpc('redeem_referral_voucher', {
        p_referral_id: t.referralId,
        p_booking_id: bookingId,
      });
      if (rpcError) throw rpcError;
      if (paymentId) insertedIds.push(paymentId);
    }

    // Each VoucherWallet tender references a distinct voucher (unlike Membership/
    // ReferralWallet's single pooled balance), so it's redeemed one RPC call per
    // tender — same approach as referralVoucherTenders above.
    for (const t of voucherWalletTenders) {
      const { data: paymentId, error: rpcError } = await supabase.rpc('record_voucher_wallet_payment', {
        p_booking_id: bookingId,
        p_voucher_id: t.voucherId,
        p_amount: t.amount,
        p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      if (paymentId) insertedIds.push(paymentId);
    }

    // Pooled VoucherWallet tenders (no voucherId) draw from every voucher linked
    // to this booking's customer as one combined balance (migration-090) — same
    // batching as Membership/ReferralWallet above, since it's a single pooled
    // balance, not a per-item pick.
    if (voucherWalletPooledTenders.length > 0) {
      const voucherPoolTotal = Math.round(
        voucherWalletPooledTenders.reduce((s, t) => s + t.amount, 0) * 100
      ) / 100;
      const noteText = otherTenders.length === 0 && membershipTenders.length === 0
        && referralWalletTenders.length === 0
        ? (notes || null)
        : null;
      const { data: paymentId, error: rpcError } = await supabase.rpc('record_voucher_wallet_payment_pooled', {
        p_booking_id: bookingId,
        p_amount: voucherPoolTotal,
        p_notes: noteText,
      });
      if (rpcError) throw rpcError;
      if (paymentId) insertedIds.push(paymentId);
    }

    // 10. If this payment just fully settled the balance and the booking is also
    // already Completed, credit any pending referral tied to it. Non-blocking —
    // same reasoning as updateBookingStatus()'s call to the same RPC: a crediting
    // failure must never block payment recording. The RPC itself now checks both
    // status='Completed' AND payment_status='paid' before crediting (migration-077),
    // so calling it unconditionally here is safe even if status isn't Completed yet.
    if (leftover === 0) {
      try {
        const { error: creditError } = await supabase.rpc('credit_pending_referral_for_booking', {
          p_booking_id: bookingId,
        });
        if (creditError) console.warn('[API] credit_pending_referral_for_booking failed:', creditError.message);
      } catch (creditErr) {
        console.warn('[API] credit_pending_referral_for_booking failed:', creditErr.message);
      }
    }

    // 11. Maintain due_holder_name: keep whoever was last responsible even once fully
    // settled (never erase it), so it stands as a permanent "who paid this off"
    // record for the Settled history view.
    const newDueHolder = resolvedDueHolder || null;
    if (newDueHolder !== (booking.due_holder_name || null)) {
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ due_holder_name: newDueHolder })
        .eq('id', bookingId);
      if (updateError) throw updateError;
    }

    capture('staff_payment_recorded', {
      tender_modes: tenderList.map(t => t.paymentMode),
      total_amount: tenderTotal,
      fully_paid: leftover === 0,
    });
    return {
      data: {
        success: true,
        paymentIds: insertedIds,
        bookingId,
        amountPaid: tenderTotal,
        amountDue: leftover,
        fullyPaid: leftover === 0,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] recordPayment error:', error.message);
    return { data: null, error };
  }
}

// Distinct previously-used due-holder names for the settlement typeahead.
export async function fetchDueHolderNames(branchId) {
  try {
    let query = supabase
      .from('bookings')
      .select('due_holder_name')
      .not('due_holder_name', 'is', null);
    query = withBranch(query, branchId);
    const { data, error } = await query;
    if (error) throw error;
    const names = [...new Set((data || []).map(b => (b.due_holder_name || '').trim()).filter(Boolean))].sort();
    return { data: names, error: null };
  } catch (error) {
    console.error('[API] fetchDueHolderNames error:', error.message);
    return { data: null, error };
  }
}

// Assign / change the responsible person for a booking's outstanding balance.
export async function setDueHolder({ bookingId, dueHolderName }) {
  try {
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, is_locked')
      .eq('id', bookingId)
      .single();
    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }
    if (booking.is_locked) {
      return { data: null, error: { code: 'DAY_LOCKED', message: 'This day has been closed. No further modifications allowed.' } };
    }
    const name = (dueHolderName || '').trim() || null;
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ due_holder_name: name })
      .eq('id', bookingId);
    if (updateError) throw updateError;
    return { data: { success: true, bookingId, dueHolderName: name }, error: null };
  } catch (error) {
    console.error('[API] setDueHolder error:', error.message);
    return { data: null, error };
  }
}

// Outstanding (unpaid + partial) balances grouped by responsible person.
// from/to are ISO dates (inclusive); omit for all-time.
export async function getOutstandingByStaff({ branchId, from, to } = {}) {
  try {
    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_name, customer_phone, date, final_amount, payment_status, due_holder_name, service_name_snapshot')
      .in('payment_status', ['unpaid', 'partial'])
      .not('status', 'in', '("Cancelled","No Show")');
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    query = withBranch(query, branchId);
    const { data: bookings, error } = await query;
    if (error) throw error;

    const all = bookings || [];
    const bookingIds = all.map(b => b.id);
    const paidMap = {};
    if (bookingIds.length > 0) {
      const { data: payments, error: payError } = await supabase
        .from('payments')
        .select('booking_id, amount')
        .in('booking_id', bookingIds);
      if (payError) throw payError;
      for (const p of (payments || [])) {
        paidMap[p.booking_id] = (paidMap[p.booking_id] || 0) + Number(p.amount);
      }
    }

    const groups = {};
    for (const b of all) {
      const collected = paidMap[b.id] || 0;
      const due = Math.round((Number(b.final_amount) - collected) * 100) / 100;
      if (due <= 0) continue;
      const rawName = (b.due_holder_name || '').trim();
      const key = rawName || '__unassigned__';
      if (!groups[key]) {
        groups[key] = { dueHolderName: rawName || null, totalDue: 0, bookingCount: 0, bookings: [] };
      }
      groups[key].totalDue = Math.round((groups[key].totalDue + due) * 100) / 100;
      groups[key].bookingCount += 1;
      groups[key].bookings.push({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        customerPhone: b.customer_phone,
        date: b.date,
        serviceName: b.service_name_snapshot || '—',
        finalAmount: Number(b.final_amount),
        amountPaid: collected,
        amountDue: due,
        paymentStatus: b.payment_status,
      });
    }

    const result = Object.values(groups).sort((a, b) => b.totalDue - a.totalDue);
    return { data: result, error: null };
  } catch (error) {
    console.error('[API] getOutstandingByStaff error:', error.message);
    return { data: null, error };
  }
}

// One customer's total outstanding balance (unpaid + partial), across all dates —
// used to warn staff of a returning customer's previous due at booking time, and
// to bundle a customer's other outstanding bookings into a single payment.
// Matches on phone alone — phone numbers are unique per customer, while names
// aren't (two different customers can share a name), so phone is the reliable
// identifier here. Compared normalized (reduced to its last 10 digits) rather
// than as an exact string, since the same real customer is often recorded with
// slightly different phone formatting (with/without country code) across visits.
// customerName is accepted but purely cosmetic — it is never used to filter.
export async function getCustomerOutstandingBalance({ customerPhone, branchId, excludeBookingId } = {}) {
  try {
    const normalizedPhone = toE164(customerPhone);
    // Need a full number (country code + national) before matching — a stray
    // fragment must not sweep up unrelated bookings.
    if (!normalizedPhone || normalizedPhone.length < 11) {
      return { data: { totalDue: 0, bookingCount: 0, bookings: [] }, error: null };
    }

    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_name, customer_phone, date, final_amount, payment_status, service_name_snapshot')
      .in('payment_status', ['unpaid', 'partial'])
      .not('status', 'in', '("Cancelled","No Show")');
    if (excludeBookingId) query = query.neq('id', excludeBookingId);
    query = withBranch(query, branchId);
    const { data: bookings, error } = await query;
    if (error) throw error;

    const all = (bookings || []).filter((b) => samePhone(b.customer_phone, normalizedPhone));
    const bookingIds = all.map(b => b.id);
    const paidMap = {};
    if (bookingIds.length > 0) {
      const { data: payments, error: payError } = await supabase
        .from('payments')
        .select('booking_id, amount')
        .in('booking_id', bookingIds);
      if (payError) throw payError;
      for (const p of (payments || [])) {
        paidMap[p.booking_id] = (paidMap[p.booking_id] || 0) + Number(p.amount);
      }
    }

    let totalDue = 0;
    const dueBookings = [];
    for (const b of all) {
      const collected = paidMap[b.id] || 0;
      const due = Math.round((Number(b.final_amount) - collected) * 100) / 100;
      if (due <= 0) continue;
      totalDue = Math.round((totalDue + due) * 100) / 100;
      dueBookings.push({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        date: b.date,
        serviceName: b.service_name_snapshot || '—',
        finalAmount: Number(b.final_amount),
        amountPaid: collected,
        amountDue: due,
        paymentStatus: b.payment_status,
      });
    }

    return { data: { totalDue, bookingCount: dueBookings.length, bookings: dueBookings }, error: null };
  } catch (error) {
    console.error('[API] getCustomerOutstandingBalance error:', error.message);
    return { data: null, error };
  }
}

// History of bookings that used to carry an outstanding due and have since been
// fully paid off — who owed it, when it was settled, and which payment method(s)
// cleared it. from/to filter by settlement date (the latest payment's created_at).
export async function getSettledDueHistory({ branchId, from, to } = {}) {
  try {
    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_name, customer_phone, date, final_amount, due_holder_name, service_name_snapshot')
      .eq('payment_status', 'paid')
      .not('due_holder_name', 'is', null);
    query = withBranch(query, branchId);
    const { data: bookings, error } = await query;
    if (error) throw error;

    const all = bookings || [];
    if (all.length === 0) return { data: [], error: null };

    const bookingIds = all.map((b) => b.id);
    const { data: payments, error: payError } = await supabase
      .from('payments')
      .select('booking_id, amount, payment_mode, created_at')
      .in('booking_id', bookingIds)
      .order('created_at', { ascending: true });
    if (payError) throw payError;

    const paymentsByBooking = {};
    for (const p of (payments || [])) {
      (paymentsByBooking[p.booking_id] ||= []).push(p);
    }

    let rows = all.map((b) => {
      const tenders = paymentsByBooking[b.id] || [];
      const settledAt = tenders.length > 0 ? tenders[tenders.length - 1].created_at : null;
      const paymentModes = [...new Set(tenders.map((t) => t.payment_mode))];
      return {
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        customerPhone: b.customer_phone,
        date: b.date,
        serviceName: b.service_name_snapshot || '—',
        finalAmount: Number(b.final_amount),
        dueHolderName: b.due_holder_name,
        settledAt,
        paymentModes,
      };
    }).filter((r) => r.settledAt);

    if (from) rows = rows.filter((r) => r.settledAt.slice(0, 10) >= from);
    if (to) rows = rows.filter((r) => r.settledAt.slice(0, 10) <= to);

    rows.sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt));
    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] getSettledDueHistory error:', error.message);
    return { data: null, error };
  }
}

export const REFERRAL_COMMISSION_TYPES = ['percentage', 'amount'];

// Earned commission for a booking from its per-booking commission config.
// percentage -> final_amount * value / 100 ; amount -> flat value.
function computeReferralCommission(finalAmount, type, value) {
  const v = Number(value);
  if (!type || !(v >= 0)) return 0;
  if (type === 'percentage') {
    return Math.round(((Number(finalAmount) * v) / 100) * 100) / 100;
  }
  if (type === 'amount') {
    return Math.round(v * 100) / 100;
  }
  return 0;
}

// Set / change a booking's per-booking referral commission. Pass a null type to
// clear it. Allowed while the booking's day is not locked.
export async function setReferralCommission({ bookingId, commissionType, commissionValue }) {
  try {
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, is_locked')
      .eq('id', bookingId)
      .single();
    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }
    if (booking.is_locked) {
      return { data: null, error: { code: 'DAY_LOCKED', message: 'This day has been closed. No further modifications allowed.' } };
    }

    const clearing = !commissionType;
    if (!clearing) {
      if (!REFERRAL_COMMISSION_TYPES.includes(commissionType)) {
        return { data: null, error: { code: 'INVALID_COMMISSION_TYPE', message: `Invalid commission type: ${commissionType}.` } };
      }
      const v = Number(commissionValue);
      if (!(v >= 0)) {
        return { data: null, error: { code: 'INVALID_COMMISSION_VALUE', message: 'Commission value must be zero or more.' } };
      }
      if (commissionType === 'percentage' && v > 100) {
        return { data: null, error: { code: 'INVALID_COMMISSION_VALUE', message: 'Percentage commission cannot exceed 100%.' } };
      }
    }

    const payload = clearing
      ? { referral_commission_type: null, referral_commission_value: null }
      : { referral_commission_type: commissionType, referral_commission_value: Math.round(Number(commissionValue) * 100) / 100 };

    const { error: updateError } = await supabase
      .from('bookings')
      .update(payload)
      .eq('id', bookingId);
    if (updateError) throw updateError;

    return { data: { success: true, bookingId, ...payload }, error: null };
  } catch (error) {
    console.error('[API] setReferralCommission error:', error.message);
    return { data: null, error };
  }
}

// Referral commissions grouped by the referring person. Counts PAID bookings
// only (commission is earned once the money is collected). from/to are ISO
// dates (inclusive); omit for all-time.
export async function getReferralsReport({ branchId, from, to } = {}) {
  try {
    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_name, date, final_amount, referred_by, referral_commission_type, referral_commission_value, service_name_snapshot')
      .eq('payment_status', 'paid')
      .not('referred_by', 'is', null);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    query = withBranch(query, branchId);
    const { data: bookings, error } = await query;
    if (error) throw error;

    const groups = {};
    for (const b of (bookings || [])) {
      const name = (b.referred_by || '').trim();
      if (!name) continue;
      const commission = computeReferralCommission(b.final_amount, b.referral_commission_type, b.referral_commission_value);
      if (!groups[name]) {
        groups[name] = { referredBy: name, totalCommission: 0, bookingCount: 0, bookings: [] };
      }
      groups[name].totalCommission = Math.round((groups[name].totalCommission + commission) * 100) / 100;
      groups[name].bookingCount += 1;
      groups[name].bookings.push({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        date: b.date,
        serviceName: b.service_name_snapshot || '—',
        finalAmount: Number(b.final_amount),
        commissionType: b.referral_commission_type || null,
        commissionValue: b.referral_commission_value != null ? Number(b.referral_commission_value) : null,
        commission,
      });
    }

    const result = Object.values(groups).sort((a, b) => b.totalCommission - a.totalCommission);
    return { data: result, error: null };
  } catch (error) {
    console.error('[API] getReferralsReport error:', error.message);
    return { data: null, error };
  }
}

// Customer-to-customer referral reward report (migration-078). Distinct from
// getReferralsReport above (staff/therapist commission) — reads
// customer_referrals/customer_referral_credits, grouped by referring customer.
export async function getCustomerReferralsReport({ branchId, from, to } = {}) {
  try {
    let query = supabase
      .from('customer_referrals')
      .select(`
        id, reward_status, reward_amount, credited_at, created_at,
        referring_customer_id, referred_customer_id, booking_id,
        referrer:customers!customer_referrals_referring_customer_id_fkey(id, full_name, phone),
        referred:customers!customer_referrals_referred_customer_id_fkey(id, full_name, phone),
        booking:bookings!customer_referrals_booking_id_fkey(id, booking_number, branch_id, date, status, service_name_snapshot, final_amount)
      `)
      .order('created_at', { ascending: false });
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', `${to}T23:59:59`);

    const { data: rows, error } = await query;
    if (error) throw error;

    const inBranch = isOverallBranch(branchId)
      ? () => true
      : (r) => r.booking?.branch_id === resolveBranchId(branchId);

    const groups = {};
    for (const r of (rows || [])) {
      if (!inBranch(r)) continue;
      const key = r.referring_customer_id;
      if (!groups[key]) {
        groups[key] = {
          referringCustomerId: key,
          referrerName: r.referrer?.full_name || 'Unknown',
          referrerPhone: r.referrer?.phone || null,
          totalCredited: 0,
          pendingCount: 0,
          creditedCount: 0,
          referrals: [],
        };
      }
      const g = groups[key];
      if (r.reward_status === 'credited') {
        g.totalCredited = Math.round((g.totalCredited + Number(r.reward_amount || 0)) * 100) / 100;
        g.creditedCount += 1;
      } else if (r.reward_status === 'pending') {
        g.pendingCount += 1;
      }
      g.referrals.push({
        referralId: r.id,
        referredCustomerName: r.referred?.full_name || 'Unknown',
        bookingId: r.booking_id,
        bookingNumber: r.booking?.booking_number || null,
        bookingStatus: r.booking?.status || null,
        bookingDate: r.booking?.date || null,
        rewardStatus: r.reward_status,
        rewardAmount: r.reward_amount != null ? Number(r.reward_amount) : null,
        createdAt: r.created_at,
        creditedAt: r.credited_at,
      });
    }

    const result = Object.values(groups).sort((a, b) => b.totalCredited - a.totalCredited);
    return { data: result, error: null };
  } catch (error) {
    console.error('[API] getCustomerReferralsReport error:', error.message);
    return { data: null, error };
  }
}

// Flat, one-row-per-referral Referral Wallet ledger (migration-078/070). Distinct
// from getCustomerReferralsReport above (which groups by referrer with an
// expandable list) — this is the "who referred whom, how much they got, have
// they used it, when, and what's left" view.
//
// customer_referral_credits is 1:1 with a referral (UNIQUE(referral_id) —
// migration-078), so the granted amount is unambiguous per row. But spend
// (customer_referral_debits) is only linked to the referring customer, not to
// a specific referral — the wallet is one fungible balance per customer, not
// a per-referral bucket (see record_referral_wallet_payment). To answer "how
// much of THIS referral's reward is left", debits are allocated FIFO against
// a customer's credits ordered oldest-first, mirroring how the balance was
// actually built up.
export async function getReferralWalletReport({ branchId, from, to } = {}) {
  try {
    let query = supabase
      .from('customer_referrals')
      .select(`
        id, reward_status, reward_amount, requested_reward_amount, credited_at, created_at,
        referring_customer_id, referred_customer_id, booking_id,
        referrer:customers!customer_referrals_referring_customer_id_fkey(id, full_name, phone),
        referred:customers!customer_referrals_referred_customer_id_fkey(id, full_name, phone),
        booking:bookings!customer_referrals_booking_id_fkey(id, booking_number, branch_id, date, status, final_amount)
      `)
      .order('created_at', { ascending: false });
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', `${to}T23:59:59`);

    const { data: referrals, error } = await query;
    if (error) throw error;

    const inBranch = isOverallBranch(branchId)
      ? () => true
      : (r) => r.booking?.branch_id === resolveBranchId(branchId);

    const rows = (referrals || []).filter(inBranch);
    const referrerIds = [...new Set(rows.map((r) => r.referring_customer_id).filter(Boolean))];

    let credits = [];
    let debits = [];
    if (referrerIds.length > 0) {
      const [{ data: creditRows, error: creditError }, { data: debitRows, error: debitError }] = await Promise.all([
        supabase
          .from('customer_referral_credits')
          .select('id, referral_id, customer_id, amount, created_at')
          .in('customer_id', referrerIds),
        supabase
          .from('customer_referral_debits')
          .select('id, customer_id, amount, created_at')
          .in('customer_id', referrerIds),
      ]);
      if (creditError) throw creditError;
      if (debitError) throw debitError;
      credits = creditRows || [];
      debits = debitRows || [];
    }

    // FIFO-allocate each customer's debits against their credits, oldest credit first.
    const creditsByCustomer = {};
    for (const c of credits) {
      (creditsByCustomer[c.customer_id] ||= []).push({
        referralId: c.referral_id,
        remaining: Number(c.amount),
        usedAmount: 0,
        lastUsedAt: null,
        createdAt: c.created_at,
      });
    }
    for (const bucket of Object.values(creditsByCustomer)) {
      bucket.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }
    const debitsByCustomer = {};
    for (const d of debits) {
      (debitsByCustomer[d.customer_id] ||= []).push(d);
    }
    for (const [customerId, custDebits] of Object.entries(debitsByCustomer)) {
      const bucket = creditsByCustomer[customerId] || [];
      const sorted = [...custDebits].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      for (const d of sorted) {
        let toAllocate = Number(d.amount);
        for (const c of bucket) {
          if (toAllocate <= 0) break;
          if (c.remaining <= 0) continue;
          const take = Math.min(c.remaining, toAllocate);
          c.remaining = Math.round((c.remaining - take) * 100) / 100;
          c.usedAmount = Math.round((c.usedAmount + take) * 100) / 100;
          c.lastUsedAt = d.created_at;
          toAllocate = Math.round((toAllocate - take) * 100) / 100;
        }
      }
    }
    const creditByReferralId = {};
    for (const bucket of Object.values(creditsByCustomer)) {
      for (const c of bucket) creditByReferralId[c.referralId] = c;
    }

    const result = rows.map((r) => {
      const credit = creditByReferralId[r.id];
      const walletAmount = r.reward_status === 'credited'
        ? Number(r.reward_amount || 0)
        : Number(r.requested_reward_amount || 0);
      const usedAmount = credit ? credit.usedAmount : 0;
      const remainingAmount = credit ? credit.remaining : (r.reward_status === 'credited' ? walletAmount : null);
      return {
        referralId: r.id,
        referrerName: r.referrer?.full_name || 'Unknown',
        referrerPhone: r.referrer?.phone || null,
        referredCustomerName: r.referred?.full_name || 'Unknown',
        referredPhone: r.referred?.phone || null,
        bookingId: r.booking_id,
        bookingNumber: r.booking?.booking_number || null,
        bookingDate: r.booking?.date || null,
        rewardStatus: r.reward_status,
        createdAt: r.created_at,
        creditedAt: r.credited_at,
        walletAmount,
        usedAmount,
        remainingAmount,
        used: usedAmount > 0,
        usedAt: credit ? credit.lastUsedAt : null,
      };
    });

    return { data: result, error: null };
  } catch (error) {
    console.error('[API] getReferralWalletReport error:', error.message);
    return { data: null, error };
  }
}

// Referral reward(s) available to redeem for the customer attached to a booking —
// used by PaymentModal to surface an optional wallet-credit/voucher card at
// checkout (migration-070). Returns null in `data` if referrals are disabled, the
// booking has no customer, or the customer has neither a wallet balance nor an
// unredeemed voucher. `walletBalance` nets earned credits minus prior spend
// (get_referral_credit_balance RPC); vouchers are `customer_referrals` rows of
// type 'voucher' that are credited but not yet redeemed.
export async function fetchReferralRewardForBooking(bookingId) {
  try {
    if (!CUSTOMER_REFERRALS_ENABLED || !bookingId) return { data: null, error: null };

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('id', bookingId)
      .single();
    if (bErr) throw bErr;
    if (!booking?.customer_id) return { data: null, error: null };
    const customerId = booking.customer_id;

    const [{ data: balance, error: balanceError }, { data: vouchers, error: voucherError }] = await Promise.all([
      supabase.rpc('get_referral_credit_balance', { p_customer_id: customerId }),
      supabase
        .from('customer_referrals')
        .select('id, reward_label, requested_reward_amount, reward_catalog:reward_catalog_id(value)')
        .eq('referring_customer_id', customerId)
        .eq('reward_type', 'voucher')
        .eq('reward_status', 'credited')
        .is('redeemed_at', null),
    ]);
    if (balanceError) throw balanceError;
    if (voucherError) throw voucherError;

    const walletBalance = Math.round(Number(balance || 0) * 100) / 100;
    const voucherList = (vouchers || []).map((v) => ({
      referralId: v.id,
      label: v.reward_label || 'Gift Voucher',
      value: Number(v.reward_catalog?.value ?? v.requested_reward_amount ?? 0),
    })).filter((v) => v.value > 0);

    if (walletBalance <= 0 && voucherList.length === 0) return { data: null, error: null };
    return { data: { customerId, walletBalance, vouchers: voucherList }, error: null };
  } catch (error) {
    console.error('[API] fetchReferralRewardForBooking error:', error.message);
    return { data: null, error };
  }
}

// The customer_referrals row attached to THIS booking, if this booking is the
// referred customer's first booking (customer_referrals.booking_id is unique
// per booking — set at creation time via record_customer_referral). Used by
// BookingActionModal to show "this customer was referred by X" on the
// referred customer's own booking, distinct from the legacy free-text
// bookings.referred_by staff/therapist commission field. Returns null in
// `data` when referrals are disabled or this booking has no referral attached.
export async function fetchCustomerReferralForBooking(bookingId) {
  try {
    if (!CUSTOMER_REFERRALS_ENABLED || !bookingId) return { data: null, error: null };
    const { data, error } = await supabase
      .from('customer_referrals')
      .select(`
        id, reward_type, reward_status, reward_amount, requested_reward_amount, reward_label,
        requires_manual_reward,
        referrer:customers!customer_referrals_referring_customer_id_fkey(id, full_name, phone)
      `)
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { data: null, error: null };
    return {
      data: {
        referralId: data.id,
        referrerName: data.referrer?.full_name || 'Unknown',
        referrerPhone: data.referrer?.phone || null,
        rewardType: data.reward_type,
        rewardStatus: data.reward_status,
        rewardAmount: data.reward_status === 'credited'
          ? Number(data.reward_amount || 0)
          : Number(data.requested_reward_amount || 0),
        rewardLabel: data.reward_label || null,
        requiresManualReward: !!data.requires_manual_reward,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchCustomerReferralForBooking error:', error.message);
    return { data: null, error };
  }
}

// Revenue per service, broken out by branch, for PAID bookings only in the
// given date range. Always returns every branch that has at least one
// matching paid booking (1 column when branchId is a concrete branch —
// withBranch scopes the query — N columns when branchId is Overall).
// from/to are ISO dates (inclusive); omit for all-time.
export async function getServiceRevenueByBranch({ branchId, from, to } = {}) {
  try {
    const PAGE_SIZE = 1000; // PostgREST caps unpaginated responses at 1000 rows
    const bookings = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = supabase
        .from('bookings')
        .select('service_name_snapshot, final_amount, branch_id, branches(name)')
        .eq('payment_status', 'paid');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      query = withBranch(query, branchId);
      const { data: page, error } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      bookings.push(...(page || []));
      if (!page || page.length < PAGE_SIZE) break;
    }

    const branchMap = new Map();     // branch_id -> branch name
    const serviceMap = new Map();    // service name -> { [branchId]: { revenue, count } }
    const branchTotals = {};         // branch_id -> { revenue, count }
    let grandTotalRevenue = 0;
    let grandTotalCount = 0;

    for (const b of (bookings || [])) {
      const svc = b.service_name_snapshot || 'Unknown Service';
      const bId = b.branch_id;
      const bName = b.branches?.name || 'Unknown Branch';
      const amount = Number(b.final_amount) || 0;

      if (!branchMap.has(bId)) branchMap.set(bId, bName);
      if (!serviceMap.has(svc)) serviceMap.set(svc, {});
      const svcRow = serviceMap.get(svc);
      if (!svcRow[bId]) svcRow[bId] = { revenue: 0, count: 0 };
      svcRow[bId].revenue = Math.round((svcRow[bId].revenue + amount) * 100) / 100;
      svcRow[bId].count += 1;

      if (!branchTotals[bId]) branchTotals[bId] = { revenue: 0, count: 0 };
      branchTotals[bId].revenue = Math.round((branchTotals[bId].revenue + amount) * 100) / 100;
      branchTotals[bId].count += 1;

      grandTotalRevenue = Math.round((grandTotalRevenue + amount) * 100) / 100;
      grandTotalCount += 1;
    }

    const branches = Array.from(branchMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const services = Array.from(serviceMap.entries()).map(([name, byBranch]) => {
      const totalRevenue = branches.reduce((s, br) => s + (byBranch[br.id]?.revenue || 0), 0);
      const totalCount = branches.reduce((s, br) => s + (byBranch[br.id]?.count || 0), 0);
      return {
        serviceName: name,
        byBranch,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCount,
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
      data: { branches, services, branchTotals, grandTotalRevenue, grandTotalCount },
      error: null,
    };
  } catch (error) {
    console.error('[API] getServiceRevenueByBranch error:', error.message);
    return { data: null, error };
  }
}

// Self-service (public-flow) referral rewards this booking's customer has EARNED
// as a referrer but that still await a manager/admin's Wallet-vs-Voucher decision
// (customer_referrals.requires_manual_reward = true — see migration-072). Only
// includes rows where the referred customer's original booking is Completed, i.e.
// the reward is actually earned, not just pending on a future visit. Used by
// PaymentModal to prompt staff at the REFERRER's next checkout, since the
// customer flow itself never gets to choose wallet vs voucher.
export async function fetchPendingReferralRewardsForBooking(bookingId) {
  try {
    if (!CUSTOMER_REFERRALS_ENABLED || !bookingId) return { data: [], error: null };

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('id', bookingId)
      .single();
    if (bErr) throw bErr;
    if (!booking?.customer_id) return { data: [], error: null };

    const { data, error } = await supabase
      .from('customer_referrals')
      .select(`
        id,
        referred:customers!customer_referrals_referred_customer_id_fkey(id, full_name),
        booking:bookings!customer_referrals_booking_id_fkey!inner(status)
      `)
      .eq('referring_customer_id', booking.customer_id)
      .eq('reward_status', 'pending')
      .eq('requires_manual_reward', true)
      .eq('booking.status', 'Completed')
      .order('created_at', { ascending: true });
    if (error) throw error;

    return {
      data: (data || []).map((row) => ({
        referralId: row.id,
        referredName: row.referred?.full_name || 'A referred customer',
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchPendingReferralRewardsForBooking error:', error.message);
    return { data: [], error };
  }
}

export async function updateBookingStatus({ bookingId, newStatus, reason }) {
  try {
    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // 2. Lifecycle checks
    const mutationError = validateBookingMutation(booking);
    if (mutationError) return { data: null, error: mutationError };

    // 3. State machine validation
    const transitionError = validateStatusTransition(booking.status, newStatus);
    if (transitionError) return { data: null, error: transitionError };

    // 4. Auth
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // 5. Update
    if ((newStatus === 'Cancelled' || newStatus === 'No Show') && (!reason || !reason.trim())) {
      return { data: null, error: { code: 'REASON_REQUIRED', message: 'A reason is required when cancelling or marking a booking as no-show.' } };
    }
    const updatePayload = { status: newStatus };
    if (newStatus === 'Cancelled' || newStatus === 'No Show') {
      updatePayload.cancellation_reason = reason;
    }
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select('id, status')
      .single();

    if (updateError) throw updateError;

    // 6. If this booking just completed and carries a pending customer referral,
    // credit the referring customer's reward. Non-blocking — a crediting failure
    // must never prevent marking a booking Completed; the pending referral row
    // remains reconcilable later.
    if (newStatus === 'Completed') {
      try {
        const { error: creditError } = await supabase.rpc('credit_pending_referral_for_booking', {
          p_booking_id: bookingId,
        });
        if (creditError) console.warn('[API] credit_pending_referral_for_booking failed:', creditError.message);
      } catch (creditErr) {
        console.warn('[API] credit_pending_referral_for_booking failed:', creditErr.message);
      }

      // Non-blocking, same reasoning as the referral credit above: enqueue
      // any review_request outreach for this booking, but never let a
      // failure here prevent marking the booking Completed.
      try {
        const { error: outreachError } = await supabase.rpc('outreach_enqueue_for_completed', {
          p_booking_id: bookingId,
        });
        if (outreachError) console.warn('[API] outreach_enqueue_for_completed failed:', outreachError.message);
      } catch (outreachErr) {
        console.warn('[API] outreach_enqueue_for_completed failed:', outreachErr.message);
      }
    }

    capture('staff_booking_status_changed', { from_status: booking.status, to_status: newStatus });
    return { data: { success: true, bookingId, status: updated.status }, error: null };
  } catch (error) {
    console.error('[API] updateBookingStatus error:', error.message);
    return { data: null, error };
  }
}

export async function assignTherapist({ bookingId, therapistIds = [], roomId }) {
  try {
    // Support legacy single therapistId param
    const ids = Array.isArray(therapistIds) ? therapistIds.filter(Boolean) : (therapistIds ? [therapistIds] : []);

    // 1. Fetch booking (include room_id + date for attendance check)
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, branch_id, room_id, date')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // 2. Lifecycle checks
    const mutationError = validateBookingMutation(booking);
    if (mutationError) return { data: null, error: mutationError };

    // 3. Auth
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // 4. Validate all therapists are active
    const primaryId = ids[0] || null;
    let therapistNameSnapshot = null;

    if (ids.length > 0) {
      const { data: therapistsData } = await supabase
        .from('therapists')
        .select('id, name, is_active, branch_id')
        .in('id', ids);

      const inactive = (therapistsData || []).find(t => !t.is_active);
      if (inactive) {
        return { data: null, error: { code: 'THERAPIST_INACTIVE', message: `Cannot assign inactive therapist: ${inactive.name}` } };
      }

      // A therapist currently on a temporary transfer has branch_id pointing at the
      // destination branch, not this booking's branch — block assigning them here
      // until they're auto-reverted (migration-145).
      const wrongBranch = (therapistsData || []).find(t => t.branch_id !== booking.branch_id);
      if (wrongBranch) {
        return { data: null, error: { code: 'INVALID_THERAPIST', message: `${wrongBranch.name} is not available in this branch right now (may be temporarily transferred elsewhere).` } };
      }

      if (booking.date) {
        const { data: absentRecords } = await supabase
          .from('therapist_attendance')
          .select('therapist_id, status')
          .in('therapist_id', ids)
          .eq('date', booking.date)
          .in('status', ['Absent', ...LEAVE_LIKE_ATTENDANCE_STATUSES]);
        const absent = (absentRecords || []).find(Boolean);
        if (absent) {
          const absentTherapist = (therapistsData || []).find(t => t.id === absent.therapist_id);
          return { data: null, error: { code: 'THERAPIST_ABSENT', message: `Cannot assign ${absentTherapist?.name || 'therapist'}: marked as ${absent.status} for this date.` } };
        }
      }

      const primary = (therapistsData || []).find(t => t.id === primaryId);
      therapistNameSnapshot = primary?.name || null;
    }

    // 5. Build update payload (primary therapist on bookings table)
    const updatePayload = {
      therapist_id: primaryId,
      therapist_name_snapshot: therapistNameSnapshot,
    };

    // 6. Room assignment (if roomId provided)
    if (roomId !== undefined) {
      if (roomId === null) {
        updatePayload.room_id = null;
        updatePayload.room_name_snapshot = null;
      } else {
        const { data: room } = await supabase
          .from('rooms')
          .select('name')
          .eq('id', roomId)
          .single();
        updatePayload.room_id = roomId;
        updatePayload.room_name_snapshot = room?.name || null;
      }
    } else {
      if (booking.room_id) {
        const { data: room } = await supabase
          .from('rooms')
          .select('name')
          .eq('id', booking.room_id)
          .single();
        updatePayload.room_name_snapshot = room?.name || null;
      }
    }

    // 7. Update primary therapist on bookings table
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select('id, therapist_id, room_id')
      .single();

    if (updateError) {
      if (updateError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: 'Therapist is already booked during this time slot.' } };
      }
      throw updateError;
    }

    // 8. Sync junction table: preserve per-therapist times where possible
    const { data: existingBt } = await supabase.from('booking_therapists').select('therapist_id, start_time, end_time').eq('booking_id', bookingId);
    const existingTimeMap = {};
    (existingBt || []).forEach(bt => { existingTimeMap[bt.therapist_id] = { start_time: bt.start_time, end_time: bt.end_time }; });

    await supabase.from('booking_therapists').delete().eq('booking_id', bookingId);

    if (ids.length > 0) {
      // Fetch booking times for default
      const { data: bk } = await supabase.from('bookings').select('start_time, end_time').eq('id', bookingId).single();
      const rows = ids.map(tid => ({
        booking_id: bookingId,
        therapist_id: tid,
        start_time: existingTimeMap[tid]?.start_time || bk?.start_time || null,
        end_time: existingTimeMap[tid]?.end_time || bk?.end_time || null,
      }));
      const { error: junctionError } = await supabase.from('booking_therapists').insert(rows);
      if (junctionError) {
        console.warn('[API] booking_therapists insert warning:', junctionError.message);
      }
    }

    return { data: { success: true, bookingId, therapistIds: ids, roomId: updated.room_id }, error: null };
  } catch (error) {
    console.error('[API] assignTherapist error:', error.message);
    return { data: null, error };
  }
}

export async function fetchRelatedUnpaidBookings({ customerName, date, excludeBookingId }) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, booking_number, customer_name, date, start_time, end_time, base_amount, discount_amount, final_amount, payment_status, status, service:services(name, duration_minutes), room:rooms(name), therapist:therapists(name)')
      .eq('customer_name', customerName)
      .eq('date', date)
      .eq('payment_status', 'unpaid')
      .not('status', 'in', '("Cancelled","No Show")')
      .neq('id', excludeBookingId)
      .order('start_time');

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchRelatedUnpaidBookings error:', error.message);
    return { data: [], error };
  }
}

export async function updateTherapistTime({ bookingId, therapistId, startTime, endTime }) {
  try {
    const { error } = await supabase
      .from('booking_therapists')
      .update({ start_time: startTime, end_time: endTime })
      .eq('booking_id', bookingId)
      .eq('therapist_id', therapistId);

    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] updateTherapistTime error:', error.message);
    return { data: null, error };
  }
}

export async function updateBookingDetails({ bookingId, customerName, customerPhone, serviceId, date, startTime, specialRequests, referredBy }) {
  try {
    // 1. Fetch current booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, payment_status, service_id, date, start_time, branch_id, base_amount, discount_amount, final_amount, service:services(duration_minutes)')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // 2. Lifecycle checks
    const mutationError = validateBookingMutation(booking);
    if (mutationError) return { data: null, error: mutationError };

    // 3. Auth
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // 4. Build update payload with only changed fields
    const updatePayload = {};

    if (customerName !== undefined && customerName !== null) {
      updatePayload.customer_name = customerName;
    }
    if (customerPhone !== undefined) {
      updatePayload.customer_phone = toE164(customerPhone);
    }
    if (specialRequests !== undefined) {
      updatePayload.special_requests = specialRequests || null;
    }
    if (referredBy !== undefined) {
      updatePayload.referred_by = referredBy || null;
    }

    // 5. If service changed, recalculate financials and duration
    const effectiveServiceId = serviceId !== undefined ? serviceId : booking.service_id;
    let newServiceDurationMinutes = null;
    if (serviceId && serviceId !== booking.service_id) {
      const { data: newService, error: svcError } = await supabase
        .from('services')
        .select('id, name, duration_minutes, price_npr')
        .eq('id', serviceId)
        .single();

      if (svcError || !newService) {
        return { data: null, error: { code: 'SERVICE_NOT_FOUND', message: 'Selected service not found.' } };
      }

      newServiceDurationMinutes = newService.duration_minutes;
      updatePayload.service_id = serviceId;
      updatePayload.service_name_snapshot = newService.name;
      updatePayload.base_amount = newService.price_npr;
      // Preserve existing discount amount
      const discountAmt = Number(booking.discount_amount || 0);
      updatePayload.final_amount = Math.max(0, newService.price_npr - discountAmt);

      // Recalculate end_time based on new duration
      const effectiveStartTime = startTime || booking.start_time;
      updatePayload.end_time = addMinutesToTime(effectiveStartTime.slice(0, 5), newService.duration_minutes);

      // Recompute payment_status — price change can leave a stale 'paid' status
      const { data: paymentsRows } = await supabase
        .from('payments')
        .select('amount')
        .eq('booking_id', bookingId);
      const amountPaid = (paymentsRows || []).reduce((sum, p) => sum + Number(p.amount), 0);
      const newFinalAmount = updatePayload.final_amount;
      updatePayload.payment_status =
        amountPaid <= 0 ? 'unpaid' : amountPaid >= newFinalAmount ? 'paid' : 'partial';
    }

    // 6. If date or time changed, recalculate end_time and check conflicts
    const dateChanged = date && date !== booking.date;
    const timeChanged = startTime && startTime !== booking.start_time;

    if (dateChanged) {
      updatePayload.date = date;
    }
    if (timeChanged) {
      updatePayload.start_time = startTime;
    }

    // Recalculate end_time if time changed but service didn't (service change already handled above)
    if (timeChanged && !updatePayload.end_time) {
      const durationMinutes = booking.service?.duration_minutes;
      if (durationMinutes) {
        updatePayload.end_time = addMinutesToTime(startTime.slice(0, 5), durationMinutes);
      }
    }

    // Note: Scheduling conflicts are enforced by DB constraints (error 23P01 handled below)

    // 8. Only update if there are changes
    if (Object.keys(updatePayload).length === 0) {
      return { data: { success: true, bookingId, noChanges: true }, error: null };
    }

    // 9. Update
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select('id')
      .single();

    if (updateError) {
      if (updateError.code === '23P01' || updateError.code === 'P0003') {
        return { data: null, error: { code: 'SCHEDULING_CONFLICT', message: 'The new date/time conflicts with an existing booking.' } };
      }
      throw updateError;
    }

    // 10. Extending the service changes duration — keep any co-assigned
    // therapist's booking_therapists row in sync, since getCalendarBookings
    // reads end_time from this junction row, not just bookings.end_time.
    if (newServiceDurationMinutes) {
      const { data: btRows } = await supabase
        .from('booking_therapists')
        .select('therapist_id, start_time')
        .eq('booking_id', bookingId);
      for (const row of (btRows || [])) {
        if (!row.start_time) continue;
        const newEndTime = addMinutesToTime(row.start_time.slice(0, 5), newServiceDurationMinutes);
        const { error: btUpdateError } = await supabase
          .from('booking_therapists')
          .update({ end_time: newEndTime })
          .eq('booking_id', bookingId)
          .eq('therapist_id', row.therapist_id);
        if (btUpdateError) console.warn('[API] booking_therapists end_time sync warning:', btUpdateError.message);
      }
    }

    return { data: { success: true, bookingId }, error: null };
  } catch (error) {
    console.error('[API] updateBookingDetails error:', error.message);
    return { data: null, error };
  }
}

export async function applyDiscount({ bookingId, discountType, discountValue, discountReason, requestedTo }) {
  try {
    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, base_amount, payment_status')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    const { data: paymentsRows } = await supabase
      .from('payments')
      .select('amount')
      .eq('booking_id', bookingId);
    const amountPaid = (paymentsRows || []).reduce((sum, p) => sum + Number(p.amount), 0);

    // 2. Lifecycle checks — allow discounts on completed-but-unpaid (standard cash-spa flow)
    if (booking.is_locked) {
      return { data: null, error: { code: 'DAY_LOCKED', message: 'This day has been closed. No further modifications allowed.' } };
    }
    if (['Cancelled', 'No Show'].includes(booking.status)) {
      return { data: null, error: { code: 'BOOKING_IMMUTABLE', message: `${booking.status} bookings cannot be modified.` } };
    }
    if (booking.payment_status === 'paid') {
      return { data: null, error: { code: 'BOOKING_IMMUTABLE', message: 'Cannot modify discount on a paid booking.' } };
    }

    // 4. Auth + role
    const { user, profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // 5. Compute discount amount
    const baseAmount = Number(booking.base_amount);
    let discountAmount;
    let effectivePercent;

    if (discountType === 'percentage') {
      effectivePercent = Number(discountValue) / 100;
      discountAmount = Math.round(baseAmount * effectivePercent * 100) / 100;
    } else if (discountType === 'fixed') {
      discountAmount = Number(discountValue);
      effectivePercent = discountAmount / baseAmount;
    } else {
      return { data: null, error: { code: 'INVALID_DISCOUNT_TYPE', message: 'Discount type must be "percentage" or "fixed".' } };
    }

    if (discountAmount < 0 || discountAmount > baseAmount) {
      return { data: null, error: { code: 'INVALID_DISCOUNT_VALUE', message: 'Discount cannot be negative or exceed base amount.' } };
    }

    // A discount can't push final_amount below what's already been collected —
    // that would silently hide an overpayment (amountDue clamps to 0 in the UI).
    if (amountPaid > 0 && (baseAmount - discountAmount) < amountPaid) {
      const maxDiscountAmount = baseAmount - amountPaid;
      const maxPercentCap = Math.round((maxDiscountAmount / baseAmount) * 100);
      return {
        data: null,
        error: {
          code: 'DISCOUNT_BELOW_PAID',
          message: `Discount cannot reduce the total below the amount already paid (NPR ${amountPaid}). Maximum discount: ${maxPercentCap}%.`,
        },
      };
    }

    // Hard ceiling: staff request can't exceed 50%; manager/admin can go to 100%.
    const hardCeiling = profile.role === 'staff' ? STAFF_REQUEST_CEILING : DISCOUNT_LIMITS[profile.role];
    if (effectivePercent > hardCeiling + 1e-9) {
      return { data: null, error: { code: 'DISCOUNT_LIMIT_EXCEEDED', message: `Discount cannot exceed ${Math.round(hardCeiling * 100)}%.` } };
    }

    // 6. Role-based limit check (exceeding direct-apply sends to pending approval)
    const maxPercent = DISCOUNT_LIMITS[profile.role];

    // 7. Discount reason required
    if (!discountReason || !discountReason.trim()) {
      return { data: null, error: { code: 'DISCOUNT_REASON_REQUIRED', message: 'A reason is required when applying a discount.' } };
    }

    // 8. If staff exceeds limit, set to pending instead of blocking
    const isWithinLimit = effectivePercent <= maxPercent;

    // Over-limit discounts must be routed to a specific approver.
    if (!isWithinLimit && !requestedTo) {
      return { data: null, error: { code: 'APPROVER_REQUIRED', message: 'Select a manager or admin to send this discount request to.' } };
    }

    const updatePayload = {
      discount_amount: discountAmount,
      discount_reason: discountReason.trim(),
      discount_status: isWithinLimit ? 'approved' : 'pending',
      discount_approved_by: isWithinLimit ? user.id : null,
      discount_requested_by: isWithinLimit ? null : user.id,
      discount_requested_to: isWithinLimit ? null : requestedTo,
    };

    // A discount applied while already-collected — reflect the new balance
    // immediately (e.g. discounting a 'partial' booking down to exactly
    // amountPaid should flip it to 'paid') rather than waiting on a payments
    // INSERT trigger that won't fire here.
    if (isWithinLimit) {
      const newFinalAmount = baseAmount - discountAmount;
      updatePayload.payment_status =
        amountPaid <= 0 ? 'unpaid' : amountPaid >= newFinalAmount ? 'paid' : 'partial';
    }

    // 9. Update booking — trigger recomputes final_amount
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select('id, discount_amount, final_amount, discount_status')
      .single();

    if (updateError) throw updateError;

    // A 100%-approved discount leaves nothing to collect — settle it immediately
    // rather than leaving payment_status stuck on "unpaid" waiting for a Record
    // Payment click that would otherwise be rejected as "already fully paid".
    // Insert a zero-amount payment row so the existing SUM-based trigger
    // (update_booking_payment_status) recomputes payment_status to 'paid'.
    if (updated.discount_status === 'approved' && Number(updated.final_amount) <= 0 && booking.payment_status !== 'paid') {
      const { error: settleError } = await supabase
        .from('payments')
        .insert({
          booking_id: bookingId,
          amount: 0,
          payment_mode: 'No Charge',
          recorded_by: user.id,
          notes: 'Auto-settled — 100% discount leaves no balance due',
        });
      if (settleError) throw settleError;
    }

    capture(updated.discount_status === 'pending' ? 'staff_discount_requested' : 'staff_discount_applied', {
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount_npr: Number(updated.discount_amount),
    });
    return {
      data: {
        success: true,
        bookingId,
        discountAmount: Number(updated.discount_amount),
        finalAmount: Number(updated.final_amount),
        discountStatus: updated.discount_status,
        isPending: updated.discount_status === 'pending',
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] applyDiscount error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch bookings with pending discount requests (manager view).
 */
export async function fetchPendingDiscounts(branchId) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    let query = supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, date, start_time,
        base_amount, discount_amount, final_amount, discount_reason,
        status, service_id, services:service_id(name),
        requester:users!discount_requested_by(full_name)
      `)
      .eq('discount_status', 'pending')
      .eq('discount_requested_to', user.id)
      .eq('is_locked', false)
      .order('created_at', { ascending: false });
    query = withBranch(query, branchId);

    const { data, error } = await query;

    if (error) throw error;

    return {
      data: (data || []).map(b => ({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        date: b.date,
        startTime: b.start_time,
        baseAmount: Number(b.base_amount),
        discountAmount: Number(b.discount_amount),
        finalAmount: Number(b.final_amount),
        discountReason: b.discount_reason,
        discountPercent: Number(b.base_amount) > 0
          ? Math.round((Number(b.discount_amount) / Number(b.base_amount)) * 100)
          : 0,
        status: b.status,
        serviceName: b.services?.name || '—',
        requestedByName: b.requester?.full_name || null,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchPendingDiscounts error:', error.message);
    return { data: null, error };
  }
}

/**
 * Count of pending discount requests routed to the current user (the approver),
 * scoped to a branch. Powers the sidebar "Dashboard" approval badge.
 */
export async function fetchPendingApprovalCount(branchId) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { count: 0, error: authError };

    let query = supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('discount_status', 'pending')
      .eq('discount_requested_to', user.id)
      .eq('is_locked', false);
    query = withBranch(query, branchId);

    const { count, error } = await query;

    if (error) throw error;
    return { count: count || 0, error: null };
  } catch (error) {
    console.error('[API] fetchPendingApprovalCount error:', error.message);
    return { count: 0, error };
  }
}

/**
 * List the managers/admins the current user may send a discount request to.
 * Backed by the list_discount_approvers() SECURITY DEFINER function.
 */
export async function fetchDiscountApprovers() {
  try {
    const { data, error } = await supabase.rpc('list_discount_approvers');
    if (error) throw error;
    return {
      data: (data || []).map(u => ({ id: u.id, fullName: u.full_name, role: u.role })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchDiscountApprovers error:', error.message);
    return { data: null, error };
  }
}

/**
 * All discounts for a branch (pending + approved) with requester/approver
 * names — powers the manager/admin Discounts page.
 */
export async function fetchAllDiscounts(branchId) {
  try {
    let query = supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, date, start_time,
        base_amount, discount_amount, final_amount, discount_reason,
        discount_status, status, service_id,
        services:service_id(name),
        requester:users!discount_requested_by(full_name),
        approver:users!discount_approved_by(full_name),
        requestedTo:users!discount_requested_to(full_name)
      `)
      .neq('discount_status', 'none')
      .order('created_at', { ascending: false });
    query = withBranch(query, branchId);

    const { data, error } = await query;

    if (error) throw error;

    return {
      data: (data || []).map(b => ({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        date: b.date,
        startTime: b.start_time,
        serviceName: b.services?.name || '—',
        baseAmount: Number(b.base_amount),
        discountAmount: Number(b.discount_amount),
        finalAmount: Number(b.final_amount),
        discountPercent: Number(b.base_amount) > 0
          ? Math.round((Number(b.discount_amount) / Number(b.base_amount)) * 100)
          : 0,
        discountReason: b.discount_reason,
        discountStatus: b.discount_status,
        status: b.status,
        requestedByName: b.requester?.full_name || null,
        approvedByName: b.approver?.full_name || null,
        requestedToName: b.requestedTo?.full_name || null,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchAllDiscounts error:', error.message);
    return { data: null, error };
  }
}

/**
 * Approve a pending discount (manager/admin only).
 */
export async function approveDiscount(bookingId) {
  try {
    const { user, profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile.role === 'staff') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers can approve discounts.' } };
    }

    // Fetch booking to validate state before approval
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, payment_status, is_locked, discount_status, discount_requested_by, base_amount, discount_amount, booking_number, customer_name')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // Cannot modify discount on paid or locked bookings
    if (booking.payment_status === 'paid') {
      return { data: null, error: { code: 'BOOKING_IMMUTABLE', message: 'Cannot modify discount on a paid booking.' } };
    }
    if (booking.is_locked) {
      return { data: null, error: { code: 'BOOKING_LOCKED', message: 'Cannot modify discount on a locked booking.' } };
    }
    if (booking.discount_status !== 'pending') {
      return { data: null, error: { code: 'INVALID_STATE', message: 'Discount is not pending approval.' } };
    }

    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({
        discount_status: 'approved',
        discount_approved_by: user.id,
      })
      .eq('id', bookingId)
      .eq('discount_status', 'pending')
      .select('id, discount_amount, final_amount, discount_status')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Booking not found or discount is not pending.' } };
      }
      throw updateError;
    }

    await notifyDiscountDecision(booking, 'approved');

    capture('staff_discount_approved', { booking_id: bookingId });
    return { data: { success: true, bookingId, discountStatus: 'approved' }, error: null };
  } catch (error) {
    console.error('[API] approveDiscount error:', error.message);
    return { data: null, error };
  }
}

/**
 * Reject a pending discount — resets discount to zero (manager/admin only).
 */
export async function rejectDiscount(bookingId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile.role === 'staff') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers can reject discounts.' } };
    }

    // Fetch booking to validate state before rejection
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, payment_status, is_locked, discount_status, discount_requested_by, base_amount, discount_amount, booking_number, customer_name')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // Cannot modify discount on paid or locked bookings
    if (booking.payment_status === 'paid') {
      return { data: null, error: { code: 'BOOKING_IMMUTABLE', message: 'Cannot modify discount on a paid booking.' } };
    }
    if (booking.is_locked) {
      return { data: null, error: { code: 'BOOKING_LOCKED', message: 'Cannot modify discount on a locked booking.' } };
    }
    if (booking.discount_status !== 'pending') {
      return { data: null, error: { code: 'INVALID_STATE', message: 'Discount is not pending.' } };
    }

    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({
        discount_amount: 0,
        discount_status: 'none',
        discount_approved_by: null,
        discount_reason: null,
        discount_requested_by: null,
        discount_requested_to: null,
      })
      .eq('id', bookingId)
      .eq('discount_status', 'pending')
      .select('id, discount_amount, final_amount, discount_status')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Booking not found or discount is not pending.' } };
      }
      throw updateError;
    }

    await notifyDiscountDecision(booking, 'declined');

    capture('staff_discount_rejected', { booking_id: bookingId });
    return { data: { success: true, bookingId, discountStatus: 'none' }, error: null };
  } catch (error) {
    console.error('[API] rejectDiscount error:', error.message);
    return { data: null, error };
  }
}

/**
 * Notify the staff member who requested a discount that it was approved/declined.
 * Best-effort: never blocks or fails the parent decision if the insert errors.
 */
async function notifyDiscountDecision(booking, decision) {
  try {
    if (!booking?.discount_requested_by) return;

    const base = Number(booking.base_amount) || 0;
    const amount = Number(booking.discount_amount) || 0;
    const percent = base > 0 ? Math.round((amount / base) * 100) : 0;
    const who = booking.customer_name ? ` — ${booking.customer_name}` : '';
    const ref = booking.booking_number ? ` (${booking.booking_number})` : '';

    const title = decision === 'approved'
      ? `Discount approved${who}`
      : `Discount declined${who}`;
    const body = decision === 'approved'
      ? `Your ${percent}% discount request${ref} was approved.`
      : `Your ${percent}% discount request${ref} was declined.`;

    await supabase.rpc('enqueue_notification', {
      p_user_id: booking.discount_requested_by,
      p_type: decision === 'approved' ? 'discount_approved' : 'discount_declined',
      p_title: title,
      p_body: body,
      p_booking_id: booking.id,
    });
  } catch (error) {
    console.error('[API] notifyDiscountDecision error:', error.message);
  }
}

/**
 * Fetch the current user's in-app notifications (most recent first).
 */
export async function fetchNotifications(limit = 30) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, booking_id, read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchNotifications error:', error.message);
    return { data: null, error };
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(notificationId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] markNotificationRead error:', error.message);
    return { data: null, error };
  }
}

/**
 * Mark all of the current user's notifications as read.
 */
export async function markAllNotificationsRead() {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] markAllNotificationsRead error:', error.message);
    return { data: null, error };
  }
}

/**
 * Reschedule a booking to a new date/time.
 * Optionally reassign to a different therapist or room (cross-column drag).
 * Validates lifecycle, checks room/therapist availability, and updates the booking.
 */
export async function rescheduleBooking({ bookingId, newDate, newStartTime, newTherapistId, newRoomId }) {
  try {
    // 1. Fetch booking with service duration, room, therapist, and branch
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, payment_status, room_id, therapist_id, branch_id, service:services(duration_minutes)')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // 2. Lifecycle checks (not terminal, not locked)
    const mutationError = validateBookingMutation(booking);
    if (mutationError) return { data: null, error: mutationError };

    // 3. Cannot reschedule paid bookings
    if (booking.payment_status === 'paid') {
      return { data: null, error: { code: 'BOOKING_IMMUTABLE', message: 'Cannot reschedule a paid booking.' } };
    }

    // 4. Auth check
    const { user, profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // 5. Compute end_time from service duration
    const durationMinutes = booking.service?.duration_minutes;
    if (!durationMinutes) {
      return { data: null, error: { code: 'SERVICE_NOT_FOUND', message: 'Could not determine service duration for this booking.' } };
    }
    const newEndTime = addMinutesToTime(newStartTime, durationMinutes);

    // 6. Build update payload (time fields always included)
    const updatePayload = {
      date: newDate,
      start_time: newStartTime,
      end_time: newEndTime,
    };

    // 6a. Therapist reassignment
    if (newTherapistId !== undefined) {
      if (newTherapistId === 'unassigned' || newTherapistId === null) {
        updatePayload.therapist_id = null;
        updatePayload.therapist_name_snapshot = null;
      } else {
        // Resolve therapist name + check active status
        const { data: therapist } = await supabase
          .from('therapists')
          .select('name, is_active, branch_id')
          .eq('id', newTherapistId)
          .single();

        if (therapist && !therapist.is_active) {
          return { data: null, error: { code: 'THERAPIST_INACTIVE', message: 'Cannot assign an inactive therapist.' } };
        }
        // A therapist currently on a temporary transfer has branch_id pointing at the
        // destination branch, not this booking's branch — block reassigning to them
        // here until they're auto-reverted (migration-145).
        if (therapist && therapist.branch_id !== booking.branch_id) {
          return { data: null, error: { code: 'INVALID_THERAPIST', message: `${therapist.name} is not available in this branch right now (may be temporarily transferred elsewhere).` } };
        }
        updatePayload.therapist_id = newTherapistId;
        updatePayload.therapist_name_snapshot = therapist?.name || null;
      }
    }

    // 6b. Room reassignment
    const effectiveRoomId = newRoomId !== undefined
      ? (newRoomId === 'unassigned' || newRoomId === null ? null : newRoomId)
      : booking.room_id;

    if (newRoomId !== undefined) {
      if (newRoomId === 'unassigned' || newRoomId === null) {
        updatePayload.room_id = null;
        updatePayload.room_name_snapshot = null;
      } else {
        const { data: room } = await supabase
          .from('rooms')
          .select('name')
          .eq('id', newRoomId)
          .single();
        updatePayload.room_id = newRoomId;
        updatePayload.room_name_snapshot = room?.name || null;
      }
    }

    // 7. Check room availability with capacity
    if (effectiveRoomId) {
      // Fetch room to get capacity
      const { data: roomData } = await supabase
        .from('rooms')
        .select('id, name, capacity')
        .eq('id', effectiveRoomId)
        .single();

      const capacity = roomData ? getRoomCapacity(roomData) : 1;

      const { data: conflicts, error: conflictError } = await supabase
        .from('bookings')
        .select('id')
        .eq('room_id', effectiveRoomId)
        .eq('branch_id', booking.branch_id)
        .eq('date', newDate)
        .not('status', 'in', '("Cancelled","No Show")')
        .neq('id', bookingId)
        .lt('start_time', newEndTime)
        .gt('end_time', newStartTime);

      if (conflictError) throw conflictError;

      if (conflicts && conflicts.length >= capacity) {
        return {
          data: null,
          error: { code: 'ROOM_CONFLICT', message: `Room ${roomData?.name || 'unknown'} is fully booked at this time (${conflicts.length}/${capacity} slots used). Change the room or pick a different time.` },
        };
      }
    }

    // 8. Update the booking
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select('id, date, start_time, end_time, therapist_id, room_id')
      .single();

    if (updateError) {
      // GIST exclusion: therapist double-booking
      if (updateError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: 'Therapist is already booked during this time slot.' } };
      }
      // Room-capacity trigger: lost a race against a concurrent booking for the same room
      if (updateError.code === 'P0003') {
        return { data: null, error: { code: 'ROOM_CONFLICT', message: 'Room is fully booked at this time. Change the room or pick a different time.' } };
      }
      throw updateError;
    }

    // 9. Sync booking_therapists junction. If therapist changed, replace the
    //    junction row(s) so display reads the new therapist. Calendar reads the
    //    therapist name from this junction when it has any rows, so leaving the
    //    old therapist_id here causes the card to render the previous name even
    //    though bookings.therapist_id was updated. Shared-booking reassignment
    //    goes through assignTherapist and never reaches this path.
    try {
      if (newTherapistId !== undefined) {
        await supabase.from('booking_therapists').delete().eq('booking_id', bookingId);
        if (newTherapistId !== 'unassigned' && newTherapistId !== null) {
          await supabase.from('booking_therapists').insert({
            booking_id: bookingId,
            therapist_id: newTherapistId,
            start_time: updated.start_time,
            end_time: updated.end_time,
          });
        }
      } else {
        await supabase
          .from('booking_therapists')
          .update({ start_time: updated.start_time, end_time: updated.end_time })
          .eq('booking_id', bookingId);
      }
    } catch (junctionError) {
      // Best-effort: booking row is already updated and correct. Don't fail
      // the whole reschedule if this secondary sync write errors.
      console.error('[API] rescheduleBooking booking_therapists sync error:', junctionError.message);
    }

    return {
      data: {
        success: true,
        bookingId,
        bookingDate: updated.date,
        startTime: updated.start_time,
        endTime: updated.end_time,
        therapistId: updated.therapist_id,
        roomId: updated.room_id,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] rescheduleBooking error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Daily Closing & Reconciliation (Phase 5)
// ============================================================

export async function getDailySummary(branchId, date) {
  try {
    const overall = isOverallBranch(branchId);

    // 1. Fetch all bookings for the branch + date
    let bookingsQuery = supabase
      .from('bookings')
      .select('id, status, payment_status, base_amount, discount_amount, final_amount')
      .eq('date', date);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    const { data: bookings, error: bookingsError } = await bookingsQuery;

    if (bookingsError) throw bookingsError;

    const all = bookings || [];
    const totalBookings = all.length;
    const completedBookings = all.filter(b => b.status === 'Completed').length;
    const cancelledBookings = all.filter(b => b.status === 'Cancelled').length;

    // 2. Gross/discount from fully-paid (settled) bookings
    const paid = all.filter(b => b.payment_status === 'paid');
    const grossRevenue = paid.reduce((sum, b) => sum + Number(b.base_amount), 0);
    const totalDiscounts = paid.reduce((sum, b) => sum + Number(b.discount_amount), 0);

    // 3. Outstanding count (Confirmed/Completed not fully paid — unpaid or partial)
    const unpaidCount = all.filter(
      b => ['unpaid', 'partial'].includes(b.payment_status) && ['Confirmed', 'Completed'].includes(b.status)
    ).length;

    // 4. Net revenue = cash actually collected today (full + partial payments),
    //    plus the payment-mode breakdown — both from the payments rows.
    const settledBookingIds = all
      .filter(b => ['paid', 'partial'].includes(b.payment_status))
      .map(b => b.id);
    let netRevenue = 0;
    let paymentBreakdown = { cash: 0, card: 0, fonepay: 0 };

    if (settledBookingIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('amount, payment_mode')
        .in('booking_id', settledBookingIds);

      if (paymentsError) throw paymentsError;

      for (const p of (payments || [])) {
        const amount = Number(p.amount);
        netRevenue += amount;
        paymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
      }
    }

    // 4b. Voucher sales collected today — same cash-in-drawer money as booking
    // payments, so it folds into the same paymentBreakdown buckets (that's the
    // whole point: voucher cash was previously invisible to reconciliation).
    let voucherSalesTotal = 0;
    let vouchersQuery = supabase
      .from('vouchers')
      .select('id')
      .eq('issued_date', date);
    vouchersQuery = withBranch(vouchersQuery, branchId);
    const { data: vouchersToday, error: vouchersError } = await vouchersQuery;
    if (vouchersError) throw vouchersError;

    const voucherIds = (vouchersToday || []).map((v) => v.id);
    if (voucherIds.length > 0) {
      const { data: voucherPayments, error: voucherPaymentsError } = await supabase
        .from('voucher_payments')
        .select('amount, payment_mode')
        .in('voucher_id', voucherIds);
      if (voucherPaymentsError) throw voucherPaymentsError;

      for (const p of (voucherPayments || [])) {
        const amount = Number(p.amount);
        voucherSalesTotal += amount;
        netRevenue += amount;
        paymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
      }
    }

    // 5. Check if day is already closed — Overall always live-computes (no per-branch close)
    let existingReport = null;
    if (!overall) {
      const { data } = await supabase
        .from('daily_reports')
        .select('id, closed_at, closed_by')
        .eq('branch_id', resolveBranchId(branchId))
        .eq('report_date', date)
        .maybeSingle();
      existingReport = data;
    }

    return {
      data: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        grossRevenue,
        totalDiscounts,
        netRevenue,
        paymentBreakdown,
        voucherSalesTotal,
        unpaidCount,
        isClosed: !!existingReport,
        closedAt: existingReport?.closed_at || null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getDailySummary error:', error.message);
    return { data: null, error };
  }
}

// Payment-mode bucketing for the Today's Insights panel. Bank-card processors keep the
// legacy 'Card' string check plus the named custom bank methods (migration-052 relaxed
// payment_mode to a free string, so orgs can add more bank names later — this list covers
// what's configured today). Wallet is internal credit only (Membership/Referral/Voucher
// balances); Digital is external non-card electronic payment. See getDailySummary above
// for the same 'today' semantics (bookings.date, not payment created_at).
const CARD_MODES = new Set(['Card', 'Nabil', 'GlobalIME', 'NICAsia']);
const WALLET_MODES = new Set(['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher']);
const DIGITAL_MODES = new Set(['Esewa', 'Khalti', 'MobileBanking', 'Cheque']);

export async function getTodayInsights(branchId, from, to) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const rangeStart = from || new Date().toISOString().split('T')[0];
    const rangeEnd = to || rangeStart;

    // 1. Bookings for the branch in range, settled or partially settled
    let bookingsQuery = supabase
      .from('bookings')
      .select('id, payment_status')
      .gte('date', rangeStart)
      .lte('date', rangeEnd);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    const { data: bookings, error: bookingsError } = await bookingsQuery;
    if (bookingsError) throw bookingsError;

    const settledBookingIds = (bookings || [])
      .filter(b => ['paid', 'partial'].includes(b.payment_status))
      .map(b => b.id);

    // 2. Bucket today's payments by mode
    let totalSales = 0;
    let cash = 0, card = 0, digital = 0, wallet = 0;
    let membershipRedeemed = { count: 0, value: 0 };

    if (settledBookingIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('amount, payment_mode')
        .in('booking_id', settledBookingIds);
      if (paymentsError) throw paymentsError;

      for (const p of (payments || [])) {
        const amount = Number(p.amount);
        totalSales += amount;
        if (p.payment_mode === 'Cash') {
          cash += amount;
        } else if (CARD_MODES.has(p.payment_mode) || p.payment_mode.includes('Card')) {
          card += amount;
        } else if (WALLET_MODES.has(p.payment_mode)) {
          wallet += amount;
          if (p.payment_mode === 'Membership') {
            membershipRedeemed.count += 1;
            membershipRedeemed.value += amount;
          }
        } else if (DIGITAL_MODES.has(p.payment_mode)) {
          digital += amount;
        } else {
          // Unrecognized custom mode — treat as digital/other rather than drop it.
          digital += amount;
        }
      }
    }

    // 3. Gift vouchers claimed in range (redemption ledger)
    let claimsQuery = supabase
      .from('voucher_claims')
      .select('amount_claimed')
      .gte('redeemed_date', rangeStart)
      .lte('redeemed_date', rangeEnd);
    claimsQuery = withBranch(claimsQuery, branchId, 'branch_claimed_id');
    const { data: claims, error: claimsError } = await claimsQuery;
    if (claimsError) throw claimsError;
    const voucherClaimed = {
      count: (claims || []).length,
      value: (claims || []).reduce((sum, c) => sum + Number(c.amount_claimed), 0),
    };

    // 4. Gift vouchers distributed (issued) in range
    let issuedQuery = supabase
      .from('vouchers')
      .select('total_amount_issued')
      .gte('issued_date', rangeStart)
      .lte('issued_date', rangeEnd);
    issuedQuery = withBranch(issuedQuery, branchId, 'branch_id');
    const { data: issued, error: issuedError } = await issuedQuery;
    if (issuedError) throw issuedError;
    const voucherDistributed = {
      count: (issued || []).length,
      value: (issued || []).reduce((sum, v) => sum + Number(v.total_amount_issued), 0),
    };

    // 5. Memberships sold (deposits) in range — org-scoped via RLS (no branch column on
    // membership_transactions), so do NOT withBranch() this query. rangeEnd is a Nepal calendar
    // date; the exclusive upper bound is the next day's Nepal midnight (+05:45).
    const nextDayBoundary = new Date(`${rangeEnd}T00:00:00+05:45`);
    nextDayBoundary.setUTCDate(nextDayBoundary.getUTCDate() + 1);
    const { data: deposits, error: depositsError } = await supabase
      .from('membership_transactions')
      .select('amount, created_at')
      .eq('kind', 'deposit')
      .gte('created_at', `${rangeStart}T00:00:00+05:45`)
      .lt('created_at', nextDayBoundary.toISOString());
    if (depositsError) throw depositsError;
    const membershipSold = {
      count: (deposits || []).length,
      value: (deposits || []).reduce((sum, d) => sum + Number(d.amount), 0),
    };

    // 6. Staff utilization (reuse existing intelligence function)
    const { data: utilization, error: utilizationError } = await getUtilizationIntelligence({ branchId, from: rangeStart, to: rangeEnd });
    if (utilizationError) throw utilizationError;

    return {
      data: {
        totalSales,
        cash,
        card,
        digital,
        wallet,
        membershipRedeemed,
        membershipSold,
        voucherClaimed,
        voucherDistributed,
        staffUtilization: {
          avgPercent: utilization?.summary?.avgTherapistUtilization ?? 0,
          therapists: utilization?.therapistUtilization ?? [],
        },
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getTodayInsights error:', error.message);
    return { data: null, error };
  }
}

export async function closeDay(branchId, date) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Validate user role — only manager or admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: null, error: { code: 'UNAUTHENTICATED', message: 'You must be logged in.' } };
    }

    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    if (!['manager', 'admin'].includes(userProfile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers or admins can close the day.' } };
    }

    // 2. Check if already closed
    const { data: existingReport } = await supabase
      .from('daily_reports')
      .select('id')
      .eq('branch_id', resolvedBranchId)
      .eq('report_date', date)
      .maybeSingle();

    if (existingReport) {
      return { data: null, error: { code: 'ALREADY_CLOSED', message: 'Day has already been closed.' } };
    }

    // 3. Get the summary
    const { data: summary, error: summaryError } = await getDailySummary(resolvedBranchId, date);
    if (summaryError) throw summaryError;

    // 4. Insert daily report
    const { data: report, error: insertError } = await supabase
      .from('daily_reports')
      .insert({
        branch_id: resolvedBranchId,
        report_date: date,
        total_bookings: summary.totalBookings,
        completed_bookings: summary.completedBookings,
        cancelled_bookings: summary.cancelledBookings,
        gross_revenue: summary.grossRevenue,
        total_discounts: summary.totalDiscounts,
        net_revenue: summary.netRevenue,
        cash_total: summary.paymentBreakdown.cash,
        card_total: summary.paymentBreakdown.card,
        fonepay_total: summary.paymentBreakdown.fonepay,
        unpaid_count: summary.unpaidCount,
        closed_by: user.id,
      })
      .select('id')
      .single();

    if (insertError) {
      // Unique constraint: race condition double-close
      if (insertError.code === '23505') {
        return { data: null, error: { code: 'ALREADY_CLOSED', message: 'Day has already been closed.' } };
      }
      throw insertError;
    }

    // 5. Lock all non-locked bookings for that branch + date
    const { error: lockError } = await supabase
      .from('bookings')
      .update({ is_locked: true })
      .eq('branch_id', resolvedBranchId)
      .eq('date', date)
      .eq('is_locked', false);

    if (lockError) {
      console.error('[API] closeDay lock error:', lockError.message);
      // Report was inserted — lock failure is non-fatal but logged
    }

    return {
      data: { success: true, reportId: report.id, warning: lockError ? 'Bookings could not be locked. They may still be editable.' : null },
      error: null,
    };
  } catch (error) {
    console.error('[API] closeDay error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 7: Operational Reporting & Excel-Parity Export
// ============================================================

export async function getDailyOperationalReport(branchId, date) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!date) {
      return { data: null, error: { code: 'INVALID_DATE', message: 'Date is required.' } };
    }

    const overall = isOverallBranch(branchId);

    // Step 1 — Check if day is closed (stored snapshot) — Overall always live-computes
    let closedReport = null;
    if (!overall) {
      const { data, error: closedError } = await supabase
        .from('daily_reports')
        .select('*')
        .eq('branch_id', resolveBranchId(branchId))
        .eq('report_date', date)
        .maybeSingle();

      if (closedError) throw closedError;
      closedReport = data;
    }

    const isClosed = !!closedReport;

    // Step 2 — Fetch all bookings for branch + date
    // Phase 9A: Use snapshot fields for display instead of JOINed live data
    let bookingsQuery = supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, status, payment_status,
        base_amount, discount_amount, final_amount, discount_status,
        discount_approved_by, therapist_id,
        service_name_snapshot, service_duration_snapshot, service_price_snapshot,
        therapist_name_snapshot, room_name_snapshot
      `)
      .eq('date', date)
      .order('start_time');
    bookingsQuery = withBranch(bookingsQuery, branchId);
    const { data: bookings, error: bookingsError } = await bookingsQuery;

    if (bookingsError) throw bookingsError;

    const all = bookings || [];

    // Fetch payments for all bookings in one query. A booking may have multiple
    // tenders (split payment), so aggregate per booking AND keep the raw rows.
    const bookingIds = all.map(b => b.id);
    let paymentRows = [];
    let paymentsMap = {}; // booking_id -> { amount: total collected, modes: [] }

    if (bookingIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('booking_id, amount, payment_mode')
        .in('booking_id', bookingIds);

      if (paymentsError) throw paymentsError;

      paymentRows = payments || [];
      for (const p of paymentRows) {
        const e = paymentsMap[p.booking_id] || { amount: 0, modes: [] };
        e.amount += Number(p.amount);
        if (p.payment_mode) e.modes.push(p.payment_mode);
        paymentsMap[p.booking_id] = e;
      }
    }

    // Voucher sales for this branch + date — same query shape as getDailySummary's
    // voucher block. Computed unconditionally (closed or not) so the live branch's
    // totals/paymentBreakdown can fold it in the same way the closed snapshot already
    // does (closeDay persists getDailySummary()'s voucher-inclusive totals) — without
    // this, the live branch would show lower cash/card/fonepay totals than the same
    // report shows once the day is closed, purely from a voucher sale.
    let voucherSalesTotal = 0;
    const voucherPaymentBreakdown = { cash: 0, card: 0, fonepay: 0 };
    let vouchersQuery = supabase
      .from('vouchers')
      .select('id')
      .eq('issued_date', date);
    vouchersQuery = withBranch(vouchersQuery, branchId);
    const { data: vouchersToday, error: vouchersError } = await vouchersQuery;
    if (vouchersError) throw vouchersError;

    const voucherIds = (vouchersToday || []).map(v => v.id);
    if (voucherIds.length > 0) {
      const { data: voucherPayments, error: voucherPaymentsError } = await supabase
        .from('voucher_payments')
        .select('amount, payment_mode')
        .in('voucher_id', voucherIds);
      if (voucherPaymentsError) throw voucherPaymentsError;

      for (const p of (voucherPayments || [])) {
        const amount = Number(p.amount);
        voucherSalesTotal += amount;
        voucherPaymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
      }
    }

    // Build bookings list — Phase 9A: use snapshot fields for display
    const bookingsList = all.map(b => {
      const payment = paymentsMap[b.id];
      const collected = payment ? payment.amount : 0;
      const uniqueModes = payment ? [...new Set(payment.modes)] : [];
      return {
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        serviceName: b.service_name_snapshot || '—',
        therapistName: b.therapist_name_snapshot || 'Unassigned',
        roomName: b.room_name_snapshot || '—',
        baseAmount: Number(b.base_amount),
        discountAmount: Number(b.discount_amount),
        finalAmount: Number(b.final_amount),
        amountPaid: collected,
        amountDue: Math.max(Number(b.final_amount) - collected, 0),
        paymentMode: uniqueModes.length > 1 ? 'Split' : (uniqueModes[0] || null),
        paymentStatus: b.payment_status,
        status: b.status,
      };
    });

    // Step 3 — Compute totals
    // If closed, use stored snapshot for financial totals
    // If open, compute live from payments
    let totals;

    if (isClosed) {
      totals = {
        totalBookings: closedReport.total_bookings,
        completedBookings: closedReport.completed_bookings,
        cancelledBookings: closedReport.cancelled_bookings,
        noShowBookings: all.filter(b => b.status === 'No Show').length,
        grossRevenue: Number(closedReport.gross_revenue),
        totalDiscount: Number(closedReport.total_discounts),
        netRevenue: Number(closedReport.net_revenue),
      };
    } else {
      // Live compute — revenue from payments only
      const paidBookings = all.filter(b => b.payment_status === 'paid');

      totals = {
        totalBookings: all.length,
        completedBookings: all.filter(b => b.status === 'Completed').length,
        cancelledBookings: all.filter(b => b.status === 'Cancelled').length,
        noShowBookings: all.filter(b => b.status === 'No Show').length,
        grossRevenue: paidBookings.reduce((sum, b) => sum + Number(b.base_amount), 0),
        totalDiscount: paidBookings.reduce((sum, b) => sum + Number(b.discount_amount), 0),
        // REVENUE LAW: netRevenue = SUM(payments.amount) — includes partial collections
        // Folds in voucherSalesTotal so the live branch matches what the closed
        // snapshot already includes (closeDay persists getDailySummary()'s
        // voucher-inclusive netRevenue).
        netRevenue: paymentRows.reduce((sum, p) => sum + Number(p.amount), 0) + voucherSalesTotal,
      };
    }

    // Step 4 — Payment breakdown
    let paymentBreakdown;

    if (isClosed) {
      paymentBreakdown = {
        cash: Number(closedReport.cash_total),
        card: Number(closedReport.card_total),
        fonepay: Number(closedReport.fonepay_total),
      };
    } else {
      paymentBreakdown = { cash: 0, card: 0, fonepay: 0 };
      for (const p of paymentRows) {
        const amount = Number(p.amount);
        paymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
      }
      paymentBreakdown.cash += voucherPaymentBreakdown.cash;
      paymentBreakdown.card += voucherPaymentBreakdown.card;
      paymentBreakdown.fonepay += voucherPaymentBreakdown.fonepay;
    }

    // Step 5 — Staff discount summary
    // Group by discount_approved_by for paid bookings with discount > 0
    const discountBookings = all.filter(
      b => b.payment_status === 'paid' && Number(b.discount_amount) > 0 && b.discount_approved_by
    );

    const discountByStaff = {};
    for (const b of discountBookings) {
      const key = b.discount_approved_by;
      if (!discountByStaff[key]) {
        discountByStaff[key] = { staffId: key, discountCount: 0, totalDiscountAmount: 0 };
      }
      discountByStaff[key].discountCount += 1;
      discountByStaff[key].totalDiscountAmount += Number(b.discount_amount);
    }

    // Fetch staff names for discount approvers
    const approverIds = Object.keys(discountByStaff);
    let staffNameMap = {};
    if (approverIds.length > 0) {
      const { data: staffUsers } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', approverIds);

      for (const u of (staffUsers || [])) {
        staffNameMap[u.id] = u.full_name;
      }
    }

    const staffDiscountSummary = Object.values(discountByStaff).map(d => ({
      staffName: staffNameMap[d.staffId] || 'Unknown',
      discountCount: d.discountCount,
      totalDiscountAmount: d.totalDiscountAmount,
    }));

    // Step 6 — Therapist revenue summary
    // Group by therapist_id for paid + completed bookings
    const therapistBookings = all.filter(
      b => b.payment_status === 'paid' && b.status === 'Completed' && b.therapist_id
    );

    const revenueByTherapist = {};
    for (const b of therapistBookings) {
      const key = b.therapist_id;
      const payment = paymentsMap[b.id];
      if (!revenueByTherapist[key]) {
        revenueByTherapist[key] = {
          therapistName: b.therapist_name_snapshot || 'Unknown',
          completedBookings: 0,
          totalRevenue: 0,
        };
      }
      revenueByTherapist[key].completedBookings += 1;
      revenueByTherapist[key].totalRevenue += payment ? Number(payment.amount) : 0;
    }

    const therapistRevenueSummary = Object.values(revenueByTherapist);

    // Step 7 — Unpaid / partially-paid bookings (outstanding balance)
    const unpaidBookings = all
      .filter(b => ['unpaid', 'partial'].includes(b.payment_status) && ['Confirmed', 'Completed'].includes(b.status))
      .map(b => {
        const collected = paymentsMap[b.id]?.amount || 0;
        return {
          bookingNumber: b.booking_number,
          customerName: b.customer_name,
          serviceName: b.service_name_snapshot || '—',
          finalAmount: Number(b.final_amount),
          amountDue: Math.max(Number(b.final_amount) - collected, 0),
          status: b.status,
        };
      });

    return {
      data: {
        bookings: bookingsList,
        totals,
        paymentBreakdown,
        voucherSalesTotal,
        staffDiscountSummary,
        therapistRevenueSummary,
        unpaidBookings,
        isClosed,
        closedAt: closedReport?.closed_at || null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getDailyOperationalReport error:', error.message);
    return { data: null, error: { code: 'REPORT_GENERATION_FAILED', message: error.message } };
  }
}

export function exportDailyReportCSV(reportData) {
  if (!reportData) return '';

  const rows = [];
  const { bookings, totals, paymentBreakdown, staffDiscountSummary, therapistRevenueSummary, unpaidBookings } = reportData;

  // Section 1: Booking Details
  rows.push('DAILY OPERATIONAL REPORT');
  rows.push('');
  rows.push([
    'Booking #', 'Customer Name', 'Service', 'Therapist', 'Room',
    'Base Amount', 'Discount', 'Final Amount', 'Payment Mode', 'Payment Status', 'Status'
  ].join(','));

  for (const b of bookings) {
    rows.push([
      b.bookingNumber,
      `"${(b.customerName || '').replace(/"/g, '""')}"`,
      `"${(b.serviceName || '').replace(/"/g, '""')}"`,
      `"${(b.therapistName || '').replace(/"/g, '""')}"`,
      `"${(b.roomName || '').replace(/"/g, '""')}"`,
      b.baseAmount.toFixed(2),
      b.discountAmount.toFixed(2),
      b.finalAmount.toFixed(2),
      b.paymentMode || '',
      b.paymentStatus,
      b.status,
    ].join(','));
  }

  // Section 2: Totals
  rows.push('');
  rows.push('SUMMARY');
  rows.push(`Total Bookings,${totals.totalBookings}`);
  rows.push(`Completed,${totals.completedBookings}`);
  rows.push(`Cancelled,${totals.cancelledBookings}`);
  rows.push(`No Show,${totals.noShowBookings}`);
  rows.push(`Gross Revenue,${totals.grossRevenue.toFixed(2)}`);
  rows.push(`Total Discount,${totals.totalDiscount.toFixed(2)}`);
  rows.push(`Net Revenue,${totals.netRevenue.toFixed(2)}`);

  // Section 3: Payment Breakdown
  rows.push('');
  rows.push('PAYMENT BREAKDOWN');
  rows.push(`Cash,${paymentBreakdown.cash.toFixed(2)}`);
  rows.push(`Card,${paymentBreakdown.card.toFixed(2)}`);
  rows.push(`Mobile/Other,${paymentBreakdown.fonepay.toFixed(2)}`);

  // Section 4: Staff Discount Summary
  if (staffDiscountSummary.length > 0) {
    rows.push('');
    rows.push('STAFF DISCOUNT SUMMARY');
    rows.push('Staff Name,Discount Count,Total Discount Amount');
    for (const s of staffDiscountSummary) {
      rows.push(`"${s.staffName}",${s.discountCount},${s.totalDiscountAmount.toFixed(2)}`);
    }
  }

  // Section 5: Therapist Revenue Summary
  if (therapistRevenueSummary.length > 0) {
    rows.push('');
    rows.push('THERAPIST REVENUE SUMMARY');
    rows.push('Therapist Name,Completed Bookings,Total Revenue');
    for (const t of therapistRevenueSummary) {
      rows.push(`"${t.therapistName}",${t.completedBookings},${t.totalRevenue.toFixed(2)}`);
    }
  }

  // Section 6: Unpaid Bookings
  if (unpaidBookings.length > 0) {
    rows.push('');
    rows.push('UNPAID BOOKINGS');
    rows.push('Booking #,Customer Name,Service,Final Amount,Status');
    for (const u of unpaidBookings) {
      rows.push(`${u.bookingNumber},"${(u.customerName || '').replace(/"/g, '""')}","${(u.serviceName || '').replace(/"/g, '""')}",${u.finalAmount.toFixed(2)},${u.status}`);
    }
  }

  return rows.join('\n');
}

// ============================================================
// Phase 10D-1: Revenue Intelligence
// ============================================================

function getISOWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function getMonthStart(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

async function computeRevenueForRange(branchId, startDate, endDate) {
  const overall = isOverallBranch(branchId);

  // 1. Fetch closed-day snapshots in range — Overall computes purely live (no snapshots)
  let reports = [];
  if (!overall) {
    const { data, error: reportsError } = await supabase
      .from('daily_reports')
      .select('report_date, gross_revenue, total_discounts, net_revenue')
      .eq('branch_id', resolveBranchId(branchId))
      .gte('report_date', startDate)
      .lte('report_date', endDate);

    if (reportsError) throw reportsError;
    reports = data || [];
  }

  const closedDates = new Set((reports || []).map(r => r.report_date));

  let closedGross = 0, closedDiscount = 0, closedNet = 0;
  for (const r of (reports || [])) {
    closedGross += Number(r.gross_revenue);
    closedDiscount += Number(r.total_discounts);
    closedNet += Number(r.net_revenue);
  }

  // 2. Fetch paid bookings in range
  let bookingsQuery = supabase
    .from('bookings')
    .select('date, base_amount, discount_amount, final_amount')
    .eq('payment_status', 'paid')
    .gte('date', startDate)
    .lte('date', endDate);
  bookingsQuery = withBranch(bookingsQuery, branchId);
  const { data: bookings, error: bookingsError } = await bookingsQuery;

  if (bookingsError) throw bookingsError;

  const paidBookings = (bookings || []).length;

  // 3. Compute live revenue for open dates only
  let liveGross = 0, liveDiscount = 0, liveNet = 0;
  for (const b of (bookings || [])) {
    if (!closedDates.has(b.date)) {
      liveGross += Number(b.base_amount);
      liveDiscount += Number(b.discount_amount);
      liveNet += Number(b.final_amount);
    }
  }

  return {
    grossRevenue: closedGross + liveGross,
    totalDiscount: closedDiscount + liveDiscount,
    netRevenue: closedNet + liveNet,
    paidBookings,
  };
}

// Exposes computeRevenueForRange for callers that need an arbitrary single
// period's totals (e.g. the dashboard's period filter) rather than the fixed
// Today/Yesterday/WTD/MTD comparison getRevenueIntelligence returns.
export async function getRevenueForPeriod({ branchId, from, to }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    const data = await computeRevenueForRange(branchId, from, to);
    return { data, error: null };
  } catch (error) {
    console.error('[API] getRevenueForPeriod error:', error.message);
    return { data: null, error };
  }
}

export async function getRevenueIntelligence({ branchId, date }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const yesterday = new Date(new Date(targetDate).getTime() - 86400000).toISOString().split('T')[0];
    const weekStart = getISOWeekMonday(targetDate);
    const monthStart = getMonthStart(targetDate);

    // Run all four period queries in parallel
    const [todayResult, yesterdayResult, weekResult, monthResult] = await Promise.all([
      computeRevenueForRange(branchId, targetDate, targetDate),
      computeRevenueForRange(branchId, yesterday, yesterday),
      computeRevenueForRange(branchId, weekStart, targetDate),
      computeRevenueForRange(branchId, monthStart, targetDate),
    ]);

    return {
      data: {
        today: todayResult,
        yesterday: yesterdayResult,
        weekToDate: weekResult,
        monthToDate: monthResult,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getRevenueIntelligence error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 10D-2: Utilization & Capacity Intelligence (Read-Only)
// ============================================================

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

export async function getUtilizationIntelligence({ branchId, date, from, to }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const overall = isOverallBranch(branchId);
    const targetDate = date || new Date().toISOString().split('T')[0];
    // Range mode (multi-day period filter): aggregate across [from, to] instead
    // of a single day. Attendance is tracked per-day, so a multi-day window
    // skips the absent/leave exclusion below rather than trying to prorate it —
    // available therapists = all active therapists for range mode.
    const isRange = !!(from && to && from !== to);
    const rangeStart = from || targetDate;
    const rangeEnd = to || targetDate;
    const dayCount = isRange
      ? Math.max(1, Math.round((new Date(rangeEnd) - new Date(rangeStart)) / 86400000) + 1)
      : 1;

    // 1. Fetch branch operating hours. Overall: build a per-branch window map across the org.
    let branch = null;
    let operatingMinutes = 0;
    const branchWindow = {};
    if (overall) {
      const { data: branches, error: branchesError } = await supabase
        .from('branches')
        .select('id, open_time, close_time');
      if (branchesError) throw branchesError;
      for (const br of (branches || [])) {
        branchWindow[br.id] = (timeToMinutes(br.close_time) - timeToMinutes(br.open_time)) * dayCount;
      }
    } else {
      const { data: branchRow, error: branchError } = await supabase
        .from('branches')
        .select('open_time, close_time')
        .eq('id', resolveBranchId(branchId))
        .single();

      if (branchError) throw branchError;
      branch = branchRow;
      const openMin = timeToMinutes(branch.open_time);
      const closeMin = timeToMinutes(branch.close_time);
      operatingMinutes = (closeMin - openMin) * dayCount; // e.g. 720 for 9:00–21:00, ×days in range
    }

    // Operating window (minutes) attributable to a given resource's branch.
    const windowFor = (bid) => overall ? (branchWindow[bid] || 0) : operatingMinutes;

    // 2. Fetch active rooms + therapists + attendance (parallel)
    let roomsQuery = supabase
      .from('rooms')
      .select('id, name, branch_id')
      .eq('is_active', true);
    roomsQuery = withBranch(roomsQuery, branchId);
    let therapistsQuery = supabase
      .from('therapists')
      .select('id, name, branch_id')
      .eq('is_active', true);
    therapistsQuery = withBranch(therapistsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status')
      .eq('date', targetDate)
      .in('status', ['Absent', ...LEAVE_LIKE_ATTENDANCE_STATUSES]);
    attendanceQuery = withBranch(attendanceQuery, branchId);
    const [roomsResult, therapistsResult, attendanceResult] = await Promise.all([
      roomsQuery,
      therapistsQuery,
      isRange ? Promise.resolve({ data: [], error: null }) : attendanceQuery,
    ]);

    if (roomsResult.error) throw roomsResult.error;
    if (therapistsResult.error) throw therapistsResult.error;
    // Attendance errors are non-fatal — just ignore
    const absentIds = new Set();
    if (!isRange && !attendanceResult.error && attendanceResult.data) {
      for (const a of attendanceResult.data) {
        absentIds.add(a.therapist_id);
      }
    }

    const rooms = roomsResult.data || [];
    const therapists = therapistsResult.data || [];
    // Available therapists = active minus absent/leave (single-day only; see isRange above)
    const availableTherapists = therapists.filter(t => !absentIds.has(t.id));

    // 3. Fetch qualifying bookings: Confirmed, In-Progress, Completed only
    let bookingsQuery = supabase
      .from('bookings')
      .select('id, room_id, therapist_id, start_time, end_time, service_duration_snapshot, status')
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);
    bookingsQuery = isRange
      ? bookingsQuery.gte('date', rangeStart).lte('date', rangeEnd)
      : bookingsQuery.eq('date', targetDate);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    const { data: bookings, error: bookingsError } = await bookingsQuery;

    if (bookingsError) throw bookingsError;

    const allBookings = bookings || [];

    // 4. Compute per-room utilization
    const roomMinutesMap = {};
    for (const r of rooms) {
      roomMinutesMap[r.id] = { name: r.name, bookedMinutes: 0 };
    }

    for (const b of allBookings) {
      if (b.room_id && roomMinutesMap[b.room_id]) {
        roomMinutesMap[b.room_id].bookedMinutes += b.service_duration_snapshot || 0;
      }
    }

    const roomUtilization = rooms.map(r => {
      const booked = roomMinutesMap[r.id]?.bookedMinutes || 0;
      const total = windowFor(r.branch_id);
      return {
        id: r.id,
        name: r.name,
        bookedMinutes: booked,
        totalMinutes: total,
        percent: total > 0 ? Math.round((booked / total) * 100) : 0,
      };
    });

    // 5. Compute per-therapist utilization (only available therapists)
    const therapistMinutesMap = {};
    for (const t of availableTherapists) {
      therapistMinutesMap[t.id] = { name: t.name, bookedMinutes: 0 };
    }

    for (const b of allBookings) {
      if (b.therapist_id && therapistMinutesMap[b.therapist_id]) {
        therapistMinutesMap[b.therapist_id].bookedMinutes += b.service_duration_snapshot || 0;
      }
    }

    const therapistUtilization = availableTherapists.map(t => {
      const booked = therapistMinutesMap[t.id]?.bookedMinutes || 0;
      const total = windowFor(t.branch_id);
      return {
        id: t.id,
        name: t.name,
        bookedMinutes: booked,
        totalMinutes: total,
        percent: total > 0 ? Math.round((booked / total) * 100) : 0,
      };
    });

    // 6. Hourly booking distribution (by start hour, 0–23)
    const hourlyDistribution = new Array(24).fill(0);
    for (const b of allBookings) {
      const hour = timeToMinutes(b.start_time);
      const hourIndex = Math.floor(hour / 60);
      if (hourIndex >= 0 && hourIndex < 24) {
        hourlyDistribution[hourIndex]++;
      }
    }

    // 7. Summary stats
    const totalBookedMinutes = allBookings.reduce((sum, b) => sum + (b.service_duration_snapshot || 0), 0);
    const totalRoomCapacity = rooms.reduce((sum, r) => sum + windowFor(r.branch_id), 0);
    const totalTherapistCapacity = availableTherapists.reduce((sum, t) => sum + windowFor(t.branch_id), 0);

    const avgRoomUtilization = totalRoomCapacity > 0
      ? Math.round((roomUtilization.reduce((sum, r) => sum + r.bookedMinutes, 0) / totalRoomCapacity) * 100)
      : 0;
    const avgTherapistUtilization = totalTherapistCapacity > 0
      ? Math.round((therapistUtilization.reduce((sum, t) => sum + t.bookedMinutes, 0) / totalTherapistCapacity) * 100)
      : 0;

    // Idle = total room capacity minus booked room minutes
    const idleMinutes = totalRoomCapacity - roomUtilization.reduce((sum, r) => sum + r.bookedMinutes, 0);

    // Peak hour
    const peakHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));

    return {
      data: {
        operatingMinutes: overall ? null : operatingMinutes,
        operatingHours: overall
          ? 'Multiple branches'
          : (branch.open_time && branch.close_time
            ? `${branch.open_time.slice(0, 5)}–${branch.close_time.slice(0, 5)}`
            : 'Not set'),
        roomUtilization,
        therapistUtilization,
        hourlyDistribution,
        summary: {
          avgRoomUtilization,
          avgTherapistUtilization,
          totalBookedMinutes,
          idleMinutes: Math.max(0, idleMinutes),
          peakHour,
          totalBookings: allBookings.length,
          roomCount: rooms.length,
          therapistCount: availableTherapists.length,
        },
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getUtilizationIntelligence error:', error.message);
    return { data: null, error };
  }
}

// Anon-safe variant for the public /manage self-service portal — no session exists,
// so this goes through public_search_booking (SECURITY DEFINER, phone/booking-number
// match only) instead of a raw table SELECT gated by anon RLS.
export async function searchBookingPublic(branchId, query) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);
    const searchTerm = (query || '').trim();
    if (!searchTerm) {
      return { data: [], error: null };
    }

    const { data, error } = await supabase.rpc('public_search_booking', {
      p_branch_id: resolvedBranchId,
      p_query: searchTerm,
    });
    if (error) throw error;

    if (!data || data.length === 0) {
      return { data: [], error: null };
    }

    const serviceIds = [...new Set(data.map(b => b.service_id).filter(Boolean))];
    const therapistIds = [...new Set(data.map(b => b.therapist_id).filter(Boolean))];
    const roomIds = [...new Set(data.map(b => b.room_id).filter(Boolean))];

    const [{ data: services }, { data: therapists }, { data: rooms }] = await Promise.all([
      serviceIds.length
        ? supabase.from('services').select('id, name, duration_minutes').in('id', serviceIds)
        : Promise.resolve({ data: [] }),
      therapistIds.length
        ? supabase.from('therapists').select('id, name, gender').in('id', therapistIds)
        : Promise.resolve({ data: [] }),
      roomIds.length
        ? supabase.from('rooms').select('id, name').in('id', roomIds)
        : Promise.resolve({ data: [] }),
    ]);

    const serviceMap = new Map((services || []).map(s => [s.id, s]));
    const therapistMap = new Map((therapists || []).map(t => [t.id, t]));
    const roomMap = new Map((rooms || []).map(r => [r.id, r]));

    const enriched = data.map(b => ({
      ...b,
      service: serviceMap.get(b.service_id) || null,
      therapist: therapistMap.get(b.therapist_id) || null,
      room: roomMap.get(b.room_id) || null,
    }));

    return { data: enriched, error: null };
  } catch (error) {
    console.error('[API] searchBookingPublic error:', error.message);
    return { data: null, error };
  }
}

export async function searchBookings(branchId, query) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);
    const searchTerm = (query || '').trim();
    if (!searchTerm) {
      return { data: [], error: null };
    }

    let dbQuery = supabase
      .from('bookings')
      .select(`
        *,
        service:services(id, name, duration_minutes),
        therapist:therapists(id, name, gender),
        room:rooms(id, name)
      `)
      .eq('branch_id', resolvedBranchId)
      .order('date', { ascending: false })
      .limit(20);

    // Search across booking_number, customer_name, customer_phone
    // Sanitize to prevent PostgREST filter injection
    const sanitized = searchTerm.replace(/[,.()"\\]/g, '');
    dbQuery = dbQuery.or(
      `booking_number.ilike.%${sanitized}%,customer_name.ilike.%${sanitized}%,customer_phone.ilike.%${sanitized}%`
    );

    const { data, error } = await dbQuery;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] searchBookings error:', error.message);
    return { data: null, error };
  }
}

export async function getCustomerBookingHistory(customerAccountId) {
  try {
    if (!customerAccountId) {
      return { data: [], error: null };
    }

    const { data, error } = await supabaseCustomer
      .from('bookings')
      .select(`
        *,
        service:services(id, name, duration_minutes),
        therapist:therapists(id, name, gender),
        room:rooms(id, name),
        branch:branches(id, name)
      `)
      .eq('customer_account_id', customerAccountId)
      .order('date', { ascending: false });

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] getCustomerBookingHistory error:', error.message);
    return { data: null, error };
  }
}

export async function fetchBookingById(bookingId) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        service:services(id, name, duration_minutes, price_npr),
        therapist:therapists(id, name, gender),
        room:rooms(id, name),
        payments(amount, payment_mode, created_at),
        booking_therapists(therapist_id, start_time, end_time, therapist:therapists(id, name, gender))
      `)
      .eq('id', bookingId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBookingById error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 8.1: Calendar Read-Only Query
// ============================================================

export async function getCalendarBookings(branchId, startDate, endDate) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Fetch branch hours + timezone
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('open_time, close_time, timezone')
      .eq('id', resolvedBranchId)
      .single();

    if (branchError) throw branchError;

    // 2. Fetch therapists, rooms, and any staffers currently transferred OUT of this
    //    branch (they still show as a column here — booking creation is already
    //    blocked for them since their branch_id now points elsewhere — see migration-145).
    const [therapistsResult, roomsResult, transferredOutResult, transferredInResult] = await Promise.all([
      supabase
        .from('therapists')
        .select('id, name, gender, specialties, position, is_service_staff, display_order')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true)
        .order('display_order')
        .order('name'),
      supabase
        .from('rooms')
        .select('id, name, is_active, display_order, amenities, floor')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true)
        .order('display_order')
        .order('name'),
      // is_permanent = false: a Permanent transfer (migration-150) is a plain reassignment
      // with no revert — the staffer should just appear as a normal column at their new
      // branch, not as a "transferred out/visiting" overlay. revert_at IS NOT NULL additionally
      // excludes historical pre-migration-141 rows: `reverted`/`is_permanent` are both
      // NOT NULL DEFAULT false columns added later, so every legacy row backfills to
      // reverted=false/is_permanent=false and would otherwise match this filter forever,
      // showing a permanent phantom "transferred out"/"visiting" column for any staffer who
      // was ever moved under the old model — revert_at is the one column that's genuinely
      // NULL on those old rows (they never had a duration), so it's the reliable "this is a
      // real, still-active temporary window" signal.
      supabase
        .from('staff_transfers')
        .select('id, revert_at, effective_date, start_time, from_display_order, therapist:therapists!staff_transfers_therapist_id_fkey(id, name, gender, specialties, position, is_service_staff, display_order)')
        .eq('from_branch_id', resolvedBranchId)
        .eq('applied', true)
        .eq('reverted', false)
        .eq('is_permanent', false)
        .not('revert_at', 'is', null),
      // Staffers currently visiting THIS branch on a temporary transfer — they already
      // appear normally in therapistsResult above (branch_id points here); this tags them
      // with where they're from + their actual visiting window, so the calendar can block
      // everything OUTSIDE that window (they're only really here for that slice of time).
      supabase
        .from('staff_transfers')
        .select('therapist_id, revert_at, effective_date, start_time, fromBranch:branches!staff_transfers_from_branch_id_fkey(name)')
        .eq('to_branch_id', resolvedBranchId)
        .eq('applied', true)
        .eq('reverted', false)
        .eq('is_permanent', false)
        .not('revert_at', 'is', null),
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (roomsResult.error) throw roomsResult.error;
    if (transferredOutResult.error) throw transferredOutResult.error;
    if (transferredInResult.error) throw transferredInResult.error;

    const activeTherapistIds = new Set((therapistsResult.data || []).map(t => t.id));
    const transferredOutTherapists = (transferredOutResult.data || [])
      .filter(t => t.therapist && !activeTherapistIds.has(t.therapist.id))
      .map(t => ({
        ...t.therapist,
        // therapist.display_order now reflects their DESTINATION branch's ordering
        // (overwritten the moment the transfer applied) — from_display_order is the
        // position they held HERE, captured before that overwrite (migration-149).
        // Falling back to the live value only if that capture is missing (legacy rows).
        display_order: t.from_display_order ?? t.therapist.display_order,
        transferredOut: true,
        returnsAt: t.revert_at,
        // Kathmandu wall-clock instant the transfer actually took effect — lets the
        // calendar shade only the real [start, revert_at] window, not the whole day.
        transferStartAt: t.effective_date && t.start_time ? `${t.effective_date}T${t.start_time}+05:45` : null,
      }));

    const transferredInById = {};
    (transferredInResult.data || []).forEach(t => {
      transferredInById[t.therapist_id] = {
        fromBranch: t.fromBranch?.name || null,
        returnsAt: t.revert_at,
        transferStartAt: t.effective_date && t.start_time ? `${t.effective_date}T${t.start_time}+05:45` : null,
      };
    });

    const normalTherapists = (therapistsResult.data || []).map(t =>
      transferredInById[t.id] ? { ...t, transferredIn: true, ...transferredInById[t.id] } : t
    );

    // Slot the transferred-out column back into its ORIGINAL position among the branch's
    // normal columns (by the preserved origin display_order, then name) instead of always
    // appending it at the end.
    const mergedTherapists = [...normalTherapists, ...transferredOutTherapists]
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));

    // 3. Fetch bookings in date range, excluding Cancelled and No Show
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, customer_phone, status, payment_status,
        date, start_time, end_time, start_datetime, end_datetime, created_at,
        therapist_id, room_id,
        base_amount, discount_amount, final_amount, special_requests,
        service:services(name, duration_minutes),
        therapist:therapists(id, name),
        room:rooms(id, name),
        creator:users!created_by(full_name),
        booking_therapists(therapist_id, start_time, end_time, therapist:therapists(id, name)),
        payments(amount)
      `)
      .eq('branch_id', resolvedBranchId)
      .gte('date', startDate)
      .lte('date', endDate)
      .not('status', 'in', '("Cancelled","No Show")')
      .order('start_time');

    if (bookingsError) throw bookingsError;

    return {
      data: {
        branchHours: {
          openTime: branch.open_time || '09:00:00',
          closeTime: branch.close_time || '21:00:00',
          timezone: branch.timezone || 'Asia/Kathmandu',
        },
        therapists: mergedTherapists,
        rooms: roomsResult.data || [],
        bookings: bookings || [],
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getCalendarBookings error:', error.message);
    return { data: null, error };
  }
}

export async function createBooking({
  branchId,
  serviceId,
  date,
  startTime,
  customerName,
  customerEmail,
  customerPhone,
  customerGender,
  specialRequests,
  therapistId,
  therapistIds,
  roomId,
  bookingGroupId,
  referringCustomerId,
  referringRewardType,
  referringRewardAmount,
  referringRewardCatalogId,
  orgSlug,
  referralSource,
  referralSourceDetail,
  customerAccountId,
}) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Fetch service for duration + price
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr')
      .eq('id', serviceId)
      .single();

    if (serviceError) throw serviceError;

    // 2. Compute end time for overlap check
    const endTime = addMinutesToTime(startTime, service.duration_minutes);

    // 2b. Check if this industry requires rooms
    const { data: branchData, error: branchError } = await supabase
      .from('branches')
      .select('org_id, organizations(industry_type)')
      .eq('id', resolvedBranchId)
      .single();

    if (branchError) throw branchError;

    const industryType = branchData?.organizations?.industry_type;
    let enableRooms = true; // default to requiring rooms

    if (industryType) {
      const { data: industryData } = await supabase
        .from('industries')
        .select('enable_rooms')
        .eq('id', industryType)
        .single();
      enableRooms = industryData?.enable_rooms !== false;
    }

    // Room handling - only required for industries that use rooms
    let availableRoom = null;

    if (enableRooms) {
      if (roomId === 'none') {
        // Explicitly no room selected — skip auto-assignment
        availableRoom = null;
      } else if (roomId) {
        // Room explicitly selected — verify it belongs to this branch and is active
        const { data: selectedRoom, error: roomLookupError } = await supabase
          .from('rooms')
          .select('id, name, is_active, capacity')
          .eq('id', roomId)
          .eq('branch_id', resolvedBranchId)
          .maybeSingle();
        if (roomLookupError) throw roomLookupError;
        if (!selectedRoom) {
          return { data: null, error: { code: 'INVALID_ROOM', message: 'Selected room is not available in this branch.' } };
        }
        if (!selectedRoom.is_active) {
          return { data: null, error: { code: 'ROOM_INACTIVE', message: 'Selected room is not active.' } };
        }

        // Check room capacity — count overlapping bookings
        const capacity = getRoomCapacity(selectedRoom);
        const { data: roomOverlaps } = await supabase
          .from('bookings')
          .select('id')
          .eq('room_id', roomId)
          .eq('branch_id', resolvedBranchId)
          .eq('date', date)
          .not('status', 'in', '("Cancelled","No Show")')
          .lt('start_time', endTime)
          .gt('end_time', startTime);

        if ((roomOverlaps || []).length >= capacity) {
          return { data: null, error: { code: 'ROOM_FULL', message: `${selectedRoom.name} is fully booked at this time (capacity: ${capacity}).` } };
        }

        availableRoom = selectedRoom;
      } else {
        // 3. Fetch active rooms for branch (with capacity)
        const { data: rooms, error: roomsError } = await supabase
          .from('rooms')
          .select('id, name, capacity')
          .eq('branch_id', resolvedBranchId)
          .eq('is_active', true)
          .order('name');

        if (roomsError) throw roomsError;
        if (!rooms || rooms.length === 0) {
          return { data: null, error: { code: 'ROOMS_FULL', message: 'No rooms available at this branch.' } };
        }

        // 4. Count overlapping bookings per room
        const { data: overlapping, error: overlapError } = await supabase
          .from('bookings')
          .select('room_id')
          .eq('branch_id', resolvedBranchId)
          .eq('date', date)
          .not('status', 'in', '("Cancelled","No Show")')
          .lt('start_time', endTime)
          .gt('end_time', startTime);

        if (overlapError) throw overlapError;

        // 5. Count bookings per room and pick first with remaining capacity
        const roomBookingCounts = {};
        (overlapping || []).forEach(b => {
          roomBookingCounts[b.room_id] = (roomBookingCounts[b.room_id] || 0) + 1;
        });
        availableRoom = rooms.find(r => {
          const capacity = getRoomCapacity(r);
          const used = roomBookingCounts[r.id] || 0;
          return used < capacity;
        });

        if (!availableRoom) {
          return { data: null, error: { code: 'ROOMS_FULL', message: 'Selected time slot is fully booked.' } };
        }
      }
    }
    // End of room handling - industries without rooms skip the above block

    // 6. Look up or create customer record for CRM linking.
    // Identity is org-wide (org_id + normalized phone), so a returning customer first
    // seen at another branch links to their single profile instead of duplicating.
    let customerId = null;
    let isNewCustomer = false;
    const orgId = branchData?.org_id || null;
    try {
      // Canonical E.164 ("+<countrycode><national>") so the same number always
      // resolves to the same customer regardless of how it was typed, and two
      // different countries' numbers never collide. See src/utils/phone.js.
      const phone = toE164(customerPhone);
      const email = customerEmail?.trim().toLowerCase() || null;

      // Try to find existing customer by phone or email across the whole org.
      // Goes through the find_customer_for_booking RPC (not a direct table SELECT) —
      // anon has no raw SELECT grant on customers, see migration-072.
      let existingCustomer = null;
      if (orgId && (phone || email)) {
        const { data } = await supabase
          .rpc('find_customer_for_booking', { p_org_id: orgId, p_phone: phone, p_email: email })
          .maybeSingle();
        existingCustomer = data;
      }

      if (existingCustomer) {
        customerId = existingCustomer.id;
        // Update name if changed. Backfill gender onto the profile only when it's
        // not already set — a booking-time pick shouldn't clobber a previously
        // confirmed value (e.g. from membership enrollment).
        await supabase
          .from('customers')
          .update({
            full_name: customerName,
            phone: phone || undefined,
            email: email || undefined,
            gender: (!existingCustomer.gender && customerGender) ? customerGender : undefined,
          })
          .eq('id', customerId);
      } else {
        // Create new customer record (org-wide identity; branch_id kept as origin)
        const { data: newCustomer, error: insertCustErr } = await supabase
          .from('customers')
          .insert({
            org_id: orgId,
            branch_id: resolvedBranchId,
            full_name: customerName,
            phone: phone || null,
            email: email || null,
            gender: customerGender || null,
          })
          .select('id')
          .single();
        if (newCustomer) {
          customerId = newCustomer.id;
          isNewCustomer = true;
        } else if (insertCustErr?.code === '23505' && orgId && phone) {
          // Lost a race against customers_org_nphone_uniq — re-fetch the winner
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('org_id', orgId)
            .eq('phone', phone)
            .limit(1)
            .maybeSingle();
          if (data) customerId = data.id;
        }
      }
    } catch (custErr) {
      // Non-blocking: booking still proceeds without customer link
      console.warn('[API] Customer lookup/create failed:', custErr.message);
    }

    // 7a. Resolve therapist IDs (support both single and multi)
    const allTherapistIds = therapistIds
      ? (Array.isArray(therapistIds) ? therapistIds.filter(Boolean) : [therapistIds])
      : (therapistId ? [therapistId] : []);
    const primaryTherapistId = allTherapistIds[0] || null;

    let therapistNameSnapshot = null;
    if (allTherapistIds.length > 0) {
      const { data: therapistsData, error: therapistLookupError } = await supabase
        .from('therapists')
        .select('id, name, is_active')
        .in('id', allTherapistIds)
        .eq('branch_id', resolvedBranchId);
      if (therapistLookupError) throw therapistLookupError;

      if (!therapistsData || therapistsData.length !== allTherapistIds.length) {
        return { data: null, error: { code: 'INVALID_THERAPIST', message: 'One or more selected therapists are not available in this branch.' } };
      }
      const inactive = therapistsData.find(t => !t.is_active);
      if (inactive) {
        return { data: null, error: { code: 'THERAPIST_INACTIVE', message: `Therapist ${inactive.name} is not active.` } };
      }

      if (date) {
        const { data: absentRecords } = await supabase
          .from('therapist_attendance')
          .select('therapist_id, status')
          .in('therapist_id', allTherapistIds)
          .eq('date', date)
          .in('status', ['Absent', ...LEAVE_LIKE_ATTENDANCE_STATUSES]);
        const absent = (absentRecords || []).find(Boolean);
        if (absent) {
          const absentTherapist = therapistsData.find(t => t.id === absent.therapist_id);
          return { data: null, error: { code: 'THERAPIST_ABSENT', message: `${absentTherapist?.name || 'Therapist'} is marked as ${absent.status} on this date.` } };
        }
      }

      const primary = therapistsData.find(t => t.id === primaryTherapistId);
      therapistNameSnapshot = primary?.name || null;
    }

    // 7. Insert booking — triggers compute end_time, datetimes, final_amount, booking_number
    // Capture who created it (null for anonymous customer self-booking).
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { data: booking, error: insertError } = await supabase
      .from('bookings')
      .insert({
        branch_id: resolvedBranchId,
        room_id: availableRoom?.id || null,
        service_id: serviceId,
        therapist_id: primaryTherapistId,
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail || null,
        customer_phone: toE164(customerPhone),
        customer_gender: customerGender || null,
        customer_account_id: customerAccountId || null,
        date: date,
        start_time: startTime,
        base_amount: Number(service.price_npr),
        discount_amount: 0,
        special_requests: specialRequests || null,
        created_by: authUser?.id || null,
        booking_group_id: bookingGroupId || null,
        referral_source: referralSource || null,
        referral_source_detail: referralSourceDetail || null,
        // Phase 9A: Snapshot fields — preserve original values at booking time
        service_name_snapshot: service.name,
        service_duration_snapshot: service.duration_minutes,
        service_price_snapshot: Number(service.price_npr),
        room_name_snapshot: availableRoom?.name || null,
        therapist_name_snapshot: therapistNameSnapshot,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: 'One or more selected therapists are already booked during this time slot.' } };
      }
      if (insertError.code === 'P0003') {
        return { data: null, error: { code: 'ROOMS_FULL', message: 'Scheduling conflict. Please try a different time or room.' } };
      }
      if (insertError.code === 'P0005') {
        return { data: null, error: { code: 'BRANCH_ONLINE_CAPACITY', message: 'This time is fully booked — no therapists available. Please choose another time.' } };
      }
      throw insertError;
    }

    // 7a2. Log customer-to-customer referral, if staff supplied one for a genuinely
    // new customer. Non-blocking — a referral logging failure must not fail the booking.
    // Reward is NOT credited here; it's credited later when this booking is marked
    // Completed (see updateBookingStatus).
    if (isNewCustomer && referringCustomerId && customerId) {
      try {
        if (orgSlug) {
          // Public/customer-facing booking — unauthenticated, so this goes through the
          // anon-safe RPC (wallet reward only, no gift-card/voucher/catalog choice).
          const { error: referralError } = await supabase.rpc('public_record_customer_referral', {
            p_org_slug: orgSlug,
            p_referring_customer_id: referringCustomerId,
            p_referred_customer_id: customerId,
            p_booking_id: booking.id,
          });
          if (referralError) console.warn('[API] public_record_customer_referral failed:', referralError.message);
        } else {
          const { error: referralError } = await supabase.rpc('record_customer_referral', {
            p_referring_customer_id: referringCustomerId,
            p_referred_customer_id: customerId,
            p_booking_id: booking.id,
            p_reward_type: referringRewardType || 'wallet',
            p_reward_amount: referringRewardAmount ?? null,
            p_reward_catalog_id: referringRewardCatalogId || null,
          });
          if (referralError) console.warn('[API] record_customer_referral failed:', referralError.message);
        }
      } catch (referralErr) {
        console.warn('[API] record_customer_referral failed:', referralErr.message);
      }
    }

    // 7b. Insert into junction table for all therapists
    if (allTherapistIds.length > 0) {
      const rows = allTherapistIds.map(tid => ({
        booking_id: booking.id,
        therapist_id: tid,
        start_time: booking.start_time,
        end_time: booking.end_time,
      }));
      const { error: btError } = await supabase.from('booking_therapists').insert(rows);
      if (btError) console.warn('[API] booking_therapists insert error:', btError.message);
    }

    capture('staff_booking_created', {
      service_id: serviceId,
      branch_id: booking.branch_id,
      final_amount: Number(booking.final_amount),
    });
    return { data: booking, error: null };
  } catch (error) {
    console.error('[API] createBooking error:', error.message);
    return { data: null, error };
  }
}

// Public/customer-facing referral lookup — exact phone match, scoped to the org by
// slug, returns a masked display name (e.g. "Sita K."). Used by the public booking
// flow's "Referred by a friend?" field before calling createBooking().
export async function lookupReferrerByPhone(orgSlug, phone, countryCode = '+977') {
  try {
    const normalizedPhone = toE164(phone, countryCode);
    if (!orgSlug || !normalizedPhone) return { data: null, error: null };

    const { data, error } = await supabase
      .rpc('public_lookup_referrer_by_phone', { p_org_slug: orgSlug, p_phone: normalizedPhone })
      .maybeSingle();

    if (error) throw error;
    return { data: data || null, error: null };
  } catch (error) {
    console.error('[API] lookupReferrerByPhone error:', error.message);
    return { data: null, error };
  }
}

// Public/customer-facing "is this phone already a customer?" check (migration-073) —
// purely informational, boolean only, no id/name returned. Used so the public booking
// form can show a live "looks like you're already a customer" notice while the person
// types their phone, since a referral for an existing customer gets silently skipped
// by createBooking()'s isNewCustomer check further down the flow. Does NOT change that
// eligibility logic — this is a separate, read-only signal.
export async function checkExistingCustomerByPhone(orgSlug, phone, countryCode = '+977') {
  try {
    const normalizedPhone = toE164(phone, countryCode);
    if (!orgSlug || !normalizedPhone || normalizedPhone.length < 11) return { data: false, error: null };

    const { data, error } = await supabase
      .rpc('public_check_customer_exists', { p_org_slug: orgSlug, p_phone: normalizedPhone });

    if (error) throw error;
    return { data: !!data, error: null };
  } catch (error) {
    console.error('[API] checkExistingCustomerByPhone error:', error.message);
    return { data: false, error };
  }
}

// Surfaces the actual matching customer (not just a boolean) so the public flow can offer
// "use your saved details?" — gated server-side to only match when the visitor-provided name
// also matches, to avoid a PII-enumeration surface on this anon-accessible RPC.
export async function findCustomerMatch(orgSlug, name, phone, email, countryCode = '+977') {
  try {
    const normalizedPhone = phone ? toE164(phone, countryCode) : null;
    const trimmedName = (name || '').trim();
    const trimmedEmail = (email || '').trim();
    if (!orgSlug || !trimmedName || (!normalizedPhone && !trimmedEmail)) {
      return { data: null, error: null };
    }

    const { data, error } = await supabase.rpc('public_find_customer_match', {
      p_org_slug: orgSlug,
      p_name: trimmedName,
      p_phone: normalizedPhone,
      p_email: trimmedEmail || null,
    });

    if (error) throw error;
    return { data: data?.[0] || null, error: null };
  } catch (error) {
    console.error('[API] findCustomerMatch error:', error.message);
    return { data: null, error };
  }
}

// Manager/admin explicitly picks Wallet or Voucher for a pending Client referral
// (customer-facing "how were you referred" flow) and credits it immediately.
// Used by BookingActionModal.jsx's referral reward picker.
export async function resolveCustomerReferralReward({ referralId, rewardType, rewardAmount, rewardCatalogId }) {
  try {
    const { data, error } = await supabase.rpc('resolve_customer_referral_reward', {
      p_referral_id: referralId,
      p_reward_type: rewardType,
      p_reward_amount: rewardAmount ?? null,
      p_reward_catalog_id: rewardCatalogId || null,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] resolveCustomerReferralReward error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 9B: Master Data Management — Room CRUD
// ============================================================

export async function fetchRoomsForManagement(branchId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const { data, error } = await supabase
      .from('rooms')
      .select('id, name, branch_id, is_active, amenities, floor, capacity, created_at')
      .eq('branch_id', effectiveBranchId)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchRoomsForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function createRoom({ name, branchId, amenities = [], floor = null, capacity = 1 }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    // Check for duplicate name within branch
    const { data: existing } = await supabase
      .from('rooms')
      .select('id')
      .eq('branch_id', effectiveBranchId)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A room with this name already exists in this branch.' } };
    }

    const { data, error } = await supabase
      .from('rooms')
      .insert({ name: name.trim(), branch_id: effectiveBranchId, is_active: true, amenities: amenities || [], floor: floor || null, capacity: capacity || 1 })
      .select('id, name, branch_id, is_active, amenities, floor, capacity, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createRoom error:', error.message);
    return { data: null, error };
  }
}

export async function updateRoom({ roomId, name, amenities, floor, capacity }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Fetch room to get branch_id for duplicate check
    const { data: room, error: fetchError } = await supabase
      .from('rooms')
      .select('id, branch_id')
      .eq('id', roomId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Room not found.' } };
      }
      throw fetchError;
    }

    // Manager can only update own branch
    if (profile.role === 'manager' && room.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Cannot manage rooms outside your branch.' } };
    }

    // Check for duplicate name within branch (excluding this room)
    const { data: existing } = await supabase
      .from('rooms')
      .select('id')
      .eq('branch_id', room.branch_id)
      .ilike('name', name.trim())
      .neq('id', roomId)
      .maybeSingle();

    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A room with this name already exists in this branch.' } };
    }

    const updatePayload = { name: name.trim() };
    if (amenities !== undefined) updatePayload.amenities = amenities;
    if (floor !== undefined) updatePayload.floor = floor;
    if (capacity !== undefined) updatePayload.capacity = capacity;

    const { data, error } = await supabase
      .from('rooms')
      .update(updatePayload)
      .eq('id', roomId)
      .select('id, name, branch_id, is_active, amenities, floor, capacity, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateRoom error:', error.message);
    return { data: null, error };
  }
}

export async function toggleRoomActive({ roomId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Fetch room to verify branch ownership
    const { data: room, error: fetchError } = await supabase
      .from('rooms')
      .select('id, branch_id')
      .eq('id', roomId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Room not found.' } };
      }
      throw fetchError;
    }

    if (profile.role === 'manager' && room.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Cannot manage rooms outside your branch.' } };
    }

    const { data, error } = await supabase
      .from('rooms')
      .update({ is_active: isActive })
      .eq('id', roomId)
      .select('id, name, branch_id, is_active')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleRoomActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteRoom({ roomId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // Only manager and admin can delete rooms
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Fetch room to verify it exists and check branch ownership
    const { data: room, error: fetchError } = await supabase
      .from('rooms')
      .select('id, branch_id, name')
      .eq('id', roomId)
      .single();

    if (fetchError || !room) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Room not found.' } };
    }

    // Manager can only delete rooms in their own branch
    if (profile.role === 'manager' && room.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Cannot delete rooms outside your branch.' } };
    }

    // Check if room has any bookings (past or future)
    const { data: bookings, error: bookingError } = await supabase
      .from('bookings')
      .select('id')
      .eq('room_id', roomId)
      .limit(1);

    if (bookingError) throw bookingError;

    if (bookings && bookings.length > 0) {
      return {
        data: null,
        error: {
          code: 'HAS_BOOKINGS',
          message: 'This room has booking history and cannot be deleted. Deactivate it instead to hide from new bookings.'
        }
      };
    }

    // Safe to delete - no bookings exist
    const { error: deleteError } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId);

    if (deleteError) throw deleteError;

    return { data: { deleted: true, roomId, roomName: room.name }, error: null };
  } catch (error) {
    console.error('[API] deleteRoom error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 9B: Master Data Management — Therapist CRUD
// ============================================================

export async function fetchTherapistsForManagement(branchId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    let query = supabase
      .from('therapists')
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at, display_order')
      .order('display_order')
      .order('name');
    query = withBranch(query, effectiveBranchId);

    const { data, error } = await query;

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistsForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function createTherapist({ name, gender, specialties, position, isServiceStaff = true, branchId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    // Check for duplicate name within branch
    const { data: existing } = await supabase
      .from('therapists')
      .select('id')
      .eq('branch_id', effectiveBranchId)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A therapist with this name already exists in this branch.' } };
    }

    // Get max display_order for this branch to place new therapist at end
    const { data: maxRow } = await supabase
      .from('therapists')
      .select('display_order')
      .eq('branch_id', effectiveBranchId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = (maxRow?.display_order ?? 0) + 1;

    const { data, error } = await supabase
      .from('therapists')
      .insert({
        name: name.trim(),
        gender: gender || 'Male',
        specialties: specialties || [],
        position: position || null,
        is_service_staff: isServiceStaff,
        branch_id: effectiveBranchId,
        org_id: profile.org_id,
        is_active: true,
        display_order: nextOrder,
      })
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at, display_order')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createTherapist error:', error.message);
    return { data: null, error };
  }
}

export async function updateTherapist({ therapistId, name, gender, specialties, position, isServiceStaff }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Fetch therapist to get branch_id
    const { data: therapist, error: fetchError } = await supabase
      .from('therapists')
      .select('id, branch_id')
      .eq('id', therapistId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found.' } };
      }
      throw fetchError;
    }

    if (profile.role === 'manager' && therapist.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Cannot manage therapists outside your branch.' } };
    }

    // Check for duplicate name within branch (excluding this therapist)
    if (name) {
      const { data: existing } = await supabase
        .from('therapists')
        .select('id')
        .eq('branch_id', therapist.branch_id)
        .ilike('name', name.trim())
        .neq('id', therapistId)
        .maybeSingle();

      if (existing) {
        return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A therapist with this name already exists in this branch.' } };
      }
    }

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name.trim();
    if (gender !== undefined) updatePayload.gender = gender;
    if (specialties !== undefined) updatePayload.specialties = specialties;
    if (position !== undefined) updatePayload.position = position;
    if (isServiceStaff !== undefined) updatePayload.is_service_staff = isServiceStaff;

    const { data, error } = await supabase
      .from('therapists')
      .update(updatePayload)
      .eq('id', therapistId)
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateTherapist error:', error.message);
    return { data: null, error };
  }
}

export async function toggleTherapistActive({ therapistId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Fetch therapist to verify branch ownership
    const { data: therapist, error: fetchError } = await supabase
      .from('therapists')
      .select('id, branch_id')
      .eq('id', therapistId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found.' } };
      }
      throw fetchError;
    }

    if (profile.role === 'manager' && therapist.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Cannot manage therapists outside your branch.' } };
    }

    // If deactivating, check for future bookings
    if (!isActive) {
      const today = new Date().toISOString().split('T')[0];
      const { data: futureBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id')
        .eq('therapist_id', therapistId)
        .gte('date', today)
        .in('status', ['Pending', 'Confirmed', 'In-Progress'])
        .limit(1);

      if (bookingsError) throw bookingsError;

      if (futureBookings && futureBookings.length > 0) {
        return { data: null, error: { code: 'ACTIVE_BOOKINGS_EXIST', message: 'Cannot deactivate therapist with active future bookings. Cancel or reassign them first.' } };
      }
    }

    const { data, error } = await supabase
      .from('therapists')
      .update({ is_active: isActive })
      .eq('id', therapistId)
      .select('id, name, branch_id, is_active')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleTherapistActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteTherapist({ therapistId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // Only manager and admin can delete therapists
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Fetch therapist to verify it exists and check branch ownership
    const { data: therapist, error: fetchError } = await supabase
      .from('therapists')
      .select('id, branch_id, name')
      .eq('id', therapistId)
      .single();

    if (fetchError || !therapist) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found.' } };
    }

    // Manager can only delete therapists in their own branch
    if (profile.role === 'manager' && therapist.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Cannot delete therapists outside your branch.' } };
    }

    // Check if therapist has any bookings (past or future)
    const { data: bookings, error: bookingError } = await supabase
      .from('bookings')
      .select('id')
      .eq('therapist_id', therapistId)
      .limit(1);

    if (bookingError) throw bookingError;

    if (bookings && bookings.length > 0) {
      return {
        data: null,
        error: {
          code: 'HAS_BOOKINGS',
          message: 'This therapist has booking history and cannot be deleted. Deactivate instead to hide from new bookings.'
        }
      };
    }

    // Safe to delete - no bookings exist
    const { error: deleteError } = await supabase
      .from('therapists')
      .delete()
      .eq('id', therapistId);

    if (deleteError) throw deleteError;

    return { data: { deleted: true, therapistId, therapistName: therapist.name }, error: null };
  } catch (error) {
    console.error('[API] deleteTherapist error:', error.message);
    return { data: null, error };
  }
}

/**
 * Transfer a staffer to another branch in the same org, either Temporary (required
 * duration, auto-reverts) or Permanent (no duration, stays until transferred again).
 * Authorization + the audit row are enforced server-side by the SECURITY DEFINER
 * transfer_therapist() function (migration-039, required-duration form added in
 * migration-145, permanent option restored in migration-150): only an admin, or the
 * manager of the staffer's CURRENT branch, may transfer.
 */
export async function transferTherapist({
  therapistId,
  toBranchId,
  permanent = false,
  startTime = null,
  durationValue = null,
  durationUnit = null,
  note = null,
  effectiveDate = null,
}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('transfer_therapist', {
      p_therapist_id: therapistId,
      p_to_branch_id: toBranchId,
      p_start_time: permanent ? null : startTime,
      p_duration_value: permanent ? null : durationValue,
      p_duration_unit: permanent ? null : durationUnit,
      p_note: note,
      p_effective_date: effectiveDate,
      p_permanent: permanent,
    });

    if (error) throw error;
    capture('staff_transfer_scheduled', {
      therapist_id: therapistId,
      to_branch_id: toBranchId,
      effective_date: effectiveDate,
      permanent,
      duration_value: durationValue,
      duration_unit: durationUnit,
    });
    return { data: { transferId: data }, error: null };
  } catch (error) {
    console.error('[API] transferTherapist error:', error.message);
    return { data: null, error };
  }
}

// Org-wide staff transfer history. RLS scopes rows to the caller's org.
export async function fetchStaffTransfers() {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('staff_transfers')
      .select(`
        id, transferred_at, effective_date, applied, note,
        start_time, duration_value, duration_unit, revert_at, reverted, reverted_at, is_permanent,
        therapist:therapists!staff_transfers_therapist_id_fkey(name),
        fromBranch:branches!staff_transfers_from_branch_id_fkey(name),
        toBranch:branches!staff_transfers_to_branch_id_fkey(name),
        transferredBy:users!staff_transfers_transferred_by_fkey(full_name)
      `)
      .order('transferred_at', { ascending: false });

    if (error) throw error;

    const transfers = (data || []).map(t => ({
      id: t.id,
      transferredAt: t.transferred_at,
      effectiveDate: t.effective_date,
      applied: t.applied,
      note: t.note,
      startTime: t.start_time,
      durationValue: t.duration_value,
      durationUnit: t.duration_unit,
      revertAt: t.revert_at,
      isPermanent: t.is_permanent,
      reverted: t.reverted,
      revertedAt: t.reverted_at,
      therapistName: t.therapist?.name || '—',
      fromBranch: t.fromBranch?.name || '—',
      toBranch: t.toBranch?.name || '—',
      transferredBy: t.transferredBy?.full_name || 'System',
    }));

    return { data: transfers, error: null };
  } catch (error) {
    console.error('[API] fetchStaffTransfers error:', error.message);
    return { data: null, error };
  }
}

// Pending (scheduled, not-yet-applied) transfers. When branchId is given, returns
// only those moving a staffer OUT of that branch (the source branch's manager view).
export async function fetchPendingTransfers(branchId = null) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    let query = supabase
      .from('staff_transfers')
      .select(`
        id, transferred_at, effective_date, applied, note, therapist_id,
        start_time, duration_value, duration_unit, revert_at, reverted, reverted_at, is_permanent,
        therapist:therapists!staff_transfers_therapist_id_fkey(name),
        fromBranch:branches!staff_transfers_from_branch_id_fkey(name),
        toBranch:branches!staff_transfers_to_branch_id_fkey(name),
        transferredBy:users!staff_transfers_transferred_by_fkey(full_name)
      `)
      .eq('applied', false)
      .order('effective_date', { ascending: true });

    if (branchId && !isOverallBranch(branchId)) {
      query = query.eq('from_branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const transfers = (data || []).map(t => ({
      id: t.id,
      therapistId: t.therapist_id,
      transferredAt: t.transferred_at,
      effectiveDate: t.effective_date,
      applied: t.applied,
      note: t.note,
      startTime: t.start_time,
      durationValue: t.duration_value,
      durationUnit: t.duration_unit,
      revertAt: t.revert_at,
      isPermanent: t.is_permanent,
      reverted: t.reverted,
      revertedAt: t.reverted_at,
      therapistName: t.therapist?.name || '—',
      fromBranch: t.fromBranch?.name || '—',
      toBranch: t.toBranch?.name || '—',
      transferredBy: t.transferredBy?.full_name || 'System',
    }));

    return { data: transfers, error: null };
  } catch (error) {
    console.error('[API] fetchPendingTransfers error:', error.message);
    return { data: null, error };
  }
}

// Cancel a scheduled (not-yet-applied) transfer. Org/role checked server-side.
export async function cancelScheduledTransfer(transferId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('cancel_scheduled_transfer', {
      p_id: transferId,
    });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] cancelScheduledTransfer error:', error.message);
    return { data: null, error };
  }
}

/**
 * Push an ACTIVE (applied, not yet reverted) transfer's revert_at further out —
 * "Add Extra Time" — without creating a second transfer row. Only the destination
 * branch's manager (whoever currently has the staffer) or an admin may do this;
 * enforced server-side by extend_staff_transfer() (migration-146). Fails cleanly if
 * the transfer has already auto-reverted (race-safe — checked atomically server-side).
 */
export async function extendStaffTransfer({ transferId, additionalValue, additionalUnit }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('extend_staff_transfer', {
      p_transfer_id: transferId,
      p_additional_value: additionalValue,
      p_additional_unit: additionalUnit,
    });

    if (error) throw error;
    capture('staff_transfer_extended', { transfer_id: transferId, additional_value: additionalValue, additional_unit: additionalUnit });
    return { data: { revertAt: data }, error: null };
  } catch (error) {
    console.error('[API] extendStaffTransfer error:', error.message);
    return { data: null, error };
  }
}

/**
 * For each therapist currently AT branchId, the single most recent staff_transfers
 * row (either direction), used by the Attendance panel to decide what the Transfer
 * button should open: a blank create form, the ACTIVE transfer (destination's view,
 * offering "Add Extra Time"), or a just-COMPLETED summary (origin's view, offering
 * "Transfer Therapist Again").
 */
export async function fetchTherapistTransferStatus(branchId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('staff_transfers')
      .select(`
        id, therapist_id, from_branch_id, to_branch_id, transferred_at, effective_date,
        start_time, duration_value, duration_unit, revert_at, applied, reverted, reverted_at, is_permanent, note,
        fromBranch:branches!staff_transfers_from_branch_id_fkey(name),
        toBranch:branches!staff_transfers_to_branch_id_fkey(name)
      `)
      .or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
      .order('transferred_at', { ascending: false });

    if (error) throw error;

    // Keep only the latest row per therapist (data is already ordered newest-first).
    const map = {};
    (data || []).forEach(t => {
      if (map[t.therapist_id]) return;
      map[t.therapist_id] = {
        id: t.id,
        therapistId: t.therapist_id,
        fromBranchId: t.from_branch_id,
        toBranchId: t.to_branch_id,
        fromBranch: t.fromBranch?.name || '—',
        toBranch: t.toBranch?.name || '—',
        transferredAt: t.transferred_at,
        effectiveDate: t.effective_date,
        startTime: t.start_time,
        durationValue: t.duration_value,
        durationUnit: t.duration_unit,
        revertAt: t.revert_at,
        isPermanent: t.is_permanent,
        applied: t.applied,
        reverted: t.reverted,
        revertedAt: t.reverted_at,
        note: t.note,
      };
    });

    return { data: map, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistTransferStatus error:', error.message);
    return { data: null, error };
  }
}

export async function updateTherapistOrder({ branchId, orderedIds }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['staff', 'manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Staff + manager are pinned to their own branch; only admin can reorder any branch.
    const effectiveBranchId = profile.role === 'admin' ? branchId : profile.branch_id;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const updates = orderedIds.map((id, index) =>
      supabase
        .from('therapists')
        .update({ display_order: index + 1 })
        .eq('id', id)
        .eq('branch_id', effectiveBranchId)
    );

    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) throw failed.error;

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] updateTherapistOrder error:', error.message);
    return { data: null, error };
  }
}

export async function updateRoomOrder({ branchId, orderedIds }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['staff', 'manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    // Staff + manager are pinned to their own branch; only admin can reorder any branch.
    const effectiveBranchId = profile.role === 'admin' ? branchId : profile.branch_id;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const updates = orderedIds.map((id, index) =>
      supabase
        .from('rooms')
        .update({ display_order: index + 1 })
        .eq('id', id)
        .eq('branch_id', effectiveBranchId)
    );

    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) throw failed.error;

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] updateRoomOrder error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 9B: Master Data Management — Service CRUD (Admin Only)
// ============================================================

export async function fetchServicesForManagement() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage services.' } };
    }

    // Filter by user's organization for tenant isolation
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr, description, image_url, category, is_active, created_at')
      .eq('org_id', profile.org_id)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchServicesForManagement error:', error.message);
    return { data: null, error };
  }
}

/**
 * Upload a service image to Supabase Storage.
 * Returns the public URL of the uploaded image.
 */
export async function uploadServiceImage(file) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { url: null, error: authError };

    if (!['admin', 'manager'].includes(profile.role)) {
      return { url: null, error: { code: 'UNAUTHORIZED', message: 'Only admins and managers can upload service images.' } };
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { url: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 5MB.' } };
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    const filePath = `services/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('service-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('service-images')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[API] uploadServiceImage error:', error.message);
    return { url: null, error };
  }
}

export async function createService({ name, priceNpr, durationMinutes, description, imageUrl, category }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create services.' } };
    }

    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Service name is required.' } };
    }

    // Check for duplicate name within the same organization
    const { data: existing } = await supabase
      .from('services')
      .select('id')
      .eq('org_id', profile.org_id)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A service with this name already exists in your organization.' } };
    }

    const { data, error } = await supabase
      .from('services')
      .insert({
        name: name.trim(),
        price_npr: priceNpr,
        duration_minutes: durationMinutes,
        description: description || null,
        image_url: imageUrl || null,
        category: category || 'Spa',
        is_active: true,
        org_id: profile.org_id,
      })
      .select('id, name, duration_minutes, price_npr, description, image_url, category, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createService error:', error.message);
    return { data: null, error };
  }
}

export async function updateServicePricing({ serviceId, priceNpr, durationMinutes, description, imageUrl, category }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update service pricing.' } };
    }

    // Tenant isolation: ensure service belongs to user's org
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const updatePayload = {};
    if (priceNpr !== undefined) updatePayload.price_npr = priceNpr;
    if (durationMinutes !== undefined) updatePayload.duration_minutes = durationMinutes;
    if (description !== undefined) updatePayload.description = description;
    if (imageUrl !== undefined) updatePayload.image_url = imageUrl;
    if (category !== undefined) updatePayload.category = category;

    if (Object.keys(updatePayload).length === 0) {
      return { data: null, error: { code: 'NO_CHANGES', message: 'No fields to update.' } };
    }

    const { data, error } = await supabase
      .from('services')
      .update(updatePayload)
      .eq('id', serviceId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .select('id, name, duration_minutes, price_npr, description, image_url, category, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Service not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateServicePricing error:', error.message);
    return { data: null, error };
  }
}

export async function toggleServiceActive({ serviceId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage service status.' } };
    }

    // Tenant isolation: ensure user has org
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    // Verify service belongs to user's org before proceeding
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id')
      .eq('id', serviceId)
      .eq('org_id', profile.org_id)
      .single();

    if (serviceError || !service) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Service not found.' } };
    }

    // If deactivating, check for future bookings (within this org's branches)
    if (!isActive) {
      const today = new Date().toISOString().split('T')[0];
      const { data: futureBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, branches!inner(org_id)')
        .eq('service_id', serviceId)
        .eq('branches.org_id', profile.org_id)
        .gte('date', today)
        .in('status', ['Pending', 'Confirmed', 'In-Progress'])
        .limit(1);

      if (bookingsError) throw bookingsError;

      if (futureBookings && futureBookings.length > 0) {
        return { data: null, error: { code: 'ACTIVE_BOOKINGS_EXIST', message: 'Cannot deactivate service with active future bookings. Cancel or complete them first.' } };
      }
    }

    const { data, error } = await supabase
      .from('services')
      .update({ is_active: isActive })
      .eq('id', serviceId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .select('id, name, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Service not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleServiceActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteService({ serviceId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // Manager + admin can delete services. Services are org-global, not branch-scoped,
    // so any manager's delete affects every branch in the org. Bookings check below still applies.
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete services.' } };
    }

    // Tenant isolation: ensure user has org
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    // Fetch service to verify it exists AND belongs to user's org
    const { data: service, error: fetchError } = await supabase
      .from('services')
      .select('id, name')
      .eq('id', serviceId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .single();

    if (fetchError || !service) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Service not found.' } };
    }

    // Check if service has any bookings within this org's branches
    const { data: bookings, error: bookingError } = await supabase
      .from('bookings')
      .select('id, branches!inner(org_id)')
      .eq('service_id', serviceId)
      .eq('branches.org_id', profile.org_id)
      .limit(1);

    if (bookingError) throw bookingError;

    if (bookings && bookings.length > 0) {
      return {
        data: null,
        error: {
          code: 'HAS_BOOKINGS',
          message: 'This service has booking history and cannot be deleted. Deactivate instead to hide from new bookings.'
        }
      };
    }

    // Safe to delete - no bookings exist in this org
    const { error: deleteError } = await supabase
      .from('services')
      .delete()
      .eq('id', serviceId)
      .eq('org_id', profile.org_id);  // Tenant isolation filter

    if (deleteError) throw deleteError;

    return { data: { deleted: true, serviceId, serviceName: service.name }, error: null };
  } catch (error) {
    console.error('[API] deleteService error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Reward Catalog CRUD (migration-068) — gift card / voucher options
// for customer referral rewards. Org-scoped; read by any staff role
// (to populate the dropdown when logging a referral), write by
// manager + admin only (same posture as services, migration-049).
// ============================================================

// Active catalog items for a given reward type, for the booking-form dropdown.
// Any authenticated staff role can read — no role gate.
export async function fetchRewardCatalog({ rewardType }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('reward_catalog')
      .select('id, name, value')
      .eq('org_id', profile.org_id)
      .eq('reward_type', rewardType)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchRewardCatalog error:', error.message);
    return { data: null, error };
  }
}

export async function fetchRewardCatalogForManagement() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage the reward catalog.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('reward_catalog')
      .select('id, reward_type, name, value, is_active, created_at')
      .eq('org_id', profile.org_id)
      .order('reward_type')
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchRewardCatalogForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function createRewardCatalogItem({ rewardType, name, value }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can add reward catalog items.' } };
    }
    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Name is required.' } };
    }
    if (!['voucher'].includes(rewardType)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Invalid reward type.' } };
    }

    const { data: existing } = await supabase
      .from('reward_catalog')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('reward_type', rewardType)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A reward with this name already exists.' } };
    }

    const { data, error } = await supabase
      .from('reward_catalog')
      .insert({
        org_id: profile.org_id,
        reward_type: rewardType,
        name: name.trim(),
        value: value === '' || value == null ? null : Number(value),
        created_by: profile.id,
      })
      .select('id, reward_type, name, value, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createRewardCatalogItem error:', error.message);
    return { data: null, error };
  }
}

export async function updateRewardCatalogItem({ id, name, value }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can edit reward catalog items.' } };
    }
    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Name is required.' } };
    }

    const { data, error } = await supabase
      .from('reward_catalog')
      .update({ name: name.trim(), value: value === '' || value == null ? null : Number(value) })
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select('id, reward_type, name, value, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateRewardCatalogItem error:', error.message);
    return { data: null, error };
  }
}

export async function toggleRewardCatalogActive({ id, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update reward catalog items.' } };
    }

    const { data, error } = await supabase
      .from('reward_catalog')
      .update({ is_active: isActive })
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select('id, reward_type, name, value, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleRewardCatalogActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteRewardCatalogItem({ id }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete reward catalog items.' } };
    }

    const { error } = await supabase
      .from('reward_catalog')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id);

    if (error) throw error;
    return { data: { deleted: true, id }, error: null };
  } catch (error) {
    console.error('[API] deleteRewardCatalogItem error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 9D: Branch Context — Admin Branch Switching
// ============================================================

// ============================================================
// Phase 10A: Audit Log Viewer (Read-Only Governance)
// ============================================================

export async function fetchAuditLogs({
  branchId,
  tableName,
  recordId,
  fromDate,
  toDate,
  limit = 50,
  offset = 0,
} = {}) {
  try {
    // 1. Auth + role check
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, count: 0, error: authError };

    if (profile.role === 'staff') {
      return { data: null, count: 0, error: { code: 'UNAUTHORIZED', message: 'Staff cannot access audit logs.' } };
    }

    // 2. Branch enforcement — manager locked to own branch
    const effectiveBranchId = profile.role === 'manager'
      ? profile.branch_id
      : branchId;

    // 3. Build query
    let query = supabase
      .from('audit_logs')
      .select('id, branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, changed_at', { count: 'exact' });

    // Branch filter (manager always scoped; admin optional; skipped in Overall view)
    if (effectiveBranchId && !isOverallBranch(effectiveBranchId)) {
      query = query.eq('branch_id', effectiveBranchId);
    }

    // Optional filters
    if (tableName) {
      query = query.eq('table_name', tableName);
    }
    if (recordId) {
      query = query.eq('record_id', recordId);
    }
    if (fromDate) {
      query = query.gte('changed_at', `${fromDate}T00:00:00`);
    }
    if (toDate) {
      query = query.lte('changed_at', `${toDate}T23:59:59`);
    }

    // Ordering + pagination
    query = query.order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    // 4. Resolve changed_by UUIDs to full_name
    const uniqueUserIds = [...new Set((data || []).map(r => r.changed_by).filter(Boolean))];
    let userNameMap = {};

    if (uniqueUserIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', uniqueUserIds);

      for (const u of (users || [])) {
        userNameMap[u.id] = u.full_name;
      }
    }

    // 5. Attach changed_by_name to each log entry
    const enrichedData = (data || []).map(row => ({
      ...row,
      changed_by_name: userNameMap[row.changed_by] || (row.changed_by ? 'Unknown' : 'System'),
    }));

    return { data: enrichedData, count: count || 0, error: null };
  } catch (error) {
    console.error('[API] fetchAuditLogs error:', error.message);
    return { data: null, count: 0, error };
  }
}

// ============================================================
// Phase 10E: Customer Intelligence (Read-Only)
// ============================================================

export async function fetchCustomers(branchId) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Fetch customers for this branch
    const { data: customers, error: custError } = await supabase
      .from('customers')
      .select('id, full_name, phone, email, is_active, created_at')
      .eq('branch_id', resolvedBranchId)
      .order('full_name');

    if (custError) throw custError;

    if (!customers || customers.length === 0) {
      return { data: [], error: null };
    }

    // 2. Fetch all bookings for this branch that have a customer_id (single query)
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('customer_id, status, payment_status, final_amount, date')
      .eq('branch_id', resolvedBranchId)
      .not('customer_id', 'is', null);

    if (bookingsError) throw bookingsError;

    // 3. Aggregate in memory by customer_id
    const statsMap = {};
    for (const b of (bookings || [])) {
      if (!statsMap[b.customer_id]) {
        statsMap[b.customer_id] = {
          totalVisits: 0,
          completedVisits: 0,
          totalRevenue: 0,
          lastVisitDate: null,
          unpaidCount: 0,
        };
      }
      const s = statsMap[b.customer_id];
      s.totalVisits++;

      if (b.status === 'Completed') {
        s.completedVisits++;
      }

      if (b.payment_status === 'paid') {
        s.totalRevenue += Number(b.final_amount);
      }

      if (b.payment_status === 'unpaid' && ['Confirmed', 'Completed'].includes(b.status)) {
        s.unpaidCount++;
      }

      if (!s.lastVisitDate || b.date > s.lastVisitDate) {
        s.lastVisitDate = b.date;
      }
    }

    // 4. Merge stats into customer objects
    const enriched = customers.map(c => ({
      ...c,
      totalVisits: statsMap[c.id]?.totalVisits || 0,
      completedVisits: statsMap[c.id]?.completedVisits || 0,
      totalRevenue: statsMap[c.id]?.totalRevenue || 0,
      lastVisitDate: statsMap[c.id]?.lastVisitDate || null,
      unpaidCount: statsMap[c.id]?.unpaidCount || 0,
    }));

    return { data: enriched, error: null };
  } catch (error) {
    console.error('[API] fetchCustomers error:', error.message);
    return { data: null, error };
  }
}

// Potential-duplicates review (migration-135). Dynamic — re-queries current
// phone-collision groups every call, excluding pairs already dismissed as "not a duplicate".
export async function fetchDuplicateCandidates(orgId) {
  try {
    if (!orgId) return { data: null, error: { code: 'ORG_REQUIRED', message: 'Org ID is required.' } };
    const { data, error } = await supabase.rpc('customer_duplicate_candidates', { p_org_id: orgId });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchDuplicateCandidates error:', error.message);
    return { data: null, error };
  }
}

// Irreversible: repoints every FK table onto the canonical row and deletes the duplicate.
// Manager/admin only — enforced inside the RPC itself, not just RLS.
export async function mergeCustomers(canonicalId, duplicateId) {
  try {
    const { error } = await supabase.rpc('merge_customers', {
      p_canonical_id: canonicalId,
      p_duplicate_id: duplicateId,
    });
    if (error) throw error;
    return { data: true, error: null };
  } catch (error) {
    console.error('[API] mergeCustomers error:', error.message);
    return { data: null, error };
  }
}

export async function dismissDuplicateCandidate(orgId, customerIdA, customerIdB) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('customer_duplicate_dismissals')
      .insert({ org_id: orgId, customer_id_a: customerIdA, customer_id_b: customerIdB, dismissed_by: user?.id || null });
    if (error) throw error;
    return { data: true, error: null };
  } catch (error) {
    console.error('[API] dismissDuplicateCandidate error:', error.message);
    return { data: null, error };
  }
}

export async function fetchCustomersLightweight(branchId) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const resolvedBranchId = resolveBranchId(branchId);

    // Resolve the branch's org so autocomplete suggests the whole org's customers
    // (a returning cross-branch customer appears instead of being invisible).
    const { data: branch, error: branchErr } = await supabase
      .from('branches')
      .select('org_id')
      .eq('id', resolvedBranchId)
      .single();
    if (branchErr) throw branchErr;

    const [{ data, error }, statusRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, full_name, phone, email, gender')
        .eq('org_id', branch.org_id)
        .eq('is_active', true)
        .order('full_name'),
      MEMBERSHIP_ENABLED ? fetchMembershipStatus() : Promise.resolve({ data: [] }),
    ]);

    if (error) throw error;

    // Attach a `primaryMembership` to each customer via the staff-safe status
    // RPC (migration-087) — status/tier only, no balance, and readable
    // regardless of role (unlike an embedded `memberships` relation, which
    // RLS silently empties out for staff). Drives the membership badge in the
    // booking-creation customer autocomplete AND the "already a member" /
    // "renew instead" hint in the Enroll Member modal -- depleted/lapsed
    // cards are surfaced too (not filtered out) so staff sees a returning
    // member's ended card instead of it looking like they've never had one.
    const statusByCustomer = new Map((statusRes.data || []).map((r) => [r.customerId, r]));
    const enriched = (data || []).map((c) => {
      const s = statusByCustomer.get(c.id);
      return {
        id: c.id,
        full_name: c.full_name,
        phone: c.phone,
        email: c.email,
        gender: c.gender,
        primaryMembership: s
          ? { id: s.membershipId, status: s.status, tierName: s.tierName, membershipNumber: s.membershipNumber }
          : null,
      };
    });

    return { data: enriched, error: null };
  } catch (error) {
    console.error('[API] fetchCustomersLightweight error:', error.message);
    return { data: null, error };
  }
}

export async function fetchCustomerProfile(customerId) {
  try {
    if (!customerId) {
      return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };
    }

    // 1. Fetch customer record
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .select('id, branch_id, full_name, phone, email, notes, is_active, created_at')
      .eq('id', customerId)
      .single();

    if (custError) {
      if (custError.code === 'PGRST116') {
        return { data: null, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' } };
      }
      throw custError;
    }

    // 2. Fetch all bookings for this customer org-wide (history follows the person across
    //    branches — the merge repointed cross-branch bookings to this canonical id).
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        booking_number, date, status, payment_status,
        final_amount, discount_amount,
        service_name_snapshot, therapist_name_snapshot,
        is_locked
      `)
      .eq('customer_id', customerId)
      .order('date', { ascending: false });

    if (bookingsError) throw bookingsError;

    const all = bookings || [];

    // 3. Compute aggregates
    let totalVisits = all.length;
    let completedVisits = 0;
    let totalRevenue = 0;
    let totalDiscount = 0;
    let unpaidCount = 0;
    let lastVisitDate = null;
    const serviceCount = {};

    for (const b of all) {
      if (b.status === 'Completed') {
        completedVisits++;
      }

      if (b.payment_status === 'paid') {
        totalRevenue += Number(b.final_amount);
      }

      totalDiscount += Number(b.discount_amount);

      if (b.payment_status === 'unpaid' && ['Confirmed', 'Completed'].includes(b.status)) {
        unpaidCount++;
      }

      if (!lastVisitDate || b.date > lastVisitDate) {
        lastVisitDate = b.date;
      }

      // Most booked service
      const svc = b.service_name_snapshot || 'Unknown';
      serviceCount[svc] = (serviceCount[svc] || 0) + 1;
    }

    // avgSpend: safe divide
    const avgSpend = completedVisits > 0
      ? Math.round((totalRevenue / completedVisits) * 100) / 100
      : 0;

    // Most booked service
    let mostBookedService = null;
    let maxSvcCount = 0;
    for (const [svc, count] of Object.entries(serviceCount)) {
      if (count > maxSvcCount) {
        maxSvcCount = count;
        mostBookedService = svc;
      }
    }

    // 4. Loyalty classification (computed dynamically, never persisted)
    let loyaltyTier = 'Standard';

    if (completedVisits === 0) {
      loyaltyTier = 'New';
    } else if (completedVisits >= 8 && totalRevenue >= 25000) {
      loyaltyTier = 'VIP';
    } else if (completedVisits >= 4 && totalRevenue >= 10000) {
      loyaltyTier = 'Regular';
    } else if (completedVisits >= 1 && completedVisits <= 3) {
      loyaltyTier = 'Occasional';
    }

    // At Risk overrides Regular/Occasional (but not VIP or New)
    if (completedVisits >= 2 && lastVisitDate && loyaltyTier !== 'VIP' && loyaltyTier !== 'New') {
      const daysSinceLastVisit = Math.floor(
        (new Date().setHours(0, 0, 0, 0) - new Date(lastVisitDate).getTime()) / 86400000
      );
      if (daysSinceLastVisit > 60) {
        loyaltyTier = 'At Risk';
      }
    }

    // 5. Build history list
    const history = all.map(b => ({
      bookingNumber: b.booking_number,
      date: b.date,
      serviceName: b.service_name_snapshot || '—',
      therapistName: b.therapist_name_snapshot || 'Unassigned',
      finalAmount: Number(b.final_amount),
      discountAmount: Number(b.discount_amount),
      paymentStatus: b.payment_status,
      status: b.status,
      isLocked: b.is_locked,
    }));

    return {
      data: {
        customer: {
          id: customer.id,
          fullName: customer.full_name,
          phone: customer.phone,
          email: customer.email,
          notes: customer.notes,
          isActive: customer.is_active,
          createdAt: customer.created_at,
        },
        stats: {
          totalVisits,
          completedVisits,
          totalRevenue,
          totalDiscount,
          avgSpend,
          lastVisitDate,
          unpaidCount,
          mostBookedService,
          loyaltyTier,
        },
        history,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchCustomerProfile error:', error.message);
    return { data: null, error };
  }
}

export async function getCustomerIntelligence({ branchId }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    // 1. Parallel fetch: customers + bookings
    let custQuery = supabase
      .from('customers')
      .select('id, full_name, phone, email, is_active, created_at')
      .order('full_name');
    custQuery = withBranch(custQuery, branchId);
    let bookQuery = supabase
      .from('bookings')
      .select('customer_id, status, payment_status, final_amount, discount_amount, date, service_name_snapshot')
      .not('customer_id', 'is', null);
    bookQuery = withBranch(bookQuery, branchId);
    const [custResult, bookResult] = await Promise.all([
      custQuery,
      bookQuery,
    ]);

    if (custResult.error) throw custResult.error;
    if (bookResult.error) throw bookResult.error;

    const customers = custResult.data || [];
    const bookings = bookResult.data || [];

    if (customers.length === 0) {
      return {
        data: {
          summary: { totalCustomers: 0, vipCount: 0, regularCount: 0, occasionalCount: 0, atRiskCount: 0, newCount: 0 },
          customers: [],
        },
        error: null,
      };
    }

    // 2. Aggregate bookings by customer_id
    const statsMap = {};
    for (const b of bookings) {
      if (!statsMap[b.customer_id]) {
        statsMap[b.customer_id] = {
          totalVisits: 0,
          completedVisits: 0,
          totalRevenue: 0,
          totalDiscount: 0,
          unpaidCount: 0,
          lastVisitDate: null,
          serviceCount: {},
        };
      }
      const s = statsMap[b.customer_id];
      s.totalVisits++;

      if (b.status === 'Completed') s.completedVisits++;

      if (b.payment_status === 'paid') {
        s.totalRevenue += Number(b.final_amount);
      }

      s.totalDiscount += Number(b.discount_amount);

      if (b.payment_status === 'unpaid' && ['Confirmed', 'Completed'].includes(b.status)) {
        s.unpaidCount++;
      }

      if (!s.lastVisitDate || b.date > s.lastVisitDate) {
        s.lastVisitDate = b.date;
      }

      const svc = b.service_name_snapshot || 'Unknown';
      s.serviceCount[svc] = (s.serviceCount[svc] || 0) + 1;
    }

    // 3. Enrich each customer with stats + loyalty tier
    const today = new Date().setHours(0, 0, 0, 0);

    const enriched = customers.map(c => {
      const s = statsMap[c.id] || {
        totalVisits: 0, completedVisits: 0, totalRevenue: 0,
        totalDiscount: 0, unpaidCount: 0, lastVisitDate: null, serviceCount: {},
      };

      const avgSpend = s.completedVisits > 0
        ? Math.round((s.totalRevenue / s.completedVisits) * 100) / 100
        : 0;

      // Most booked service
      let mostBookedService = null;
      let maxSvcCount = 0;
      for (const [svc, count] of Object.entries(s.serviceCount)) {
        if (count > maxSvcCount) {
          maxSvcCount = count;
          mostBookedService = svc;
        }
      }

      // Loyalty classification (same logic as Step 2C)
      let loyaltyTier = 'Standard';
      if (s.completedVisits === 0) {
        loyaltyTier = 'New';
      } else if (s.completedVisits >= 8 && s.totalRevenue >= 25000) {
        loyaltyTier = 'VIP';
      } else if (s.completedVisits >= 4 && s.totalRevenue >= 10000) {
        loyaltyTier = 'Regular';
      } else if (s.completedVisits >= 1 && s.completedVisits <= 3) {
        loyaltyTier = 'Occasional';
      }

      if (s.completedVisits >= 2 && s.lastVisitDate && loyaltyTier !== 'VIP' && loyaltyTier !== 'New') {
        const daysSince = Math.floor((today - new Date(s.lastVisitDate).getTime()) / 86400000);
        if (daysSince > 60) {
          loyaltyTier = 'At Risk';
        }
      }

      return {
        id: c.id,
        fullName: c.full_name,
        phone: c.phone,
        email: c.email,
        isActive: c.is_active,
        createdAt: c.created_at,
        totalVisits: s.totalVisits,
        completedVisits: s.completedVisits,
        totalRevenue: s.totalRevenue,
        totalDiscount: s.totalDiscount,
        avgSpend,
        unpaidCount: s.unpaidCount,
        lastVisitDate: s.lastVisitDate,
        mostBookedService,
        loyaltyTier,
      };
    });

    // 4. Rank by totalRevenue DESC
    enriched.sort((a, b) => b.totalRevenue - a.totalRevenue);
    enriched.forEach((c, i) => { c.rankByRevenue = i + 1; });

    // 5. Summary
    let vipCount = 0, regularCount = 0, occasionalCount = 0, atRiskCount = 0, newCount = 0;
    for (const c of enriched) {
      if (c.loyaltyTier === 'VIP') vipCount++;
      else if (c.loyaltyTier === 'Regular') regularCount++;
      else if (c.loyaltyTier === 'Occasional') occasionalCount++;
      else if (c.loyaltyTier === 'At Risk') atRiskCount++;
      else if (c.loyaltyTier === 'New') newCount++;
    }

    return {
      data: {
        summary: {
          totalCustomers: enriched.length,
          vipCount,
          regularCount,
          occasionalCount,
          atRiskCount,
          newCount,
        },
        customers: enriched,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getCustomerIntelligence error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 10D-4: Risk Indicators (Read-Only)
// ============================================================

export async function getRiskIndicators({ branchId, date }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const today = date || new Date().toISOString().split('T')[0];

    // Date windows
    const sevenDaysAgo = new Date(new Date(today).getTime() - 7 * 86400000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(new Date(today).getTime() - 14 * 86400000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().split('T')[0];
    const sixtyDaysAgo = new Date(new Date(today).getTime() - 60 * 86400000).toISOString().split('T')[0];

    // 1. Unpaid risk: Confirmed/Completed + unpaid
    let unpaidQuery = supabase
      .from('bookings')
      .select('id, final_amount')
      .in('status', ['Confirmed', 'Completed'])
      .eq('payment_status', 'unpaid');
    unpaidQuery = withBranch(unpaidQuery, branchId);

    // 2. Last 7 days bookings (for cancellation/no-show rates)
    let last7dQuery = supabase
      .from('bookings')
      .select('id, status')
      .gte('date', sevenDaysAgo)
      .lte('date', today);
    last7dQuery = withBranch(last7dQuery, branchId);

    // 3. Previous 7 days (days 8-14 ago, for trend delta)
    let prev7dQuery = supabase
      .from('bookings')
      .select('id, status')
      .gte('date', fourteenDaysAgo)
      .lt('date', sevenDaysAgo);
    prev7dQuery = withBranch(prev7dQuery, branchId);

    // 4. Last 30 days bookings (for discount analysis)
    let last30dQuery = supabase
      .from('bookings')
      .select('id, base_amount, discount_amount, discount_approved_by')
      .gte('date', thirtyDaysAgo)
      .lte('date', today);
    last30dQuery = withBranch(last30dQuery, branchId);

    // 5. All completed bookings per customer (for retention risk)
    let allCustomerQuery = supabase
      .from('bookings')
      .select('customer_phone, date')
      .eq('status', 'Completed');
    allCustomerQuery = withBranch(allCustomerQuery, branchId);

    // Run all queries in parallel
    const [
      unpaidResult,
      last7dResult,
      prev7dResult,
      last30dResult,
      allCustomerResult,
    ] = await Promise.all([
      unpaidQuery,
      last7dQuery,
      prev7dQuery,
      last30dQuery,
      allCustomerQuery,
    ]);

    if (unpaidResult.error) throw unpaidResult.error;
    if (last7dResult.error) throw last7dResult.error;
    if (prev7dResult.error) throw prev7dResult.error;
    if (last30dResult.error) throw last30dResult.error;
    if (allCustomerResult.error) throw allCustomerResult.error;

    // --- Unpaid Risk ---
    const unpaidBookings = unpaidResult.data || [];
    const totalUnpaidAmount = unpaidBookings.reduce((sum, b) => sum + (Number(b.final_amount) || 0), 0);
    const unpaidCount = unpaidBookings.length;
    const last7dBookings = last7dResult.data || [];
    const total7d = last7dBookings.length;
    const unpaidPercent = total7d > 0 ? Math.round((unpaidCount / total7d) * 100) : 0;

    // --- Cancellation Risk ---
    const cancelled7d = last7dBookings.filter(b => b.status === 'Cancelled').length;
    const noShow7d = last7dBookings.filter(b => b.status === 'No Show').length;
    const cancellationRate7d = total7d > 0 ? Math.round((cancelled7d / total7d) * 100) : 0;
    const noShowRate7d = total7d > 0 ? Math.round((noShow7d / total7d) * 100) : 0;

    const prev7dBookings = prev7dResult.data || [];
    const prevTotal = prev7dBookings.length;
    const prevCancelled = prev7dBookings.filter(b => b.status === 'Cancelled').length;
    const prevCancellationRate = prevTotal > 0 ? Math.round((prevCancelled / prevTotal) * 100) : 0;
    const deltaVsPrevious7d = cancellationRate7d - prevCancellationRate;

    // --- Discount Risk ---
    const last30dBookings = last30dResult.data || [];
    const discountedBookings = last30dBookings.filter(b => Number(b.discount_amount) > 0);
    const discountedCount = discountedBookings.length;
    const total30d = last30dBookings.length;
    const discountedBookingPercent = total30d > 0 ? Math.round((discountedCount / total30d) * 100) : 0;

    let avgDiscountPercent30d = 0;
    if (discountedCount > 0) {
      const totalDiscountPct = discountedBookings.reduce((sum, b) => {
        const base = Number(b.base_amount) || 0;
        const disc = Number(b.discount_amount) || 0;
        return sum + (base > 0 ? (disc / base) * 100 : 0);
      }, 0);
      avgDiscountPercent30d = Math.round(totalDiscountPct / discountedCount);
    }

    // Top discount approver
    const approverCounts = {};
    for (const b of discountedBookings) {
      if (b.discount_approved_by) {
        approverCounts[b.discount_approved_by] = (approverCounts[b.discount_approved_by] || 0) + 1;
      }
    }
    let topDiscountApprover = null;
    let maxApprovals = 0;
    for (const [uid, count] of Object.entries(approverCounts)) {
      if (count > maxApprovals) {
        maxApprovals = count;
        topDiscountApprover = uid;
      }
    }

    // Resolve approver name if exists
    let topApproverName = null;
    if (topDiscountApprover) {
      const { data: approverProfile } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', topDiscountApprover)
        .single();
      topApproverName = approverProfile?.full_name || 'Unknown';
    }

    // --- Retention Risk ---
    const allCompleted = allCustomerResult.data || [];
    const customerVisits = {};
    for (const b of allCompleted) {
      if (!b.customer_phone) continue;
      if (!customerVisits[b.customer_phone]) {
        customerVisits[b.customer_phone] = { count: 0, lastDate: b.date };
      }
      customerVisits[b.customer_phone].count += 1;
      if (b.date > customerVisits[b.customer_phone].lastDate) {
        customerVisits[b.customer_phone].lastDate = b.date;
      }
    }

    const totalCustomers = Object.keys(customerVisits).length;
    let atRiskCustomerCount = 0;
    let revenueAtRiskEstimate = 0;

    for (const [, info] of Object.entries(customerVisits)) {
      if (info.count >= 2 && info.lastDate < sixtyDaysAgo) {
        atRiskCustomerCount += 1;
        // Estimate: avg revenue per visit * visits as potential lost revenue
        // Simplified: count past visits as proxy
        revenueAtRiskEstimate += info.count;
      }
    }

    const atRiskPercent = totalCustomers > 0 ? Math.round((atRiskCustomerCount / totalCustomers) * 100) : 0;

    // Convert atRisk visit-count to estimated revenue (avg booking value from last 30d)
    const avgBookingValue = total30d > 0
      ? last30dBookings.reduce((s, b) => s + (Number(b.base_amount) || 0), 0) / total30d
      : 0;
    revenueAtRiskEstimate = Math.round(revenueAtRiskEstimate * avgBookingValue);

    return {
      data: {
        unpaidRisk: {
          totalUnpaidAmount,
          unpaidCount,
          unpaidPercent,
        },
        cancellationRisk: {
          cancellationRate7d,
          noShowRate7d,
          deltaVsPrevious7d,
        },
        discountRisk: {
          avgDiscountPercent30d,
          discountedBookingPercent,
          topDiscountApprover: topApproverName,
        },
        retentionRisk: {
          atRiskCustomerCount,
          atRiskPercent,
          revenueAtRiskEstimate,
        },
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getRiskIndicators error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 10F-2: Therapist Attendance API (Read + Write)
// ============================================================

const VALID_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Annual Leave', 'Sick Leave', 'Day Off'];

// Statuses that mean the staffer isn't working that day — not deducted from salary (see
// migration-151) and block booking assignment for the date, same as the legacy 'Leave' value
// (kept in the DB enum for historical rows but no longer offered as an entry option).
export const LEAVE_LIKE_ATTENDANCE_STATUSES = ['Leave', 'Annual Leave', 'Sick Leave', 'Day Off'];

// Paid-leave caps, per calendar year (Jan 1 – Dec 31 of the payroll period's year): Sick Leave
// and Annual Leave are only free of deduction up to these many days per year — anything beyond
// is deducted like Absent. Legacy 'Leave' rows and 'Day Off' are uncapped (always paid) — we
// can't retroactively split old 'Leave' rows into sick/annual, and Day Off has no cap per the
// 2026-09-03 spec. Bump these two numbers if the policy changes.
const SICK_LEAVE_PAID_CAP_DAYS = 14;
const ANNUAL_LEAVE_PAID_CAP_DAYS = 18;

// therapist_attendance.check_in_time/check_out_time are timestamptz columns, but the UI only
// ever deals with a plain "HH:MM" clock time (a native <input type="time">, no date picker of
// its own — the date is the attendance page's date filter). These two helpers bridge that gap
// in the Nepal business timezone, matching the `+05:45` offset pattern already used elsewhere
// in this file (e.g. the collections date-range boundary above) rather than trusting the
// Postgres session timezone.
function combineDateTimeKathmandu(date, time) {
  if (!date || !time) return null;
  return `${date}T${time}:00+05:45`;
}

function formatTimeKathmandu(isoTimestamp) {
  if (!isoTimestamp) return null;
  return new Date(isoTimestamp).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/**
 * Fetch attendance for all active therapists for a specific branch + date.
 * Therapists without a record get status = null.
 */
export async function fetchAttendance({ branchId, date }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    // Parallel: active therapists + attendance records
    let therapistsQuery = supabase
      .from('therapists')
      .select('id, name, is_service_staff')
      .eq('is_active', true)
      .order('name');
    therapistsQuery = withBranch(therapistsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status, check_in_time, check_out_time, notes')
      .eq('date', targetDate);
    attendanceQuery = withBranch(attendanceQuery, branchId);
    const [therapistsResult, attendanceResult] = await Promise.all([
      therapistsQuery,
      attendanceQuery,
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    const therapists = therapistsResult.data || [];
    const attendanceRows = attendanceResult.data || [];

    // Index attendance by therapist_id
    const attendanceMap = {};
    for (const row of attendanceRows) {
      attendanceMap[row.therapist_id] = row;
    }

    // Merge
    const merged = therapists.map(t => {
      const att = attendanceMap[t.id];
      return {
        therapistId: t.id,
        therapistName: t.name,
        isServiceStaff: t.is_service_staff !== false,
        status: att?.status || null,
        checkInTime: formatTimeKathmandu(att?.check_in_time),
        checkOutTime: formatTimeKathmandu(att?.check_out_time),
        notes: att?.notes || null,
      };
    });

    return { data: merged, error: null };
  } catch (error) {
    console.error('[API] fetchAttendance error:', error.message);
    return { data: null, error };
  }
}

/**
 * Create or update attendance for a therapist on a date.
 * Uses INSERT-first, UPDATE on UNIQUE violation.
 * Lets DB trigger enforce closed-day lock (P0004).
 */
export async function markAttendance({ therapistId, date, status, checkInTime, checkOutTime, notes }) {
  try {
    // 1. Validate status
    if (!VALID_ATTENDANCE_STATUSES.includes(status)) {
      return { data: null, error: { code: 'INVALID_STATUS', message: `Status must be one of: ${VALID_ATTENDANCE_STATUSES.join(', ')}` } };
    }

    // 2. Auth + role check
    const { user, profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile.role === 'staff') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Staff cannot mark attendance.' } };
    }

    // 3. Resolve therapist's branch for branch isolation
    const { data: therapist, error: therapistError } = await supabase
      .from('therapists')
      .select('id, branch_id')
      .eq('id', therapistId)
      .single();

    if (therapistError) {
      if (therapistError.code === 'PGRST116') {
        return { data: null, error: { code: 'THERAPIST_NOT_FOUND', message: 'Therapist not found.' } };
      }
      throw therapistError;
    }

    // 4. Branch isolation: manager can only mark in own branch
    if (profile.role === 'manager' && therapist.branch_id !== profile.branch_id) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'You can only mark attendance for therapists in your branch.' } };
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    const row = {
      branch_id: therapist.branch_id,
      therapist_id: therapistId,
      date: targetDate,
      status,
      check_in_time: combineDateTimeKathmandu(targetDate, checkInTime),
      check_out_time: combineDateTimeKathmandu(targetDate, checkOutTime),
      notes: notes || null,
      marked_by: user.id,
    };

    // 5. Try INSERT first
    const { data: inserted, error: insertError } = await supabase
      .from('therapist_attendance')
      .insert(row)
      .select('id')
      .single();

    if (!insertError) {
      return { data: { success: true, id: inserted.id }, error: null };
    }

    // 6. UNIQUE violation → UPDATE existing row
    if (insertError.code === '23505') {
      const { data: updated, error: updateError } = await supabase
        .from('therapist_attendance')
        .update({
          status,
          check_in_time: combineDateTimeKathmandu(targetDate, checkInTime),
          check_out_time: combineDateTimeKathmandu(targetDate, checkOutTime),
          notes: notes || null,
          marked_by: user.id,
        })
        .eq('therapist_id', therapistId)
        .eq('date', targetDate)
        .select('id')
        .single();

      if (updateError) {
        // Check for day-locked trigger
        if (updateError.code === 'P0004' || (updateError.message && updateError.message.includes('ATTENDANCE_DAY_LOCKED'))) {
          return { data: null, error: { code: 'ATTENDANCE_DAY_LOCKED', message: 'This day has been closed. Attendance cannot be modified.' } };
        }
        throw updateError;
      }

      return { data: { success: true, id: updated.id }, error: null };
    }

    // 7. Check for day-locked trigger on INSERT
    if (insertError.code === 'P0004' || (insertError.message && insertError.message.includes('ATTENDANCE_DAY_LOCKED'))) {
      return { data: null, error: { code: 'ATTENDANCE_DAY_LOCKED', message: 'This day has been closed. Attendance cannot be modified.' } };
    }

    throw insertError;
  } catch (error) {
    console.error('[API] markAttendance error:', error.message);
    return { data: null, error: { code: 'UNKNOWN_ERROR', message: error.message || 'An unexpected error occurred.' } };
  }
}

/**
 * Return attendance summary for dashboard display.
 */
export async function fetchAttendanceSummary({ branchId, date }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    // Parallel: active therapist count + attendance records
    let therapistsQuery = supabase
      .from('therapists')
      .select('id')
      .eq('is_active', true);
    therapistsQuery = withBranch(therapistsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('status')
      .eq('date', targetDate);
    attendanceQuery = withBranch(attendanceQuery, branchId);
    const [therapistsResult, attendanceResult] = await Promise.all([
      therapistsQuery,
      attendanceQuery,
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    const totalTherapists = (therapistsResult.data || []).length;
    const records = attendanceResult.data || [];

    let presentCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let halfDayCount = 0;

    for (const r of records) {
      if (r.status === 'Present') presentCount++;
      else if (r.status === 'Absent') absentCount++;
      else if (LEAVE_LIKE_ATTENDANCE_STATUSES.includes(r.status)) leaveCount++;
      else if (r.status === '1st-Half Day' || r.status === '2nd-Half Day') halfDayCount++;
    }

    const attendanceRate = totalTherapists > 0
      ? Math.round((presentCount / totalTherapists) * 100)
      : 0;

    return {
      data: {
        totalTherapists,
        presentCount,
        absentCount,
        leaveCount,
        halfDayCount,
        attendanceRate,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchAttendanceSummary error:', error.message);
    return { data: null, error };
  }
}

/**
 * Attendance report over a date range (inclusive).
 * Aggregates per-staff and overall counts of Present/Absent/Leave/Half Day.
 */
export async function fetchAttendanceReport({ branchId, startDate, endDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!startDate || !endDate) {
      return { data: null, error: { code: 'RANGE_REQUIRED', message: 'Start and end dates are required.' } };
    }

    let therapistsQuery = supabase
      .from('therapists')
      .select('id, name, is_service_staff')
      .eq('is_active', true)
      .order('name');
    therapistsQuery = withBranch(therapistsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, date, status')
      .gte('date', startDate)
      .lte('date', endDate);
    attendanceQuery = withBranch(attendanceQuery, branchId);
    const [therapistsResult, attendanceResult] = await Promise.all([
      therapistsQuery,
      attendanceQuery,
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    const therapists = therapistsResult.data || [];
    const records = attendanceResult.data || [];

    const emptyCounts = () => ({ present: 0, absent: 0, leave: 0, halfDay: 0, marked: 0 });
    const bump = (acc, status) => {
      switch (status) {
        case 'Present': acc.present++; acc.marked++; break;
        case 'Absent': acc.absent++; acc.marked++; break;
        case '1st-Half Day':
        case '2nd-Half Day': acc.halfDay++; acc.marked++; break;
        default:
          if (LEAVE_LIKE_ATTENDANCE_STATUSES.includes(status)) { acc.leave++; acc.marked++; }
          break;
      }
    };

    // Per-therapist aggregation
    const perStaffMap = {};
    for (const t of therapists) {
      perStaffMap[t.id] = {
        therapistId: t.id,
        therapistName: t.name,
        isServiceStaff: t.is_service_staff !== false,
        ...emptyCounts(),
      };
    }

    const totals = emptyCounts();
    for (const r of records) {
      const acc = perStaffMap[r.therapist_id];
      if (acc) bump(acc, r.status);
      bump(totals, r.status);
    }

    const perStaff = Object.values(perStaffMap).map((s) => ({
      ...s,
      attendanceRate: s.marked > 0 ? Math.round((s.present / s.marked) * 100) : 0,
    }));

    const overallRate = totals.marked > 0
      ? Math.round((totals.present / totals.marked) * 100)
      : 0;

    return {
      data: {
        startDate,
        endDate,
        totalStaff: therapists.length,
        totals: { ...totals, attendanceRate: overallRate },
        perStaff,
        // Raw per-day records for the calendar grid view.
        dayRecords: records.map((r) => ({
          therapistId: r.therapist_id,
          date: r.date,
          status: r.status,
        })),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchAttendanceReport error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 10D-5: Therapist Performance Index (Read-Only)
// ============================================================

// Grace window before a check-in/check-out counts as "late"/"early" against the branch's
// open_time/close_time — attendance is marked to the minute but a few minutes of slack avoids
// flagging normal clock variance as a lateness event.
const ATTENDANCE_GRACE_MINUTES = 10;

// Stable identity for de-duplicating a booking's customer even when customer_id is null
// (walk-in/guest bookings — bookings.customer_id is nullable, migration-412-ish ALTER).
// Phone is preferred over customer_id: customers.phone is enforced unique per org
// (customers_org_nphone_uniq), so it's a more reliable identity than customer_id when the SAME
// person has one booking linked to their profile and another walk-in booking that staff never
// matched to it (common in practice) — keying on customer_id there would double-count one
// person as two "customers attended".
function bookingCustomerKey(b) {
  const normalizedPhone = (b.customer_phone || '').replace(/\D/g, '');
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  if (b.customer_id) return `id:${b.customer_id}`;
  return `name:${(b.customer_name || '').trim().toLowerCase()}`;
}

// Shared per-therapist metric computation — used by both the bulk getTherapistPerformance table
// and the single-therapist getTherapistOverview, so the two views can never drift apart for the
// same period (see migration/plan note: "data consistency" requirement).
//
// `bookings` must already be filtered to this therapist + period + status IN
// ('Confirmed','In-Progress','Completed'). `attendanceRows` must already be filtered to this
// therapist + period, selecting at least `status, check_in_time, check_out_time`.
// `dayWindowMinutes` is the branch's operating window (close_time - open_time) in minutes.
function daysInPeriodInclusive(startDate, endDate) {
  return Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
}

// periodDays: total calendar days in the requested range — used ONLY as a fallback when a
// therapist has zero attendance rows at all for the period (branches that don't mark
// attendance rigorously would otherwise show 0% utilization for everyone, which both hides
// real utilization and unfairly zeroes out 15% of performanceScore's weighting).
function computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays) {
  const completed = bookings.filter(b => b.status === 'Completed');
  const servicesCompleted = completed.length;
  const totalAssigned = bookings.length;

  const paidBookings = completed.filter(b => b.payment_status === 'paid');
  const paidRevenue = paidBookings.reduce((sum, b) => sum + (Number(b.final_amount) || 0), 0);
  const completionRate = totalAssigned > 0 ? servicesCompleted / totalAssigned : 0;
  const avgRevenuePerBooking = servicesCompleted > 0 ? Math.round(paidRevenue / servicesCompleted) : 0;

  const attendedCustomers = new Set(completed.map(bookingCustomerKey));
  const assignedCustomers = new Set(bookings.map(bookingCustomerKey));
  const customersAttended = attendedCustomers.size;
  const customersAssigned = assignedCustomers.size;
  // "Not attended" must only count appointments that have actually already happened — a
  // Confirmed booking scheduled later today/this week hasn't failed to be attended, it just
  // hasn't occurred yet. Using start_datetime (a real timestamptz) rather than customersAssigned
  // - customersAttended avoids mislabeling upcoming bookings as no-shows.
  const now = Date.now();
  const notAttendedCustomers = new Set(
    bookings
      .filter(b => b.status !== 'Completed' && b.start_datetime && new Date(b.start_datetime).getTime() <= now)
      .map(bookingCustomerKey)
  );
  for (const key of attendedCustomers) notAttendedCustomers.delete(key);
  const notAttended = notAttendedCustomers.size;

  const occupiedMinutes = completed.reduce((sum, b) => sum + (b.service_duration_snapshot || 0), 0);
  const avgServiceDurationMinutes = servicesCompleted > 0 ? Math.round(occupiedMinutes / servicesCompleted) : 0;

  // Actual worked minutes: real check-in→check-out span where recorded, else fall back to the
  // branch's scheduled window for that day (full for Present, half for Half-day) — same
  // fallback the pre-existing utilization calc used, just now exposed as its own number.
  let workedMinutes = 0;
  let attendedDaysTotal = 0;
  let presentOrHalfDays = 0;
  for (const a of attendanceRows) {
    attendedDaysTotal += 1;
    const isHalf = a.status === '1st-Half Day' || a.status === '2nd-Half Day';
    if (a.status !== 'Present' && !isHalf) continue;
    presentOrHalfDays += 1;
    const dayWindow = isHalf ? dayWindowMinutes / 2 : dayWindowMinutes;
    if (a.check_in_time && a.check_out_time) {
      const span = (new Date(a.check_out_time) - new Date(a.check_in_time)) / 60000;
      workedMinutes += Math.max(0, span);
    } else {
      workedMinutes += dayWindow;
    }
  }
  // No attendance marked at all for the period — assume the full period was worked rather
  // than reporting 0h/0% (matches the pre-refactor behavior this replaced).
  if (attendedDaysTotal === 0 && periodDays > 0) {
    workedMinutes = periodDays * dayWindowMinutes;
  }
  const attendanceRate = attendedDaysTotal > 0 ? presentOrHalfDays / attendedDaysTotal : 1;

  const workedHours = Math.round((workedMinutes / 60) * 10) / 10;
  const occupiedHours = Math.round((occupiedMinutes / 60) * 10) / 10;
  // Utilization = Occupied Time ÷ Actual Worked Time × 100 (capped at 100 for display safety).
  const utilizationRate = workedMinutes > 0 ? Math.round(Math.min(occupiedMinutes / workedMinutes, 1) * 100) : 0;

  return {
    servicesCompleted,
    completedBookings: servicesCompleted,
    totalAssigned,
    paidRevenue,
    completionRate: Math.round(completionRate * 100),
    avgRevenuePerBooking,
    attendanceRate: Math.round(attendanceRate * 100),
    customersAttended,
    customersAssigned,
    notAttended,
    workedHours,
    occupiedHours,
    utilizationRate,
    avgServiceDurationMinutes,
  };
}

export async function getTherapistPerformance({ branchId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const overall = isOverallBranch(branchId);
    const today = new Date().toISOString().split('T')[0];
    const endDate = toDate || today;
    const startDate = fromDate || new Date(new Date(endDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

    // 1. Fetch active therapists + branch hours.
    // Overall: build a branch_id → operating-window map across the org instead of one branch row.
    let therapistsQuery = supabase
      .from('therapists')
      .select(overall ? 'id, name, gender, specialties, branch_id' : 'id, name, gender, specialties')
      .eq('is_active', true)
      .order('name');
    therapistsQuery = withBranch(therapistsQuery, branchId);
    const branchQuery = overall
      ? supabase.from('branches').select('id, open_time, close_time')
      : supabase.from('branches').select('open_time, close_time').eq('id', resolveBranchId(branchId)).single();
    const [therapistsResult, branchResult] = await Promise.all([
      therapistsQuery,
      branchQuery,
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (branchResult.error) throw branchResult.error;

    const therapists = therapistsResult.data || [];
    if (therapists.length === 0) {
      return { data: { therapists: [], periodStart: startDate, periodEnd: endDate }, error: null };
    }

    let operatingMinutesPerDay = 0;
    const branchWindow = {};
    if (overall) {
      for (const br of (branchResult.data || [])) {
        branchWindow[br.id] = timeToMinutes(br.close_time) - timeToMinutes(br.open_time);
      }
    } else {
      const openMin = timeToMinutes(branchResult.data.open_time);
      const closeMin = timeToMinutes(branchResult.data.close_time);
      operatingMinutesPerDay = closeMin - openMin;
    }

    // Operating minutes per day for a given therapist's branch.
    const dayWindowFor = (bid) => overall ? (branchWindow[bid] || 0) : operatingMinutesPerDay;

    const therapistIds = therapists.map(t => t.id);

    // 2. Fetch bookings + attendance in parallel
    let bookingsQuery = supabase
      .from('bookings')
      .select('therapist_id, status, payment_status, final_amount, service_duration_snapshot, customer_id, customer_name, customer_phone, start_datetime')
      .gte('date', startDate)
      .lte('date', endDate)
      .in('therapist_id', therapistIds)
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status, check_in_time, check_out_time')
      .gte('date', startDate)
      .lte('date', endDate)
      .in('therapist_id', therapistIds);
    attendanceQuery = withBranch(attendanceQuery, branchId);
    const [bookingsResult, attendanceResult] = await Promise.all([
      bookingsQuery,
      attendanceQuery,
    ]);

    if (bookingsResult.error) throw bookingsResult.error;
    // Attendance errors are non-fatal
    const allBookings = bookingsResult.data || [];
    const allAttendance = (!attendanceResult.error && attendanceResult.data) || [];

    // 3. Aggregate per therapist
    const bookingsByTherapist = {};
    const attendanceByTherapist = {};

    for (const t of therapists) {
      bookingsByTherapist[t.id] = [];
      attendanceByTherapist[t.id] = [];
    }

    for (const b of allBookings) {
      if (bookingsByTherapist[b.therapist_id]) {
        bookingsByTherapist[b.therapist_id].push(b);
      }
    }

    for (const a of allAttendance) {
      if (attendanceByTherapist[a.therapist_id]) {
        attendanceByTherapist[a.therapist_id].push(a);
      }
    }

    // 4. Compute metrics per therapist via the shared helper (same code path as
    // getTherapistOverview, so the main table and the detail view's Overview tab never drift).
    const rawMetrics = therapists.map(t => {
      const metrics = computeTherapistMetrics(
        bookingsByTherapist[t.id],
        attendanceByTherapist[t.id],
        dayWindowFor(t.branch_id),
        daysInPeriodInclusive(startDate, endDate)
      );

      return {
        therapistId: t.id,
        therapistName: t.name,
        gender: t.gender,
        specialties: t.specialties || [],
        ...metrics,
        _rawRevenue: metrics.paidRevenue,
      };
    });

    // 6. Normalize revenue for scoring (0–100 scale across cohort)
    const maxRevenue = Math.max(...rawMetrics.map(m => m._rawRevenue), 1);

    const scored = rawMetrics.map(m => {
      const revenueNormalized = (m._rawRevenue / maxRevenue) * 100;

      // Weighted score: Revenue 40%, Completion 25%, Attendance 20%, Utilization 15%
      const performanceScore = Math.round(
        revenueNormalized * 0.40 +
        m.completionRate * 0.25 +
        m.attendanceRate * 0.20 +
        m.utilizationRate * 0.15
      );

      const { _rawRevenue, ...rest } = m;
      return { ...rest, performanceScore: Math.max(0, Math.min(performanceScore, 100)) };
    });

    // Sort DESC by performanceScore
    scored.sort((a, b) => b.performanceScore - a.performanceScore);

    return {
      data: {
        therapists: scored,
        periodStart: startDate,
        periodEnd: endDate,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getTherapistPerformance error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Therapist Performance — single-therapist drill-down (Overview/Customers/Services/Attendance)
// ============================================================

// One therapist's Overview-tab numbers for a period. Built on the same computeTherapistMetrics
// helper as the bulk getTherapistPerformance table, so the two can never show different numbers
// for the same therapist + period.
export async function getTherapistOverview({ branchId, therapistId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!therapistId) {
      return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };
    }

    const today = new Date().toISOString().split('T')[0];
    const endDate = toDate || today;
    const startDate = fromDate || new Date(new Date(endDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

    // Branch hours come from the branchId PARAM (resolveBranchId, same as getTherapistPerformance's
    // non-overall path) — not from the therapist's live branch_id. The bookings/attendance
    // queries below are scoped by branchId via withBranch(); deriving dayWindowMinutes from the
    // therapist's current branch instead would silently use the wrong operating window if the
    // therapist has since been transferred elsewhere.
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('open_time, close_time')
      .eq('id', resolveBranchId(branchId))
      .single();
    if (bErr) throw bErr;
    const dayWindowMinutes = timeToMinutes(branch.close_time) - timeToMinutes(branch.open_time);

    let bookingsQuery = supabase
      .from('bookings')
      .select('status, payment_status, final_amount, service_duration_snapshot, customer_id, customer_name, customer_phone, start_datetime')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate)
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('status, check_in_time, check_out_time')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate);
    attendanceQuery = withBranch(attendanceQuery, branchId);

    const [bookingsResult, attendanceResult] = await Promise.all([bookingsQuery, attendanceQuery]);
    if (bookingsResult.error) throw bookingsResult.error;
    const bookings = bookingsResult.data || [];
    const attendanceRows = (!attendanceResult.error && attendanceResult.data) || [];

    const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes);

    return { data: { ...metrics, periodStart: startDate, periodEnd: endDate }, error: null };
  } catch (error) {
    console.error('[API] getTherapistOverview error:', error.message);
    return { data: null, error };
  }
}

// Customers tab: one row per attended (Completed) visit, classified New/Repeat using the same
// "first-ever completed booking org-wide" definition getCustomerIntelligence uses for CRM
// loyalty tiers. Pass includeMissedCancelled to also list Cancelled/No Show appointments.
export async function getTherapistCustomerHistory({ branchId, therapistId, fromDate, toDate, includeMissedCancelled = false }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!therapistId) {
      return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };
    }

    const today = new Date().toISOString().split('T')[0];
    const endDate = toDate || today;
    const startDate = fromDate || new Date(new Date(endDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

    const statuses = includeMissedCancelled ? ['Completed', 'Cancelled', 'No Show'] : ['Completed'];

    let query = supabase
      .from('bookings')
      .select('id, customer_id, customer_name, customer_phone, service_name_snapshot, date, start_time, service_duration_snapshot, status')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate)
      .in('status', statuses)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false });
    query = withBranch(query, branchId);

    const { data: bookings, error } = await query;
    if (error) throw error;
    const rows = bookings || [];

    // For every distinct customer_id present, find their earliest org-wide Completed booking
    // date. A booking whose date equals that earliest date is that customer's "New" visit;
    // everything else is "Repeat". No customer_id (walk-in/guest) → always "New".
    const customerIds = [...new Set(rows.map(r => r.customer_id).filter(Boolean))];
    const firstVisitByCustomer = {};
    if (customerIds.length > 0) {
      const { data: history, error: histErr } = await supabase
        .from('bookings')
        .select('customer_id, date')
        .in('customer_id', customerIds)
        .eq('status', 'Completed')
        .order('date', { ascending: true });
      if (histErr) throw histErr;
      for (const h of (history || [])) {
        if (!(h.customer_id in firstVisitByCustomer)) {
          firstVisitByCustomer[h.customer_id] = h.date;
        }
      }
    }

    const customers = rows.map(r => ({
      bookingId: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      serviceName: r.service_name_snapshot,
      date: r.date,
      startTime: r.start_time,
      durationMinutes: r.service_duration_snapshot,
      status: r.status,
      customerType: r.status !== 'Completed'
        ? null
        : (!r.customer_id || firstVisitByCustomer[r.customer_id] === r.date) ? 'New' : 'Repeat',
    }));

    return { data: { customers, periodStart: startDate, periodEnd: endDate }, error: null };
  } catch (error) {
    console.error('[API] getTherapistCustomerHistory error:', error.message);
    return { data: null, error };
  }
}

// Services tab: per-service Completed/Cancelled/Missed(No Show) counts, avg duration, revenue.
export async function getTherapistServiceBreakdown({ branchId, therapistId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!therapistId) {
      return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };
    }

    const today = new Date().toISOString().split('T')[0];
    const endDate = toDate || today;
    const startDate = fromDate || new Date(new Date(endDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

    let query = supabase
      .from('bookings')
      .select('service_name_snapshot, status, payment_status, final_amount, service_duration_snapshot')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate)
      .in('status', ['Completed', 'Cancelled', 'No Show']);
    query = withBranch(query, branchId);

    const { data: bookings, error } = await query;
    if (error) throw error;

    const byService = {};
    for (const b of (bookings || [])) {
      const name = b.service_name_snapshot || 'Unknown Service';
      if (!byService[name]) {
        byService[name] = { serviceName: name, completed: 0, cancelled: 0, missed: 0, revenue: 0, _durations: [] };
      }
      const s = byService[name];
      if (b.status === 'Completed') {
        s.completed += 1;
        if (b.payment_status === 'paid') s.revenue += Number(b.final_amount) || 0;
        if (b.service_duration_snapshot) s._durations.push(b.service_duration_snapshot);
      } else if (b.status === 'Cancelled') {
        s.cancelled += 1;
      } else if (b.status === 'No Show') {
        s.missed += 1;
      }
    }

    const services = Object.values(byService).map(s => ({
      serviceName: s.serviceName,
      completed: s.completed,
      cancelled: s.cancelled,
      missed: s.missed,
      avgDurationMinutes: s._durations.length > 0
        ? Math.round(s._durations.reduce((a, b) => a + b, 0) / s._durations.length)
        : 0,
      revenue: s.revenue,
    })).sort((a, b) => b.completed - a.completed);

    return { data: { services, periodStart: startDate, periodEnd: endDate }, error: null };
  } catch (error) {
    console.error('[API] getTherapistServiceBreakdown error:', error.message);
    return { data: null, error };
  }
}

// Attendance tab: scheduled vs actual worked hours, late/early/extra/partial counts, and a
// per-day shift history. "Scheduled" = branch open→close window on Present/Half-day days (no
// shift/roster table exists in this app — see migration/plan notes). Late/early are only
// computed for full-day Present rows with recorded check-in/out, using a ±10min grace window.
export async function getTherapistAttendanceDetail({ branchId, therapistId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!therapistId) {
      return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };
    }

    const today = new Date().toISOString().split('T')[0];
    const endDate = toDate || today;
    const startDate = fromDate || new Date(new Date(endDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

    // Branch hours come from the branchId PARAM (resolveBranchId), matching what the attendance
    // query below is scoped to via withBranch() — not the therapist's live branch_id, which
    // could point elsewhere if they've since been transferred (see getTherapistOverview).
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('open_time, close_time')
      .eq('id', resolveBranchId(branchId))
      .single();
    if (bErr) throw bErr;

    const openMin = timeToMinutes(branch.open_time);
    const closeMin = timeToMinutes(branch.close_time);
    const dayWindowMinutes = closeMin - openMin;

    let query = supabase
      .from('therapist_attendance')
      .select('date, status, check_in_time, check_out_time')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    query = withBranch(query, branchId);

    const { data: rows, error } = await query;
    if (error) throw error;
    const attendance = rows || [];

    let scheduledMinutes = 0;
    let workedMinutes = 0;
    let lateArrivals = 0;
    let earlyDepartures = 0;
    let extraMinutes = 0;
    let partialShifts = 0;

    const shiftHistory = attendance.map(a => {
      const isHalf = a.status === '1st-Half Day' || a.status === '2nd-Half Day';
      const isWorkDay = a.status === 'Present' || isHalf;
      const dayWindow = isHalf ? dayWindowMinutes / 2 : dayWindowMinutes;

      const checkInTime = formatTimeKathmandu(a.check_in_time);
      const checkOutTime = formatTimeKathmandu(a.check_out_time);
      let workedMin = null;
      let dayStatus = a.status;

      if (isWorkDay) {
        if (isHalf) partialShifts += 1;
        scheduledMinutes += dayWindow;

        if (a.check_in_time && a.check_out_time) {
          workedMin = Math.max(0, (new Date(a.check_out_time) - new Date(a.check_in_time)) / 60000);
        } else {
          workedMin = dayWindow;
        }
        workedMinutes += workedMin;

        if (workedMin > dayWindow) extraMinutes += workedMin - dayWindow;

        // Late/early are only derivable against the branch clock for full-day rows with BOTH a
        // real check-in AND check-out — a half-day slot isn't pinned to a fixed half of
        // open_time/close_time, and judging only one side of a partial pair (e.g. checkout
        // recorded but check-in missing) would contradict workedMin above, which itself only
        // uses the real span when both timestamps are present (falling back to the full
        // scheduled window otherwise) — flagging "Early departure" against that fallback would
        // show a self-contradicting "Worked: <full day> · Early departure" row.
        let flagged = false;
        const hasFullPair = !isHalf && a.check_in_time && a.check_out_time;
        if (hasFullPair && timeToMinutes(checkInTime) > openMin + ATTENDANCE_GRACE_MINUTES) {
          lateArrivals += 1;
          dayStatus = 'Late';
          flagged = true;
        }
        if (hasFullPair && timeToMinutes(checkOutTime) < closeMin - ATTENDANCE_GRACE_MINUTES) {
          earlyDepartures += 1;
          dayStatus = flagged && dayStatus === 'Late' ? 'Late' : 'Early departure';
          flagged = true;
        }
        if (!flagged) dayStatus = isHalf ? a.status : (hasFullPair ? 'On time' : a.status);
      }

      return {
        date: a.date,
        scheduledHours: Math.round((dayWindow / 60) * 10) / 10,
        checkIn: checkInTime,
        checkOut: checkOutTime,
        workedHours: workedMin !== null ? Math.round((workedMin / 60) * 10) / 10 : null,
        status: dayStatus,
      };
    });

    return {
      data: {
        scheduledHours: Math.round((scheduledMinutes / 60) * 10) / 10,
        actualWorkedHours: Math.round((workedMinutes / 60) * 10) / 10,
        lateArrivals,
        earlyDepartures,
        extraHours: Math.round((extraMinutes / 60) * 10) / 10,
        partialShifts,
        shiftHistory,
        periodStart: startDate,
        periodEnd: endDate,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getTherapistAttendanceDetail error:', error.message);
    return { data: null, error };
  }
}

// Manager's accessible branches: their primary users.branch_id plus any
// additional grants in user_branches (migration-063). Staff stay single-branch.
export async function fetchManagerBranches() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError || !profile?.id) {
      console.warn('[API] fetchManagerBranches: skipped — no profile. authError:', authError);
      return { data: [], error: null };
    }

    const { data: grants, error } = await supabase
      .from('user_branches')
      .select('branches(id, name, address, phone, is_active)')
      .eq('user_id', profile.id);

    if (error) throw error;

    const byId = new Map();
    for (const g of grants || []) {
      if (g.branches) byId.set(g.branches.id, g.branches);
    }

    // Primary branch isn't embedded on `profile` (getAuthenticatedUser only
    // selects branch_id) — fetch it directly so it doesn't render blank/"(Inactive)".
    if (profile.branch_id && !byId.has(profile.branch_id)) {
      const { data: primaryBranch } = await supabase
        .from('branches')
        .select('id, name, address, phone, is_active')
        .eq('id', profile.branch_id)
        .single();
      if (primaryBranch) byId.set(primaryBranch.id, primaryBranch);
    }

    return { data: Array.from(byId.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '')), error: null };
  } catch (error) {
    console.error('[API] fetchManagerBranches error:', error.message);
    return { data: [], error };
  }
}

export async function fetchAllBranches() {
  try {
    // Get authenticated user's org_id for tenant isolation
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError || !profile?.org_id) {
      console.warn('[API] fetchAllBranches: skipped — no org_id. authError:', authError);
      return { data: [], error: null };
    }

    const { data, error } = await supabase
      .from('branches')
      .select('id, name, address, phone, is_active')
      .eq('org_id', profile.org_id)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchAllBranches error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Customer-Facing Tenant-Isolated Queries
// ============================================================

/**
 * Fetch organization by slug (for customer-facing booking)
 * Includes industry configuration for terminology
 */
export async function fetchOrganizationBySlug(slug) {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select(`
        id,
        name,
        code,
        slug,
        owner_email,
        timezone,
        currency,
        industry_type,
        is_active,
        industries (
          id,
          name,
          staff_label,
          staff_label_plural,
          location_label,
          location_label_plural,
          enable_rooms,
          enable_staff_gender,
          default_categories
        )
      `)
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchOrganizationBySlug error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch branches for a specific organization (customer-facing)
 */
export async function fetchBranchesByOrgId(orgId) {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, address, phone, is_active')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBranchesByOrgId error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch services for a specific organization (customer-facing)
 */
export async function fetchServicesByOrgId(orgId, branchId) {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr, description, image_url, category')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    if (branchId && data) {
      const { data: branch } = await supabase
        .from('branches')
        .select('excluded_service_categories')
        .eq('id', branchId)
        .single();
      const excluded = branch?.excluded_service_categories;
      if (excluded?.length > 0) {
        return { data: data.filter(s => !excluded.includes(s.category)), error: null };
      }
    }

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchServicesByOrgId error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Service Categories Management (Manager + Admin)
// ============================================================

/**
 * Fetch all categories for management (manager/admin view)
 */
export async function fetchCategoriesForManagement() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage categories.' } };
    }

    // Filter by user's organization for tenant isolation
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    // Get categories with service count - filtered by org
    const { data: categories, error } = await supabase
      .from('service_categories')
      .select('id, name, description, is_active, display_order, created_at')
      .eq('org_id', profile.org_id)
      .order('display_order', { ascending: true });

    if (error) throw error;

    // Get service counts per category - filtered by org
    const { data: services } = await supabase
      .from('services')
      .select('category')
      .eq('org_id', profile.org_id);

    const serviceCounts = {};
    (services || []).forEach(s => {
      const cat = s.category || 'Other';
      serviceCounts[cat] = (serviceCounts[cat] || 0) + 1;
    });

    // Merge counts into categories
    const categoriesWithCounts = (categories || []).map(cat => ({
      ...cat,
      service_count: serviceCounts[cat.name] || 0
    }));

    return { data: categoriesWithCounts, error: null };
  } catch (error) {
    console.error('[API] fetchCategoriesForManagement error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch active categories for dropdowns (org-scoped)
 */
export async function fetchActiveCategories() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('service_categories')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchActiveCategories error:', error.message);
    return { data: null, error };
  }
}

/**
 * Create a new category
 */
export async function createCategory({ name, description }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create categories.' } };
    }

    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Category name is required.' } };
    }

    // Get max display_order
    const { data: maxOrder } = await supabase
      .from('service_categories')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxOrder?.display_order || 0) + 1;

    const { data, error } = await supabase
      .from('service_categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        display_order: nextOrder,
        is_active: true,
        org_id: profile.org_id,
      })
      .select('id, name, description, is_active, display_order, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A category with this name already exists.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] createCategory error:', error.message);
    return { data: null, error };
  }
}

/**
 * Update an existing category
 */
export async function updateCategory({ categoryId, name, description }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update categories.' } };
    }

    // Tenant isolation: ensure user has org
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    // Get old name for service update - verify category belongs to user's org
    const { data: oldCategory, error: catError } = await supabase
      .from('service_categories')
      .select('name')
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .single();

    if (catError || !oldCategory) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Category not found.' } };
    }

    const oldName = oldCategory?.name;

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;

    const { data, error } = await supabase
      .from('service_categories')
      .update(updateData)
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .select('id, name, description, is_active, display_order, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A category with this name already exists.' } };
      }
      throw error;
    }

    // Update services with old category name to new name (within this org only)
    if (name && oldName && name.trim() !== oldName) {
      await supabase
        .from('services')
        .update({ category: name.trim() })
        .eq('category', oldName)
        .eq('org_id', profile.org_id);  // Tenant isolation filter
    }

    return { data, error: null };
  } catch (error) {
    console.error('[API] updateCategory error:', error.message);
    return { data: null, error };
  }
}

/**
 * Toggle category active status
 */
export async function toggleCategoryActive({ categoryId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can toggle categories.' } };
    }

    // Tenant isolation: ensure user has org
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('service_categories')
      .update({ is_active: isActive })
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .select('id, name, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Category not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleCategoryActive error:', error.message);
    return { data: null, error };
  }
}

/**
 * Delete a category (only if no services use it)
 */
export async function deleteCategory({ categoryId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete categories.' } };
    }

    // Tenant isolation: ensure user has org
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    // Check if category exists and belongs to user's org
    const { data: category } = await supabase
      .from('service_categories')
      .select('name')
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .single();

    if (!category) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Category not found.' } };
    }

    // Check if category has services (within this org only)
    const { count } = await supabase
      .from('services')
      .select('id', { count: 'exact', head: true })
      .eq('category', category.name)
      .eq('org_id', profile.org_id);  // Tenant isolation filter

    if (count > 0) {
      return { data: null, error: { code: 'HAS_SERVICES', message: `Cannot delete category with ${count} service(s). Reassign services first or deactivate the category.` } };
    }

    const { error } = await supabase
      .from('service_categories')
      .delete()
      .eq('id', categoryId)
      .eq('org_id', profile.org_id);  // Tenant isolation filter

    if (error) throw error;
    return { data: { deleted: true }, error: null };
  } catch (error) {
    console.error('[API] deleteCategory error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// PAYROLL
// ============================================================

// Returns active therapists for a branch with their current compensation config.
// Unauthenticated / non-admin callers will receive an empty array (RLS on
// staff_compensation blocks reads; therapists are returned but compensation nulled).
export async function fetchStaffCompensation(branchId) {
  try {
    let query = supabase
      .from('therapists')
      .select('id, name, position, is_service_staff, staff_compensation(monthly_salary, commission_rate)')
      .eq('is_active', true)
      .order('name');
    query = withBranch(query, branchId);
    const { data, error } = await query;
    if (error) throw error;
    return {
      data: (data || []).map((t) => ({
        therapistId: t.id,
        name: t.name,
        position: t.position,
        isServiceStaff: t.is_service_staff,
        monthlySalary: t.staff_compensation?.monthly_salary != null
          ? Number(t.staff_compensation.monthly_salary)
          : 0,
        commissionRate: t.staff_compensation?.commission_rate != null
          ? Number(t.staff_compensation.commission_rate)
          : 0,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchStaffCompensation error:', error.message);
    return { data: null, error };
  }
}

// Upsert a staff member's compensation. Admin-only (enforced by RLS).
export async function setStaffCompensation({ therapistId, monthlySalary, commissionRate }) {
  try {
    const salary = Number(monthlySalary);
    const rate = Number(commissionRate);
    if (!(salary >= 0)) {
      return { data: null, error: { code: 'INVALID_VALUE', message: 'Monthly salary must be zero or more.' } };
    }
    if (!(rate >= 0) || rate > 100) {
      return { data: null, error: { code: 'INVALID_VALUE', message: 'Commission rate must be between 0 and 100.' } };
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('staff_compensation')
      .upsert(
        {
          therapist_id: therapistId,
          monthly_salary: salary,
          commission_rate: rate,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'therapist_id' }
      );
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] setStaffCompensation error:', error.message);
    return { data: null, error };
  }
}

// Fetch an existing payroll run + its items for a branch+month.
// periodMonth: 'YYYY-MM' string (e.g. '2026-06').
export async function getPayrollRun({ branchId, periodMonth }) {
  try {
    const firstDay = `${periodMonth}-01`;
    const { data: run, error: runErr } = await supabase
      .from('payroll_runs')
      .select('*')
      .eq('branch_id', branchId)
      .eq('period_month', firstDay)
      .maybeSingle();
    if (runErr) throw runErr;
    if (!run) return { data: null, error: null };

    const { data: items, error: itemErr } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('payroll_run_id', run.id)
      .order('therapist_name');
    if (itemErr) throw itemErr;

    return {
      data: {
        run: {
          id: run.id,
          branchId: run.branch_id,
          periodMonth: run.period_month,
          status: run.status,
          totalNet: Number(run.total_net),
          generatedAt: run.generated_at,
          finalizedAt: run.finalized_at,
        },
        items: (items || []).map((i) => ({
          id: i.id,
          therapistId: i.therapist_id,
          therapistName: i.therapist_name,
          monthlySalary: Number(i.monthly_salary),
          commissionRate: Number(i.commission_rate),
          daysInMonth: i.days_in_month,
          presentDays: i.present_days,
          absentDays: Number(i.absent_days),
          halfDays: i.half_days,
          leaveDays: i.leave_days,
          unpaidLeaveDays: Number(i.unpaid_leave_days),
          attendanceDeduction: Number(i.attendance_deduction),
          serviceRevenue: Number(i.service_revenue),
          serviceCommission: Number(i.service_commission),
          referralCommission: Number(i.referral_commission),
          netPay: Number(i.net_pay),
        })),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getPayrollRun error:', error.message);
    return { data: null, error };
  }
}

// Compute and persist a draft payroll run for a branch + month.
// If a draft run already exists it is deleted and regenerated.
// Blocks if a finalized run already exists for the same branch+month.
// periodMonth: 'YYYY-MM' string.
export async function generatePayroll({ branchId, periodMonth }) {
  try {
    const firstDay = `${periodMonth}-01`;
    // Parse year/month for date math
    const [year, month] = periodMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const lastDay = `${periodMonth}-${String(daysInMonth).padStart(2, '0')}`;

    // Check for a finalized run — if found, block.
    const { data: existing, error: checkErr } = await supabase
      .from('payroll_runs')
      .select('id, status')
      .eq('branch_id', branchId)
      .eq('period_month', firstDay)
      .maybeSingle();
    if (checkErr) throw checkErr;
    if (existing?.status === 'finalized') {
      return {
        data: null,
        error: {
          code: 'PAYROLL_FINALIZED',
          message: 'This payroll run has already been finalized and cannot be regenerated.',
        },
      };
    }

    // Delete any existing draft so we start fresh (cascade clears items).
    if (existing) {
      const { error: delErr } = await supabase
        .from('payroll_runs')
        .delete()
        .eq('id', existing.id);
      if (delErr) throw delErr;
    }

    // Fetch active therapists with compensation.
    let therapistQuery = supabase
      .from('therapists')
      .select('id, name, staff_compensation(monthly_salary, commission_rate)')
      .eq('is_active', true)
      .order('name');
    therapistQuery = withBranch(therapistQuery, branchId);
    const { data: therapists, error: tErr } = await therapistQuery;
    if (tErr) throw tErr;
    if (!therapists || therapists.length === 0) {
      return { data: null, error: { code: 'NO_STAFF', message: 'No active staff found for this branch.' } };
    }

    const therapistIds = therapists.map((t) => t.id);
    const therapistByName = {};
    for (const t of therapists) {
      therapistByName[t.name.trim().toLowerCase()] = t.id;
    }

    // Fetch attendance in the period.
    const { data: attendance, error: attErr } = await supabase
      .from('therapist_attendance')
      .select('therapist_id, status')
      .in('therapist_id', therapistIds)
      .gte('date', firstDay)
      .lte('date', lastDay);
    if (attErr) throw attErr;

    // Tally attendance per therapist.
    const attMap = {};
    for (const therapistId of therapistIds) {
      attMap[therapistId] = { present: 0, absent: 0, halfDay: 0, leave: 0 };
    }
    for (const row of (attendance || [])) {
      const t = attMap[row.therapist_id];
      if (!t) continue;
      if (row.status === 'Present') t.present += 1;
      else if (row.status === 'Absent') t.absent += 1;
      else if (row.status === '1st-Half Day' || row.status === '2nd-Half Day') t.halfDay += 1;
      else if (LEAVE_LIKE_ATTENDANCE_STATUSES.includes(row.status)) t.leave += 1;
    }

    // Sick/Annual Leave paid-day caps run per calendar year, not per pay period — so a
    // therapist's 15th sick day in June is unpaid even though June itself has plenty of paid
    // days left. Fetch the whole year up to this period's last day, split each type into
    // "before this period" vs. "in this period", and only the days that push the YTD count
    // past the cap WITHIN this period are deducted (days already over the cap before this
    // period were — or will be — deducted in the period they actually landed in).
    const yearStart = `${year}-01-01`;
    const { data: ytdLeaveRows, error: ytdErr } = await supabase
      .from('therapist_attendance')
      .select('therapist_id, status, date')
      .in('therapist_id', therapistIds)
      .in('status', ['Sick Leave', 'Annual Leave'])
      .gte('date', yearStart)
      .lte('date', lastDay);
    if (ytdErr) throw ytdErr;

    const ytdMap = {};
    for (const therapistId of therapistIds) {
      ytdMap[therapistId] = { sickBefore: 0, sickIn: 0, annualBefore: 0, annualIn: 0 };
    }
    for (const row of (ytdLeaveRows || [])) {
      const t = ytdMap[row.therapist_id];
      if (!t) continue;
      const inPeriod = row.date >= firstDay;
      if (row.status === 'Sick Leave') { if (inPeriod) t.sickIn += 1; else t.sickBefore += 1; }
      else if (row.status === 'Annual Leave') { if (inPeriod) t.annualIn += 1; else t.annualBefore += 1; }
    }

    const unpaidLeaveDaysFor = (therapistId) => {
      const t = ytdMap[therapistId];
      const overCap = (before, inPeriod, cap) =>
        Math.max(0, before + inPeriod - cap) - Math.max(0, before - cap);
      return overCap(t.sickBefore, t.sickIn, SICK_LEAVE_PAID_CAP_DAYS)
        + overCap(t.annualBefore, t.annualIn, ANNUAL_LEAVE_PAID_CAP_DAYS);
    };

    // Fetch completed+paid bookings in the period to compute service revenue.
    let bookingQuery = supabase
      .from('bookings')
      .select('therapist_id, final_amount, referred_by, referral_commission_type, referral_commission_value')
      .eq('status', 'Completed')
      .eq('payment_status', 'paid')
      .gte('date', firstDay)
      .lte('date', lastDay);
    bookingQuery = withBranch(bookingQuery, branchId);
    const { data: bookings, error: bErr } = await bookingQuery;
    if (bErr) throw bErr;

    // Sum service revenue per therapist, and referral commission per therapist name.
    const serviceRevenueMap = {};
    const referralCommissionMap = {};
    for (const therapistId of therapistIds) {
      serviceRevenueMap[therapistId] = 0;
      referralCommissionMap[therapistId] = 0;
    }
    for (const b of (bookings || [])) {
      if (b.therapist_id && serviceRevenueMap[b.therapist_id] !== undefined) {
        serviceRevenueMap[b.therapist_id] = Math.round(
          (serviceRevenueMap[b.therapist_id] + Number(b.final_amount)) * 100
        ) / 100;
      }
      // Attribute referral commission by name match.
      if (b.referred_by) {
        const refKey = b.referred_by.trim().toLowerCase();
        const matchedId = therapistByName[refKey];
        if (matchedId !== undefined) {
          const earned = computeReferralCommission(
            b.final_amount,
            b.referral_commission_type,
            b.referral_commission_value
          );
          referralCommissionMap[matchedId] = Math.round(
            (referralCommissionMap[matchedId] + earned) * 100
          ) / 100;
        }
      }
    }

    // Build payroll items.
    const { data: { user } } = await supabase.auth.getUser();
    const itemsPayload = [];
    let totalNet = 0;

    for (const t of therapists) {
      const comp = t.staff_compensation;
      const salary = comp?.monthly_salary != null ? Number(comp.monthly_salary) : 0;
      const rate = comp?.commission_rate != null ? Number(comp.commission_rate) : 0;
      const att = attMap[t.id];
      const unpaidLeaveDays = unpaidLeaveDaysFor(t.id);
      const perDay = daysInMonth > 0 ? salary / daysInMonth : 0;
      const deduction = Math.round(perDay * (att.absent + 0.5 * att.halfDay + unpaidLeaveDays) * 100) / 100;
      const serviceRev = serviceRevenueMap[t.id] || 0;
      const svcCommission = Math.round(serviceRev * (rate / 100) * 100) / 100;
      const refCommission = referralCommissionMap[t.id] || 0;
      const netPay = Math.round(
        (salary - deduction + svcCommission + refCommission) * 100
      ) / 100;
      totalNet = Math.round((totalNet + netPay) * 100) / 100;

      itemsPayload.push({
        therapist_id: t.id,
        therapist_name: t.name,
        monthly_salary: salary,
        commission_rate: rate,
        days_in_month: daysInMonth,
        present_days: att.present,
        absent_days: att.absent,
        half_days: att.halfDay,
        leave_days: att.leave,
        unpaid_leave_days: unpaidLeaveDays,
        attendance_deduction: deduction,
        service_revenue: serviceRev,
        service_commission: svcCommission,
        referral_commission: refCommission,
        net_pay: netPay,
      });
    }

    // Insert the run.
    const { data: run, error: runErr } = await supabase
      .from('payroll_runs')
      .insert({
        branch_id: branchId,
        period_month: firstDay,
        status: 'draft',
        total_net: totalNet,
        generated_by: user?.id ?? null,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (runErr) throw runErr;

    // Insert items.
    const { error: itemErr } = await supabase
      .from('payroll_items')
      .insert(itemsPayload.map((i) => ({ ...i, payroll_run_id: run.id })));
    if (itemErr) throw itemErr;

    return getPayrollRun({ branchId, periodMonth });
  } catch (error) {
    console.error('[API] generatePayroll error:', error.message);
    return { data: null, error };
  }
}

// Finalize a payroll run. Once finalized the run and its items are immutable
// (enforced by DB trigger and this guard).
export async function finalizePayroll({ runId }) {
  try {
    const { data: run, error: fetchErr } = await supabase
      .from('payroll_runs')
      .select('id, status')
      .eq('id', runId)
      .single();
    if (fetchErr) throw fetchErr;
    if (run.status === 'finalized') {
      return {
        data: null,
        error: { code: 'PAYROLL_FINALIZED', message: 'This run is already finalized.' },
      };
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error: updateErr } = await supabase
      .from('payroll_runs')
      .update({
        status: 'finalized',
        finalized_by: user?.id ?? null,
        finalized_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (updateErr) throw updateErr;

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] finalizePayroll error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// MEMBERSHIPS (Phase 1+2 — migration-045-memberships.sql)
// ============================================================
// Two SECURITY DEFINER fns gate every write:
//   enroll_member(p_customer_id, p_tier_id, p_initial_deposit, p_payment_mode, p_notes)
//   record_membership_transaction(p_membership_id, p_kind, p_amount, p_payment_mode,
//                                 p_booking_id, p_payment_id, p_notes)
// Reads use direct selects; RLS scopes rows to caller's org. Public marketing page
// reads membership_tiers anonymously.

// Deposit/top-up payment modes (exclude 'Membership' — you can't pay a deposit with
// your own balance). Mirrors PAYMENT_MODES above, minus 'Membership'.
export const MEMBERSHIP_DEPOSIT_MODES = ['Cash', 'Card', 'MobileBanking', 'Cheque', 'Esewa', 'Khalti'];

// Org-wide lookup-or-create for a customer. Mirrors the identity logic embedded in
// createBooking() (look up by org+phone first, then org+email; fall back to INSERT;
// re-fetch on the customers_org_nphone_uniq race per migration-036). Used by walk-in
// flows such as direct membership enrollment where there is no booking yet.
export async function findOrCreateCustomer({ orgId, branchId, fullName, phone, email, gender, dateOfBirth }) {
  try {
    if (!orgId || !branchId || !fullName) {
      return { data: null, error: { code: 'INVALID_INPUT', message: 'Org, branch, and name are required.' } };
    }
    // Canonical E.164 so the same number always resolves to the same customer
    // regardless of formatting / country code. See src/utils/phone.js.
    const normalizedPhone = toE164(phone);
    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
    const normalizedGender = gender || null;
    const normalizedDob = dateOfBirth || null;

    // 1. Look up an existing customer in the org by phone.
    let existing = null;
    if (normalizedPhone) {
      const { data } = await supabase
        .from('customers')
        .select('id, full_name, phone, email, gender, date_of_birth')
        .eq('org_id', orgId)
        .eq('phone', normalizedPhone)
        .limit(1)
        .maybeSingle();
      existing = data;
    }
    if (!existing && normalizedEmail) {
      const { data } = await supabase
        .from('customers')
        .select('id, full_name, phone, email, gender, date_of_birth')
        .eq('org_id', orgId)
        .eq('email', normalizedEmail)
        .limit(1)
        .maybeSingle();
      existing = data;
    }

    if (existing) {
      // Refresh stale fields if the staff member retyped them.
      await supabase
        .from('customers')
        .update({
          full_name: fullName,
          phone: normalizedPhone || existing.phone,
          email: normalizedEmail || existing.email,
          gender: normalizedGender || existing.gender,
          date_of_birth: normalizedDob || existing.date_of_birth,
        })
        .eq('id', existing.id);
      return { data: { customerId: existing.id, isNew: false }, error: null };
    }

    // 2. Create a fresh customer.
    const { data: created, error: insertErr } = await supabase
      .from('customers')
      .insert({
        org_id: orgId,
        branch_id: branchId,
        full_name: fullName,
        phone: normalizedPhone,
        email: normalizedEmail,
        gender: normalizedGender,
        date_of_birth: normalizedDob,
      })
      .select('id')
      .single();
    if (created) {
      return { data: { customerId: created.id, isNew: true }, error: null };
    }

    // 3. Race against customers_org_nphone_uniq (migration-036): re-fetch the winner.
    if (insertErr?.code === '23505' && normalizedPhone) {
      const { data } = await supabase
        .from('customers')
        .select('id')
        .eq('org_id', orgId)
        .eq('phone', normalizedPhone)
        .limit(1)
        .maybeSingle();
      if (data) return { data: { customerId: data.id, isNew: false }, error: null };
    }

    throw insertErr || new Error('Customer create failed without an error code');
  } catch (error) {
    console.error('[API] findOrCreateCustomer error:', error.message);
    return { data: null, error };
  }
}

// Create a new tier in the caller's org. Admin-only via RLS on membership_tiers.
// Caller passes a uniform shape; orgId is resolved from the authenticated profile.
export async function createMembershipTier({
  orgId,
  name,
  codePrefix,
  advanceAmount,
  validityDays = 365,
  displayOrder = 0,
  discountRules = null,
}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!orgId)       return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId is required.' } };
    if (!name?.trim())       return { data: null, error: { code: 'INVALID_INPUT', message: 'Tier name is required.' } };
    if (!codePrefix?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Code prefix is required.' } };
    const amt = Number(advanceAmount);
    if (!(amt > 0)) return { data: null, error: { code: 'INVALID_INPUT', message: 'Advance amount must be greater than zero.' } };
    const days = Number(validityDays);
    if (!(days > 0)) return { data: null, error: { code: 'INVALID_INPUT', message: 'Validity days must be greater than zero.' } };

    const { data, error } = await supabase
      .from('membership_tiers')
      .insert({
        org_id: orgId,
        name: name.trim(),
        code_prefix: codePrefix.trim().toUpperCase(),
        advance_amount: amt,
        validity_days: days,
        discount_rules: discountRules || {},
        display_order: Number(displayOrder) || 0,
        is_active: true,
      })
      .select('id, org_id, name, code_prefix, advance_amount, validity_days, discount_rules, display_order, is_active')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createMembershipTier error:', error.message);
    return { data: null, error };
  }
}

export async function updateMembershipTier({ id, name, advanceAmount, validityDays, displayOrder, isActive, discountRules }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!id) return { data: null, error: { code: 'INVALID_INPUT', message: 'Tier id is required.' } };

    const patch = {};
    if (name !== undefined)          patch.name = name.trim();
    if (advanceAmount !== undefined) patch.advance_amount = Number(advanceAmount);
    if (validityDays !== undefined)  patch.validity_days = Number(validityDays);
    if (displayOrder !== undefined)  patch.display_order = Number(displayOrder) || 0;
    if (isActive !== undefined)      patch.is_active = !!isActive;
    if (discountRules !== undefined) patch.discount_rules = discountRules || {};

    const { data, error } = await supabase
      .from('membership_tiers')
      .update(patch)
      .eq('id', id)
      .select('id, org_id, name, code_prefix, advance_amount, validity_days, discount_rules, display_order, is_active')
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateMembershipTier error:', error.message);
    return { data: null, error };
  }
}

export async function fetchMembershipTiers(orgId, { includeInactive = false } = {}) {
  try {
    let q = supabase
      .from('membership_tiers')
      .select('id, org_id, name, code_prefix, advance_amount, validity_days, discount_rules, display_order, is_active')
      .order('display_order', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    if (orgId) q = q.eq('org_id', orgId);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchMembershipTiers error:', error.message);
    return { data: null, error };
  }
}

// How much was deposited in the CURRENT wallet cycle only, not the lifetime sum
// across every renewal. `total_deposited` on `memberships` never resets on renewal
// (e.g. two 100,000 cycles read as 200,000) -- correct as a lifetime audit figure,
// wrong for "how much is this membership worth right now" display. renew_membership()
// (migration-056) marks the fresh cycle's deposit with notes containing "renewal", so
// we reset the running total whenever we hit one of those rows. Same convention as
// fetchMembershipLedgerReport's cycleDeposited below.
function computeCycleDeposited(depositTxns) {
  const cycleDeposited = new Map();
  for (const row of depositTxns) {
    const isRenewal = /renewal/i.test(row.notes || '');
    const prev = isRenewal ? 0 : (cycleDeposited.get(row.membership_id) || 0);
    cycleDeposited.set(row.membership_id, prev + Number(row.amount || 0));
  }
  return cycleDeposited;
}

// Returns memberships scoped to the caller's org (RLS) joined with tier + customer
// for list rendering. Optional client-side filters: search (name/phone), statusFilter.
export async function fetchMemberships({ search, statusFilter } = {}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('memberships')
      .select(`
        id, org_id, customer_id, tier_id, membership_number,
        total_deposited, balance,
        activation_date, expiry_date, birthday_perk_used_at,
        notes, created_by, created_at,
        customer:customers ( id, full_name, phone, gender, date_of_birth, branch:branches ( id, name ) ),
        tier:membership_tiers ( id, name, code_prefix, advance_amount, validity_days, discount_rules )
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = transformMemberships(data || []);

    const membershipIds = rows.map((m) => m.id);
    if (membershipIds.length > 0) {
      const { data: depositTxns, error: txnError } = await supabase
        .from('membership_transactions')
        .select('membership_id, amount, notes, created_at')
        .in('membership_id', membershipIds)
        .eq('kind', 'deposit')
        .order('created_at', { ascending: true });
      const cycleDeposited = txnError ? new Map() : computeCycleDeposited(depositTxns || []);
      rows.forEach((m) => { m.cycleDeposited = cycleDeposited.get(m.id) ?? m.totalDeposited; });
    }

    const filtered = rows.filter((m) => {
      if (statusFilter && statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (search && search.trim().length > 0) {
        const q = search.trim().toLowerCase();
        const name = (m.customerName || '').toLowerCase();
        const phone = m.customerPhone || '';
        const number = (m.membershipNumber || '').toLowerCase();
        if (!name.includes(q) && !phone.includes(q) && !number.includes(q)) return false;
      }
      return true;
    });
    return { data: filtered, error: null };
  } catch (error) {
    console.error('[API] fetchMemberships error:', error.message);
    return { data: null, error };
  }
}

export async function fetchMembership(membershipId) {
  try {
    const { data, error } = await supabase
      .from('memberships')
      .select(`
        id, org_id, customer_id, tier_id, membership_number,
        total_deposited, balance,
        activation_date, expiry_date, birthday_perk_used_at,
        notes, created_by, created_at,
        customer:customers ( id, full_name, phone, gender, date_of_birth ),
        tier:membership_tiers ( id, name, code_prefix, advance_amount, validity_days, discount_rules )
      `)
      .eq('id', membershipId)
      .single();
    if (error) throw error;

    const membership = transformMembership(data);

    const { data: depositTxns, error: txnError } = await supabase
      .from('membership_transactions')
      .select('membership_id, amount, notes, created_at')
      .eq('membership_id', membershipId)
      .eq('kind', 'deposit')
      .order('created_at', { ascending: true });
    const cycleDeposited = txnError ? new Map() : computeCycleDeposited(depositTxns || []);
    membership.cycleDeposited = cycleDeposited.get(membershipId) ?? membership.totalDeposited;

    return { data: membership, error: null };
  } catch (error) {
    console.error('[API] fetchMembership error:', error.message);
    return { data: null, error };
  }
}

export async function fetchMembershipTransactions(membershipId) {
  try {
    const { data, error } = await supabase
      .from('membership_transactions')
      .select(`
        id, kind, amount, payment_mode, booking_id, payment_id,
        performed_by, notes, created_at,
        performer:users!performed_by ( id, full_name )
      `)
      .eq('membership_id', membershipId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchMembershipTransactions error:', error.message);
    return { data: null, error };
  }
}

// Org-wide membership ledger report, powering both the Wallet Usage and
// Membership Collection pages. Replays the full ledger per membership in
// chronological order to compute two things the `memberships` table doesn't
// store directly:
//
// 1. `usage` — the point-in-time balance immediately after each deduction
//    (the `balance` column is itself SUM(amount) over ALL kinds — see the
//    membership_recompute trigger in migration-045-memberships.sql — so this
//    matches the current Memberships page's Balance exactly at the most
//    recent transaction).
//
// 2. `cycleDeposited` — how much was deposited in the CURRENT wallet cycle
//    only, not the lifetime sum across every renewal. `total_deposited` on
//    `memberships` never resets on renewal (e.g. two 100,000 cycles read as
//    200,000), which is correct as a lifetime audit figure but wrong for "how
//    much is this membership worth right now" reporting. renew_membership()
//    (migration-056) marks the fresh cycle's deposit with notes containing
//    "renewal" ('Renewal deposit') right after forfeiting the old balance —
//    the same '%renewal%' marker convention already relied on to audit
//    historical renewals in fix-membership-import-round3.sql — so we reset
//    the running deposited total whenever we hit one of those rows.
export async function fetchMembershipLedgerReport() {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('membership_transactions')
      .select(`
        id, membership_id, kind, amount, notes, created_at, booking_id,
        membership:memberships (
          membership_number,
          customer:customers ( full_name ),
          tier:membership_tiers ( name )
        ),
        booking:bookings ( service_name_snapshot )
      `)
      .order('membership_id', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const runningByMembership = new Map();
    const cycleDeposited = new Map();
    const usage = [];
    for (const row of data || []) {
      const prevBalance = runningByMembership.get(row.membership_id) || 0;
      const newBalance = prevBalance + Number(row.amount || 0);
      runningByMembership.set(row.membership_id, newBalance);

      if (row.kind === 'deposit') {
        const isRenewal = /renewal/i.test(row.notes || '');
        const prevCycleDeposited = isRenewal ? 0 : (cycleDeposited.get(row.membership_id) || 0);
        cycleDeposited.set(row.membership_id, prevCycleDeposited + Number(row.amount || 0));
      }

      if (row.kind === 'deduction') {
        usage.push({
          id: row.id,
          membershipId: row.membership_id,
          date: row.created_at,
          memberName: row.membership?.customer?.full_name || '—',
          cardNo: row.membership?.membership_number || '—',
          tierName: row.membership?.tier?.name || '—',
          service: row.booking?.service_name_snapshot || row.notes || 'Other',
          amountUsed: Math.abs(Number(row.amount || 0)),
          remainingBalance: newBalance,
        });
      }
    }
    usage.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { data: { usage, cycleDeposited }, error: null };
  } catch (error) {
    console.error('[API] fetchMembershipLedgerReport error:', error.message);
    return { data: null, error };
  }
}

// Fetch the most-recent membership for the customer attached to a booking.
// Returns null in `data` if the booking has no customer (walk-in) or no
// membership exists. Used by PaymentModal to surface the wallet option and
// balance banner at checkout.
export async function fetchMembershipForBooking(bookingId) {
  try {
    if (!bookingId) return { data: null, error: null };
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('id', bookingId)
      .single();
    if (bErr) throw bErr;
    if (!booking?.customer_id) return { data: null, error: null };
    return fetchMembershipForCustomer(booking.customer_id);
  } catch (error) {
    console.error('[API] fetchMembershipForBooking error:', error.message);
    return { data: null, error };
  }
}

// Membership status — status/tier/usable only, no balance/deposit figures
// (migration-087). Used by fetchCustomersLightweight for the booking-creation
// tier badge (every role — the badge never needed balance in the first place).
export async function fetchMembershipStatus({ customerId } = {}) {
  try {
    if (!MEMBERSHIP_ENABLED) return { data: [], error: null };
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('list_membership_status_for_org', {
      p_customer_id: customerId || null,
    });
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        customerId: r.customer_id,
        membershipId: r.membership_id,
        membershipNumber: r.membership_number,
        tierName: r.tier_name,
        status: r.status,
        usable: r.usable,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchMembershipStatus error:', error.message);
    return { data: null, error };
  }
}

// Fetch the active (or pending) membership for a given customer. Returns null
// in `data` if none exists. Used by Phase 3 at the booking checkout.
export async function fetchMembershipForCustomer(customerId) {
  try {
    if (!customerId) return { data: null, error: null };
    const { data, error } = await supabase
      .from('memberships')
      .select(`
        id, org_id, customer_id, tier_id, membership_number,
        total_deposited, balance,
        activation_date, expiry_date, birthday_perk_used_at,
        notes, created_by, created_at,
        customer:customers ( id, full_name, phone, gender, date_of_birth ),
        tier:membership_tiers ( id, name, code_prefix, advance_amount, validity_days, discount_rules )
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { data: data ? transformMembership(data) : null, error: null };
  } catch (error) {
    console.error('[API] fetchMembershipForCustomer error:', error.message);
    return { data: null, error };
  }
}

// Customer-session counterparts of fetchMembershipForCustomer /
// fetchMembershipTransactions — same query shape, but run against
// supabaseCustomer so RLS resolves via customer_accounts, not the staff
// users table (a customer session has no row there).
export async function getCustomerMembership(customerId) {
  try {
    if (!customerId) return { data: null, error: null };
    const { data, error } = await supabaseCustomer
      .from('memberships')
      .select(`
        id, org_id, customer_id, tier_id, membership_number,
        total_deposited, balance,
        activation_date, expiry_date, birthday_perk_used_at,
        notes, created_by, created_at,
        customer:customers ( id, full_name, phone, gender, date_of_birth ),
        tier:membership_tiers ( id, name, code_prefix, advance_amount, validity_days, discount_rules )
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { data: data ? transformMembership(data) : null, error: null };
  } catch (error) {
    console.error('[API] getCustomerMembership error:', error.message);
    return { data: null, error };
  }
}

export async function getCustomerMembershipTransactions(membershipId) {
  try {
    if (!membershipId) return { data: [], error: null };
    const { data, error } = await supabaseCustomer
      .from('membership_transactions')
      .select(`
        id, kind, amount, payment_mode, booking_id, payment_id,
        performed_by, notes, created_at
      `)
      .eq('membership_id', membershipId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] getCustomerMembershipTransactions error:', error.message);
    return { data: null, error };
  }
}

export async function enrollMember({ customerId, tierId, initialDeposit, paymentMode, notes = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('enroll_member', {
      p_customer_id: customerId,
      p_tier_id: tierId,
      p_initial_deposit: initialDeposit,
      p_payment_mode: paymentMode,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_enrolled', { tier_id: tierId, initial_deposit: initialDeposit, payment_mode: paymentMode });
    return { data: { membershipId: data }, error: null };
  } catch (error) {
    console.error('[API] enrollMember error:', error.message);
    return { data: null, error };
  }
}

export async function topUpMembership({ membershipId, amount, paymentMode, notes = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('record_membership_transaction', {
      p_membership_id: membershipId,
      p_kind: 'deposit',
      p_amount: amount,
      p_payment_mode: paymentMode,
      p_booking_id: null,
      p_payment_id: null,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_topup', { membership_id: membershipId, amount, payment_mode: paymentMode });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] topUpMembership error:', error.message);
    return { data: null, error };
  }
}

// Renews a depleted/lapsed membership: records the deposit AND starts a fresh
// validity cycle from today (optionally on a different tier) -- unlike
// topUpMembership, which just adds to the balance without touching dates.
export async function renewMembership({ membershipId, amount, paymentMode, tierId = null, notes = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('renew_membership', {
      p_membership_id: membershipId,
      p_amount: amount,
      p_payment_mode: paymentMode,
      p_tier_id: tierId,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_renewed', { membership_id: membershipId, amount, payment_mode: paymentMode, tier_id: tierId });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] renewMembership error:', error.message);
    return { data: null, error };
  }
}

// Reactivates a LAPSED membership (expiry passed, balance still > 0) by moving
// the expiry date forward. Unlike renewMembership, this never touches balance/
// total_deposited/tier -- the existing wallet balance is simply made usable
// again. Only valid while the membership is actually lapsed (enforced in the RPC).
export async function extendMembership({ membershipId, newExpiryDate, notes = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('extend_membership', {
      p_membership_id: membershipId,
      p_new_expiry_date: newExpiryDate,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_extended', { membership_id: membershipId, new_expiry_date: newExpiryDate });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] extendMembership error:', error.message);
    return { data: null, error };
  }
}

// Used by Phase 3 (booking checkout). `amount` is the (positive) charge; the RPC
// stores it as a negative ledger row.
export async function deductMembership({ membershipId, amount, bookingId = null, paymentId = null, notes = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const negativeAmount = -Math.abs(Number(amount));
    const { data, error } = await supabase.rpc('record_membership_transaction', {
      p_membership_id: membershipId,
      p_kind: 'deduction',
      p_amount: negativeAmount,
      p_payment_mode: null,
      p_booking_id: bookingId,
      p_payment_id: paymentId,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_deducted', { membership_id: membershipId, amount: Math.abs(Number(amount)) });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] deductMembership error:', error.message);
    return { data: null, error };
  }
}

export async function giftBirthdayPerk({ membershipId, notes = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('record_membership_transaction', {
      p_membership_id: membershipId,
      p_kind: 'birthday_perk',
      p_amount: 0,
      p_payment_mode: null,
      p_booking_id: null,
      p_payment_id: null,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_birthday_perk', { membership_id: membershipId });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] giftBirthdayPerk error:', error.message);
    return { data: null, error };
  }
}

// Admin-only correction (positive OR negative amount). The DB CHECK enforces a non-zero
// value, and the SECURITY DEFINER fn enforces the role + required note.
export async function adjustMembership({ membershipId, amount, notes }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('record_membership_transaction', {
      p_membership_id: membershipId,
      p_kind: 'adjustment',
      p_amount: amount,
      p_payment_mode: null,
      p_booking_id: null,
      p_payment_id: null,
      p_notes: notes,
    });
    if (error) throw error;
    capture('staff_membership_adjusted', { membership_id: membershipId, amount });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] adjustMembership error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// VOUCHERS (migration-071) — manager/admin only, RLS-enforced.
// ============================================================

export async function fetchVoucherTypes() {
  try {
    const { data, error } = await supabase
      .from('voucher_types')
      .select('id, name, code_prefix, standard_price, is_wallet, is_active, display_order, category')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchVoucherTypes error:', error.message);
    return { data: null, error };
  }
}

// Vouchers joined with their live balance (from the voucher_balances view, computed
// from voucher_claims — not stored, so it can't drift the way the old Excel sheet's
// hand-maintained Balance Tracking sheet did). Sorted alphabetically by guest name.
export async function fetchVouchers() {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [vouchersRes, balancesRes] = await Promise.all([
      supabase
        .from('vouchers')
        .select(`
          id, voucher_code, issued_date, expiry_date, guest_name, guest_info,
          actual_price, discount_percent, total_amount_issued, remarks, created_at,
          branch:branches ( id, name ),
          voucher_type:voucher_types ( id, name, is_wallet ),
          issuer:users!issued_by ( id, full_name )
        `)
        .order('guest_name', { ascending: true }),
      supabase
        .from('voucher_balances')
        .select('voucher_id, total_claimed, remaining_balance, status, last_claim_date'),
    ]);
    if (vouchersRes.error) throw vouchersRes.error;
    if (balancesRes.error) throw balancesRes.error;

    const balanceByVoucher = new Map((balancesRes.data || []).map((b) => [b.voucher_id, b]));

    const rows = (vouchersRes.data || []).map((v) => {
      const balance = balanceByVoucher.get(v.id) || {};
      return {
        id: v.id,
        voucherCode: v.voucher_code,
        issuedDate: v.issued_date,
        expiryDate: v.expiry_date,
        guestName: v.guest_name,
        guestInfo: v.guest_info,
        branchId: v.branch?.id || null,
        branchName: v.branch?.name || '—',
        voucherTypeId: v.voucher_type?.id || null,
        voucherTypeName: v.voucher_type?.name || '—',
        isWallet: !!v.voucher_type?.is_wallet,
        actualPrice: Number(v.actual_price || 0),
        discountPercent: Number(v.discount_percent || 0),
        totalAmountIssued: Number(v.total_amount_issued || 0),
        remarks: v.remarks,
        issuedByName: v.issuer?.full_name || '—',
        totalClaimed: Number(balance.total_claimed || 0),
        remainingBalance: balance.remaining_balance != null
          ? Number(balance.remaining_balance)
          : Number(v.total_amount_issued || 0),
        status: balance.status || 'unused',
        lastClaimDate: balance.last_claim_date || null,
      };
    });

    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchVouchers error:', error.message);
    return { data: null, error };
  }
}

export async function issueVoucher({
  branchId, voucherTypeId, guestName, guestInfo = null, discountPercent = 0,
  actualPrice = null, issuedDate = null, expiryDate = null, remarks = null,
  customerId = null, tenders = [], voucherCode = null,
}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!Array.isArray(tenders) || tenders.length === 0) {
      return { data: null, error: { code: 'TENDERS_REQUIRED', message: 'At least one payment tender is required.' } };
    }

    const cleanedTenders = tenders
      .filter((t) => Number(t.amount) > 0 && t.paymentMode)
      .map((t) => ({ amount: Number(t.amount), payment_mode: t.paymentMode }));

    const { data, error } = await supabase.rpc('issue_voucher', {
      p_branch_id: branchId,
      p_voucher_type_id: voucherTypeId,
      p_guest_name: guestName,
      p_guest_info: guestInfo,
      p_discount_percent: discountPercent,
      p_actual_price: actualPrice,
      p_issued_date: issuedDate,
      p_expiry_date: expiryDate,
      p_remarks: remarks,
      p_customer_id: customerId,
      p_tenders: cleanedTenders,
      // Temporary — manual entry to match pre-printed voucher booklets.
      // See migration-139-voucher-manual-code.sql.
      p_voucher_code: voucherCode,
    });
    if (error) throw error;
    capture('voucher_issued', { voucher_type_id: voucherTypeId, branch_id: branchId, linked_to_customer: !!customerId });
    return { data, error: null };
  } catch (error) {
    console.error('[API] issueVoucher error:', error.message);
    return { data: null, error };
  }
}

// Admin-only quick-add for voucher types, used inline from the voucher issuance
// flow (NewVoucherModal) — no RPC needed, voucher_types RLS ("Admin can manage
// voucher types") already restricts writes to admin.
export async function createVoucherType({ orgId, name, codePrefix, standardPrice, category }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!orgId)              return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId is required.' } };
    if (!name?.trim())       return { data: null, error: { code: 'INVALID_INPUT', message: 'Voucher type name is required.' } };
    if (!codePrefix?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Code prefix is required.' } };
    const price = Number(standardPrice);
    if (!(price >= 0)) return { data: null, error: { code: 'INVALID_INPUT', message: 'Standard price must be zero or greater.' } };
    if (!['spa', 'salon', 'body_scrub', 'package'].includes(category)) {
      return { data: null, error: { code: 'INVALID_INPUT', message: 'Category must be one of spa, salon, body_scrub, package.' } };
    }

    const { data, error } = await supabase
      .from('voucher_types')
      .insert({
        org_id: orgId,
        name: name.trim(),
        code_prefix: codePrefix.trim().toUpperCase(),
        standard_price: price,
        category,
        is_active: true,
      })
      .select('id, name, code_prefix, standard_price, is_wallet, is_active, display_order, category')
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createVoucherType error:', error.message);
    if (error.code === '23505') {
      return {
        data: null,
        error: { code: 'DUPLICATE_NAME', message: `A voucher type named "${name.trim()}" already exists.` },
      };
    }
    return { data: null, error };
  }
}

// Customer-session counterparts — run against supabaseCustomer so RLS
// resolves via customer_accounts, not the staff users/get_user_role() path
// (same pattern as getCustomerMembership / getCustomerMembershipTransactions).
export async function getCustomerVouchers(customerId) {
  try {
    if (!customerId) return { data: [], error: null };

    const { data: vouchers, error } = await supabaseCustomer
      .from('vouchers')
      .select(`
        id, voucher_code, issued_date, expiry_date, actual_price,
        discount_percent, total_amount_issued, remarks,
        voucher_type:voucher_types ( id, name, is_wallet )
      `)
      .eq('customer_id', customerId)
      .order('issued_date', { ascending: false });
    if (error) throw error;
    if (!vouchers || vouchers.length === 0) return { data: [], error: null };

    const { data: balances, error: balanceError } = await supabaseCustomer
      .from('voucher_balances')
      .select('voucher_id, total_claimed, remaining_balance, status, last_claim_date')
      .in('voucher_id', vouchers.map((v) => v.id));
    if (balanceError) throw balanceError;

    const balanceByVoucher = new Map((balances || []).map((b) => [b.voucher_id, b]));
    const merged = vouchers.map((v) => ({ ...v, ...(balanceByVoucher.get(v.id) || {}) }));
    return { data: merged, error: null };
  } catch (error) {
    console.error('[API] getCustomerVouchers error:', error.message);
    return { data: null, error };
  }
}

export async function getCustomerReferralStats(customerId) {
  try {
    if (!customerId) return { data: null, error: null };

    const { data, error } = await supabaseCustomer
      .from('customer_referrals')
      .select('id, reward_status, reward_amount, reward_type, reward_label, created_at, credited_at')
      .eq('referring_customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = data || [];
    const totalCredited = rows
      .filter((r) => r.reward_status === 'credited')
      .reduce((sum, r) => sum + Number(r.reward_amount || 0), 0);

    return {
      data: {
        referrals: rows,
        totalReferred: rows.length,
        totalCredited,
        pendingCount: rows.filter((r) => r.reward_status === 'pending').length,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] getCustomerReferralStats error:', error.message);
    return { data: null, error };
  }
}

export async function claimVoucher({
  voucherId, amountClaimed, redeemedDate = null, guestNameUsedBy = null,
  serviceClaimed = null, branchClaimedId, notes = null,
}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('claim_voucher', {
      p_voucher_id: voucherId,
      p_amount_claimed: amountClaimed,
      p_redeemed_date: redeemedDate,
      p_guest_name_used_by: guestNameUsedBy,
      p_service_claimed: serviceClaimed,
      p_branch_claimed_id: branchClaimedId,
      p_notes: notes,
    });
    if (error) throw error;
    capture('voucher_claimed', { voucher_id: voucherId, amount_claimed: amountClaimed });
    return { data, error: null };
  } catch (error) {
    console.error('[API] claimVoucher error:', error.message);
    return { data: null, error };
  }
}

// Voucher lookup for the booking payment screen — by code or guest name.
// Uses a SECURITY DEFINER RPC so any authenticated org member (staff
// included) can find a voucher to attach to a payment, without needing the
// broader manager/admin-only SELECT on `vouchers` itself. Only returns
// non-expired vouchers with a remaining balance > 0.
export async function searchVouchersForPayment(query) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('search_vouchers_for_payment', { p_query: query });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] searchVouchersForPayment error:', error.message);
    return { data: null, error };
  }
}

// This booking's own customer's linked voucher(s) with a remaining balance
// (migration-084/082) — auto-surfaced at checkout the same way
// fetchMembershipForBooking/fetchReferralRewardForBooking are, instead of
// requiring staff to manually search. A voucher only shows up here if it was
// linked to a customer at issuance (issue_voucher's optional p_customer_id);
// unlinked gift vouchers still rely on searchVouchersForPayment.
export async function fetchVouchersForBooking(bookingId) {
  try {
    if (!VOUCHER_ENABLED || !bookingId) return { data: [], error: null };
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('id', bookingId)
      .single();
    if (bErr) throw bErr;
    if (!booking?.customer_id) return { data: [], error: null };

    const { data, error } = await supabase.rpc('list_vouchers_for_customer', { p_customer_id: booking.customer_id });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchVouchersForBooking error:', error.message);
    return { data: [], error };
  }
}

// Single voucher + its live balance, for the detail/claim modal.
export async function fetchVoucher(voucherId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [voucherRes, balanceRes] = await Promise.all([
      supabase
        .from('vouchers')
        .select(`
          id, voucher_code, issued_date, expiry_date, guest_name, guest_info,
          actual_price, discount_percent, total_amount_issued, remarks, created_at,
          branch:branches ( id, name ),
          voucher_type:voucher_types ( id, name, is_wallet ),
          issuer:users!issued_by ( id, full_name )
        `)
        .eq('id', voucherId)
        .single(),
      supabase
        .from('voucher_balances')
        .select('total_claimed, remaining_balance, status, last_claim_date')
        .eq('voucher_id', voucherId)
        .maybeSingle(),
    ]);
    if (voucherRes.error) throw voucherRes.error;

    const v = voucherRes.data;
    const balance = balanceRes.data || {};
    return {
      data: {
        id: v.id,
        voucherCode: v.voucher_code,
        issuedDate: v.issued_date,
        expiryDate: v.expiry_date,
        guestName: v.guest_name,
        guestInfo: v.guest_info,
        branchId: v.branch?.id || null,
        branchName: v.branch?.name || '—',
        voucherTypeId: v.voucher_type?.id || null,
        voucherTypeName: v.voucher_type?.name || '—',
        isWallet: !!v.voucher_type?.is_wallet,
        actualPrice: Number(v.actual_price || 0),
        discountPercent: Number(v.discount_percent || 0),
        totalAmountIssued: Number(v.total_amount_issued || 0),
        remarks: v.remarks,
        issuedByName: v.issuer?.full_name || '—',
        totalClaimed: Number(balance.total_claimed || 0),
        remainingBalance: balance.remaining_balance != null
          ? Number(balance.remaining_balance)
          : Number(v.total_amount_issued || 0),
        status: balance.status || 'unused',
        lastClaimDate: balance.last_claim_date || null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchVoucher error:', error.message);
    return { data: null, error };
  }
}

export async function fetchVoucherClaims(voucherId) {
  try {
    const { data, error } = await supabase
      .from('voucher_claims')
      .select(`
        id, redeemed_date, guest_name_used_by, service_claimed, amount_claimed, notes, created_at,
        branch:branches ( id, name ),
        performer:users!performed_by ( id, full_name )
      `)
      .eq('voucher_id', voucherId)
      .order('redeemed_date', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchVoucherClaims error:', error.message);
    return { data: null, error };
  }
}

// "All Voucher" dashboard: org-wide totals, status breakdown, wallet summary,
// and a per-branch table (vouchers given to each branch, and that branch's
// outstanding liability — the value still unredeemed out of what IT issued).
// Unlike the old Excel Dashboard, "amount claimed" here is never silently
// dropped by a blank branch cell — voucher_claims.branch_claimed_id is
// NOT NULL at the DB level (see migration-071), and outstanding is read
// straight off voucher_balances (computed from ALL claims against a voucher,
// regardless of which branch claimed it).
export async function fetchVoucherOverview() {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [vouchersRes, balancesRes, claimsRes, branchesRes] = await Promise.all([
      supabase.from('vouchers').select(`
        id, branch_id, total_amount_issued,
        voucher_type:voucher_types ( is_wallet )
      `),
      supabase.from('voucher_balances').select('voucher_id, total_claimed, remaining_balance, status'),
      supabase.from('voucher_claims').select('branch_claimed_id, amount_claimed'),
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    ]);
    if (vouchersRes.error) throw vouchersRes.error;
    if (balancesRes.error) throw balancesRes.error;
    if (claimsRes.error) throw claimsRes.error;
    if (branchesRes.error) throw branchesRes.error;

    const balanceByVoucher = new Map((balancesRes.data || []).map((b) => [b.voucher_id, b]));
    const vouchers = (vouchersRes.data || []).map((v) => {
      const balance = balanceByVoucher.get(v.id) || {};
      return {
        id: v.id,
        branchId: v.branch_id,
        isWallet: !!v.voucher_type?.is_wallet,
        totalAmountIssued: Number(v.total_amount_issued || 0),
        totalClaimed: Number(balance.total_claimed || 0),
        remainingBalance: balance.remaining_balance != null
          ? Number(balance.remaining_balance)
          : Number(v.total_amount_issued || 0),
        status: balance.status || 'unused',
      };
    });

    const totals = vouchers.reduce((acc, v) => ({
      totalVouchers: acc.totalVouchers + 1,
      totalIssuedAmount: acc.totalIssuedAmount + v.totalAmountIssued,
      totalClaimedAmount: acc.totalClaimedAmount + v.totalClaimed,
      totalRemaining: acc.totalRemaining + v.remainingBalance,
    }), { totalVouchers: 0, totalIssuedAmount: 0, totalClaimedAmount: 0, totalRemaining: 0 });

    const statusCounts = vouchers.reduce((acc, v) => {
      acc[v.status] = (acc[v.status] || 0) + 1;
      return acc;
    }, { unused: 0, partially_used: 0, fully_redeemed: 0 });

    const walletVouchers = vouchers.filter((v) => v.isWallet);
    const walletSummary = walletVouchers.reduce((acc, v) => ({
      count: acc.count + 1,
      issuedAmount: acc.issuedAmount + v.totalAmountIssued,
      claimedAmount: acc.claimedAmount + v.totalClaimed,
      remainingAmount: acc.remainingAmount + v.remainingBalance,
    }), { count: 0, issuedAmount: 0, claimedAmount: 0, remainingAmount: 0 });

    const claimsByBranch = new Map();
    (claimsRes.data || []).forEach((c) => {
      const row = claimsByBranch.get(c.branch_claimed_id) || { count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(c.amount_claimed || 0);
      claimsByBranch.set(c.branch_claimed_id, row);
    });

    const issuedByBranch = new Map();
    vouchers.forEach((v) => {
      const row = issuedByBranch.get(v.branchId) || { count: 0, amount: 0, outstanding: 0 };
      row.count += 1;
      row.amount += v.totalAmountIssued;
      row.outstanding += v.remainingBalance;
      issuedByBranch.set(v.branchId, row);
    });

    const branches = (branchesRes.data || []).map((b) => {
      const issued = issuedByBranch.get(b.id) || { count: 0, amount: 0, outstanding: 0 };
      const claimed = claimsByBranch.get(b.id) || { count: 0, amount: 0 };
      return {
        branchId: b.id,
        branchName: b.name,
        issuedCount: issued.count,
        issuedAmount: issued.amount,
        claimedCount: claimed.count,
        claimedAmount: claimed.amount,
        outstanding: issued.outstanding,
      };
    });

    return { data: { totals, statusCounts, walletSummary, branches }, error: null };
  } catch (error) {
    console.error('[API] fetchVoucherOverview error:', error.message);
    return { data: null, error };
  }
}

// Wallet-type ("Worth Voucher") detail view: who issued it, which branch(es)
// claimed against it, and — for partially-used ones — the full claim
// breakdown underneath. Mirrors WalletUsagePanel's membership pattern.
export async function fetchVoucherWallets() {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [vouchersRes, balancesRes] = await Promise.all([
      supabase.from('vouchers').select(`
        id, voucher_code, issued_date, expiry_date, guest_name, guest_info,
        total_amount_issued, remarks,
        branch:branches ( id, name ),
        voucher_type:voucher_types ( id, name, is_wallet ),
        issuer:users!issued_by ( id, full_name )
      `).order('guest_name', { ascending: true }),
      supabase.from('voucher_balances').select('voucher_id, total_claimed, remaining_balance, status, last_claim_date'),
    ]);
    if (vouchersRes.error) throw vouchersRes.error;
    if (balancesRes.error) throw balancesRes.error;

    const wallets = (vouchersRes.data || []).filter((v) => v.voucher_type?.is_wallet);
    const balanceByVoucher = new Map((balancesRes.data || []).map((b) => [b.voucher_id, b]));

    const walletIds = wallets.map((v) => v.id);
    let claims = [];
    if (walletIds.length > 0) {
      const { data: claimsData, error: claimsError } = await supabase
        .from('voucher_claims')
        .select(`
          id, voucher_id, redeemed_date, guest_name_used_by, service_claimed, amount_claimed, notes,
          branch:branches ( id, name )
        `)
        .in('voucher_id', walletIds)
        .order('redeemed_date', { ascending: true });
      if (claimsError) throw claimsError;
      claims = claimsData || [];
    }
    const claimsByVoucher = new Map();
    claims.forEach((c) => {
      if (!claimsByVoucher.has(c.voucher_id)) claimsByVoucher.set(c.voucher_id, []);
      claimsByVoucher.get(c.voucher_id).push({
        id: c.id,
        redeemedDate: c.redeemed_date,
        guestNameUsedBy: c.guest_name_used_by,
        serviceClaimed: c.service_claimed,
        amountClaimed: Number(c.amount_claimed || 0),
        notes: c.notes,
        branchName: c.branch?.name || '—',
      });
    });

    const rows = wallets.map((v) => {
      const balance = balanceByVoucher.get(v.id) || {};
      return {
        id: v.id,
        voucherCode: v.voucher_code,
        voucherTypeName: v.voucher_type?.name || '—',
        issuedDate: v.issued_date,
        expiryDate: v.expiry_date,
        guestName: v.guest_name,
        guestInfo: v.guest_info,
        remarks: v.remarks,
        issuedBranchName: v.branch?.name || '—',
        issuedByName: v.issuer?.full_name || '—',
        totalAmountIssued: Number(v.total_amount_issued || 0),
        totalClaimed: Number(balance.total_claimed || 0),
        remainingBalance: balance.remaining_balance != null
          ? Number(balance.remaining_balance)
          : Number(v.total_amount_issued || 0),
        status: balance.status || 'unused',
        lastClaimDate: balance.last_claim_date || null,
        claims: claimsByVoucher.get(v.id) || [],
      };
    });

    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchVoucherWallets error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Outreach (Phase 1) — rules, templates, message outbox/log, provider +
// AI config. Writes to outreach_messages always go through SECURITY
// DEFINER RPCs (outreach_enqueue_for_completed / outreach_scan_winback,
// both migration-108; outreach_send_manual, migration-110) — the table has
// no broad client INSERT policy by design (migration-104). Reads on
// outreach_messages/outreach_drafts/outreach_provider_config/
// outreach_ai_config are manager/admin only at the RLS layer; the writes
// below are additionally gated client-side for a clean error message
// before the DB rejects them.
// ============================================================

// ---- Rules ----------------------------------------------------------------

export async function fetchOutreachRules() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('outreach_rules')
      .select(`
        id, org_id, trigger_type, enabled, channel, template_id, send_mode, use_ai,
        lapsed_days, review_delay_hours, renewal_days_before, rebooking_interval_days,
        birthday_lead_days, quiet_hours, created_at, updated_at,
        template:outreach_templates ( id, key, channel, subject )
      `)
      .eq('org_id', profile.org_id)
      .order('trigger_type', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchOutreachRules error:', error.message);
    return { data: null, error };
  }
}

export async function createOutreachRule(payload) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create outreach rules.' } };
    }

    const { data, error } = await supabase
      .from('outreach_rules')
      .insert({
        org_id: profile.org_id,
        trigger_type: payload.triggerType,
        enabled: payload.enabled ?? false,
        channel: payload.channel,
        template_id: payload.templateId,
        send_mode: payload.sendMode || 'review',
        use_ai: payload.useAi ?? false,
        lapsed_days: payload.lapsedDays ?? null,
        review_delay_hours: payload.reviewDelayHours ?? 24,
        renewal_days_before: payload.renewalDaysBefore ?? null,
        rebooking_interval_days: payload.rebookingIntervalDays ?? null,
        birthday_lead_days: payload.birthdayLeadDays ?? null,
        quiet_hours: payload.quietHours || {},
      })
      .select('id, trigger_type, enabled, channel, template_id, send_mode')
      .single();

    if (error) throw error;
    capture('outreach_rule_created', { trigger_type: payload.triggerType, channel: payload.channel, send_mode: payload.sendMode || 'review' });
    return { data, error: null };
  } catch (error) {
    console.error('[API] createOutreachRule error:', error.message);
    return { data: null, error };
  }
}

export async function updateOutreachRule(id, payload) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update outreach rules.' } };
    }

    const updates = {};
    if (payload.channel !== undefined) updates.channel = payload.channel;
    if (payload.templateId !== undefined) updates.template_id = payload.templateId;
    if (payload.sendMode !== undefined) updates.send_mode = payload.sendMode;
    if (payload.useAi !== undefined) updates.use_ai = payload.useAi;
    if (payload.enabled !== undefined) updates.enabled = payload.enabled;
    if (payload.lapsedDays !== undefined) updates.lapsed_days = payload.lapsedDays;
    if (payload.reviewDelayHours !== undefined) updates.review_delay_hours = payload.reviewDelayHours;
    if (payload.renewalDaysBefore !== undefined) updates.renewal_days_before = payload.renewalDaysBefore;
    if (payload.rebookingIntervalDays !== undefined) updates.rebooking_interval_days = payload.rebookingIntervalDays;
    if (payload.birthdayLeadDays !== undefined) updates.birthday_lead_days = payload.birthdayLeadDays;
    if (payload.quietHours !== undefined) updates.quiet_hours = payload.quietHours;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('outreach_rules')
      .update(updates)
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select('id, trigger_type, enabled, channel, template_id, send_mode')
      .single();

    if (error) throw error;
    capture('outreach_rule_updated', { rule_id: id, trigger_type: data.trigger_type });
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateOutreachRule error:', error.message);
    return { data: null, error };
  }
}

export async function deleteOutreachRule(id) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete outreach rules.' } };
    }

    const { error } = await supabase
      .from('outreach_rules')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id);

    if (error) throw error;
    capture('outreach_rule_deleted', { rule_id: id });
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteOutreachRule error:', error.message);
    return { data: null, error };
  }
}

export async function toggleOutreachRule(id, enabled) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can enable/disable outreach rules.' } };
    }

    const { data, error } = await supabase
      .from('outreach_rules')
      .update({ enabled: !!enabled, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select('id, trigger_type, enabled')
      .single();

    if (error) throw error;
    capture('outreach_rule_toggled', { rule_id: id, enabled: !!enabled, trigger_type: data.trigger_type });
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleOutreachRule error:', error.message);
    return { data: null, error };
  }
}

export async function setOutreachRuleSendMode(id, sendMode) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can change the send mode.' } };
    }

    if (!['auto', 'review'].includes(sendMode)) {
      return { data: null, error: { code: 'VALIDATION', message: 'sendMode must be "auto" or "review".' } };
    }

    const { data, error } = await supabase
      .from('outreach_rules')
      .update({ send_mode: sendMode, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select('id, trigger_type, send_mode')
      .single();

    if (error) throw error;
    capture('outreach_rule_send_mode_changed', { rule_id: id, send_mode: sendMode, trigger_type: data.trigger_type });
    return { data, error: null };
  } catch (error) {
    console.error('[API] setOutreachRuleSendMode error:', error.message);
    return { data: null, error };
  }
}

// ---- Templates --------------------------------------------------------------

export async function fetchOutreachTemplates() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('outreach_templates')
      .select('id, org_id, branch_id, key, channel, subject, body, whatsapp_template_name, whatsapp_template_lang, is_active, created_at, updated_at')
      .eq('org_id', profile.org_id)
      .order('key', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchOutreachTemplates error:', error.message);
    return { data: null, error };
  }
}

export async function upsertOutreachTemplate(payload) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage outreach templates.' } };
    }

    if (!payload.key || !payload.key.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Template key is required.' } };
    }
    if (!payload.body || !payload.body.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Template body is required.' } };
    }

    const row = {
      org_id: profile.org_id,
      branch_id: payload.branchId ?? null,
      key: payload.key.trim(),
      channel: payload.channel,
      subject: payload.subject ?? null,
      body: payload.body,
      whatsapp_template_name: payload.whatsappTemplateName ?? null,
      whatsapp_template_lang: payload.whatsappTemplateLang ?? null,
      is_active: payload.isActive ?? true,
      updated_at: new Date().toISOString(),
    };
    if (payload.id) row.id = payload.id;

    const { data, error } = await supabase
      .from('outreach_templates')
      .upsert(row, { onConflict: payload.id ? 'id' : 'org_id,key' })
      .select('id, key, channel, subject, body, is_active')
      .single();

    if (error) throw error;
    capture('outreach_template_saved', { template_id: data.id, key: data.key, channel: data.channel, is_new: !payload.id });
    return { data, error: null };
  } catch (error) {
    console.error('[API] upsertOutreachTemplate error:', error.message);
    return { data: null, error };
  }
}

export async function deleteOutreachTemplate(id) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete outreach templates.' } };
    }

    const { error } = await supabase
      .from('outreach_templates')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id);

    if (error) throw error;
    capture('outreach_template_deleted', { template_id: id });
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteOutreachTemplate error:', error.message);
    return { data: null, error };
  }
}

// Preview-only, client-side string replace — mirrors the server-side
// `replace(body, '{{customer_name}}', ...)` calls in outreach_scan_winback /
// outreach_enqueue_for_completed (migration-108/109). Not used to generate
// what actually gets sent — those RPCs render server-side at insert time.
export function renderTemplatePreview(template, sampleCustomerName = 'Jane Doe') {
  if (!template) return { subject: '', body: '' };
  const name = sampleCustomerName || 'Jane Doe';
  return {
    subject: (template.subject || '').split('{{customer_name}}').join(name),
    body: (template.body || '').split('{{customer_name}}').join(name),
  };
}

// ---- Messages (outbox / send log) --------------------------------------------

// filters: { status, channel, dateFrom, dateTo, customerId } — all optional.
// Manager/admin only (RLS-enforced on outreach_messages; see migration-104).
export async function fetchOutreachMessages(filters = {}) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can view outreach messages.' } };
    }

    let query = supabase
      .from('outreach_messages')
      .select(`
        id, org_id, rule_id, customer_id, booking_id, channel, to_address, subject, body,
        status, source, provider, provider_message_id, error, dedupe_key, scheduled_for,
        sent_at, created_at, updated_at,
        customer:customers ( id, full_name, email, phone ),
        rule:outreach_rules ( id, trigger_type )
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.channel) query = query.eq('channel', filters.channel);
    if (filters.customerId) query = query.eq('customer_id', filters.customerId);
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo);
    if (filters.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchOutreachMessages error:', error.message);
    return { data: null, error };
  }
}

export async function fetchOutreachReviewQueue() {
  return fetchOutreachMessages({ status: 'review' });
}

// overrides: { subject, body } — optional. When provided (e.g. the operator
// edited the message in ReviewQueuePanel before approving), they're
// persisted onto the row via the outreach_approve_message SECURITY DEFINER
// RPC (migration-111) so the edited content is what actually gets sent.
// Omitting overrides approves the message as queued, unchanged.
export async function approveOutreachMessage(id, overrides = {}) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can approve outreach messages.' } };
    }

    const { error } = await supabase.rpc('outreach_approve_message', {
      p_message_id: id,
      p_subject: overrides.subject ?? null,
      p_body: overrides.body ?? null,
    });

    if (error) throw error;
    capture('outreach_message_approved', { message_id: id, edited: Boolean(overrides.subject || overrides.body) });
    return { data: { id, status: 'approved' }, error: null };
  } catch (error) {
    console.error('[API] approveOutreachMessage error:', error.message);
    return { data: null, error };
  }
}

export async function cancelOutreachMessage(id) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can cancel outreach messages.' } };
    }

    const { error } = await supabase.rpc('outreach_cancel_message', {
      p_message_id: id,
    });

    if (error) throw error;
    capture('outreach_message_cancelled', { message_id: id });
    return { data: { id, status: 'cancelled' }, error: null };
  } catch (error) {
    console.error('[API] cancelOutreachMessage error:', error.message);
    return { data: null, error };
  }
}

export async function bulkApproveOutreach(ids) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can approve outreach messages.' } };
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return { data: null, error: { code: 'VALIDATION', message: 'At least one message id is required.' } };
    }

    const { data: updatedCount, error } = await supabase.rpc('outreach_bulk_approve_messages', {
      p_message_ids: ids,
    });

    if (error) throw error;
    capture('outreach_message_bulk_approved', { count: updatedCount ?? 0, requested: ids.length });
    return { data: { updatedCount: updatedCount ?? 0, requested: ids.length }, error: null };
  } catch (error) {
    console.error('[API] bulkApproveOutreach error:', error.message);
    return { data: null, error };
  }
}

// Status counts for the current org, last 30 days — powers a lightweight
// outreach dashboard summary card.
export async function fetchOutreachAnalytics() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can view outreach analytics.' } };
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('outreach_messages')
      .select('status')
      .eq('org_id', profile.org_id)
      .gte('created_at', since);

    if (error) throw error;

    const counts = { queued: 0, review: 0, approved: 0, sending: 0, sent: 0, delivered: 0, failed: 0, cancelled: 0 };
    (data || []).forEach((row) => {
      if (counts[row.status] !== undefined) counts[row.status] += 1;
    });

    return { data: { total: (data || []).length, byStatus: counts, sinceDate: since }, error: null };
  } catch (error) {
    console.error('[API] fetchOutreachAnalytics error:', error.message);
    return { data: null, error };
  }
}

// ---- Provider config (non-secret settings only — no API keys) ---------------

export async function fetchOutreachProviderConfig() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can view provider configuration.' } };
    }

    const { data, error } = await supabase
      .from('outreach_provider_config')
      .select('id, channel, provider, from_address, settings, created_at, updated_at')
      .eq('org_id', profile.org_id)
      .order('channel', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchOutreachProviderConfig error:', error.message);
    return { data: null, error };
  }
}

// No API key / secret field is ever accepted here by design — the
// outreach_provider_config table has no column for one (migration-106).
// Secrets live only in Edge Function environment variables. This guard
// throws a clear client-side error if a caller mistakenly tries to pass a
// key-shaped field, rather than silently dropping it.
const PROVIDER_CONFIG_SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|credential)/i;

export async function upsertOutreachProviderConfig(payload) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update provider configuration.' } };
    }

    const suspectKey = Object.keys(payload || {}).find((k) => PROVIDER_CONFIG_SECRET_KEY_PATTERN.test(k));
    if (suspectKey) {
      return { data: null, error: { code: 'VALIDATION', message: `Refusing to store key-shaped field "${suspectKey}" — provider secrets must never be sent from the client. Configure them as Edge Function environment variables instead.` } };
    }
    const settingsSuspectKey = payload?.settings && typeof payload.settings === 'object'
      ? Object.keys(payload.settings).find((k) => PROVIDER_CONFIG_SECRET_KEY_PATTERN.test(k))
      : null;
    if (settingsSuspectKey) {
      return { data: null, error: { code: 'VALIDATION', message: `Refusing to store key-shaped field "${settingsSuspectKey}" in settings — provider secrets must never be sent from the client.` } };
    }

    const row = {
      org_id: profile.org_id,
      channel: payload.channel,
      provider: payload.provider,
      from_address: payload.fromAddress ?? null,
      settings: payload.settings || {},
      updated_at: new Date().toISOString(),
    };
    if (payload.id) row.id = payload.id;

    const { data, error } = await supabase
      .from('outreach_provider_config')
      .upsert(row, { onConflict: payload.id ? 'id' : 'org_id,channel' })
      .select('id, channel, provider, from_address, settings')
      .single();

    if (error) throw error;
    capture('outreach_provider_config_saved', { channel: data.channel, provider: data.provider });
    return { data, error: null };
  } catch (error) {
    console.error('[API] upsertOutreachProviderConfig error:', error.message);
    return { data: null, error };
  }
}

// ---- AI config (ships now; nothing calls AI yet in Phase 1) -----------------

export async function fetchOutreachAiConfig() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can view AI configuration.' } };
    }

    const { data, error } = await supabase
      .from('outreach_ai_config')
      .select('id, org_id, ai_enabled, chatbot_enabled, monthly_token_budget, tokens_used_this_period, period_started_at, model, created_at, updated_at')
      .eq('org_id', profile.org_id)
      .maybeSingle();
    if (error) throw error;
    return { data: data || null, error: null };
  } catch (error) {
    console.error('[API] fetchOutreachAiConfig error:', error.message);
    return { data: null, error };
  }
}

export async function updateOutreachAiConfig(payload) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update AI configuration.' } };
    }

    const row = {
      org_id: profile.org_id,
      updated_at: new Date().toISOString(),
    };
    if (payload.aiEnabled !== undefined) row.ai_enabled = payload.aiEnabled;
    if (payload.chatbotEnabled !== undefined) row.chatbot_enabled = payload.chatbotEnabled;
    if (payload.monthlyTokenBudget !== undefined) row.monthly_token_budget = payload.monthlyTokenBudget;
    if (payload.model !== undefined) row.model = payload.model;

    const { data, error } = await supabase
      .from('outreach_ai_config')
      .upsert(row, { onConflict: 'org_id' })
      .select('id, ai_enabled, chatbot_enabled, monthly_token_budget, model')
      .single();

    if (error) throw error;
    capture('outreach_ai_config_updated', { ai_enabled: data.ai_enabled, chatbot_enabled: data.chatbot_enabled });
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateOutreachAiConfig error:', error.message);
    return { data: null, error };
  }
}

// ---- Manual one-off send ------------------------------------------------------

// Inserts one outreach_messages row via the outreach_send_manual SECURITY
// DEFINER RPC (migration-110) — outreach_messages has no client INSERT
// policy by design (migration-104), so this cannot be a raw .insert().
export async function sendCustomerMessage({ customerId, bookingId = null, channel, toAddress, subject = null, body }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!customerId || !channel || !toAddress || !body) {
      return { data: null, error: { code: 'VALIDATION', message: 'customerId, channel, toAddress, and body are required.' } };
    }

    const dedupeKey = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `manual:${crypto.randomUUID()}`
      : `manual:${customerId}:${Date.now()}`;

    const { data: messageId, error } = await supabase.rpc('outreach_send_manual', {
      p_customer_id: customerId,
      p_booking_id: bookingId,
      p_channel: channel,
      p_to_address: toAddress,
      p_subject: subject,
      p_body: body,
      p_dedupe_key: dedupeKey,
    });

    if (error) throw error;
    capture('outreach_manual_message_sent', { customer_id: customerId, channel, has_booking: !!bookingId, sender_role: profile.role });
    return { data: { id: messageId }, error: null };
  } catch (error) {
    console.error('[API] sendCustomerMessage error:', error.message);
    return { data: null, error };
  }
}
