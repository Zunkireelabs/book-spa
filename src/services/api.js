import { supabase } from '../lib/supabase';

// MVP: single branch — resolve mock branch IDs to real DB UUID
function resolveBranchId(branchId) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) {
    return branchId;
  }
  return 'b0000000-0000-0000-0000-000000000001';
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
  staff:   0.05, // 5%
  manager: 0.30, // 30%
  admin:   Infinity,
};

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
    .select('id, role, branch_id')
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

export async function fetchServices() {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr, description')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
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
      .select('id, name')
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

export async function fetchTherapists(branchId) {
  try {
    const { data, error } = await supabase
      .from('therapists')
      .select('id, name, gender, specialties')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
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
      .eq('branch_id', branchId)
      .order('start_time');

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

export async function assignTherapist({ bookingId, therapistId }) {
  try {
    // 1. Fetch booking (include room_id for snapshot)
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, branch_id, room_id')
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

    // 4. Phase 9A: Resolve snapshot names + Phase 9B: Check active status
    let therapistNameSnapshot = null;
    if (therapistId) {
      const { data: therapist } = await supabase
        .from('therapists')
        .select('name, is_active')
        .eq('id', therapistId)
        .single();

      if (therapist && !therapist.is_active) {
        return { data: null, error: { code: 'THERAPIST_INACTIVE', message: 'Cannot assign an inactive therapist.' } };
      }
      therapistNameSnapshot = therapist?.name || null;
    }

    let roomNameSnapshot = null;
    if (booking.room_id) {
      const { data: room } = await supabase
        .from('rooms')
        .select('name')
        .eq('id', booking.room_id)
        .single();
      roomNameSnapshot = room?.name || null;
    }

    // 5. Update — null therapistId means unassign
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({
        therapist_id: therapistId || null,
        therapist_name_snapshot: therapistNameSnapshot,
        room_name_snapshot: roomNameSnapshot,
      })
      .eq('id', bookingId)
      .select('id, therapist_id')
      .single();

    if (updateError) {
      // GIST exclusion: therapist double-booking
      if (updateError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: 'Therapist is already booked during this time slot.' } };
      }
      throw updateError;
    }

    return { data: { success: true, bookingId, therapistId: updated.therapist_id }, error: null };
  } catch (error) {
    console.error('[API] assignTherapist error:', error.message);
    return { data: null, error };
  }
}

export async function applyDiscount({ bookingId, discountType, discountValue, discountReason }) {
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

    // 2. Lifecycle checks
    const mutationError = validateBookingMutation(booking);
    if (mutationError) return { data: null, error: mutationError };

    // 3. Cannot change discount on paid bookings
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

    // 6. Role-based limit check
    const maxPercent = DISCOUNT_LIMITS[profile.role];
    if (effectivePercent > maxPercent) {
      const limitDisplay = maxPercent === Infinity ? 'unlimited' : `${Math.round(maxPercent * 100)}%`;
      return {
        data: null,
        error: {
          code: 'DISCOUNT_LIMIT_EXCEEDED',
          message: `Discount exceeds allowed limit for your role (max ${limitDisplay}).`,
        },
      };
    }

    // 7. Discount reason required
    if (!discountReason || !discountReason.trim()) {
      return { data: null, error: { code: 'DISCOUNT_REASON_REQUIRED', message: 'A reason is required when applying a discount.' } };
    }

    // 8. Update booking — trigger recomputes final_amount
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({
        discount_amount: discountAmount,
        discount_status: 'approved',
        discount_approved_by: user.id,
      })
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
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] applyDiscount error:', error.message);
    return { data: null, error };
  }
}

/**
 * Reschedule a booking to a new date/time.
 * Validates lifecycle, checks room availability, and updates the booking.
 */
