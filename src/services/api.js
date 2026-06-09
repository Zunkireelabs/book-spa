import { supabase } from '../lib/supabase';

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
  'Pending':      ['Confirmed', 'Cancelled'],
  'Confirmed':    ['In-Progress', 'Cancelled', 'No Show'],
  'In-Progress':  ['Completed'],
  'Completed':    [],
  'Cancelled':    [],
  'No Show':      [],
};

const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'No Show'];

const DISCOUNT_LIMITS = {
  staff:   0.15, // 15% — staff auto-approve; 15–50% must be requested to an approver
  manager: 0.50, // 50%
  admin:   0.50, // 50%
};

// Absolute ceiling — no role (and no staff request) may exceed this.
const MAX_DISCOUNT_PERCENT = 0.50;

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
// Parse room capacity from amenities (e.g., "3 Chair" → 3, "2 Bed" → 2)
function getRoomCapacity(room) {
  if (!room.amenities || room.amenities.length === 0) return 1;
  const match = room.amenities[0].match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
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
      .select('id, name, amenities, floor')
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
        .in('status', ['Absent', 'Leave']);
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
        room:rooms(id, name)
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

export async function recordPayment({ bookingId, paymentMode, notes }) {
  try {
    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, payment_status, final_amount, is_locked')
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

    // 3. Already paid check
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

    // 6. Insert payment
    const { data: payment, error: insertError } = await supabase
      .from('payments')
      .insert({
        booking_id: bookingId,
        amount: Number(booking.final_amount),
        payment_mode: paymentMode,
        recorded_by: user.id,
        notes: notes || null,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return { data: null, error: { code: 'ALREADY_PAID', message: 'Payment has already been recorded for this booking.' } };
      }
      throw insertError;
    }

    return { data: { success: true, paymentId: payment.id, bookingId }, error: null };
  } catch (error) {
    console.error('[API] recordPayment error:', error.message);
    return { data: null, error };
  }
}

export async function updateBookingStatus({ bookingId, newStatus }) {
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
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({ status: newStatus })
      .eq('id', bookingId)
      .select('id, status')
      .single();

    if (updateError) throw updateError;

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
        .select('id, name, is_active')
        .in('id', ids);

      const inactive = (therapistsData || []).find(t => !t.is_active);
      if (inactive) {
        return { data: null, error: { code: 'THERAPIST_INACTIVE', message: `Cannot assign inactive therapist: ${inactive.name}` } };
      }

      if (booking.date) {
        const { data: absentRecords } = await supabase
          .from('therapist_attendance')
          .select('therapist_id, status')
          .in('therapist_id', ids)
          .eq('date', booking.date)
          .in('status', ['Absent', 'Leave']);
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
      updatePayload.customer_phone = customerPhone || null;
    }
    if (specialRequests !== undefined) {
      updatePayload.special_requests = specialRequests || null;
    }
    if (referredBy !== undefined) {
      updatePayload.referred_by = referredBy || null;
    }

    // 5. If service changed, recalculate financials and duration
    const effectiveServiceId = serviceId !== undefined ? serviceId : booking.service_id;
    if (serviceId && serviceId !== booking.service_id) {
      const { data: newService, error: svcError } = await supabase
        .from('services')
        .select('id, name, duration_minutes, price_npr')
        .eq('id', serviceId)
        .single();

      if (svcError || !newService) {
        return { data: null, error: { code: 'SERVICE_NOT_FOUND', message: 'Selected service not found.' } };
      }

      updatePayload.service_id = serviceId;
      updatePayload.service_name_snapshot = newService.name;
      updatePayload.base_amount = newService.price_npr;
      // Preserve existing discount amount
      const discountAmt = Number(booking.discount_amount || 0);
      updatePayload.final_amount = Math.max(0, newService.price_npr - discountAmt);

      // Recalculate end_time based on new duration
      const effectiveStartTime = startTime || booking.start_time;
      updatePayload.end_time = addMinutesToTime(effectiveStartTime.slice(0, 5), newService.duration_minutes);
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
      if (updateError.code === '23P01') {
        return { data: null, error: { code: 'SCHEDULING_CONFLICT', message: 'The new date/time conflicts with an existing booking.' } };
      }
      throw updateError;
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

    // Hard ceiling: no role may apply, and no staff request may exceed, 50%.
    if (effectivePercent > MAX_DISCOUNT_PERCENT + 1e-9) {
      return { data: null, error: { code: 'DISCOUNT_LIMIT_EXCEEDED', message: 'Discount cannot exceed 50%.' } };
    }

    // 6. Role-based limit check (exceeding sends to pending approval)
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

    // 9. Update booking — trigger recomputes final_amount
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select('id, discount_amount, final_amount, discount_status')
      .single();

    if (updateError) throw updateError;

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
          .select('name, is_active')
          .eq('id', newTherapistId)
          .single();

        if (therapist && !therapist.is_active) {
          return { data: null, error: { code: 'THERAPIST_INACTIVE', message: 'Cannot assign an inactive therapist.' } };
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
        .select('id, name, amenities')
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
      throw updateError;
    }

    // 9. Sync booking_therapists times to match the rescheduled booking
    await supabase
      .from('booking_therapists')
      .update({ start_time: updated.start_time, end_time: updated.end_time })
      .eq('booking_id', bookingId);

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

    // 2. Revenue from paid bookings only
    const paid = all.filter(b => b.payment_status === 'paid');
    const grossRevenue = paid.reduce((sum, b) => sum + Number(b.base_amount), 0);
    const totalDiscounts = paid.reduce((sum, b) => sum + Number(b.discount_amount), 0);
    const netRevenue = paid.reduce((sum, b) => sum + Number(b.final_amount), 0);

    // 3. Unpaid count (Confirmed or Completed but unpaid)
    const unpaidCount = all.filter(
      b => b.payment_status === 'unpaid' && ['Confirmed', 'Completed'].includes(b.status)
    ).length;

    // 4. Payment mode breakdown — need to join payments table
    const paidBookingIds = paid.map(b => b.id);
    let paymentBreakdown = { cash: 0, card: 0, fonepay: 0 };

    if (paidBookingIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('amount, payment_mode')
        .in('booking_id', paidBookingIds);

      if (paymentsError) throw paymentsError;

      for (const p of (payments || [])) {
        const amount = Number(p.amount);
        if (p.payment_mode === 'Cash') {
          paymentBreakdown.cash += amount;
        } else if (p.payment_mode === 'Fonepay') {
          paymentBreakdown.fonepay += amount;
        } else {
          // Nabil, GlobalIME, NICAsia → card
          paymentBreakdown.card += amount;
        }
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

    // Fetch payments for all bookings in one query
    const bookingIds = all.map(b => b.id);
    let paymentsMap = {};

    if (bookingIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('booking_id, amount, payment_mode')
        .in('booking_id', bookingIds);

      if (paymentsError) throw paymentsError;

      for (const p of (payments || [])) {
        paymentsMap[p.booking_id] = p;
      }
    }

    // Build bookings list — Phase 9A: use snapshot fields for display
    const bookingsList = all.map(b => {
      const payment = paymentsMap[b.id];
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
        paymentMode: payment?.payment_mode || null,
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
      const paymentsArr = Object.values(paymentsMap);

      totals = {
        totalBookings: all.length,
        completedBookings: all.filter(b => b.status === 'Completed').length,
        cancelledBookings: all.filter(b => b.status === 'Cancelled').length,
        noShowBookings: all.filter(b => b.status === 'No Show').length,
        grossRevenue: paidBookings.reduce((sum, b) => sum + Number(b.base_amount), 0),
        totalDiscount: paidBookings.reduce((sum, b) => sum + Number(b.discount_amount), 0),
        // REVENUE LAW: netRevenue = SUM(payments.amount)
        netRevenue: paymentsArr.reduce((sum, p) => sum + Number(p.amount), 0),
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
      for (const p of Object.values(paymentsMap)) {
        const amount = Number(p.amount);
        if (p.payment_mode === 'Cash') {
          paymentBreakdown.cash += amount;
        } else if (p.payment_mode === 'Fonepay') {
          paymentBreakdown.fonepay += amount;
        } else {
          paymentBreakdown.card += amount;
        }
      }
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

    // Step 7 — Unpaid bookings
    const unpaidBookings = all
      .filter(b => b.payment_status === 'unpaid' && ['Confirmed', 'Completed'].includes(b.status))
      .map(b => ({
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        serviceName: b.service_name_snapshot || '—',
        finalAmount: Number(b.final_amount),
        status: b.status,
      }));

    return {
      data: {
        bookings: bookingsList,
        totals,
        paymentBreakdown,
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
  rows.push(`Card (Nabil/GlobalIME/NIC Asia),${paymentBreakdown.card.toFixed(2)}`);
  rows.push(`Fonepay,${paymentBreakdown.fonepay.toFixed(2)}`);

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

export async function getUtilizationIntelligence({ branchId, date }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const overall = isOverallBranch(branchId);
    const targetDate = date || new Date().toISOString().split('T')[0];

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
        branchWindow[br.id] = timeToMinutes(br.close_time) - timeToMinutes(br.open_time);
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
      operatingMinutes = closeMin - openMin; // e.g. 720 for 9:00–21:00
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
      .in('status', ['Absent', 'Leave']);
    attendanceQuery = withBranch(attendanceQuery, branchId);
    const [roomsResult, therapistsResult, attendanceResult] = await Promise.all([
      roomsQuery,
      therapistsQuery,
      attendanceQuery,
    ]);

    if (roomsResult.error) throw roomsResult.error;
    if (therapistsResult.error) throw therapistsResult.error;
    // Attendance errors are non-fatal — just ignore
    const absentIds = new Set();
    if (!attendanceResult.error && attendanceResult.data) {
      for (const a of attendanceResult.data) {
        absentIds.add(a.therapist_id);
      }
    }

    const rooms = roomsResult.data || [];
    const therapists = therapistsResult.data || [];
    // Available therapists = active minus absent/leave
    const availableTherapists = therapists.filter(t => !absentIds.has(t.id));

    // 3. Fetch qualifying bookings: Confirmed, In-Progress, Completed only
    let bookingsQuery = supabase
      .from('bookings')
      .select('id, room_id, therapist_id, start_time, end_time, service_duration_snapshot, status')
      .eq('date', targetDate)
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);
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

export async function fetchBookingById(bookingId) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        service:services(id, name, duration_minutes, price_npr),
        therapist:therapists(id, name, gender),
        room:rooms(id, name),
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

    // 2. Fetch therapists and rooms in parallel
    const [therapistsResult, roomsResult] = await Promise.all([
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
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (roomsResult.error) throw roomsResult.error;

    // 3. Fetch bookings in date range, excluding Cancelled
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, customer_phone, status, payment_status,
        date, start_time, end_time, start_datetime, end_datetime,
        therapist_id, room_id,
        base_amount, discount_amount, final_amount, special_requests,
        service:services(name, duration_minutes),
        therapist:therapists(id, name),
        room:rooms(id, name),
        creator:users!created_by(full_name),
        booking_therapists(therapist_id, start_time, end_time, therapist:therapists(id, name))
      `)
      .eq('branch_id', resolvedBranchId)
      .gte('date', startDate)
      .lte('date', endDate)
      .neq('status', 'Cancelled')
      .order('start_time');

    if (bookingsError) throw bookingsError;

    return {
      data: {
        branchHours: {
          openTime: branch.open_time || '09:00:00',
          closeTime: branch.close_time || '21:00:00',
          timezone: branch.timezone || 'Asia/Kathmandu',
        },
        therapists: therapistsResult.data || [],
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
          .select('id, name, is_active, amenities')
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
        // 3. Fetch active rooms for branch (with amenities for capacity)
        const { data: rooms, error: roomsError } = await supabase
          .from('rooms')
          .select('id, name, amenities')
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
    const orgId = branchData?.org_id || null;
    try {
      const phone = customerPhone?.replace(/\D/g, '') || null;
      const email = customerEmail?.trim().toLowerCase() || null;

      // Try to find existing customer by phone or email across the whole org
      let existingCustomer = null;
      if (orgId && phone) {
        const { data } = await supabase
          .from('customers')
          .select('id')
          .eq('org_id', orgId)
          .eq('phone', phone)
          .limit(1)
          .maybeSingle();
        existingCustomer = data;
      }
      if (!existingCustomer && orgId && email) {
        const { data } = await supabase
          .from('customers')
          .select('id')
          .eq('org_id', orgId)
          .eq('email', email)
          .limit(1)
          .maybeSingle();
        existingCustomer = data;
      }

      if (existingCustomer) {
        customerId = existingCustomer.id;
        // Update name if changed
        await supabase
          .from('customers')
          .update({ full_name: customerName, phone: phone || undefined, email: email || undefined })
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
          })
          .select('id')
          .single();
        if (newCustomer) {
          customerId = newCustomer.id;
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
          .in('status', ['Absent', 'Leave']);
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
        customer_phone: customerPhone || null,
        customer_gender: customerGender || null,
        date: date,
        start_time: startTime,
        base_amount: Number(service.price_npr),
        discount_amount: 0,
        special_requests: specialRequests || null,
        created_by: authUser?.id || null,
        booking_group_id: bookingGroupId || null,
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
        const msg = (insertError.message || '') + (insertError.details || '');
        if (msg.includes('therapist')) {
          return { data: null, error: { code: 'THERAPIST_CONFLICT', message: 'One or more selected therapists are already booked during this time slot.' } };
        }
        return { data: null, error: { code: 'ROOMS_FULL', message: 'Scheduling conflict. Please try a different time or room.' } };
      }
      throw insertError;
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

    return { data: booking, error: null };
  } catch (error) {
    console.error('[API] createBooking error:', error.message);
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
      .select('id, name, branch_id, is_active, amenities, floor, created_at')
      .eq('branch_id', effectiveBranchId)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchRoomsForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function createRoom({ name, branchId, amenities = [], floor = null }) {
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
      .insert({ name: name.trim(), branch_id: effectiveBranchId, is_active: true, amenities: amenities || [], floor: floor || null })
      .select('id, name, branch_id, is_active, amenities, floor, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createRoom error:', error.message);
    return { data: null, error };
  }
}

export async function updateRoom({ roomId, name, amenities, floor }) {
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

    const { data, error } = await supabase
      .from('rooms')
      .update(updatePayload)
      .eq('id', roomId)
      .select('id, name, branch_id, is_active, amenities, floor, created_at')
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
 * Transfer a staffer to another branch in the same org.
 * Authorization + the audit row are enforced server-side by the
 * SECURITY DEFINER transfer_therapist() function (migration-039):
 * only an admin, or the manager of the staffer's CURRENT branch, may transfer.
 */
export async function transferTherapist({ therapistId, toBranchId, note = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('transfer_therapist', {
      p_therapist_id: therapistId,
      p_to_branch_id: toBranchId,
      p_note: note,
    });

    if (error) throw error;
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
        id, transferred_at, note,
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
      note: t.note,
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

export async function updateTherapistOrder({ branchId, orderedIds }) {
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

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can manage services.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can create services.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can update service pricing.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can manage service status.' } };
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

    // Only admin can delete services (services are global, not branch-scoped)
    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can delete services.' } };
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

    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, phone')
      .eq('org_id', branch.org_id)
      .eq('is_active', true)
      .order('full_name');

    if (error) throw error;

    return { data: data || [], error: null };
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

const VALID_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Leave', '1st-Half Day', '2nd-Half Day'];

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
        checkInTime: att?.check_in_time || null,
        checkOutTime: att?.check_out_time || null,
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
      check_in_time: checkInTime || null,
      check_out_time: checkOutTime || null,
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
          check_in_time: checkInTime || null,
          check_out_time: checkOutTime || null,
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
      switch (r.status) {
        case 'Present': presentCount++; break;
        case 'Absent': absentCount++; break;
        case 'Leave': leaveCount++; break;
        case '1st-Half Day': halfDayCount++; break;
        case '2nd-Half Day': halfDayCount++; break;
      }
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
        case 'Leave': acc.leave++; acc.marked++; break;
        case '1st-Half Day':
        case '2nd-Half Day': acc.halfDay++; acc.marked++; break;
        default: break;
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
      .select('therapist_id, status, payment_status, final_amount, service_duration_snapshot')
      .gte('date', startDate)
      .lte('date', endDate)
      .in('therapist_id', therapistIds)
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status')
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

    // 3. Compute working days in range (for utilization denominator)
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    const totalDaysInRange = Math.max(1, Math.round((rangeEnd - rangeStart) / 86400000) + 1);

    // 4. Aggregate per therapist
    const bookingsByTherapist = {};
    const attendanceByTherapist = {};

    for (const t of therapists) {
      bookingsByTherapist[t.id] = [];
      attendanceByTherapist[t.id] = { total: 0, present: 0, daysWorked: 0 };
    }

    for (const b of allBookings) {
      if (bookingsByTherapist[b.therapist_id]) {
        bookingsByTherapist[b.therapist_id].push(b);
      }
    }

    for (const a of allAttendance) {
      if (attendanceByTherapist[a.therapist_id]) {
        attendanceByTherapist[a.therapist_id].total += 1;
        if (a.status === 'Present') {
          attendanceByTherapist[a.therapist_id].present += 1;
          attendanceByTherapist[a.therapist_id].daysWorked += 1;
        } else if (a.status === '1st-Half Day' || a.status === '2nd-Half Day') {
          attendanceByTherapist[a.therapist_id].present += 1;
          attendanceByTherapist[a.therapist_id].daysWorked += 0.5;
        }
        // Absent/Leave: 0 added to daysWorked
      }
    }

    // 5. Compute raw metrics per therapist
    const rawMetrics = therapists.map(t => {
      const bookings = bookingsByTherapist[t.id];
      const completedBookings = bookings.filter(b => b.status === 'Completed').length;
      const totalAssigned = bookings.length;
      const paidBookings = bookings.filter(b => b.payment_status === 'paid');
      const paidRevenue = paidBookings.reduce((sum, b) => sum + (Number(b.final_amount) || 0), 0);
      const completionRate = totalAssigned > 0 ? completedBookings / totalAssigned : 0;
      const avgRevenuePerBooking = completedBookings > 0 ? Math.round(paidRevenue / completedBookings) : 0;

      // Attendance rate
      const att = attendanceByTherapist[t.id];
      const attendanceRate = att.total > 0 ? att.present / att.total : (totalDaysInRange > 0 ? 1 : 0);

      // Utilization: total booked minutes / (operating minutes * days worked)
      // Present = 1.0 day, Half-Day = 0.5 day, Absent/Leave = 0.0 day
      const totalBookedMinutes = bookings.reduce((sum, b) => sum + (b.service_duration_snapshot || 0), 0);
      const daysWorked = att.total > 0 ? att.daysWorked : totalDaysInRange;
      const totalAvailableMinutes = daysWorked * dayWindowFor(t.branch_id);
      const utilizationRate = totalAvailableMinutes > 0 ? totalBookedMinutes / totalAvailableMinutes : 0;

      return {
        therapistId: t.id,
        therapistName: t.name,
        gender: t.gender,
        specialties: t.specialties || [],
        completedBookings,
        totalAssigned,
        paidRevenue,
        completionRate: Math.round(completionRate * 100),
        avgRevenuePerBooking,
        attendanceRate: Math.round(attendanceRate * 100),
        utilizationRate: Math.round(Math.min(utilizationRate, 1) * 100),
        _rawRevenue: paidRevenue,
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
// Service Categories Management (Admin only)
// ============================================================

/**
 * Fetch all categories for management (admin view)
 */
export async function fetchCategoriesForManagement() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can manage categories.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can create categories.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can update categories.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can toggle categories.' } };
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

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can delete categories.' } };
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