export async function rescheduleBooking({ bookingId, newDate, newStartTime }) {
  try {
    // 1. Fetch booking with service duration and room
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, payment_status, room_id, service:services(duration_minutes)')
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

    // 6. Check room availability — overlapping bookings in same room (exclude cancelled/no-show)
    if (booking.room_id) {
      const { data: conflicts, error: conflictError } = await supabase
        .from('bookings')
        .select('id')
        .eq('room_id', booking.room_id)
        .eq('booking_date', newDate)
        .not('status', 'in', '("Cancelled","No Show")')
        .neq('id', bookingId)
        .lt('start_time', newEndTime)
        .gt('end_time', newStartTime);

      if (conflictError) throw conflictError;

      if (conflicts && conflicts.length > 0) {
        return {
          data: null,
          error: { code: 'ROOM_CONFLICT', message: 'The room is not available at the requested date/time.' },
        };
      }
    }

    // 7. Update the booking
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({
        booking_date: newDate,
        start_time: newStartTime,
      })
      .eq('id', bookingId)
      .select('id, booking_date, start_time, end_time')
      .single();

    if (updateError) throw updateError;

    return {
      data: {
        success: true,
        bookingId,
        bookingDate: updated.booking_date,
        startTime: updated.start_time,
        endTime: updated.end_time,
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
    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Fetch all bookings for the branch + date
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, status, payment_status, base_amount, discount_amount, final_amount')
      .eq('branch_id', resolvedBranchId)
      .eq('date', date);

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

    // 5. Check if day is already closed
    const { data: existingReport } = await supabase
      .from('daily_reports')
      .select('id, closed_at, closed_by')
      .eq('branch_id', resolvedBranchId)
      .eq('report_date', date)
      .maybeSingle();

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
      data: { success: true, reportId: report.id },
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

    const resolvedBranchId = resolveBranchId(branchId);

    // Step 1 — Check if day is closed (stored snapshot)
    const { data: closedReport, error: closedError } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('branch_id', resolvedBranchId)
      .eq('report_date', date)
      .maybeSingle();

    if (closedError) throw closedError;

    const isClosed = !!closedReport;

    // Step 2 — Fetch all bookings for branch + date
    // Phase 9A: Use snapshot fields for display instead of JOINed live data
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, status, payment_status,
        base_amount, discount_amount, final_amount, discount_status,
        discount_approved_by, therapist_id,
        service_name_snapshot, service_duration_snapshot, service_price_snapshot,
        therapist_name_snapshot, room_name_snapshot
      `)
      .eq('branch_id', resolvedBranchId)
      .eq('date', date)
      .order('start_time');

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
  const resolvedBranchId = resolveBranchId(branchId);

  // 1. Fetch closed-day snapshots in range
  const { data: reports, error: reportsError } = await supabase
    .from('daily_reports')
    .select('report_date, gross_revenue, total_discounts, net_revenue')
    .eq('branch_id', resolvedBranchId)
    .gte('report_date', startDate)
    .lte('report_date', endDate);

  if (reportsError) throw reportsError;

  const closedDates = new Set((reports || []).map(r => r.report_date));

  let closedGross = 0, closedDiscount = 0, closedNet = 0;
  for (const r of (reports || [])) {
    closedGross += Number(r.gross_revenue);
    closedDiscount += Number(r.total_discounts);
    closedNet += Number(r.net_revenue);
  }

  // 2. Fetch paid bookings in range
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('date, base_amount, discount_amount, final_amount')
    .eq('branch_id', resolvedBranchId)
    .eq('payment_status', 'paid')
    .gte('date', startDate)
    .lte('date', endDate);

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

    const resolvedBranchId = resolveBranchId(branchId);
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 1. Fetch branch operating hours
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('open_time, close_time')
      .eq('id', resolvedBranchId)
      .single();

    if (branchError) throw branchError;

    const openMin = timeToMinutes(branch.open_time);
    const closeMin = timeToMinutes(branch.close_time);
    const operatingMinutes = closeMin - openMin; // e.g. 720 for 9:00–21:00

    // 2. Fetch active rooms + therapists + attendance (parallel)
    const [roomsResult, therapistsResult, attendanceResult] = await Promise.all([
      supabase
        .from('rooms')
        .select('id, name')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true),
      supabase
        .from('therapists')
        .select('id, name')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true),
      supabase
        .from('therapist_attendance')
        .select('therapist_id, status')
        .eq('branch_id', resolvedBranchId)
        .eq('date', targetDate)
        .in('status', ['Absent', 'Leave']),
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
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, room_id, therapist_id, start_time, end_time, service_duration_snapshot, status')
      .eq('branch_id', resolvedBranchId)
      .eq('date', targetDate)
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);

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
      return {
        id: r.id,
        name: r.name,
        bookedMinutes: booked,
        totalMinutes: operatingMinutes,
        percent: operatingMinutes > 0 ? Math.round((booked / operatingMinutes) * 100) : 0,
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
      return {
        id: t.id,
        name: t.name,
        bookedMinutes: booked,
        totalMinutes: operatingMinutes,
        percent: operatingMinutes > 0 ? Math.round((booked / operatingMinutes) * 100) : 0,
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
    const totalRoomCapacity = rooms.length * operatingMinutes;
    const totalTherapistCapacity = availableTherapists.length * operatingMinutes;

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
        operatingMinutes,
        operatingHours: `${branch.open_time.slice(0, 5)}–${branch.close_time.slice(0, 5)}`,
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
        room:rooms(id, name)
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

    // 2. Fetch therapists for resource list
    const { data: therapists, error: therapistsError } = await supabase
      .from('therapists')
      .select('id, name, gender, specialties')
      .eq('branch_id', resolvedBranchId)
      .eq('is_active', true)
      .order('name');

    if (therapistsError) throw therapistsError;

    // 3. Fetch bookings in date range, excluding Cancelled
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id, booking_number, customer_name, status, payment_status,
        date, start_time, end_time, start_datetime, end_datetime,
        therapist_id,
        service:services(name),
        therapist:therapists(id, name)
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
        therapists: therapists || [],
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

    // 3. Fetch active rooms for branch
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name')
      .eq('branch_id', resolvedBranchId)
      .eq('is_active', true)
      .order('name');

    if (roomsError) throw roomsError;
    if (!rooms || rooms.length === 0) {
      return { data: null, error: { code: 'ROOMS_FULL', message: 'No rooms available at this branch.' } };
    }

    // 4. Find rooms with overlapping non-cancelled bookings
    const { data: overlapping, error: overlapError } = await supabase
      .from('bookings')
      .select('room_id')
      .eq('branch_id', resolvedBranchId)
      .eq('date', date)
      .neq('status', 'Cancelled')
      .lt('start_time', endTime)
      .gt('end_time', startTime);

    if (overlapError) throw overlapError;

    // 5. Pick first available room
    const occupiedRoomIds = new Set((overlapping || []).map(b => b.room_id));
    const availableRoom = rooms.find(r => !occupiedRoomIds.has(r.id));

    if (!availableRoom) {
      return { data: null, error: { code: 'ROOMS_FULL', message: 'Selected time slot is fully booked.' } };
    }

    // 6. Insert booking — triggers compute end_time, datetimes, final_amount, booking_number
    const { data: booking, error: insertError } = await supabase
      .from('bookings')
      .insert({
        branch_id: resolvedBranchId,
        room_id: availableRoom.id,
        service_id: serviceId,
        therapist_id: null,
        customer_name: customerName,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        customer_gender: customerGender || null,
        date: date,
        start_time: startTime,
        base_amount: Number(service.price_npr),
        discount_amount: 0,
        special_requests: specialRequests || null,
        created_by: null,
        // Phase 9A: Snapshot fields — preserve original values at booking time
        service_name_snapshot: service.name,
        service_duration_snapshot: service.duration_minutes,
        service_price_snapshot: Number(service.price_npr),
        room_name_snapshot: availableRoom.name,
      })
      .select()
      .single();

    if (insertError) {
      // GIST exclusion constraint: room overlap despite client-side check
      // (can happen if anon user RLS hides existing bookings from overlap query)
      if (insertError.code === '23P01') {
        return { data: null, error: { code: 'ROOMS_FULL', message: 'Selected time slot is fully booked.' } };
      }
      throw insertError;
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
      .select('id, name, branch_id, is_active, created_at')
      .eq('branch_id', effectiveBranchId)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchRoomsForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function createRoom({ name, branchId }) {
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
      .insert({ name: name.trim(), branch_id: effectiveBranchId, is_active: true })
      .select('id, name, branch_id, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createRoom error:', error.message);
    return { data: null, error };
  }
}

export async function updateRoom({ roomId, name }) {
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

    const { data, error } = await supabase
      .from('rooms')
      .update({ name: name.trim() })
      .eq('id', roomId)
      .select('id, name, branch_id, is_active, created_at')
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

export async function deleteRoom() {
  return { data: null, error: { code: 'HARD_DELETE_NOT_ALLOWED', message: 'Rooms cannot be deleted. Use deactivation instead.' } };
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

    const { data, error } = await supabase
      .from('therapists')
      .select('id, name, gender, specialties, branch_id, is_active, created_at')
      .eq('branch_id', effectiveBranchId)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistsForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function createTherapist({ name, gender, specialties, branchId }) {
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

    const { data, error } = await supabase
      .from('therapists')
      .insert({
        name: name.trim(),
        gender: gender || 'Male',
        specialties: specialties || [],
        branch_id: effectiveBranchId,
        is_active: true,
      })
      .select('id, name, gender, specialties, branch_id, is_active, created_at')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createTherapist error:', error.message);
    return { data: null, error };
  }
}

export async function updateTherapist({ therapistId, name, gender, specialties }) {
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

    const { data, error } = await supabase
      .from('therapists')
      .update(updatePayload)
      .eq('id', therapistId)
      .select('id, name, gender, specialties, branch_id, is_active, created_at')
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

export async function deleteTherapist() {
  return { data: null, error: { code: 'HARD_DELETE_NOT_ALLOWED', message: 'Therapists cannot be deleted. Use deactivation instead.' } };
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

    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr, description, is_active, created_at')
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchServicesForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function updateServicePricing({ serviceId, priceNpr, durationMinutes, description }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can update service pricing.' } };
    }

    const updatePayload = {};
    if (priceNpr !== undefined) updatePayload.price_npr = priceNpr;
    if (durationMinutes !== undefined) updatePayload.duration_minutes = durationMinutes;
    if (description !== undefined) updatePayload.description = description;

    if (Object.keys(updatePayload).length === 0) {
      return { data: null, error: { code: 'NO_CHANGES', message: 'No fields to update.' } };
    }

    const { data, error } = await supabase
      .from('services')
      .update(updatePayload)
      .eq('id', serviceId)
      .select('id, name, duration_minutes, price_npr, description, is_active')
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

    // If deactivating, check for future bookings
    if (!isActive) {
      const today = new Date().toISOString().split('T')[0];
      const { data: futureBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id')
        .eq('service_id', serviceId)
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

export async function deleteService() {
  return { data: null, error: { code: 'HARD_DELETE_NOT_ALLOWED', message: 'Services cannot be deleted. Use deactivation instead.' } };
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

    // Branch filter (manager always scoped; admin optional)
    if (effectiveBranchId) {
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

    // 2. Fetch all bookings for this customer (branch-scoped via customer's branch_id)
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        booking_number, date, status, payment_status,
        final_amount, discount_amount,
        service_name_snapshot, therapist_name_snapshot,
        is_locked
      `)
      .eq('customer_id', customerId)
      .eq('branch_id', customer.branch_id)
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

    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Parallel fetch: customers + bookings
    const [custResult, bookResult] = await Promise.all([
      supabase
        .from('customers')
        .select('id, full_name, phone, email, is_active, created_at')
        .eq('branch_id', resolvedBranchId)
        .order('full_name'),
      supabase
        .from('bookings')
        .select('customer_id, status, payment_status, final_amount, discount_amount, date, service_name_snapshot')
        .eq('branch_id', resolvedBranchId)
        .not('customer_id', 'is', null),
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

    const resolvedBranchId = resolveBranchId(branchId);
    const today = date || new Date().toISOString().split('T')[0];

    // Date windows
    const sevenDaysAgo = new Date(new Date(today).getTime() - 7 * 86400000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(new Date(today).getTime() - 14 * 86400000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().split('T')[0];
    const sixtyDaysAgo = new Date(new Date(today).getTime() - 60 * 86400000).toISOString().split('T')[0];

    // Run all queries in parallel
    const [
      unpaidResult,
      last7dResult,
      prev7dResult,
      last30dResult,
      allCustomerResult,
    ] = await Promise.all([
      // 1. Unpaid risk: Confirmed/Completed + unpaid
      supabase
        .from('bookings')
        .select('id, final_amount')
        .eq('branch_id', resolvedBranchId)
        .in('status', ['Confirmed', 'Completed'])
        .eq('payment_status', 'unpaid'),

      // 2. Last 7 days bookings (for cancellation/no-show rates)
      supabase
        .from('bookings')
        .select('id, status')
        .eq('branch_id', resolvedBranchId)
        .gte('date', sevenDaysAgo)
        .lte('date', today),

      // 3. Previous 7 days (days 8-14 ago, for trend delta)
      supabase
        .from('bookings')
        .select('id, status')
        .eq('branch_id', resolvedBranchId)
        .gte('date', fourteenDaysAgo)
        .lt('date', sevenDaysAgo),

      // 4. Last 30 days bookings (for discount analysis)
      supabase
        .from('bookings')
        .select('id, base_amount, discount_amount, discount_approved_by')
        .eq('branch_id', resolvedBranchId)
        .gte('date', thirtyDaysAgo)
        .lte('date', today),

      // 5. All completed bookings per customer (for retention risk)
      supabase
        .from('bookings')
        .select('customer_phone, date')
        .eq('branch_id', resolvedBranchId)
        .eq('status', 'Completed'),
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

const VALID_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Leave', 'Half-Day'];

/**
 * Fetch attendance for all active therapists for a specific branch + date.
 * Therapists without a record get status = null.
 */
export async function fetchAttendance({ branchId, date }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const resolvedBranchId = resolveBranchId(branchId);
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Parallel: active therapists + attendance records
    const [therapistsResult, attendanceResult] = await Promise.all([
      supabase
        .from('therapists')
        .select('id, name')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('therapist_attendance')
        .select('therapist_id, status, check_in_time, check_out_time, notes')
        .eq('branch_id', resolvedBranchId)
        .eq('date', targetDate),
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

    const resolvedBranchId = resolveBranchId(branchId);
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Parallel: active therapist count + attendance records
    const [therapistsResult, attendanceResult] = await Promise.all([
      supabase
        .from('therapists')
        .select('id')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true),
      supabase
        .from('therapist_attendance')
        .select('status')
        .eq('branch_id', resolvedBranchId)
        .eq('date', targetDate),
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
        case 'Half-Day': halfDayCount++; break;
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

// ============================================================
// Phase 10D-5: Therapist Performance Index (Read-Only)
// ============================================================

export async function getTherapistPerformance({ branchId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const resolvedBranchId = resolveBranchId(branchId);
    const today = new Date().toISOString().split('T')[0];
    const endDate = toDate || today;
    const startDate = fromDate || new Date(new Date(endDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

    // 1. Fetch active therapists + branch hours
    const [therapistsResult, branchResult] = await Promise.all([
      supabase
        .from('therapists')
        .select('id, name, gender, specialties')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('branches')
        .select('open_time, close_time')
        .eq('id', resolvedBranchId)
        .single(),
    ]);

    if (therapistsResult.error) throw therapistsResult.error;
    if (branchResult.error) throw branchResult.error;

    const therapists = therapistsResult.data || [];
    if (therapists.length === 0) {
      return { data: { therapists: [], periodStart: startDate, periodEnd: endDate }, error: null };
    }

    const openMin = timeToMinutes(branchResult.data.open_time);
    const closeMin = timeToMinutes(branchResult.data.close_time);
    const operatingMinutesPerDay = closeMin - openMin;

    const therapistIds = therapists.map(t => t.id);

    // 2. Fetch bookings + attendance in parallel
    const [bookingsResult, attendanceResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('therapist_id, status, payment_status, final_amount, service_duration_snapshot')
        .eq('branch_id', resolvedBranchId)
        .gte('date', startDate)
        .lte('date', endDate)
        .in('therapist_id', therapistIds)
        .in('status', ['Confirmed', 'In-Progress', 'Completed']),
      supabase
        .from('therapist_attendance')
        .select('therapist_id, status')
        .eq('branch_id', resolvedBranchId)
        .gte('date', startDate)
        .lte('date', endDate)
        .in('therapist_id', therapistIds),
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
        } else if (a.status === 'Half-Day') {
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
      const totalAvailableMinutes = daysWorked * operatingMinutesPerDay;
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
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, address, is_active')
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchAllBranches error:', error.message);
    return { data: null, error };
  }
}
