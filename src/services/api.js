import { NEPAL_TZ, nepalToday, nepalDateOf, addDays } from '../utils/nepalTime';
import { getCalendarStatic, setCalendarStatic } from '../lib/calendarStaticCache';
import { buildQueue, needsOf } from '../lib/dashboardNeeds';
import { WALLET_MODES, addTender, isTendered, canonicalMode, dayMoneyView, applyRefundsToBuckets } from '../lib/dayMoney';
import { closeDayBlock } from '../lib/closeDay';
import { cardModeNames, bucketForMode, getOrgPaymentMethods } from './paymentMethods';
import { toTransferInput } from '../utils/transferText';
import { workedAtNote } from './visitorAttendance';
import { computeReferralCommission, payrollMonthBounds, tallyBookingEarnings, computeCommissionParts, computeNetPay, splitServiceRevenueByBranch, visitorPayrollHelpLine } from './payrollCalc';
import { supabase, supabaseCustomer, supabaseProvision } from '../lib/supabase';
import { isReadingViaSafeViews } from '../lib/restrictedReads';
import { maskCustomerName, maskPhone, viewerAccess, calendarColumnsFor } from './dataMasking';
import { isOwnCalendar } from './staffAccessRules';
import { transformMembership, transformMemberships, toTitleCase, isNoShow, futureBookingMessage } from './bookingTransformers';
import { dedupeTransfersByKey, sortTransfersByTime } from './transferDedup';
import { capture } from '../lib/analytics';
import { MEMBERSHIP_ENABLED, CUSTOMER_REFERRALS_ENABLED, VOUCHER_ENABLED } from '../lib/featureFlags';
import { toE164, samePhone } from '../utils/phone';
import { isNewCustomerBooking, walkInName } from '../utils/customerPick';
import { expandBlockOccurrences } from '../utils/blockRecurrence';
import { leafMethods, qrMethodDiff, validateQrFile } from '../utils/paymentQr';
import { parseAvailabilityError, createEnforcementCache } from './availability';
import { computeTherapistBranchAt, toKathmanduDate, isAfterCheckout, resolveOrphanTransferWindow } from './therapistBranchWindow';

// ZNLY-266/268: the ONE place a raw database error becomes screen text. A write's catch block returns plainError(error): the same
// { code, message } the callers already read, with a plain-language message (friendlyError). rawMessage / details / hint stay
// for code that parses them; they are never shown. Idempotent: an already-plain error is returned as it is.
export function plainError(error, fallback) {
  if (!error) return error;
  if (typeof error !== 'object') return { code: undefined, message: friendlyError(error, fallback), plain: true };
  if (error.plain === true) return error;
  return { code: error.code, message: friendlyError(error, fallback), rawMessage: error.message, details: error.details, hint: error.hint, plain: true };
}

// Staff-availability rule (ZNLY-100, migration-353): the guard raises OFF_SHIFT / ON_BREAK / ON_LEAVE / BLOCKED /
// OTHER_BRANCH / OVERLAP / OVERRIDE_NOT_ALLOWED. Every booking writer maps it to { code, message, overridable, detail }
// through here, and takes an optional `overrideReason` (manager/admin only; the DB re-checks the role).
const availabilityFailure = (err) => {
  const mapped = parseAvailabilityError(err);
  return mapped ? { data: null, error: mapped } : null;
};
const staffAvailabilityCache = createEnforcementCache(async (branchId) => {
  const { data, error } = await supabase.from('branches').select('organizations(enforce_staff_availability)').eq('id', branchId).maybeSingle();
  if (error) throw error;
  return data?.organizations?.enforce_staff_availability;
});
// true = the tenant switch is ON: leave/transfer windows are judged by the DB guard only (same code and message everywhere).
const staffAvailabilityEnforced = (branchId) => staffAvailabilityCache.get(branchId);
// ZNLY-390: true = this org does NOT require a customer phone (organizations.require_customer_phone = false). Anything unknown or failing reads as
// "required", the safe default. Cleared when the admin flips the switch.
const customerPhoneOptionalCache = createEnforcementCache(async (branchId) => {
  const { data, error } = await supabase.from('branches').select('organizations(require_customer_phone)').eq('id', branchId).maybeSingle();
  if (error) throw error;
  return data?.organizations?.require_customer_phone === false;
});
const customerPhoneOptional = (branchId) => customerPhoneOptionalCache.get(branchId);
// ZNLY-402 / ZNLY-423: true = this org has "Several services in one booking" ON (organizations.multi_service_bookings, migration 428). Every creation path
// writes bookings.visit_id ONLY when this is true; unknown / unreadable / OFF reads as false (nothing is written, exactly as before). Cleared when the admin flips the switch.
const multiServiceCache = createEnforcementCache(async (branchId) => {
  const { data, error } = await supabase.from('branches').select('organizations(multi_service_bookings)').eq('id', branchId).maybeSingle();
  if (error) throw error;
  return data?.organizations?.multi_service_bookings === true;
});
const newVisitId = () => ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null);

/**
 * ZNLY-402: "+ Service" joins the visit of the booking it was opened from. Resolves { data: visitId | null, error }.
 * OFF org -> { data: null } (nothing is written). ON org -> the source booking's visit_id; when the source has none, a new id is stamped on the
 * source FIRST (a normal update, so it is audited like any user action) and returned. If the new service then fails to create, the source keeping
 * a visit_id of its own is harmless: a visit of one booking looks exactly like a booking with no visit.
 */
export async function joinVisitOfBooking({ sourceBookingId, branchId }) {
  try {
    if (!sourceBookingId || !(await multiServiceCache.get(branchId))) return { data: null, error: null };
    const { data: src, error: readErr } = await supabase.from('bookings').select('id, visit_id').eq('id', sourceBookingId).maybeSingle();
    if (readErr) throw readErr;
    if (!src) return { data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Could not find the booking to add this service to.' } };
    if (src.visit_id) return { data: src.visit_id, error: null };
    const visitId = newVisitId();
    if (!visitId) return { data: null, error: null };
    const { data: stamped, error: stampErr } = await supabase.from('bookings').update({ visit_id: visitId }).eq('id', sourceBookingId).is('visit_id', null).select('visit_id');
    if (stampErr) throw stampErr;
    if (stamped && stamped.length) return { data: visitId, error: null };
    // Someone stamped it between our read and write: use theirs.
    const { data: again, error: againErr } = await supabase.from('bookings').select('visit_id').eq('id', sourceBookingId).maybeSingle();
    if (againErr) throw againErr;
    return { data: again?.visit_id || null, error: null };
  } catch (error) {
    console.error('[API] joinVisitOfBooking error:', error.message);
    return { data: null, error: plainError(error, 'Could not add this service to the booking. Please try again.') };
  }
}
const overrideReasonOf = (reason) => (typeof reason === 'string' && reason.trim() ? reason.trim() : null);
// The reason authorises exactly one write; clear it afterwards so it can never be mistaken for a fresh override later.
async function clearAvailabilityOverride(bookingId) {
  try {
    await supabase.from('bookings').update({ availability_override_reason: null }).eq('id', bookingId);
    await supabase.from('booking_therapists').update({ availability_override_reason: null }).eq('booking_id', bookingId).not('availability_override_reason', 'is', null);
    await supabase.from('booking_combo_items').update({ availability_override_reason: null }).eq('booking_id', bookingId).not('availability_override_reason', 'is', null);
  } catch (e) {
    console.warn('[API] clearAvailabilityOverride failed:', e.message);
  }
}
import { resolveJunctionRoomId, countOverlappingRoomRows } from './roomOverrideHelpers';
import { getPeriodRange, getTodayISO } from '../utils/periodPresets';
import { transferOccurrencesForDate } from '../utils/transferOccurrences';
import { inChunks, failOpenAfter, IN_CHUNK, customerSearchFilter } from './queryHelpers';
import { isNewTenant } from '../lib/dashboardTenant';
import { getCachedAuthProfile, setCachedAuthProfile, dropCachedAuthProfile, invalidateAuthenticatedUser } from '../lib/authProfileCache';
import { buildCustomerDirectory, buildPanelDetail, nepalNow, avgPaidPerVisit } from '../utils/customerDirectory';
import { addDays as addDaysISO } from '../utils/reportPeriod';
import { attendanceDays, busyMinutesInSpans } from '../pages/branch-manager-dashboard/components/Performance/therapistInnerView';
import { summarizeMoney, classifyBooking, roundMoney, paidPaisa } from '../utils/bookingMoney';
import { planClose, runCloseSteps } from '../utils/closeBooking';
import { friendlyError } from '../utils/friendlyError';
import { staffWord, staffWordPlural, wordBranch, wordBranches } from '../utils/industryTerms';
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
import { buildTherapistsOverview, addDaysStr, weekDatesOf } from './therapistsOverview';
import { isClosedDate } from '../utils/todayStatusLine';

// Read-only enrichment queries share these (see services/queryHelpers.js): id lists go out in chunks, optional
// lookups fail open after a timeout, and PostgREST caps a response at 1000 rows so paged reads use this page size.
const PG_PAGE_SIZE = 1000;
const CALENDAR_LOOKUP_TIMEOUT_MS = 4000;

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

// Whose opening hours a therapist drill-down uses. A real branch scope = that branch; the Overall sentinel (every branch) has no hours of its
// own, so it falls back to the therapist's home branch.
async function hoursBranchOf(branchId, therapistId) {
  if (!isOverallBranch(branchId)) return resolveBranchId(branchId);
  const { data } = await supabase.from('therapists').select('branch_id').eq('id', therapistId).single();
  return data?.branch_id || resolveBranchId(branchId);
}

// One therapist's bookings in a period, the way the Performance report counts them: the ones they are on through booking_therapists (a combo
// has several), else bookings.therapist_id. Each row carries `share` = 1 / therapists on it, so money can be split equally like the report does.
async function fetchTherapistBookings({ branchId, therapistId, startDate, endDate, columns, statuses = null }) {
  const { data: links, error: lErr } = await supabase.from('booking_therapists').select('booking_id').eq('therapist_id', therapistId);
  if (lErr) throw lErr;
  const ids = [...new Set((links || []).map((l) => l.booking_id))];
  let q = supabase
    .from('bookings')
    .select(`${columns}, therapist_id, booking_therapists(therapist_id)`)
    .gte('date', startDate)
    .lte('date', endDate)
    .or(ids.length ? `therapist_id.eq.${therapistId},id.in.(${ids.join(',')})` : `therapist_id.eq.${therapistId}`);
  if (statuses) q = q.in('status', statuses);
  q = withBranch(q, branchId);
  const { data, error } = await q;
  if (error) throw error;
  const out = [];
  for (const b of data || []) {
    const on = (b.booking_therapists || []).map((t) => t.therapist_id);
    const who = on.length ? on : [b.therapist_id];
    if (who.includes(therapistId)) out.push({ ...b, share: 1 / who.length });
  }
  return out;
}

// Conditionally apply a branch_id equality filter to a Supabase query builder.
// In the Overall view (sentinel branchId) the filter is omitted so org-wide RLS applies.
// NOTE: never route the sentinel through resolveBranchId — it would coerce to a default branch.
function withBranch(query, branchId, col = 'branch_id') {
  return isOverallBranch(branchId) ? query : query.eq(col, resolveBranchId(branchId));
}

// PostgREST caps unpaginated responses at 1000 rows and returns no error when it
// truncates — any read that can exceed that must page through explicitly.
// Takes a builder FACTORY (a function that returns a fresh query), not a built
// query object, so the parallel branch below can safely call it once per page.
const PAGE_SIZE = 1000;
// The factory receives the options object for .select(): page 1 asks for the
// exact count, later pages don't. PostgREST runs a full filtered COUNT under
// RLS for every request carrying count=exact, so passing it on all N pages
// would pay for the count N times and discard N-1 of them.
export async function fetchAllPages(buildQuery) {
  const first = await buildQuery({ count: 'exact' }).range(0, PAGE_SIZE - 1);
  if (first.error) throw first.error;
  const firstPage = first.data || [];
  const total = typeof first.count === 'number' ? first.count : null;

  // The count came back, so the total is already known and there's no need to
  // probe page-by-page to find the end.
  if (total !== null) {
    if (firstPage.length >= total) return firstPage; // first page already has everything
    // More pages remain — fetch them in parallel batches rather than one at a
    // time, so an N-page read costs ceil(N/MAX_CONCURRENT) round trips.
    const ranges = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
      ranges.push([offset, Math.min(offset + PAGE_SIZE, total) - 1]);
    }
    // Bounded concurrency. An unbounded fan-out would fire total/1000 requests
    // at once — 50 parallel queries for an all-time report on a large tenant —
    // against a PostgREST pool this project has already exhausted once
    // (migrations 226/227 added idle_in_transaction_session_timeout for exactly
    // that). Five at a time keeps the round-trip win without the stampede.
    const MAX_CONCURRENT = 5;
    const rows = [...firstPage];
    for (let i = 0; i < ranges.length; i += MAX_CONCURRENT) {
      const batch = ranges.slice(i, i + MAX_CONCURRENT);
      const pages = await Promise.all(batch.map(([from, to]) => buildQuery({}).range(from, to)));
      pages.forEach((page, j) => {
        if (page.error) throw page.error;
        const got = (page.data || []).length;
        const [from, to] = batch[j];
        const asked = to - from + 1;
        // A non-final page that comes back short means the server capped us
        // below PAGE_SIZE (db-max-rows lowered), so every later offset is now
        // misaligned and rows are being skipped — silently, which is the exact
        // failure this helper exists to prevent. Fail loudly instead.
        //
        // Deliberately not asserting rows.length === total: customers can be
        // hard-deleted (see deleteCustomer), so a concurrent delete legitimately
        // leaves the tail short. That is benign and self-corrects on reload; a
        // misaligned page is not.
        const isFinalRange = i + j === ranges.length - 1;
        if (got < asked && !isFinalRange) {
          throw new Error(
            `fetchAllPages: page [${from}-${to}] returned ${got} of ${asked} rows. ` +
            'The server is capping pages below PAGE_SIZE, so later offsets skip rows. ' +
            'Refusing to return a result the caller would treat as complete.'
          );
        }
        rows.push(...(page.data || []));
      });
    }
    return rows;
  }

  // No usable count (the factory ignored the options argument, or the server
  // withheld it) — fall back to the sequential loop. Still correct, just one
  // round trip per page.
  const rows = [...firstPage];
  if (firstPage.length < PAGE_SIZE) return rows;
  for (let offset = PAGE_SIZE; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery({}).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// fetchAllPages throws on error. Several call sites run multiple legs through
// Promise.all and deliberately check each leg's error in a fixed order
// afterwards, so a caller always sees the same "first" error regardless of
// which leg actually failed fastest — Promise.all would otherwise surface
// whichever rejection settles first, not the one earliest in that order.
// Wraps a fetchAllPages call back into the { data, error } shape those sites
// already destructure, so paginating a leg doesn't change that ordering.
async function pagedResult(buildQuery) {
  try {
    return { data: await fetchAllPages(buildQuery), error: null };
  } catch (error) {
    return { data: null, error };
  }
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

import { DISCOUNT_LIMITS, directDiscountPercent as _directDiscountPercent } from './discountLimits';

// Staff can request a discount up to this band (above their direct-apply limit).
// Manager/admin direct-apply is bounded by DISCOUNT_LIMITS above.
const STAFF_REQUEST_CEILING = 0.50;
// False while staff direct-apply equals the ceiling (the temporary 50% rule): then no request can reach a manager.
export const staffCanRequestDiscountApproval = DISCOUNT_LIMITS.staff < STAFF_REQUEST_CEILING;

/**
 * Fetch authenticated user + profile in one call.
 * Returns { user, profile } or a structured error.
 */
// The signed-in user + their users row (role, org, branch, visibility flags). ~215 call sites ask for this, often several at once
// (a branch switch used to fire 4× GET /auth/v1/user and 4× GET users). So:
//  - the user comes from the local session (getSession: no network; the access token is refreshed when due) instead of
//    getUser (a round trip to the auth server on every call). RLS still checks the token on every data request;
//  - the profile is shared between concurrent callers and kept for 30 s (lib/authProfileCache). The cache is keyed by user AND access
//    token, so a sign-out/sign-in or a token refresh misses it by itself; invalidateAuthenticatedUser() drops it on demand.
export { invalidateAuthenticatedUser };

async function loadAuthenticatedUser() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user || null;
  if (!user) {
    return { user: null, profile: null, error: { code: 'UNAUTHENTICATED', message: 'You must be logged in.' } };
  }
  const key = `${user.id}:${session.access_token}`;
  const cached = getCachedAuthProfile(key);
  if (cached) return cached;
  const promise = (async () => {
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, role, branch_id, org_id, calendar_visibility, can_view_customer_details, can_view_prices')
      .eq('id', user.id)
      .single();
    if (profileError) {
      dropCachedAuthProfile(promise); // never keep a failure
      return { user, profile: null, error: { code: 'PROFILE_ERROR', message: 'Could not load user profile.' } };
    }
    return { user, profile, error: null };
  })();
  setCachedAuthProfile(key, promise);
  return promise;
}
async function getAuthenticatedUser() {
  return loadAuthenticatedUser();
}

/**
 * Centralized booking mutation validator.
 * Checks: lock, completed immutability, terminal status.
 * Returns null if valid, or a structured error object.
 */
export function getRoomCapacity(room) {
  return room?.capacity ?? 1;
}

/**
 * Bulk-validate a set of room ids belong to a branch and are active. Used for
 * per-therapist room overrides (couple bookings with each person in a separate
 * room) in createBooking/assignTherapist — mirrors the single-room validation
 * those functions already do for the primary room.
 */
async function validateRoomsForBranch(roomIds, branchId) {
  const ids = [...new Set(roomIds.filter(Boolean))];
  if (ids.length === 0) return { rooms: new Map(), error: null };

  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, is_active, capacity')
    .in('id', ids)
    .eq('branch_id', branchId);
  if (error) return { rooms: new Map(), error };

  const rooms = new Map((data || []).map(r => [r.id, r]));
  const missing = ids.find(id => !rooms.has(id));
  if (missing) {
    return { rooms, error: { code: 'INVALID_ROOM', message: `Selected room is not available in this ${wordBranch()}.` } };
  }
  const inactive = data.find(r => !r.is_active);
  if (inactive) {
    return { rooms, error: { code: 'ROOM_INACTIVE', message: `${inactive.name} is not active.` } };
  }
  return { rooms, error: null };
}

/**
 * Capacity check for a per-therapist room override, mirroring the primary-room
 * overlap query createBooking already runs — must union bookings.room_id matches
 * (someone's primary room) with other booking_therapists.room_id matches (another
 * companion's override room), since either can occupy the same override room.
 */
async function checkOverrideRoomCapacity({ room, branchId, date, startTime, endTime, excludeBookingId }) {
  const capacity = getRoomCapacity(room);

  let primaryQuery = supabase
    .from('bookings')
    .select('id')
    .eq('room_id', room.id)
    .eq('branch_id', branchId)
    .eq('date', date)
    .not('status', 'in', '("Cancelled","No Show")')
    .lt('start_time', endTime)
    .gt('end_time', startTime);
  if (excludeBookingId) primaryQuery = primaryQuery.neq('id', excludeBookingId);
  const { data: primaryOverlaps } = await primaryQuery;

  const { data: companionRows } = await supabase
    .from('booking_therapists')
    .select('booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)')
    .eq('room_id', room.id);

  const companionCount = countOverlappingRoomRows(companionRows, { branchId, date, startTime, endTime, excludeBookingId });

  const occupied = (primaryOverlaps || []).length + companionCount;
  if (occupied >= capacity) {
    return { code: 'ROOM_FULL', message: `${room.name} is fully booked at this time (capacity: ${capacity}).` };
  }
  return null;
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

// ZNLY-185/186: second, independent filter alongside each caller's own
// excluded_service_categories filter — a service only shows if both admit it.
// Mirrors branch_service_links' own inclusion convention: a service with zero
// rows anywhere is Overall (kept everywhere); one with rows but none for this
// branchId is restricted elsewhere (dropped); one with a row for this
// branchId is kept.
// fetchServiceBranches/setServiceBranches live further down, next to
// fetchServiceTherapists/setServiceTherapists — not redeclared here.
async function filterServicesByBranchScope(services, branchId) {
  if (!services?.length || !branchId) return services;
  const serviceIds = services.map((s) => s.id);
  const { data: links, error } = await supabase
    .from('branch_service_links')
    .select('service_id, branch_id')
    .in('service_id', serviceIds);
  if (error || !links?.length) return services;
  const restrictedServiceIds = new Set(links.map((l) => l.service_id));
  const allowedHere = new Set(links.filter((l) => l.branch_id === branchId).map((l) => l.service_id));
  return services.filter((s) => !restrictedServiceIds.has(s.id) || allowedHere.has(s.id));
}

export async function fetchServices(branchId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError || !profile?.org_id) {
      console.warn('[API] fetchServices: No authenticated user or org_id', authError);
      return { data: [], error: null };
    }

    // A staff member with prices hidden must not see the SERVICE MENU prices
    // either — hiding the amount on a booking card while the service list
    // still shows NPR 4,200 for the same treatment achieves nothing. The price
    // columns are left out of the select rather than blanked afterwards, so
    // they never reach the browser.
    const vis = await resolveVisibility(profile);
    const priceCols = vis.canViewPrices
      ? ', price_npr, effective_price_npr, is_on_offer, original_price_npr'
      : '';

    const { data, error } = await supabase
      .from('services_with_offer_pricing')
      .select(`id, name, duration_minutes, description, image_url, category, is_couple, is_combo, requires_therapist, price_type${priceCols}`)
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    let filtered = data;
    const resolvedBranchId = resolveBranchId(branchId || profile.branch_id);
    if (resolvedBranchId && filtered) {
      const { data: branch } = await supabase
        .from('branches')
        .select('excluded_service_categories')
        .eq('id', resolvedBranchId)
        .single();
      const excluded = branch?.excluded_service_categories;
      if (excluded?.length > 0) {
        filtered = filtered.filter(s => !excluded.includes(s.category));
      }
      filtered = await filterServicesByBranchScope(filtered, resolvedBranchId);
    }

    return { data: filtered, error: null };
  } catch (error) {
    console.error('[API] fetchServices error:', error.message);
    return { data: null, error };
  }
}

export async function fetchRooms(branchId) {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, name, amenities, floor, capacity, requires_therapist')
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
export async function fetchBranchAvailabilityWindow(branchId, startDate, endDate, { serviceId, durationMinutes } = {}) {
  const [{ data: rooms, error: roomsError }, { data: bookings, error: bookingsError }] =
    await Promise.all([
      fetchRooms(branchId),
      supabase.rpc('public_check_branch_bookings_range', {
        p_branch_id: branchId,
        p_start_date: startDate,
        p_end_date: endDate,
        // staff availability (migration-354): with both, the tenant's "no_staff" start times come back too
        ...(serviceId && durationMinutes ? { p_service_id: serviceId, p_duration_minutes: durationMinutes } : {}),
      }),
    ]);

  if (roomsError) throw roomsError;
  if (bookingsError) throw bookingsError;

  // 'no_staff' rows are not busy intervals: each is one 15-minute-grid START time that must not be offered
  // (match on equality, never overlap -- see the COMMENT on the function). Keep them out of `bookings`.
  const noStaffStarts = new Set();
  const busy = [];
  for (const row of bookings || []) {
    if (row.source === 'no_staff') noStaffStarts.add(`${row.booking_date}|${String(row.start_time).slice(0, 5)}`);
    else busy.push(row);
  }
  return { rooms: rooms || [], bookings: busy, noStaffStarts };
}

// Per-therapist sibling to fetchBranchAvailabilityWindow — same shape, but backed
// by public_check_therapist_bookings_range (migration-253), which returns
// therapist-keyed busy rows (including NULL-therapist "unassigned" rows) instead of
// room/gender rows. Used by the provider-profile booking drawer's per-therapist
// slot filtering. orgSlug is required (migration-253 added it as the RPC's tenant
// predicate) — without it any caller holding any branch UUID could pull another
// org's per-therapist occupancy, including attendance ('absence'/'checkout').
export async function fetchTherapistAvailabilityWindow(orgSlug, branchId, startDate, endDate) {
  const { data, error } = await supabase.rpc('public_check_therapist_bookings_range', {
    p_org_slug: orgSlug,
    p_branch_id: branchId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw error;
  return { bookings: data || [] };
}

// The rule's own per-therapist, per-day shifts for the calendar's visible range (therapist_shifts_for_range). Best-effort:
// the calendar still renders without shading if this fails (e.g. a database without migration-354).
export async function fetchShiftsForRange({ branchId, startDate, endDate }) {
  try {
    const { data, error } = await supabase.rpc('therapist_shifts_for_range', { p_branch_id: branchId, p_from_date: startDate, p_to_date: endDate });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchShiftsForRange error:', error.message);
    return { data: [], error };
  }
}

// Rule-based suggestions for the dashboard (get_dashboard_insights, migration-370). Numbers only; src/lib/insightText.js words them.
export async function fetchDashboardInsights({ branchIds, date = null }) {
  try {
    const { data, error } = await supabase.rpc('get_dashboard_insights', { p_branch_ids: branchIds, p_date: date });
    if (error) throw error;
    return { data: data?.items || [], error: null };
  } catch (error) {
    console.error('[API] fetchDashboardInsights error:', error.message);
    return { data: [], error };
  }
}

// 'up' | 'down' | 'dismiss' | 'snooze' (snoozed 3 days unless `snoozeUntil`). Own rows only (RLS).
export async function recordInsightFeedback({ rule, subject, action, snoozeUntil = null }) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const { data: me, error: meErr } = await supabase.from('users').select('org_id').eq('id', u?.user?.id).maybeSingle();
    if (meErr || !me) throw meErr || new Error('No profile');
    const { error } = await supabase.from('insight_feedback').insert({ org_id: me.org_id, rule, subject_key: subject, action, snooze_until: snoozeUntil });
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('[API] recordInsightFeedback error:', error.message);
    return { error };
  }
}

// "Draft N messages": rows for the Outreach review queue (status review). Nothing is sent. Returns how many were created.
export async function draftInsightMessages({ rule, customerIds }) {
  try {
    const { data, error } = await supabase.rpc('draft_insight_messages', { p_rule: rule, p_customer_ids: customerIds });
    if (error) throw error;
    return { data: data || 0, error: null };
  } catch (error) {
    console.error('[API] draftInsightMessages error:', error.message);
    return { data: 0, error };
  }
}

// The whole dashboard in one call (get_dashboard, migration-368): pulse, floor, week, branches (with per-kind `needs`), money,
// tomorrow, my_day. branchIds are cut to the caller's tenant/branches server-side; money is null for staff. `date` defaults to today.
export async function fetchDashboard({ branchIds, date = null }) {
  try {
    const { data, error } = await supabase.rpc('get_dashboard', { p_branch_ids: branchIds, p_date: date });
    if (error) throw error;
    return { data: data || {}, error: null };
  } catch (error) {
    console.error('[API] fetchDashboard error:', error.message);
    return { data: {}, error };
  }
}

// Business health numbers in one call (get_report_business_health, migration-371): current, previous (equal-length period right before),
// by_day, by_method, branches[]. Manager/admin/admin_viewer only; branchIds are cut to the caller's branches server-side.
export async function fetchBusinessHealth({ branchIds, from, to }) {
  try {
    const { data, error } = await supabase.rpc('get_report_business_health', { p_branch_ids: branchIds, p_from: from, p_to: to });
    if (error) throw error;
    return { data: data || {}, error: null };
  } catch (error) {
    console.error('[API] fetchBusinessHealth error:', error.message);
    return { data: {}, error };
  }
}

// Therapist performance in one call (get_report_therapist_performance, migration-373): current + previous period (per-therapist rows and a team
// total that equals Business health), weekly sales, and one block per branch. Manager/admin/admin_viewer only; branchIds are cut to the caller's branches server-side.
export async function fetchTherapistPerformance({ branchIds, from, to }) {
  try {
    const { data, error } = await supabase.rpc('get_report_therapist_performance', { p_branch_ids: branchIds, p_from: from, p_to: to });
    if (error) throw error;
    return { data: data || {}, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistPerformance error:', error.message);
    return { data: {}, error };
  }
}

// The Customers tab of a therapist's inner page (get_therapist_customers, migration-374): one row per customer with the bookings they had with this therapist
// in the period, sales, owed, "booked again" (339's rule, with whom), first visit, next booking and customer type. Manager/admin/admin_viewer only.
export async function fetchTherapistCustomers({ therapistId, branchIds, from, to }) {
  try {
    const { data, error } = await supabase.rpc('get_therapist_customers', { p_therapist_id: therapistId, p_branch_ids: branchIds, p_from: from, p_to: to });
    if (error) throw error;
    return { data: data?.customers || [], error: null };
  } catch (error) {
    console.error('[API] fetchTherapistCustomers error:', error.message);
    return { data: [], error };
  }
}

// Money owed in one call (get_report_money_owed, migration-372): rows, totals, age buckets, the total 30 days earlier, rollups by customer / branch /
// staff. `asOf` null = now. Manager/admin/admin_viewer only; branchIds are cut to the caller's branches server-side.
export async function fetchMoneyOwed({ branchIds, asOf = null }) {
  try {
    const { data, error } = await supabase.rpc('get_report_money_owed', { p_branch_ids: branchIds, p_as_of: asOf });
    if (error) throw error;
    return { data: data || {}, error: null };
  } catch (error) {
    console.error('[API] fetchMoneyOwed error:', error.message);
    return { data: {}, error };
  }
}

// Completed, not fully paid bookings, any date (the candidates for lib/dashboardMoney's owed rule, which then keeps balance > 0).
const owedBookingsQuery = (cols) => supabase.from('bookings').select(cols).eq('status', 'Completed').neq('payment_status', 'paid').order('date').order('start_time');

const QUEUE_SELECT = 'id, booking_number, branch_id, customer_name, customer_phone, date, start_time, end_time, final_amount, status, payment_status, service_name_snapshot, booking_therapists(therapist_id, therapist:therapists(name)), payments(amount)';

// Front desk "Next up": today's bookings that still need a desk step (assign / collect / confirm / check in) plus the ones with a client now, see lib/dashboardNeeds.
export async function fetchFrontDeskQueue({ branchId, date }) {
  try {
    const [today, owed] = await Promise.all([
      supabase.from('bookings').select(QUEUE_SELECT).eq('branch_id', branchId).eq('date', date)
        .in('status', ['Pending', 'Confirmed', 'In-Progress', 'Completed']).order('start_time').limit(300),
      owedBookingsQuery(QUEUE_SELECT).eq('branch_id', branchId).lt('date', date).limit(200), // earlier days still owing money
    ]);
    if (today.error || owed.error) throw (today.error || owed.error);
    const queue = buildQueue([...(today.data || []), ...(owed.data || [])], date).map((b) => ({ ...b, amount_paid: (b.payments || []).reduce((n, p) => n + Number(p.amount || 0), 0) }));
    return { data: queue, error: null };
  } catch (error) {
    console.error('[API] fetchFrontDeskQueue error:', error.message);
    return { data: [], error };
  }
}

// Every booking that needs someone, tagged with its kind: the ONE rule in lib/dashboardNeeds (classifyNeed), whose SQL twin is
// get_dashboard branches[].needs. Business (table, Waiting rows) and Branch (Live / Prep / Close) all read this. RLS-scoped reads of
// bookings up to `date` (the Nepal day): anything still open, anything owed, anything with a pending discount (same candidates as the SQL).
const NEEDS_COLS = 'id, booking_number, branch_id, customer_name, date, start_time, end_time, created_at, final_amount, base_amount, discount_amount, discount_reason, status, payment_status, discount_status, service_name_snapshot, booking_therapists(therapist_id), payments(amount), branches(name), requester:users!discount_requested_by(full_name)';
export async function fetchNeeds({ branchIds, date }) {
  try {
    const [open, owed, discounts] = await Promise.all([
      supabase.from('bookings').select(NEEDS_COLS).in('branch_id', branchIds).lte('date', date).in('status', ['Pending', 'Confirmed', 'In-Progress']).order('date').order('start_time').limit(1000),
      owedBookingsQuery(NEEDS_COLS).in('branch_id', branchIds).lte('date', date).limit(1000),
      supabase.from('bookings').select(NEEDS_COLS).in('branch_id', branchIds).lte('date', date).eq('discount_status', 'pending').limit(1000),
    ]);
    const err = open.error || owed.error || discounts.error;
    if (err) throw err;
    const seen = new Set();
    const rows = [...(open.data || []), ...(owed.data || []), ...(discounts.data || [])].filter((b) => !seen.has(b.id) && seen.add(b.id)).map((b) => ({ ...b, branch_name: b.branches?.name || '' }));
    return { data: needsOf(rows, Date.now(), date), error: null };
  } catch (error) {
    console.error('[API] fetchNeeds error:', error.message);
    return { data: [], error };
  }
}

// New-tenant check + setup checklist counts for one branch. firstBookingDate is the earliest booking's date (null when none).
export async function fetchSetupState({ branchId, today }) {
  try {
    // The earliest booking decides whether this is a new tenant; the checklist counts (services, rooms, staff: five requests) are
    // only worth fetching for one. An established branch costs a single request on every branch switch.
    const first = await supabase.from('bookings').select('date').eq('branch_id', branchId).order('date', { ascending: true }).limit(1);
    if (first.error) throw first.error;
    const firstBookingDate = first.data?.[0]?.date || null;
    if (today && !isNewTenant(firstBookingDate, today)) return { data: { counts: null, firstBookingDate }, error: null };
    const [sv, rm, th] = await Promise.all([
      fetchServices(branchId),
      fetchRooms(branchId),
      supabase.from('therapists').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('is_active', true),
    ]);
    if (th.error) throw th.error;
    return { data: { counts: { services: (sv.data || []).length, rooms: (rm.data || []).length, staff: th.count || 0, bookings: firstBookingDate ? 1 : 0 }, firstBookingDate }, error: null };
  } catch (error) {
    console.error('[API] fetchSetupState error:', error.message);
    return { data: null, error };
  }
}

// The therapist this login is (therapists.user_id, migration-377), or null. Used by the staff "My day" view.
export async function fetchMyTherapistId(userId) {
  try {
    if (!userId) return { data: null, error: null };
    const { data, error } = await supabase.from('therapists').select('id').eq('user_id', userId).limit(1).maybeSingle();
    if (error) throw error;
    return { data: data?.id || null, error: null };
  } catch (error) {
    console.error('[API] fetchMyTherapistId error:', error.message);
    return { data: null, error };
  }
}

// ── Access section (ZNLY-198 4b): read one person's login, and the "Link needs review" prompt ──
// What a role may direct-apply, in whole percent, from the one table the booking rules use (so the role cards never drift from it).
export const directDiscountPercent = _directDiscountPercent;

// One person's login: their users row, whether a PIN is set (the PIN itself is never read), and the extra branches ticked for them.
// Does the SIGNED-IN person have a PIN? (ZNLY-210: the lock screen needs one; has_pin() answers yes/no, the PIN is never read.) { data: boolean|null }
export async function fetchOwnHasPin() {
  const { data, error } = await supabase.rpc('has_pin');
  if (error) return { data: null, error };
  return { data: data === true, error: null };
}

// data = { userId, user, hasPin, branchIds } with user = null when the person has no login yet. Writes go through grantStaffAccess / updateStaffAccess.
export async function fetchTherapistAccess(therapistId) {
  try {
    const { data: t, error: tErr } = await supabase.from('therapists').select('id, user_id, branch_id').eq('id', therapistId).single();
    if (tErr) throw tErr;
    if (!t.user_id) return { data: { userId: null, user: null, hasPin: false, branchIds: [], homeBranchId: t.branch_id }, error: null };
    const [u, pin, grants] = await Promise.all([
      supabase.from('users').select('id, email, full_name, role, branch_id, login_access, calendar_visibility, can_view_customer_details, can_view_prices').eq('id', t.user_id).single(),
      supabase.rpc('has_pin', { p_user_id: t.user_id }), // ZNLY-210: a yes/no from the database; users.pin is not readable (migration-384)
      supabase.from('user_branches').select('branch_id').eq('user_id', t.user_id),
    ]);
    if (u.error) throw u.error;
    if (grants.error) throw grants.error;
    return { data: { userId: t.user_id, user: u.data, hasPin: pin.error ? null : pin.data === true, branchIds: (grants.data || []).map((g) => g.branch_id), homeBranchId: t.branch_id }, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistAccess error:', error.message);
    return { data: null, error };
  }
}

// Open migration conflicts for the admin prompt (znly205_link_conflicts, admin-only read). Excludes the login_access backfill notes.
// Each row carries the names the sentence needs, plus whether the suggested link could work right now.
export async function fetchLinkConflicts() {
  try {
    const { data: rows, error } = await supabase.from('znly205_link_conflicts')
      .select('id, user_id, therapist_id, therapist_current_user_id, reason')
      .is('resolved_at', null).neq('reason', 'login_access_backfilled_to_email').order('id');
    if (error) throw error;
    if (!rows?.length) return { data: [], error: null };
    const userIds = [...new Set(rows.flatMap((r) => [r.user_id, r.therapist_current_user_id]).filter(Boolean))];
    const tIds = [...new Set(rows.map((r) => r.therapist_id).filter(Boolean))];
    const [users, ts, links] = await Promise.all([
      supabase.from('users').select('id, email').in('id', userIds),
      tIds.length ? supabase.from('therapists').select('id, name, user_id').in('id', tIds) : { data: [], error: null },
      supabase.from('therapists').select('id, user_id').in('user_id', userIds),
    ]);
    for (const r of [users, ts, links]) if (r.error) throw r.error;
    const email = new Map((users.data || []).map((u) => [u.id, u.email]));
    const tById = new Map((ts.data || []).map((x) => [x.id, x]));
    return {
      data: rows.map((r) => {
        const th = tById.get(r.therapist_id);
        return {
          id: r.id, reason: r.reason, userId: r.user_id, userEmail: email.get(r.user_id) || null, therapistId: r.therapist_id,
          therapistName: th?.name || null, therapistUserId: th?.user_id || null, currentEmail: email.get(r.therapist_current_user_id) || null,
          loginLinkedElsewhere: (links.data || []).some((l) => l.user_id === r.user_id && l.id !== r.therapist_id),
        };
      }),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchLinkConflicts error:', error.message);
    return { data: null, error };
  }
}

// Settle one saved conflict (admin only): action 'link' links as the row suggested, 'keep' leaves things as they are. One transaction in the
// database (resolve_link_conflict, migration-379): a refused link leaves the row open.
export async function resolveLinkConflict({ id, action }) {
  try {
    const { error } = await supabase.rpc('resolve_link_conflict', { p_conflict_id: id, p_action: action });
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('[API] resolveLinkConflict error:', error.message);
    return { error };
  }
}

// Upcoming open bookings a PROPOSED change would strand (availability_affected_bookings, migration-355). Read-only; the change
// shapes are built in services/availabilityConflicts.js. Fails open: a database without migration-355 returns no rows so the
// save still goes through (the rule itself is enforced by the database guard, this is only the early warning).
export async function fetchAffectedBookings({ therapistId, change }) {
  try {
    const { data, error } = await supabase.rpc('availability_affected_bookings', { p_therapist_id: therapistId, p_change: change });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchAffectedBookings error:', error.message);
    return { data: [], error };
  }
}

// What switching enforce_staff_availability ON would change today (availability_rollout_check, admin/manager of the org).
export async function fetchAvailabilityRolloutCheck(orgId) {
  try {
    const { data, error } = await supabase.rpc('availability_rollout_check', { p_org_id: orgId });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchAvailabilityRolloutCheck error:', error.message);
    return { data: null, error };
  }
}

// Admin only, per tenant (migration-357: organizations has no UPDATE policy, so this goes through a SECURITY DEFINER function).
export async function setEnforceStaffAvailability({ enabled }) {
  try {
    const { data, error } = await supabase.rpc('set_enforce_staff_availability', { p_value: !!enabled });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] setEnforceStaffAvailability error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ZNLY-389 / ZNLY-390: per-org booking rules. Admin only (migrations 424 / 425: organizations has no UPDATE policy, so SECURITY DEFINER RPCs).
export async function setAllowStaffOverlap({ enabled }) {
  try {
    const { data, error } = await supabase.rpc('set_allow_staff_overlap', { p_value: !!enabled });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] setAllowStaffOverlap error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ZNLY-402 / ZNLY-423: per-org "Several services in one booking" (migration 428). Admin only, SECURITY DEFINER RPC like the two above.
export async function setMultiServiceBookings({ enabled }) {
  try {
    const { data, error } = await supabase.rpc('set_multi_service_bookings', { p_value: !!enabled });
    if (error) throw error;
    multiServiceCache.clear();
    return { data, error: null };
  } catch (error) {
    console.error('[API] setMultiServiceBookings error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

export async function setRequireCustomerPhone({ enabled }) {
  try {
    const { data, error } = await supabase.rpc('set_require_customer_phone', { p_value: !!enabled });
    if (error) throw error;
    customerPhoneOptionalCache.clear();
    return { data, error: null };
  } catch (error) {
    console.error('[API] setRequireCustomerPhone error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Everything the live availability pre-check needs for one branch + date, in three reads and no write:
// the rule's own shifts (therapist_shifts_for_range, migration-354: weekly/roster hours, breaks, leave, blocks,
// transfer windows) plus the day's bookings (own and companion) to detect overlaps.
// -> { data: { therapists: [{ id, name, shiftDay, bookings: [{ id, startMin, endMin, number }] }] }, error }
export async function fetchAvailabilityDay({ branchId, date }) {
  try {
    const toMin = (t) => { const [h, m] = String(t || '0:0').split(':'); return Number(h) * 60 + Number(m || 0); };
    const [shifts, therapists, mine, companions] = await Promise.all([
      supabase.rpc('therapist_shifts_for_range', { p_branch_id: branchId, p_from_date: date, p_to_date: date }),
      supabase.from('therapists').select('id, name').eq('branch_id', branchId).eq('is_active', true).eq('is_service_staff', true).order('display_order').order('name'),
      supabase.from('bookings').select('id, booking_number, therapist_id, start_time, end_time')
        .eq('branch_id', branchId).eq('date', date).not('status', 'in', '("Cancelled","No Show")').not('therapist_id', 'is', null),
      supabase.from('booking_therapists')
        .select('booking_id, therapist_id, start_time, end_time, booking:bookings!inner(id, booking_number, date, branch_id, status, start_time, end_time)')
        .eq('booking.branch_id', branchId).eq('booking.date', date).not('booking.status', 'in', '("Cancelled","No Show")'),
    ]);
    const firstError = shifts.error || therapists.error || mine.error || companions.error;
    if (firstError) throw firstError;

    const shiftBy = new Map((shifts.data || []).map((r) => [r.therapist_id, r]));
    const seen = new Set();
    const bookingsBy = new Map();
    const add = (therapistId, id, number, start, end) => {
      const key = `${id}:${therapistId}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!bookingsBy.has(therapistId)) bookingsBy.set(therapistId, []);
      bookingsBy.get(therapistId).push({ id, number, startMin: toMin(start), endMin: toMin(end) });
    };
    (mine.data || []).forEach((b) => add(b.therapist_id, b.id, b.booking_number, b.start_time, b.end_time));
    (companions.data || []).forEach((r) => add(r.therapist_id, r.booking_id, r.booking?.booking_number, r.start_time || r.booking?.start_time, r.end_time || r.booking?.end_time));

    return {
      data: {
        therapists: (therapists.data || []).map((t) => ({
          id: t.id, name: t.name, shiftDay: shiftBy.get(t.id) || null, bookings: bookingsBy.get(t.id) || [],
        })),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchAvailabilityDay error:', error.message);
    return { data: null, error };
  }
}

// Male/female headcount among therapists eligible for serviceId at branchId
// (migration-307, RPC public_get_service_eligible_gender_headcount) — the
// gender-preference availability path's service-scoped sibling to the old
// branch-wide `.from('therapists')` count. Unlike fetchServiceTherapists,
// this is anon-callable (no RLS on service_therapists for anon) and returns
// only counts, never therapist identities. orgSlug is required for the same
// reason as fetchTherapistAvailabilityWindow — tenant-scoping the RPC.
export async function fetchServiceEligibleGenderHeadcount(orgSlug, branchId, serviceId) {
  const { data, error } = await supabase.rpc('public_get_service_eligible_gender_headcount', {
    p_org_slug: orgSlug,
    p_branch_id: branchId,
    p_service_id: serviceId,
  });
  if (error) throw error;
  const row = data?.[0] || { male_count: 0, female_count: 0 };
  return { male: row.male_count || 0, female: row.female_count || 0 };
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

    // Not branch-scoped: absentIds below is only matched against the
    // branch-scoped `therapists` list, and therapist_attendance is keyed by
    // (therapist_id, date) globally — filtering here would risk missing a
    // status marked before a same-day transfer.
    let attendancePromise;
    if (date) {
      attendancePromise = supabase
        .from('therapist_attendance')
        .select('therapist_id, status')
        .eq('date', date)
        .in('status', ['Absent', ...LEAVE_LIKE_ATTENDANCE_STATUSES]);
    } else {
      attendancePromise = Promise.resolve({ data: [] });
    }

    // live therapists.branch_id only reflects the CURRENT moment (flipped by the
    // apply/revert cron) — a therapist who visited this branch earlier today on a
    // temporary transfer and has already reverted won't match it anymore, even
    // though assignTherapist/createBooking (computeTherapistBranchAt) would still
    // correctly allow assigning them to a booking during their visit window. Pull
    // those in separately so they're selectable for same-day bookings in the past
    // part of the day, not just whoever is physically here right now. Covers
    // permanent transfers too — the apply-cron flips branch_id on its own
    // schedule, so a permanent transfer whose start_time has already passed today
    // can momentarily lag the live column the exact same way a temporary one can.
    let transferredInPromise = Promise.resolve({ data: [] });
    const resolvedBranchIdForTransfers = resolveBranchId(branchId);
    if (date && !isOverallBranch(branchId) && resolvedBranchIdForTransfers) {
      transferredInPromise = supabase
        .from('staff_transfers')
        .select('therapist_id')
        .eq('to_branch_id', resolvedBranchIdForTransfers)
        .eq('effective_date', date);
    }

    const [therapistsResult, attendanceResult, transferredInResult] = await Promise.all([
      therapistsQuery,
      attendancePromise,
      transferredInPromise,
    ]);

    if (therapistsResult.error) throw therapistsResult.error;

    let data = therapistsResult.data;

    const existingIds = new Set(data.map(t => t.id));
    const transferredInIds = [...new Set((transferredInResult.data || []).map(t => t.therapist_id))]
      .filter(id => !existingIds.has(id));
    if (transferredInIds.length > 0) {
      const { data: extra, error: extraError } = await supabase
        .from('therapists')
        .select('id, name, gender, specialties, position, is_service_staff')
        .eq('is_active', true)
        .eq('is_service_staff', true)
        .in('id', transferredInIds);
      if (extraError) throw extraError;
      data = [...data, ...(extra || [])].sort((a, b) => a.name.localeCompare(b.name));
    }

    const absentIds = new Set(
      (attendanceResult.data || []).map(a => a.therapist_id)
    );
    if (absentIds.size > 0) {
      data = data.filter(t => !absentIds.has(t.id));
    }

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
 * True when any booking of the day (for the branch, or org-wide on Overall) is locked ("This day is closed"). A head count
 * with limit 1: the dashboard banner only needs this yes/no, not the day's bookings.
 */
export async function hasLockedBookings(branchId, date) {
  try {
    let query = supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('date', date).eq('is_locked', true).limit(1);
    query = withBranch(query, branchId);
    const { count, error } = await query;
    if (error) throw error;
    return { data: (count || 0) > 0, error: null };
  } catch (error) {
    console.error('[API] hasLockedBookings error:', error.message);
    return { data: null, error };
  }
}

/**
 * Bookings for the Bookings list page: a real date range (inclusive), paged past the 1,000-row API cap, with the
 * payment + refund rows the money model needs and every assigned therapist. Sorted by date, start time.
 */
export async function fetchBookingsForList(branchId, { dateFrom, dateTo }) {
  try {
    const rows = await pageAllRows(() => withBranch(
      supabase
        .from('bookings')
        .select(`
          *,
          service:services(id, name, duration_minutes),
          therapist:therapists(id, name, gender),
          room:rooms(id, name),
          payments(id, amount, payment_mode, created_at),
          payment_refunds(id, amount, reason, created_at),
          booking_therapists(therapist_id, start_time, end_time, room_id, therapist:therapists(id, name, gender), room:rooms(id, name))
        `)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date')
        .order('start_time')
        .order('id'),
      branchId,
    ));
    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchBookingsForList error:', error.message);
    return { data: null, error };
  }
}

/** Who can do which service (service_therapists): { [serviceId]: [therapistId…] }. A service with no rows has no restriction. */
export async function fetchServiceEligibility() {
  try {
    const rows = await pageAllRows(() => supabase.from('service_therapists').select('service_id, therapist_id').order('service_id').order('therapist_id'));
    const out = {};
    for (const r of rows) (out[r.service_id] ||= []).push(r.therapist_id);
    return { data: out, error: null };
  } catch (error) {
    console.error('[API] fetchServiceEligibility error:', error.message);
    return { data: null, error };
  }
}

/** Rendered (Completed / In-Progress) visits for some customers: { [customerId]: [{ therapistId }] }, used for the "usual therapist" rule. */
export async function fetchRenderedVisitTherapists(customerIds) {
  try {
    if (!customerIds?.length) return { data: {}, error: null };
    const rows = await pageAllRows(() => supabase
      .from('bookings')
      .select('id, customer_id, therapist_id')
      .in('customer_id', customerIds)
      .in('status', ['Completed', 'In-Progress'])
      .order('id'));
    const out = {};
    for (const r of rows) (out[r.customer_id] ||= []).push({ therapistId: r.therapist_id });
    return { data: out, error: null };
  } catch (error) {
    console.error('[API] fetchRenderedVisitTherapists error:', error.message);
    return { data: null, error };
  }
}

/**
 * Team-level "seen": the first staff member to open/handle a booking acknowledges it for everyone (migration-335). Fire and forget —
 * callers don't wait on it. Read-only roles and other orgs are refused by the RPC itself.
 */
export async function acknowledgeBooking(bookingId) {
  try {
    const { data, error } = await supabase.rpc('acknowledge_booking', { p_booking_id: bookingId });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.warn('[API] acknowledgeBooking:', error.message);
    return { data: null, error: plainError(error) };
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
      .select('created_at, acknowledged_at, creator:users!created_by(full_name), acknowledger:users!acknowledged_by(full_name)')
      .eq('id', bookingId)
      .single();

    if (error) throw error;

    return {
      data: {
        createdByName: data.creator?.full_name || null,
        createdAt: data.created_at || null,
        acknowledgedAt: data.acknowledged_at || null,
        acknowledgedByName: data.acknowledger?.full_name || null,
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

// Wallet payment modes are internal credit only (Membership/Referral/Voucher balances) —
// like SessionPackage, their value was already recognized as revenue when the
// membership/voucher/referral credit was originally purchased or earned, not when it's
// later spent down. Shared by getTodayInsights, getDailySummary, and
// getDailyOperationalReport so all three revenue calculations agree on what to exclude.
// (WALLET_MODES now lives in src/lib/dayMoney.js, the one money-today rule shared with the dashboard — ZNLY-232.)

// Bucket key ('cash' | 'card' | 'fonepay') for the simple 3-way cash/card/other
// split used by getDailySummary() and getDailyOperationalReport() (both the
// booking-payments and voucher-payments loops in each). Not used by
// getTodayInsights(), which returns a flat per-payment_mode total instead so the
// Dashboard can group by the org's own configured payment-method tree
// (WALLET_MODES above is shared across all three functions).
function classifyPaymentMode(rawMode) {
  const mode = canonicalMode(rawMode);
  if (mode === 'Cash') return 'cash';
  if (mode.includes('Card')) return 'card';
  return 'fonepay'; // MobileBanking, Esewa, Khalti, Cheque (+ legacy Fonepay) → digital/other
}

// Products sold on [date] (Nepal day) at a branch, net of refunds (a refunded sale is left out entirely, like Today's Insights), with how
// each sale was paid from product_sale_payments (migration-346). Wallet modes (the membership wallet) are a deduction, not new money in
// the drawer, so they are counted in `gross` but not in `total` / the cash-card-other buckets — same policy as vouchers.
//   { count, gross, total, breakdown: { cash, card, fonepay }, byMode: { 'Cash': 2300, ... } }
export async function getProductSalesForDate(branchId, date) {
  const next = new Date(`${date}T00:00:00+05:45`);
  next.setUTCDate(next.getUTCDate() + 1);
  let q = supabase
    .from('product_sales')
    .select('id, total_amount, product_sale_payments(payment_mode, amount)')
    .is('refunded_at', null)
    .gte('created_at', `${date}T00:00:00+05:45`)
    .lt('created_at', next.toISOString());
  q = withBranch(q, branchId);
  const { data, error } = await q;
  if (error) throw error;
  const out = { count: (data || []).length, gross: 0, total: 0, breakdown: { cash: 0, card: 0, fonepay: 0 }, byMode: {} };
  for (const sale of (data || [])) {
    out.gross += Number(sale.total_amount);
    for (const p of (sale.product_sale_payments || [])) {
      if (WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
      const amount = Number(p.amount);
      out.total += amount;
      out.breakdown[classifyPaymentMode(p.payment_mode)] += amount;
      out.byMode[p.payment_mode] = (out.byMode[p.payment_mode] || 0) + amount;
    }
  }
  return out;
}

// The day's money, ONE source shared with the dashboard Close card (get_day_money -> _dashboard_money_in / _dashboard_refunds, migration 391):
// everything TAKEN that Nepal day (any booking date) by real method name, minus refunds made that day. ZNLY-232.
//   { byMode, refunds, cashRefunds, taken, cashExpected, serviceIn }   cashRefunds = the part of refunds paid out in cash (ZNLY-258)
// The org's own card methods (Card -> Mastercard, Visa ...) so card brands land in the card bucket, not "fonepay" (ZNLY-234).
async function getOrgCardNames() {
  try {
    const { profile } = await getAuthenticatedUser();
    if (!profile?.org_id) return cardModeNames(null);
    const { data } = await supabase.from('organizations').select('settings').eq('id', profile.org_id).maybeSingle();
    return cardModeNames(getOrgPaymentMethods(data?.settings));
  } catch (e) {
    return cardModeNames(null);
  }
}

export async function getDayMoneyForDate(branchId, date) {
  const { data, error } = await supabase.rpc('get_day_money', { p_branch_id: isOverallBranch(branchId) ? null : resolveBranchId(branchId), p_date: date });
  if (error) throw error;
  const d = data || {};
  return { byMode: d.by_method || {}, refunds: Number(d.refunds || 0), cashRefunds: d.cash_refunds == null ? undefined : Number(d.cash_refunds), taken: Number(d.taken || 0), cashExpected: Number(d.cash_expected || 0), serviceIn: Number(d.service_in || 0), sources: d.sources || {},
    // money taken AFTER this day was closed (not in the closed daily_reports row), and its cash part (ZNLY-234)
    afterClose: { amount: Number(d.after_close?.amount || 0), cash: Number(d.after_close?.cash || 0) },
    // what the closed day held at close, from rows taken at or before closed_at (null when the day is open or a multi-branch view)
    atClose: d.at_close ? { byMode: d.at_close.by_method || {}, refunds: Number(d.at_close.refunds || 0), cashRefunds: d.at_close.cash_refunds == null ? undefined : Number(d.at_close.cash_refunds), taken: Number(d.at_close.taken || 0), cashExpected: Number(d.at_close.cash_expected || 0), closedAt: d.at_close.closed_at || null } : null };
}

// Membership top-ups and package purchases on [date] — new cash in from selling
// a wallet-style product. Mirrors the voucher-sale pattern (voucherSalesTotal)
// already folded into getDailySummary/getDailyOperationalReport: recognized as
// revenue exactly once, on the day the customer actually pays, and excluded again
// via WALLET_MODES/'SessionPackage' on the day it's later redeemed against a
// booking — so neither figure double-counts the other.
async function getWalletProductSalesForDate(branchId, date) {
  const nextDayBoundary = new Date(`${date}T00:00:00+05:45`);
  nextDayBoundary.setUTCDate(nextDayBoundary.getUTCDate() + 1);

  // Mode breakdown accumulates alongside the totals below so callers can fold
  // this cash into paymentBreakdown/modeTotals the same way voucher/product
  // sales already do — membership and package sales are real tendered cash
  // (Cash/Card/MobileBanking) too, not a wallet mode themselves.
  const modeBreakdown = { cash: 0, card: 0, fonepay: 0 };
  const byMode = {};

  let depositsQuery = supabase
    .from('membership_transactions')
    .select('amount, payment_mode')
    .eq('kind', 'deposit')
    .gte('created_at', `${date}T00:00:00+05:45`)
    .lt('created_at', nextDayBoundary.toISOString());
  depositsQuery = withBranch(depositsQuery, branchId);
  const { data: deposits, error: depositsError } = await depositsQuery;
  if (depositsError) throw depositsError;
  let membershipSoldTotal = 0;
  for (const d of (deposits || [])) {
    const amount = Number(d.amount);
    membershipSoldTotal += amount;
    // payment_mode is nullable (migration-060) — default to Cash rather than
    // falling through classifyPaymentMode('') into the fonepay bucket.
    modeBreakdown[classifyPaymentMode(d.payment_mode || 'Cash')] += amount;
    addTender(byMode, d.payment_mode || 'Cash', amount);
  }

  let packagesQuery = supabase
    .from('packages')
    .select('paid_amount, payment_method')
    .eq('issued_date', date);
  packagesQuery = withBranch(packagesQuery, branchId);
  const { data: packagesIssued, error: packagesError } = await packagesQuery;
  if (packagesError) throw packagesError;
  let packageSoldTotal = 0;
  for (const p of (packagesIssued || [])) {
    const amount = Number(p.paid_amount);
    packageSoldTotal += amount;
    // payment_method is nullable (migration-185) with no "required when paid"
    // check — default to Cash rather than falling through into fonepay.
    modeBreakdown[classifyPaymentMode(p.payment_method || 'Cash')] += amount;
    addTender(byMode, p.payment_method || 'Cash', amount);
  }

  return { membershipSoldTotal, packageSoldTotal, modeBreakdown, byMode };
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
    return { data: null, error: { code: error.code || 'UPDATE_FAILED', message: friendlyError(error, 'Failed to update payment methods.') } };
  }
  return { data, error: null };
}

// --- Payment QR codes (migration-337) ---
// One static merchant QR per leaf payment method for the whole org (branch_id NULL; per-branch rows are reserved for
// later). The image lives in the private `payment-qr` bucket at {org_id}/org/{uuid}.{ext}; only an org admin can write
// (RLS), every org user can read via short-lived signed URLs. A QR is optional: readers must never block a payment.
const QR_BUCKET = 'payment-qr';
const QR_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// The org's QR codes as { [method]: { path, url } }. Never throws and never blocks a payment: if the rows can't be read
// the map is empty (checkout behaves as if no QR were uploaded); if only the image URLs can't be signed, each method
// keeps its entry with url null, so checkout can say "QR couldn't load" and take the payment as usual.
export async function getPaymentMethodQrs() {
  let rows;
  try {
    const { data, error } = await supabase
      .from('payment_method_qr')
      .select('method, storage_path')
      .is('branch_id', null);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    return { data: {}, error: { code: err?.code || 'QR_LOAD_FAILED', message: err?.message || 'Could not load payment QR codes.' } };
  }
  if (!rows.length) return { data: {}, error: null };
  let urlByPath = new Map();
  let signError = null;
  try {
    const { data: signed, error } = await supabase.storage
      .from(QR_BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path), 3600);
    if (error) throw error;
    urlByPath = new Map((signed || []).filter((s) => s.signedUrl && !s.error).map((s) => [s.path, s.signedUrl]));
  } catch (err) {
    signError = { code: err?.code || 'QR_SIGN_FAILED', message: err?.message || 'Could not load the QR images.' };
  }
  const map = {};
  rows.forEach((r) => { map[r.method] = { path: r.storage_path, url: urlByPath.get(r.storage_path) || null }; });
  return { data: map, error: signError };
}

const removeQrObjects = async (paths) => {
  const list = (paths || []).filter(Boolean);
  if (list.length) await supabase.storage.from(QR_BUCKET).remove(list).catch(() => {});
};

// Upload (or replace) the org-wide QR for one leaf method. Writes a new object every time (never upsert) so a cached
// old image can't linger, points the row at it, then deletes the previous object.
export async function uploadPaymentMethodQr(orgId, method, file) {
  const invalid = validateQrFile(file);
  if (invalid) return { data: null, error: { code: 'INVALID_FILE', message: invalid } };
  if (!orgId || !method) return { data: null, error: { code: 'INVALID_INPUT', message: 'Missing organization or method.' } };

  const path = `${orgId}/org/${crypto.randomUUID()}.${QR_EXT[file.type]}`;
  const { error: uploadError } = await supabase.storage
    .from(QR_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (uploadError) return { data: null, error: { code: 'UPLOAD_FAILED', message: uploadError.message || 'Could not upload the QR image.' } };

  const { data: existing, error: findError } = await supabase
    .from('payment_method_qr')
    .select('id, storage_path')
    .eq('org_id', orgId).is('branch_id', null).eq('method', method)
    .maybeSingle();
  const { data: userData } = await supabase.auth.getUser();
  const stamp = { storage_path: path, updated_at: new Date().toISOString(), updated_by: userData?.user?.id || null };
  const { error: rowError } = findError
    ? { error: findError }
    : existing
      ? await supabase.from('payment_method_qr').update(stamp).eq('id', existing.id)
      : await supabase.from('payment_method_qr').insert({ org_id: orgId, branch_id: null, method, ...stamp });
  if (rowError) {
    await removeQrObjects([path]);
    return { data: null, error: { code: rowError.code || 'SAVE_FAILED', message: rowError.message || 'Could not save the QR.' } };
  }
  if (existing?.storage_path && existing.storage_path !== path) await removeQrObjects([existing.storage_path]);
  return { data: { method, path }, error: null };
}

// Remove the org-wide QR of one leaf method: the row first, then its image.
export async function removePaymentMethodQr(method) {
  const { data: rows, error } = await supabase
    .from('payment_method_qr')
    .delete()
    .is('branch_id', null).eq('method', method)
    .select('storage_path');
  if (error) return { data: null, error: { code: error.code || 'DELETE_FAILED', message: error.message || 'Could not remove the QR.' } };
  await removeQrObjects((rows || []).map((r) => r.storage_path));
  return { data: { method }, error: null };
}

// Keep QR rows in step with a payment-method save. Call AFTER updateOrgPaymentMethods succeeds, with the list before
// and after the save and any in-place renames ({ oldLeaf: newLeaf }). Renamed leaves keep their QR; every leaf that
// disappeared loses it (row + image). Best-effort: a failure here never undoes the method save.
export async function syncPaymentMethodQrs(oldMethods, newMethods, renames = {}) {
  const { renamed, removed } = qrMethodDiff(leafMethods(oldMethods), leafMethods(newMethods), renames);
  if (!renamed.length && !removed.length) return { data: { renamed, removed }, error: null };
  try {
    // A stale row already sitting on a rename target would collide with the unique index: drop it with the removals.
    const drop = [...removed, ...renamed.map(([, to]) => to)];
    const { data: dropped, error: dropError } = await supabase
      .from('payment_method_qr')
      .delete()
      .is('branch_id', null).in('method', drop)
      .select('storage_path');
    if (dropError) throw dropError;
    await removeQrObjects((dropped || []).map((r) => r.storage_path));
    for (const [from, to] of renamed) {
      const { error } = await supabase
        .from('payment_method_qr')
        .update({ method: to, updated_at: new Date().toISOString() })
        .is('branch_id', null).eq('method', from);
      if (error) throw error;
    }
    return { data: { renamed, removed }, error: null };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'QR_SYNC_FAILED', message: err?.message || 'Could not update the payment QR codes.' } };
  }
}

// Admin-only org booking-setting toggles (settings.show_staff_selection, settings.enable_staff_ratings).
// p_key is allow-listed server-side in update_org_booking_settings (migration-248).
export async function updateOrgBookingSetting(key, enabled) {
  const { data, error } = await supabase.rpc('update_org_booking_settings', { p_key: key, p_value: !!enabled });
  if (error) {
    return { data: null, error: { code: error.code || 'UPDATE_FAILED', message: friendlyError(error, 'Failed to update booking setting.') } };
  }
  return { data, error: null };
}

// Admin-only org profile-settings (settings.about, settings.amenities,
// settings.included_with_visit, settings.optional_extras, settings.cancellation_policy).
// p_key is allow-listed server-side in update_org_profile_settings (migration-251).
// p_value is jsonb — strings/arrays alike.
export async function updateOrgProfileSetting(key, value) {
  const { data, error } = await supabase.rpc('update_org_profile_settings', { p_key: key, p_value: value });
  if (error) {
    return { data: null, error: { code: error.code || 'UPDATE_FAILED', message: friendlyError(error, 'Failed to update profile setting.') } };
  }
  return { data, error: null };
}

// Admin-only org branding (logo_url / hero_image_url plain columns, migration-251).
export async function updateOrgBranding({ logoUrl, heroImageUrl }) {
  const { data, error } = await supabase.rpc('update_org_branding', {
    p_logo_url: logoUrl || null,
    p_hero_image_url: heroImageUrl || null,
  });
  if (error) {
    return { data: null, error: { code: error.code || 'UPDATE_FAILED', message: error.message || 'Failed to update branding.' } };
  }
  return { data, error: null };
}

// ZNLY-206: every single-booking payment row goes through ONE database function (record_booking_payment, migration-380): it locks the
// booking, works out what is still owed in the database, refuses a tender above it and ignores a retry with the same key.
// `key` is per checkout attempt; one attempt that needs several calls derives a stable sub-key per call (suffix 0 = the first).
function subKey(key, n) {
  return n === 0 ? key : key.slice(0, -4) + (n + 4096).toString(16).slice(-4);
}
async function writeBookingPayment(bookingId, rows, key, notes) {
  const { data, error } = await supabase.rpc('record_booking_payment', {
    p_booking_id: bookingId, p_rows: rows, p_idempotency_key: key, p_notes: notes || null,
  });
  if (error) {
    const m = /^(OVERPAYMENT|ALREADY_PAID|DAY_LOCKED|INVALID_PAYMENT_MODE|INVALID_PAYMENT_STATE|BOOKING_NOT_FOUND|INVALID_AMOUNT):\s*(.*)$/s.exec(error.message || '');
    if (m) { const e = new Error(m[2] || m[1]); e.code = m[1]; throw e; }
    throw error;
  }
  return data?.payment_ids || [];
}

// Record one or more payment tenders against a booking. Supports split payments
// (e.g. part cash + part card) and leaving a remaining balance as a due, which is
// attributed to a free-typed responsible person (dueHolderName).
//   recordPayment({ bookingId, tenders: [{ amount, paymentMode }], dueHolderName, notes })
// Backward-compatible single full payment: { bookingId, paymentMode, notes }.
const WALK_IN_NEEDS_CLIENT_MSG = 'Packages, memberships, vouchers and wallets belong to a client. Add a client to this booking first.';
const WALK_IN_PAY_IN_FULL_MSG = 'A walk-in with no client has to pay in full. Collect the whole amount, or add a client to leave a balance.';
export async function recordPayment({ bookingId, tenders, paymentMode, dueHolderName, notes, idempotencyKey }) {
  const attemptKey = idempotencyKey || crypto.randomUUID();
  try {
    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, branch_id, status, payment_status, final_amount, is_locked, due_holder_name, is_walk_in, customer_id')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // ZNLY-327: a walk-in with no client belongs to nobody, so nothing here may draw on a person's wallet, voucher, package or membership.
    const walkInNoClient = !!booking.is_walk_in && !booking.customer_id;
    if (walkInNoClient && (tenders || []).some((t) => ['Membership', 'ReferralWallet', 'ReferralVoucher', 'VoucherWallet', 'SessionPackage'].includes(t.paymentMode))) {
      return { data: null, error: { code: 'WALK_IN_NEEDS_CLIENT', message: WALK_IN_NEEDS_CLIENT_MSG } };
    }

    // 2. (ZNLY-234) A closed day no longer blocks a payment: a balance on a closed-day booking stays collectable and lands on the day it is
    //    received; the closed report never changes. Every other edit of a locked booking is still refused by the database.

    // 3. Already fully paid check (partial/unpaid may still receive tenders)
    if (booking.payment_status === 'paid') {
      return { data: null, error: { code: 'ALREADY_PAID', message: 'Payment has already been recorded for this booking.' } };
    }

    // 4. Status check — payment allowed for Confirmed, In-Progress, Completed
    if (!['Confirmed', 'In-Progress', 'Completed'].includes(booking.status)) {
      return { data: null, error: { code: 'INVALID_PAYMENT_STATE', message: 'Payment can only be recorded for Confirmed, In-Progress, or Completed bookings.' } };
    }

    // 5. Auth
    const { user, profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);

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
      await writeBookingPayment(bookingId, [{
        amount: 0,
        payment_mode: (Array.isArray(tenders) && tenders[0]?.paymentMode) || paymentMode || 'No Charge',
      }], attemptKey, notes || 'Auto-settled — no balance due');
      return { data: { success: true, settledWithoutPayment: true }, error: null };
    }

    // 7. Normalize tenders. An explicit empty array means "leave the full
    // amount due" (no tenders to collect) — only fall back to a single
    // full-remaining tender when tenders wasn't provided at all (legacy
    // single-paymentMode callers).
    let tenderList = Array.isArray(tenders)
      ? tenders
      : [{ amount: remaining, paymentMode }];

    // SessionPackage tenders redeem one session from a customer's prepaid
    // package (migration-141). The session's value was already collected when
    // the package itself was purchased, so the caller never supplies an NPR
    // amount for it (unlike every other tender type) — pulled out here,
    // BEFORE the amount-normalization/filter step below (which drops any
    // tender with amount<=0 and would otherwise silently discard these).
    // They're re-priced further down (once `remaining` minus the other NPR
    // tenders is known) and folded back into `tenderTotal`/`leftover` so the
    // booking can actually settle — see the "settlement" comment below for
    // why v_paid/payment_status needs a real payments.amount, not $0.
    const sessionPackageTenders = tenderList.filter(t => t.paymentMode === 'SessionPackage');
    for (const t of sessionPackageTenders) {
      if (!t.packageId) {
        return { data: null, error: { code: 'INVALID_PAYMENT_MODE', message: 'Missing package reference for session package tender.' } };
      }
    }
    tenderList = tenderList.filter(t => t.paymentMode !== 'SessionPackage');

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

    const nprTenderTotal = Math.round(tenderList.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    if (nprTenderTotal > remaining) {
      // The amounts themselves are withheld for a price-restricted staff
      // account — "hidden everywhere, including at payment" (migration-320)
      // — so this message must not hand the balance back in plain text.
      const message = vis.canViewPrices
        ? `Payment (NPR ${nprTenderTotal}) exceeds the remaining balance (NPR ${remaining}).`
        : 'Payment exceeds the remaining balance.';
      return { data: null, error: { code: 'OVERPAYMENT', message } };
    }

    // SessionPackage tenders settle whatever balance is left after the NPR
    // tenders above ("1 session, full service value" — a redemption is
    // expected to cover the rest of this booking's remaining balance, not a
    // caller-chosen amount). This residual — split evenly across multiple
    // SessionPackage tenders, if more than one, with any rounding remainder
    // folded into the last — becomes each tender's `payments.amount`. That's
    // required for update_booking_payment_status() (migration-042) to ever
    // mark the booking 'paid': it sums payments.amount directly (`v_paid`),
    // so a $0 row can never cross the `v_paid >= v_final` threshold. This
    // mirrors how Membership/VoucherWallet tenders also post a real
    // payments.amount despite not being new cash collected today — only
    // `nprTenderTotal` (computed above, before this block) represents an NPR
    // tender amount the payer is actively choosing a method for; this residual
    // is deliberately kept out of THAT sum and the OVERPAYMENT check above,
    // since it is by construction never able to overpay (it's exactly
    // `remaining - nprTenderTotal`, never more).
    const sessionPackageResidual = Math.round((remaining - nprTenderTotal) * 100) / 100;
    let sessionPackageAmounts = [];
    if (sessionPackageTenders.length > 0) {
      const share = Math.floor((sessionPackageResidual / sessionPackageTenders.length) * 100) / 100;
      sessionPackageAmounts = sessionPackageTenders.map(() => share);
      const distributed = Math.round(share * sessionPackageTenders.length * 100) / 100;
      const remainder = Math.round((sessionPackageResidual - distributed) * 100) / 100;
      sessionPackageAmounts[sessionPackageAmounts.length - 1] =
        Math.round((sessionPackageAmounts[sessionPackageAmounts.length - 1] + remainder) * 100) / 100;
    }
    const sessionPackageTotal = Math.round(sessionPackageAmounts.reduce((s, a) => s + a, 0) * 100) / 100;
    const tenderTotal = Math.round((nprTenderTotal + sessionPackageTotal) * 100) / 100;

    const leftover = Math.round((remaining - tenderTotal) * 100) / 100;
    const resolvedDueHolder = (dueHolderName || '').trim() || booking.due_holder_name || null;

    // ZNLY-327: no balance can ever be left on nobody.
    if (walkInNoClient && leftover > 0) {
      return { data: null, error: { code: 'WALK_IN_PAY_IN_FULL', message: WALK_IN_PAY_IN_FULL_MSG } };
    }

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
      const ids = await writeBookingPayment(
        bookingId, otherTenders.map((t) => ({ amount: t.amount, payment_mode: t.paymentMode })), subKey(attemptKey, 0), notes);
      insertedIds.push(...ids);
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

    // SessionPackage tenders: each redeems one session against a distinct
    // package (not poolable, like ReferralVoucher/VoucherWallet-by-id above),
    // so it's one redeem_package_session() call per tender. redeem_package_session()
    // itself has no amount param and only appends a package_redemptions row —
    // it does NOT insert a payments row (unlike record_voucher_wallet_payment),
    // so a payment row is inserted per tender here using the residual amount
    // computed above (sessionPackageAmounts), NOT $0 — see the settlement
    // comment above for why a non-zero payments.amount is required for
    // update_booking_payment_status() to ever mark the booking 'paid'.
    if (sessionPackageTenders.length > 0) {
      const priorTendersExist = otherTenders.length > 0 || membershipTenders.length > 0
        || referralWalletTenders.length > 0 || referralVoucherTenders.length > 0
        || voucherWalletTenders.length > 0 || voucherWalletPooledTenders.length > 0;
      for (let i = 0; i < sessionPackageTenders.length; i++) {
        const t = sessionPackageTenders[i];
        const { error: redeemError } = await supabase.rpc('redeem_package_session', {
          p_package_id: t.packageId,
          p_booking_id: bookingId,
          p_branch_claimed_id: booking.branch_id,
        });
        if (redeemError) throw redeemError;

        const ids = await writeBookingPayment(
          bookingId, [{ amount: sessionPackageAmounts[i], payment_mode: 'SessionPackage' }], subKey(attemptKey, i + 1),
          (!priorTendersExist && i === 0) ? notes : null);
        insertedIds.push(...ids);
      }
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
      tender_modes: [...tenderList.map(t => t.paymentMode), ...sessionPackageTenders.map(() => 'SessionPackage')],
      total_amount: tenderTotal,
      fully_paid: leftover === 0,
    });
    return {
      data: {
        success: true,
        paymentIds: insertedIds,
        bookingId,
        ...(vis.canViewPrices ? { amountPaid: tenderTotal, amountDue: leftover } : {}),
        fullyPaid: leftover === 0,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] recordPayment error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Logs a customer gratuity against a booking (migration-240) — NOT company revenue.
// Deliberately decoupled from recordPayment's tender-bucketing/OVERPAYMENT logic: a
// separate table, a separate insert, no FK/trigger relationship to `payments`. Called
// as a second, best-effort write immediately after recordPayment() succeeds (see each
// page's handleRecordPayment) — a failure here must never undo or block the payment
// itself, which has already been recorded. `receivedBy` (migration-242) is the staff
// member who actually received the tip — not necessarily the assigned therapist, since
// a guest may hand it to whoever they interacted with (service or support staff) —
// optional, a users.id, not a therapists.id (support staff may have no therapist row).
export async function recordTip({ bookingId, amount, notes, receivedBy }) {
  try {
    const tipAmount = Math.round(Number(amount) * 100) / 100;
    if (!tipAmount || tipAmount <= 0) {
      return { data: null, error: { code: 'INVALID_TIP_AMOUNT', message: 'Tip amount must be greater than zero.' } };
    }

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, is_locked, status')
      .eq('id', bookingId)
      .single();
    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    const mutationError = validateBookingMutation(booking);
    if (mutationError) return { data: null, error: mutationError };

    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('booking_tips')
      .insert({ booking_id: bookingId, amount: tipAmount, recorded_by: user.id, received_by: receivedBy || null, notes: notes || null })
      .select('id, amount, created_at')
      .single();
    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('[API] recordTip error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Every working staff member at a branch — service staff (therapists, via their
// users row) AND support/front-desk staff — for the "who received this tip"
// picker (migration-242). Deliberately reads `users`, not `therapists`: a tip
// can go to someone with no therapists row at all.
export async function fetchBranchStaffUsers(branchId) {
  try {
    let query = supabase
      .from('users')
      .select('id, full_name, role')
      .in('role', ['staff', 'manager', 'admin'])
      .eq('is_active', true)
      .order('full_name');
    query = withBranch(query, branchId);
    const { data, error } = await query;
    if (error) throw error;
    return { data: (data || []).map(u => ({ id: u.id, name: u.full_name, role: u.role })), error: null };
  } catch (error) {
    console.error('[API] fetchBranchStaffUsers error:', error.message);
    return { data: null, error };
  }
}

// Running Today / This Month / All-time tip totals for a branch (migration-240/241/242),
// split into pending vs distributed — "distributed" meaning a manager/admin has
// confirmed the cash was actually handed to staff (markTipsDistributed below), not
// just recorded in the app — plus an all-time per-staff breakdown (byStaff) so it's
// clear not just how much but WHO received it. Bucketed by the booking's own `date`
// (same "today"/"this month" semantics every other report in this file uses), not the
// tip row's created_at — a tip recorded today against an older booking's payment still
// counts toward that booking's own day, consistent with getDailySummary/
// getDailyOperationalReport. Single query, bucketed client-side, rather than 4 separate
// round trips (3 periods + a staff breakdown).
export async function getTipsSummary(branchId) {
  try {
    const today = getTodayISO();
    const { startDate: monthStart } = getPeriodRange('monthly');

    let query = supabase
      .from('booking_tips')
      .select('amount, distributed_at, received_by, receiver:users!received_by(full_name), booking:bookings!inner(branch_id, date)');
    query = isOverallBranch(branchId) ? query : query.eq('booking.branch_id', resolveBranchId(branchId));
    const { data, error } = await query;
    if (error) throw error;

    const bucket = () => ({ total: 0, distributed: 0, pending: 0 });
    const sums = { today: bucket(), thisMonth: bucket(), allTime: bucket() };
    const byStaffMap = new Map();

    for (const t of (data || [])) {
      const amt = Number(t.amount);
      const isDistributed = !!t.distributed_at;
      const date = t.booking?.date;
      const addTo = (b) => { b.total += amt; if (isDistributed) b.distributed += amt; else b.pending += amt; };

      addTo(sums.allTime);
      if (date && date >= monthStart) addTo(sums.thisMonth);
      if (date === today) addTo(sums.today);

      const key = t.received_by || 'unspecified';
      if (!byStaffMap.has(key)) {
        byStaffMap.set(key, { id: t.received_by, name: t.receiver?.full_name || 'Unspecified', ...bucket() });
      }
      addTo(byStaffMap.get(key));
    }

    const byStaff = Array.from(byStaffMap.values()).sort((a, b) => b.total - a.total);

    return {
      data: { today: sums.today, thisMonth: sums.thisMonth, allTime: sums.allTime, byStaff },
      error: null,
    };
  } catch (error) {
    console.error('[API] getTipsSummary error:', error.message);
    return { data: null, error };
  }
}

// Bulk-marks every currently-pending tip for a branch as distributed (migration-241
// RPC, admin/manager only — no client UPDATE policy exists on booking_tips at all,
// same immutable-except-via-RPC posture as payments/admin_correct_payment_mode).
// Branch-wide and bulk, not per-tip, to match how the total is surfaced (a running
// pending/distributed figure, not an itemized list) — returns the count updated.
export async function markTipsDistributed(branchId) {
  try {
    const { data, error } = await supabase.rpc('mark_tips_distributed', {
      p_branch_id: resolveBranchId(branchId),
    });
    if (error) throw error;
    return { data: { count: data }, error: null };
  } catch (error) {
    console.error('[API] markTipsDistributed error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Atomic counterpart to calling recordPayment once per booking: every
// booking in `payments` is validated inside ONE database transaction
// (record_group_payment, migration-178) — all or nothing, closing the
// partial-bundle failure mode a sequential loop of recordPayment calls
// can't avoid (payments rows are immutable, so a mid-loop failure can't be
// rolled back client-side). Handles every tender type recordPayment does
// (Cash/Card/Bank, Membership, ReferralWallet, ReferralVoucher,
// VoucherWallet, SessionPackage) — the RPC calls each type's own
// SECURITY DEFINER function (record_membership_payment etc.) from inside
// itself, which runs in the same transaction, so no tender type needs a
// separate non-atomic fallback.
//
// `payments`: [{ bookingId, tenders: [{amount, paymentMode, referralId, voucherId, packageId}], dueHolderName, notes }]
export async function recordGroupPayment(payments) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('record_group_payment', {
      p_payments: (payments || []).map((p) => ({
        booking_id: p.bookingId,
        tenders: (p.tenders || []).map((t) => ({
          amount: Number(t.amount),
          payment_mode: t.paymentMode,
          ...(t.paymentMode === 'ReferralVoucher' ? { referral_id: t.referralId } : {}),
          ...(t.paymentMode === 'VoucherWallet' ? { voucher_id: t.voucherId || null } : {}),
          ...(t.paymentMode === 'SessionPackage' ? { package_id: t.packageId } : {}),
        })),
        due_holder_name: p.dueHolderName || null,
        notes: p.notes || null,
      })),
    });
    if (error) throw error;

    capture('staff_group_payment_recorded', {
      booking_count: (payments || []).length,
      total_amount: (data || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0),
    });

    return {
      data: (data || []).map((r) => ({
        bookingId: r.booking_id,
        amountPaid: Number(r.amount_paid || 0),
        amountDue: Number(r.amount_due || 0),
        fullyPaid: !!r.fully_paid,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] recordGroupPayment error:', error.message);
    return { data: null, error: plainError(error) };
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
    const name = toTitleCase(dueHolderName) || null;
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

// Outstanding balances grouped by responsible person: DUE only (the one money model, utils/bookingMoney). Only rendered visits
// (In-Progress / Completed) can be owed; upcoming bookings never are; paid = payments − refunds, never payment_status (its trigger can
// go stale), so the status is NOT a filter here. Rows are paged with .range() and summed in paisa. from/to are ISO dates (inclusive).
export async function getOutstandingByStaff({ branchId, from, to } = {}) {
  try {
    const rows = await pageAllRows(() => {
      let query = supabase
        .from('bookings')
        .select('id, booking_number, customer_name, customer_phone, date, status, final_amount, payment_status, due_holder_name, service_name_snapshot, is_locked, payments(amount), payment_refunds(amount)')
        .in('status', ['In-Progress', 'Completed'])
        .order('id');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return withBranch(query, branchId);
    });
    const m = summarizeMoney(rows, { today: nepalNow().today });
    const groups = {};
    for (const b of m.dueBookings) {
      const rawName = (b.due_holder_name || '').trim();
      const key = rawName || '__unassigned__';
      if (!groups[key]) groups[key] = { dueHolderName: rawName || null, totalDue: 0, bookingCount: 0, bookings: [] };
      groups[key].totalDue = roundMoney(groups[key].totalDue + b.money.due); // paisa-exact
      groups[key].bookingCount += 1;
      groups[key].bookings.push({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        customerPhone: b.customer_phone,
        date: b.date,
        serviceName: b.service_name_snapshot || '—',
        finalAmount: b.money.price,
        amountPaid: b.money.paid,
        amountDue: b.money.due,
        paymentStatus: b.payment_status,
        isLocked: !!b.is_locked,
      });
    }
    return { data: Object.values(groups).sort((x, y) => y.totalDue - x.totalDue), error: null };
  } catch (error) {
    console.error('[API] getOutstandingByStaff error:', error.message);
    return { data: null, error };
  }
}

// Close a past Pending/Confirmed booking that never got a status ("Needs closing"). Uses the normal status path (updateBookingStatus),
// so locks, terminal-status, role and No Show reason rules all apply. The state machine has no direct Confirmed → Completed, so completing
// walks Pending → Confirmed → In-Progress → Completed one valid step at a time.
export async function closePastBooking({ bookingId, outcome, reason }) {
  const { data: b, error } = await supabase.from('bookings').select('id, status').eq('id', bookingId).single();
  if (error) return { data: null, error: plainError(error) };
  const steps = planClose(b.status, outcome, reason);
  if (!steps) return { data: null, error: { code: 'NOT_OPEN', message: `This booking is already ${b.status}.` } };
  // A later step can be refused (e.g. a closed day), leaving the booking mid-way: runCloseSteps then says where it stopped.
  return runCloseSteps(steps, (newStatus, why) => updateBookingStatus({ bookingId, newStatus, reason: why }), (e) => friendlyError(e, 'Something went wrong.'));
}

// "Honest Collect": record each bundled booking's allocation and CHECK every result. Returns the bookings that were NOT recorded (so the
// caller can name them) — a failed bundled payment must never be swallowed.
export async function recordBundledAllocations({ allocations = [], notes, bookings = [] }) {
  const failures = [];
  for (const alloc of allocations) {
    const res = await recordPayment({ bookingId: alloc.bookingId, tenders: alloc.tenders, notes });
    if (res.error) {
      const row = bookings.find((o) => o.bookingId === alloc.bookingId);
      failures.push(`${row?.bookingNumber || alloc.bookingNumber || alloc.bookingId}${res.error.message ? ` (${res.error.message})` : ''}`);
    }
  }
  return failures;
}

// Local-DB audit helper: how many bookings have a payment_status that disagrees with their recorded payments (payments − refunds)?
export async function countPaymentStatusMismatches({ branchId } = {}) {
  const rows = await pageAllRows(() => withBranch(supabase.from('bookings').select('id, status, payment_status, final_amount, date, payments(amount), payment_refunds(amount)').order('id'), branchId));
  const today = nepalNow().today;
  return rows.filter((b) => {
    const m = classifyBooking(b, { today });
    const expected = m.paid <= 0 ? 'unpaid' : m.paid + 1e-9 >= m.price && m.price > 0 ? 'paid' : 'partial';
    return b.payment_status !== expected && !(b.payment_status === 'unpaid' && m.paid === 0);
  }).length;
}

// Outstanding report extras: past Pending/Confirmed bookings that were never closed ("Needs closing", plus visits left In-Progress from an
// earlier day) and the total of upcoming unpaid bookings (not owed yet). Same date-filter semantics as getOutstandingByStaff.
export async function getNeedsClosing({ branchId, from, to } = {}) {
  try {
    const today = nepalNow().today;
    const rows = await pageAllRows(() => {
      let query = supabase
        .from('bookings')
        .select('id, booking_number, customer_id, customer_name, customer_phone, date, start_time, status, final_amount, service_name_snapshot, therapist_name_snapshot, therapist_id, booking_therapists(therapist_id), is_locked, payments(amount), payment_refunds(amount)')
        .in('status', ['Pending', 'Confirmed', 'In-Progress']) // In-Progress only matters when from a previous day (stale)
        .order('id');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return withBranch(query, branchId);
    });
    const m = summarizeMoney(rows, { today });
    const shape = (b, extra) => ({
      bookingId: b.id, bookingNumber: b.booking_number, customerName: b.customer_name, customerId: b.customer_id, date: b.date,
      startTime: (b.start_time || '').slice(0, 5), serviceName: b.service_name_snapshot || '—', therapistName: b.therapist_name_snapshot || '—',
      status: b.status, isLocked: !!b.is_locked, therapistIds: [...new Set([b.therapist_id, ...(b.booking_therapists || []).map((t) => t.therapist_id)].filter(Boolean))], ...extra,
    });
    const unclosed = m.unclosed.map((b) => shape(b, { atStake: b.money.atStake, stillInProgress: false }))
      .concat(m.staleInProgress.map((b) => shape(b, { atStake: 0, stillInProgress: true }))) // its money is already in Outstanding
      .sort((x, y) => (x.date + x.startTime < y.date + y.startTime ? -1 : 1));
    return { data: { unclosed, unclosedAtStake: m.unclosedAtStake, upcoming: m.upcoming, upcomingCount: m.upcomingCount }, error: null };
  } catch (error) {
    console.error('[API] getNeedsClosing error:', error.message);
    return { data: null, error };
  }
}

// Org-wide outstanding (unpaid + partial) balances, grouped by branch — admin-only
// report. Relies on RLS: role='admin' already bypasses the branch_id check on
// "bookings" (migration-224), so an unfiltered query here returns every branch
// in the admin's org without needing branchId/withBranch. from/to are ISO dates
// (inclusive); omit for all-time.
export async function getDueReportByBranch({ from, to } = {}) {
  try {
    const bookings = await fetchAllPages((opts) => {
      let query = supabase
        .from('bookings')
        .select(
          'id, booking_number, branch_id, branches(name), customer_name, customer_phone, date, status, final_amount, payment_status, therapist_name_snapshot, client_request_id, created_by, creator:users!created_by(full_name), payments(amount)', opts)
        .in('payment_status', ['unpaid', 'partial'])
        .not('status', 'in', '("Cancelled","No Show")');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return query.order('id'); // total order — see getOutstandingByStaff
    });

    const groups = {};
    for (const b of bookings || []) {
      const collected = (b.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      const due = Math.round((Number(b.final_amount) - collected) * 100) / 100;
      if (due <= 0) continue;
      const branchId = b.branch_id;
      if (!groups[branchId]) {
        groups[branchId] = { branchId, branchName: b.branches?.name || 'Unknown Branch', totalDue: 0, bookingCount: 0, bookings: [] };
      }
      groups[branchId].totalDue = Math.round((groups[branchId].totalDue + due) * 100) / 100;
      groups[branchId].bookingCount += 1;
      groups[branchId].bookings.push({
        bookingId: b.id,
        bookingNumber: b.booking_number,
        date: b.date,
        status: b.status,
        paymentStatus: b.payment_status,
        customerName: b.customer_name,
        customerPhone: b.customer_phone,
        therapistName: b.therapist_name_snapshot || null,
        createdByName: b.creator?.full_name || null,
        isOnlineBooking: !b.created_by && Boolean(b.client_request_id),
        finalAmount: Number(b.final_amount),
        amountPaid: collected,
        amountDue: due,
      });
    }

    const result = Object.values(groups).sort((a, b) => b.totalDue - a.totalDue);
    return { data: result, error: null };
  } catch (error) {
    console.error('[API] getDueReportByBranch error:', error.message);
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
    // Need a full number (country code + national) before matching — a stray fragment must not sweep up unrelated bookings.
    if (!normalizedPhone || normalizedPhone.length < 11) return { data: dueSummary(summarizeMoney([], { today: nepalNow().today })), error: null };
    const today = nepalNow().today;
    // DUE only (the one money model): rendered visits (In-Progress / Completed), paid = payments − refunds. Candidates are chosen by
    // status, NEVER by payment_status (it can be stale, and the pre-filter must never exclude a booking that is truly due). Filtered on the
    // server by the normalised phone (bookings.customer_phone is canonicalised on write), so this no longer downloads the branch's history;
    // samePhone below stays as a safety net for any legacy-format straggler. Fails open at the callers.
    const rows = await pageAllRows(() => {
      let query = supabase
        .from('bookings')
        .select(DUE_COLUMNS)
        .eq('customer_phone', normalizedPhone)
        .in('status', ['In-Progress', 'Completed'])
        .order('id');
      if (excludeBookingId) query = query.neq('id', excludeBookingId);
      return withBranch(query, branchId);
    });
    const mine = rows.filter((b) => samePhone(b.customer_phone, normalizedPhone));
    return { data: dueSummary(summarizeMoney(mine, { today, excludeBookingId })), error: null };
  } catch (error) {
    console.error('[API] getCustomerOutstandingBalance error:', error.message);
    return { data: null, error };
  }
}

const DUE_COLUMNS = 'id, booking_number, customer_id, customer_name, customer_phone, date, status, final_amount, payment_status, is_locked, service_name_snapshot, payments(amount), payment_refunds(amount)';

// Shape returned to Prev. due / Collect callers. `bookings` are only the COLLECTABLE ones: bookings on closed (locked) days can't be paid
// from here (the day is closed), so they are reported separately (lockedDue / lockedBookings) and never bundled.
const dueSummary = (m) => {
  const row = (b) => ({
    bookingId: b.id, bookingNumber: b.booking_number, customerName: b.customer_name, date: b.date,
    serviceName: b.service_name_snapshot || '—', finalAmount: b.money.price, amountPaid: b.money.paid, amountDue: b.money.due,
    paymentStatus: b.payment_status, isLocked: !!b.is_locked,
  });
  // ZNLY-234: a balance on a closed day is collectable like any other (it is recorded on the day it is received), so nothing is "locked out" any more.
  const collectable = m.dueBookings;
  const locked = [];
  return {
    totalDue: m.due, // everything owed (the warning / chip)
    bookingCount: m.dueCount,
    collectableDue: roundMoney(collectable.reduce((x, b) => x + b.money.due, 0)),
    bookings: collectable.map(row),
    lockedDue: roundMoney(locked.reduce((x, b) => x + b.money.due, 0)),
    lockedBookings: locked.map(row),
  };
};

// History of bookings that used to carry an outstanding due and have since been
// fully paid off — who owed it, when it was settled, and which payment method(s)
// cleared it. from/to filter by settlement date (the latest payment's created_at).
export async function getSettledDueHistory({ branchId, from, to } = {}) {
  try {
    // "settledAt" is not a stored column — it's the LATEST of possibly several
    // payments on a booking, computed in JS. from/to were then also filtered in
    // JS (after fetching every paid+due-holder booking ever for the branch), so
    // the date picker did nothing at the query level.
    //
    // schema.sql declares payments.booking_id UNIQUE, but that constraint is NOT
    // actually present on the live database — confirmed via psql: some bookings
    // carry 2-3 payment rows in production. So "the latest payment" genuinely
    // needs every payment for a booking, not just whichever one falls in
    // [from, to] — an earlier payment landing inside the window doesn't mean
    // that's the true settledAt if a later one (possibly outside the window)
    // exists. Two passes instead of one query:
    //   1. Candidates — paid+due-holder bookings with >= 1 payment in [from, to].
    //      This is what actually bounds the query by date instead of reading
    //      all-time history.
    //   2. For just those candidates, fetch every payment (unfiltered by date)
    //      to compute the true settledAt and re-check it's actually in range —
    //      a booking whose true latest payment lands outside [from, to] is
    //      correctly excluded even though pass 1 found an earlier match.
    //
    // Both the query bound AND the re-check below must agree on what "in
    // range" means. Computed once, as actual instants (Date objects), and
    // reused for both — a prior version recomputed the re-check via
    // `settledAt.slice(0, 10)` (a UTC calendar-date string) against the same
    // Nepal-midnight `from`/`to`, which disagree for any payment taken between
    // Nepal midnight and 05:45 UTC: pass 1 (Nepal-correct) would include it,
    // the UTC-naive re-check would drop it. A due settled at 2am Nepal on the
    // first day of the range vanished from the report for that whole 5h45m
    // window, every day.
    const fromInstant = from ? new Date(`${from}T00:00:00+05:45`) : null;
    const toInstant = (() => {
      if (!to) return null;
      const nextDay = new Date(`${to}T00:00:00+05:45`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      return nextDay; // exclusive upper bound, same convention as getTodayInsights' nextDayBoundary
    })();

    const candidateRows = await fetchAllPages((opts) => {
      let query = supabase
        .from('payments')
        .select('booking_id, booking:bookings!inner(id)', opts)
        .eq('booking.payment_status', 'paid')
        .not('booking.due_holder_name', 'is', null);
      if (!isOverallBranch(branchId)) {
        query = query.eq('booking.branch_id', resolveBranchId(branchId));
      }
      if (fromInstant) query = query.gte('created_at', fromInstant.toISOString());
      if (toInstant) query = query.lt('created_at', toInstant.toISOString());
      return query.order('id');
    });

    const candidateIds = [...new Set(candidateRows.map((r) => r.booking_id))];
    if (candidateIds.length === 0) return { data: [], error: null };

    // candidateIds is unbounded in principle — api.js:~1235 documents a bare
    // .in() list rejected by PostgREST above ~500-700 ids. Only 12 settled-due
    // bookings exist in production today, so this can't bite yet; chunk it
    // (see fetchAllPages' sibling pattern elsewhere in this file) if that
    // table ever grows past a few hundred.
    const [allPayments, bookingRows] = await Promise.all([
      fetchAllPages((opts) =>
        supabase
          .from('payments')
          .select('booking_id, amount, payment_mode, created_at', opts)
          .in('booking_id', candidateIds)
          .order('id')
      ),
      fetchAllPages((opts) =>
        supabase
          .from('bookings')
          .select('id, booking_number, customer_name, customer_phone, date, final_amount, due_holder_name, service_name_snapshot', opts)
          .in('id', candidateIds)
          .order('id')
      ),
    ]);

    const paymentsByBooking = {};
    for (const p of allPayments) {
      (paymentsByBooking[p.booking_id] ||= []).push(p);
    }

    let rows = bookingRows.map((b) => {
      const tenders = (paymentsByBooking[b.id] || [])
        .slice()
        .sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
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

    // Re-check against the TRUE settledAt — pass 1 only guarantees *a* payment
    // in range, not necessarily the latest one. Same fromInstant/toInstant as
    // the query bound above — comparing real instants, not a UTC date-string
    // slice, so this can't disagree with pass 1 the way it did before.
    if (fromInstant) rows = rows.filter((r) => new Date(r.settledAt) >= fromInstant);
    if (toInstant) rows = rows.filter((r) => new Date(r.settledAt) < toInstant);

    rows.sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt));
    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] getSettledDueHistory error:', error.message);
    return { data: null, error };
  }
}

export const REFERRAL_COMMISSION_TYPES = ['percentage', 'amount'];

// computeReferralCommission lives in ./payrollCalc (shared with the therapist profile); imported at the top of this file.

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

// Active (redeemable) session packages for a customer/guest, scoped to one
// service — used by PaymentModal to surface a `PackageWalletCard` at checkout
// (migration-141). A package only shows up here if it's bound to the same
// service being booked (a package for a different service is never a valid
// tender for this booking) and hasn't been fully redeemed or expired.
// Matches by `customer_id` (registered customers) OR `guest_info` (phone —
// walk-in/guest-issued packages with no linked customer row), mirroring how
// `fetchReferralRewardForBooking` resolves rewards. `package_balances` is a
// view over `packages` (see migration-141) declared `WITH (security_invoker
// = true)`, which is what makes it run as the querying role rather than the
// view owner — without that, it would bypass RLS on the underlying table
// entirely. Returns the enriched rows the UI needs
// (`sessionsRemaining`, `expiryDate`, etc.) — `[]` when nothing matches.
export async function getActivePackagesForCustomer(customerId, phone, serviceId) {
  try {
    if (!serviceId || (!customerId && !phone)) return { data: [], error: null };

    let query = supabase
      .from('package_balances')
      .select(`
        package_id, org_id, branch_id, package_type_id, service_id, customer_id,
        guest_name, guest_info, expiry_date, sessions_total, sessions_used,
        sessions_remaining, status, last_redeemed_date
      `)
      .eq('service_id', serviceId)
      .not('status', 'in', '("fully_redeemed","expired")');

    // Sanitize phone before interpolating into a raw PostgREST filter string
    // (same guard as the booking search filter above).
    const sanitizedPhone = phone ? String(phone).replace(/[,.()"\\]/g, '') : null;
    if (customerId && sanitizedPhone) {
      query = query.or(`customer_id.eq.${customerId},guest_info.eq.${sanitizedPhone}`);
    } else if (customerId) {
      query = query.eq('customer_id', customerId);
    } else {
      query = query.eq('guest_info', sanitizedPhone);
    }

    const { data: balances, error: balanceError } = await query;
    if (balanceError) throw balanceError;
    if (!balances || balances.length === 0) return { data: [], error: null };

    const packageIds = balances.map((b) => b.package_id);
    const { data: packageRows, error: packageError } = await supabase
      .from('packages')
      .select('id, package_type_id, package_code, remarks, issued_date, paid_amount, package_type:package_type_id(name)')
      .in('id', packageIds);
    if (packageError) throw packageError;

    const packageById = {};
    for (const p of packageRows || []) packageById[p.id] = p;

    const result = balances.map((b) => {
      const pkg = packageById[b.package_id] || {};
      return {
        packageId: b.package_id,
        packageTypeId: b.package_type_id,
        packageName: pkg.package_type?.name || 'Package',
        packageCode: pkg.package_code || null,
        serviceId: b.service_id,
        customerId: b.customer_id,
        guestName: b.guest_name,
        guestInfo: b.guest_info,
        expiryDate: b.expiry_date,
        sessionsTotal: b.sessions_total,
        sessionsUsed: b.sessions_used,
        sessionsRemaining: b.sessions_remaining,
        status: b.status,
        issuedDate: pkg.issued_date || null,
        paidAmount: pkg.paid_amount != null ? Number(pkg.paid_amount) : null,
        remarks: pkg.remarks || null,
      };
    });

    return { data: result, error: null };
  } catch (error) {
    console.error('[API] getActivePackagesForCustomer error:', error.message);
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
    const bookings = await fetchAllPages((opts) => {
      let query = supabase
        .from('bookings')
        .select('service_name_snapshot, final_amount, branch_id, branches(name)', opts)
        .eq('payment_status', 'paid');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return withBranch(query, branchId).order('id'); // total order — see getOutstandingByStaff
    });

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

export async function getCategoryRevenueByBranch({ branchId, from, to } = {}) {
  try {
    const bookings = await fetchAllPages((opts) => {
      let query = supabase
        .from('bookings')
        .select('final_amount, branch_id, service_category_snapshot, branches(name)', opts)
        .eq('payment_status', 'paid');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return withBranch(query, branchId).order('id'); // total order — see getOutstandingByStaff
    });

    const branchMap = new Map();     // branch_id -> branch name
    const categoryMap = new Map();   // category name -> { [branchId]: { revenue, count } }
    const branchTotals = {};         // branch_id -> { revenue, count }
    let grandTotalRevenue = 0;
    let grandTotalCount = 0;

    for (const b of (bookings || [])) {
      const cat = b.service_category_snapshot || 'Uncategorized';
      const bId = b.branch_id;
      const bName = b.branches?.name || 'Unknown Branch';
      const amount = Number(b.final_amount) || 0;

      if (!branchMap.has(bId)) branchMap.set(bId, bName);
      if (!categoryMap.has(cat)) categoryMap.set(cat, {});
      const catRow = categoryMap.get(cat);
      if (!catRow[bId]) catRow[bId] = { revenue: 0, count: 0 };
      catRow[bId].revenue = Math.round((catRow[bId].revenue + amount) * 100) / 100;
      catRow[bId].count += 1;

      if (!branchTotals[bId]) branchTotals[bId] = { revenue: 0, count: 0 };
      branchTotals[bId].revenue = Math.round((branchTotals[bId].revenue + amount) * 100) / 100;
      branchTotals[bId].count += 1;

      grandTotalRevenue = Math.round((grandTotalRevenue + amount) * 100) / 100;
      grandTotalCount += 1;
    }

    const branches = Array.from(branchMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const categories = Array.from(categoryMap.entries()).map(([name, byBranch]) => {
      const totalRevenue = branches.reduce((s, br) => s + (byBranch[br.id]?.revenue || 0), 0);
      const totalCount = branches.reduce((s, br) => s + (byBranch[br.id]?.count || 0), 0);
      return {
        categoryName: name,
        byBranch,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCount,
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
      data: { branches, categories, branchTotals, grandTotalRevenue, grandTotalCount },
      error: null,
    };
  } catch (error) {
    console.error('[API] getCategoryRevenueByBranch error:', error.message);
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
      .select('id, status, is_locked, date')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw fetchError;
    }

    // 1b. ZNLY-275: no Start / Complete / No-show for a later day (the DB trigger enforces it too; this gives the same sentence without a round trip)
    const futureMsg = futureBookingMessage(booking.date, { 'In-Progress': 'start', Completed: 'complete', 'No Show': 'noshow' }[newStatus] || null);
    if (futureMsg && ['In-Progress', 'Completed', 'No Show'].includes(newStatus)) return { data: null, error: { code: 'FUTURE_BOOKING', message: futureMsg } };

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
    // ZNLY-235: a restricted login cannot read the base row back (UPDATE ... RETURNING needs it), so it writes through a definer RPC
    // that checks the booking is theirs.
    let updated;
    if (isReadingViaSafeViews()) {
      const { data: r, error: rpcError } = await supabase.rpc('restricted_set_booking_status', { p_booking_id: bookingId, p_status: newStatus, p_reason: reason ?? null });
      if (rpcError) throw rpcError;
      updated = { id: r.id, status: r.status };
    } else {
      const { data: u, error: updateError } = await supabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', bookingId)
        .select('id, status')
        .single();
      if (updateError) throw updateError;
      updated = u;
    }

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
    return { data: null, error: plainError(error) };
  }
}

// Tiered pricing: what base_amount should a booking carry, given who is now
// assigned? Returns null when the service isn't tiered, so callers can leave
// the amount alone.
//
// Shared by assignTherapist and rescheduleBooking because BOTH change who is
// assigned. rescheduleBooking takes a newTherapistId and rewrites the
// booking_therapists junction, so a tiered booking moved onto a cheaper or
// dearer therapist would otherwise keep the old price — the charge is
// supposed to follow whoever actually delivers (migration-319).
async function tieredBaseAmountFor(serviceId, therapistId) {
  if (!serviceId) return null;
  const { data: svc, error: svcErr } = await supabase
    .from('services')
    .select('price_type, price_npr')
    .eq('id', serviceId)
    .single();
  if (svcErr) throw svcErr;
  if (svc.price_type !== 'tiered') return null;

  // Unassigned rate is the floor: no therapist, or a therapist whose tier has
  // no price for this service, both charge it. Never zero.
  let amount = Number(svc.price_npr);
  if (therapistId) {
    const { data: tierPrice, error: tierErr } = await fetchServicePriceForTherapist(serviceId, therapistId);
    if (tierErr) throw tierErr;
    if (tierPrice != null) amount = tierPrice;
  }
  return amount;
}

export async function assignTherapist({ bookingId, therapistIds = [], roomId, therapistRoomOverrides, companionName, companionPhone, overrideReason }) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    // Support legacy single therapistId param
    const ids = Array.isArray(therapistIds) ? therapistIds.filter(Boolean) : (therapistIds ? [therapistIds] : []);

    // 1. Fetch booking (include room_id + date for attendance check)
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, branch_id, room_id, date, start_time, service_id')
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
        return { data: null, error: { code: 'THERAPIST_INACTIVE', message: `Cannot assign inactive ${staffWord()}: ${inactive.name}` } };
      }

      // A therapist's live branch_id only reflects the CURRENT moment (flipped by the
      // apply/revert cron) — it's the wrong thing to check against a booking on a
      // different date. Reconstruct their expected branch AT THE BOOKING'S DATE/TIME
      // from the full staff_transfers window history instead (see
      // therapistBranchWindow.js) so scheduled-but-not-yet-applied and
      // already-reverted transfer windows are both handled correctly.
      const atDate = toKathmanduDate(booking.date, booking.start_time);
      const { data: transferRows } = await supabase
        .from('staff_transfers')
        .select('therapist_id, from_branch_id, to_branch_id, is_permanent, effective_date, start_time, revert_at, transferred_at')
        .in('therapist_id', ids);

      const transfersByTherapist = {};
      (transferRows || []).forEach(t => {
        (transfersByTherapist[t.therapist_id] ||= []).push(t);
      });

      const guardOwnsAvailability = await staffAvailabilityEnforced(booking.branch_id);
      const wrongBranch = guardOwnsAvailability ? null : (therapistsData || []).find(t =>
        computeTherapistBranchAt(transfersByTherapist[t.id] || [], t.branch_id, atDate) !== booking.branch_id
      );
      if (wrongBranch) {
        return { data: null, error: { code: 'INVALID_THERAPIST', message: `${wrongBranch.name} is not available in this ${wordBranch()} at this time (transferred elsewhere for this date).` } };
      }

      if (booking.date) {
        const { data: attendanceRecords } = await supabase
          .from('therapist_attendance')
          .select('therapist_id, status, check_out_time')
          .in('therapist_id', ids)
          .eq('date', booking.date);

        const absent = guardOwnsAvailability ? null : (attendanceRecords || []).find(a =>
          a.status === 'Absent' || LEAVE_LIKE_ATTENDANCE_STATUSES.includes(a.status)
        );
        if (absent) {
          const absentTherapist = (therapistsData || []).find(t => t.id === absent.therapist_id);
          return { data: null, error: { code: 'THERAPIST_ABSENT', message: `Cannot assign ${absentTherapist?.name || staffWord()}: marked as ${absent.status} for this date.` } };
        }

        const checkedOut = (attendanceRecords || []).find(a =>
          isAfterCheckout(a.check_out_time, booking.date, booking.start_time)
        );
        if (checkedOut) {
          const checkedOutTherapist = (therapistsData || []).find(t => t.id === checkedOut.therapist_id);
          return { data: null, error: { code: 'THERAPIST_CHECKED_OUT', message: `Cannot assign ${checkedOutTherapist?.name || staffWord()}: already checked out for this date.` } };
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
    if (companionName !== undefined) updatePayload.companion_name = companionName?.trim() || null;
    if (companionPhone !== undefined) updatePayload.companion_phone = companionPhone ? toE164(companionPhone) : null;
    if (availabilityOverride) updatePayload.availability_override_reason = availabilityOverride;

    // Tiered pricing: the charge follows whoever actually delivers, not who
    // was originally quoted (migration-319's standing decision) — reassigning
    // the primary therapist here recomputes the price right now, through the
    // same DB function the booking and payment screens use, so none of the
    // three can disagree about what this person costs. final_amount recomputes
    // itself from base_amount via the existing compute_final_amount trigger.
    if (booking.service_id) {
      const newBaseAmount = await tieredBaseAmountFor(booking.service_id, primaryId);
      if (newBaseAmount !== null) {
        updatePayload.base_amount = newBaseAmount;
      }
    }

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
      const availabilityErr = availabilityFailure(updateError);
      if (availabilityErr) return availabilityErr;
      if (updateError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: `${cap(staffWord())} is already booked during this time slot.` } };
      }
      throw updateError;
    }

    // 7a. Validate + capacity-check any per-therapist room overrides (couple bookings
    // with each person in a separate room) before touching the junction table, so a
    // full override room fails fast rather than after the primary update already committed.
    const overrideEntries = therapistRoomOverrides
      ? Object.entries(therapistRoomOverrides).filter(([tid, rid]) => rid && ids.includes(tid))
      : [];
    if (overrideEntries.length > 0) {
      const { rooms: overrideRooms, error: overrideRoomError } = await validateRoomsForBranch(
        overrideEntries.map(([, rid]) => rid),
        booking.branch_id
      );
      if (overrideRoomError) return { data: null, error: overrideRoomError };

      const { data: bkForCapacity } = await supabase.from('bookings').select('date, start_time, end_time').eq('id', bookingId).single();
      for (const [, overrideRoomId] of overrideEntries) {
        const capacityError = await checkOverrideRoomCapacity({
          room: overrideRooms.get(overrideRoomId),
          branchId: booking.branch_id,
          date: bkForCapacity?.date,
          startTime: bkForCapacity?.start_time,
          endTime: bkForCapacity?.end_time,
          excludeBookingId: bookingId,
        });
        if (capacityError) return { data: null, error: capacityError };
      }
    }

    // 8. Sync junction table: preserve per-therapist times AND room overrides where possible —
    // this delete+reinsert cycle previously dropped room_id silently on every reassignment.
    const { data: existingBt } = await supabase.from('booking_therapists').select('therapist_id, start_time, end_time, room_id').eq('booking_id', bookingId);
    const existingTimeMap = {};
    (existingBt || []).forEach(bt => { existingTimeMap[bt.therapist_id] = { start_time: bt.start_time, end_time: bt.end_time, room_id: bt.room_id }; });

    await supabase.from('booking_therapists').delete().eq('booking_id', bookingId);

    if (ids.length > 0) {
      // Fetch booking times for default
      const { data: bk } = await supabase.from('bookings').select('start_time, end_time').eq('id', bookingId).single();
      const rows = ids.map((tid, index) => ({
        booking_id: bookingId,
        therapist_id: tid,
        start_time: existingTimeMap[tid]?.start_time || bk?.start_time || null,
        end_time: existingTimeMap[tid]?.end_time || bk?.end_time || null,
        room_id: resolveJunctionRoomId({
          index,
          therapistId: tid,
          overridesMap: therapistRoomOverrides,
          existingRoomId: existingTimeMap[tid]?.room_id,
        }),
        ...(availabilityOverride && tid !== primaryId ? { availability_override_reason: availabilityOverride } : {}),
      }));
      const { error: junctionError } = await supabase.from('booking_therapists').insert(rows);
      const junctionAvailability = junctionError && availabilityFailure(junctionError);
      if (junctionAvailability) {
        // A companion is off shift / on break: the rows were just deleted, so put the previous ones back before
        // reporting, instead of leaving the booking with no therapist rows.
        const restore = (existingBt || []).map((bt) => ({ booking_id: bookingId, ...bt }));
        if (restore.length > 0) await supabase.from('booking_therapists').insert(restore);
        return junctionAvailability;
      }
      if (junctionError) {
        // Non-fatal: the primary therapist/room update on `bookings` above already
        // committed. But since migration-171 added a trigger that can reject this
        // insert for a real reason (room-capacity conflict), staying silent here would
        // leave the booking with ZERO therapist rows while reporting success -- surface
        // it as a warning so the caller can tell staff, instead of only console.warn.
        console.warn('[API] booking_therapists insert warning:', junctionError.message);
        return {
          data: { success: true, bookingId, therapistIds: ids, roomId: updated.room_id, warning: junctionError.message },
          error: null,
        };
      }
    }

    if (availabilityOverride) await clearAvailabilityOverride(bookingId);
    return { data: { success: true, bookingId, therapistIds: ids, roomId: updated.room_id }, error: null };
  } catch (error) {
    console.error('[API] assignTherapist error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// bookingGroupId (bookings.booking_group_id, migration-030) is the real,
// authoritative link between siblings created together as one group booking
// — when present, match on it instead of the customer_name+date heuristic,
// so bundling is exact rather than fuzzy-matched by name/date. Still scoped
// to payment_status='unpaid' — this is "what to bundle into a payment", not
// "everything in this group" (see fetchGroupBookings below for the latter).
// customerId (when known) additionally restricts results to the requesting
// booking's own customer — a booking_group_id link only means "created
// together" (e.g. a walk-in group under one shared name), not "same
// customer", so without this a sibling belonging to a genuinely different
// customer row could get bundled into a membership/wallet payment that's
// scoped to one customer (see the BK-20261011-0033/-0034 incident).
export async function fetchRelatedUnpaidBookings({ customerName, date, excludeBookingId, bookingGroupId, customerId }) {
  try {
    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_id, customer_name, date, start_time, end_time, base_amount, discount_amount, final_amount, payment_status, status, service:services(name, duration_minutes), room:rooms(name), therapist:therapists(name), payments(amount), payment_refunds(amount)')
      .not('status', 'in', '("Cancelled","No Show")')
      .neq('id', excludeBookingId);

    query = bookingGroupId
      ? query.eq('booking_group_id', bookingGroupId)
      : query.eq('customer_name', customerName).eq('date', date);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    const { data, error } = await query.order('start_time');

    if (error) throw error;
    // "Unpaid" = nothing held on it (payments − refunds = 0), decided from the payments like every other money figure — the same rule the
    // calendar's Prev. due uses to drop these siblings, so the two can never disagree.
    return { data: (data || []).filter((b) => paidPaisa(b) === 0), error: null };
  } catch (error) {
    console.error('[API] fetchRelatedUnpaidBookings error:', error.message);
    return { data: [], error };
  }
}

// Every sibling in a group booking, regardless of payment_status — unlike
// fetchRelatedUnpaidBookings above, this is purely for DISPLAY (so a sibling
// that's already been paid never silently disappears from another sibling's
// modal — see the BK-20260915-0025/-0026/-0027 incident, where paying 0025
// made it drop out of every other sibling's "related" view since that query
// filtered on payment_status='unpaid'). Never used to decide what to bundle
// into a payment — only fetchRelatedUnpaidBookings governs that.
// Falls back to the customer_name+date heuristic when bookingGroupId is
// absent — same dual-matching strategy as fetchRelatedUnpaidBookings, so
// the "don't hide a paid sibling" display fix covers non-group bookings
// too, not just formal group bookings (a real gap: two separate walk-in
// bookings for the same customer/day, never linked via booking_group_id,
// had no equivalent of this panel).
export async function fetchGroupBookings({ bookingGroupId, customerName, date, excludeBookingId }) {
  try {
    if (!bookingGroupId && !(customerName && date)) return { data: [], error: null };

    let query = supabase
      .from('bookings')
      .select('id, booking_number, payment_status, status, final_amount, service:services(name)')
      .not('status', 'in', '("Cancelled","No Show")')
      .neq('id', excludeBookingId);

    query = bookingGroupId
      ? query.eq('booking_group_id', bookingGroupId)
      : query.eq('customer_name', customerName).eq('date', date);

    const { data, error } = await query.order('booking_number');

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchGroupBookings error:', error.message);
    return { data: [], error };
  }
}

// ZNLY-402 piece 4 (org setting multi_service_bookings ON): EVERY row of one booking (bookings.visit_id), cancelled rows included, any payment state.
// Read-only, for the "This booking" block in the booking panel. No visit_id = its own booking: nothing to fetch (the block stays hidden).
// customerId is the same safety check as above: a visit never spans two customers.
export async function fetchBookingServices({ visitId, customerId }) {
  try {
    if (!visitId) return { data: [], error: null };
    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_id, date, start_time, end_time, base_amount, discount_amount, final_amount, payment_status, status, service_id, room_id, therapist_id, service_name_snapshot, service:services(name, duration_minutes, is_couple), room:rooms(name), therapist:therapists(name), booking_therapists(therapist_id, therapist:therapists(name)), payments(amount), payment_refunds(amount)')
      .eq('visit_id', visitId);
    if (customerId) query = query.eq('customer_id', customerId);
    const { data, error } = await query.order('start_time');
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchBookingServices error:', error.message);
    return { data: [], error };
  }
}

// ZNLY-402 (org setting multi_service_bookings ON; OFF orgs use fetchRelatedUnpaidBookings above): "related" = the OTHER bookings of the SAME VISIT (bookings.visit_id, migration-427; one person, one Save), unpaid only: this is
// "what to bundle into a payment". A booking with no visit_id is its own visit, so it has no related bookings: there is no fallback to
// booking_group_id (a party of several people) or to customer_name + date (the old guess that merged two separate visits). customerId
// (when known) stays as a safety check: a visit never spans two customers, so a stray row of another customer is never bundled into a
// membership/wallet payment scoped to one customer (see the BK-20261011-0033/-0034 incident). Same unpaid / non-cancelled filters as before.
export async function fetchVisitRelatedUnpaidBookings({ excludeBookingId, visitId, customerId }) {
  try {
    if (!visitId) return { data: [], error: null };
    let query = supabase
      .from('bookings')
      .select('id, booking_number, customer_id, customer_name, date, start_time, end_time, base_amount, discount_amount, final_amount, payment_status, status, service:services(name, duration_minutes), room:rooms(name), therapist:therapists(name), payments(amount), payment_refunds(amount)')
      .not('status', 'in', '("Cancelled","No Show")')
      .neq('id', excludeBookingId)
      .eq('visit_id', visitId);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    const { data, error } = await query.order('start_time');

    if (error) throw error;
    // "Unpaid" = nothing held on it (payments − refunds = 0), decided from the payments like every other money figure — the same rule the
    // calendar's Prev. due uses to drop these siblings, so the two can never disagree.
    return { data: (data || []).filter((b) => paidPaisa(b) === 0), error: null };
  } catch (error) {
    console.error('[API] fetchVisitRelatedUnpaidBookings error:', error.message);
    return { data: [], error };
  }
}

// Every other booking of the same visit, regardless of payment_status — unlike fetchVisitRelatedUnpaidBookings above, this is purely for
// DISPLAY (so a sibling that's already been paid never silently disappears from another sibling's modal — see the
// BK-20260915-0025/-0026/-0027 incident, where paying 0025 made it drop out of every other sibling's "related" view). Never used to decide
// what to bundle into a payment — only fetchVisitRelatedUnpaidBookings governs that. Same visit rule as above (ZNLY-402): no visit_id = no siblings.
export async function fetchVisitSiblings({ visitId, excludeBookingId, customerId }) {
  try {
    if (!visitId) return { data: [], error: null };

    let query = supabase
      .from('bookings')
      .select('id, booking_number, payment_status, status, final_amount, service:services(name)')
      .not('status', 'in', '("Cancelled","No Show")')
      .neq('id', excludeBookingId)
      .eq('visit_id', visitId);
    if (customerId) query = query.eq('customer_id', customerId);

    const { data, error } = await query.order('booking_number');

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchVisitSiblings error:', error.message);
    return { data: [], error };
  }
}

export async function updateTherapistTime({ bookingId, therapistId, startTime, endTime, overrideReason }) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    const { error } = await supabase
      .from('booking_therapists')
      .update({ start_time: startTime, end_time: endTime, ...(availabilityOverride ? { availability_override_reason: availabilityOverride } : {}) })
      .eq('booking_id', bookingId)
      .eq('therapist_id', therapistId);

    if (error) {
      const availabilityErr = availabilityFailure(error);
      if (availabilityErr) return availabilityErr;
      throw error;
    }
    if (availabilityOverride) await clearAvailabilityOverride(bookingId);
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] updateTherapistTime error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Resizes a shared booking's time for ALL assigned therapists at once, plus the
// parent bookings row — the calendar's default (non-Cmd) resize gesture. Keeps
// every booking_therapists row and the canonical bookings.start_time/end_time in
// agreement, unlike updateTherapistTime (which only ever touches one therapist's
// row and is reserved for the explicit Cmd/Ctrl-selected independent-resize case).
// Without this, resizing one therapist's card silently desyncs it from the rest
// of the booking with no warning — see calendar/index.jsx handleBookingResize.
export async function resizeSharedBookingTime({ bookingId, startTime, endTime, overrideReason }) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    // bookings is ground truth (same order/failure policy as rescheduleBooking):
    // update it first and fail loudly if it errors. booking_therapists is synced
    // second, best-effort — if that write fails, bookings is still correct and
    // every reader outside the calendar (receipts, reschedule dialogs) is fine;
    // only the calendar's per-column display would lag until the next successful
    // write. Updating booking_therapists FIRST would risk the opposite and worse
    // failure: every therapist's row moved but bookings left stale, recreating
    // the exact class of desync this function exists to prevent.
    const { error: bookingError } = await supabase
      .from('bookings')
      .update({ start_time: startTime, end_time: endTime, ...(availabilityOverride ? { availability_override_reason: availabilityOverride } : {}) })
      .eq('id', bookingId);
    if (bookingError) {
      const availabilityErr = availabilityFailure(bookingError);
      if (availabilityErr) return availabilityErr;
      // compute_booking_datetimes trigger (migration-179): the resized time
      // + service duration would extend past midnight.
      if (bookingError.message?.includes('BOOKING_CROSSES_MIDNIGHT')) {
        return { data: null, error: { code: 'BOOKING_CROSSES_MIDNIGHT', message: bookingError.message.split('BOOKING_CROSSES_MIDNIGHT:')[1]?.trim() || 'This resize would extend past midnight — please choose a shorter duration or earlier time.' } };
      }
      throw bookingError;
    }

    const { error: therapistsError } = await supabase
      .from('booking_therapists')
      .update({ start_time: startTime, end_time: endTime, ...(availabilityOverride ? { availability_override_reason: availabilityOverride } : {}) })
      .eq('booking_id', bookingId);
    if (therapistsError) {
      // bookings.end_time is always start + service duration (compute_booking_datetimes), so a longer/shorter card is
      // carried by these junction rows alone: the availability rule (off shift, break, leave...) is enforced HERE.
      // Report it instead of swallowing it, so the resize is refused (or offers "Book anyway") like every other path.
      const availabilityErr = availabilityFailure(therapistsError);
      if (availabilityErr) return availabilityErr;
      console.error('[API] resizeSharedBookingTime booking_therapists sync error:', therapistsError.message);
    }

    if (availabilityOverride) await clearAvailabilityOverride(bookingId);
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] resizeSharedBookingTime error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ZNLY-327: add a client to a walk-in booking that has none. Links bookings.customer_id and sets customer_name / customer_phone; is_walk_in
// and walk_in_label stay, so the booking is still counted as a walk-in. Same lifecycle guards as any edit (validateBookingMutation:
// a closed day, Cancelled and No Show refuse; a paid, in-progress or Completed booking still may get a client: it changes no money).
// Pass { customerId } to pick an existing customer, or { customerName, customerPhone, customerEmail?, customerGender? } for a new one.
export async function linkWalkInClient({ bookingId, customerId, customerName, customerPhone, customerEmail, customerGender }) {
  try {
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, branch_id, is_walk_in, customer_id')
      .eq('id', bookingId)
      .single();
    if (fetchError) {
      if (fetchError.code === 'PGRST116') return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      throw fetchError;
    }
    // Own guard, not validateBookingMutation: who the client is does not touch status or money, so Completed may still get one.
    if (booking.is_locked) return { data: null, error: { code: 'DAY_LOCKED', message: 'This day has been closed. No further modifications allowed.' } };
    if (booking.status === 'Cancelled' || booking.status === 'No Show') return { data: null, error: { code: 'BOOKING_IMMUTABLE', message: `${booking.status} bookings cannot be modified.` } };
    if (!booking.is_walk_in) return { data: null, error: { code: 'NOT_WALK_IN', message: 'Only a walk-in booking can get a client added this way.' } };
    if (booking.customer_id) return { data: null, error: { code: 'ALREADY_HAS_CLIENT', message: 'This booking already has a client.' } };
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    let linkId = customerId || null;
    let name = null;
    let phone = null;
    if (linkId) {
      const { data: c, error: cErr } = await supabase.from('customers').select('id, full_name, phone').eq('id', linkId).single();
      if (cErr || !c) return { data: null, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Could not find that customer.' } };
      name = c.full_name; phone = c.phone;
    } else {
      if (!String(customerName || '').trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Enter the client\'s name.' } };
      if (!String(customerPhone || '').trim() && !(await customerPhoneOptional(booking.branch_id))) return { data: null, error: { code: 'INVALID_INPUT', message: 'Enter the client\'s phone number.' } };
      const { data: branch, error: branchError } = await supabase.from('branches').select('org_id').eq('id', booking.branch_id).single();
      if (branchError) throw branchError;
      const { data: resolved, error: resolveError } = await findOrCreateCustomer({
        orgId: branch.org_id, branchId: booking.branch_id, fullName: customerName, phone: customerPhone, email: customerEmail, gender: customerGender,
      });
      if (resolveError) return { data: null, error: resolveError };
      linkId = resolved.customerId;
      name = toTitleCase(customerName);
      phone = toE164(customerPhone);
    }

    // The two filters make the link atomic: it only lands while the booking is still a client-less walk-in.
    const { data: updated, error: updErr } = await supabase
      .from('bookings')
      .update({ customer_id: linkId, customer_name: name, customer_phone: phone })
      .eq('id', bookingId)
      .eq('is_walk_in', true)
      .is('customer_id', null)
      .select('id')
      .maybeSingle();
    if (updErr) throw updErr;
    if (!updated) return { data: null, error: { code: 'ALREADY_HAS_CLIENT', message: 'This booking already has a client.' } };
    return { data: { bookingId, customerId: linkId, customerName: name, customerPhone: phone }, error: null };
  } catch (error) {
    console.error('[API] linkWalkInClient error:', error.message);
    return { data: null, error };
  }
}

export async function updateBookingDetails({ bookingId, customerName, customerPhone, walkInLabel, serviceId, date, startTime, specialRequests, referredBy, overrideReason }) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    customerName = toTitleCase(customerName);
    // 1. Fetch current booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, payment_status, service_id, date, start_time, branch_id, base_amount, discount_amount, final_amount, customer_name, customer_phone, customer_id, is_walk_in, service:services(duration_minutes)')
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

    // ZNLY-330: a client-less walk-in has no name or phone of its own, only the optional label ("Walk-in · Ram"); a phone belongs to a client.
    if (booking.is_walk_in && !booking.customer_id) {
      customerName = undefined;
      customerPhone = undefined;
      if (walkInLabel !== undefined) {
        const label = String(walkInLabel || '').trim() || null;
        updatePayload.walk_in_label = label;
        updatePayload.customer_name = walkInName(label);
      }
    }

    if (customerName !== undefined && customerName !== null) {
      updatePayload.customer_name = customerName;
    }
    if (customerPhone !== undefined) {
      updatePayload.customer_phone = toE164(customerPhone);

      // Only re-resolve when there's an actual number to resolve against — if
      // the phone is being cleared (null/blank, e.g. "wrong number, don't have
      // the real one"), there's nothing to look up or match. Re-linking on an
      // empty phone would create a fresh phone-less orphan customer on every
      // such edit (toE164(null) => null, which matches nothing and always
      // falls through to "create new"); leave customer_id untouched instead,
      // same as before this fix — only the display snapshot clears.
      //
      // Editing the phone here previously only touched this cosmetic snapshot,
      // never bookings.customer_id — so the booking could display a corrected
      // name/phone while staying silently linked to the WRONG customer record
      // underneath (caught twice in prod: two different real customers both
      // named "Thinley Yanchen", one holding a Premium Club Membership, the
      // other not — a phone edit here left customer_id pointed at the wrong
      // one both times). Re-resolve customer_id the same way booking creation
      // does, so the link can never drift from what's actually displayed.
      const normalizedPhone = toE164(customerPhone);
      if (normalizedPhone) {
        const { data: branch, error: branchError } = await supabase
          .from('branches')
          .select('org_id')
          .eq('id', booking.branch_id)
          .single();
        if (branchError) throw branchError;

        if (updatePayload.customer_name) {
          // Name was explicitly (re)typed alongside the phone — findOrCreateCustomer's
          // "refresh stale fields on match" behavior is exactly what's wanted here,
          // same as booking creation.
          const { data: resolved, error: resolveError } = await findOrCreateCustomer({
            orgId: branch.org_id,
            branchId: booking.branch_id,
            fullName: updatePayload.customer_name,
            phone: customerPhone,
          });
          if (resolveError) return { data: null, error: resolveError };
          updatePayload.customer_id = resolved.customerId;
        } else {
          // Phone changed but name didn't come with it — a plain lookup, NOT
          // findOrCreateCustomer, because that would overwrite whatever real
          // customer this phone belongs to with this booking's OLD (possibly
          // stale/wrong) name snapshot. Link to the matched customer as-is;
          // only fall back to creating a new one (safe to name from the
          // booking's snapshot, since nothing existing gets overwritten).
          const { data: existing, error: lookupError } = await supabase
            .from('customers')
            .select('id')
            .eq('org_id', branch.org_id)
            .eq('phone', normalizedPhone)
            .limit(1)
            .maybeSingle();
          if (lookupError) throw lookupError;

          if (existing) {
            updatePayload.customer_id = existing.id;
          } else {
            const { data: resolved, error: resolveError } = await findOrCreateCustomer({
              orgId: branch.org_id,
              branchId: booking.branch_id,
              fullName: booking.customer_name,
              phone: customerPhone,
            });
            if (resolveError) return { data: null, error: resolveError };
            updatePayload.customer_id = resolved.customerId;
          }
        }
      }
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
        .from('services_with_offer_pricing')
        .select('id, name, duration_minutes, price_npr, effective_price_npr')
        .eq('id', serviceId)
        .single();

      if (svcError || !newService) {
        return { data: null, error: { code: 'SERVICE_NOT_FOUND', message: 'Selected service not found.' } };
      }

      const newServicePrice = Number(newService.effective_price_npr ?? newService.price_npr);
      newServiceDurationMinutes = newService.duration_minutes;
      updatePayload.service_id = serviceId;
      updatePayload.service_name_snapshot = newService.name;
      updatePayload.base_amount = newServicePrice;
      // Preserve existing discount amount
      const discountAmt = Number(booking.discount_amount || 0);
      updatePayload.final_amount = Math.max(0, newServicePrice - discountAmt);

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
    if (availabilityOverride && (dateChanged || timeChanged)) updatePayload.availability_override_reason = availabilityOverride;

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
      const availabilityErr = availabilityFailure(updateError);
      if (availabilityErr) return availabilityErr;
      if (updateError.code === '23P01' || updateError.code === 'P0003') {
        return { data: null, error: { code: 'SCHEDULING_CONFLICT', message: 'The new date/time conflicts with an existing booking.' } };
      }
      // compute_booking_datetimes trigger (migration-179): the new start
      // time + service duration would extend past midnight.
      if (updateError.message?.includes('BOOKING_CROSSES_MIDNIGHT')) {
        return { data: null, error: { code: 'BOOKING_CROSSES_MIDNIGHT', message: updateError.message.split('BOOKING_CROSSES_MIDNIGHT:')[1]?.trim() || 'This time would extend past midnight — please choose an earlier start time.' } };
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

    if (updatePayload.availability_override_reason) await clearAvailabilityOverride(bookingId);
    return { data: { success: true, bookingId }, error: null };
  } catch (error) {
    console.error('[API] updateBookingDetails error:', error.message);
    return { data: null, error: plainError(error) };
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
      effectivePercent = baseAmount > 0 ? discountAmount / baseAmount : 0;
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
      member_discount: null, // V22: a manual discount replaces any member discount (migration-343)
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
      await writeBookingPayment(bookingId, [{ amount: 0, payment_mode: 'No Charge' }], crypto.randomUUID(),
        'Auto-settled — 100% discount leaves no balance due');
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
    return { data: null, error: plainError(error) };
  }
}

/**
 * Fetch bookings with pending discount requests (manager view).
 * Callers that ask at the same moment (the header feed, the sidebar and the dashboard all do on a branch switch) share one
 * request. A 'pending-approvals-changed' event (fired after any approve/reject/request) forgets the shared request, so the
 * refetch that follows it always reads fresh data.
 */
const pendingDiscountsInFlight = new Map(); // branchId -> promise
if (typeof window !== 'undefined') window.addEventListener('pending-approvals-changed', () => pendingDiscountsInFlight.clear());
export function fetchPendingDiscounts(branchId) {
  const key = String(branchId);
  const shared = pendingDiscountsInFlight.get(key);
  if (shared) return shared;
  const promise = fetchPendingDiscountsUncached(branchId).finally(() => {
    if (pendingDiscountsInFlight.get(key) === promise) pendingDiscountsInFlight.delete(key);
  });
  pendingDiscountsInFlight.set(key, promise);
  return promise;
}
async function fetchPendingDiscountsUncached(branchId) {
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
    const data = await fetchAllPages((opts) => {
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
        `, opts)
        .neq('discount_status', 'none')
        .order('created_at', { ascending: false })
        .order('id'); // tiebreaker — created_at is not unique
      return withBranch(query, branchId);
    });

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
    return { data: null, error: plainError(error) };
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
    return { data: null, error: plainError(error) };
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
export async function fetchNotifications(limit = 50) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, booking_id, branch_id, actor_id, category, read, created_at, booking:bookings(acknowledged_at, acknowledger:users!acknowledged_by(full_name))')
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
 * How many of the current user's notifications are unread (the bell footer's "N of M").
 */
export async function fetchUnreadNotificationCount() {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false);
    if (error) throw error;
    return { data: count || 0, error: null };
  } catch (error) {
    console.error('[API] fetchUnreadNotificationCount error:', error.message);
    return { data: null, error };
  }
}

/**
 * The current user's pop-up/sound prefs per category and their global switches (migration-365).
 * Missing rows mean "use the defaults" (src/lib/notificationRules.js).
 */
export async function fetchNotificationPrefs() {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const [prefs, settings] = await Promise.all([
      supabase.from('notification_prefs').select('category, popup, sound').eq('user_id', user.id),
      supabase.from('notification_settings').select('sound_enabled, sound_choice, quiet_outside_hours, heard_branch_ids').eq('user_id', user.id).maybeSingle(),
    ]);
    if (prefs.error) throw prefs.error;
    if (settings.error) throw settings.error;
    const byCategory = {};
    (prefs.data || []).forEach((r) => { byCategory[r.category] = { popup: r.popup, sound: r.sound }; });
    return { data: { prefs: byCategory, settings: settings.data || null }, error: null };
  } catch (error) {
    console.error('[API] fetchNotificationPrefs error:', error.message);
    return { data: null, error };
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(notificationId) {
  try {
    const { error } = isReadingViaSafeViews()
      ? await supabase.rpc('restricted_mark_notifications_read', { p_id: notificationId })  // ZNLY-235: base table is not readable for this login
      : await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
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

    const { error } = isReadingViaSafeViews()
      ? await supabase.rpc('restricted_mark_notifications_read', { p_id: null })
      : await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] markAllNotificationsRead error:', error.message);
    return { data: null, error };
  }
}

// ── Inbox (ZNLY-135 V35b). `filter` comes from buildInboxFilter (src/lib/notificationRules.js). ──────────────────────────
const applyInboxFilter = (q, f) => {
  let query = q.in('category', f.categories).gte('created_at', f.since);
  if (f.unreadOnly) query = query.eq('read', false);
  if (f.branchId) query = query.eq('branch_id', f.branchId);
  if (f.search) query = query.or(`title.ilike.%${f.search}%,body.ilike.%${f.search}%`);
  return query;
};

/** One page of the Inbox, newest first; pass the last row's created_at as filter.before for the next page. */
export async function fetchInbox(filter) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    let q = applyInboxFilter(
      supabase.from('notifications').select('id, type, title, body, booking_id, branch_id, actor_id, category, read, created_at, booking:bookings(status, date, start_time, booking_number, customer_name, acknowledged_at, acknowledged_by, acknowledger:users!acknowledged_by(full_name))').eq('user_id', user.id),
      filter,
    );
    if (filter.before) q = q.lt('created_at', filter.before);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(filter.limit);
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchInbox error:', error.message);
    return { data: null, error };
  }
}

/** Unread per category (rail counts) + how many unread discount requests wait for the approver. */
export async function fetchInboxCounts() {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.from('notifications').select('category, type').eq('user_id', user.id).eq('read', false).limit(5000);
    if (error) throw error;
    const byCategory = {};
    let approvalRequests = 0;
    (data || []).forEach((r) => {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (r.type === 'discount_request') approvalRequests += 1;
    });
    return { data: { byCategory, approvalRequests }, error: null };
  } catch (error) {
    console.error('[API] fetchInboxCounts error:', error.message);
    return { data: null, error };
  }
}

/** When the newest notification arrived (the "all caught up" line). */
export async function fetchLastNotificationAt() {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.from('notifications').select('created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return { data: data?.created_at || null, error: null };
  } catch (error) {
    console.error('[API] fetchLastNotificationAt error:', error.message);
    return { data: null, error };
  }
}

export async function markNotificationUnread(notificationId) {
  try {
    const { error } = await supabase.from('notifications').update({ read: false }).eq('id', notificationId);
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] markNotificationUnread error:', error.message);
    return { data: null, error };
  }
}

/** "Mark all read" for the current Inbox filter (every page of it, not only what is loaded). */
export async function markInboxFilterRead(filter) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { error } = await applyInboxFilter(supabase.from('notifications').update({ read: true }).eq('user_id', user.id), { ...filter, unreadOnly: true });
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] markInboxFilterRead error:', error.message);
    return { data: null, error };
  }
}

export async function saveNotificationPref(category, { popup, sound }) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { error } = await supabase.from('notification_prefs').upsert({ user_id: user.id, category, popup, sound }, { onConflict: 'user_id,category' });
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] saveNotificationPref error:', error.message);
    return { data: null, error };
  }
}

/** Global switches: { sound_enabled?, sound_choice?, quiet_outside_hours?, heard_branch_ids? }. */
export async function saveNotificationSettings(patch) {
  try {
    const { user, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { error } = await supabase.from('notification_settings').upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] saveNotificationSettings error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

/**
 * Reschedule a booking to a new date/time.
 * Optionally reassign to a different therapist or room (cross-column drag).
 * Validates lifecycle, checks room/therapist availability, and updates the booking.
 */
export async function rescheduleBooking({ bookingId, newDate, newStartTime, newTherapistId, newRoomId, overrideReason }) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    // 1. Fetch booking with service duration, room, therapist, and branch
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, is_locked, payment_status, room_id, therapist_id, branch_id, service_id, service:services(duration_minutes)')
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

    // 3a. Cannot reschedule a service that's already started — the client
    // disables this in the UI (BookingActionModal), but that's not a real
    // boundary; enforce it here too.
    if (booking.status === 'In-Progress') {
      return { data: null, error: { code: 'BOOKING_IN_PROGRESS', message: 'This service has already started — it can no longer be rescheduled.' } };
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
      ...(availabilityOverride ? { availability_override_reason: availabilityOverride } : {}),
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
          return { data: null, error: { code: 'THERAPIST_INACTIVE', message: `Cannot assign an inactive ${staffWord()}.` } };
        }
        // A therapist's live branch_id only reflects the CURRENT moment (flipped by
        // the apply/revert cron) — it's the wrong thing to check against the NEW
        // date/time being rescheduled to. Reconstruct their expected branch at
        // newDate/newStartTime from the full staff_transfers window history instead
        // (see therapistBranchWindow.js).
        if (therapist) {
          const { data: transferRows } = await supabase
            .from('staff_transfers')
            .select('from_branch_id, to_branch_id, is_permanent, effective_date, start_time, revert_at, transferred_at')
            .eq('therapist_id', newTherapistId);
          const atDate = toKathmanduDate(newDate, newStartTime);
          const effectiveBranch = computeTherapistBranchAt(transferRows || [], therapist.branch_id, atDate);
          if (effectiveBranch !== booking.branch_id && !(await staffAvailabilityEnforced(booking.branch_id))) {
            return { data: null, error: { code: 'INVALID_THERAPIST', message: `${therapist.name} is not available in this ${wordBranch()} at this time (transferred elsewhere for this date).` } };
          }

          const { data: attRow } = await supabase
            .from('therapist_attendance')
            .select('check_out_time')
            .eq('therapist_id', newTherapistId)
            .eq('date', newDate)
            .maybeSingle();
          if (isAfterCheckout(attRow?.check_out_time, newDate, newStartTime)) {
            return { data: null, error: { code: 'THERAPIST_CHECKED_OUT', message: `${therapist.name} already checked out for this date.` } };
          }
        }
        updatePayload.therapist_id = newTherapistId;
        updatePayload.therapist_name_snapshot = therapist?.name || null;
      }
    } else if (booking.therapist_id) {
      // Therapist isn't being reassigned, but the booking is still moving to a new
      // date/time — the CURRENTLY assigned therapist's visiting window still needs
      // re-validating against that new date/time (same reasoning as 6a above).
      const { data: currentTherapist } = await supabase
        .from('therapists')
        .select('name, branch_id')
        .eq('id', booking.therapist_id)
        .single();

      if (currentTherapist) {
        const { data: transferRows } = await supabase
          .from('staff_transfers')
          .select('from_branch_id, to_branch_id, is_permanent, effective_date, start_time, revert_at, transferred_at')
          .eq('therapist_id', booking.therapist_id);
        const atDate = toKathmanduDate(newDate, newStartTime);
        const effectiveBranch = computeTherapistBranchAt(transferRows || [], currentTherapist.branch_id, atDate);
        if (effectiveBranch !== booking.branch_id && !(await staffAvailabilityEnforced(booking.branch_id))) {
          return { data: null, error: { code: 'INVALID_THERAPIST', message: `${currentTherapist.name} is not available in this ${wordBranch()} at this time (transferred elsewhere for this date). Reassign or choose a different date.` } };
        }

        const { data: attRow } = await supabase
          .from('therapist_attendance')
          .select('check_out_time')
          .eq('therapist_id', booking.therapist_id)
          .eq('date', newDate)
          .maybeSingle();
        if (isAfterCheckout(attRow?.check_out_time, newDate, newStartTime)) {
          return { data: null, error: { code: 'THERAPIST_CHECKED_OUT', message: `${currentTherapist.name} already checked out for this date. Reassign or choose a different time.` } };
        }
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

    // 7b. Tiered pricing: a reschedule can also change WHO is assigned, via
    // newTherapistId. The charge follows whoever delivers (migration-319), so
    // recompute here too — assignTherapist is not the only path that reassigns,
    // and without this a tiered booking moved onto a cheaper or dearer
    // therapist would keep the old price. Same shared helper, so the two paths
    // cannot disagree. final_amount follows base_amount via the existing
    // compute_final_amount trigger.
    if (newTherapistId !== undefined && booking.service_id) {
      const resolvedTherapistId =
        newTherapistId === 'unassigned' || newTherapistId === null ? null : newTherapistId;
      const newBaseAmount = await tieredBaseAmountFor(booking.service_id, resolvedTherapistId);
      if (newBaseAmount !== null) {
        updatePayload.base_amount = newBaseAmount;
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
      const availabilityErr = availabilityFailure(updateError);
      if (availabilityErr) return availabilityErr;
      // GIST exclusion: therapist double-booking
      if (updateError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: `${cap(staffWord())} is already booked during this time slot.` } };
      }
      // Room-capacity trigger: lost a race against a concurrent booking for the same room
      if (updateError.code === 'P0003') {
        return { data: null, error: { code: 'ROOM_CONFLICT', message: 'Room is fully booked at this time. Change the room or pick a different time.' } };
      }
      // compute_booking_datetimes trigger (migration-179): the new start time
      // + service duration would extend past midnight.
      if (updateError.message?.includes('BOOKING_CROSSES_MIDNIGHT')) {
        return { data: null, error: { code: 'BOOKING_CROSSES_MIDNIGHT', message: updateError.message.split('BOOKING_CROSSES_MIDNIGHT:')[1]?.trim() || 'This time would extend past midnight — please choose an earlier start time.' } };
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
    if (availabilityOverride) await clearAvailabilityOverride(bookingId);

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
    return { data: null, error: plainError(error) };
  }
}

// ============================================================
// Daily Closing & Reconciliation (Phase 5)
// ============================================================

export async function getDailySummary(branchId, date) {
  try {
    // Every figure this report returns is money — there's no partial redaction
    // to do here the way getCalendarBookings keeps non-money fields. A
    // price-restricted account gets a clean denial instead of an empty shell.
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);
    if (!vis.canViewPrices) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'This account cannot view pricing reports.' } };
    }

    const overall = isOverallBranch(branchId);

    // 1. Fetch all bookings for the branch + date
    let bookingsQuery = supabase
      .from('bookings')
      .select('id, status, payment_status, base_amount, discount_amount, final_amount, cancellation_reason')
      .eq('date', date);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    const { data: bookings, error: bookingsError } = await bookingsQuery;

    if (bookingsError) throw bookingsError;

    const all = bookings || [];
    const totalBookings = all.length;
    const completedBookings = all.filter(b => b.status === 'Completed').length;
    // Exclusive status rows that add up to the total: Completed + Cancelled + No Show + Not finished (a no-show is not also "cancelled").
    const noShowBookings = all.filter(isNoShow).length;
    const cancelledBookings = all.filter(b => b.status === 'Cancelled' && !isNoShow(b)).length;
    const notFinishedBookings = totalBookings - completedBookings - cancelledBookings - noShowBookings;

    // 2. Gross/discount from fully-paid (settled) bookings
    const paid = all.filter(b => b.payment_status === 'paid');
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
    const byMode = {}; // real method name -> money in (the one rule, src/lib/dayMoney.js)

    // Every payment on today's bookings counts as money in, whatever the booking's status is NOW: a fully refunded booking drops back to
    // 'unpaid', but its payment was still taken today and its refund is subtracted below (ZNLY-232 — skipping it subtracted the refund twice).
    const dayBookingIds = all.map(b => b.id);
    if (dayBookingIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('amount, payment_mode')
        .in('booking_id', dayBookingIds);

      if (paymentsError) throw paymentsError;

      for (const p of (payments || [])) {
        // SessionPackage rows (migration-141) carry a real payments.amount so
        // update_booking_payment_status() can settle the booking (see
        // recordPayment), but that value was already recognized as revenue
        // when the package itself was purchased — it isn't cash collected
        // today, so it's excluded here. Wallet modes (Membership/Referral/Voucher
        // balances, WALLET_MODES) have this identical "already-recognized-elsewhere"
        // property and are excluded the same way.
        if (canonicalMode(p.payment_mode) === 'SessionPackage' || WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
        const amount = Number(p.amount);
        netRevenue += amount;
        paymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
        addTender(byMode, p.payment_mode, amount);
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
        // Membership-tendered voucher sales are a wallet deduction, not new
        // cash collected today — same "already-recognized-elsewhere" policy
        // as the booking-payments loop above (WALLET_MODES).
        if (WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
        const amount = Number(p.amount);
        voucherSalesTotal += amount;
        netRevenue += amount;
        paymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
        addTender(byMode, p.payment_mode, amount);
      }
    }

    // 4c. Membership top-ups + package sales collected today — same
    // recognized-once-at-sale-time policy as vouchers above.
    const { membershipSoldTotal, packageSoldTotal, modeBreakdown, byMode: walletSaleModes } = await getWalletProductSalesForDate(branchId, date);
    netRevenue += membershipSoldTotal + packageSoldTotal;
    paymentBreakdown.cash += modeBreakdown.cash;
    paymentBreakdown.card += modeBreakdown.card;
    paymentBreakdown.fonepay += modeBreakdown.fonepay;
    for (const [m, v] of Object.entries(walletSaleModes)) addTender(byMode, m, v);

    // 4c-2. Products sold today (V26) — money in the drawer exactly like voucher sales, so it folds into the same buckets; also
    // reported as its own `productSales` line so the treatment figures stay comparable (treatment = net minus this).
    const productSales = await getProductSalesForDate(branchId, date);
    netRevenue += productSales.total;
    paymentBreakdown.cash += productSales.breakdown.cash;
    paymentBreakdown.card += productSales.breakdown.card;
    paymentBreakdown.fonepay += productSales.breakdown.fonepay;
    for (const [m, v] of Object.entries(productSales.byMode)) addTender(byMode, m, v);

    // 4c-3. Refunds handed back today come OFF the takings and the cash in the drawer (ZNLY-232) — same rule as the dashboard Close card.
    // The money figures come from ONE source (the cash day: what was taken today whatever the booking's date, minus refunds made today).
    const dayMoney = await getDayMoneyForDate(branchId, date);
    const refunds = dayMoney.refunds;
    for (const k of Object.keys(byMode)) delete byMode[k];
    Object.assign(byMode, dayMoney.byMode);
    paymentBreakdown = { cash: 0, card: 0, fonepay: 0 };
    const cardNames = await getOrgCardNames();
    for (const [m, v] of Object.entries(byMode)) paymentBreakdown[bucketForMode(m, cardNames)] += Number(v);
    // Only refunds paid out in cash leave the cash bucket; the rest went back to card / online (ZNLY-258). The buckets still add up to taken.
    applyRefundsToBuckets(paymentBreakdown, refunds, dayMoney.cashRefunds);
    netRevenue = dayMoney.taken;

    // 4d. Tips collected today — NOT revenue (migration-240). Reported separately,
    // deliberately NEVER folded into netRevenue/paymentBreakdown, same "visible but
    // excluded" treatment as SessionPackage/WALLET_MODES above for a different reason
    // (those are already-recognized revenue; a tip was never company revenue at all).
    let tipsTotal = 0;
    if (settledBookingIds.length > 0) {
      const { data: tips, error: tipsError } = await supabase
        .from('booking_tips')
        .select('amount')
        .in('booking_id', settledBookingIds);
      if (tipsError) throw tipsError;
      tipsTotal = (tips || []).reduce((s, t) => s + Number(t.amount), 0);
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

    // Gross = services (bookings taken payment on, at list price) + everything else sold today (products, vouchers, memberships, packages)
    // before discounts, so Gross >= Net always (Net = money in - refunds). ZNLY-232.
    // 'grossRevenue' (the daily_reports.gross_revenue column) is MONEY IN: net + refunds, so Money in - Refunds = Taken always adds up.
    const grossRevenue = netRevenue + refunds;

    return {
      data: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        grossRevenue,
        totalDiscounts,
        netRevenue,
        refunds,
        cashRefunds: dayMoney.cashRefunds,
        byMode,
        noShowBookings,
        notFinishedBookings,
        sources: dayMoney.sources,
        afterClose: dayMoney.afterClose,
        atClose: dayMoney.atClose,
        paymentBreakdown,
        voucherSalesTotal,
        productSales,
        tipsTotal,
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
// what's configured today). Digital is external non-card electronic payment. SessionPackage
// (migration-141) and wallet modes (WALLET_MODES, defined near classifyPaymentMode above) are
// both skipped entirely before bucketing — their value was already recognized as revenue
// when the package/membership/voucher was originally purchased, so per the
// cash-based-reconciliation policy neither is counted as money collected today in any
// bucket, including totalSales. See getDailySummary/getDailyOperationalReport for the same
// 'today' semantics (bookings.date, not payment created_at) and the same exclusion policy.
export async function getTodayInsights(branchId, from, to) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const rangeStart = from || nepalToday();
    const rangeEnd = to || rangeStart;

    // rangeEnd is a Nepal calendar date; the exclusive upper bound used by the
    // timestamp-based queries below is the next day's Nepal midnight (+05:45).
    const nextDayBoundary = new Date(`${rangeEnd}T00:00:00+05:45`);
    nextDayBoundary.setUTCDate(nextDayBoundary.getUTCDate() + 1);

    // This panel is ten independent branch+range aggregates plus two follow-up
    // lookups that need ids from the first round. It used to issue all twelve
    // one after another, so the dashboard paid twelve serial round trips before
    // it could render. They go out as two batches instead — everything that
    // only needs (branchId, rangeStart, rangeEnd), then the two that depend on
    // ids from the first batch. Each numbered section below still processes its
    // own result in the original order, and the error checks keep their
    // original precedence, so a caller sees the same first error as before.
    // Every leg below is now paginated — an Annually/Custom preset can push
    // any of them past the PostgREST 1000-row cap (confirmed 9,204 bookings/yr
    // at Nuad Thai Spa). pagedResult keeps each leg's { data, error } shape so
    // the ordered error-checking below (and Promise.all's position) is unaffected.
    const bookingsResult = pagedResult((opts) =>
      withBranch(
        supabase.from('bookings').select('id, payment_status', opts).gte('date', rangeStart).lte('date', rangeEnd),
        branchId
      ).order('id')
    );

    const vouchersInRangeResult = pagedResult((opts) =>
      withBranch(
        supabase.from('vouchers').select('id', opts).gte('issued_date', rangeStart).lte('issued_date', rangeEnd),
        branchId, 'branch_id'
      ).order('id')
    );

    const claimsResult = pagedResult((opts) =>
      withBranch(
        supabase.from('voucher_claims').select('amount_claimed', opts).eq('is_legacy', false).gte('redeemed_date', rangeStart).lte('redeemed_date', rangeEnd),
        branchId, 'branch_claimed_id'
      ).order('id')
    );

    const issuedResult = pagedResult((opts) =>
      withBranch(
        supabase.from('vouchers').select('total_amount_issued, issue_kind', opts).gte('issued_date', rangeStart).lte('issued_date', rangeEnd),
        branchId, 'branch_id'
      ).order('id')
    );

    const depositsResult = pagedResult((opts) =>
      withBranch(
        supabase.from('membership_transactions')
          .select('amount, created_at, payment_mode', opts)
          .eq('kind', 'deposit')
          .gte('created_at', `${rangeStart}T00:00:00+05:45`)
          .lt('created_at', nextDayBoundary.toISOString()),
        branchId
      ).order('id')
    );

    const deductionsResult = pagedResult((opts) =>
      withBranch(
        supabase.from('membership_transactions')
          .select('amount, created_at', opts)
          .eq('kind', 'deduction')
          .gte('created_at', `${rangeStart}T00:00:00+05:45`)
          .lt('created_at', nextDayBoundary.toISOString()),
        branchId
      ).order('id')
    );

    const packagesIssuedResult = pagedResult((opts) =>
      withBranch(
        supabase.from('packages').select('paid_amount, payment_method', opts).gte('issued_date', rangeStart).lte('issued_date', rangeEnd),
        branchId
      ).order('id')
    );

    const packageRedemptionsResult = pagedResult((opts) =>
      withBranch(
        supabase.from('package_redemptions').select('id', opts).gte('redeemed_date', rangeStart).lte('redeemed_date', rangeEnd),
        branchId
      ).order('id')
    );

    const productSalesResult = pagedResult((opts) =>
      withBranch(
        supabase.from('product_sales')
          .select('total_amount, refunded_at, product_sale_payments(payment_mode, amount)', opts)
          .gte('created_at', `${rangeStart}T00:00:00+05:45`)
          .lt('created_at', nextDayBoundary.toISOString()),
        branchId
      ).order('id')
    );

    const [
      { data: bookings, error: bookingsError },
      { data: vouchersInRange, error: vouchersInRangeError },
      { data: claims, error: claimsError },
      { data: issued, error: issuedError },
      { data: deposits, error: depositsError },
      { data: deductions, error: deductionsError },
      { data: packagesIssued, error: packagesIssuedError },
      { data: packagesRedeemed, error: packagesRedeemedError },
      { data: productSalesRows, error: productSalesError },
      { data: utilization, error: utilizationError },
    ] = await Promise.all([
      bookingsResult,
      vouchersInRangeResult,
      claimsResult,
      issuedResult,
      depositsResult,
      deductionsResult,
      packagesIssuedResult,
      packageRedemptionsResult,
      productSalesResult,
      getUtilizationIntelligence({ branchId, from: rangeStart, to: rangeEnd }),
    ]);

    if (bookingsError) throw bookingsError;

    const settledBookingIds = (bookings || [])
      .filter(b => ['paid', 'partial'].includes(b.payment_status))
      .map(b => b.id);

    // 2. Total today's payments per actual payment_mode — kept flat (not bucketed
    // into any fixed Cash/Card/Digital classification) so the Dashboard can group
    // rows by the org's own configured payment-method tree (Setup > Payment
    // Methods) instead of a hardcoded guess at what counts as "digital".
    let totalSales = 0;
    let membershipRedeemed = { count: 0, value: 0 };
    const modeTotals = {}; // { 'Cash': 17600, 'Nabil Card': 16200, 'MobileBanking': 31860, ... }

    if (vouchersInRangeError) throw vouchersInRangeError;
    const voucherIdsInRange = (vouchersInRange || []).map(v => v.id);

    // Second and final batch: the two lookups that need ids from the first.
    // Each is skipped exactly as before when its id list is empty.
    const [
      { data: payments, error: paymentsError },
      { data: voucherPayments, error: voucherPaymentsError },
    ] = await Promise.all([
      settledBookingIds.length > 0
        ? supabase
            .from('payments')
            .select('amount, payment_mode')
            .in('booking_id', settledBookingIds)
        : Promise.resolve({ data: null }),
      voucherIdsInRange.length > 0
        ? supabase
            .from('voucher_payments')
            .select('amount, payment_mode')
            .in('voucher_id', voucherIdsInRange)
        : Promise.resolve({ data: null }),
    ]);

    if (settledBookingIds.length > 0) {
      if (paymentsError) throw paymentsError;

      for (const p of (payments || [])) {
        // SessionPackage rows (migration-141) and wallet-mode rows (Membership/Referral/
        // Voucher balances) are never counted as money collected today — that value was
        // already recognized as revenue when the package/membership/voucher was originally
        // purchased or earned (same policy as getDailySummary/getDailyOperationalReport).
        // Skip entirely, don't fold into totalSales or any bucket — the "Redeemed" figures
        // shown elsewhere on the dashboard (membershipRedeemed etc.) are where this belongs.
        if (canonicalMode(p.payment_mode) === 'SessionPackage' || WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
        const amount = Number(p.amount);
        totalSales += amount;
        modeTotals[canonicalMode(p.payment_mode)] = (modeTotals[canonicalMode(p.payment_mode)] || 0) + amount;
      }
    }

    // 2b. Voucher sales collected in range — same cash-in-drawer money as
    // booking payments, so it folds into totalSales/cash/card/digital here
    // too. Previously only tracked via voucherDistributed's count/value below,
    // which never fed into the payment mix — a voucher sale was invisible in
    // Total Sales and the Cash/Card/Digital bars on this Dashboard panel, even
    // though getDailySummary/getDailyOperationalReport already fold the exact
    // same voucher_payments rows into their own totals. Mirrors that fold-in.
    if (voucherIdsInRange.length > 0) {
      if (voucherPaymentsError) throw voucherPaymentsError;

      for (const p of (voucherPayments || [])) {
        if (WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
        const amount = Number(p.amount);
        totalSales += amount;
        modeTotals[canonicalMode(p.payment_mode)] = (modeTotals[canonicalMode(p.payment_mode)] || 0) + amount;
      }
    }

    // 3. Gift vouchers claimed in range (redemption ledger). is_legacy claims (migration-344's review closing an old voucher
    // "used before the app tracked it") aren't a redemption in this range, so they're left out (see claimsResult above).
    if (claimsError) throw claimsError;
    const voucherClaimed = {
      count: (claims || []).length,
      value: (claims || []).reduce((sum, c) => sum + Number(c.amount_claimed), 0),
    };

    // 4. Gift vouchers distributed (issued) in range
    if (issuedError) throw issuedError;
    const voucherDistributed = {
      count: (issued || []).length,
      // total_amount_issued is the voucher's value since migration-344.
      value: (issued || []).reduce((sum, v) => sum + Number(v.total_amount_issued), 0),
      freeCount: (issued || []).filter((v) => v.issue_kind === 'free').length,
    };

    // 5. Memberships sold (deposits) in range, branch-scoped (migration-156).
    if (depositsError) throw depositsError;
    const membershipSold = {
      count: (deposits || []).length,
      value: (deposits || []).reduce((sum, d) => sum + Number(d.amount), 0),
    };
    // Real tendered cash (Cash/Card/MobileBanking), same as vouchers/products
    // below — folds into totalSales/modeTotals so the Dashboard's payment-mode
    // breakdown isn't missing membership top-up cash.
    for (const d of (deposits || [])) {
      const amount = Number(d.amount);
      totalSales += amount;
      // payment_mode is nullable (migration-060) — default to Cash so the
      // amount lands in a real bucket instead of a stray "null" key.
      const mode = d.payment_mode || 'Cash';
      modeTotals[mode] = (modeTotals[mode] || 0) + amount;
    }

    // 5b. Memberships redeemed (deductions) in range, branch-scoped — direct
    // ledger filter, consistent with Sold (migration-156).
    if (deductionsError) throw deductionsError;
    membershipRedeemed = {
      count: (deductions || []).length,
      value: (deductions || []).reduce((sum, d) => sum + Math.abs(Number(d.amount)), 0),
    };

    // 6. Packages sold (issued) in range, branch-scoped.
    if (packagesIssuedError) throw packagesIssuedError;
    const packageSold = {
      count: (packagesIssued || []).length,
      value: (packagesIssued || []).reduce((sum, p) => sum + Number(p.paid_amount), 0),
    };
    // Real tendered cash, same as memberships above — folds into totalSales/modeTotals.
    for (const p of (packagesIssued || [])) {
      const amount = Number(p.paid_amount);
      totalSales += amount;
      // payment_method is nullable (migration-185) with no "required when
      // paid" check — default to Cash so the amount lands in a real bucket.
      const mode = p.payment_method || 'Cash';
      modeTotals[mode] = (modeTotals[mode] || 0) + amount;
    }

    // 7. Packages redeemed (sessions used) in range, branch-scoped. No per-redemption
    // currency amount — sessions are counted, not priced individually.
    if (packagesRedeemedError) throw packagesRedeemedError;
    const packageRedeemed = { count: (packagesRedeemed || []).length };

    // 7b. Products sold in range, branch-scoped, excluding refunded sales —
    // real cash collected the same way bookings/vouchers are, so also folds
    // into totalSales/modeTotals. Timestamp-based (created_at) like
    // memberships (5/5b) rather than a plain date column, same Nepal-
    // midnight boundary logic.
    // Per-method rows come from product_sale_payments (migration-346); the membership wallet is a deduction, not money in, so it is in
    // `value` (what was sold) but not in totalSales / the method bars: same as daily close.
    if (productSalesError) throw productSalesError;
    const activeProductSales = (productSalesRows || []).filter(p => !p.refunded_at);
    const productsSold = {
      count: activeProductSales.length,
      value: activeProductSales.reduce((sum, p) => sum + Number(p.total_amount), 0),
    };
    for (const sale of activeProductSales) {
      for (const p of (sale.product_sale_payments || [])) {
        if (WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
        const amount = Number(p.amount);
        totalSales += amount;
        modeTotals[canonicalMode(p.payment_mode)] = (modeTotals[canonicalMode(p.payment_mode)] || 0) + amount;
      }
    }

    // 8. Staff utilization (reuse existing intelligence function)
    if (utilizationError) throw utilizationError;

    return {
      data: {
        totalSales,
        paymentModeTotals: modeTotals,
        membershipRedeemed,
        membershipSold,
        voucherClaimed,
        voucherDistributed,
        packageSold,
        packageRedeemed,
        productsSold,
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

// Bookings of [date] at a branch that are still Pending / Confirmed / In-Progress: they block Close Day (ZNLY-234, migration 392).
export async function getDayUnfinishedBookings(branchId, date) {
  try {
    const { data, error } = await supabase.rpc('day_unfinished_bookings', { p_branch_id: resolveBranchId(branchId), p_date: date });
    if (error) throw error;
    return { data: (data || []).map((r) => ({ bookingId: r.booking_id, bookingNumber: r.booking_number, customerName: r.customer_name, status: r.status, startTime: r.start_time })), error: null };
  } catch (error) {
    console.error('[API] getDayUnfinishedBookings error:', error.message);
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

    // 2b. Refused while any booking of the day is unfinished (the database refuses it too, so this cannot be skipped).
    const { data: unfinished } = await getDayUnfinishedBookings(resolvedBranchId, date);
    const block = closeDayBlock(unfinished);
    if (block.blocked) return { data: null, error: { code: 'DAY_HAS_UNFINISHED', message: block.message, bookings: block.rows } };

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
        product_revenue: summary.productSales?.total || 0,
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
    return { data: null, error: plainError(error) };
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

    // Same reasoning as getDailySummary: this is the day's takings end to end
    // (base/discount/final amounts, payment breakdown) — a price-restricted
    // account doesn't get a stripped-down version of it, it doesn't get it.
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);
    if (!vis.canViewPrices) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'This account cannot view pricing reports.' } };
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
        discount_approved_by, therapist_id, cancellation_reason,
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
    const voucherByMode = {};
    const byMode = {};   // real method name -> money in today (the one rule, src/lib/dayMoney.js)
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
        // Membership-tendered voucher sales are a wallet deduction, not new
        // cash collected today — same policy as the booking paymentRows loop below.
        if (WALLET_MODES.has(canonicalMode(p.payment_mode))) continue;
        const amount = Number(p.amount);
        voucherSalesTotal += amount;
        voucherPaymentBreakdown[classifyPaymentMode(p.payment_mode)] += amount;
        voucherByMode[canonicalMode(p.payment_mode)] = (voucherByMode[canonicalMode(p.payment_mode)] || 0) + amount;
      }
    }

    // Products sold that day (V26): live count + per-method detail; the money total of a CLOSED day comes from the snapshot
    // (daily_reports.product_revenue, already inside its net revenue and method totals), an open day's from the live sum.
    const liveProductSales = await getProductSalesForDate(branchId, date);
    // ZNLY-232: the day's money (by real method, refunds, taken) from ONE source shared with the dashboard Close card, live also on a closed day.
    const dayMoney = await getDayMoneyForDate(branchId, date);
    const refunds = dayMoney.refunds;
    const productSales = {
      count: liveProductSales.count,
      total: isClosed ? Number(closedReport.product_revenue || 0) : liveProductSales.total,
      byMode: liveProductSales.byMode,
    };

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

    Object.assign(byMode, dayMoney.byMode);

    // Step 3 — Compute totals
    // If closed, use stored snapshot for financial totals
    // If open, compute live from payments
    let totals;

    if (isClosed) {
      totals = {
        totalBookings: all.length,   // status rows are counted live (a closed day's bookings are locked), so they always add up
        completedBookings: all.filter(b => b.status === 'Completed').length,
        cancelledBookings: all.filter(b => b.status === 'Cancelled' && !isNoShow(b)).length,
        noShowBookings: all.filter(isNoShow).length,
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
        cancelledBookings: all.filter(b => b.status === 'Cancelled' && !isNoShow(b)).length,
        noShowBookings: all.filter(isNoShow).length,
        // Gross = services at list price + everything else sold today before discounts, so Gross >= Net (ZNLY-232).
        grossRevenue: dayMoney.taken + refunds,   // MONEY IN (see getDailySummary)
        totalDiscount: paidBookings.reduce((sum, b) => sum + Number(b.discount_amount), 0),
        // REVENUE LAW: net = everything TAKEN today (any booking date; real tenders only, no wallet / voucher-balance / package redemptions)
        // minus refunds made today — get_day_money, the same figure as the dashboard Close card.
        netRevenue: dayMoney.taken,
      };
    }

    totals.notFinishedBookings = totals.totalBookings - totals.completedBookings - totals.cancelledBookings - totals.noShowBookings;

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
      const cardNames = await getOrgCardNames();
      for (const [m, v] of Object.entries(byMode)) paymentBreakdown[bucketForMode(m, cardNames)] += Number(v);
      // Only refunds paid out in cash leave the cash bucket; the rest went back to card / online (ZNLY-258). The buckets still add up to taken.
    applyRefundsToBuckets(paymentBreakdown, refunds, dayMoney.cashRefunds);
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

    // Tips collected today — NOT revenue (migration-240). Computed live regardless of
    // isClosed; v1 deliberately does NOT add a tips column to daily_reports, so a
    // closed day's tip total is always a live query, never a frozen snapshot value
    // the way gross/net revenue are.
    let tipsTotal = 0;
    if (bookingIds.length > 0) {
      const { data: tips, error: tipsError } = await supabase
        .from('booking_tips')
        .select('amount')
        .in('booking_id', bookingIds);
      if (tipsError) throw tipsError;
      tipsTotal = (tips || []).reduce((s, t) => s + Number(t.amount), 0);
    }

    return {
      data: {
        bookings: bookingsList,
        totals,
        paymentBreakdown,
        voucherSalesTotal,
        productSales,
        sources: dayMoney.sources,
        afterClose: dayMoney.afterClose,
        atClose: dayMoney.atClose,
        refunds,
        cashRefunds: dayMoney.cashRefunds,
        byMode,
        tipsTotal,
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
  const dm = dayMoneyView(reportData);
  if (dm.closed) {
    // closed day: at close / after close / now (ZNLY-234), never mixed
    rows.push(`Money In (at close),${dm.at.moneyIn.toFixed(2)}`);
    rows.push(`Refunds (at close),${dm.at.refunds.toFixed(2)}`);
    rows.push(`Taken at close,${dm.at.taken.toFixed(2)}`);
    for (const r of dm.at.byMethod) rows.push(`"${r.label} (at close)",${r.amount.toFixed(2)}`);
    rows.push(`Cash expected at close,${dm.at.cashExpected.toFixed(2)}`);
    rows.push(`Collected after close (not in the closed report),${dm.after.amount.toFixed(2)}`);
    rows.push(`of which cash collected after close,${dm.after.cash.toFixed(2)}`);
    rows.push(`Taken now,${dm.now.taken.toFixed(2)}`);
    rows.push(`Cash in the drawer now,${dm.now.cashExpected.toFixed(2)}`);
  } else {
    rows.push(`Money In,${dm.live.moneyIn.toFixed(2)}`);
    rows.push(`Refunds,${dm.live.refunds.toFixed(2)}`);
    rows.push(`Taken Today,${dm.live.taken.toFixed(2)}`);
    for (const r of dm.live.byMethod) rows.push(`"${r.label}",${r.amount.toFixed(2)}`);
    rows.push(`Cash expected in the drawer,${dm.live.cashExpected.toFixed(2)}`);
  }
  rows.push(`Discounts given (today's bookings),${totals.totalDiscount.toFixed(2)}`);
  if (reportData.productSales) {
    rows.push(`Products sold (${reportData.productSales.count}),${Number(reportData.productSales.total).toFixed(2)}`);
  }

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

// 'YYYY-MM-DD' of the Monday of the week containing `date` (a date string, or an instant: then its Nepal date). Pure calendar arithmetic.
function getISOWeekMonday(date) {
  const ds = typeof date === 'string' ? date.slice(0, 10) : nepalDateOf(date);
  const [y, m, d] = ds.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun ... 6=Sat
  return addDays(ds, day === 0 ? -6 : 1 - day);
}

function getMonthStart(date) {
  const ds = typeof date === 'string' ? date.slice(0, 10) : nepalDateOf(date);
  return `${ds.slice(0, 8)}01`;
}

async function computeRevenueForRange(branchId, startDate, endDate) {
  const overall = isOverallBranch(branchId);

  // 1. Fetch closed-day snapshots in range — Overall computes purely live (no snapshots)
  let reports = [];
  if (!overall) {
    const { data, error: reportsError } = await supabase
      .from('daily_reports')
      .select('report_date, gross_revenue, total_discounts, net_revenue, product_revenue')
      .eq('branch_id', resolveBranchId(branchId))
      .gte('report_date', startDate)
      .lte('report_date', endDate);

    if (reportsError) throw reportsError;
    reports = data || [];
  }

  const closedDates = new Set((reports || []).map(r => r.report_date));

  let closedGross = 0, closedDiscount = 0, closedNet = 0, closedProducts = 0;
  for (const r of (reports || [])) {
    closedGross += Number(r.gross_revenue);
    closedDiscount += Number(r.total_discounts);
    closedNet += Number(r.net_revenue);
    closedProducts += Number(r.product_revenue || 0);
  }

  // 2. Count of paid bookings in range (display only — revenue math for open
  // dates is payment-mode-aware and computed per date below, not from this).
  let bookingsQuery = supabase
    .from('bookings')
    .select('date')
    .eq('payment_status', 'paid')
    .gte('date', startDate)
    .lte('date', endDate);
  bookingsQuery = withBranch(bookingsQuery, branchId);
  const { data: bookings, error: bookingsError } = await bookingsQuery;

  if (bookingsError) throw bookingsError;

  const paidBookings = (bookings || []).length;

  // 3. Live revenue for open (not-yet-closed) dates in range — delegates to
  // getDailySummary per date, the exact function closeDay() persists into
  // daily_reports, so live and closed totals can never disagree. This also
  // means the redemption-exclusion / sold-on-purchase-day policy (WALLET_MODES,
  // membership/voucher/package sales — see getDailySummary) lives in one place
  // instead of being reimplemented here against raw booking amounts.
  const openDates = [];
  // Bare date-only strings parse as UTC midnight (unlike a 'T00:00:00' suffix,
  // which parses as browser-local time) — staff run this from Nepal (+05:45),
  // so a local-time parse here would silently shift every date back by one day.
  for (let d = new Date(startDate); d <= new Date(endDate); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().split('T')[0];
    if (!closedDates.has(iso)) openDates.push(iso);
  }

  let liveGross = 0, liveDiscount = 0, liveNet = 0, liveProducts = 0;
  if (openDates.length > 0) {
    const summaries = await Promise.all(openDates.map(d => getDailySummary(branchId, d)));
    for (const { data: summary, error: summaryError } of summaries) {
      if (summaryError) throw summaryError;
      if (!summary) continue;
      liveGross += summary.grossRevenue;
      liveDiscount += summary.totalDiscounts;
      liveNet += summary.netRevenue;
      liveProducts += summary.productSales?.total || 0;
    }
  }

  return {
    grossRevenue: closedGross + liveGross,
    totalDiscount: closedDiscount + liveDiscount,
    netRevenue: closedNet + liveNet,
    // Product money is already inside netRevenue; this is the separate "Products" line (treatment = net minus this).
    productRevenue: closedProducts + liveProducts,
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

    const targetDate = date || nepalToday();
    const yesterday = addDays(targetDate, -1);
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
    const targetDate = date || nepalToday();
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
    // Not branch-scoped: therapist_attendance is keyed by (therapist_id, date)
    // globally, and absentIds below is only matched against the branch-scoped
    // `therapists` list, so filtering here would just risk missing a status
    // marked before a same-day transfer.
    const attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status')
      .eq('date', targetDate)
      .in('status', ['Absent', ...LEAVE_LIKE_ATTENDANCE_STATUSES]);
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

    // 3. Fetch qualifying bookings: Confirmed, In-Progress, Completed only.
    // Range mode can span a full year (Annually preset) — confirmed 9,204
    // bookings/yr at Nuad Thai Spa, past the PostgREST 1000-row cap — paginate.
    const allBookings = await fetchAllPages((opts) => {
      let query = supabase
        .from('bookings')
        .select('id, room_id, therapist_id, start_time, end_time, service_duration_snapshot, status', opts)
        .in('status', ['Confirmed', 'In-Progress', 'Completed']);
      query = isRange
        ? query.gte('date', rangeStart).lte('date', rangeEnd)
        : query.eq('date', targetDate);
      return withBranch(query, branchId).order('id');
    });

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
          ? `Multiple ${wordBranches()}`
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

// Bounded customer lookup for the ⌘K palette: at most `limit` active customers of the branch's org whose name or phone contains the
// term. Read-only; same table, org scoping and RLS as fetchCustomersLightweight / the Customers panel. Empty term -> [].
export async function searchCustomers(branchId, query, limit = 5) {
  try {
    const filter = customerSearchFilter(query);
    if (!filter) return { data: [], error: null };
    if (!branchId || isOverallBranch(branchId)) return { data: [], error: null };

    const { data: branch, error: branchErr } = await supabase
      .from('branches')
      .select('org_id')
      .eq('id', resolveBranchId(branchId))
      .single();
    if (branchErr) throw branchErr;

    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, phone')
      .eq('org_id', branch.org_id)
      .eq('is_active', true)
      .or(filter)
      .order('full_name')
      .limit(Math.max(1, Math.min(limit, 20)));
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] searchCustomers error:', error.message);
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
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);

    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        service:services(id, name, duration_minutes, price_npr),
        therapist:therapists(id, name, gender),
        room:rooms(id, name),
        payments(id, amount, payment_mode, created_at),
        payment_refunds(id, amount, reason, created_at),
        booking_tips(id, amount, created_at, receiver:users!received_by(full_name)),
        booking_therapists(therapist_id, start_time, end_time, room_id, therapist:therapists(id, name, gender), room:rooms(id, name))
      `)
      .eq('id', bookingId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
      throw error;
    }

    // This select is shared with every role, so columns can't just be left
    // out of it the way getCalendarBookings does — redact what was already
    // fetched instead. "Own bookings only" additionally means a booking that
    // isn't theirs doesn't exist as far as this caller is concerned.
    if (vis.ownBookingsOnly) {
      const isMine = vis.therapistId != null && (
        data.therapist_id === vis.therapistId ||
        (data.booking_therapists || []).some((bt) => bt.therapist_id === vis.therapistId)
      );
      if (!isMine) {
        return { data: null, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } };
      }
    }

    const [redacted] = redactRows([data], vis);
    if (!vis.canViewPrices) {
      redacted.payments = (redacted.payments || []).map(({ amount, ...rest }) => rest);
      redacted.booking_tips = (redacted.booking_tips || []).map(({ amount, ...rest }) => rest);
      redacted.payment_refunds = (redacted.payment_refunds || []).map(({ amount, ...rest }) => rest);
      if (redacted.service) {
        const { price_npr, ...serviceRest } = redacted.service;
        redacted.service = serviceRest;
      }
    }

    return { data: redacted, error: null };
  } catch (error) {
    console.error('[API] fetchBookingById error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Phase 8.1: Calendar Read-Only Query
// ============================================================

// ============================================================
// Staff (therapist) transfers (supabase/migration-038/041)
// ============================================================

// True when an error means "the transfer tables / RPCs don't exist on this database" (e.g. the
// cloud DB before promotion). Callers fail open: no transfer data, nothing breaks.
export function isTransferFeatureMissing(error) {
  return ['PGRST205', 'PGRST202', '42P01', '42883'].includes(error?.code);
}

// 'YYYY-MM-DD' +/- N days, calendar math only (no timezone drift).
function shiftDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
}

const kathmanduInstant = (date, time) => (date && time ? `${date}T${String(time).slice(0, 8)}+05:45` : null);

// Per-day "unavailable" occurrences for transfer windows touching this branch in [startDate, endDate],
// shaped like block occurrences so findBlockOverlap treats them the same (see utils/transferOccurrences.js).
// Fail open: any error (including missing tables) -> { data: [], error }.
export async function fetchTransferOccurrences(branchId, startDate, endDate) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);
    const { data, error } = await supabase
      .from('staff_transfers')
      .select('therapist_id, from_branch_id, to_branch_id, effective_date, start_time, revert_at, reverted, reverted_at, fromBranch:branches!staff_transfers_from_branch_id_fkey(name), toBranch:branches!staff_transfers_to_branch_id_fkey(name)')
      .or(`from_branch_id.eq.${resolvedBranchId},to_branch_id.eq.${resolvedBranchId}`)
      .eq('applied', true).eq('is_permanent', false).eq('is_return_leg', false)
      .not('revert_at', 'is', null)
      .lte('effective_date', endDate);
    if (error) throw error;

    const rows = (data || []).map(t => {
      const out = t.from_branch_id === resolvedBranchId;
      return {
        therapistId: t.therapist_id,
        kind: out ? 'out' : 'in',
        startDate: t.effective_date,
        startTime: t.start_time,
        endAt: t.reverted && t.reverted_at ? t.reverted_at : t.revert_at,
        otherBranch: out ? t.toBranch?.name : t.fromBranch?.name,
      };
    });

    const occurrences = [];
    for (let d = startDate; d <= endDate; d = shiftDateStr(d, 1)) {
      occurrences.push(...transferOccurrencesForDate(rows, d));
    }
    return { data: occurrences, error: null };
  } catch (error) {
    if (!isTransferFeatureMissing(error)) console.warn('[API] fetchTransferOccurrences:', error.message);
    return { data: [], error };
  }
}

// Applies transfer data to a branch's calendar therapists for [startDate, endDate]:
//  - tags therapists currently visiting this branch (transferredIn + window),
//  - tags therapists with a scheduled (not yet applied) transfer out (scheduledTransfer),
//  - tags home therapists lent out in the range (transferredOut + window; they never leave the list),
//  - adds a "visiting" column for every visitor whose window touches the range.
// Fails open: on any error (including missing tables) returns the therapists unchanged.
// The three staff_transfers reads behind the calendar's transfer layer. Started separately so getCalendarBookings can run them
// in the same round as therapists / rooms / bookings (they do not depend on the therapist list; only the merge below does).
function fetchCalendarTransferRows(branchId, startDate, endDate) {
  const cols = 'id, therapist_id, revert_at, effective_date, start_time, from_display_order, reverted, reverted_at';
  const therapistCols = 'therapist:therapists!staff_transfers_therapist_id_fkey(id, name, gender, specialties, position, is_service_staff, display_order, branch_id)';
  // Temporary, applied, non-return-leg windows; still-active ones plus ones that ended within the range.
  const windowFilter = `reverted.eq.false,and(effective_date.gte.${startDate},effective_date.lte.${endDate})`;
  return Promise.all([
    supabase.from('staff_transfers')
      .select(`${cols}, toBranch:branches!staff_transfers_to_branch_id_fkey(name), fromBranch:branches!staff_transfers_from_branch_id_fkey(name), ${therapistCols}`)
      .eq('from_branch_id', branchId).eq('applied', true).eq('is_permanent', false).eq('is_return_leg', false)
      .not('revert_at', 'is', null).or(windowFilter)
      .order('effective_date').order('start_time'),
    supabase.from('staff_transfers')
      .select(`${cols}, toBranch:branches!staff_transfers_to_branch_id_fkey(name), fromBranch:branches!staff_transfers_from_branch_id_fkey(name), ${therapistCols}`)
      .eq('to_branch_id', branchId).eq('applied', true).eq('is_permanent', false).eq('is_return_leg', false)
      .not('revert_at', 'is', null).or(windowFilter)
      .order('effective_date').order('start_time'),
    supabase.from('staff_transfers')
      .select('id, therapist_id, effective_date, start_time, revert_at, is_permanent, toBranch:branches!staff_transfers_to_branch_id_fkey(name), fromBranch:branches!staff_transfers_from_branch_id_fkey(name)')
      .eq('from_branch_id', branchId).eq('applied', false)
      .gte('effective_date', startDate).lte('effective_date', endDate)
      .order('effective_date').order('start_time'),
  ]);
}

// `prefetchedRows`: the promise from fetchCalendarTransferRows when the caller already started it.
async function applyCalendarTransfers(branchId, startDate, endDate, therapists, prefetchedRows = null) {
  try {
    const [outRes, inRes, schedRes] = await (prefetchedRows || fetchCalendarTransferRows(branchId, startDate, endDate));
    const err = outRes.error || inRes.error || schedRes.error;
    if (err) {
      if (!isTransferFeatureMissing(err)) console.warn('[API] applyCalendarTransfers:', err.message);
      return therapists;
    }

    const activeIds = new Set(therapists.map(d => d.id));
    // A transfer ended early ends at reverted_at, not the originally scheduled revert_at.
    const windowOf = (t) => ({
      returnsAt: t.reverted && t.reverted_at ? t.reverted_at : t.revert_at,
      transferStartAt: kathmanduInstant(t.effective_date, t.start_time),
      // raw facts for the transfer sentence (utils/transferText.js): the planned return and whether/when it ended early
      plannedRevertAt: t.revert_at, transferReverted: !!t.reverted, transferRevertedAt: t.reverted_at || null,
      transferFromBranch: t.fromBranch?.name || null, transferToBranch: t.toBranch?.name || null,
    });

    const scheduledByTherapist = {};
    (schedRes.data || []).forEach(r => {
      scheduledByTherapist[r.therapist_id] ??= { id: r.id, effectiveDate: r.effective_date, startTime: r.start_time, revertAt: r.revert_at, isPermanent: r.is_permanent, toBranch: r.toBranch?.name || null, fromBranch: r.fromBranch?.name || null };
    });

    const outRows = dedupeTransfersByKey(sortTransfersByTime(outRes.data || []), t => t.therapist?.id);
    const inRows = dedupeTransfersByKey(sortTransfersByTime(inRes.data || []), t => t.therapist_id);
    const inById = {};
    inRows.forEach(t => { inById[t.therapist_id] = { fromBranch: t.fromBranch?.name || null, ...windowOf(t) }; });
    // Every visit window of the range per person (two visits in a day): "not here" is the day minus their union (transferShade.js).
    const visitWindowsById = {};
    sortTransfersByTime(inRes.data || []).forEach(t => {
      (visitWindowsById[t.therapist_id] ||= []).push({ startAt: kathmanduInstant(t.effective_date, t.start_time), endAt: windowOf(t).returnsAt });
    });

    const outById = {};
    outRows.forEach(t => { if (t.therapist) outById[t.therapist.id] = t; });

    // ZNLY-113: branch_id is the HOME branch for the whole window, so a lent-out therapist is still one of `therapists`: tag the column
    // with the window instead of rebuilding a separate "away" column.
    const tagged = therapists.map(d => {
      const withIn = inById[d.id] ? { ...d, transferredIn: true, ...inById[d.id], visitWindows: visitWindowsById[d.id] } : d;
      const withOut = outById[d.id] ? { ...withIn, transferredOut: true, transferId: outById[d.id].id, ...windowOf(outById[d.id]) } : withIn;
      return scheduledByTherapist[d.id] ? { ...withOut, scheduledTransfer: scheduledByTherapist[d.id] } : withOut;
    });

    // Visitors: not in the home list, so each gets a column for the window (current, upcoming, or ended within the range).
    const visitedColumns = inRows
      .filter(t => t.therapist && !activeIds.has(t.therapist.id))
      .map(t => ({ ...t.therapist, transferredIn: true, fromBranch: t.fromBranch?.name || null, ...windowOf(t), visitWindows: visitWindowsById[t.therapist.id] }));

    return [...tagged, ...visitedColumns]
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));
  } catch (error) {
    console.warn('[API] applyCalendarTransfers failed open:', error.message);
    return therapists;
  }
}



// ── Date-picker booking counts ───────────────────────────────────────────────────────────────────────────────────────
// One number per day for the calendar's date picker. Read-only, `bookings.date` is the branch-local date (no UTC maths).
// Counts = Pending/Confirmed/In-Progress/Completed; Cancelled + No Show are reported separately; a shared (multi-therapist)
// booking is one row. Paged with .range() so PostgREST's 1,000-row cap can't undercount a busy branch.
const DAY_COUNT_PAGE = PG_PAGE_SIZE;
const DAY_COUNT_TTL_MS = 60000;
const dayCountCache = new Map(); // `${branch}|${start}|${end}` -> { at, promise }

export function invalidateBookingDayCounts() {
  dayCountCache.clear();
}

export function getBookingDayCounts(branchId, startDate, endDate) {
  const resolvedBranchId = resolveBranchId(branchId);
  const key = `${resolvedBranchId}|${startDate}|${endDate}`;
  const hit = dayCountCache.get(key);
  if (hit && Date.now() - hit.at < DAY_COUNT_TTL_MS) return hit.promise;

  const promise = (async () => {
    try {
      const counts = {};
      for (let from = 0; ; from += DAY_COUNT_PAGE) {
        const { data, error } = await supabase
          .from('bookings')
          .select('date, status')
          .eq('branch_id', resolvedBranchId)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + DAY_COUNT_PAGE - 1);
        if (error) throw error;
        for (const row of data || []) {
          const c = (counts[row.date] ||= { total: 0, pending: 0, cancelled: 0 });
          if (row.status === 'Cancelled' || row.status === 'No Show') c.cancelled += 1;
          else {
            c.total += 1;
            if (row.status === 'Pending') c.pending += 1;
          }
        }
        if (!data || data.length < DAY_COUNT_PAGE) break;
      }
      return counts;
    } catch (e) {
      console.warn('[API] getBookingDayCounts failed:', e.message);
      dayCountCache.delete(key); // don't cache a failure
      return null;
    }
  })();
  dayCountCache.set(key, { at: Date.now(), promise });
  return promise;
}


// ZNLY-299: open bookings in [fromDate, toDate] that have no staff yet (no therapist_id, no booking_therapists rows) and whose
// service needs staff. Feeds the calendar's Assign list (today + the next 7 days). Plain select under RLS; raw rows, same
// shape the calendar uses, so the list helpers take both.
export async function fetchUnassignedBookings({ branchId, fromDate, toDate }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);
    let query = supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, status, date, start_time, end_time, created_by, therapist_id, room_id, service_id, service:services(name, duration_minutes, requires_therapist, is_couple), booking_therapists(therapist_id)')
      .gte('date', fromDate)
      .lte('date', toDate)
      .is('therapist_id', null)
      .not('status', 'in', '("Cancelled","No Show","Completed")')
      .order('date')
      .order('start_time')
      .limit(300);
    query = withBranch(query, branchId);
    const { data, error } = await query;
    if (error) throw error;
    let rows = (data || []).filter((b) => !(b.booking_therapists || []).length && b.service?.requires_therapist !== false);
    if (!vis.canViewCustomerDetails) rows = rows.map((b) => ({ ...b, customer_name: maskCustomerName(b.customer_name), customer_phone: maskPhone(b.customer_phone) }));
    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchUnassignedBookings error:', error.message);
    return { data: null, error: { code: error.code || 'FETCH_FAILED', message: friendlyError(error, 'Could not load the unassigned bookings.') } };
  }
}

// `opts.reuseStatic`: a refresh after a booking change. Re-reads only the bookings (and their extras) and reuses the branch hours,
// therapists + transfer windows, rooms and check-outs from the last full load of this same branch / range / user / visibility.
// No saved copy (or it expired, or the user's visibility differs) = the normal full load, so passing it can never return less.
export async function getCalendarBookings(branchId, startDate, endDate, opts = {}) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);

    // "Own bookings only" is enforced by migration-322's RESTRICTIVE RLS
    // policy on `bookings` itself now — every SELECT below already comes back
    // pre-filtered to this therapist's own rows server-side. This used to
    // also fetch an all-time ownBookingIds list from booking_therapists and
    // .in('id', ownBookingIds) the main query, but that .in() grows with the
    // therapist's entire history and PostgREST rejects a bare .in() above
    // ~500-700 ids with an undetailed 400 (see the pagination note at
    // fetchAllPages, :1345) — a therapist with a year of bookings got a blank
    // calendar. RLS doesn't have that limit; removing the client-side filter
    // removes the bug along with the now-redundant code.
    //
    // The fail-closed early return stays: RLS also fails closed for an
    // unlinked restricted account, but this avoids a pointless round trip
    // and keeps the intent legible here.
    if (vis.ownBookingsOnly && !vis.therapistId) {
      return {
        data: { branchHours: { openTime: '09:00:00', closeTime: '21:00:00', timezone: NEPAL_TZ }, therapists: [], rooms: [], bookings: [], checkedOutByTherapistAndDate: {} },
        error: null,
      };
    }

    const staticKey = [resolvedBranchId, startDate, endDate, profile.id, vis.ownBookingsOnly, vis.canViewCustomerDetails, vis.canViewPrices, vis.therapistId].join('|');
    const reused = opts.reuseStatic ? getCalendarStatic(staticKey) : null;

    // ONE round trip for everything the grid needs. None of these reads depends on another: the bookings query needs only the branch id
    // and the visibility flags resolved above (so staff-own / restricted visibility applies exactly as before), the transfer reads need only
    // the branch and range (the merge with the therapist list happens in memory below). This used to be five hops in a row
    // (branch hours, then therapists/rooms, then transfers, then bookings), each a full network round trip on prod.
    const bookingsPromise = (async () => {
      // Money and customer-contact columns are left out of the select entirely
      // when withheld, rather than fetched and blanked after — once a column
      // never leaves the database, there's nothing for devtools to recover.
      const bookingFields = [
        'id', 'booking_number', 'customer_id', 'customer_name', 'is_walk_in', 'walk_in_label', // ZNLY-327
        'customer_phone',   // fetched always; masked below when withheld — see maskPhone
        'status', 'payment_status',
        'date', 'start_time', 'end_time', 'start_datetime', 'end_datetime', 'created_at', 'created_by',
        'therapist_id', 'room_id',
        // ZNLY-402: visit link (migration 427; bookings_safe carries it since migration 428). Only read when the org setting multi_service_bookings is ON.
        'visit_id',
        vis.canViewPrices && 'base_amount, discount_amount, final_amount',
        'special_requests', 'referred_by',
        'service:services(name, duration_minutes, requires_therapist)',
        'therapist:therapists(id, name)',
        'room:rooms(id, name)',
        'creator:users!created_by(full_name)',
        'booking_therapists(therapist_id, start_time, end_time, room_id, therapist:therapists(id, name), room:rooms(id, name))',
        'booking_combo_items(id, service_id, therapist_id, room_id, start_time, end_time, display_order, service:services(name, duration_minutes), therapist:therapists(id, name))',
        vis.canViewPrices && 'payments(amount, payment_mode)',
      ].filter(Boolean).join(', ');

      let bookingsQuery = supabase
        .from('bookings')
        .select(bookingFields)
        .eq('branch_id', resolvedBranchId)
        .gte('date', startDate)
        .lte('date', endDate)
        .not('status', 'in', '("Cancelled","No Show")')
        .order('start_time');
      // No client-side own-bookings filter needed — migration-322's
      // RESTRICTIVE RLS policy already scopes this SELECT to the caller's
      // own bookings when vis.ownBookingsOnly is true.

      return bookingsQuery;
    })();
    const transferRowsPromise = reused ? null : fetchCalendarTransferRows(resolvedBranchId, startDate, endDate);

    // Branch hours + timezone, therapists and rooms for this branch; transfer windows (staff away / visiting / scheduled)
    // are layered on by applyCalendarTransfers below.
    const [
      branchResult, therapistsResult, roomsResult, checkedOutResult, bookingsResult,
    ] = reused ? [null, null, null, null, await bookingsPromise] : await Promise.all([
      supabase
        .from('branches')
        .select('open_time, close_time, timezone')
        .eq('id', resolvedBranchId)
        .single(),
      supabase
        .from('therapists')
        .select('id, name, gender, specialties, position, is_service_staff, display_order')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true)
        .order('display_order')
        .order('name'),
      supabase
        .from('rooms')
        .select('id, name, is_active, display_order, amenities, floor, capacity')
        .eq('branch_id', resolvedBranchId)
        .eq('is_active', true)
        .order('display_order')
        .order('name'),
      // Therapists who've already checked out (for real, not just marked absent/leave) on
      // some date in this range — the calendar blocks the rest of that day's column for
      // them, same as a transfer-out window, so a booking can't be dropped onto someone
      // who's already gone home. Only Present/Half-day rows can have a check_out_time.
      supabase
        .from('therapist_attendance')
        .select('therapist_id, date, check_out_time')
        .eq('branch_id', resolvedBranchId)
        .gte('date', startDate)
        .lte('date', endDate)
        .not('check_out_time', 'is', null),
      bookingsPromise,
    ]);

    if (!reused) {
      if (branchResult.error) throw branchResult.error;
      if (therapistsResult.error) throw therapistsResult.error;
      if (roomsResult.error) throw roomsResult.error;
      if (checkedOutResult.error) throw checkedOutResult.error;
    }
    if (bookingsResult.error) throw bookingsResult.error;
    const branch = reused ? reused.branch : branchResult.data;

    // Keyed "<therapistId>_<date>" -> raw check_out_time (timestamptz), so the calendar
    // can block each affected day's column independently.
    let checkedOutByTherapistAndDate = {};
    let mergedTherapists;
    if (reused) {
      ({ checkedOutByTherapistAndDate, mergedTherapists } = reused);
    } else {
      (checkedOutResult.data || []).forEach(row => {
        checkedOutByTherapistAndDate[`${row.therapist_id}_${row.date}`] = row.check_out_time;
      });
      mergedTherapists = await applyCalendarTransfers(
        resolvedBranchId, startDate, endDate,
        (therapistsResult.data || [])
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name)),
        transferRowsPromise,
      );
      setCalendarStatic(staticKey, { branch, mergedTherapists, rooms: roomsResult.data || [], checkedOutByTherapistAndDate });
    }

    // Bookings in the date range, excluding Cancelled and No Show.
    let bookings = bookingsResult.data || [];

    // Name and phone are MASKED, not withheld: staff still need to tell two
    // bookings apart and confirm the person in front of them.
    //
    // Be clear about what this is. This file runs in the browser, so masking
    // here happens AFTER the row arrives — the real name and number are in the
    // network response and recoverable with devtools. That is different from
    // the money and email columns above, which are omitted from the select and
    // genuinely never sent. Masking is a display guarantee; column omission is
    // an access guarantee. Making names a real one needs a view or an RPC that
    // masks in Postgres — tracked alongside the column-privilege gap in
    // migration-320.
    if (!vis.canViewCustomerDetails) {
      bookings = (bookings || []).map((b) => ({
        ...b,
        customer_name: maskCustomerName(b.customer_name),
        customer_phone: maskPhone(b.customer_phone),
      }));
    }

    // Tell the UI the amount was WITHHELD, rather than leaving it to infer
    // that from an absent field. Without this a restricted booking renders the
    // same "—" as a booking that genuinely has no amount recorded, which reads
    // as missing data instead of a deliberate restriction.
    if (!vis.canViewPrices) {
      bookings = (bookings || []).map((b) => ({ ...b, pricesWithheld: true }));
    }

    // "New" tag: same "does this customer have any earlier non-Cancelled booking?" definition
    // as getCustomerFirstBookingFlag, batched for every customer appearing in this range
    // instead of one query per booking. No customer_id (walk-in/guest) → always New.
    const bookingCustomerIds = [...new Set((bookings || []).map(b => b.customer_id).filter(Boolean))];
    const firstBookingIdByCustomer = {};

    // Hover-card extras — read-only, batched (no N+1) and FAIL-OPEN: any error leaves the field undefined and the
    // calendar still loads. Started now so they run concurrently with the New-tag query below.
    //  * customer notes: customers.notes for every customer in range (one query)
    //  * previous due: the payment modal's "Previous due" figure, for every visible booking (two queries total)
    const customerNotesPromise = failOpenAfter((async () => {
      if (bookingCustomerIds.length === 0) return {};
      try {
        const rows = await inChunks(bookingCustomerIds, (ids) => supabase.from('customers').select('id, notes').in('id', ids));
        const out = {};
        for (const c of rows) { const t = (c.notes || '').trim(); if (t) out[c.id] = t; }
        return out;
      } catch (e) {
        console.warn('[API] getCalendarBookings: customer notes lookup failed:', e.message);
        return undefined;
      }
    })().catch(() => undefined), CALENDAR_LOOKUP_TIMEOUT_MS, undefined);
    // Same definition as getCustomerOutstandingBalance (what the payment modal bundles as "Previous due"): the same phone's
    // other unpaid/partial, non-cancelled bookings in this branch (any date), amount = final_amount − payments, excluding
    // the booking itself and — as BookingActionModal does — its same-name/same-date unpaid "related services".
    const previousDuePromise = failOpenAfter((async () => {
      const phoneOf = (b) => { const p = toE164(b.customer_phone); return p && p.length >= 11 ? p : null; };
      const visiblePhones = new Set((bookings || []).map(phoneOf).filter(Boolean));
      if (visiblePhones.size === 0) return {};
      try {
        // Only DUE counts (rendered visits owing money); future appointments never do. Candidates by status only (payment_status can be
        // stale); paid = payments − refunds. Server-side filter on the normalised phones that are on screen (chunked: PostgREST puts .in()
        // lists in the URL), so the calendar no longer downloads the branch's whole history; the phoneOf() check stays as a safety net.
        const phoneList = [...visiblePhones];
        const openAll = [];
        for (let i = 0; i < phoneList.length; i += 40) {
          openAll.push(...await pageAllRows(() => supabase
            .from('bookings')
            .select('id, customer_name, customer_phone, date, status, final_amount, payment_status, payments(amount), payment_refunds(amount)')
            .eq('branch_id', resolvedBranchId)
            .in('customer_phone', phoneList.slice(i, i + 40))
            .in('status', ['In-Progress', 'Completed'])
            .order('id')));
        }
        const open = openAll.filter((o) => visiblePhones.has(phoneOf(o)));
        const byPhone = {};
        for (const o of summarizeMoney(open, { today: nepalNow().today }).dueBookings) {
          const ph = phoneOf(o);
          if (!ph) continue;
          // "Related services" bundled in the payment panel are same-name / same-date bookings with NOTHING paid on them: decided from the
          // payments (bookingMoney), never from payment_status, so it can't disagree with the due amount.
          (byPhone[ph] ||= []).push({ id: o.id, name: o.customer_name, date: o.date, unpaid: o.money.paid === 0, due: o.money.due });
        }
        const out = {};
        for (const b of (bookings || [])) {
          const ph = phoneOf(b);
          if (!ph || !byPhone[ph]) continue;
          const list = byPhone[ph].filter(o => o.id !== b.id && !(o.unpaid && o.name === b.customer_name && o.date === b.date));
          if (list.length === 0) continue;
          out[b.id] = { count: list.length, amount: Math.round(list.reduce((sum, o) => sum + o.due, 0) * 100) / 100 };
        }
        return out;
      } catch (e) {
        console.warn('[API] getCalendarBookings: previous-due lookup failed:', e.message);
        return undefined;
      }
    })().catch(() => undefined), CALENDAR_LOOKUP_TIMEOUT_MS, undefined);

    // "New" tag lookup. Cosmetic only: on error or timeout the calendar still renders and no customer-linked
    // booking is tagged New (safer than mislabelling a returning customer as new).
    let historyFailed = false;
    if (bookingCustomerIds.length > 0) {
      // Rows after endDate can't change whether a booking in this range is a customer's first. Paged because
      // PostgREST caps a response at 1000 rows; id breaks date/time ties so pages are stable. Chunks hold disjoint
      // customers and each is already in (date, start_time, id) order.
      const fetchChunk = async (ids) => {
        const rows = [];
        for (let from = 0; ; from += PG_PAGE_SIZE) {
          const { data, error } = await supabase
            .from('bookings')
            .select('id, customer_id, date, start_time')
            .in('customer_id', ids)
            .neq('status', 'Cancelled')
            .lte('date', endDate)
            .order('date', { ascending: true })
            .order('start_time', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + PG_PAGE_SIZE - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < PG_PAGE_SIZE) return rows;
        }
      };
      const chunks = [];
      for (let i = 0; i < bookingCustomerIds.length; i += IN_CHUNK) chunks.push(bookingCustomerIds.slice(i, i + IN_CHUNK));
      // null = the lookup failed or timed out.
      const historyRows = await failOpenAfter(
        Promise.all(chunks.map(fetchChunk)).then(r => r.flat()).catch((e) => {
          console.warn('[API] getCalendarBookings: New-customer lookup failed, skipping New tags:', e.message);
          return null;
        }),
        CALENDAR_LOOKUP_TIMEOUT_MS,
        null
      );
      if (historyRows) {
        for (const h of historyRows) {
          if (!(h.customer_id in firstBookingIdByCustomer)) firstBookingIdByCustomer[h.customer_id] = h.id;
        }
      } else {
        historyFailed = true;
      }
    }
    const [customerNotesByCustomer, previousDueByBooking] = await Promise.all([customerNotesPromise, previousDuePromise]);
    const bookingsWithNewFlag = (bookings || []).map(b => ({
      ...b,
      // ZNLY-327: a walk-in is never "New" (no profile, or a client added later whose first visit stays a walk-in).
      isNewCustomer: isNewCustomerBooking(b, firstBookingIdByCustomer, historyFailed),
      // undefined (not null/0) when the lookup failed, so the UI shows nothing rather than a false "no alerts / no due".
      customerNotes: customerNotesByCustomer ? (customerNotesByCustomer[b.customer_id] || null) : undefined,
      previousDue: previousDueByBooking ? (previousDueByBooking[b.id] || null) : undefined,
    }));

    // A PERMANENTLY transferred-out therapist gets no proactive column above (by design —
    // see the is_permanent=false filter comment), but a booking made before/at the transfer
    // can still reference them at this branch. Without a column, CalendarGrid's
    // isTherapistVisible() can't place it and it silently falls into "Unassigned" (or, for a
    // shared/multi-therapist booking, silently drops that co-therapist's copy entirely — see
    // CalendarGrid.jsx's isTherapistVisible skip in the booking_therapists loop). Scan both
    // storage representations (flat therapist_id AND the booking_therapists junction, same
    // "two representations of the same fact" duality resolveSingleTherapist documents) so
    // both single- and multi-therapist bookings, and legacy rows that only ever populated the
    // junction table, all get a column. Add one ONLY for therapists an actual booking here
    // demands, not preemptively.
    const knownTherapistIds = new Set(mergedTherapists.map(t => t.id));
    const orphanTherapistIds = [...new Set(
      (bookings || [])
        .flatMap(b => [
          b.therapist_id,
          ...(b.booking_therapists || []).map(bt => bt.therapist_id),
        ])
        .filter(id => id && !knownTherapistIds.has(id))
    )];

    let finalTherapists = mergedTherapists;
    if (orphanTherapistIds.length > 0) {
      // Also fetch each orphan therapist's real staff_transfers history so a booking left
      // behind by a TEMPORARY transfer (already ended, or permanent-looking only because the
      // normal/temp-transfer queries above don't cover it) can shade its real window instead
      // of blocking the whole column all day — see resolveOrphanTransferWindow. Only a window
      // that overlaps [rangeStart, rangeEnd] is adopted (passed below) — an older, already-
      // stale window must NOT be adopted here, since the Calendar's ghost-column filter drops
      // any transferred column whose returnsAt date has already passed as of the day being
      // viewed, which would make the orphan booking vanish instead of shading correctly.
      const rangeStart = toKathmanduDate(startDate, '00:00:00');
      const rangeEnd = toKathmanduDate(endDate, '23:59:59');

      const [orphanTherapistsResult, orphanTransfersResult] = await Promise.all([
        supabase
          .from('therapists')
          .select('id, name, gender, specialties, position, is_service_staff, display_order')
          .in('id', orphanTherapistIds),
        supabase
          .from('staff_transfers')
          .select('id, therapist_id, from_branch_id, to_branch_id, is_permanent, is_return_leg, revert_at, effective_date, start_time, transferred_at, fromBranch:branches!staff_transfers_from_branch_id_fkey(name)')
          .in('therapist_id', orphanTherapistIds),
      ]);
      if (orphanTherapistsResult.error) throw orphanTherapistsResult.error;
      if (orphanTransfersResult.error) throw orphanTransfersResult.error;

      const orphanTransfersByTherapist = {};
      (orphanTransfersResult.data || []).forEach(t => {
        (orphanTransfersByTherapist[t.therapist_id] ??= []).push(t);
      });

      finalTherapists = [
        ...mergedTherapists,
        ...(orphanTherapistsResult.data || []).map(t => {
          const transferWindow = resolveOrphanTransferWindow(
            orphanTransfersByTherapist[t.id], resolvedBranchId, rangeStart, rangeEnd
          );
          return {
            ...t,
            transferredOut: transferWindow ? !!transferWindow.transferredOut : true,
            transferredIn: transferWindow ? !!transferWindow.transferredIn : false,
            transferId: transferWindow?.transferId ?? null,
            returnsAt: transferWindow ? transferWindow.returnsAt : null,
            transferStartAt: transferWindow ? transferWindow.transferStartAt : null,
            fromBranch: transferWindow?.fromBranch || null,
          };
        }),
      ].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));
    }

    return {
      data: {
        branchHours: {
          openTime: branch.open_time || '09:00:00',
          closeTime: branch.close_time || '21:00:00',
          timezone: branch.timezone || NEPAL_TZ,
        },
        // ZNLY-278: an own-only login gets only its own team member back: colleagues' columns would look free while they are busy.
        therapists: calendarColumnsFor(vis.ownBookingsOnly, finalTherapists, vis.therapistId),
        rooms: reused ? reused.rooms : (roomsResult.data || []),
        bookings: bookingsWithNewFlag,
        checkedOutByTherapistAndDate,
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
  genderPreference,
  therapistId,
  therapistIds,
  roomId,
  therapistRoomOverrides,
  companionName,
  companionPhone,
  bookingGroupId,
  visitId,   // ZNLY-402: bookings.visit_id; callers pass it only for orgs with the setting ON (createBookingGroup, "+ Service")
  referringCustomerId,
  referringRewardType,
  referringRewardAmount,
  referringRewardCatalogId,
  orgSlug,
  referralSource,
  referralSourceDetail,
  customerAccountId,
  overrideReason,
  // Set only when the caller already knows the real customer record — e.g.
  // converting a waitlist entry (see migration-327 / WaitlistPanel). Bypasses
  // the phone/name lookup-and-rename below entirely: customerName/customerPhone
  // might be masked (a restricted staff account's canViewCustomerDetails=false
  // view of the entry), and masked text must never re-enter a write — see the
  // incident this fixed. Never set this from a value the caller typed; only
  // from a column that's already a real customers.id.
  knownCustomerId,
  // ZNLY-327: a walk-in who gives no details. No customer profile, no phone: customerName is "Walk-in" or "Walk-in · <label>",
  // customer_id stays NULL and the row is flagged so counts, reminders and campaigns can leave it out. Never combined with knownCustomerId.
  isWalkIn = false,
  walkInLabel = null,
}) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    if (isWalkIn) { knownCustomerId = undefined; customerPhone = null; customerEmail = null; }
    if (!isWalkIn && (!customerPhone || !customerPhone.trim()) && !knownCustomerId && !(await customerPhoneOptional(resolveBranchId(branchId)))) {
      return { data: null, error: { code: 'PHONE_REQUIRED', message: 'Phone number is required' } };
    }

    // ZNLY-235: an own-only login only ever sees bookings it is on, so a booking it makes is assigned to itself when it did not pick
    // someone (otherwise the new row would vanish from its own screens).
    if (!orgSlug && isReadingViaSafeViews() && !therapistId && !(therapistIds && therapistIds.length)) {
      const { user: me, profile: meProfile } = await getAuthenticatedUser();
      if (me && meProfile && viewerAccess(meProfile).ownOnly) {
        const { data: mine } = await supabase.from('therapists').select('id').eq('user_id', me.id).limit(1);
        if (mine && mine[0]) therapistId = mine[0].id;
      }
    }

    // knownCustomerId: overwrite whatever was passed as customerName/Phone/Email
    // with the real customer record, before any of those values reach a write.
    // The caller's own copies may be masked (canViewCustomerDetails=false), and
    // masked text must never land in bookings.customer_name/_phone — that was
    // exactly the Yukta Dhungana-style corruption this closes, made automatic
    // instead of a one-off typo.
    if (knownCustomerId && !isWalkIn) {
      const { data: realCustomer, error: custLookupErr } = await supabase
        .from('customers')
        .select('full_name, phone, email')
        .eq('id', knownCustomerId)
        .single();
      if (custLookupErr) {
        return { data: null, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Could not find the linked customer record.' } };
      }
      customerName = realCustomer.full_name;
      customerPhone = realCustomer.phone;
      customerEmail = realCustomer.email;
      // Relaxing the phone-required gate above for this path is correct — a
      // restricted account has no phone to retype — but downstream code
      // (outstanding-balance lookups, reports) groups by phone, and a
      // customer record can legitimately have neither on file. Fail closed
      // here rather than silently writing a booking with no way to look the
      // customer back up by contact info.
      if (!customerPhone && !customerEmail && !(await customerPhoneOptional(resolveBranchId(branchId)))) {
        return { data: null, error: { code: 'NO_CONTACT_INFO', message: 'This customer has no phone or email on file — add one to their profile before booking.' } };
      }
    } else if (!isWalkIn) {
      customerName = toTitleCase(customerName);
    }
    const resolvedBranchId = resolveBranchId(branchId);

    // 1. Fetch service for duration + price, and the branch's industry config.
    // These two don't depend on each other, so they go out together rather than
    // back to back. The industry's enable_rooms used to be a third round trip
    // keyed off branchData.organizations.industry_type; it's embedded here
    // instead (same organizations → industries relationship AuthContext already
    // selects through), which folds three sequential queries into one.
    const [
      { data: service, error: serviceError },
      { data: branchData, error: branchError },
    ] = await Promise.all([
      supabase
        .from('services_with_offer_pricing')
        .select('id, name, duration_minutes, price_npr, effective_price_npr, is_couple, category, price_type')
        .eq('id', serviceId)
        .single(),
      supabase
        .from('branches')
        .select('org_id, organizations(industry_type, industries(enable_rooms))')
        .eq('id', resolvedBranchId)
        .single(),
    ]);

    // Error precedence is checked in the original sequential order so callers
    // see the same error they did before these were batched.
    if (serviceError) throw serviceError;
    if (branchError) throw branchError;

    // Group-booking creates one independent bookings row per person, each carrying the
    // full service price -- a couple service (priced once for the pair) picked there
    // would double-charge. The calendar's group-booking service pickers already filter
    // is_couple services out of their options, but that's client-side only; enforce it
    // here too in case a value was selected before the service list refreshed.
    if (bookingGroupId && service.is_couple) {
      return {
        data: null,
        error: {
          code: 'COUPLE_SERVICE_NOT_ALLOWED_IN_GROUP',
          message: `${service.name} is a couple service and can't be booked as a group booking — use a single booking with 2 ${staffWordPlural()} instead.`,
        },
      };
    }

    // 2. Compute end time for overlap check
    const endTime = addMinutesToTime(startTime, service.duration_minutes);

    // 2b. Check if this industry requires rooms. Resolved from the embedded
    // industries row fetched above; same default as before (require rooms
    // unless the industry explicitly opts out).
    const industryType = branchData?.organizations?.industry_type;
    let enableRooms = true; // default to requiring rooms

    if (industryType) {
      enableRooms = branchData?.organizations?.industries?.enable_rooms !== false;
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
          return { data: null, error: { code: 'INVALID_ROOM', message: `Selected room is not available in this ${wordBranch()}.` } };
        }
        if (!selectedRoom.is_active) {
          return { data: null, error: { code: 'ROOM_INACTIVE', message: 'Selected room is not active.' } };
        }

        // Check room capacity — count overlapping bookings. Must union bookings.room_id
        // matches (someone's primary room) with booking_therapists.room_id matches
        // (a companion's override room) — see migration-171's check_room_capacity(),
        // which this JS pre-check must agree with or staff get told a room is free
        // right before the stricter DB trigger rejects it.
        const capacity = getRoomCapacity(selectedRoom);
        // Both halves of the capacity check are independent reads — issue them
        // together instead of waiting for the primary-room count before asking
        // for the override-room rows.
        const [{ data: roomOverlaps }, { data: companionOverlapRows }] = await Promise.all([
          supabase
            .from('bookings')
            .select('id')
            .eq('room_id', roomId)
            .eq('branch_id', resolvedBranchId)
            .eq('date', date)
            .not('status', 'in', '("Cancelled","No Show")')
            .lt('start_time', endTime)
            .gt('end_time', startTime),
          supabase
            .from('booking_therapists')
            .select('booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)')
            .eq('room_id', roomId),
        ]);
        const companionOverlapCount = countOverlappingRoomRows(companionOverlapRows, {
          branchId: resolvedBranchId, date, startTime, endTime,
        });

        if ((roomOverlaps || []).length + companionOverlapCount >= capacity) {
          return { data: null, error: { code: 'ROOM_FULL', message: `${selectedRoom.name} is fully booked at this time (capacity: ${capacity}).` } };
        }

        availableRoom = selectedRoom;
      } else {
        // 3+4. Fetch active rooms for the branch and the overlapping bookings in
        // the slot. Neither depends on the other — only the companion-override
        // lookup below needs the room ids, so it stays sequential.
        const [
          { data: rooms, error: roomsError },
          { data: overlapping, error: overlapError },
        ] = await Promise.all([
          supabase
            .from('rooms')
            .select('id, name, capacity')
            .eq('branch_id', resolvedBranchId)
            .eq('is_active', true)
            .order('name'),
          supabase
            .from('bookings')
            .select('room_id')
            .eq('branch_id', resolvedBranchId)
            .eq('date', date)
            .not('status', 'in', '("Cancelled","No Show")')
            .lt('start_time', endTime)
            .gt('end_time', startTime),
        ]);

        // Same checks in the same order as before they were batched.
        if (roomsError) throw roomsError;
        if (!rooms || rooms.length === 0) {
          return { data: null, error: { code: 'ROOMS_FULL', message: `No rooms available at this ${wordBranch()}.` } };
        }
        if (overlapError) throw overlapError;

        // 5. Count bookings per room and pick first with remaining capacity. Also count
        // booking_therapists.room_id occupancy (companion overrides) per candidate room —
        // same reasoning as the explicit-room path above.
        const roomBookingCounts = {};
        (overlapping || []).forEach(b => {
          roomBookingCounts[b.room_id] = (roomBookingCounts[b.room_id] || 0) + 1;
        });

        const { data: companionOverlapRowsAll } = await supabase
          .from('booking_therapists')
          .select('room_id, booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)')
          .in('room_id', rooms.map(r => r.id));

        rooms.forEach(r => {
          const rowsForRoom = (companionOverlapRowsAll || []).filter(row => row.room_id === r.id);
          const companionCount = countOverlappingRoomRows(rowsForRoom, {
            branchId: resolvedBranchId, date, startTime, endTime,
          });
          if (companionCount > 0) {
            roomBookingCounts[r.id] = (roomBookingCounts[r.id] || 0) + companionCount;
          }
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
    let customerId = knownCustomerId || null;
    let isNewCustomer = false;
    const orgId = branchData?.org_id || null;
    // knownCustomerId means the caller already has the real customer row —
    // never re-resolve by name/phone in that case (those fields may be masked
    // for the acting account, and the lookup below unconditionally overwrites
    // full_name/phone/email on a match, which is exactly how masked text would
    // corrupt a real customer record).
    if (!knownCustomerId && !isWalkIn) try {
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
        // Create the customer through the SECURITY DEFINER RPC (migration-402): anon can't read back a raw insert (no SELECT
        // policy), so a direct .insert().select() left customer_id NULL for online bookings. One path for anon and staff;
        // the RPC also de-dupes by phone/email and never overwrites an existing profile.
        const { data: newCustomerId, error: createCustErr } = await supabase.rpc('create_customer_for_booking', {
          p_org_id: orgId,
          p_branch_id: resolvedBranchId,
          p_full_name: customerName,
          p_phone: phone || null,
          p_email: email || null,
          p_gender: customerGender || null,
        });
        if (newCustomerId) {
          customerId = newCustomerId;
          isNewCustomer = true;
        } else if (createCustErr) {
          // Still non-blocking (the booking must go through), but loud: a booking without a customer link is a real problem.
          console.error('[API] create_customer_for_booking failed:', createCustErr.message);
        }
      }
    } catch (custErr) {
      // Non-blocking: booking still proceeds without customer link
      console.error('[API] Customer lookup/create failed:', custErr.message);
    }

    // 7a. Resolve therapist IDs (support both single and multi)
    const allTherapistIds = therapistIds
      ? (Array.isArray(therapistIds) ? therapistIds.filter(Boolean) : [therapistIds])
      : (therapistId ? [therapistId] : []);
    const primaryTherapistId = allTherapistIds[0] || null;

    let therapistNameSnapshot = null;
    if (allTherapistIds.length > 0) {
      // All four therapist pre-flight reads depend only on values known before
      // this block (the therapist ids, the date, the service and the branch),
      // so they go out as one batch rather than four sequential round trips.
      // The guard checks below still run in their original order, so the first
      // failure a caller sees is unchanged.
      const atDate = toKathmanduDate(date, startTime);
      const [
        { data: therapistsData, error: therapistLookupError },
        { data: transferRows },
        { data: attendanceRecords },
        { data: eligibleIds },
      ] = await Promise.all([
        supabase
          .from('therapists')
          .select('id, name, is_active, branch_id')
          .in('id', allTherapistIds),
        // A therapist's static branch_id is only their home branch — visiting
        // therapists on an active staff_transfers window must also be bookable at
        // the destination branch. Reconstruct each therapist's effective branch at
        // the booking's date/time instead of trusting branch_id directly (same
        // approach as the reassignment path, see therapistBranchWindow.js).
        supabase
          .from('staff_transfers')
          .select('therapist_id, from_branch_id, to_branch_id, is_permanent, effective_date, start_time, revert_at, transferred_at')
          .in('therapist_id', allTherapistIds),
        date
          ? supabase
              .from('therapist_attendance')
              .select('therapist_id, status, check_out_time')
              .in('therapist_id', allTherapistIds)
              .eq('date', date)
          : Promise.resolve({ data: null }),
        // Service↔staff eligibility allow-list (migration-249), per-branch since
        // migration-257/258 — no rows for this service AT THIS BRANCH means
        // unrestricted here, otherwise every selected therapist must be on the
        // list. This is a nicer pre-flight for staff sessions only (real
        // enforcement — the part anon can't bypass — now lives in the
        // enforce_booking_therapist_guards DB trigger, migration-252/258, which
        // applies the same branch scoping).
        fetchServiceTherapists(serviceId, resolvedBranchId),
      ]);
      if (therapistLookupError) throw therapistLookupError;

      if (!therapistsData || therapistsData.length !== allTherapistIds.length) {
        return { data: null, error: { code: 'INVALID_THERAPIST', message: `One or more selected ${staffWordPlural()} are not available in this ${wordBranch()}.` } };
      }
      const inactive = therapistsData.find(t => !t.is_active);
      if (inactive) {
        return { data: null, error: { code: 'THERAPIST_INACTIVE', message: `${cap(staffWord())} ${inactive.name} is not active.` } };
      }

      const transfersByTherapist = {};
      (transferRows || []).forEach(t => {
        (transfersByTherapist[t.therapist_id] ||= []).push(t);
      });

      const guardOwnsAvailability = await staffAvailabilityEnforced(resolvedBranchId);
      const wrongBranch = guardOwnsAvailability ? null : therapistsData.find(t =>
        computeTherapistBranchAt(transfersByTherapist[t.id] || [], t.branch_id, atDate) !== resolvedBranchId
      );
      if (wrongBranch) {
        return { data: null, error: { code: 'INVALID_THERAPIST', message: `${wrongBranch.name} is not available in this ${wordBranch()} at this time (transferred elsewhere for this date).` } };
      }

      if (date) {
        const absent = guardOwnsAvailability ? null : (attendanceRecords || []).find(a =>
          a.status === 'Absent' || LEAVE_LIKE_ATTENDANCE_STATUSES.includes(a.status)
        );
        if (absent) {
          const absentTherapist = therapistsData.find(t => t.id === absent.therapist_id);
          return { data: null, error: { code: 'THERAPIST_ABSENT', message: `${absentTherapist?.name || cap(staffWord())} is marked as ${absent.status} on this date.` } };
        }

        const checkedOut = (attendanceRecords || []).find(a =>
          isAfterCheckout(a.check_out_time, date, startTime)
        );
        if (checkedOut) {
          const checkedOutTherapist = therapistsData.find(t => t.id === checkedOut.therapist_id);
          return { data: null, error: { code: 'THERAPIST_CHECKED_OUT', message: `${checkedOutTherapist?.name || cap(staffWord())} already checked out for this date.` } };
        }
      }

      const primary = therapistsData.find(t => t.id === primaryTherapistId);
      therapistNameSnapshot = primary?.name || null;

      if (eligibleIds && eligibleIds.length > 0) {
        const eligibleSet = new Set(eligibleIds);
        const ineligible = therapistsData.find(t => !eligibleSet.has(t.id));
        if (ineligible) {
          return { data: null, error: { code: 'THERAPIST_NOT_ELIGIBLE', message: `${ineligible.name} is not eligible for ${service.name}.` } };
        }
      }
    }

    // 7a2. Validate + capacity-check per-therapist room overrides (couple bookings with
    // each person in a separate room). Done before the main insert so a full override
    // room fails fast with a friendly error instead of creating a booking with a
    // companion silently left unassigned.
    const overrideEntries = therapistRoomOverrides
      ? Object.entries(therapistRoomOverrides).filter(([tid, rid]) => rid && allTherapistIds.includes(tid))
      : [];
    if (overrideEntries.length > 0) {
      const { rooms: overrideRooms, error: overrideRoomError } = await validateRoomsForBranch(
        overrideEntries.map(([, rid]) => rid),
        resolvedBranchId
      );
      if (overrideRoomError) return { data: null, error: overrideRoomError };

      for (const [, overrideRoomId] of overrideEntries) {
        const capacityError = await checkOverrideRoomCapacity({
          room: overrideRooms.get(overrideRoomId),
          branchId: resolvedBranchId,
          date,
          startTime,
          endTime,
        });
        if (capacityError) return { data: null, error: capacityError };
      }
    }

    // 7. Insert booking — triggers compute end_time, datetimes, final_amount, booking_number
    // Capture who created it (null for anonymous customer self-booking).
    // orgSlug is only ever passed by the public/online booking flow — never by staff
    // flows — so treat it as authoritative: an online booking must never inherit
    // created_by from a staff session that happens to be active in the same browser.
    const authUser = orgSlug ? null : (await supabase.auth.getUser()).data.user;
    // Public/online flow only — a random, unguessable per-attempt id. Needed because
    // anon has no SELECT policy on `bookings` (migration-097 closed a cross-org PII
    // leak there), so `.insert().select()` can't satisfy RETURNING under RLS and would
    // reject the whole insert. Instead skip .select() below and read the row back
    // through public_get_booking_by_request_id (migration-223), keyed on this id.
    const clientRequestId = (orgSlug || isReadingViaSafeViews()) ? crypto.randomUUID() : null;  // restricted logins re-read their new row by this id (ZNLY-235)

    // Tiered pricing: the quote at booking time follows whoever is actually
    // requested, same as every other price type — "Any available" (no
    // primaryTherapistId yet) still charges the Unassigned rate
    // (effective_price_npr, already services.price_npr for a tiered service).
    // Reassignment later recomputes this at payment time per the standing
    // quote-vs-final decision (migration-319) — this is only the quote.
    let resolvedBaseAmount = Number(service.effective_price_npr);
    if (service.price_type === 'tiered' && primaryTherapistId) {
      const { data: tierPrice, error: tierPriceError } = await fetchServicePriceForTherapist(serviceId, primaryTherapistId);
      if (tierPriceError) throw tierPriceError;
      if (tierPrice != null) resolvedBaseAmount = tierPrice;
    }

    const insertPayload = {
      branch_id: resolvedBranchId,
      room_id: availableRoom?.id || null,
      service_id: serviceId,
      therapist_id: primaryTherapistId,
      customer_id: customerId,
      customer_name: customerName,
      ...(isWalkIn ? { is_walk_in: true, walk_in_label: walkInLabel?.trim() || null } : {}),
      customer_email: customerEmail || null,
      customer_phone: toE164(customerPhone),
      customer_gender: customerGender || null,
      gender_preference: genderPreference || null,
      customer_account_id: customerAccountId || null,
      companion_name: companionName?.trim() || null,
      companion_phone: companionPhone ? toE164(companionPhone) : null,
      date: date,
      start_time: startTime,
      base_amount: resolvedBaseAmount,
      discount_amount: 0,
      special_requests: specialRequests || null,
      created_by: authUser?.id || null,
      booking_group_id: bookingGroupId || null,
      ...(visitId ? { visit_id: visitId } : {}),
      referral_source: referralSource || null,
      referral_source_detail: referralSourceDetail || null,
      client_request_id: clientRequestId,
      // Phase 9A: Snapshot fields — preserve original values at booking time
      service_name_snapshot: service.name,
      service_duration_snapshot: service.duration_minutes,
      service_price_snapshot: resolvedBaseAmount,
      service_category_snapshot: service.category,
      room_name_snapshot: availableRoom?.name || null,
      therapist_name_snapshot: therapistNameSnapshot,
      ...(availabilityOverride ? { availability_override_reason: availabilityOverride } : {}),
    };

    let booking;
    let insertError;
    // ZNLY-235: a restricted login cannot read the base row back (INSERT ... RETURNING needs SELECT visibility), so it inserts bare and
    // re-reads the masked row through the safe view by request id (the fetch wrapper points bookings reads at bookings_safe).
    const restrictedInsert = !orgSlug && isReadingViaSafeViews();
    if (orgSlug || restrictedInsert) {
      ({ error: insertError } = await supabase.from('bookings').insert(insertPayload));
    } else {
      ({ data: booking, error: insertError } = await supabase
        .from('bookings')
        .insert(insertPayload)
        .select()
        .single());
    }

    if (insertError) {
      const availabilityErr = availabilityFailure(insertError);
      if (availabilityErr) return availabilityErr;
      if (insertError.code === '23P01') {
        return { data: null, error: { code: 'THERAPIST_CONFLICT', message: `One or more selected ${staffWordPlural()} are already booked during this time slot.` } };
      }
      if (insertError.code === 'P0003') {
        return { data: null, error: { code: 'ROOMS_FULL', message: 'Scheduling conflict. Please try a different time or room.' } };
      }
      if (insertError.message?.includes('BRANCH_CLOSED_ONLINE')) {
        return { data: null, error: { code: 'BRANCH_CLOSED', message: 'We are closed on that date. Please choose another day.' } };
      }
      if (insertError.code === 'P0005') {
        return { data: null, error: { code: 'BRANCH_ONLINE_CAPACITY', message: `This time is fully booked — no ${staffWordPlural()} available. Please choose another time.` } };
      }
      // compute_booking_datetimes trigger (migration-179): start time +
      // service duration would extend past midnight.
      if (insertError.message?.includes('BOOKING_CROSSES_MIDNIGHT')) {
        return { data: null, error: { code: 'BOOKING_CROSSES_MIDNIGHT', message: insertError.message.split('BOOKING_CROSSES_MIDNIGHT:')[1]?.trim() || 'This time would extend past midnight — please choose an earlier start time.' } };
      }
      // enforce_booking_therapist_guards / enforce_booking_therapist_junction_guards
      // triggers (migration-252) — the real enforcement point, since anon can't be
      // trusted to run the JS pre-flight checks above. One ERRCODE (P0006) covers all
      // three guards; split on the message's CODE: prefix same as the midnight rule.
      if (insertError.code === 'P0006') {
        for (const code of ['THERAPIST_NOT_ELIGIBLE', 'THERAPIST_ABSENT', 'THERAPIST_CHECKED_OUT']) {
          if (insertError.message?.includes(code)) {
            return { data: null, error: { code, message: insertError.message.split(`${code}:`)[1]?.trim() || friendlyError(insertError, "Couldn't save the booking. Please try again.") } };
          }
        }
      }
      throw insertError;
    }

    if (restrictedInsert) {
      const { data: safeRow, error: safeErr } = await supabase.from('bookings').select('*').eq('client_request_id', clientRequestId).maybeSingle();
      if (safeErr) throw safeErr;
      if (!safeRow) return { data: null, error: { code: 'BOOKING_NOT_VISIBLE', message: 'The booking was saved, but it is not assigned to you, so it is not shown here. Ask your manager to check it.' } };
      booking = safeRow;
    }

    if (orgSlug) {
      // Read the just-inserted row back via the narrow SECURITY DEFINER RPC —
      // see the clientRequestId comment above for why a plain .select() can't do this.
      const { data: fetchedBooking, error: fetchError } = await supabase
        .rpc('public_get_booking_by_request_id', { p_client_request_id: clientRequestId })
        .single();
      if (fetchError || !fetchedBooking) {
        // The booking itself is already committed at this point (the insert above
        // succeeded) — only the confirmation read-back failed, e.g. a transient network
        // blip. Surface a distinct code so the UI doesn't tell the customer to just
        // "try again", which would create a second, duplicate booking.
        console.error('[API] public_get_booking_by_request_id failed:', fetchError?.message);
        return {
          data: null,
          error: {
            code: 'BOOKING_CONFIRMATION_UNAVAILABLE',
            message: `Your booking was placed, but we could not load the confirmation details. Please check your email/SMS, or contact the ${wordBranch()} to confirm, before trying to book again.`,
          },
        };
      }
      booking = { ...fetchedBooking, branch_id: resolvedBranchId, final_amount: fetchedBooking.base_amount };
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
      const rows = allTherapistIds.map((tid, index) => ({
        booking_id: booking.id,
        therapist_id: tid,
        start_time: booking.start_time,
        end_time: booking.end_time,
        room_id: resolveJunctionRoomId({
          index,
          therapistId: tid,
          overridesMap: therapistRoomOverrides,
          existingRoomId: null, // brand-new booking, nothing to preserve
        }),
        // companions carry their own reason (mirror row of the primary is skipped by the guard)
        ...(availabilityOverride && tid !== primaryTherapistId ? { availability_override_reason: availabilityOverride } : {}),
      }));
      // upsert, not insert — sync_booking_therapists_from_booking (migration-252)
      // already inserted the primary therapist's row off the bookings AFTER INSERT
      // trigger, so a plain insert would hit (booking_id, therapist_id)'s unique
      // constraint on every single-therapist booking. ignoreDuplicates MUST be
      // false (-> ON CONFLICT DO UPDATE, not DO NOTHING): the trigger's row always
      // has room_id NULL, while this row carries resolveJunctionRoomId()'s
      // per-therapist override (migration-171) — ignoreDuplicates:true was silently
      // discarding that override on every booking, undercounting room capacity for
      // multi-room tenants.
      const { error: btError } = await supabase
        .from('booking_therapists')
        .upsert(rows, { onConflict: 'booking_id,therapist_id', ignoreDuplicates: false });
      if (btError) {
        // Same reasoning as assignTherapist above -- the booking row itself already
        // committed, so this stays non-fatal, but must be visible to the caller now
        // that a real trigger can reject this insert.
        console.warn('[API] booking_therapists insert error:', btError.message);
        booking._therapistAssignmentWarning = parseAvailabilityError(btError)?.message || btError.message;
      }
    }

    if (availabilityOverride) await clearAvailabilityOverride(booking.id);

    capture('staff_booking_created', {
      service_id: serviceId,
      branch_id: booking.branch_id,
      final_amount: Number(booking.final_amount),
    });
    return { data: booking, error: null };
  } catch (error) {
    console.error('[API] createBooking error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Atomic create-new-and-cancel-old reschedule — NOT the same operation as
// rescheduleBooking() above (which updates a booking's date/time in place for
// the calendar's drag-and-drop flow). This one backs the "Reschedule" action

// Multi-service visit: one bookings row per selected service, scheduled back-to-back
// from the chosen start time and linked by a shared booking_group_id (migration-030,
// the same mechanism the calendar's group bookings already use). A single professional
// covers the whole visit, so every row carries the same therapistId.
//
// Not a single SQL transaction: createBooking() holds ~500 lines of pricing, campaign,
// customer-upsert, referral and snapshot logic that would have to be duplicated in SQL
// and kept in sync. Instead this pre-checks every slot, creates in order, and on a
// mid-way failure cancels whatever was already created so the customer is never left
// silently half-booked. The residual window is small but real, and cancelled rows do
// remain visible to staff — that trade is deliberate.
// Staff multi-service booking ("Several services in one booking", ZNLY-402): every service may carry its own `startTime` and `therapistIds`
// (default: back-to-back from `startTime` with `therapistId`, as for the online flow). `staffRollback: true` (the desk, a signed-in user): the rows made so far
// are cancelled when a later one fails, because public_cancel_booking_group only releases anonymous online rows (created_by IS NULL). `visitId` may be passed
// (e.g. "+ Service" joining an existing visit); otherwise an ON org gets a new one. A failure carries `failedRow` (index of the service that failed).
export async function createBookingGroup({ services, date, startTime, therapistId, staffRollback = false, ...common }) {
  if (!services || services.length === 0) {
    return { data: null, error: { code: 'NO_SERVICES', message: 'Select at least one service.' } };
  }

  // Single service: no group, no compensation path — behave exactly like a plain booking.
  if (services.length === 1) {
    const { data, error } = await createBooking({
      ...common,
      serviceId: services[0].id,
      date,
      startTime,
      therapistId,
    });
    return { data: data ? { bookings: [data], bookingGroupId: null } : null, error };
  }

  const bookingGroupId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `grp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // ZNLY-402: one person, several services, one Save = one visit (ON orgs only; the booking_group_id above stays as before).
  const visitId = common.visitId || ((await multiServiceCache.get(common.branchId)) ? newVisitId() : null);

  // Lay the services out back-to-back so each row gets its own real slot (unless the caller gave a row its own start time).
  let cursor = startTime;
  const planned = services.map((service) => {
    const slot = { service, startTime: service.startTime || cursor };
    cursor = addMinutesToTime(slot.startTime, service.duration_minutes);
    return slot;
  });

  const created = [];
  for (const [rowIndex, { service, startTime: slotStart }] of planned.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await createBooking({
      ...common,
      serviceId: service.id,
      date,
      startTime: slotStart,
      therapistId: service.therapistIds ? undefined : therapistId,
      therapistIds: service.therapistIds || undefined,
      overrideReason: service.overrideReason,   // only the rows that needed it (staff multi-service); the online flow passes none
      // ZNLY-402 (A5): the desk's one-person visit on an ON org carries ONLY visit_id. booking_group_id means a party of several people.
      // The online flow keeps it: its rollback RPC (public_cancel_booking_group) finds the rows by it.
      bookingGroupId: staffRollback && visitId ? null : bookingGroupId,
      visitId,
    });

    if (error) {
      // Compensate via the narrow SECURITY DEFINER RPC, not updateBookingStatus():
      // that one requires an authenticated staff user and bookings has no anon UPDATE
      // policy, so the staff path would silently fail for the anonymous customers this
      // flow actually serves. One call releases the whole group.
      if (created.length > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { error: rollbackError } = staffRollback
            // The desk: a signed-in user made these rows (created_by is set), which the anonymous RPC deliberately ignores, so cancel them directly.
            ? await supabase.from('bookings').update({ status: 'Cancelled', cancellation_reason: 'Not created: the booking could not be completed.' }).in('id', created.map((b) => b.id))
            : await supabase.rpc('public_cancel_booking_group', { p_booking_group_id: bookingGroupId });
          if (rollbackError) throw rollbackError;
        } catch (cancelError) {
          // Surfaced loudly: the customer now holds bookings they weren't told about.
          console.error('[API] createBookingGroup rollback FAILED for group', bookingGroupId, cancelError);
          return {
            data: null,
            error: {
              code: 'BOOKING_GROUP_PARTIAL',
              failedRow: rowIndex,
              partial: true,
              message: `${service.name} could not be booked, and we could not automatically release the services booked before it. Please contact the ${wordBranch()} to confirm what is reserved.`,
            },
          };
        }
      }
      return {
        data: null,
        error: {
          ...error,
          failedRow: rowIndex,
          message: `${service.name}: ${error.message || 'could not be booked.'}${created.length > 0 && !staffRollback ? ' Your other services were released — please pick another time.' : ''}`,
        },
      };
    }
    created.push(data);
  }

  return { data: { bookings: created, bookingGroupId }, error: null };
}

// Group booking (multiple PEOPLE at one shared time, Fresha-style) — distinct from
// createBookingGroup above, which sequences one person through several back-to-back
// services. Here every row shares the same date/startTime; the rollback mechanics are
// copied from createBookingGroup's since both serve the same anonymous-customer RLS
// shape (no anon SELECT/UPDATE on bookings, so compensation goes through the same
// narrow public_cancel_booking_group RPC).
export async function submitGroupBooking({ branchId, orgSlug, date, startTime, genderPreference, specialRequests, leadContact, people, customerAccountId = null, createBookingFn = createBooking }) {
  // Referral resolution mirrors BookingConfirmation.jsx's handleConfirmBooking exactly
  // (lead-only — guests have no account of their own to credit a referral against).
  let referringCustomerId = null;
  let referralSourceDetail = null;
  const referralSource = leadContact.referralSource || null;

  if (referralSource === 'client') {
    const namePart = leadContact.referralClientName?.trim() || '';
    const dialCode = leadContact.referralCountryCode || '+977';
    const referralE164 = toE164(leadContact.referralPhone, dialCode);
    const phonePart = referralE164 ? `(${referralE164})` : '';
    referralSourceDetail = [namePart, phonePart].filter(Boolean).join(' ') || null;

    if (referralE164 && referralE164 !== leadContact.phone) {
      const { data: referrer } = await lookupReferrerByPhone(orgSlug, leadContact.referralPhone, dialCode);
      referringCustomerId = referrer?.id || null;
    }
  } else if (referralSource === 'social_media') {
    referralSourceDetail = leadContact.referralSocialPlatform || null;
  } else if (referralSource === 'staff') {
    referralSourceDetail = leadContact.referralStaffName?.trim() || null;
  }

  // ZNLY-188: a guest who leaves firstName/lastName/email/phone/gender all blank
  // inherits the lead's full contact info (name AND email/phone/gender — previously
  // only name had this fallback, while email/phone were unconditionally the lead's
  // regardless of what a guest typed). A guest who fills in ANY of their own info is
  // validated by GroupConfirmStep's isGuestContactValid before this ever runs, so
  // firstName/phone are guaranteed present here when guestFilled is true. Giving a
  // guest their own phone/email lets createBooking's customer-matching create a
  // separate customers row for them instead of repeatedly overwriting the lead's.
  const rowArgs = (person) => {
    const guestFilled = !person.isLead && Boolean(
      person.firstName?.trim() || person.lastName?.trim() || person.email?.trim() ||
      person.phone?.trim() || person.gender
    );
    const guestName = guestFilled ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : null;
    return {
      branchId,
      orgSlug,
      date,
      startTime,
      genderPreference,
      specialRequests,
      serviceId: person.service.id,
      therapistId: person.therapistId,
      customerName: person.isLead ? leadContact.name : (guestName || leadContact.name),
      customerEmail: person.isLead ? leadContact.email : (guestFilled ? (person.email || null) : leadContact.email),
      customerPhone: person.isLead
        ? leadContact.phone
        : (guestFilled ? toE164(person.phone, person.phoneCountryCode || '+977') : leadContact.phone),
      customerGender: person.isLead ? leadContact.gender : (guestFilled ? (person.gender || null) : leadContact.gender),
      ...(person.isLead ? { customerAccountId, referringCustomerId, referralSource, referralSourceDetail } : {}),
    };
  };

  // ZNLY-182: if this person picked a combo service, wire up its per-component
  // booking_combo_items rows the same way the solo path (BookingConfirmation.jsx)
  // does — non-blocking, since the person's booking itself already succeeded by
  // the time this runs; a combo-items failure here must not trigger the group's
  // own rollback-on-booking-failure compensation logic below, which exists for
  // booking creation failing, not a secondary metadata write failing afterward.
  const createGroupComboItems = async (person, data) => {
    if (!person.service?.is_combo || !data?.id) return;
    const { data: components } = await fetchServiceComboComponents(person.service.id);
    if (!components?.length) return;
    const comboComponents = components.map((c) => ({
      serviceId: c.serviceId,
      componentId: c.componentId,
      defaultTiming: c.defaultTiming,
      therapistId: c.defaultSameStaff ? (person.therapistId || null) : null,
    }));
    const { error: comboError } = await createComboBookingItems({
      bookingId: data.id,
      branchId,
      date,
      startTime,
      roomId: null,
      components: comboComponents,
      orgSlug,
    });
    if (comboError) {
      console.error('[API] submitGroupBooking createComboBookingItems failed:', comboError.message);
    }
  };

  // Single person: no group, no compensation path — behave exactly like a plain booking.
  if (people.length === 1) {
    const { data, error } = await createBookingFn(rowArgs(people[0]));
    if (!error && data) await createGroupComboItems(people[0], data);
    return { data: data ? { bookings: [data] } : null, error };
  }

  const bookingGroupId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `grp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const created = [];
  for (const person of people) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await createBookingFn({ ...rowArgs(person), bookingGroupId });

    if (error) {
      if (created.length > 0) {
        // The rollback RPC is the only thing standing between "one person's
        // booking failed" and "a partial group sits reserved with nobody
        // told" -- retry a transient failure (network blip, momentary DB
        // contention) a few times before giving up, rather than failing on
        // the first hiccup.
        let rollbackOk = false;
        let lastCancelError = null;
        for (let attempt = 0; attempt < 3 && !rollbackOk; attempt += 1) {
          if (attempt > 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            const { error: rollbackError } = await supabase
              .rpc('public_cancel_booking_group', { p_booking_group_id: bookingGroupId });
            if (rollbackError) throw rollbackError;
            rollbackOk = true;
          } catch (cancelError) {
            lastCancelError = cancelError;
          }
        }

        if (!rollbackOk) {
          console.error('[API] submitGroupBooking rollback FAILED for group', bookingGroupId, lastCancelError);
          // Best-effort: let branch staff know a group is stuck instead of
          // relying solely on the customer to call in. Never let this
          // throw/block the error already being returned to the customer.
          try {
            await supabase.rpc('public_report_booking_group_failure', {
              p_branch_id: resolveBranchId(branchId),
              p_booking_group_id: bookingGroupId,
              p_people_count: created.length,
            });
          } catch (reportError) {
            console.error('[API] submitGroupBooking failed to report stuck group', bookingGroupId, reportError);
          }
          return {
            data: null,
            error: {
              code: 'BOOKING_GROUP_PARTIAL',
              message: `${person.label || person.name || 'A person in your group'} could not be booked, and we could not automatically release the others. Please contact the ${wordBranch()} to confirm what is reserved.`,
            },
          };
        }
      }
      return {
        data: null,
        error: {
          ...error,
          message: `${error.message || 'could not be booked.'}${created.length > 0 ? ' The rest of your group was released — please pick another time.' : ''}`,
        },
      };
    }
    created.push(data);
    // eslint-disable-next-line no-await-in-loop
    await createGroupComboItems(person, data);
  }

  return { data: { bookings: created }, error: null };
}

// (booking-details-assignment-modal, calendar's Rebook-reuse-as-reschedule
// branch), which intentionally creates a fresh booking row and cancels the
// original rather than mutating it in place. One DB transaction via
// reschedule_booking() (migration-243), replacing the old createBooking() +
// updateBookingStatus() two-call sequence, which left a double-booked slot
// behind if the cancel call failed after the create succeeded, and dropped
// discount/specialRequests/companion/referral fields because createBooking()
// always recomputes a fresh booking from scratch. The RPC copies every
// preservable field from the original row server-side instead.
export async function rescheduleBookingAsNewBooking({ bookingId, date, startTime, therapistId, roomId, reason, overrideReason }) {
  try {
    const { data, error } = await supabase.rpc('reschedule_booking', {
      p_override_reason: overrideReasonOf(overrideReason),
      p_booking_id: bookingId,
      p_date: date,
      p_start_time: startTime,
      p_therapist_id: therapistId || null,
      p_room_id: roomId || null,
      p_reason: reason || null,
    });
    if (error) {
      const availabilityErr = availabilityFailure(error);
      if (availabilityErr) return availabilityErr;
      throw error;
    }

    capture('staff_booking_rescheduled', { booking_id: bookingId, new_booking_id: data?.id });

    return { data: { id: data?.id, bookingNumber: data?.booking_number }, error: null };
  } catch (error) {
    console.error('[API] rescheduleBooking error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ── ZNLY-402 piece 5: booking-level, all-or-nothing calls (migration 430). One exported function per server function. ─────────────────────────────
// Every call returns { data, error }. A refusal is error { code, message, rows, overridable } with a plain-language message (never SQL text);
// `data` still carries the per-row verdicts ({ ok, dry_run, rows:[{booking_id, booking_number, service, start, staff, verdict, reason}], totals }).
// dryRun: true changes nothing and returns exactly what WOULD happen. code NEEDS_OVERRIDE = a manager/admin may repeat the call with overrideReason.
// visit_update / visit_set_staff answer COMBO_USE_SINGLE_EDIT / MULTI_STAFF_USE_SINGLE_EDIT for a booking they cannot cover yet; the wrappers then run
// TODAY'S single-booking paths (updateBookingDetails / assignTherapist / updateBookingStatus) so editing is never worse than before.
const VISIT_SINGLE_EDIT_CODES = ['COMBO_USE_SINGLE_EDIT', 'MULTI_STAFF_USE_SINGLE_EDIT'];
async function visitCall(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { data: null, error: plainError(error) };
    if (data && data.ok === false) {
      const e = data.error || {};
      return {
        data,
        error: {
          code: e.code || data.code || 'REFUSED',
          message: e.message || data.message || 'This could not be saved. Nothing was changed.',
          rows: data.rows || [],
          overridable: (e.code || data.code) === 'NEEDS_OVERRIDE',
          plain: true,
          refusal: true, // a plain-sentence refusal written by the server (not a crash): the guidance card shows its own message
        },
      };
    }
    return { data, error: null };
  } catch (error) {
    console.error(`[API] ${fn} error:`, error.message);
    return { data: null, error: plainError(error) };
  }
}

export function visitCreate({ branchId, customer, services, overrideReason = null, dryRun = false }) {
  const c = { ...(customer || {}) };
  if (c.phone) c.phone = toE164(c.phone);
  const svcs = (services || []).map((s) => ({ ...s, override_reason: overrideReasonOf(s.override_reason) || undefined }));
  return visitCall('visit_create', { p_branch_id: resolveBranchId(branchId), p_customer: c, p_services: svcs, p_override_reason: overrideReasonOf(overrideReason), p_dry_run: !!dryRun });
}

export async function visitUpdate({ visitKey, changes, overrideReason = null, dryRun = false }) {
  const res = await visitCall('visit_update', { p_visit_key: visitKey, p_changes: changes, p_override_reason: overrideReasonOf(overrideReason), p_dry_run: !!dryRun });
  if (res.error && VISIT_SINGLE_EDIT_CODES.includes(res.error.code)) {
    if (dryRun) return { data: { ok: true, dry_run: true, routed: 'single', rows: [], totals: {} }, error: null };
    return visitUpdateViaSingleEdits({ changes, overrideReason });
  }
  return res;
}

// Today's per-booking path for a combo / multi-staff booking: the same calls the old Edit form made, one booking at a time.
async function visitUpdateViaSingleEdits({ changes, overrideReason }) {
  for (const line of changes?.services || []) {
    if (!line.booking_id) return { data: null, error: { code: 'ADD_NOT_ALLOWED', message: 'A service cannot be added to this kind of booking here.', plain: true } };
    if (line.remove) {
      // eslint-disable-next-line no-await-in-loop
      const r = await updateBookingStatus({ bookingId: line.booking_id, newStatus: 'Cancelled', reason: line.remove_reason || line.reason });
      if (r.error) return r;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const d = await updateBookingDetails({
      bookingId: line.booking_id, serviceId: line.service_id || undefined, date: line.date || changes.date || undefined, startTime: line.start_time || undefined,
      specialRequests: changes.special_requests, referredBy: changes.referred_by, overrideReason,
    });
    if (d.error) return d;
    if (line.therapist_ids !== undefined || line.room_id !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      const a = await assignTherapist({
        bookingId: line.booking_id, therapistIds: line.therapist_ids || [],
        roomId: line.room_id === undefined ? undefined : (line.room_id === 'none' ? null : line.room_id), overrideReason,
      });
      if (a.error) return a;
    }
  }
  return { data: { ok: true, dry_run: false, routed: 'single', rows: [], totals: {} }, error: null };
}

export const visitSetStatus = ({ visitKey, status, reason = null, dryRun = false }) =>
  visitCall('visit_set_status', { p_visit_key: visitKey, p_status: status, p_reason: reason, p_dry_run: !!dryRun });

export const visitRemoveService = ({ bookingId, reason = null, dryRun = false }) =>
  visitCall('visit_remove_service', { p_booking_id: bookingId, p_reason: reason, p_dry_run: !!dryRun });

export const visitReschedule = ({ visitKey, date, startTime, overrideReason = null, reason = 'Rescheduled', dryRun = false }) =>
  visitCall('visit_reschedule', { p_visit_key: visitKey, p_date: date, p_start_time: startTime, p_override_reason: overrideReasonOf(overrideReason), p_reason: reason, p_dry_run: !!dryRun });

// lines: [{ booking_id, type: '%' | 'NPR', value }]; value 0 / blank clears that row. requestedTo = the approver when a line is over the role's limit.
export const visitApplyDiscount = ({ visitKey, lines, reason, requestedTo = null, dryRun = false }) =>
  visitCall('visit_apply_discount', { p_visit_key: visitKey, p_lines: lines, p_reason: reason ?? null, p_requested_to: requestedTo, p_dry_run: !!dryRun });

// lines: [{ booking_id, therapist_id, room_id }]; notes (when not undefined) replaces the special requests of the whole booking.
export async function visitSetStaff({ visitKey, lines, notes, overrideReason = null, dryRun = false }) {
  const res = await visitCall('visit_set_staff', { p_visit_key: visitKey, p_lines: lines, p_notes: notes === undefined ? null : notes, p_override_reason: overrideReasonOf(overrideReason), p_dry_run: !!dryRun });
  if (res.error && VISIT_SINGLE_EDIT_CODES.includes(res.error.code)) {
    if (dryRun) return { data: { ok: true, dry_run: true, routed: 'single', rows: [], totals: {} }, error: null };
    for (const line of lines || []) {
      // eslint-disable-next-line no-await-in-loop
      const a = await assignTherapist({
        bookingId: line.booking_id, therapistIds: line.therapist_id ? [line.therapist_id] : [],
        roomId: line.room_id === undefined ? undefined : (line.room_id === 'none' ? null : line.room_id), overrideReason,
      });
      if (a.error) return a;
    }
    if (notes !== undefined) {
      for (const line of lines || []) {
        // eslint-disable-next-line no-await-in-loop
        const d = await updateBookingDetails({ bookingId: line.booking_id, specialRequests: notes });
        if (d.error) return d;
      }
    }
    return { data: { ok: true, dry_run: false, routed: 'single', rows: [], totals: {} }, error: null };
  }
  return res;
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
      return { data: null, error: { code: 'DUPLICATE_NAME', message: `A room with this name already exists in this ${wordBranch()}.` } };
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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot manage rooms outside your ${wordBranch()}.` } };
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
      return { data: null, error: { code: 'DUPLICATE_NAME', message: `A room with this name already exists in this ${wordBranch()}.` } };
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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot manage rooms outside your ${wordBranch()}.` } };
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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot delete rooms outside your ${wordBranch()}.` } };
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

// Service↔staff eligibility allow-list (migration-249), per-branch since migration-257/258:
// storage is still a flat org-wide table, but meaning is per-branch, so every reader has to
// filter by branch itself. Pass branchId to get this branch's rows only (empty/no rows means
// unrestricted AT THIS BRANCH); omit it only for callers that genuinely need the raw org-wide
// set (none currently do — every caller should pass a branch).
// therapists!inner(branch_id) keeps the embed an inner join so rows for a different branch's
// therapist drop out entirely rather than coming back with a null-filled embed. branch_id is
// already granted to anon by migration-256, and this runs for staff and anon alike (createBooking),
// so the embed is safe under that column grant.
export async function fetchServiceTherapists(serviceId, branchId) {
  try {
    let query = supabase
      .from('service_therapists')
      .select('therapist_id, therapists!inner(branch_id)')
      .eq('service_id', serviceId);
    if (branchId) query = query.eq('therapists.branch_id', branchId);

    const { data, error } = await query;

    if (error) throw error;
    return { data: (data || []).map(r => r.therapist_id), error: null };
  } catch (error) {
    console.error('[API] fetchServiceTherapists error:', error.message);
    return { data: null, error };
  }
}

// Delegates the replace to set_service_therapists (migration-253) instead of a
// client-side delete-then-insert: that pair had no transaction, so an insert
// failure after the delete committed silently flipped the service from
// restricted to unrestricted, with no caller ever checking the result. The RPC
// does both statements inside one function invocation, so a failure rolls
// back the delete too.
export async function setServiceTherapists(serviceId, therapistIds, branchId) {
  try {
    const ids = (therapistIds || []).filter(Boolean);
    const { data, error } = await supabase.rpc('set_service_therapists', {
      p_service_id: serviceId,
      p_therapist_ids: ids,
      p_branch_id: branchId,
    });
    if (error) throw error;
    return { data: ids, error: null };
  } catch (error) {
    console.error('[API] setServiceTherapists error:', error.message);
    return { data: null, error };
  }
}

// ZNLY-185: which branches a service is restricted to (branch_service_links,
// migration-312). Empty result = Overall (visible at every branch) — mirrors
// fetchServiceTherapists' own "no rows = unrestricted" convention.
export async function fetchServiceBranches(serviceId) {
  try {
    const { data, error } = await supabase
      .from('branch_service_links')
      .select('branch_id')
      .eq('service_id', serviceId);

    if (error) throw error;
    return { data: (data || []).map((r) => r.branch_id), error: null };
  } catch (error) {
    console.error('[API] fetchServiceBranches error:', error.message);
    return { data: null, error };
  }
}

// Delegates the replace to set_service_branches (migration-312), same atomic
// delete-then-insert pattern as setServiceTherapists. branchIds = [] clears the
// service back to Overall.
export async function setServiceBranches(serviceId, branchIds) {
  try {
    const ids = (branchIds || []).filter(Boolean);
    const { data, error } = await supabase.rpc('set_service_branches', {
      p_service_id: serviceId,
      p_branch_ids: ids,
    });
    if (error) throw error;
    return { data: ids, error: null };
  } catch (error) {
    console.error('[API] setServiceBranches error:', error.message);
    return { data: null, error };
  }
}

// Reverse of fetchServiceTherapists: for a given therapist, which of the branch's
// active services are restricted (have any eligibility rows at all) and, for
// restricted ones, whether this therapist is in the allow-list. Unrestricted
// services (no rows) are returned with isRestricted:false and isEligible:true,
// since "no rows = everyone eligible" per migration-249. Unchecking one of
// these here calls excludeTherapistFromService, not toggleTherapistServiceEligibility
// — it must materialize the full allow-list (everyone but this therapist),
// not just add this therapist, or it would silently restrict the service to
// them alone.
export async function fetchServicesForTherapist(therapistId, branchId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };

    const [servicesResult, eligibilityResult] = await Promise.all([
      supabase
        .from('services')
        .select('id, name, is_active')
        .eq('org_id', profile.org_id)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('service_therapists')
        .select('service_id, therapist_id, therapists!inner(branch_id)')
        .eq('therapists.branch_id', branchId),
    ]);

    if (servicesResult.error) throw servicesResult.error;
    if (eligibilityResult.error) throw eligibilityResult.error;

    const restrictedServiceIds = new Set();
    const eligibleServiceIdsForTherapist = new Set();
    (eligibilityResult.data || []).forEach(row => {
      restrictedServiceIds.add(row.service_id);
      if (row.therapist_id === therapistId) eligibleServiceIdsForTherapist.add(row.service_id);
    });

    const data = (servicesResult.data || []).map(s => {
      const isRestricted = restrictedServiceIds.has(s.id);
      return {
        id: s.id,
        name: s.name,
        isRestricted,
        isEligible: isRestricted ? eligibleServiceIdsForTherapist.has(s.id) : true,
      };
    });

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchServicesForTherapist error:', error.message);
    return { data: null, error };
  }
}

// Toggles a single therapist in/out of an already-restricted service's
// eligibility list. Only meaningful for services that already have at least
// one eligibility row (see fetchServicesForTherapist) — does not create a
// restriction on a currently-unrestricted service.
export async function toggleTherapistServiceEligibility(serviceId, therapistId, eligible) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    if (eligible) {
      const { error } = await supabase
        .from('service_therapists')
        .upsert({ service_id: serviceId, therapist_id: therapistId }, { onConflict: 'service_id,therapist_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('service_therapists')
        .delete()
        .eq('service_id', serviceId)
        .eq('therapist_id', therapistId);
      if (error) throw error;
    }

    return { data: { serviceId, therapistId, eligible }, error: null };
  } catch (error) {
    console.error('[API] toggleTherapistServiceEligibility error:', error.message);
    return { data: null, error };
  }
}

// Excludes one therapist from one or more currently-unrestricted services
// while keeping each open to every other active therapist in the branch —
// materializes the "empty allow-list = everyone eligible" state into an
// explicit allow-list covering everyone but therapistId, rather than only
// adding therapistId (which would silently narrow the service down to just
// them). Used when a staff member's service checkbox is unchecked for a
// service that doesn't yet have an eligibility list. Fetches the branch's
// other active therapists once regardless of serviceIds.length, so bulk
// callers (e.g. "Select all") issue one query + one upsert instead of one
// of each per service.
export async function excludeTherapistFromServices(serviceIds, branchId, therapistId) {
  try {
    const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
    if (ids.length === 0) return { data: [], error: null };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const { data: therapists, error: therapistsError } = await supabase
      .from('therapists')
      .select('id')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .neq('id', therapistId);
    if (therapistsError) throw therapistsError;

    const otherTherapistIds = (therapists || []).map(t => t.id);
    const rows = ids.flatMap(serviceId => otherTherapistIds.map(tid => ({ service_id: serviceId, therapist_id: tid })));
    if (rows.length > 0) {
      const { error } = await supabase
        .from('service_therapists')
        .upsert(rows, { onConflict: 'service_id,therapist_id' });
      if (error) throw error;
    }

    return { data: ids.map(serviceId => ({ serviceId, excludedTherapistId: therapistId })), error: null };
  } catch (error) {
    console.error('[API] excludeTherapistFromServices error:', error.message);
    return { data: null, error };
  }
}

export async function excludeTherapistFromService(serviceId, branchId, therapistId) {
  const result = await excludeTherapistFromServices([serviceId], branchId, therapistId);
  if (result.error) return { data: null, error: result.error };
  return { data: result.data[0], error: null };
}

// Shared "empty allow-list = unrestricted" eligibility filter, used both at booking-creation
// time (createBooking) and in the manual reassignment UI (TherapistAssignmentPanel).
export function filterEligibleTherapists(therapists, eligibleTherapistIds) {
  if (!eligibleTherapistIds || eligibleTherapistIds.length === 0) return therapists;
  const eligibleSet = new Set(eligibleTherapistIds);
  return (therapists || []).filter(t => eligibleSet.has(t.id ?? t.therapistId));
}

export async function fetchTherapistsForManagement(branchId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // admin_viewer may read the list (RLS allows the SELECT; writes stay manager/admin-only).
    if (!['manager', 'admin', 'admin_viewer'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!effectiveBranchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    let query = supabase
      .from('therapists')
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at, display_order, photo_url, bio, experience_years, rating')
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

// Therapists list (V28): everything the list, its Today strip and the peek panel need, in a handful of batched reads (no per-therapist
// queries): staff, weekly hours + breaks, this week's roster overrides, today's attendance, today's bookings (with shared / combo
// slices), who may do which service, and (managers / admins only) pay rates. Shaping is in services/therapistsOverview.js.
// `date` is the Nepal "today" (YYYY-MM-DD); the week is Monday..Sunday around it.
export async function fetchTherapistsOverview(branchId, date) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin', 'admin_viewer'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }
    const scopeBranch = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!scopeBranch) return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    // Overall: the per-branch reads (shift RPC, closed dates, transfers) cannot take the sentinel, so they run once per branch of the org.
    const overall = isOverallBranch(scopeBranch);
    let branchIds = [scopeBranch];
    if (overall) {
      const { data: orgBranches, error: branchesError } = await fetchAllBranches();
      if (branchesError) throw branchesError;
      branchIds = (orgBranches || []).map((b) => b.id);
    }
    // Pay rates follow Payroll's rule: admin (and admin_viewer, read-only) only. Managers and staff never get them, and staff_compensation is not even read for them.
    const canSeeRates = profile.role === 'admin' || profile.role === 'admin_viewer';
    const week = weekDatesOf(date);
    const rangeEnd = [week[6], addDaysStr(date, 8)].sort().pop(); // +8: "back Tue 09:00" looks a week ahead

    // admin_viewer cannot read working hours (RLS); the shift RPC is SECURITY DEFINER, so it is simply not asked for them.
    const rosterReadable = profile.role !== 'admin_viewer';
    const [therapists, shifts, attendance, bookings, links, services, comp] = await Promise.all([
      withBranch(supabase.from('therapists')
        .select('id, name, gender, position, is_service_staff, is_active, branch_id, display_order, phone, photo_url, rating, experience_years')
        .order('display_order').order('name'), scopeBranch),
      rosterReadable
        ? Promise.all(branchIds.map((id) => supabase.rpc('therapist_shifts_for_range', { p_branch_id: id, p_from_date: week[0], p_to_date: rangeEnd })))
          .then((rs) => ({ data: rs.flatMap((r, i) => (r.data || []).map((row) => ({ ...row, _branchId: branchIds[i] }))), error: rs.find((r) => r.error)?.error || null }))
        : Promise.resolve({ data: [], error: null }),
      withBranch(supabase.from('therapist_attendance').select('therapist_id, status, check_in_time, check_out_time').eq('date', date), scopeBranch),
      withBranch(supabase.from('bookings')
        .select('id, therapist_id, status, start_time, end_time, customer_name, service_name_snapshot, booking_therapists(therapist_id, start_time, end_time), booking_combo_items(therapist_id, start_time, end_time, service:services(name))')
        .eq('date', date).not('status', 'in', '("Cancelled","No Show")'), scopeBranch),
      pageAllRows(() => supabase.from('service_therapists').select('service_id, therapist_id').order('service_id').order('therapist_id')),
      supabase.from('services').select('id, name, is_active, requires_therapist').order('name'),
      canSeeRates
        ? withBranch(supabase.from('staff_compensation').select('therapist_id, monthly_salary, commission_rate, product_commission_rate, therapists!inner(branch_id)'), scopeBranch, 'therapists.branch_id')
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [therapists, shifts, attendance, bookings, services, comp]) if (r.error) throw r.error;
    // best effort: a failure just means "not closed"
    const closedBranchIds = new Set();
    await Promise.all(branchIds.map(async (id) => {
      const res = await fetchClosedDateRanges(id);
      if (isClosedDate(res.data, date)) closedBranchIds.add(id);
    }));

    // ZNLY-113: branch_id is the HOME branch and never flips for a temporary transfer, so the list is simply the home staff. Who is lent out
    // today / visiting today comes from the transfer windows (therapists_at_branch, one call per branch in scope).
    const dayStart = `${date}T00:00:00+05:45`;
    const dayEnd = `${addDaysStr(date, 1)}T00:00:00+05:45`;
    const nowMs = Date.now();
    const winRows = [];
    try {
      const rs = await Promise.all(branchIds.map((id) => supabase.rpc('therapists_at_branch', { p_branch_id: id, p_from: dayStart, p_to: dayEnd })));
      rs.forEach((r, i) => (r.data || []).forEach((w) => winRows.push({ ...w, branchId: branchIds[i] })));
    } catch { /* fail open: no windows, everyone reads as at home */ }
    // Windows that are open now or start later today; a window that already ended today is not shown.
    const live = winRows.filter((w) => w.transfer_id && w.window_to && new Date(w.window_to).getTime() > nowMs);
    const transferById = new Map();
    try {
      const ids = [...new Set(live.map((w) => w.transfer_id))];
      if (ids.length > 0) {
        const tr = await supabase.from('staff_transfers')
          .select(`id, from_branch_id, to_branch_id, effective_date, start_time, revert_at, applied, reverted, reverted_at, is_permanent,
            fromBranch:branches!staff_transfers_from_branch_id_fkey(name), toBranch:branches!staff_transfers_to_branch_id_fkey(name)`)
          .in('id', ids);
        if (!tr.error) (tr.data || []).forEach((r) => transferById.set(r.id, r));
      }
    } catch { /* fail open */ }
    const transferOf = (w) => {
      const r = transferById.get(w.transfer_id);
      if (!r) return null;
      // The window decides "now": a scheduled row is not applied yet, but its window may already be open, and vice versa.
      const input = toTransferInput({ ...r, applied: new Date(w.window_from).getTime() <= nowMs, reverted: false, fromBranch: r.fromBranch?.name || null, toBranch: r.toBranch?.name || null });
      return { r, input };
    };
    const lentById = new Map();     // home therapist -> their lent-out window
    const visitingIds = [];
    for (const w of live) {
      const tf = transferOf(w);
      if (!tf) continue;
      if (w.role_here === 'visiting') { if (!visitingIds.includes(w.therapist_id)) visitingIds.push(w.therapist_id); }
      else if (!lentById.has(w.therapist_id)) lentById.set(w.therapist_id, { w, ...tf });
    }
    const startedMs = (w) => new Date(w.window_from).getTime();
    const awayNow = (w) => startedMs(w) <= nowMs;
    // Visitors (non-Overall): their rows are not in the home list. RLS lets managers read other branches' therapists.
    let visitorRows = [];
    if (!overall && visitingIds.length > 0) {
      const vr = await supabase.from('therapists')
        .select('id, name, gender, position, is_service_staff, is_active, branch_id, display_order, phone, photo_url, rating, experience_years')
        .in('id', visitingIds);
      if (!vr.error) visitorRows = vr.data || [];
    }
    const visitingW = new Map(live.filter((w) => w.role_here === 'visiting').map((w) => [w.therapist_id, w]));
    // Shift rows: a visitor also comes back from the receiving branch's call. Overall must key HOME rows by therapist and never let a
    // visitor row replace the home row (ZNLY-114), so each branch's call only contributes the people whose home it is.
    const homeOf = new Map((therapists.data || []).map((t) => [t.id, t.branch_id]));
    const shiftRows = overall
      ? (shifts.data || []).filter((r) => homeOf.get(r.therapist_id) === r._branchId)
      : (shifts.data || []);

    const data = buildTherapistsOverview({
      therapists: [...(therapists.data || []), ...visitorRows.map((v) => ({ ...v, _visiting: true, now_at_branch_id: scopeBranch }))],
      shiftRows,
      attendanceRows: attendance.data || [],
      bookingRows: bookings.data || [],
      links: links || [],
      services: services.data || [],
      compRows: comp.data || [],
      branchClosedToday: closedBranchIds.has(scopeBranch),
      closedBranchIds,
    }, { date, nowTime: nepalNow().hm, canSeeRates });
    // admin_viewer has no SELECT policy on therapist_working_hours / staff_roster_overrides, so for them "no hours" means "can't read them".
    const shaped = data.therapists.map((t) => {
      if (t.visiting) {
        const tf = transferOf(visitingW.get(t.id));
        return tf ? { ...t, transfer: { input: tf.input, viewpoint: 'receiving', away: false } } : t;
      }
      const lent = lentById.get(t.id);
      if (!lent) return { ...t, nowAtBranchId: t.branchId };
      const away = awayNow(lent.w);
      return { ...t, nowAtBranchId: away ? lent.r.to_branch_id : t.branchId, transfer: { input: lent.input, viewpoint: 'home', away } };
    });
    data.therapists = shaped.filter((t) => !t.visiting);
    data.visitors = shaped.filter((t) => t.visiting);
    return { data: { ...data, canSeeRates, rosterReadable }, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistsOverview error:', error.message);
    return { data: null, error };
  }
}

// Delete pre-check (V28): how many bookings a therapist has, so the confirm can say "can't be deleted" BEFORE asking. Counts the same
// rows deleteTherapist's HAS_BOOKINGS guard looks at (bookings.therapist_id); upcoming = today or later and not cancelled / no-show.
export async function fetchTherapistBookingCounts({ therapistId, today }) {
  try {
    const total = await supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('therapist_id', therapistId);
    const upcoming = await supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('therapist_id', therapistId)
      .gte('date', today).not('status', 'in', '("Cancelled","No Show")');
    if (total.error) throw total.error;
    if (upcoming.error) throw upcoming.error;
    return { data: { total: total.count || 0, upcoming: upcoming.count || 0, past: (total.count || 0) - (upcoming.count || 0) }, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistBookingCounts error:', error.message);
    return { data: null, error };
  }
}

export async function createTherapist({ name, gender, specialties, position, isServiceStaff = true, branchId, photoUrl, bio, experienceYears, rating, phone, address, city, email, pronouns }) {
  try {
    name = toTitleCase(name);
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const effectiveBranchId = profile.role === 'manager' ? profile.branch_id : branchId;
    if (!effectiveBranchId || isOverallBranch(effectiveBranchId)) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Pick a branch to add this therapist to.' } };
    }

    // Check for duplicate name within branch
    const { data: existing } = await supabase
      .from('therapists')
      .select('id')
      .eq('branch_id', effectiveBranchId)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: `A therapist with this name already exists in this ${wordBranch()}.` } };
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
        photo_url: photoUrl || null,
        bio: bio || null,
        experience_years: experienceYears ?? null,
        rating: rating ?? null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        email: email || null,
        pronouns: pronouns || null,
      })
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at, display_order, photo_url, bio, experience_years, rating, phone, address, city, email, pronouns')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createTherapist error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

export async function updateTherapist({ therapistId, name, gender, specialties, position, isServiceStaff, photoUrl, bio, experienceYears, rating, phone, address, city, email, pronouns }) {
  try {
    name = toTitleCase(name);
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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot manage therapists outside your ${wordBranch()}.` } };
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
        return { data: null, error: { code: 'DUPLICATE_NAME', message: `A therapist with this name already exists in this ${wordBranch()}.` } };
      }
    }

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name.trim();
    if (gender !== undefined) updatePayload.gender = gender;
    if (specialties !== undefined) updatePayload.specialties = specialties;
    if (position !== undefined) updatePayload.position = position;
    if (isServiceStaff !== undefined) updatePayload.is_service_staff = isServiceStaff;
    if (photoUrl !== undefined) updatePayload.photo_url = photoUrl || null;
    if (bio !== undefined) updatePayload.bio = bio || null;
    if (experienceYears !== undefined) updatePayload.experience_years = experienceYears === '' ? null : experienceYears;
    if (rating !== undefined) updatePayload.rating = rating === '' ? null : rating;
    if (phone !== undefined) updatePayload.phone = phone || null;
    if (address !== undefined) updatePayload.address = address || null;
    if (city !== undefined) updatePayload.city = city || null;
    if (email !== undefined) updatePayload.email = email || null;
    if (pronouns !== undefined) updatePayload.pronouns = pronouns || null;

    const { data, error } = await supabase
      .from('therapists')
      .update(updatePayload)
      .eq('id', therapistId)
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at, photo_url, bio, experience_years, rating, phone, address, city, email, pronouns')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateTherapist error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// The temporary window of `therapistId` into one of the manager's branches (home + user_branches) that touches today, or null.
async function findVisitWindowForManager(profile, therapistId) {
  try {
    const ids = new Set([profile.branch_id].filter(Boolean));
    const ub = await supabase.from('user_branches').select('branch_id').eq('user_id', profile.id);
    (ub.data || []).forEach((r) => ids.add(r.branch_id));
    const day = nepalNow().today;
    const from = `${day}T00:00:00+05:45`;
    const to = `${addDaysStr(day, 1)}T00:00:00+05:45`;
    for (const branchId of ids) {
      const { data } = await supabase.rpc('therapists_at_branch', { p_branch_id: branchId, p_from: from, p_to: to });
      const w = (data || []).find((r) => r.therapist_id === therapistId && r.role_here === 'visiting');
      if (w) return { branchId, window: { from: w.window_from, to: w.window_to }, transferId: w.transfer_id };
    }
  } catch { /* fail closed */ }
  return null;
}

export async function fetchTherapistById(therapistId) {
  try {
    if (!therapistId) return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin', 'admin_viewer'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const { data, error } = await supabase
      .from('therapists')
      .select('id, name, gender, specialties, position, is_service_staff, branch_id, is_active, created_at, display_order, photo_url, bio, experience_years, rating, phone, address, city, email, pronouns')
      .eq('id', therapistId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found.' } };
      }
      throw error;
    }

    if (profile.role === 'manager' && data.branch_id !== profile.branch_id) {
      // ZNLY-113: a manager may read (never edit) a therapist visiting one of their branches today. Anything else stays an error.
      const visit = await findVisitWindowForManager(profile, data.id);
      if (!visit) return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot view therapists outside your ${wordBranch()}.` } };
      return { data: { ...data, visitingHere: visit }, error: null };
    }

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistById error:', error.message);
    return { data: null, error };
  }
}

const WORKING_HOURS_DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// therapist_working_hours_breaks rows -> UI shape. Module-scoped because both
// fetchTherapistWorkingHours (one therapist, staff-edit screen) and
// fetchBranchWorkingHours (whole branch, roster grid + calendar shading) return
// the same break shape and must stay identical.
const normalizeWorkingHourBreaks = (breaks) => (breaks || [])
  .slice()
  .sort((a, b) => a.sort_order - b.sort_order)
  .map(b => ({ id: b.id, name: b.name || '', startTime: b.start_time, endTime: b.end_time }));

export async function fetchTherapistWorkingHours(therapistId) {
  try {
    if (!therapistId) return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };

    const { data, error } = await supabase
      .from('therapist_working_hours')
      .select('id, therapist_id, day_of_week, start_time, end_time, is_day_off, therapist_working_hours_breaks(id, name, start_time, end_time, sort_order)')
      .eq('therapist_id', therapistId);

    if (error) throw error;

    const byDay = new Map((data || []).map(row => [row.day_of_week, row]));
    const normalized = WORKING_HOURS_DAY_LABELS.map((label, dayOfWeek) => {
      const row = byDay.get(dayOfWeek);
      return row
        ? { dayOfWeek, dayLabel: label, startTime: row.start_time, endTime: row.end_time, isDayOff: row.is_day_off, breaks: normalizeWorkingHourBreaks(row.therapist_working_hours_breaks) }
        : { dayOfWeek, dayLabel: label, startTime: null, endTime: null, isDayOff: true, breaks: [] };
    });

    return { data: normalized, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistWorkingHours error:', error.message);
    return { data: null, error };
  }
}

// rows: [{ dayOfWeek, startTime, endTime, isDayOff, breaks: [{ name, startTime, endTime }] }, ...]
// — one per weekday. Deliberate scope boundary: display only. Rendered as the
// calendar's per-column roster shading (fetchBranchWorkingHours ->
// services/rosterSchedule -> calendar/CalendarGrid), but still not read by any
// booking availability/conflict check (see migration-275's header comment).
export async function upsertTherapistWorkingHours(therapistId, rows) {
  try {
    if (!therapistId) return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot manage therapists outside your ${wordBranch()}.` } };
    }

    // dayOfWeek -> that day's breaks in chronological order. The validation loop
    // below already sorts each day's breaks to check them pairwise; the SAME sorted
    // array is what gets written, keyed here so the insert further down can reuse it.
    // Writing the caller's unsorted array with `sort_order: index` instead meant
    // adding a 3pm break and then a 10am one persisted them in entry order, and
    // fetchTherapistWorkingHours (which orders by sort_order) redisplayed them
    // reversed.
    const sortedBreaksByDay = new Map();

    for (const row of rows) {
      const breaks = row.breaks || [];
      const label = WORKING_HOURS_DAY_LABELS[row.dayOfWeek];

      if (!row.isDayOff && (!row.startTime || !row.endTime || row.startTime >= row.endTime)) {
        return { data: null, error: { code: 'INVALID_HOURS', message: `${label}: start time must be before end time.` } };
      }
      if (row.isDayOff && breaks.length > 0) {
        return { data: null, error: { code: 'INVALID_HOURS', message: `${label}: a day off cannot have breaks.` } };
      }

      const sortedBreaks = breaks.slice().sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      sortedBreaksByDay.set(row.dayOfWeek, sortedBreaks);
      for (let i = 0; i < sortedBreaks.length; i++) {
        const brk = sortedBreaks[i];
        if (!brk.startTime || !brk.endTime || brk.startTime >= brk.endTime) {
          return { data: null, error: { code: 'INVALID_HOURS', message: `${label}: break start must be before break end.` } };
        }
        if (brk.startTime < row.startTime || brk.endTime > row.endTime) {
          return { data: null, error: { code: 'INVALID_HOURS', message: `${label}: break must fall within the shift's hours.` } };
        }
        const next = sortedBreaks[i + 1];
        if (next && brk.endTime > next.startTime) {
          return { data: null, error: { code: 'INVALID_HOURS', message: `${label}: breaks cannot overlap.` } };
        }
      }
    }

    const payload = rows.map(row => ({
      therapist_id: therapistId,
      branch_id: therapist.branch_id,
      day_of_week: row.dayOfWeek,
      start_time: row.isDayOff ? null : row.startTime,
      end_time: row.isDayOff ? null : row.endTime,
      is_day_off: !!row.isDayOff,
    }));

    const { data, error } = await supabase
      .from('therapist_working_hours')
      .upsert(payload, { onConflict: 'therapist_id,day_of_week' })
      .select('id, therapist_id, day_of_week, start_time, end_time, is_day_off');

    if (error) throw error;

    // Breaks: diff against what is stored and write only what changed (insert / update / delete), so the audit log shows real
    // changes instead of a delete-everything-and-reinsert on every save.
    const byDay = new Map((data || []).map(row => [row.day_of_week, row]));
    const whIds = (data || []).map(r => r.id);
    const { data: existingAll, error: existingError } = whIds.length
      ? await supabase.from('therapist_working_hours_breaks').select('id, working_hours_id, name, start_time, end_time, sort_order').in('working_hours_id', whIds)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const hm = (t) => (t || '').slice(0, 5);
    for (const row of rows) {
      const whRow = byDay.get(row.dayOfWeek);
      if (!whRow) continue;
      const existing = (existingAll || []).filter(e => e.working_hours_id === whRow.id).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0));
      const wanted = (row.breaks || []).map((brk, index) => ({ name: brk.name || '', start: hm(brk.startTime), end: hm(brk.endTime), index }));
      // 1) untouched breaks stay exactly as they are
      const left = [];
      const keptIds = new Set();
      for (const w of wanted) {
        const hit = existing.find(e => !keptIds.has(e.id) && (e.name || '') === w.name && hm(e.start_time) === w.start && hm(e.end_time) === w.end);
        if (hit) keptIds.add(hit.id); else left.push(w);
      }
      const spare = existing.filter(e => !keptIds.has(e.id));
      // 2) changed breaks update in place (paired in order), extras insert, leftovers delete
      for (const w of left) {
        const old = spare.shift();
        if (old) {
          const { error: updError } = await supabase.from('therapist_working_hours_breaks')
            .update({ name: w.name, start_time: w.start, end_time: w.end, sort_order: w.index }).eq('id', old.id);
          if (updError) throw updError;
        } else {
          const { error: insError } = await supabase.from('therapist_working_hours_breaks')
            .insert({ working_hours_id: whRow.id, name: w.name, start_time: w.start, end_time: w.end, sort_order: w.index });
          if (insError) throw insError;
        }
      }
      if (spare.length > 0) {
        const { error: delError } = await supabase.from('therapist_working_hours_breaks').delete().in('id', spare.map(e => e.id));
        if (delError) throw delError;
      }
    }

    return { data, error: null };
  } catch (error) {
    console.error('[API] upsertTherapistWorkingHours error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// All therapists' recurring weekly hours for a branch in one query (therapist_working_hours.
// branch_id is denormalized — see migration-275), for the Roster grid's per-day defaults.
// Returns { data: Map<therapistId, Array<{dayOfWeek, startTime, endTime, isDayOff}>>, error }
export async function fetchBranchWorkingHours(branchId) {
  try {
    if (!branchId) return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };

    const { data, error } = await supabase
      .from('therapist_working_hours')
      .select('therapist_id, day_of_week, start_time, end_time, is_day_off, therapist_working_hours_breaks(name, start_time, end_time, sort_order)')
      .eq('branch_id', branchId);

    if (error) throw error;

    const byTherapist = new Map();
    (data || []).forEach(row => {
      if (!byTherapist.has(row.therapist_id)) byTherapist.set(row.therapist_id, []);
      byTherapist.get(row.therapist_id).push({
        dayOfWeek: row.day_of_week,
        startTime: row.start_time,
        endTime: row.end_time,
        isDayOff: row.is_day_off,
        breaks: (row.therapist_working_hours_breaks || [])
          .slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
          .map((b) => ({ name: b.name || '', startTime: String(b.start_time).slice(0, 5), endTime: String(b.end_time).slice(0, 5) })),
      });
    });

    return { data: byTherapist, error: null };
  } catch (error) {
    console.error('[API] fetchBranchWorkingHours error:', error.message);
    return { data: null, error };
  }
}

// Per-date overrides (migration-287) for every therapist in a branch across [startDate, endDate]
// (inclusive, "YYYY-MM-DD"), for the Roster grid. A date with no row here falls back to that
// therapist's normal weekly hours for its day-of-week (see fetchBranchWorkingHours above).
export async function fetchRosterOverrides({ branchId, startDate, endDate }) {
  try {
    if (!branchId) return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    if (!startDate || !endDate) return { data: null, error: { code: 'RANGE_REQUIRED', message: 'Date range is required.' } };

    const { data, error } = await supabase
      .from('staff_roster_overrides')
      .select('therapist_id, override_date, start_time, end_time, is_day_off, staff_roster_override_breaks(name, start_time, end_time, sort_order)')
      .eq('branch_id', branchId)
      .gte('override_date', startDate)
      .lte('override_date', endDate);

    if (error) throw error;

    const byKey = new Map();
    (data || []).forEach(row => {
      byKey.set(`${row.therapist_id}_${row.override_date}`, {
        therapistId: row.therapist_id,
        date: row.override_date,
        startTime: row.start_time,
        endTime: row.end_time,
        isDayOff: row.is_day_off,
        // breaks of that date change (migration-350); the calendar reads the same rows through the shift RPC
        breaks: (row.staff_roster_override_breaks || [])
          .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((b) => ({ name: b.name || '', startTime: String(b.start_time).slice(0, 5), endTime: String(b.end_time).slice(0, 5) })),
      });
    });

    return { data: byKey, error: null };
  } catch (error) {
    console.error('[API] fetchRosterOverrides error:', error.message);
    return { data: null, error };
  }
}

// overrides: [{ therapistId, date: 'YYYY-MM-DD', isDayOff, startTime, endTime, breaks?: [{ startTime, endTime, name? }] }, ...] — bulk
// upsert for the Roster grid's "Save roster" button. Same manager/admin + branch-ownership
// gating and start<end validation as upsertTherapistWorkingHours.
export async function upsertRosterOverrides(overrides) {
  try {
    if (!overrides || overrides.length === 0) return { data: [], error: null };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Insufficient permissions.' } };
    }

    const therapistIds = [...new Set(overrides.map(o => o.therapistId))];
    const { data: therapistRows, error: fetchError } = await supabase
      .from('therapists')
      .select('id, branch_id')
      .in('id', therapistIds);
    if (fetchError) throw fetchError;

    const branchById = new Map((therapistRows || []).map(t => [t.id, t.branch_id]));
    for (const id of therapistIds) {
      const branchId = branchById.get(id);
      if (!branchId) return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found.' } };
      if (profile.role === 'manager' && branchId !== profile.branch_id) {
        return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot manage therapists outside your ${wordBranch()}.` } };
      }
    }

    for (const o of overrides) {
      if (!o.isDayOff && (!o.startTime || !o.endTime || o.startTime >= o.endTime)) {
        return { data: null, error: { code: 'INVALID_HOURS', message: `${o.date}: start time must be before end time.` } };
      }
      for (const b of (o.isDayOff ? [] : (o.breaks || []))) {
        if (!b.startTime || !b.endTime || b.startTime >= b.endTime) {
          return { data: null, error: { code: 'INVALID_BREAK', message: `${o.date}: a break's start must be before its end.` } };
        }
        if (b.startTime < o.startTime || b.endTime > o.endTime) {
          return { data: null, error: { code: 'INVALID_BREAK', message: `${o.date}: breaks must sit inside the working hours.` } };
        }
      }
    }

    const payload = overrides.map(o => ({
      therapist_id: o.therapistId,
      branch_id: branchById.get(o.therapistId),
      override_date: o.date,
      start_time: o.isDayOff ? null : o.startTime,
      end_time: o.isDayOff ? null : o.endTime,
      is_day_off: !!o.isDayOff,
    }));

    const { data, error } = await supabase
      .from('staff_roster_overrides')
      .upsert(payload, { onConflict: 'therapist_id,override_date' })
      .select('id, therapist_id, override_date, start_time, end_time, is_day_off');

    if (error) throw error;

    // Breaks: replace the saved set for every date whose caller sent a `breaks` array (a day off keeps none).
    const idBy = new Map((data || []).map((r) => [`${r.therapist_id}_${r.override_date}`, r.id]));
    const touched = overrides.filter((o) => Array.isArray(o.breaks) || o.isDayOff).map((o) => idBy.get(`${o.therapistId}_${o.date}`)).filter(Boolean);
    if (touched.length > 0) {
      const { error: delErr } = await supabase.from('staff_roster_override_breaks').delete().in('roster_override_id', touched);
      if (delErr) throw delErr;
      const rows = overrides.filter((o) => !o.isDayOff && Array.isArray(o.breaks)).flatMap((o) => o.breaks.map((b, i) => ({
        roster_override_id: idBy.get(`${o.therapistId}_${o.date}`), name: b.name || null, start_time: b.startTime, end_time: b.endTime, sort_order: i,
      })));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('staff_roster_override_breaks').insert(rows);
        if (insErr) throw insErr;
      }
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] upsertRosterOverrides error:', error.message);
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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot manage therapists outside your ${wordBranch()}.` } };
    }

    // If deactivating, check for future bookings
    if (!isActive) {
      const today = nepalToday();
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
    return { data: null, error: plainError(error) };
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
      return { data: null, error: { code: 'UNAUTHORIZED', message: `Cannot delete therapists outside your ${wordBranch()}.` } };
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

    const { data: row } = await supabase
      .from('staff_transfers')
      .select('applied, effective_date, start_time')
      .eq('id', data)
      .single();

    return {
      data: {
        transferId: data,
        applied: row?.applied ?? null,
        effectiveDate: row?.effective_date ?? null,
        startTime: row?.start_time ?? null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] transferTherapist error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ============================================================
// Manual Blocks (supabase/migration-212) — Calendar "block time off"
// ============================================================

function transformBlockRow(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    branchId: row.branch_id,
    therapistId: row.therapist_id,
    roomId: row.room_id,
    blockDate: row.block_date,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    description: row.description,
    preventOnlineBooking: row.prevent_online_booking,
    recurrenceFreq: row.recurrence_freq,
    recurrenceInterval: row.recurrence_interval,
    recurrenceEndDate: row.recurrence_end_date,
    recurrenceCount: row.recurrence_count,
    seriesId: row.series_id,
    isCancelled: row.is_cancelled,
  };
}

export async function createBlock({
  orgId, branchId, therapistId = null, roomId = null, blockDate, startTime,
  durationMinutes, description = null, preventOnlineBooking = true,
  recurrenceFreq = null, recurrenceInterval = 1, recurrenceEndDate = null, recurrenceCount = null,
}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!orgId || !branchId) return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId and branchId are required.' } };
    if (!blockDate || !startTime) return { data: null, error: { code: 'INVALID_INPUT', message: 'A date and start time are required.' } };
    const duration = Number(durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { data: null, error: { code: 'INVALID_INPUT', message: 'Duration must be greater than zero.' } };
    }

    const isRecurring = !!recurrenceFreq;
    const { data, error } = await supabase
      .from('manual_blocks')
      .insert({
        org_id: orgId,
        branch_id: branchId,
        therapist_id: therapistId,
        room_id: roomId,
        block_date: blockDate,
        start_time: startTime,
        duration_minutes: duration,
        description: description?.trim() || null,
        prevent_online_booking: preventOnlineBooking,
        recurrence_freq: recurrenceFreq,
        recurrence_interval: recurrenceInterval || 1,
        recurrence_end_date: isRecurring ? recurrenceEndDate : null,
        recurrence_count: isRecurring ? recurrenceCount : null,
        series_id: isRecurring ? crypto.randomUUID() : null,
      })
      .select('id')
      .single();

    if (error) throw error;
    return { data: { id: data.id }, error: null };
  } catch (error) {
    console.error('[API] createBlock error:', error.message);
    return { data: null, error };
  }
}

// Full row for the Edit Block modal — the calendar's occurrence rows (from
// fetchBlocksForRange) carry only what's needed to render/gate, not the full recurrence
// rule (freq/interval/end date/count), which the edit form's Recurrence tab needs.
export async function fetchBlockById(blockId) {
  try {
    const { data, error } = await supabase
      .from('manual_blocks')
      .select('*')
      .eq('id', blockId)
      .single();
    if (error) throw error;
    return { data: transformBlockRow(data), error: null };
  } catch (error) {
    console.error('[API] fetchBlockById error:', error.message);
    return { data: null, error };
  }
}

// Fetches raw manual_blocks rows (+ their exceptions) whose recurrence could touch
// [startDate, endDate], expands them client-side via expandBlockOccurrences, and returns
// flat { ...occurrence, blockId, therapistId, roomId, description, preventOnlineBooking }
// rows ready for the calendar to render/gate against.
export async function fetchBlocksForRange(branchId, startDate, endDate) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);

    const { data: rows, error } = await supabase
      .from('manual_blocks')
      .select('*')
      .eq('branch_id', resolvedBranchId)
      .eq('is_cancelled', false)
      .lte('block_date', endDate)
      .or(`recurrence_freq.not.is.null,block_date.gte.${startDate}`);
    if (error) throw error;

    const blocks = (rows || []).map(transformBlockRow);
    const seriesIds = [...new Set(blocks.map(b => b.seriesId).filter(Boolean))];

    let exceptionsBySeriesId = {};
    if (seriesIds.length > 0) {
      const { data: exceptions, error: excError } = await supabase
        .from('manual_block_exceptions')
        .select('series_id, exception_date')
        .in('series_id', seriesIds);
      if (excError) throw excError;
      for (const e of (exceptions || [])) {
        (exceptionsBySeriesId[e.series_id] ||= []).push(e.exception_date);
      }
    }

    const occurrences = [];
    for (const block of blocks) {
      const exceptions = block.seriesId ? (exceptionsBySeriesId[block.seriesId] || []) : [];
      for (const occ of expandBlockOccurrences(block, exceptions, startDate, endDate)) {
        occurrences.push({
          ...occ,
          blockId: block.id,
          seriesId: block.seriesId,
          therapistId: block.therapistId,
          roomId: block.roomId,
          description: block.description,
          preventOnlineBooking: block.preventOnlineBooking,
        });
      }
    }
    return { data: occurrences, error: null };
  } catch (error) {
    console.error('[API] fetchBlocksForRange error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Closed Dates (Setup → "Closed dates" page) — a dedicated, Timely-style business-
// closure list built on the existing manual_blocks primitive rather than a new table.
// A "closed date" is recognized as a whole-location (no therapist/room), all-day
// (start_time 00:00, duration 1440) block — the exact shape AddBlockModal's "Whole
// location" + "Closed all day" options already produce. A multi-day range is just
// that block set to repeat daily through recurrence_end_date, reusing manual_blocks'
// existing recurrence machinery instead of inventing a start/end-date column.
// ============================================================

const CLOSED_DATE_START_TIME = '00:00:00';
const CLOSED_DATE_DURATION_MINUTES = 1440;

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  return Math.round((end - start) / 86400000) + 1;
}

export async function fetchClosedDateRanges(branchId) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);
    const { data, error } = await supabase
      .from('manual_blocks')
      .select('id, block_date, recurrence_end_date, recurrence_freq, description')
      .eq('branch_id', resolvedBranchId)
      .eq('is_cancelled', false)
      .is('therapist_id', null)
      .is('room_id', null)
      .eq('start_time', CLOSED_DATE_START_TIME)
      .eq('duration_minutes', CLOSED_DATE_DURATION_MINUTES)
      .order('block_date', { ascending: true });
    if (error) throw error;

    const ranges = (data || []).map(row => {
      const endDate = row.recurrence_freq ? (row.recurrence_end_date || row.block_date) : row.block_date;
      return {
        blockId: row.id,
        startDate: row.block_date,
        endDate,
        days: daysBetweenInclusive(row.block_date, endDate),
        description: row.description,
      };
    });
    return { data: ranges, error: null };
  } catch (error) {
    console.error('[API] fetchClosedDateRanges error:', error.message);
    return { data: null, error };
  }
}

// Customer-facing closed days (ZNLY-224). Anon can't read manual_blocks, so this goes through the public RPC
// (mig 390), which returns bare dates already expanded for recurrence. Consecutive dates merge into one
// { startDate, endDate } range, the same shape fetchClosedDateRanges returns for staff.
export async function fetchPublicClosedDateRanges(branchId, { days = 400 } = {}) {
  try {
    const resolvedBranchId = resolveBranchId(branchId);
    const start = nepalToday();
    const end = addDays(start, days);
    const { data, error } = await supabase.rpc('public_get_closed_dates', {
      p_branch_id: resolvedBranchId, p_start: start, p_end: end,
    });
    if (error) throw error;
    const dates = (data || []).map((r) => r.closed_date).sort();
    const ranges = [];
    for (const d of dates) {
      const last = ranges[ranges.length - 1];
      if (last && daysBetweenInclusive(last.endDate, d) === 2) { last.endDate = d; last.days += 1; }
      else ranges.push({ blockId: null, startDate: d, endDate: d, days: 1, description: null });
    }
    return { data: ranges, error: null };
  } catch (error) {
    console.error('[API] fetchPublicClosedDateRanges error:', error.message);
    return { data: null, error };
  }
}

export async function createClosedDateRange({ orgId, branchId, startDate, endDate, description }) {
  if (!startDate) return { data: null, error: { code: 'INVALID_INPUT', message: 'Start date is required.' } };
  const resolvedEnd = endDate || startDate;
  if (resolvedEnd < startDate) {
    return { data: null, error: { code: 'INVALID_INPUT', message: 'End date must be on or after the start date.' } };
  }
  const isRange = resolvedEnd !== startDate;

  return createBlock({
    orgId,
    branchId,
    blockDate: startDate,
    startTime: CLOSED_DATE_START_TIME,
    durationMinutes: CLOSED_DATE_DURATION_MINUTES,
    description,
    preventOnlineBooking: true,
    recurrenceFreq: isRange ? 'daily' : null,
    recurrenceInterval: 1,
    recurrenceEndDate: isRange ? resolvedEnd : null,
  });
}

// No edit-in-place — manual_blocks' recurrence_end_date isn't one of updateBlock's
// patchable fields, so "editing" a range is delete-then-recreate (see
// ClosedDatesPanel.jsx's handleSave).
export async function deleteClosedDateRange(blockId) {
  return deleteBlock({ blockId, scope: 'series' });
}

// scope: 'this' (cancel just this occurrence), 'following' (split the series — this row's
// recurrence ends the day before occurrenceDate, future occurrences come from a new row),
// or 'series' (cancel the whole thing, including past occurrences from view going forward).
export async function deleteBlock({ blockId, scope, occurrenceDate = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (scope === 'series') {
      const { error } = await supabase
        .from('manual_blocks')
        .update({ is_cancelled: true, cancelled_at: new Date().toISOString() })
        .eq('id', blockId);
      if (error) throw error;
      return { data: { ok: true }, error: null };
    }

    if (scope === 'this') {
      if (!occurrenceDate) return { data: null, error: { code: 'INVALID_INPUT', message: 'occurrenceDate is required.' } };
      const { data: block, error: fetchError } = await supabase
        .from('manual_blocks')
        .select('series_id, block_date, recurrence_freq')
        .eq('id', blockId)
        .single();
      if (fetchError) throw fetchError;

      if (!block.recurrence_freq) {
        const { error } = await supabase
          .from('manual_blocks')
          .update({ is_cancelled: true, cancelled_at: new Date().toISOString() })
          .eq('id', blockId);
        if (error) throw error;
        return { data: { ok: true }, error: null };
      }

      const { error } = await supabase
        .from('manual_block_exceptions')
        .insert({ series_id: block.series_id, exception_date: occurrenceDate });
      if (error) throw error;
      return { data: { ok: true }, error: null };
    }

    if (scope === 'following') {
      if (!occurrenceDate) return { data: null, error: { code: 'INVALID_INPUT', message: 'occurrenceDate is required.' } };
      const endDateStr = addDays(occurrenceDate, -1);

      const { error } = await supabase
        .from('manual_blocks')
        .update({ recurrence_end_date: endDateStr })
        .eq('id', blockId);
      if (error) throw error;
      return { data: { ok: true }, error: null };
    }

    return { data: null, error: { code: 'INVALID_INPUT', message: `Unknown scope: ${scope}` } };
  } catch (error) {
    console.error('[API] deleteBlock error:', error.message);
    return { data: null, error };
  }
}

// scope 'this'/'following' edits split the series exactly like deleteBlock's corresponding
// scopes, then insert a new row (new id, same series_id) carrying the edited fields from
// occurrenceDate onward. scope 'series' updates the row in place.
export async function updateBlock({ blockId, scope, occurrenceDate = null, ...fields }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data: existing, error: fetchError } = await supabase
      .from('manual_blocks')
      .select('*')
      .eq('id', blockId)
      .single();
    if (fetchError) throw fetchError;

    const patch = {};
    if (fields.description !== undefined) patch.description = fields.description?.trim() || null;
    if (fields.startTime !== undefined) patch.start_time = fields.startTime;
    if (fields.durationMinutes !== undefined) patch.duration_minutes = Number(fields.durationMinutes);
    if (fields.preventOnlineBooking !== undefined) patch.prevent_online_booking = fields.preventOnlineBooking;
    if (fields.therapistId !== undefined) patch.therapist_id = fields.therapistId;
    if (fields.roomId !== undefined) patch.room_id = fields.roomId;
    // Drag-to-reschedule moves the occurrence to a different day — distinct from
    // `occurrenceDate` (below), which always identifies the ORIGINAL occurrence being
    // acted on, not where it's moving to.
    if (fields.blockDate !== undefined) patch.block_date = fields.blockDate;

    if (scope === 'series') {
      const { error } = await supabase.from('manual_blocks').update(patch).eq('id', blockId);
      if (error) throw error;
      return { data: { ok: true }, error: null };
    }

    if (scope === 'this' || scope === 'following') {
      if (!occurrenceDate) return { data: null, error: { code: 'INVALID_INPUT', message: 'occurrenceDate is required.' } };

      if (!existing.recurrence_freq) {
        const { error } = await supabase.from('manual_blocks').update(patch).eq('id', blockId);
        if (error) throw error;
        return { data: { ok: true }, error: null };
      }

      if (scope === 'this') {
        const { error: excError } = await supabase
          .from('manual_block_exceptions')
          .insert({ series_id: existing.series_id, exception_date: occurrenceDate });
        if (excError) throw excError;

        const { error: insError } = await supabase.from('manual_blocks').insert({
          org_id: existing.org_id,
          branch_id: existing.branch_id,
          therapist_id: patch.therapist_id ?? existing.therapist_id,
          room_id: patch.room_id ?? existing.room_id,
          block_date: patch.block_date ?? occurrenceDate,
          start_time: patch.start_time ?? existing.start_time,
          duration_minutes: patch.duration_minutes ?? existing.duration_minutes,
          description: patch.description ?? existing.description,
          prevent_online_booking: patch.prevent_online_booking ?? existing.prevent_online_booking,
          recurrence_freq: null,
          series_id: null,
        });
        if (insError) throw insError;
        return { data: { ok: true }, error: null };
      }

      // scope === 'following': cap the existing series the day before occurrenceDate, then
      // insert a new row starting at occurrenceDate carrying the edited fields forward.
      const endDateStr = addDays(occurrenceDate, -1);

      const { error: capError } = await supabase
        .from('manual_blocks')
        .update({ recurrence_end_date: endDateStr })
        .eq('id', blockId);
      if (capError) throw capError;

      // The new row's occurrence counting restarts at n=0 from occurrenceDate, so a
      // verbatim-copied recurrence_count would double-count whatever the original series
      // already consumed before the split — subtract those off.
      const remainingCount = existing.recurrence_count != null
        ? Math.max(existing.recurrence_count - expandBlockOccurrences(transformBlockRow(existing), [], existing.block_date, endDateStr).length, 0)
        : null;

      const { error: insError } = await supabase.from('manual_blocks').insert({
        org_id: existing.org_id,
        branch_id: existing.branch_id,
        therapist_id: patch.therapist_id ?? existing.therapist_id,
        room_id: patch.room_id ?? existing.room_id,
        block_date: patch.block_date ?? occurrenceDate,
        start_time: patch.start_time ?? existing.start_time,
        duration_minutes: patch.duration_minutes ?? existing.duration_minutes,
        description: patch.description ?? existing.description,
        prevent_online_booking: patch.prevent_online_booking ?? existing.prevent_online_booking,
        recurrence_freq: existing.recurrence_freq,
        recurrence_interval: existing.recurrence_interval,
        recurrence_end_date: existing.recurrence_end_date,
        recurrence_count: remainingCount,
        series_id: existing.series_id,
      });
      if (insError) throw insError;
      return { data: { ok: true }, error: null };
    }

    return { data: null, error: { code: 'INVALID_INPUT', message: `Unknown scope: ${scope}` } };
  } catch (error) {
    console.error('[API] updateBlock error:', error.message);
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
        is_return_leg,
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
      isReturnLeg: t.is_return_leg,
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
 * Move an ACTIVE (applied, not yet reverted) transfer's scheduled return to a new, still-FUTURE
 * date/time — e.g. a 2-day transfer that only turns out to be needed for 1 day, so the manager
 * wants the staffer back tomorrow instead of waiting the full original duration. Distinct from
 * revertStaffTransferNow(), which only records a return that already happened (a past time).
 * The destination branch's manager, the origin branch's manager, or an admin may do this;
 * enforced server-side by reschedule_staff_transfer_return() (migration-165).
 */
export async function rescheduleStaffTransferReturn({ transferId, newRevertAt }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('reschedule_staff_transfer_return', {
      p_transfer_id: transferId,
      p_new_revert_at: new Date(newRevertAt).toISOString(),
    });

    if (error) throw error;
    capture('staff_transfer_return_rescheduled', { transfer_id: transferId });
    return { data: { revertAt: data }, error: null };
  } catch (error) {
    console.error('[API] rescheduleStaffTransferReturn error:', error.message);
    return { data: null, error };
  }
}

/**
 * End an ACTIVE (applied, not yet reverted) transfer right now — "Mark Returned Early" —
 * instead of waiting for the scheduled revert_at / the apply_due_staff_reverts() cron tick.
 * The destination branch's manager (whoever currently has the staffer), the origin branch's
 * manager, or an admin may do this; enforced server-side by revert_staff_transfer_now()
 * (migration-160, extended by migration-161 to accept an optional custom return timestamp,
 * migration-162 to widen authorization + guard against orphaning a live booking). Fails cleanly
 * if the transfer has already ended (race-safe — checked atomically server-side).
 *
 * @param {string} transferId
 * @param {Date|string} [revertedAt] - When the staffer actually returned, if not "right now".
 *   Must be in the past and before the transfer's scheduled revert_at (validated server-side).
 *   Omit to use the server's current time.
 */
export async function revertStaffTransferNow({ transferId, revertedAt } = {}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('revert_staff_transfer_now', {
      p_transfer_id: transferId,
      p_reverted_at: revertedAt ? new Date(revertedAt).toISOString() : null,
    });

    if (error) throw error;
    capture('staff_transfer_reverted_early', { transfer_id: transferId, custom_time: !!revertedAt });
    return { data: { revertedAt: data }, error: null };
  } catch (error) {
    console.error('[API] revertStaffTransferNow error:', error.message);
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
        therapist:therapists!staff_transfers_therapist_id_fkey(name),
        fromBranch:branches!staff_transfers_from_branch_id_fkey(name),
        toBranch:branches!staff_transfers_to_branch_id_fkey(name),
        transferredBy:users!staff_transfers_transferred_by_fkey(full_name)
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
        therapistName: t.therapist?.name || '—',
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
        transferredByName: t.transferredBy?.full_name || null,
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
      .from('services_with_offer_pricing')
      .select('id, name, duration_minutes, price_npr, description, image_url, category, is_couple, is_combo, is_active, created_at, offer_enabled, offer_type, offer_value, category_offer_enabled, category_offer_percent, effective_price_npr, is_on_offer, original_price_npr, active_campaign_name, bookable_online, is_addon, padding_before_minutes, padding_after_minutes, padding_after_type, requires_therapist, price_type')
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
    // Org-prefixed so storage RLS (migration-338) only lets this org's admins/managers write it.
    if (!profile.org_id) return { url: null, error: { code: 'NO_ORG', message: 'Your account is not linked to an organization.' } };
    const filePath = `${profile.org_id}/services/${fileName}`;

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

// Admin-only org branding image upload (Provider Profile's Logo/Hero), same bucket +
// validation as uploadStaffPhoto, path-prefixed per org since the bucket is shared
// across tenants. kind: 'logo' | 'hero' — only used for the storage path, not stored
// anywhere; callers persist the returned URL via updateOrgBranding.
export async function uploadOrgBrandingImage(kind, file) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { url: null, error: authError };

    if (profile.role !== 'admin') {
      return { url: null, error: { code: 'UNAUTHORIZED', message: 'Only admins can upload branding images.' } };
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { url: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 5MB.' } };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${kind}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    const filePath = `branding/${profile.org_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('service-images')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('service-images')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[API] uploadOrgBrandingImage error:', error.message);
    return { url: null, error };
  }
}

// Admin-only branch storefront photo upload (BranchGate's multi-branch picker tile,
// Setup → "Branch Photo"). Same bucket + validation as uploadOrgBrandingImage, but
// path-prefixed per branch within the org's branding folder since a branch's photo is
// distinct from the org-level logo/hero. Persist the returned URL via updateBranchPhoto.
export async function uploadBranchPhoto(branchId, file) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { url: null, error: authError };

    if (profile.role !== 'admin') {
      return { url: null, error: { code: 'UNAUTHORIZED', message: `Only admins can upload ${wordBranch()} photos.` } };
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { url: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 5MB.' } };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `branch-${resolveBranchId(branchId)}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    const filePath = `branding/${profile.org_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('service-images')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('service-images')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[API] uploadBranchPhoto error:', error.message);
    return { url: null, error };
  }
}

/**
 * Upload a staff photo to Supabase Storage.
 * Returns the public URL of the uploaded image.
 */
export async function uploadStaffPhoto(file) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { url: null, error: authError };

    if (!['admin', 'manager'].includes(profile.role)) {
      return { url: null, error: { code: 'UNAUTHORIZED', message: 'Only admins and managers can upload staff photos.' } };
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { url: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 5MB.' } };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    // Org-prefixed so storage RLS (migration-338) only lets this org's admins/managers write it.
    if (!profile.org_id) return { url: null, error: { code: 'NO_ORG', message: 'Your account is not linked to an organization.' } };
    const filePath = `${profile.org_id}/staff/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('service-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('service-images')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[API] uploadStaffPhoto error:', error.message);
    return { url: null, error };
  }
}

// Customer photos/documents live in the PRIVATE `customer-files` bucket (migration-339) at
// {org_id}/{branch_id}/customers/{customer_id}/{photos|documents}/{uuid}.{ext}. Rows store that storage_path, and the read
// functions put a short-lived signed URL into the same photo_url / file_url field the UI reads. Legacy rows (migration-280,
// public URL in photo_url/file_url, storage_path NULL) are returned unchanged.
const CUSTOMER_FILES_BUCKET = 'customer-files';
const CUSTOMER_FILE_URL_TTL = 3600;

const customerFilePath = (orgId, branchId, customerId, kind, file) => {
  const ext = (String(file.name || '').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${orgId}/${branchId}/customers/${customerId}/${kind}/${crypto.randomUUID()}.${ext}`;
};

// Swap each row's storage_path for a signed URL in `urlField` (one batch call). A signing failure leaves the URL null
// rather than failing the whole list. storage_path is dropped so callers see the same row shape as before.
async function withSignedCustomerFileUrls(rows, urlField) {
  const list = rows || [];
  const paths = list.map((r) => r.storage_path).filter(Boolean);
  let byPath = new Map();
  if (paths.length) {
    try {
      const { data, error } = await supabase.storage.from(CUSTOMER_FILES_BUCKET).createSignedUrls(paths, CUSTOMER_FILE_URL_TTL);
      if (error) throw error;
      byPath = new Map((data || []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
    } catch (err) {
      console.error('[API] customer file signing error:', err.message);
    }
  }
  return list.map(({ storage_path: path, ...row }) => (path ? { ...row, [urlField]: byPath.get(path) || null } : row));
}

const removeCustomerFiles = async (paths) => {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(CUSTOMER_FILES_BUCKET).remove(list);
  if (error) console.error('[API] customer file removal error:', error.message);
};

// Customer photo gallery (migration-280, storage moved by migration-339) — manager/admin upload/delete, staff can read
// within their branch, admin within their org. Path-prefixed per customer, since a customer can have multiple photos.
export async function uploadCustomerPhoto(customerId, branchId, file) {
  try {
    if (!customerId || !branchId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: `Customer ID and ${wordBranch()} ID are required.` } };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can upload customer photos.' } };
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { data: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }
    if (file.size > 2 * 1024 * 1024) {
      return { data: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 2.0MB.' } };
    }

    if (!profile.org_id) return { data: null, error: { code: 'NO_ORG', message: 'Your account is not linked to an organization.' } };
    const filePath = customerFilePath(profile.org_id, branchId, customerId, 'photos', file);

    const { error: uploadError } = await supabase.storage
      .from(CUSTOMER_FILES_BUCKET)
      .upload(filePath, file, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('customer_photos')
      .insert({ customer_id: customerId, branch_id: branchId, storage_path: filePath, uploaded_by: profile.id })
      .select('id, customer_id, photo_url, storage_path, uploaded_by, created_at')
      .single();
    if (error) {
      await removeCustomerFiles([filePath]);
      throw error;
    }

    const [row] = await withSignedCustomerFileUrls([data], 'photo_url');
    return { data: row, error: null };
  } catch (error) {
    console.error('[API] uploadCustomerPhoto error:', error.message);
    return { data: null, error };
  }
}

export async function fetchCustomerPhotos(customerId) {
  try {
    if (!customerId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('customer_photos')
      .select('id, customer_id, photo_url, storage_path, uploaded_by, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data: await withSignedCustomerFileUrls(data, 'photo_url'), error: null };
  } catch (error) {
    console.error('[API] fetchCustomerPhotos error:', error.message);
    return { data: null, error };
  }
}

export async function deleteCustomerPhoto(photoId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete customer photos.' } };
    }

    const { data: deleted, error } = await supabase.from('customer_photos').delete().eq('id', photoId).select('storage_path');
    if (error) throw error;
    await removeCustomerFiles((deleted || []).map((r) => r.storage_path));
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteCustomerPhoto error:', error.message);
    return { data: null, error };
  }
}

// Customer document attachments (migration-280) — same shape as customer
// photos, broader file-type allow-list.
export async function uploadCustomerDocument(customerId, branchId, file) {
  try {
    if (!customerId || !branchId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: `Customer ID and ${wordBranch()} ID are required.` } };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can upload customer documents.' } };
    }

    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return { data: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only PDF, Word documents, JPEG, PNG, and WebP files are allowed.' } };
    }
    if (file.size > 10 * 1024 * 1024) {
      return { data: null, error: { code: 'FILE_TOO_LARGE', message: 'File must be less than 10MB.' } };
    }

    if (!profile.org_id) return { data: null, error: { code: 'NO_ORG', message: 'Your account is not linked to an organization.' } };
    const filePath = customerFilePath(profile.org_id, branchId, customerId, 'documents', file);

    const { error: uploadError } = await supabase.storage
      .from(CUSTOMER_FILES_BUCKET)
      .upload(filePath, file, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('customer_documents')
      .insert({ customer_id: customerId, branch_id: branchId, storage_path: filePath, file_name: file.name, uploaded_by: profile.id })
      .select('id, customer_id, file_url, storage_path, file_name, uploaded_by, created_at')
      .single();
    if (error) {
      await removeCustomerFiles([filePath]);
      throw error;
    }

    const [row] = await withSignedCustomerFileUrls([data], 'file_url');
    return { data: row, error: null };
  } catch (error) {
    console.error('[API] uploadCustomerDocument error:', error.message);
    return { data: null, error };
  }
}

export async function fetchCustomerDocuments(customerId) {
  try {
    if (!customerId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('customer_documents')
      .select('id, customer_id, file_url, storage_path, file_name, uploaded_by, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data: await withSignedCustomerFileUrls(data, 'file_url'), error: null };
  } catch (error) {
    console.error('[API] fetchCustomerDocuments error:', error.message);
    return { data: null, error };
  }
}

export async function deleteCustomerDocument(documentId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete customer documents.' } };
    }

    const { data: deleted, error } = await supabase.from('customer_documents').delete().eq('id', documentId).select('storage_path');
    if (error) throw error;
    await removeCustomerFiles((deleted || []).map((r) => r.storage_path));
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteCustomerDocument error:', error.message);
    return { data: null, error };
  }
}

// Combo bundle membership (migration-288/289) — which services make up a combo
// service, plus the per-component defaults (default_timing: does this component
// start alongside the previous one or only after it ends; default_same_staff:
// prefill the booking's primary therapist for this component, or require picking
// a separate one) the booking flow uses to prefill `booking_combo_items` rows.
export async function fetchServiceComboComponents(serviceId) {
  try {
    if (!serviceId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('combo_package_components')
      .select('id, service_id, display_order, default_timing, default_same_staff, default_same_room, service:services!combo_package_components_service_id_fkey ( id, name, duration_minutes, price_npr )')
      .eq('combo_service_id', serviceId)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        componentId: r.id,
        serviceId: r.service_id,
        displayOrder: r.display_order,
        defaultTiming: r.default_timing,
        defaultSameStaff: r.default_same_staff,
        defaultSameRoom: r.default_same_room,
        service: r.service ? { id: r.service.id, name: r.service.name, durationMinutes: r.service.duration_minutes, priceNpr: Number(r.service.price_npr) } : null,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchServiceComboComponents error:', error.message);
    return { data: null, error };
  }
}

// Creates the per-component booking_combo_items rows for a combo booking, once the
// parent `bookings` row already exists (createBooking is used unmodified for that —
// the combo service's own flat duration_minutes/price still covers the whole slot;
// this just records which staff/time each bundled service actually gets, matching
// migration-288's schema). Computes each component's start offset anchored at the
// booking's own startTime, using the identical "concurrent starts alongside the
// previous component, sequential starts once everything so far has finished" rule
// the Service Detail page previews (see service-detail/index.jsx's schedule calc) —
// keep both in sync if that algorithm ever changes.
// components: [{ serviceId, componentId, defaultTiming, therapistId }] — therapistId
// already resolved by the caller (same as the booking's primary therapist, or a
// staff-picked override for a "different staff" component).
//
// orgSlug: pass this when calling from the anon/online booking flow (same convention
// as createBooking's own orgSlug param) — an anonymous customer has no `users` row,
// so getAuthenticatedUser() would always fail for them, and booking_combo_items has
// no anon INSERT policy anyway (migration-288 only grants staff org-scoped access).
// The orgSlug branch skips the staff-auth check and routes the actual insert through
// public_create_combo_booking_items (migration-310), a narrow SECURITY DEFINER RPC
// scoped to bookings created anonymously — everything else (offset/duration
// computation) is identical between the two paths.
export async function createComboBookingItems({ bookingId, branchId, date, startTime, roomId, components, overrideReason, orgSlug }) {
  try {
    const availabilityOverride = overrideReasonOf(overrideReason);
    if (!orgSlug) {
      const { error: authError } = await getAuthenticatedUser();
      if (authError) return { data: null, error: authError };
    }

    if (!bookingId) return { data: null, error: { code: 'INVALID_INPUT', message: 'bookingId is required.' } };
    if (!components || components.length === 0) return { data: [], error: null };

    const resolvedBranchId = resolveBranchId(branchId);

    // Need each component service's duration to compute offsets.
    const serviceIds = components.map((c) => c.serviceId);
    const { data: serviceRows, error: serviceError } = await supabase
      .from('services')
      .select('id, duration_minutes')
      .in('id', serviceIds);
    if (serviceError) throw serviceError;
    const durationById = {};
    (serviceRows || []).forEach((s) => { durationById[s.id] = s.duration_minutes; });

    const [startH, startM] = startTime.split(':').map(Number);
    let cursor = 0;
    let previousStart = 0;
    const rows = components.map((c, index) => {
      const duration = durationById[c.serviceId] || 0;
      const offset = c.defaultTiming === 'concurrent' ? previousStart : cursor;
      const end = offset + duration;
      cursor = Math.max(cursor, end);
      previousStart = offset;

      const totalMinutes = startH * 60 + startM + offset;
      const compStartTime = `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}:00`;

      return {
        booking_id: bookingId,
        component_id: c.componentId || null,
        service_id: c.serviceId,
        therapist_id: c.therapistId || null,
        room_id: c.roomId || roomId || null,
        display_order: index,
        date,
        start_time: compStartTime,
        commission_weight: 1,
        ...(availabilityOverride ? { availability_override_reason: availabilityOverride } : {}),
      };
    });

    if (orgSlug) {
      // The anon RPC prices each line itself (service_price_for_therapist,
      // migration-326) rather than trusting a client-supplied amount — an
      // anonymous insert is not a session worth trusting with its own price.
      const { data, error } = await supabase.rpc('public_create_combo_booking_items', {
        p_booking_id: bookingId,
        p_items: rows.map((r) => ({
          component_id: r.component_id,
          service_id: r.service_id,
          therapist_id: r.therapist_id,
          room_id: r.room_id,
          display_order: r.display_order,
          date: r.date,
          start_time: r.start_time,
        })),
      });
      if (error) throw error;
      return { data, error: null };
    }

    // Each line prices as its own service — the component's own price_type,
    // never the parent combo's (decided 2026-11-15: a combo line is a service
    // delivered by a therapist, exactly like a standalone booking of that same
    // service, so there is one pricing rule, not a parent rule and a child
    // rule that could disagree). service_price_for_therapist already resolves
    // tier price / Unassigned-rate fallback / plain fixed price / free's and
    // no_default's own price_npr (forced to 0 at the DB level for those two
    // types) in one COALESCE — no price_type branching needed here.
    const linePrices = await Promise.all(rows.map(async (r) => {
      const { data: price, error: priceErr } = await fetchServicePriceForTherapist(r.service_id, r.therapist_id);
      if (priceErr) throw priceErr;
      return price ?? 0;
    }));
    const pricedRows = rows.map((r, i) => ({ ...r, base_share_amount: linePrices[i] }));

    const { data, error } = await supabase
      .from('booking_combo_items')
      .insert(pricedRows)
      .select('id, service_id, therapist_id, room_id, start_time, end_time, base_share_amount');
    if (error) {
      const availabilityErr = availabilityFailure(error);
      if (availabilityErr) return availabilityErr;
      throw error;
    }
    if (availabilityOverride) await clearAvailabilityOverride(bookingId);

    // The combo's base_amount is the sum of its lines, full stop — the parent
    // combo service's own price_type no longer drives the total (same decision
    // as above). final_amount recomputes itself via the existing
    // compute_final_amount trigger once base_amount is written.
    const comboTotal = linePrices.reduce((sum, p) => sum + p, 0);
    const { error: totalErr } = await supabase
      .from('bookings')
      .update({ base_amount: comboTotal })
      .eq('id', bookingId);
    if (totalErr) throw totalErr;

    return { data, error: null };
  } catch (error) {
    console.error('[API] createComboBookingItems error:', error.message);
    return { data: null, error };
  }
}

// Atomic replace of a combo service's component list. Delegates to
// set_service_combo_components (migration-289), mirroring setServiceTherapists.
// components: [{ serviceId, displayOrder, defaultTiming, defaultSameStaff, defaultSameRoom }]
export async function setServiceComboComponents(comboServiceId, components) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const payload = (components || []).map((c, index) => ({
      service_id: c.serviceId,
      display_order: c.displayOrder != null ? c.displayOrder : index,
      default_timing: c.defaultTiming || 'sequential',
      default_same_staff: c.defaultSameStaff !== false,
      default_same_room: c.defaultSameRoom !== false,
    }));

    const { data, error } = await supabase.rpc('set_service_combo_components', {
      p_combo_service_id: comboServiceId,
      p_components: payload,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] setServiceComboComponents error:', error.message);
    return { data: null, error };
  }
}

// Which other services are offered as add-ons alongside this one (migration-291/292).
// Only services flagged is_addon=true are valid candidates — enforced by the UI's
// candidate list, not by this read.
export async function fetchServiceAddons(serviceId) {
  try {
    if (!serviceId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('service_addons')
      .select('addon_service_id, display_order')
      .eq('service_id', serviceId)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return { data: (data || []).map((r) => r.addon_service_id), error: null };
  } catch (error) {
    console.error('[API] fetchServiceAddons error:', error.message);
    return { data: null, error };
  }
}

export async function setServiceAddons(serviceId, addonServiceIds) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('set_service_addons', {
      p_service_id: serviceId,
      p_addon_service_ids: addonServiceIds || [],
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] setServiceAddons error:', error.message);
    return { data: null, error };
  }
}

const SERVICE_PRICE_TYPES = ['fixed', 'free', 'calendar_only', 'no_default', 'tiered'];

export async function createService({ name, priceNpr, priceType, durationMinutes, description, imageUrl, category, isCouple, isCombo, offerEnabled, offerType, offerValue, bookableOnline, isAddon, paddingBeforeMinutes, paddingAfterMinutes, paddingAfterType, requiresTherapist }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create services.' } };
    }

    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Service name is required.' } };
    }

    const resolvedPriceType = priceType || 'fixed';
    if (!SERVICE_PRICE_TYPES.includes(resolvedPriceType)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Invalid price type.' } };
    }
    // free/no_default carry no meaningful amount — services.price_npr still
    // needs SOME number (NOT NULL, no default-removal migration), so it's
    // pinned to 0 rather than asking the form for one that means nothing.
    // fixed/calendar_only/tiered all need a real amount — tiered's is the
    // Unassigned rate (migration-323), not a tier price.
    const resolvedPriceNpr = ['free', 'no_default'].includes(resolvedPriceType) ? 0 : priceNpr;
    if (['fixed', 'calendar_only', 'tiered'].includes(resolvedPriceType) && (!resolvedPriceNpr || resolvedPriceNpr <= 0)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Price must be a positive number.' } };
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

    const isOfferEnabled = !!offerEnabled;
    const { data, error } = await supabase
      .from('services')
      .insert({
        name: name.trim(),
        price_npr: resolvedPriceNpr,
        price_type: resolvedPriceType,
        duration_minutes: durationMinutes,
        description: description || null,
        image_url: imageUrl || null,
        category: category || 'General',
        is_couple: !!isCouple,
        is_combo: !!isCombo,
        is_active: true,
        org_id: profile.org_id,
        offer_enabled: isOfferEnabled,
        offer_type: isOfferEnabled ? offerType : null,
        offer_value: isOfferEnabled ? offerValue : null,
        bookable_online: bookableOnline !== undefined ? !!bookableOnline : true,
        is_addon: !!isAddon,
        padding_before_minutes: paddingBeforeMinutes || 0,
        padding_after_minutes: paddingAfterMinutes || 0,
        padding_after_type: paddingAfterType || 'padding',
        requires_therapist: requiresTherapist !== undefined ? !!requiresTherapist : true,
      })
      .select('id, name, duration_minutes, price_npr, price_type, description, image_url, category, is_couple, is_combo, is_active, created_at, offer_enabled, offer_type, offer_value, bookable_online, is_addon, padding_before_minutes, padding_after_minutes, padding_after_type, requires_therapist')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createService error:', error.message);
    return { data: null, error };
  }
}

export async function updateServicePricing({ serviceId, name, priceNpr, priceType, durationMinutes, description, imageUrl, category, isCouple, isCombo, offerEnabled, offerType, offerValue, bookableOnline, isAddon, paddingBeforeMinutes, paddingAfterMinutes, paddingAfterType, requiresTherapist }) {
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

    if (priceType !== undefined && !SERVICE_PRICE_TYPES.includes(priceType)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Invalid price type.' } };
    }
    // Same rule as createService: free/no_default carry no meaningful amount,
    // so price_npr is forced to 0 for them rather than trusting whatever the
    // form last held (e.g. a value typed before switching price type).
    const resolvedPriceNpr = priceType !== undefined && ['free', 'no_default'].includes(priceType) ? 0 : priceNpr;
    if (priceType !== undefined && ['fixed', 'calendar_only', 'tiered'].includes(priceType) && (!resolvedPriceNpr || resolvedPriceNpr <= 0)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Price must be a positive number.' } };
    }

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (priceType !== undefined) updatePayload.price_type = priceType;
    if (resolvedPriceNpr !== undefined) updatePayload.price_npr = resolvedPriceNpr;
    if (durationMinutes !== undefined) updatePayload.duration_minutes = durationMinutes;
    if (description !== undefined) updatePayload.description = description;
    if (imageUrl !== undefined) updatePayload.image_url = imageUrl;
    if (category !== undefined) updatePayload.category = category;
    if (isCouple !== undefined) updatePayload.is_couple = !!isCouple;
    if (isCombo !== undefined) updatePayload.is_combo = !!isCombo;
    if (offerEnabled !== undefined) {
      const isOfferEnabled = !!offerEnabled;
      updatePayload.offer_enabled = isOfferEnabled;
      updatePayload.offer_type = isOfferEnabled ? offerType : null;
      updatePayload.offer_value = isOfferEnabled ? offerValue : null;
    }
    if (bookableOnline !== undefined) updatePayload.bookable_online = !!bookableOnline;
    if (isAddon !== undefined) updatePayload.is_addon = !!isAddon;
    if (paddingBeforeMinutes !== undefined) updatePayload.padding_before_minutes = paddingBeforeMinutes || 0;
    if (paddingAfterMinutes !== undefined) updatePayload.padding_after_minutes = paddingAfterMinutes || 0;
    if (paddingAfterType !== undefined) updatePayload.padding_after_type = paddingAfterType || 'padding';
    if (requiresTherapist !== undefined) updatePayload.requires_therapist = !!requiresTherapist;

    if (Object.keys(updatePayload).length === 0) {
      return { data: null, error: { code: 'NO_CHANGES', message: 'No fields to update.' } };
    }

    const { data, error } = await supabase
      .from('services')
      .update(updatePayload)
      .eq('id', serviceId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .select('id, name, duration_minutes, price_npr, price_type, description, image_url, category, is_couple, is_active, offer_enabled, offer_type, offer_value, bookable_online, is_addon, padding_before_minutes, padding_after_minutes, padding_after_type, requires_therapist')
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
      const today = nepalToday();
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

// ZNLY-327: the customers this branch booked most recently (latest booking date/time first, ties by name), for the customer picker's
// "Recent customers". Returns { data: [customerId...] }; walk-ins have no customer. Reads recent bookings only, never the whole history.
export async function fetchRecentCustomerIds(branchId, limit = 8) {
  try {
    if (!branchId || isOverallBranch(branchId)) return { data: [], error: null };
    const { data, error } = await supabase
      .from('bookings')
      .select('customer_id, customer_name, date, start_time')
      .eq('branch_id', resolveBranchId(branchId))
      .not('customer_id', 'is', null)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false })
      .limit(300);
    if (error) throw error;
    const latest = new Map();
    for (const b of data || []) if (!latest.has(b.customer_id)) latest.set(b.customer_id, b);
    const ids = [...latest.values()]
      .sort((x, y) => (y.date + y.start_time).localeCompare(x.date + x.start_time) || String(x.customer_name).localeCompare(String(y.customer_name)))
      .slice(0, limit).map((b) => b.customer_id);
    return { data: ids, error: null };
  } catch (error) {
    return { data: [], error };
  }
}

export async function fetchCustomersLightweight(branchId) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    // Resolve the branch's org so autocomplete suggests the whole org's customers
    // (a returning cross-branch customer appears instead of being invisible).
    // The '__overall__' sentinel has no row in `branches` — resolve org from the
    // logged-in user's own profile instead of routing it through resolveBranchId,
    // which would silently coerce it to a hardcoded default branch (see
    // getCustomerIntelligence's identical guard).
    let orgId;
    if (isOverallBranch(branchId)) {
      const { profile, error: authError } = await getAuthenticatedUser();
      if (authError) return { data: null, error: authError };
      orgId = profile.org_id;
    } else {
      const resolvedBranchId = resolveBranchId(branchId);
      const { data: branch, error: branchErr } = await supabase
        .from('branches')
        .select('org_id')
        .eq('id', resolvedBranchId)
        .single();
      if (branchErr) throw branchErr;
      orgId = branch.org_id;
    }

    const pageAllCustomers = () => fetchAllPages((opts) =>
      supabase
        .from('customers')
        .select('id, full_name, phone, email, gender', opts)
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('full_name')
        .order('id') // tiebreaker — duplicate names exist
    );

    const [data, statusRes] = await Promise.all([
      pageAllCustomers(),
      MEMBERSHIP_ENABLED ? fetchMembershipStatus() : Promise.resolve({ data: [] }),
    ]);

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

// Change-history for the customer-detail Log tab. Reads audit_logs rows written
// by the trg_audit_customer_changes trigger (migration-297) — UPDATE/DELETE on
// customers (profile edits, block/unblock via is_active, merge coalesce) plus
// the explicit MERGE marker merge_customers() inserts. RLS already scopes this
// to manager/admin/admin_viewer within their own org (audit_logs' existing
// policies) — a staff viewer gets an empty result, not an error.
export async function fetchCustomerLog(customerId) {
  try {
    if (!customerId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, action_type, old_data, new_data, changed_at, changed_by, actor:users!changed_by(full_name)')
      .eq('table_name', 'customers')
      .eq('record_id', customerId)
      .order('changed_at', { ascending: false });
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        id: r.id,
        actionType: r.action_type,
        oldData: r.old_data,
        newData: r.new_data,
        changedAt: r.changed_at,
        actorName: r.actor?.full_name || null,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchCustomerLog error:', error.message);
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
      .select('id, branch_id, full_name, phone, email, notes, is_active, created_at, client_source, referred_by, preferred_language, country, occupation, additional_email, additional_phone, gender, pronouns, date_of_birth, tags')
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
        id, customer_id, booking_number, date, start_time, status, payment_status,
        final_amount, discount_amount,
        service_name_snapshot, therapist_id, therapist_name_snapshot,
        is_locked, payments(amount, payment_mode, created_at), payment_refunds(amount, created_at)
      `)
      .eq('customer_id', customerId)
      .order('date', { ascending: false });

    if (bookingsError) throw bookingsError;

    const all = bookings || [];

    // 2b. This customer's most recent membership, if any (tier/balance/status/expiry) —
    // same lookup already used at booking checkout (fetchMembershipForCustomer).
    const membershipResult = MEMBERSHIP_ENABLED
      ? await fetchMembershipForCustomer(customerId)
      : { data: null };
    const membership = membershipResult.data || null;

    // 3. Every figure comes from the same derivation the Customers list and panel use (one money model),
    // so this page cannot disagree with them. "Today" is Nepal wall-clock, never toISOString().
    const { today, hm: nowHM } = nepalNow();
    const row = buildCustomerDirectory({
      customers: [customer],
      bookings: all,
      today,
      nowHM,
    })[0];
    const toAppointmentSummary = (v) => v ? { date: v.date, serviceName: v.service || '—', therapistName: v.therapist || '' } : null;
    const lastAppointment = toAppointmentSummary(row.lastVisit);
    const nextAppointment = toAppointmentSummary(row.nextBooking);

    // 5. Build history list
    const history = all.map(b => ({
      bookingId: b.id,
      bookingNumber: b.booking_number,
      date: b.date,
      startTime: b.start_time,
      serviceName: b.service_name_snapshot || '—',
      therapistName: b.therapist_name_snapshot || '',
      // Every payment and refund with the moment it happened, so the Payments tab dates by when the money moved (not the visit).
      paymentEvents: (b.payments || []).map((x) => ({ amount: Number(x.amount || 0), mode: x.payment_mode || '', at: x.created_at })),
      refundEvents: (b.payment_refunds || []).map((x) => ({ amount: Number(x.amount || 0), at: x.created_at })),
      paidByMode: (b.payments || []).reduce((m, x) => { const k = x.payment_mode || 'Other'; m[k] = (m[k] || 0) + Number(x.amount || 0); return m; }, {}),
      paidTotal: (b.payments || []).reduce((t, x) => t + Number(x.amount || 0), 0),
      refundTotal: (b.payment_refunds || []).reduce((t, r) => t + Number(r.amount || 0), 0),
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
          branchId: customer.branch_id,
          fullName: customer.full_name,
          phone: customer.phone,
          email: customer.email,
          notes: customer.notes,
          isActive: customer.is_active,
          createdAt: customer.created_at,
          clientSource: customer.client_source,
          referredBy: customer.referred_by,
          preferredLanguage: customer.preferred_language,
          country: customer.country,
          occupation: customer.occupation,
          additionalEmail: customer.additional_email,
          additionalPhone: customer.additional_phone,
          gender: customer.gender,
          pronouns: customer.pronouns,
          dateOfBirth: customer.date_of_birth,
          tags: customer.tags || [],
        },
        stats: {
          completedVisits: row.completedVisits,
          totalRevenue: row.spent, // paid to date (payments − refunds)
          avgSpend: avgPaidPerVisit(all, { today }), // null when there are no rendered visits
          lastVisitDate: row.lastVisit?.date || null,
          amountOwing: row.balance, // owed now: rendered visits only
          segment: row.segment,
          vip: row.vip,
          // Straight from the same directory row (no new maths): the customer page's tiles and About card read these.
          upcoming: row.upcoming, // scheduled, not owed (price − paid)
          deposit: row.deposit, // already paid toward scheduled bookings
          lockedDue: row.lockedDue,
          unpaidVisits: row.unpaidVisits,
          lastVisit: row.lastVisit,
          nextBooking: row.nextBooking,
          usualTherapist: row.usualTherapist,
          usualTherapistVisits: row.usualTherapistVisits,
          favouriteService: row.favouriteService,
        },
        membership,
        history,
        lastAppointment,
        nextAppointment,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchCustomerProfile error:', error.message);
    return { data: null, error };
  }
}

// Staff-side: add/correct a customer's email or phone. Membership/voucher/
// package customers are frequently enrolled phone-only, so they have no way
// to reach the email-OTP-only customer portal until staff back-fill their
// email — surfaced inline from MembershipDetailModal/VoucherDetailModal/
// PackageDetailModal via CustomerContactQuickEdit. The RPC (migration-173)
// also repair-links any customer_accounts row that signed up before this
// email existed on the customer record.
export async function updateCustomerContact(customerId, { email = null, phone = null, fullName = null, notes = null } = {}) {
  try {
    if (!customerId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };

    const { data, error } = await supabase.rpc('staff_update_customer_contact', {
      p_customer_id: customerId,
      p_email: email,
      p_phone: phone,
      p_full_name: fullName,
      p_notes: notes,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateCustomerContact error:', error.message);
    if (error.code === '23505') {
      return { data: null, error: { code: 'DUPLICATE_PHONE', message: 'This phone number is already in use by another customer.' } };
    }
    return { data: null, error };
  }
}

// Staff-facing "Block" action on the customer detail page — toggles the
// same is_active flag every customer list already filters on
// (fetchCustomersLightweight etc.), so a blocked customer stops surfacing
// in search/autocomplete but keeps their full booking/payment history
// intact. Reversible (call again with isActive: true to unblock).
export async function setCustomerActive(customerId, isActive) {
  try {
    if (!customerId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can block customers.' } };
    }

    const { data, error } = await supabase
      .from('customers')
      .update({ is_active: isActive })
      .eq('id', customerId)
      .select('id, is_active')
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] setCustomerActive error:', error.message);
    return { data: null, error };
  }
}

// Staff-facing "Delete" action — a plain row delete, deliberately not a
// soft-delete/RPC. customers has no ON DELETE CASCADE from bookings (or
// memberships/packages/vouchers), so Postgres rejects this with a foreign-
// key violation (23503) for any customer with real history — caught below
// and turned into a message pointing at Block instead. Only succeeds for a
// customer with zero history (e.g. an accidental duplicate entry), which is
// the only case this is actually safe.
export async function deleteCustomer(customerId) {
  try {
    if (!customerId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };

    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    // Admin-only, own org (migration-340's DELETE policy).
    if (profile.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can delete customers.' } };
    }

    // Their photo/document rows cascade with the customer, but the files don't: collect the paths first and remove them
    // only after the delete succeeded. Best-effort — a failure here never fails the delete.
    const filePaths = [];
    try {
      const [{ data: photos }, { data: docs }] = await Promise.all([
        supabase.from('customer_photos').select('storage_path').eq('customer_id', customerId).not('storage_path', 'is', null),
        supabase.from('customer_documents').select('storage_path').eq('customer_id', customerId).not('storage_path', 'is', null),
      ]);
      [...(photos || []), ...(docs || [])].forEach((r) => filePaths.push(r.storage_path));
    } catch (err) {
      console.error('[API] deleteCustomer file lookup error:', err.message);
    }

    const { data: deleted, error } = await supabase.from('customers').delete().eq('id', customerId).select('id');
    if (error) {
      if (error.code === '23503') {
        return { data: null, error: { code: 'HAS_HISTORY', message: "This customer has bookings or other history, so they can't be deleted. Use Block instead." } };
      }
      throw error;
    }
    // RLS hides rows the caller may not delete, so a refused delete comes back as 0 rows, not an error.
    if (!deleted?.length) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can delete customers.' } };
    }
    if (filePaths.length) await removeCustomerFiles(filePaths).catch(() => {});
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteCustomer error:', error.message);
    return { data: null, error };
  }
}

// Staff-side: edit the Fresha-style extra profile fields (source, referral,
// language, country, occupation, additional contact, gender, pronouns, DOB,
// free-text tags). Plain table update under the existing row-level RLS —
// unlike updateCustomerContact, these fields have no customer_accounts
// email-linking behavior, so no RPC is needed.
export async function updateCustomerProfileDetails(customerId, {
  clientSource, referredBy, preferredLanguage, country, occupation,
  additionalEmail, additionalPhone, gender, pronouns, dateOfBirth, tags, notes,
} = {}) {
  try {
    if (!customerId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };

    const updatePayload = {};
    if (clientSource !== undefined) updatePayload.client_source = clientSource || null;
    if (referredBy !== undefined) updatePayload.referred_by = referredBy || null;
    if (preferredLanguage !== undefined) updatePayload.preferred_language = preferredLanguage || null;
    if (country !== undefined) updatePayload.country = country || null;
    if (occupation !== undefined) updatePayload.occupation = occupation || null;
    if (additionalEmail !== undefined) updatePayload.additional_email = additionalEmail || null;
    if (additionalPhone !== undefined) updatePayload.additional_phone = additionalPhone || null;
    if (gender !== undefined) updatePayload.gender = gender || null;
    if (pronouns !== undefined) updatePayload.pronouns = pronouns || null;
    if (dateOfBirth !== undefined) updatePayload.date_of_birth = dateOfBirth || null;
    if (tags !== undefined) updatePayload.tags = tags || [];
    if (notes !== undefined) updatePayload.notes = notes || null;

    const { data, error } = await supabase
      .from('customers')
      .update(updatePayload)
      .eq('id', customerId)
      .select('id, client_source, referred_by, preferred_language, country, occupation, additional_email, additional_phone, gender, pronouns, date_of_birth, tags, notes')
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateCustomerProfileDetails error:', error.message);
    return { data: null, error };
  }
}

// Staff-side: one customer's stored date of birth ("YYYY-MM-DD" or null). Plain read under the existing row-level RLS.
// The client record's own name (a walk-in booking that got a client linked keeps "Walk-in · Sahil" as its customer_name).
export async function fetchCustomerName(customerId) {
  try {
    if (!customerId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };
    const { data, error } = await supabase.from('customers').select('full_name').eq('id', customerId).maybeSingle();
    if (error) throw error;
    return { data: data?.full_name || null, error: null };
  } catch (error) {
    console.error('[API] fetchCustomerName error:', error.message);
    return { data: null, error };
  }
}

export async function fetchCustomerDateOfBirth(customerId) {
  try {
    if (!customerId) return { data: null, error: { code: 'CUSTOMER_REQUIRED', message: 'Customer ID is required.' } };
    const { data, error } = await supabase
      .from('customers')
      .select('date_of_birth')
      .eq('id', customerId)
      .maybeSingle();
    if (error) throw error;
    return { data: data?.date_of_birth || null, error: null };
  } catch (error) {
    console.error('[API] fetchCustomerDateOfBirth error:', error.message);
    return { data: null, error };
  }
}

export async function getCustomerIntelligence({ branchId }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    // This is a search/browse-for-an-existing-customer tool (matches full_name),
    // not a branch performance metric — org-wide, same as fetchCustomersLightweight,
    // so a customer who first visited a different branch isn't invisible here and
    // doesn't get duplicated. branchId is still required (resolves the org + keeps
    // the UI's branch-selector gate meaningful) but no longer restricts the result
    // set to that one branch.
    //
    // The "Overall" branch picker value (isOverallBranch) is a UI sentinel, not a
    // real branch — resolveBranchId has no knowledge of it and silently coerces it
    // to a hardcoded default branch (withBranch's own comment warns about exactly
    // this: "never route the sentinel through resolveBranchId — it would coerce to
    // a default branch"). That default happens to belong to Nuad Thai Spa, so any
    // other org selecting Overall here would have resolved to Nuad Thai Spa's
    // org_id and leaked its customers/bookings. Resolve the org from the logged-in
    // user's own profile instead whenever the sentinel is passed.
    let orgId;
    if (isOverallBranch(branchId)) {
      const { profile, error: authError } = await getAuthenticatedUser();
      if (authError) return { data: null, error: authError };
      orgId = profile.org_id;
    } else {
      const resolvedBranchId = resolveBranchId(branchId);
      const { data: branch, error: branchErr } = await supabase
        .from('branches')
        .select('org_id')
        .eq('id', resolvedBranchId)
        .single();
      if (branchErr) throw branchErr;
      orgId = branch.org_id;
    }

    const { data: orgBranches, error: orgBranchesErr } = await supabase
      .from('branches')
      .select('id')
      .eq('org_id', orgId);
    if (orgBranchesErr) throw orgBranchesErr;
    const orgBranchIds = (orgBranches || []).map((b) => b.id);

    // 1. Parallel fetch: customers + bookings, both org-wide, both paginated —
    // 2,798 customers and 8,562 bookings at Nuad Thai Spa alone, well past the
    // PostgREST 1000-row cap (see fetchAllPages above).
    // bookings has no org_id column — scope via the org's branch_id list instead.
    const [customers, bookings, statusResult] = await Promise.all([
      fetchAllPages((opts) =>
        supabase
          .from('customers')
          .select('id, full_name, phone, email, is_active, created_at', opts)
          .eq('org_id', orgId)
          .order('full_name')
          .order('id') // tiebreaker — 348 duplicate-name groups in prod
      ),
      fetchAllPages((opts) =>
        supabase
          .from('bookings')
          .select('customer_id, status, payment_status, final_amount, discount_amount, date, service_name_snapshot', opts)
          .not('customer_id', 'is', null)
          .in('branch_id', orgBranchIds)
          .order('id') // total order — see getOutstandingByStaff
      ),
      MEMBERSHIP_ENABLED ? fetchMembershipStatus() : Promise.resolve({ data: [] }),
    ]);
    // Same staff-safe status RPC (migration-087) + shape used by fetchCustomersLightweight —
    // status/tier only, readable regardless of role.
    const membershipByCustomer = new Map((statusResult.data || []).map((r) => [r.customerId, r]));

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
    const today = Date.parse(nepalToday()); // UTC midnight of the Nepal day; lastVisitDate below is a date string parsed the same way

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

      const m = membershipByCustomer.get(c.id);

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
        primaryMembership: m
          ? { id: m.membershipId, status: m.status, tierName: m.tierName, membershipNumber: m.membershipNumber }
          : null,
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

// Pages every row of a big table with .range() so PostgREST's 1,000-row cap never truncates it.
const pageAllRows = async (buildQuery) => {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
};

// The directory is computed in SQL (migration 419: customer_directory_page / customer_directory_summary), org-wide through the
// caller's RLS. "Today"/"now" come from the server's Nepal clock, never the browser's. The old version downloaded every customer and
// booking and derived all of this here; utils/customerDirectory.js stays the reference the parity test compares the SQL against.
const directoryArgs = ({ search, tab, segment, noMember, therapist, service, last, sort, dir, limit = PAGE_SIZE_DEFAULT, offset = 0, onlyId }) => ({
  p_search: search || null,
  p_tab: tab || 'all',
  p_segment: segment || null,
  p_no_member: !!noMember,
  p_therapist: therapist || null,
  p_service: service || null,
  p_last: last || null,
  p_sort: sort || 'next',
  p_dir: dir || null,
  p_limit: limit,
  p_offset: offset,
  p_only_id: onlyId || null,
  p_with_members: !!MEMBERSHIP_ENABLED,
});
const PAGE_SIZE_DEFAULT = 25;

/** One page of the Customers list (filter + search + sort + paging done in SQL). → { rows, total, today } */
export async function getCustomerDirectoryPage(opts = {}) {
  try {
    const { data, error } = await supabase.rpc('customer_directory_page', directoryArgs(opts));
    if (error) throw error;
    return { data: { rows: data?.rows || [], total: data?.total || 0, today: data?.today }, error: null };
  } catch (error) {
    console.error('[API] getCustomerDirectoryPage error:', error.message);
    return { data: null, error };
  }
}

/** Org-wide numbers around the list: tab counts, lifecycle mix, Spotlight inputs, filter options. → { tabs, mix, spotlight, therapists, services, today } */
export async function getCustomerDirectorySummary() {
  try {
    const { data, error } = await supabase.rpc('customer_directory_summary', { p_with_members: !!MEMBERSHIP_ENABLED });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] getCustomerDirectorySummary error:', error.message);
    return { data: null, error };
  }
}

// Side-panel detail for one customer (loaded lazily when the panel opens): their bookings (for now / upcoming / recent / owed /
// preferences, derived in utils/customerDirectory.buildPanelDetail) and what they hold prepaid: membership, packages, vouchers.
export async function getCustomerPanelDetail({ customerId, now = new Date() }) {
  try {
    const { today, hm } = nepalNow(now);
    const [bookingsRes, membershipRes, packagesRes, vouchersRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, booking_number, branch_id, status, date, start_time, end_time, service_name_snapshot, therapist_name_snapshot, room_name_snapshot, special_requests, final_amount, payment_status, is_locked, payments(amount), payment_refunds(amount)')
        .eq('customer_id', customerId)
        .order('date', { ascending: false })
        .limit(1000),
      MEMBERSHIP_ENABLED ? fetchMembershipForCustomer(customerId) : Promise.resolve({ data: null }),
      fetchPackages(customerId),
      VOUCHER_ENABLED ? fetchVouchers(customerId) : Promise.resolve({ data: [] }),
    ]);
    if (bookingsRes.error) throw bookingsRes.error;
    const detail = buildPanelDetail({ bookings: bookingsRes.data || [], today, nowHM: hm });
    const membership = membershipRes.data && ['active', 'pending'].includes(membershipRes.data.status) ? membershipRes.data : null;
    const packages = (packagesRes.data || []).filter((p) => p.sessionsRemaining > 0 && p.status !== 'expired' && (!p.expiryDate || p.expiryDate >= today));
    const vouchers = (vouchersRes.data || []).filter((v) => v.remainingBalance > 0 && (!v.expiryDate || v.expiryDate >= today));
    return { data: { ...detail, membership, packages, vouchers, today }, error: null };
  } catch (error) {
    console.error('[API] getCustomerPanelDetail error:', error.message);
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

    const today = date || nepalToday();

    // Date windows
    const sevenDaysAgo = addDays(today, -7);
    const fourteenDaysAgo = addDays(today, -14);
    const thirtyDaysAgo = addDays(today, -30);
    const sixtyDaysAgo = addDays(today, -60);

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
      .select('id, status, cancellation_reason')
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
    const noShow7d = last7dBookings.filter(isNoShow).length;
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

const VALID_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Annual Leave', 'Sick Leave', 'Day Off', '1st-Half Day', '2nd-Half Day'];

const isHalfDayStatus = (status) => status === '1st-Half Day' || status === '2nd-Half Day';

// Statuses that mean the staffer isn't working that day — not deducted from salary (see
// migration-151) and block booking assignment for the date, same as the legacy 'Leave' value
// (kept in the DB enum for historical rows but no longer offered as an entry option).
export const LEAVE_LIKE_ATTENDANCE_STATUSES = ['Leave', 'Annual Leave', 'Sick Leave', 'Day Off'];

// Paid-leave caps, per calendar year (Jan 1 – Dec 31 of the payroll period's year): Sick Leave
// and Annual Leave are only free of deduction up to these many days per year — anything beyond
// is deducted like Absent. Legacy 'Leave' rows and 'Day Off' are uncapped (always paid) — we
// can't retroactively split old 'Leave' rows into sick/annual, and Day Off has no cap per the
// 2026-09-03 spec. Bump these two numbers if the policy changes.
export const SICK_LEAVE_PAID_CAP_DAYS = 14;
export const ANNUAL_LEAVE_PAID_CAP_DAYS = 18;

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
    timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
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

    const targetDate = date || nepalToday();

    // Parallel: active therapists + attendance records. Attendance is one record per
    // (therapist_id, date) globally — not scoped by branch_id — so it's fetched unfiltered
    // by branch (a status marked at a therapist's prior branch, before a same-day transfer,
    // still shows up here) and joined in-memory against the branch-scoped therapist list below.
    let therapistsQuery = supabase
      .from('therapists')
      .select('id, name, is_service_staff, position')
      .eq('is_active', true)
      .order('name');
    therapistsQuery = withBranch(therapistsQuery, branchId);
    const attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status, check_in_time, check_out_time, notes, off_start, off_end, worked_at_branch_id')
      .eq('date', targetDate);
    const [therapistsResult, attendanceResult] = await Promise.all([therapistsQuery, attendanceQuery]);
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
        position: t.position || null,
        status: att?.status || null,
        checkInTime: formatTimeKathmandu(att?.check_in_time),
        checkOutTime: formatTimeKathmandu(att?.check_out_time),
        notes: att?.notes || null,
        workedAtBranchId: att?.worked_at_branch_id || null,
        offStart: att?.off_start ? String(att.off_start).slice(0, 5) : null,   // half day: exact off times (migration-350)
        offEnd: att?.off_end ? String(att.off_end).slice(0, 5) : null,
      };
    });

    return { data: merged, error: null };
  } catch (error) {
    console.error('[API] fetchAttendance error:', error.message);
    return { data: null, error };
  }
}

// Today's visitors at a branch with their check-in/out (mig 362). Times come back as 'HH:MM'.
export async function fetchVisitingAttendanceToday({ branchId }) {
  try {
    const { data, error } = await supabase.rpc('visiting_attendance_today', { p_branch_id: branchId });
    if (error) throw error;
    const map = {};
    (data || []).forEach((r) => {
      map[r.therapist_id] = { therapistId: r.therapist_id, therapistName: r.therapist_name, checkInTime: formatTimeKathmandu(r.check_in_time), checkOutTime: formatTimeKathmandu(r.check_out_time), workedAtBranchId: r.worked_at_branch_id, windowFrom: r.window_from, windowTo: r.window_to, punchCount: r.punch_count || 0, openPunchId: r.open_punch_id || null };
    });
    return { data: map, error: null };
  } catch (error) {
    console.error('[API] fetchVisitingAttendanceToday error:', error.message);
    return { data: null, error };
  }
}

// The receiving manager's check-in / check-out for a visitor: today only, nothing else (the RPC enforces it).
export async function markVisitorAttendance({ therapistId, branchId, checkInTime, checkOutTime, reason = null }) {
  try {
    const today = nepalNow().today;
    const { error } = await supabase.rpc('mark_visitor_attendance', {
      p_therapist_id: therapistId, p_branch_id: branchId,
      p_check_in: combineDateTimeKathmandu(today, checkInTime), p_check_out: combineDateTimeKathmandu(today, checkOutTime),
      p_reason: reason,
    });
    if (error) {
      if (error.code === 'P0007' || (error.message || '').includes('ATTENDANCE_REASON_REQUIRED')) {
        return { data: null, error: { code: 'ATTENDANCE_REASON_REQUIRED', message: 'A reason is required to change this record.' } };
      }
      if (error.code === 'P0004' || (error.message || '').includes('ATTENDANCE_DAY_LOCKED')) {
        return { data: null, error: { code: 'ATTENDANCE_DAY_LOCKED', message: 'This day has been closed. Attendance cannot be modified.' } };
      }
      throw error;
    }
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] markVisitorAttendance error:', error.message);
    return { data: null, error: { code: 'UNKNOWN_ERROR', message: friendlyError(error, 'Could not save attendance. Please try again.') } };
  }
}

// ── Attendance redesign (V34a/V34b, migration 364): every write goes through save_attendance / delete_attendance /
// mark_visitor_attendance, so the reason rule and the change history can't be skipped. ──
const attendanceRpcError = (error) => {
  const msg = error?.message || '';
  if (error?.code === 'P0007' || msg.includes('ATTENDANCE_REASON_REQUIRED')) return { code: 'ATTENDANCE_REASON_REQUIRED', message: 'A reason is required to change this record.' };
  if (error?.code === 'P0004' || msg.includes('ATTENDANCE_DAY_LOCKED')) return { code: 'ATTENDANCE_DAY_LOCKED', message: 'This day has been closed. Attendance cannot be modified.' };
  if (msg.includes('PUNCH_OPEN_EXISTS')) return { code: 'PUNCH_OPEN_EXISTS', message: 'This person is already checked in. Check them out first.' };
  if (msg.includes('PUNCH_OVERLAP')) return { code: 'PUNCH_OVERLAP', message: 'That time overlaps another check-in for this person.' };
  if (msg.includes('PUNCH_BAD_TIMES')) return { code: 'PUNCH_BAD_TIMES', message: 'Check-out must be after check-in.' };
  if (msg.includes('not working at this branch')) return { code: 'NOT_AT_BRANCH', message: `This person is not working at this ${wordBranch()} that day.` };
  if (msg.includes('cannot be in the future')) return { code: 'PUNCH_FUTURE', message: msg.includes('check-out') ? "A check-out can't be later than now." : "A check-in can't be later than now." };
  if (msg.includes('must stay on the same day')) return { code: 'PUNCH_OTHER_DAY', message: 'A check-in has to stay on the same day.' };
  if (msg.includes('no open check-in')) return { code: 'PUNCH_NONE_OPEN', message: 'There is no open check-in to close.' };
  if (msg.includes('still has punches')) return { code: 'DAY_HAS_PUNCHES', message: 'This day still has check-ins. Delete them first.' };
  if (error?.code === 'P0010' || msg.includes('ATTENDANCE_TIMES_DERIVED')) return { code: 'TIMES_DERIVED', message: 'Check-in and check-out times are set from the check-ins list.' };
  if (error?.code === '42501' || msg.includes('not allowed')) return { code: 'NOT_ALLOWED', message: "You don't have access to change this." };
  if (msg.includes('unknown person')) return { code: 'UNKNOWN_PERSON', message: "That person wasn't found." };
  if (msg) console.error('[API] attendance rpc error:', msg);
  return { code: 'UNKNOWN_ERROR', message: 'Could not save attendance. Please try again.' };
};

/**
 * The DAY (status / half-day off times / notes): keys present are applied, null clears: { status, offStart, offEnd, notes } (off times 'HH:MM').
 * Check-in / check-out are punches: punchIn / punchOut / savePunch / deletePunch below.
 * source: 'button' | 'panel' | 'bulk'. Reason is needed to change a saved status/time, delete, or touch any day before today.
 */
export async function saveAttendanceRecord({ therapistId, date, patch, reason = null, source = 'panel' }) {
  try {
    const body = {};
    if ('status' in patch) body.status = patch.status;
    if ('offStart' in patch) body.off_start = patch.offStart || null;
    if ('offEnd' in patch) body.off_end = patch.offEnd || null;
    if ('notes' in patch) body.notes = patch.notes || null;
    const { data, error } = await supabase.rpc('save_attendance', {
      p_therapist_id: therapistId, p_date: date, p_patch: body, p_reason: reason, p_source: source,
    });
    if (error) return { data: null, error: attendanceRpcError(error) };
    return { data: { id: data }, error: null };
  } catch (error) {
    return { data: null, error: attendanceRpcError(error) };
  }
}

// ── Punches (V34a2): any number of clock punches per person-day, each at the branch where it happened. ──
const punchRow = (r) => ({
  id: r.id, therapistId: r.therapist_id, branchId: r.branch_id, date: r.date, source: r.source,
  checkIn: formatTimeKathmandu(r.check_in), checkInIso: r.check_in, checkOut: r.check_out ? formatTimeKathmandu(r.check_out) : null, checkOutIso: r.check_out || null,
});

export async function fetchAttendancePunches({ date, therapistId = null }) {
  try {
    let q = supabase.from('attendance_punches').select('id, therapist_id, branch_id, date, check_in, check_out, source').eq('date', date).order('check_in');
    if (therapistId) q = q.eq('therapist_id', therapistId);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data || []).map(punchRow), error: null };
  } catch (error) {
    console.error('[API] fetchAttendancePunches error:', error.message);
    return { data: [], error };
  }
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

/** A check-in at `branchId` (the person's home, or the branch they are visiting). `out` makes it a complete punch (adding a missed one). */
export async function punchIn({ therapistId, branchId, at = new Date(), source = 'button', reason = null, out = null }) {
  try {
    const { data, error } = await supabase.rpc('punch_in', { p_therapist_id: therapistId, p_branch_id: branchId, p_at: iso(at), p_source: source, p_reason: reason, p_out: iso(out) });
    if (error) return { data: null, error: attendanceRpcError(error) };
    return { data: { id: data }, error: null };
  } catch (error) { return { data: null, error: attendanceRpcError(error) }; }
}

/** Close a punch: by id, or the open one of a person at a branch. */
export async function punchOut({ punchId = null, therapistId = null, branchId = null, at = new Date(), source = 'button', reason = null }) {
  try {
    const { data, error } = await supabase.rpc('punch_out', { p_punch_id: punchId, p_therapist_id: therapistId, p_branch_id: branchId, p_at: iso(at), p_reason: reason, p_source: source });
    if (error) return { data: null, error: attendanceRpcError(error) };
    return { data: { id: data }, error: null };
  } catch (error) { return { data: null, error: attendanceRpcError(error) }; }
}

/** Edit a saved punch (reason required). checkOut null re-opens it. Times are ISO strings. */
export async function savePunch({ punchId, checkIn, checkOut = null, reason, source = 'panel' }) {
  try {
    const { error } = await supabase.rpc('save_punch', { p_punch_id: punchId, p_in: iso(checkIn), p_out: iso(checkOut), p_reason: reason, p_source: source });
    if (error) return { data: null, error: attendanceRpcError(error) };
    return { data: { success: true }, error: null };
  } catch (error) { return { data: null, error: attendanceRpcError(error) }; }
}

export async function deletePunch({ punchId, reason }) {
  try {
    const { error } = await supabase.rpc('delete_punch', { p_punch_id: punchId, p_reason: reason });
    if (error) return { data: null, error: attendanceRpcError(error) };
    return { data: { success: true }, error: null };
  } catch (error) { return { data: null, error: attendanceRpcError(error) }; }
}

/** 'HH:MM' on a Kathmandu date -> ISO timestamp (for the panel's time fields). */
export const punchTimeIso = (date, hm) => combineDateTimeKathmandu(date, hm);

export async function deleteAttendanceRecord({ therapistId, date, reason }) {
  try {
    const { error } = await supabase.rpc('delete_attendance', { p_therapist_id: therapistId, p_date: date, p_reason: reason });
    if (error) return { data: null, error: attendanceRpcError(error) };
    return { data: { success: true }, error: null };
  } catch (error) {
    return { data: null, error: attendanceRpcError(error) };
  }
}

export async function fetchAttendanceDayStatus({ branchId, date }) {
  try {
    const { data, error } = await supabase.rpc('attendance_day_status', { p_branch_id: branchId, p_date: date });
    if (error) throw error;
    const row = (data || [])[0] || {};
    return { data: { isClosed: !!row.is_closed, closedAt: row.closed_at || null }, error: null };
  } catch (error) {
    console.error('[API] fetchAttendanceDayStatus error:', error.message);
    return { data: null, error };
  }
}

// Unmarked days + open check-outs at a branch (kind 'unmarked' | 'open_checkout'); times come back as 'HH:MM'.
export async function fetchAttendanceGaps({ branchId, from, to }) {
  try {
    const { data, error } = await supabase.rpc('attendance_gaps', { p_branch_id: branchId, p_from: from, p_to: to });
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        kind: r.kind, date: r.date, therapistId: r.therapist_id, therapistName: r.therapist_name,
        shiftStart: r.shift_start, shiftEnd: r.shift_end, checkInTime: formatTimeKathmandu(r.check_in_time), workedAtBranchId: r.worked_at_branch_id, punchId: r.punch_id || null,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchAttendanceGaps error:', error.message);
    return { data: null, error };
  }
}

// Transfer rows for a few people (to work out where they were working on a past date).
export async function fetchTransfersForTherapists(therapistIds) {
  try {
    if (!therapistIds?.length) return { data: [], error: null };
    const { data, error } = await supabase.from('staff_transfers')
      .select('therapist_id, from_branch_id, to_branch_id, effective_date, start_time, revert_at, reverted, reverted_at, is_return_leg, is_permanent')
      .in('therapist_id', therapistIds).order('effective_date');
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchTransfersForTherapists error:', error.message);
    return { data: [], error };
  }
}

// One person's history for a date, newest first, with who changed it.
export async function fetchAttendanceChanges({ therapistId, date }) {
  try {
    const { data, error } = await supabase
      .from('attendance_changes')
      .select('id, field, old_value, new_value, reason, changed_by, changed_at, source, punch_id')
      .eq('therapist_id', therapistId).eq('date', date)
      .order('changed_at', { ascending: false });
    if (error) throw error;
    const ids = [...new Set((data || []).map((r) => r.changed_by).filter(Boolean))];
    let names = {};
    if (ids.length) {
      const { data: users } = await supabase.from('users').select('id, full_name, email').in('id', ids);
      names = Object.fromEntries((users || []).map((u) => [u.id, u.full_name || u.email]));
    }
    return { data: (data || []).map((r) => ({ ...r, changedByName: names[r.changed_by] || null })), error: null };
  } catch (error) {
    console.error('[API] fetchAttendanceChanges error:', error.message);
    return { data: null, error };
  }
}

export async function fetchAttendanceSettings(branchId) {
  try {
    const { data, error } = await supabase.from('branches').select('late_grace_minutes, open_checkout_hours, expect_check_in, open_time, close_time').eq('id', branchId).single();
    if (error) throw error;
    return { data: { lateGraceMinutes: data.late_grace_minutes ?? 10, openCheckoutHours: data.open_checkout_hours ?? 4, expectCheckIn: !!data.expect_check_in, openTime: data.open_time ? String(data.open_time).slice(0, 5) : null, closeTime: data.close_time ? String(data.close_time).slice(0, 5) : null }, error: null };
  } catch (error) {
    console.error('[API] fetchAttendanceSettings error:', error.message);
    return { data: { lateGraceMinutes: 10, openCheckoutHours: 4, expectCheckIn: false }, error };
  }
}

export async function setAttendanceSettings({ branchId, lateGraceMinutes, openCheckoutHours, expectCheckIn = null }) {
  try {
    const { error } = await supabase.rpc('set_attendance_settings', {
      p_branch_id: branchId, p_late_grace_minutes: lateGraceMinutes, p_open_checkout_hours: openCheckoutHours, p_expect_check_in: expectCheckIn,
    });
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    return { data: null, error: { code: error.code, message: friendlyError(error, 'Could not save the attendance settings. Please try again.') } };
  }
}

// What the panel needs to show "pay effect": the person's salary (null when this login can't read it), days in the date's month,
// and how many Sick / Annual days they already used in the calendar year before the date (same year rule and caps as Payroll).
export async function fetchAttendancePayContext({ therapistId, date }) {
  try {
    const [y, m] = date.split('-').map(Number);
    const [{ data: comp }, { data: leave }] = await Promise.all([
      supabase.from('staff_compensation').select('monthly_salary').eq('therapist_id', therapistId).maybeSingle(),
      supabase.from('therapist_attendance').select('status').eq('therapist_id', therapistId)
        .in('status', ['Sick Leave', 'Annual Leave']).gte('date', `${y}-01-01`).lt('date', date),
    ]);
    const used = { 'Sick Leave': 0, 'Annual Leave': 0 };
    (leave || []).forEach((r) => { used[r.status] += 1; });
    return {
      data: {
        monthlySalary: comp?.monthly_salary != null ? Number(comp.monthly_salary) : null,
        daysInMonth: new Date(y, m, 0).getDate(),
        sickUsed: used['Sick Leave'], annualUsed: used['Annual Leave'],
        sickCap: SICK_LEAVE_PAID_CAP_DAYS, annualCap: ANNUAL_LEAVE_PAID_CAP_DAYS,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchAttendancePayContext error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch today's attendance record for an arbitrary set of therapist IDs, regardless of their
 * current branch_id — for staff who've been transferred OUT of the branch viewing them (they no
 * longer match a branch-scoped fetchAttendance() query, but they may still have checked in
 * earlier today before the transfer took effect, or at their new branch since).
 */
export async function fetchAttendanceByTherapistIds({ therapistIds, date }) {
  try {
    if (!therapistIds || therapistIds.length === 0) return { data: {}, error: null };

    const targetDate = date || nepalToday();

    const { data, error } = await supabase
      .from('therapist_attendance')
      .select('therapist_id, status, check_in_time, check_out_time, notes')
      .eq('date', targetDate)
      .in('therapist_id', therapistIds);

    if (error) throw error;

    const map = {};
    (data || []).forEach(row => {
      map[row.therapist_id] = {
        status: row.status || null,
        checkInTime: formatTimeKathmandu(row.check_in_time),
        checkOutTime: formatTimeKathmandu(row.check_out_time),
        notes: row.notes || null,
      };
    });

    return { data: map, error: null };
  } catch (error) {
    console.error('[API] fetchAttendanceByTherapistIds error:', error.message);
    return { data: null, error };
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

    const targetDate = date || nepalToday();

    // Attendance is keyed by (therapist_id, date) globally, not branch_id, so it's fetched
    // unfiltered by branch (in parallel with the therapist list) and joined in-memory against
    // the resolved therapist_id set — a status marked pre-transfer still counts this way.
    let therapistsQuery = supabase
      .from('therapists')
      .select('id')
      .eq('is_active', true);
    therapistsQuery = withBranch(therapistsQuery, branchId);
    const attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, status')
      .eq('date', targetDate);
    const [therapistsResult, attendanceResult] = await Promise.all([therapistsQuery, attendanceQuery]);
    if (therapistsResult.error) throw therapistsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    const therapistIds = new Set((therapistsResult.data || []).map(t => t.id));
    const totalTherapists = therapistIds.size;
    const records = (attendanceResult.data || []).filter(r => therapistIds.has(r.therapist_id));

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

    // Attendance is keyed by (therapist_id, date) globally, not branch_id, so it's fetched
    // unfiltered by branch (in parallel with the therapist list) and joined in-memory against
    // the resolved therapist_id set — a status marked pre-transfer still counts this way.
    let therapistsQuery = supabase
      .from('therapists')
      .select('id, name, is_service_staff')
      .eq('is_active', true)
      .order('name');
    therapistsQuery = withBranch(therapistsQuery, branchId);
    // Org-wide attendance over a date range can exceed the PostgREST 1000-row
    // cap (confirmed 3,117 rows at Nuad Thai Spa) — paginate.
    const attendanceResultPromise = pagedResult((opts) =>
      supabase
        .from('therapist_attendance')
        .select('therapist_id, date, status', opts)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('id')
    );
    const [therapistsResult, attendanceResult] = await Promise.all([therapistsQuery, attendanceResultPromise]);
    if (therapistsResult.error) throw therapistsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    const therapists = therapistsResult.data || [];
    const therapistIdSet = new Set(therapists.map(t => t.id));
    const records = (attendanceResult.data || []).filter(r => therapistIdSet.has(r.therapist_id));

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

// (The late / left-early grace window now lives with attendanceDays in therapistInnerView.js.)

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
export function computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays) {
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
  const clockedDays = []; // { date, hours, assumed }: one per Present / half-day row (ZNLY-170's "Clocked in" note)
  const clockedDates = new Set();
  for (const a of attendanceRows) {
    attendedDaysTotal += 1;
    const isHalf = a.status === '1st-Half Day' || a.status === '2nd-Half Day';
    if (a.status !== 'Present' && !isHalf) continue;
    presentOrHalfDays += 1;
    const dayWindow = isHalf ? dayWindowMinutes / 2 : dayWindowMinutes;
    const timed = !!(a.check_in_time && a.check_out_time);
    const dayMin = timed ? Math.max(0, (new Date(a.check_out_time) - new Date(a.check_in_time)) / 60000) : dayWindow;
    workedMinutes += dayMin;
    if (a.date) { clockedDates.add(a.date); clockedDays.push({ date: a.date, hours: Math.round((dayMin / 60) * 10) / 10, assumed: !timed }); }
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
  // ZNLY-171: "busy while clocked in" counts only Completed bookings dated on a day the therapist was Present / half-day. Dividing the whole
  // period's services by a couple of marked days (Govinda L., 1-30 Oct: 7.8 h / 13.5 h = 57%, really 1.3 h = 9%) overstated it. With no
  // attendance rows at all the worked time is the assumed period x branch hours, so every Completed booking stays in.
  const busyMinutes = attendedDaysTotal === 0 ? occupiedMinutes
    : completed.filter(b => clockedDates.has(b.date)).reduce((sum, b) => sum + (b.service_duration_snapshot || 0), 0);
  const utilizationRate = workedMinutes > 0 ? Math.round(Math.min(busyMinutes / workedMinutes, 1) * 100) : 0;

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
    busyHours: Math.round((busyMinutes / 60) * 10) / 10,
    busyMinutes: Math.round(busyMinutes),
    clockedDays,
    avgServiceDurationMinutes,
  };
}

export async function getTherapistPerformance({ branchId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }

    const overall = isOverallBranch(branchId);
    const today = nepalToday();
    const endDate = toDate || today;
    const startDate = fromDate || addDays(endDate, -30);

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
      .select('therapist_id, date, status, payment_status, final_amount, service_duration_snapshot, customer_id, customer_name, customer_phone, start_datetime')
      .gte('date', startDate)
      .lte('date', endDate)
      .in('therapist_id', therapistIds)
      .in('status', ['Confirmed', 'In-Progress', 'Completed']);
    bookingsQuery = withBranch(bookingsQuery, branchId);
    // Not branch-scoped: already filtered to this branch's therapistIds above,
    // and therapist_attendance is keyed by (therapist_id, date) globally — an
    // extra branch_id filter here would drop rows marked before a same-day transfer.
    const attendanceQuery = supabase
      .from('therapist_attendance')
      .select('therapist_id, date, status, check_in_time, check_out_time')
      .gte('date', startDate)
      .lte('date', endDate)
      .in('therapist_id', therapistIds);
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

    const today = nepalToday();
    const endDate = toDate || today;
    const startDate = fromDate || addDays(endDate, -30);

    // Branch hours come from the branchId PARAM (resolveBranchId, same as getTherapistPerformance's
    // non-overall path) — not from the therapist's live branch_id. The bookings/attendance
    // queries below are scoped by branchId via withBranch(); deriving dayWindowMinutes from the
    // therapist's current branch instead would silently use the wrong operating window if the
    // therapist has since been transferred elsewhere.
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('open_time, close_time')
      .eq('id', await hoursBranchOf(branchId, therapistId))
      .single();
    if (bErr) throw bErr;
    const dayWindowMinutes = timeToMinutes(branch.close_time) - timeToMinutes(branch.open_time);

    let attendanceQuery = supabase
      .from('therapist_attendance')
      .select('date, status, check_in_time, check_out_time')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate);
    attendanceQuery = withBranch(attendanceQuery, branchId);

    const [bookingRows, attendanceResult, attDetail] = await Promise.all([
      fetchTherapistBookings({ branchId, therapistId, startDate, endDate, columns: 'id, date, start_time, service_name_snapshot, payments(amount), status, payment_status, final_amount, service_duration_snapshot, customer_id, customer_name, customer_phone, start_datetime, end_datetime, cancellation_reason' }),
      attendanceQuery,
      getTherapistAttendanceDetail({ branchId, therapistId, fromDate: startDate, toDate: endDate }),
    ]);
    if (attDetail.error) throw attDetail.error;
    const attendance = attDetail.data;
    const allBookings = bookingRows.map((b) => ({ ...b, full_amount: Number(b.final_amount) || 0, final_amount: (Number(b.final_amount) || 0) * b.share })); // a combo's price is split equally
    const bookings = allBookings.filter(b => ['Confirmed', 'In-Progress', 'Completed'].includes(b.status));
    const attendanceRows = (!attendanceResult.error && attendanceResult.data) || [];

    const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, daysInPeriodInclusive(startDate, endDate));

    // The same bookings, split by how they ended. "Not closed yet" = Pending / Confirmed / In-Progress whose end time has passed (nobody
    // marked them Completed or No Show); future ones are not counted. Service sales = Completed at final price (the report row's rule).
    const nowMs = Date.now();
    const statusSplit = { completed: 0, noShow: 0, cancelled: 0, notClosed: 0 };
    for (const b of allBookings) {
      if (b.status === 'Completed') statusSplit.completed += 1;
      else if (b.status === 'No Show' || isNoShow(b)) statusSplit.noShow += 1;
      else if (b.status === 'Cancelled') statusSplit.cancelled += 1;
      else if (b.end_datetime && new Date(b.end_datetime).getTime() <= nowMs) statusSplit.notClosed += 1;
    }
    const serviceSales = bookings.filter(b => b.status === 'Completed').reduce((sum, b) => sum + (Number(b.final_amount) || 0), 0);

    // Clocked in = measured time only (days with BOTH clock times, from the shared attendanceDays helper). computeTherapistMetrics assumes a branch
    // day when times are missing — right for the bulk table's old score, wrong here — so its worked / busy figures are replaced by the helper's.
    // Busy on clocked-in days: only Completed minutes that fall inside the clock-in span (numerator) over the clocked-in minutes (denominator).
    const clock = attendance.totals;
    const busyMin = busyMinutesInSpans(bookings, clock.clockDates); // only the minutes of Completed services inside the clock-in span
    const hasClock = clock.clockDays > 0;
    const clockFigures = { workedHours: hasClock ? clock.clockedMin / 60 : null, clockedMin: hasClock ? clock.clockedMin : null, busyMinutes: hasClock ? busyMin : null, busyHours: hasClock ? busyMin / 60 : null,
      utilizationRate: hasClock ? Math.round((busyMin / clock.clockedMin) * 100) : null };
    // One line per booking in the period (the inner page's open list, services table and CSV). paid = final price when fully paid, as paidRevenue.
    const todayNp = nepalNow().today;
    // A combo's other therapists (for "with Wangmo Q." on the Services tab): one name lookup for all of them.
    const otherIdsOf = (b) => (b.booking_therapists || []).map((t) => t.therapist_id).filter((id) => id && id !== therapistId);
    const otherIds = [...new Set(allBookings.flatMap(otherIdsOf))];
    const nameOf = {};
    if (otherIds.length) {
      const { data: others } = await supabase.from('therapists').select('id, name').in('id', otherIds);
      for (const t of others || []) nameOf[t.id] = t.name;
    }
    const bookingList = allBookings
      .map((b) => ({ ...(() => { const m = classifyBooking({ id: b.id, date: b.date, status: b.status, final_amount: b.full_amount, payments: b.payments }, { today: todayNp }); return { atStake: m.atStake, paidAmt: m.paid }; })(), date: b.date, start: String(b.start_time || '').slice(0, 5), customer: b.customer_name || '', service: b.service_name_snapshot || '', status: b.status !== 'Completed' && (b.status === 'No Show' || isNoShow(b)) ? 'No Show' : b.status, final: Number(b.final_amount) || 0, full: b.full_amount, paid: b.payment_status === 'paid' ? Number(b.final_amount) || 0 : 0, endMs: b.end_datetime ? new Date(b.end_datetime).getTime() : null, minutes: b.service_duration_snapshot || 0, others: otherIdsOf(b).map((id) => nameOf[id]).filter(Boolean) }))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return { data: { ...metrics, ...clockFigures, attendance, bookingList, dayWindowMinutes, serviceSales, owed: Math.max(0, serviceSales - metrics.paidRevenue), statusSplit, periodStart: startDate, periodEnd: endDate }, error: null };
  } catch (error) {
    console.error('[API] getTherapistOverview error:', error.message);
    return { data: null, error };
  }
}

// Booking details dialog "New" badge: does this customer have any earlier non-Cancelled
// booking than the one being viewed? No customer_id (walk-in/guest) → always first.
export async function getCustomerFirstBookingFlag(customerId, bookingId, bookingDate, bookingStartTime = null, isWalkIn = false) {
  try {
    if (!customerId) {
      return { data: { isFirstBooking: !isWalkIn }, error: null }; // ZNLY-327: a walk-in with no client is never New
    }

    let query = supabase
      .from('bookings')
      .select('id')
      .eq('customer_id', customerId)
      .neq('id', bookingId)
      .neq('status', 'Cancelled');

    // With a start time, tiebreak same-day bookings by time so two back-to-back services
    // booked on a customer's actual first day don't each see the other and both suppress
    // the badge — only a strictly-earlier same-day booking counts as a prior visit.
    query = bookingStartTime
      ? query.or(`date.lt.${bookingDate},and(date.eq.${bookingDate},start_time.lt.${bookingStartTime})`)
      : query.lte('date', bookingDate);

    const { data: priorVisits, error } = await query.limit(1);
    if (error) throw error;

    return { data: { isFirstBooking: (priorVisits || []).length === 0 }, error: null };
  } catch (error) {
    console.error('[API] getCustomerFirstBookingFlag error:', error.message);
    return { data: null, error };
  }
}

// The therapist's day-by-day attendance for a period (ZNLY-172 V37g): the roster (therapist_shifts_for_range, filtered to this therapist) + the
// attendance rows, turned into days and totals by the ONE pure helper attendanceDays. The Overview calls this too, so its Clocked in / Busy lines
// and the Attendance tab can never disagree. Each day is judged against the therapist's own shift; only days with no shift fall back to branch hours.
export async function getTherapistAttendanceDetail({ branchId, therapistId, fromDate, toDate }) {
  try {
    if (!branchId) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };
    }
    if (!therapistId) {
      return { data: null, error: { code: 'THERAPIST_REQUIRED', message: 'Therapist ID is required.' } };
    }

    const today = nepalToday();
    const endDate = toDate || today;
    const startDate = fromDate || addDays(endDate, -30);

    // Branch id from the branchId PARAM (resolveBranchId), matching the attendance query's withBranch() scope (see getTherapistOverview).
    const hoursBranch = await hoursBranchOf(branchId, therapistId);
    const { data: branch, error: bErr } = await supabase.from('branches').select('name, open_time, close_time, expect_check_in, late_grace_minutes').eq('id', hoursBranch).single();
    if (bErr) throw bErr;

    let query = supabase
      .from('therapist_attendance')
      .select('date, status, check_in_time, check_out_time, branch_id, worked_at_branch_id, worked_at:branches!worked_at_branch_id(name)')
      .eq('therapist_id', therapistId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    query = withBranch(query, branchId);

    // The roster RPC allows 92 days per call; longer periods go in chunks.
    const chunks = [];
    for (let from = startDate; from <= endDate; from = addDaysISO(from, 93)) {
      const to = addDaysISO(from, 92);
      chunks.push([from, to < endDate ? to : endDate]);
    }
    const [attResult, ...shiftResults] = await Promise.all([
      query,
      ...chunks.map(([f, t]) => supabase.rpc('therapist_shifts_for_range', { p_branch_id: hoursBranch, p_from_date: f, p_to_date: t }).eq('therapist_id', therapistId)), // filtered server-side: the whole branch would hit the 1,000-row API cap
    ]);
    if (attResult.error) throw attResult.error;
    const shiftErr = shiftResults.find((r) => r.error);
    if (shiftErr) throw shiftErr.error;
    const shifts = shiftResults.flatMap((r) => r.data || []).filter((x) => x.therapist_id === therapistId);

    const att = attendanceDays({ shifts, rows: attResult.data || [], from: startDate, to: endDate, now: Date.now(), branchHours: { open: branch.open_time, close: branch.close_time }, settings: { expectCheckIn: branch.expect_check_in, lateGraceMinutes: branch.late_grace_minutes } });
    return { data: { ...att, branchName: branch.name, periodStart: startDate, periodEnd: endDate }, error: null };
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
      .select('id, name, address, phone, is_active, open_time, close_time')
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
        settings,
        logo_url,
        hero_image_url,
        require_customer_phone,
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
      // online_booking_capacity feeds DateTimeSelection's slot graying (migration-301) —
      // it's the same cap check_branch_online_capacity() enforces at insert time.
      .select('id, name, address, phone, is_active, open_time, close_time, maps_url, photo_url, online_booking_capacity, advance_booking_days')
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
 * Per-branch cap on concurrent anonymous online bookings
 * (branches.online_booking_capacity, migration-138; enforced by the
 * check_branch_online_capacity() trigger). null = no cap.
 */
export async function fetchBranchOnlineCapacity(branchId) {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, online_booking_capacity')
      .eq('id', resolveBranchId(branchId))
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBranchOnlineCapacity error:', error.message);
    return { data: null, error };
  }
}

/**
 * Admin-only write path for the cap. Goes through an RPC, not a plain .update():
 * `branches` has RLS enabled with SELECT-only policies, so a direct update would
 * silently affect zero rows and report success. Pass null to clear the cap (uncapped).
 */
export async function updateBranchOnlineCapacity(branchId, capacity) {
  try {
    const { error } = await supabase.rpc('update_branch_online_capacity', {
      p_branch_id: resolveBranchId(branchId),
      p_capacity: capacity === null || capacity === '' ? null : Number(capacity),
    });
    if (error) throw error;
    return { data: { capacity }, error: null };
  } catch (error) {
    console.error('[API] updateBranchOnlineCapacity error:', error.message);
    return { data: null, error };
  }
}

/**
 * How many days ahead customers can book online for this branch
 * (branches.advance_booking_days, migration-303). null = unset, defers to the
 * 30-day default enforced by check_branch_advance_booking_window().
 */
export async function fetchBranchAdvanceBookingWindow(branchId) {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, advance_booking_days')
      .eq('id', resolveBranchId(branchId))
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBranchAdvanceBookingWindow error:', error.message);
    return { data: null, error };
  }
}

/**
 * Admin-only write path for the window. Goes through an RPC, not a plain .update():
 * `branches` has RLS enabled with SELECT-only policies, so a direct update would
 * silently affect zero rows. Pass null to clear back to the 30-day default.
 */
export async function updateBranchAdvanceBookingWindow(branchId, days) {
  try {
    const { error } = await supabase.rpc('update_branch_advance_booking_window', {
      p_branch_id: resolveBranchId(branchId),
      p_days: days === null || days === '' ? null : Number(days),
    });
    if (error) throw error;
    return { data: { days }, error: null };
  } catch (error) {
    console.error('[API] updateBranchAdvanceBookingWindow error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

/**
 * Branch storefront photo (branches.photo_url) — shown on BranchGate's multi-branch
 * picker tile for the customer booking flow. Falls back to a generic icon tile when empty.
 */
export async function fetchBranchPhoto(branchId) {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, photo_url')
      .eq('id', resolveBranchId(branchId))
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBranchPhoto error:', error.message);
    return { data: null, error };
  }
}

/**
 * Admin-only write path for the branch photo. Goes through an RPC, not a plain
 * .update(): `branches` has RLS enabled with SELECT-only policies (see
 * update_branch_online_capacity's comment, migration-301), so a direct update would
 * silently affect zero rows and report success. Pass null/'' to clear the photo.
 */
export async function updateBranchPhoto(branchId, photoUrl) {
  try {
    const { error } = await supabase.rpc('update_branch_photo', {
      p_branch_id: resolveBranchId(branchId),
      p_photo_url: photoUrl || null,
    });
    if (error) throw error;
    return { data: { photoUrl: photoUrl || null }, error: null };
  } catch (error) {
    console.error('[API] updateBranchPhoto error:', error.message);
    return { data: null, error };
  }
}

/**
 * All branches for an org (admin Locations management — includes inactive branches,
 * unlike fetchBranchesByOrgId which is the customer-facing active-only list).
 */
export async function fetchBranchesForManagement(orgId) {
  try {
    if (!orgId) return { data: null, error: { code: 'ORG_REQUIRED', message: 'Organization ID is required.' } };

    const { data, error } = await supabase
      .from('branches')
      .select('id, name, address, phone, maps_url, is_active, open_time, close_time, online_booking_capacity, advance_booking_days')
      .eq('org_id', orgId)
      .order('name');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchBranchesForManagement error:', error.message);
    return { data: null, error };
  }
}

/**
 * Admin-only creation of a new branch. Goes through an RPC, not a plain .insert():
 * `branches` has RLS enabled with SELECT-only policies, so a direct insert would be
 * rejected outright (migration-308).
 */
export async function createBranch({ name, address, phone, mapsUrl }) {
  try {
    const { data, error } = await supabase.rpc('create_branch', {
      p_name: name,
      p_address: address || null,
      p_phone: phone || null,
      p_maps_url: mapsUrl || null,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createBranch error:', error.message);
    return { data: null, error };
  }
}

/**
 * Admin-only write path for name/address/phone/maps_url. Does NOT touch
 * online_booking_capacity/advance_booking_days/photo_url — those keep their own
 * dedicated RPCs (updateBranchOnlineCapacity/updateBranchAdvanceBookingWindow/
 * updateBranchPhoto). Goes through an RPC for the same RLS reason as createBranch.
 */
export async function updateBranchDetails({ branchId, name, address, phone, mapsUrl }) {
  try {
    const { data, error } = await supabase.rpc('update_branch_details', {
      p_branch_id: resolveBranchId(branchId),
      p_name: name,
      p_address: address || null,
      p_phone: phone || null,
      p_maps_url: mapsUrl || null,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateBranchDetails error:', error.message);
    return { data: null, error };
  }
}

/**
 * A branch's recurring weekly opening hours (branch_working_hours, migration-308).
 * Mirrors fetchTherapistWorkingHours' shape (one row per weekday, defaulting to a day
 * off when unset) but for the branch itself rather than a therapist, and with no breaks
 * concept — branch_working_hours has no sibling breaks table.
 */
// Raw hours for the customer slot grid (ZNLY-222): the weekly rows exactly as stored (a weekday with no row is NOT a day off here;
// slotRangeForDate falls back to branches.open_time/close_time) plus that fallback pair. Both are anon-readable (RLS "Public can read ...").
export async function fetchBranchSlotHours(branchId) {
  try {
    const id = resolveBranchId(branchId);
    const [weekly, branch] = await Promise.all([
      supabase.from('branch_working_hours').select('day_of_week, start_time, end_time, is_day_off').eq('branch_id', id),
      supabase.from('branches').select('open_time, close_time').eq('id', id).maybeSingle(),
    ]);
    if (weekly.error) throw weekly.error;
    if (branch.error) throw branch.error;
    return { data: { weekly: weekly.data || [], openTime: branch.data?.open_time || null, closeTime: branch.data?.close_time || null }, error: null };
  } catch (error) {
    console.error('[API] fetchBranchSlotHours error:', error.message);
    return { data: null, error };
  }
}

export async function fetchBranchOpeningHours(branchId) {
  try {
    if (!branchId) return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };

    const { data, error } = await supabase
      .from('branch_working_hours')
      .select('day_of_week, start_time, end_time, is_day_off')
      .eq('branch_id', resolveBranchId(branchId))
      .order('day_of_week');

    if (error) throw error;

    const byDay = new Map((data || []).map(row => [row.day_of_week, row]));
    const normalized = WORKING_HOURS_DAY_LABELS.map((label, dayOfWeek) => {
      const row = byDay.get(dayOfWeek);
      return row
        ? { dayOfWeek, dayLabel: label, startTime: row.start_time, endTime: row.end_time, isDayOff: row.is_day_off }
        : { dayOfWeek, dayLabel: label, startTime: null, endTime: null, isDayOff: true };
    });

    return { data: normalized, error: null };
  } catch (error) {
    console.error('[API] fetchBranchOpeningHours error:', error.message);
    return { data: null, error };
  }
}

/**
 * rows: [{ dayOfWeek, startTime, endTime, isDayOff }, ...] — one per weekday.
 * Direct .upsert() against branch_working_hours (normal RLS, admin-gated — no RPC
 * needed, matching upsertTherapistWorkingHours' precedent of writing straight to its
 * child table rather than routing through a scalar-field RPC).
 */
export async function upsertBranchOpeningHours(branchId, rows) {
  try {
    if (!branchId) return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Branch ID is required.' } };

    const resolvedBranchId = resolveBranchId(branchId);

    for (const row of rows) {
      const label = WORKING_HOURS_DAY_LABELS[row.dayOfWeek];
      if (!row.isDayOff && (!row.startTime || !row.endTime || row.startTime >= row.endTime)) {
        return { data: null, error: { code: 'INVALID_HOURS', message: `${label}: start time must be before end time.` } };
      }
    }

    const payload = rows.map(row => ({
      branch_id: resolvedBranchId,
      day_of_week: row.dayOfWeek,
      start_time: row.isDayOff ? null : row.startTime,
      end_time: row.isDayOff ? null : row.endTime,
      is_day_off: !!row.isDayOff,
    }));

    const { data, error } = await supabase
      .from('branch_working_hours')
      .upsert(payload, { onConflict: 'branch_id,day_of_week' })
      .select('day_of_week, start_time, end_time, is_day_off');

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] upsertBranchOpeningHours error:', error.message);
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

/**
 * Fetch services for the public customer booking flow (/:orgSlug/book),
 * offer-price and campaign-aware. Distinct from fetchServicesByOrgId above
 * (kept unchanged — still used by staff-authenticated screens like
 * VoucherDetailModal) because the booking flow is fully anonymous, and
 * campaign discounts require a SECURITY DEFINER RPC
 * (public_get_bookable_services, migration-205) to see past the
 * campaigns table's org-scoped RLS with no session present.
 */
export async function fetchBookableServicesByOrgSlug(orgSlug, branchId) {
  try {
    const { data, error } = await supabase.rpc('public_get_bookable_services', {
      p_org_slug: orgSlug,
    });

    if (error) throw error;

    let filtered = (data || []).map((s) => ({
      id: s.id,
      name: s.name,
      duration_minutes: s.duration_minutes,
      price_npr: s.price_npr,
      description: s.description,
      image_url: s.image_url,
      category: s.category_name,
      category_id: s.category_id,
      category_display_order: s.category_display_order,
      effective_price_npr: s.effective_price_npr,
      is_on_offer: s.is_on_offer,
      original_price_npr: s.original_price_npr,
      active_campaign_name: s.active_campaign_name,
      is_combo: s.is_combo,
      price_type: s.price_type,
      min_price: s.min_price,
      max_price: s.max_price,
    }));

    if (branchId) {
      const { data: branch } = await supabase
        .from('branches')
        .select('excluded_service_categories')
        .eq('id', branchId)
        .single();
      const excluded = branch?.excluded_service_categories;
      if (excluded?.length > 0) {
        filtered = filtered.filter((s) => !excluded.includes(s.category));
      }
      filtered = await filterServicesByBranchScope(filtered, branchId);
    }

    return { data: filtered, error: null };
  } catch (error) {
    console.error('[API] fetchBookableServicesByOrgSlug error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch bookable staff for the provider-profile "Select professional" step
 * (public_get_bookable_therapists, migration-252) — org-scoped (the raw anon RLS
 * policy on `therapists` is not) and allow-list-aware when p_service_id is passed.
 *
 * forGroupBooking (migration-305) bypasses the tenant's show_staff_selection=true
 * requirement server-side: that flag only governs whether a SOLO customer is offered
 * a staff-picker on the profile page, unrelated to group booking's need for the same
 * roster to compute per-person availability. Defaults to false so every existing
 * (solo-flow) caller is unaffected.
 */
export async function fetchBookableTherapists(orgSlug, branchId, serviceIds, forGroupBooking = false) {
  try {
    // Accepts one id or an array — a multi-service visit is covered by a single
    // professional, so the roster must be narrowed to staff eligible for every
    // selected service (enforced server-side in public_get_bookable_therapists).
    const ids = Array.isArray(serviceIds)
      ? serviceIds.filter(Boolean)
      : (serviceIds ? [serviceIds] : []);

    const { data, error } = await supabase.rpc('public_get_bookable_therapists', {
      p_org_slug: orgSlug,
      p_branch_id: branchId,
      p_service_ids: ids.length > 0 ? ids : null,
      p_for_group_booking: forGroupBooking,
    });

    if (error) throw error;

    return {
      data: (data || []).map((t) => ({
        id: t.id,
        name: t.name,
        position: t.position,
        photoUrl: t.photo_url,
        rating: t.rating,
        experienceYears: t.experience_years,
        bio: t.bio,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchBookableTherapists error:', error.message);
    return { data: null, error };
  }
}

/**
 * Fetch the single currently-active campaign for the public customer
 * booking flow's banner/popup (public_get_active_campaign, migration-204
 * — the same anon-safe RPC nuadthainepal.com's website already uses).
 * Returns null (not an error) when no campaign is currently active.
 */
export async function fetchActiveCampaignForBooking(orgSlug) {
  try {
    const { data, error } = await supabase.rpc('public_get_active_campaign', {
      p_org_slug: orgSlug,
    });

    if (error) throw error;
    return { data: data?.[0] || null, error: null };
  } catch (error) {
    console.error('[API] fetchActiveCampaignForBooking error:', error.message);
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
      .select('id, name, description, is_active, display_order, created_at, offer_enabled, offer_percent')
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
      .select('id, name, offer_enabled, offer_percent')
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
export async function createCategory({ name, description, offerEnabled, offerPercent }) {
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
    const isOfferEnabled = !!offerEnabled;

    const { data, error } = await supabase
      .from('service_categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        display_order: nextOrder,
        is_active: true,
        org_id: profile.org_id,
        offer_enabled: isOfferEnabled,
        offer_percent: isOfferEnabled ? offerPercent : null,
      })
      .select('id, name, description, is_active, display_order, created_at, offer_enabled, offer_percent')
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
export async function updateCategory({ categoryId, name, description, offerEnabled, offerPercent }) {
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
    if (offerEnabled !== undefined) {
      const isOfferEnabled = !!offerEnabled;
      updateData.offer_enabled = isOfferEnabled;
      updateData.offer_percent = isOfferEnabled ? offerPercent : null;
    }

    const { data, error } = await supabase
      .from('service_categories')
      .update(updateData)
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)  // Tenant isolation filter
      .select('id, name, description, is_active, display_order, created_at, offer_enabled, offer_percent')
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
      .select('id, name, position, is_service_staff, staff_compensation(monthly_salary, commission_rate, product_commission_rate)')
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
        productCommissionRate: t.staff_compensation?.product_commission_rate != null
          ? Number(t.staff_compensation.product_commission_rate)
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
export async function setStaffCompensation({ therapistId, monthlySalary, commissionRate, productCommissionRate }) {
  try {
    const salary = Number(monthlySalary);
    const rate = Number(commissionRate);
    const productRate = productCommissionRate === undefined ? undefined : Number(productCommissionRate);
    if (productRate !== undefined && (!(productRate >= 0) || productRate > 100)) {
      return { data: null, error: { code: 'INVALID_VALUE', message: 'Product commission must be between 0 and 100.' } };
    }
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
          ...(productRate === undefined ? {} : { product_commission_rate: productRate }),
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
          productRevenue: Number(i.product_revenue || 0),
          productCommissionRate: Number(i.product_commission_rate || 0),
          productCommission: Number(i.product_commission || 0),
          productCommissionDeduction: Number(i.product_commission_deduction || 0),
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

const nepalMonthStart = (periodMonth) => `${periodMonth}-01T00:00:00+05:45`;
const nextPeriodMonth = (periodMonth) => {
  const [y, m] = periodMonth.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const prevPeriodMonth = (periodMonth) => {
  const [y, m] = periodMonth.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const nepalMonthOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: NEPAL_TZ }).slice(0, 7);

// What product commission is worked out from, per therapist, for one pay run:
//   earned   = unrefunded product_sales.total_amount of sales made in [month] (Nepal) at the branch, credited to that therapist, for
//              products that earn commission;
//   refunded = the same kind of sale from an EARLIER, already-finalized run's month that was refunded AFTER that run was finalized
//              (never an edit to a finalized run: it lands as a deduction in the first run after the refund, i.e. in month
//              max(month of the refund, month of the sale + 1)). A refund made before the run was finalized is simply not in `earned`.
// Returns { earned: { [therapistId]: NPR }, refunded: { [therapistId]: NPR } } (amounts, before the rate).
// Home-on-the-date payroll (ZNLY-118 / ZNLY-125): the branch that was a person's HOME on the booking's date pays, wherever the booking
// happened. RLS hides other branches' rows from that manager, so they come through payroll_home_* (mig 362).
// Returns every paid booking this branch pays for in the month (at home and at other branches). Overall reads everything directly.
export async function fetchHomePayrollBookings({ branchId, firstDay, lastDay }) {
  if (isOverallBranch(branchId)) {
    const { data, error } = await supabase.from('bookings')
      .select('therapist_id, final_amount, referred_by, referral_commission_type, referral_commission_value, branch_id')
      .eq('status', 'Completed').eq('payment_status', 'paid').gte('date', firstDay).lte('date', lastDay);
    if (error) throw error;
    return data || [];
  }
  const { data, error } = await supabase.rpc('payroll_home_bookings', { p_branch_id: resolveBranchId(branchId), p_from: firstDay, p_to: lastDay });
  if (error) throw error;
  return data || [];
}

// People this branch pays for in the month who have since moved away for good: commission-only lines, no salary here.
export async function fetchDepartedPayrollStaff({ branchId, firstDay, lastDay }) {
  const { data, error } = await supabase.rpc('payroll_departed_staff', { p_branch_id: resolveBranchId(branchId), p_from: firstDay, p_to: lastDay });
  if (error) throw error;
  return data || [];
}

// The Payroll screen's extra lines (ZNLY-118): per person "at home / at <other> (lent)" and the receiving branch's visitor help line.
export async function fetchPayrollBranchSplit({ branchId, periodMonth }) {
  try {
    if (isOverallBranch(branchId)) return { data: { byTherapist: {}, visitorLine: null }, error: null };
    const { firstDay, lastDay } = payrollMonthBounds(periodMonth);
    const home = resolveBranchId(branchId);
    const [staffRes, bookings, departed, visitRes] = await Promise.all([
      supabase.from('therapists').select('id').eq('is_active', true).eq('branch_id', home),
      fetchHomePayrollBookings({ branchId, firstDay, lastDay }),
      fetchDepartedPayrollStaff({ branchId, firstDay, lastDay }),
      supabase.rpc('payroll_visitor_revenue', { p_branch_id: home, p_from: firstDay, p_to: lastDay }),
    ]);
    for (const r of [staffRes, visitRes]) if (r.error) throw r.error;
    const byTherapist = splitServiceRevenueByBranch({
      bookings, homeBranchId: home, therapistIds: [...(staffRes.data || []), ...departed].map((t) => t.id),
    });
    return { data: { byTherapist, visitorLine: visitorPayrollHelpLine(visitRes.data?.[0] || {}) }, error: null };
  } catch (error) {
    console.error('[API] fetchPayrollBranchSplit error:', error.message);
    return { data: null, error };
  }
}

export async function computeProductCommissionBase({ branchId, periodMonth, therapistIds }) {
  const out = { earned: {}, refunded: {} };
  therapistIds.forEach((id) => { out.earned[id] = 0; out.refunded[id] = 0; });
  const from = nepalMonthStart(periodMonth);
  const to = nepalMonthStart(nextPeriodMonth(periodMonth));

  // Sales this branch pays for: made by a person whose home on the sale's date was this branch, wherever the sale happened
  // (payroll_home_product_sales, mig 362). Overall (all branches) reads product_sales directly.
  let earnedRows0 = [];
  let homeSales = [];
  if (isOverallBranch(branchId)) {
    const { data, error: earnedErr } = await withBranch(supabase
      .from('product_sales')
      .select('sold_by_therapist_id, total_amount, products(earns_commission)')
      .in('sold_by_therapist_id', therapistIds)
      .is('refunded_at', null)
      .gte('created_at', from)
      .lt('created_at', to), branchId);
    if (earnedErr) throw earnedErr;
    earnedRows0 = data || [];
  } else {
    const { data: rows, error: homeErr } = await supabase.rpc('payroll_home_product_sales', {
      p_branch_id: resolveBranchId(branchId), p_from: from, p_to: to, p_refund_from: nepalMonthStart(prevPeriodMonth(periodMonth)),
    });
    if (homeErr) throw homeErr;
    homeSales = (rows || []).filter((r) => therapistIds.includes(r.sold_by_therapist_id));
  }
  const asProductRow = (r) => ({ sold_by_therapist_id: r.sold_by_therapist_id, total_amount: r.total_amount, created_at: r.created_at, refunded_at: r.refunded_at, products: { earns_commission: r.earns_commission } });
  const earnedRows = [...earnedRows0, ...homeSales.filter((r) => !r.refunded_at && r.created_at >= from && r.created_at < to).map(asProductRow)];
  for (const r of earnedRows) {
    if (r.products?.earns_commission === false) continue;
    out.earned[r.sold_by_therapist_id] = Math.round((out.earned[r.sold_by_therapist_id] + Number(r.total_amount)) * 100) / 100;
  }

  // Refunds that land in this run: refunded in this month of an older sale, or in the previous month for a sale of that same month.
  const lowerBound = nepalMonthStart(prevPeriodMonth(periodMonth));
  let refundRows0 = [];
  if (isOverallBranch(branchId)) {
    const { data, error: refundErr } = await withBranch(supabase
      .from('product_sales')
      .select('sold_by_therapist_id, total_amount, created_at, refunded_at, products(earns_commission)')
      .in('sold_by_therapist_id', therapistIds)
      .not('refunded_at', 'is', null)
      .gte('refunded_at', lowerBound)
      .lt('refunded_at', to), branchId);
    if (refundErr) throw refundErr;
    refundRows0 = data || [];
  }
  const refundRows = [...refundRows0, ...homeSales.filter((r) => r.refunded_at).map(asProductRow)];
  const candidates = (refundRows || []).filter((r) => {
    const created = nepalMonthOf(r.created_at);
    const refunded = nepalMonthOf(r.refunded_at);
    const dueMonth = refunded > created ? refunded : nextPeriodMonth(created);
    return dueMonth === periodMonth && r.products?.earns_commission !== false;
  });
  if (candidates.length > 0) {
    const saleMonths = [...new Set(candidates.map((r) => `${nepalMonthOf(r.created_at)}-01`))];
    let runsQ = supabase.from('payroll_runs').select('period_month, finalized_at').eq('status', 'finalized').in('period_month', saleMonths);
    runsQ = withBranch(runsQ, branchId);
    const { data: runs, error: runsErr } = await runsQ;
    if (runsErr) throw runsErr;
    const finalizedAt = Object.fromEntries((runs || []).map((r) => [String(r.period_month).slice(0, 7), r.finalized_at]));
    for (const r of candidates) {
      const fin = finalizedAt[nepalMonthOf(r.created_at)];
      // No finalized run for the sale's month = nothing was paid on it; refunded before the run was finalized = already left out.
      if (!fin || new Date(r.refunded_at) <= new Date(fin)) continue;
      out.refunded[r.sold_by_therapist_id] = Math.round((out.refunded[r.sold_by_therapist_id] + Number(r.total_amount)) * 100) / 100;
    }
  }
  return out;
}

// The product sales behind one person's product commission in a pay run (the drill-down): the month's credited sales (with refunds shown)
// plus any deduction lines from earlier months.
export async function fetchTherapistProductSales({ branchId, therapistId, periodMonth }) {
  try {
    const from = nepalMonthStart(periodMonth);
    const to = nepalMonthStart(nextPeriodMonth(periodMonth));
    const cols = 'id, product_name, variant_name, quantity, total_amount, created_at, refunded_at, booking_id, products(earns_commission)';
    let monthQ = supabase.from('product_sales').select(cols).eq('sold_by_therapist_id', therapistId).gte('created_at', from).lt('created_at', to).order('created_at');
    monthQ = withBranch(monthQ, branchId);
    let refundQ = supabase.from('product_sales').select(cols).eq('sold_by_therapist_id', therapistId).not('refunded_at', 'is', null)
      .gte('refunded_at', nepalMonthStart(prevPeriodMonth(periodMonth))).lt('refunded_at', to).lt('created_at', from);
    refundQ = withBranch(refundQ, branchId);
    const [monthRes, refundRes] = await Promise.all([monthQ, refundQ]);
    if (monthRes.error) throw monthRes.error;
    if (refundRes.error) throw refundRes.error;
    const map = (r) => ({ id: r.id, name: [r.product_name, r.variant_name].filter(Boolean).join(' · '), quantity: r.quantity, amount: Number(r.total_amount), createdAt: r.created_at, refundedAt: r.refunded_at, earns: r.products?.earns_commission !== false });
    return { data: { credited: (monthRes.data || []).map(map), earlierRefunds: (refundRes.data || []).map(map) }, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistProductSales error:', error.message);
    return { data: null, error };
  }
}

// Compute and persist a draft payroll run for a branch + month.
// If a draft run already exists it is deleted and regenerated.
// Blocks if a finalized run already exists for the same branch+month.
// periodMonth: 'YYYY-MM' string.
export async function generatePayroll({ branchId, periodMonth }) {
  try {
    // Month bounds (calendar dates), shared with the therapist profile via payrollCalc.
    const { firstDay, lastDay, daysInMonth, year } = payrollMonthBounds(periodMonth);

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
      .select('id, name, staff_compensation(monthly_salary, commission_rate, product_commission_rate)')
      .eq('is_active', true)
      .order('name');
    therapistQuery = withBranch(therapistQuery, branchId);
    const { data: therapists0, error: tErr } = await therapistQuery;
    if (tErr) throw tErr;
    // People this branch paid in the month who have since moved away for good: commission only, no salary here (ZNLY-125).
    const departed = isOverallBranch(branchId) ? [] : await fetchDepartedPayrollStaff({ branchId, firstDay, lastDay });
    const therapists = [
      ...(therapists0 || []),
      ...departed.map((d) => ({ id: d.id, name: d.name, staff_compensation: { monthly_salary: 0, commission_rate: d.commission_rate, product_commission_rate: d.product_commission_rate } })),
    ];
    if (therapists.length === 0) {
      return { data: null, error: { code: 'NO_STAFF', message: `No active staff found for this ${wordBranch()}.` } };
    }

    const therapistIds = therapists.map((t) => t.id);

    // Fetch attendance in the period. Measured 608 rows at the busiest branch's
    // busiest month (Lazimpat, Oct) — under the PostgREST 1000-row cap today, so
    // not truncating yet, but growing. Paginate now rather than wait for it to break.
    const attendance = await fetchAllPages((opts) =>
      supabase
        .from('therapist_attendance')
        .select('therapist_id, status', opts)
        .in('therapist_id', therapistIds)
        .gte('date', firstDay)
        .lte('date', lastDay)
        .order('id')
    );

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
    // A full year of leave rows across a branch's therapists can exceed the
    // PostgREST 1000-row cap (confirmed 3,117 at Nuad Thai Spa) — paginate.
    const ytdLeaveRows = await fetchAllPages((opts) =>
      supabase
        .from('therapist_attendance')
        .select('therapist_id, status, date', opts)
        .in('therapist_id', therapistIds)
        .in('status', ['Sick Leave', 'Annual Leave'])
        .gte('date', yearStart)
        .lte('date', lastDay)
        .order('id') // total order — see getOutstandingByStaff
    );

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

    // Completed+paid bookings this branch pays for in the period: those whose therapist's home ON THE BOOKING'S DATE was this branch,
    // wherever they happened (ZNLY-125).
    const bookings = await fetchHomePayrollBookings({ branchId, firstDay, lastDay });

    // Sum service revenue per therapist, and referral commission per therapist name (shared maths: payrollCalc.js).
    const { serviceRevenueMap, referralCommissionMap } = tallyBookingEarnings({ bookings, therapists });

    // Product commission (V26): the unrefunded product sales credited to each person this month, at this branch, for products that
    // earn commission, and the deduction for refunds of earlier months' sales that were already paid out.
    const productPay = await computeProductCommissionBase({ branchId, periodMonth, therapistIds });

    // Build payroll items.
    const { data: { user } } = await supabase.auth.getUser();
    const itemsPayload = [];
    let totalNet = 0;

    for (const t of therapists) {
      const comp = t.staff_compensation;
      const att = attMap[t.id];
      const unpaidLeaveDays = unpaidLeaveDaysFor(t.id);
      const parts = computeCommissionParts({
        comp,
        serviceRev: serviceRevenueMap[t.id] || 0,
        refCommission: referralCommissionMap[t.id] || 0,
        productRev: productPay.earned[t.id] || 0,
        productRefunded: productPay.refunded[t.id] || 0,
      });
      const { salary, rate, productRate, serviceRev, svcCommission, refCommission, productRev, productEarned, productDeduction } = parts;
      const perDay = daysInMonth > 0 ? salary / daysInMonth : 0;
      const deduction = Math.round(perDay * (att.absent + 0.5 * att.halfDay + unpaidLeaveDays) * 100) / 100;
      const netPay = computeNetPay({ salary, deduction, svcCommission, refCommission, productEarned, productDeduction });
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
        product_revenue: productRev,
        product_commission_rate: productRate,
        product_commission: productEarned,
        product_commission_deduction: productDeduction,
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
      return { data: null, error: { code: 'INVALID_INPUT', message: `Org, ${wordBranch()}, and name are required.` } };
    }
    fullName = toTitleCase(fullName);
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

    // 2. Create a fresh customer. A customer profile needs a phone number (customers.phone is required).
    if (!normalizedPhone && !(await customerPhoneOptional(branchId))) {
      return { data: null, error: { code: 'PHONE_REQUIRED', message: 'A phone number is required to add a customer.' } };
    }
    const { data: created, error: insertErr } = await supabase
      .from('customers')
      .insert({
        org_id: orgId,
        branch_id: branchId,
        full_name: fullName,
        phone: normalizedPhone || null,   // NULL, never a placeholder (org setting require_customer_phone = false)
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
      // Deposit transactions across all memberships can exceed the PostgREST
      // 1000-row cap — paginate. Preserves the original swallow-on-error
      // behavior: a failure here degrades cycleDeposited, it doesn't fail the page.
      let depositTxns = null;
      try {
        depositTxns = await fetchAllPages((opts) =>
          supabase
            .from('membership_transactions')
            .select('membership_id, amount, notes, created_at', opts)
            .in('membership_id', membershipIds)
            .eq('kind', 'deposit')
            .order('created_at', { ascending: true })
            .order('id') // tiebreaker — created_at is not unique
        );
      } catch (txnError) {
        depositTxns = null;
      }
      const cycleDeposited = depositTxns === null ? new Map() : computeCycleDeposited(depositTxns);
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
        customer:customers ( id, full_name, phone, email, gender, date_of_birth ),
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
        performer:users!performed_by ( id, full_name ),
        branch:branches ( id, name ),
        booking:bookings ( id, booking_number, service_name_snapshot, therapist:therapists ( id, name ) )
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

    // Org-wide membership_transactions can exceed the PostgREST 1000-row cap
    // (confirmed 1,311 at Nuad Thai Spa) — paginate.
    const data = await fetchAllPages((opts) =>
      supabase
        .from('membership_transactions')
        .select(`
          id, membership_id, kind, amount, notes, created_at, booking_id, voucher_payment_id,
          membership:memberships (
            membership_number,
            customer:customers ( full_name ),
            tier:membership_tiers ( name )
          ),
          booking:bookings ( service_name_snapshot )
        `, opts)
        .order('membership_id', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id') // tiebreaker — 245 tied (membership_id, created_at) groups in prod;
                     // running balances corrupt if a row repeats or vanishes
    );

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
          // Voucher-purchase deductions have no booking to name a service from —
          // notes carries the per-voucher code (e.g. "Voucher purchase: NT 4326-0041"),
          // which would fragment this report into one bogus "service" per voucher
          // instead of grouping as a single recognizable category.
          service: row.voucher_payment_id ? 'Voucher purchase' : (row.booking?.service_name_snapshot || row.notes || 'Other'),
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

// Org-wide wallet activity feed (Memberships > Wallet activity, V21): every ledger row between two Nepal dates (inclusive), newest
// first, with the member, tier, booking (number, service, therapist), who recorded it and the payment mode. RLS decides what the
// caller can see; the date bounds keep the read small.
export async function fetchMembershipActivity({ from, to }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!from || !to) return { data: null, error: { code: 'INVALID_INPUT', message: 'from and to are required.' } };
    const nextDay = (d) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd + 1)); return t.toISOString().slice(0, 10); };
    const { data, error } = await supabase
      .from('membership_transactions')
      .select(`
        id, membership_id, kind, amount, payment_mode, notes, created_at, booking_id, voucher_payment_id,
        performer:users!performed_by ( id, full_name ),
        branch:branches ( id, name ),
        booking:bookings ( id, booking_number, service_name_snapshot, therapist:therapists ( id, name ) ),
        membership:memberships ( id, membership_number, tier_id, customer:customers ( id, full_name ), tier:membership_tiers ( id, name ) )
      `)
      .gte('created_at', `${from}T00:00:00+05:45`)
      .lt('created_at', `${nextDay(to)}T00:00:00+05:45`)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw error;
    const rows = (data || []).map((r) => ({
      id: r.id,
      membershipId: r.membership_id,
      kind: r.kind,
      amount: Number(r.amount || 0),
      paymentMode: r.payment_mode || null,
      notes: r.notes || null,
      createdAt: r.created_at,
      bookingNumber: r.booking?.booking_number || null,
      service: r.voucher_payment_id ? 'Voucher purchase' : (r.booking?.service_name_snapshot || null),
      therapistName: r.booking?.therapist?.name || null,
      performerId: r.performer?.id || null,
      performerName: r.performer?.full_name || null,
      branchName: r.branch?.name || null,
      memberName: r.membership?.customer?.full_name || '—',
      cardNo: r.membership?.membership_number || null,
      tierId: r.membership?.tier_id || null,
      tierName: r.membership?.tier?.name || null,
    }));
    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchMembershipActivity error:', error.message);
    return { data: null, error };
  }
}

// Member discount at checkout (V22): for each booking in a checkout, what the member-discount rule needs, read fresh from the
// DB (callers pass booking objects in many shapes): amounts, discount, paid so far, status, the service's category, and the
// customer's latest membership with its tier rules. Returns { [bookingId]: { booking, membership } }.
export async function fetchMemberDiscountContext(bookingIds) {
  try {
    const ids = [...new Set((bookingIds || []).filter(Boolean))];
    if (!ids.length) return { data: {}, error: null };
    const [bRes, pRes] = await Promise.all([
      supabase.from('bookings')
        .select('id, customer_id, status, is_locked, payment_status, base_amount, discount_amount, discount_status, discount_reason, discount_approved_by, updated_at, member_discount, final_amount, approver:users!discount_approved_by ( id, full_name ), service:services ( id, name, category, duration_minutes )')
        .in('id', ids),
      supabase.from('payments').select('booking_id, amount').in('booking_id', ids),
    ]);
    if (bRes.error) throw bRes.error;
    if (pRes.error) throw pRes.error;
    const paid = new Map();
    (pRes.data || []).forEach((p) => paid.set(p.booking_id, Math.round(((paid.get(p.booking_id) || 0) + Number(p.amount || 0)) * 100) / 100));
    const customerIds = [...new Set((bRes.data || []).map((b) => b.customer_id).filter(Boolean))];
    const latest = new Map();
    if (customerIds.length) {
      const { data: mRows, error: mErr } = await supabase
        .from('memberships')
        .select(`
          id, org_id, customer_id, tier_id, membership_number, total_deposited, balance,
          activation_date, expiry_date, birthday_perk_used_at, notes, created_by, created_at,
          tier:membership_tiers ( id, name, code_prefix, advance_amount, validity_days, discount_rules )
        `)
        .in('customer_id', customerIds)
        .order('created_at', { ascending: false });
      if (mErr) throw mErr;
      (mRows || []).forEach((m) => { if (!latest.has(m.customer_id)) latest.set(m.customer_id, transformMembership(m)); });
    }
    const out = {};
    (bRes.data || []).forEach((b) => {
      out[b.id] = {
        booking: {
          id: b.id,
          status: b.status,
          isLocked: !!b.is_locked,
          paymentStatus: b.payment_status,
          baseAmount: Number(b.base_amount || 0),
          discountAmount: Number(b.discount_amount || 0),
          discountStatus: b.discount_status,
          discountReason: b.discount_reason,
          memberDiscount: b.member_discount || null,
          approvedByName: b.approver?.full_name || null,
          updatedAt: b.updated_at || null,
          finalAmount: Number(b.final_amount || 0),
          amountPaid: paid.get(b.id) || 0,
          serviceCategory: b.service?.category || null,
          serviceName: b.service?.name || null,
          serviceMinutes: b.service?.duration_minutes || null,
        },
        membership: b.customer_id ? latest.get(b.customer_id) || null : null,
      };
    });
    return { data: out, error: null };
  } catch (error) {
    console.error('[API] fetchMemberDiscountContext error:', error.message);
    return { data: null, error };
  }
}

// Save (or remove) the member discount on one booking — apply_member_discount() (migration-343) checks membership, tier rate,
// branch access and the paid cap server-side; the rate never comes from the client.
export async function applyMemberDiscount({ bookingId, remove = false }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.rpc('apply_member_discount', { p_booking_id: bookingId, p_remove: !!remove });
    if (error) throw error;
    capture(remove ? 'member_discount_removed' : 'member_discount_applied', { booking_id: bookingId, pct: data?.pct ?? null });
    return { data, error: null };
  } catch (error) {
    console.error('[API] applyMemberDiscount error:', error.message);
    return { data: null, error: { ...error, message: friendlyMemberDiscountError(error.message) } };
  }
}
const friendlyMemberDiscountError = (msg) => {
  const m = String(msg || '');
  const text = m.replace(/^[A-Z_]+:\s*/, '');
  return text || 'Could not apply the member discount.';
};

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
        customer:customers ( id, full_name, phone, email, gender, date_of_birth ),
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
        customer:customers ( id, full_name, phone, email, gender, date_of_birth ),
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

// Every membership row this customer has ever had (current + past/expired) —
// getCustomerMembership only returns the single latest row, which is right
// for the wallet card but hides an older plan they bought and let expire
// before enrolling in the current one. Used for the "Past memberships"
// history list on the /account membership detail popup.
export async function getCustomerMembershipHistory(customerId) {
  try {
    if (!customerId) return { data: [], error: null };
    const { data, error } = await supabaseCustomer
      .from('memberships')
      .select(`
        id, membership_number, total_deposited, balance,
        activation_date, expiry_date, created_at,
        tier:membership_tiers ( id, name )
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] getCustomerMembershipHistory error:', error.message);
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
        performed_by, notes, created_at,
        branch:branches ( id, name ),
        booking:bookings ( id, service_name_snapshot, date )
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

export async function enrollMember({ customerId, tierId, initialDeposit, paymentMode, notes = null, branchId = null, activationDate = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('enroll_member', {
      p_customer_id: customerId,
      p_tier_id: tierId,
      p_initial_deposit: initialDeposit,
      p_payment_mode: paymentMode,
      p_notes: notes,
      p_branch_id: isOverallBranch(branchId) ? null : branchId,
      p_activation_date: activationDate,
    });
    if (error) throw error;
    capture('staff_membership_enrolled', { tier_id: tierId, initial_deposit: initialDeposit, payment_mode: paymentMode });
    return { data: { membershipId: data }, error: null };
  } catch (error) {
    console.error('[API] enrollMember error:', error.message);
    return { data: null, error };
  }
}

export async function topUpMembership({ membershipId, amount, paymentMode, notes = null, branchId = null, backdatedAt = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // backdatedAt routes through migration-236's admin-only RPC instead — see
    // adjustMembership below for the same pattern.
    const { data, error } = backdatedAt
      ? await supabase.rpc('record_membership_transaction_backdated', {
          p_membership_id: membershipId,
          p_kind: 'deposit',
          p_amount: amount,
          p_payment_mode: paymentMode,
          p_notes: notes,
          p_branch_id: isOverallBranch(branchId) ? null : branchId,
          p_backdated_at: backdatedAt,
        })
      : await supabase.rpc('record_membership_transaction', {
          p_membership_id: membershipId,
          p_kind: 'deposit',
          p_amount: amount,
          p_payment_mode: paymentMode,
          p_booking_id: null,
          p_payment_id: null,
          p_notes: notes,
          p_branch_id: isOverallBranch(branchId) ? null : branchId,
        });
    if (error) throw error;
    capture('staff_membership_topup', { membership_id: membershipId, amount, payment_mode: paymentMode, backdated: !!backdatedAt });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] topUpMembership error:', error.message);
    return { data: null, error };
  }
}

// Renews a depleted/lapsed membership: records the deposit AND starts a fresh
// validity cycle from today (optionally on a different tier) -- unlike
// topUpMembership, which just adds to the balance without touching dates.
export async function renewMembership({ membershipId, amount, paymentMode, tierId = null, notes = null, branchId = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('renew_membership', {
      p_membership_id: membershipId,
      p_amount: amount,
      p_payment_mode: paymentMode,
      p_tier_id: tierId,
      p_notes: notes,
      p_branch_id: isOverallBranch(branchId) ? null : branchId,
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
export async function extendMembership({ membershipId, newExpiryDate, notes = null, branchId = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase.rpc('extend_membership', {
      p_membership_id: membershipId,
      p_new_expiry_date: newExpiryDate,
      p_notes: notes,
      p_branch_id: isOverallBranch(branchId) ? null : branchId,
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

export async function giftBirthdayPerk({ membershipId, notes = null, branchId = null }) {
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
      p_branch_id: isOverallBranch(branchId) ? null : branchId,
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
export async function adjustMembership({ membershipId, amount, notes, branchId = null, backdatedAt = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // backdatedAt routes through migration-236's record_membership_transaction_backdated
    // (admin-only, every kind, required backdated date) instead of the shared RPC —
    // see that migration's header for why it's a separate function.
    const { data, error } = backdatedAt
      ? await supabase.rpc('record_membership_transaction_backdated', {
          p_membership_id: membershipId,
          p_kind: 'adjustment',
          p_amount: amount,
          p_payment_mode: null,
          p_notes: notes,
          p_branch_id: isOverallBranch(branchId) ? null : branchId,
          p_backdated_at: backdatedAt,
        })
      : await supabase.rpc('record_membership_transaction', {
          p_membership_id: membershipId,
          p_kind: 'adjustment',
          p_amount: amount,
          p_payment_mode: null,
          p_booking_id: null,
          p_payment_id: null,
          p_notes: notes,
          p_branch_id: isOverallBranch(branchId) ? null : branchId,
        });
    if (error) throw error;
    capture('staff_membership_adjusted', { membership_id: membershipId, amount, backdated: !!backdatedAt });
    return { data: { transactionId: data }, error: null };
  } catch (error) {
    console.error('[API] adjustMembership error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// VOUCHERS (migration-071) — manager/admin only, RLS-enforced.
// ============================================================

// One voucher as the Vouchers page uses it (V23). Since migration-344 total_amount_issued is the VALUE and amount_paid what
// was collected. vouchers has two FKs to customers (For and Bought by), so each embed names its FK.
const VOUCHER_ROW_SELECT = `
  id, voucher_code, issued_date, expiry_date, guest_name, guest_info, customer_id,
  actual_price, discount_percent, total_amount_issued, amount_paid, issue_kind, free_reason, free_note,
  buyer_name, buyer_phone, buyer_customer_id, percent_off, needs_check, last_reminded_at, remarks, created_at, issued_by,
  branch:branches ( id, name ),
  voucher_type:voucher_types ( id, name, is_wallet ),
  issuer:users!issued_by ( id, full_name ),
  customer:customers!vouchers_customer_id_fkey ( id, full_name, phone ),
  buyer:customers!vouchers_buyer_customer_id_fkey ( id, full_name, phone )
`;
const toVoucherRow = (v, balance = {}, couponUsed = false) => ({
  id: v.id,
  voucherCode: v.voucher_code,
  issuedDate: v.issued_date,
  expiryDate: v.expiry_date,
  createdAt: v.created_at,
  guestName: v.guest_name,
  guestInfo: v.guest_info,
  customerId: v.customer?.id || v.customer_id || null,
  customerName: v.customer?.full_name || null,
  customerPhone: v.customer?.phone || null,
  buyerName: v.buyer_name || v.buyer?.full_name || null,
  buyerPhone: v.buyer_phone || null,
  buyerCustomerId: v.buyer?.id || v.buyer_customer_id || null,
  buyerCustomerPhone: v.buyer?.phone || null,
  branchId: v.branch?.id || null,
  branchName: v.branch?.name || '—',
  voucherTypeId: v.voucher_type?.id || null,
  voucherTypeName: v.voucher_type?.name || '—',
  isWallet: !!v.voucher_type?.is_wallet,
  actualPrice: Number(v.actual_price || 0),
  discountPercent: Number(v.discount_percent || 0),
  totalAmountIssued: Number(v.total_amount_issued || 0),
  amountPaid: Number(v.amount_paid || 0),
  issueKind: v.issue_kind || 'sold',
  freeReason: v.free_reason || null,
  freeNote: v.free_note || null,
  percentOff: v.percent_off != null ? Number(v.percent_off) : null,
  couponUsed,
  needsCheck: !!v.needs_check,
  lastRemindedAt: v.last_reminded_at || null,
  remarks: v.remarks,
  issuedById: v.issuer?.id || v.issued_by || null,
  issuedByName: v.issuer?.full_name || '—',
  totalClaimed: Number(balance?.total_claimed || 0),
  remainingBalance: balance?.remaining_balance != null ? Number(balance.remaining_balance) : Number(v.total_amount_issued || 0),
  status: balance?.status || 'unused',
  lastClaimDate: balance?.last_claim_date || null,
});

const voucherTypeInputError = ({ name, codePrefix, standardPrice, category, percentOff, defaultIssueKind }) => {
  if (!name?.trim()) return { code: 'INVALID_INPUT', message: 'Voucher type name is required.' };
  if (!codePrefix?.trim()) return { code: 'INVALID_INPUT', message: 'Code prefix is required.' };
  if (percentOff != null && percentOff !== '' && !(Number(percentOff) >= 1 && Number(percentOff) <= 100)) {
    return { code: 'INVALID_INPUT', message: 'The % off must be between 1 and 100.' };
  }
  if (!percentOff && !(Number(standardPrice) >= 0)) return { code: 'INVALID_INPUT', message: 'Standard price must be zero or greater.' };
  if (!['spa', 'salon', 'body_scrub', 'package'].includes(category)) {
    return { code: 'INVALID_INPUT', message: 'Category must be one of spa, salon, body_scrub, package.' };
  }
  if (!['sold', 'free'].includes(defaultIssueKind)) return { code: 'INVALID_INPUT', message: 'Usually must be sold or free.' };
  return null;
};

const voucherRpc = async (fn, params, event) => {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw error;
    capture(event, { voucher_id: params.p_voucher_id });
    return { data, error: null };
  } catch (error) {
    console.error(`[API] ${fn} error:`, error.message);
    return { data: null, error };
  }
};

export async function fetchVoucherTypes({ includeInactive = false } = {}) {
  try {
    let query = supabase
      .from('voucher_types')
      .select('id, name, code_prefix, standard_price, is_wallet, is_active, display_order, category, default_issue_kind, percent_off')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
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
export async function fetchVouchers(customerId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    let vouchersQuery = supabase
      .from('vouchers')
      .select(VOUCHER_ROW_SELECT)
      .order('guest_name', { ascending: true });
    if (customerId) vouchersQuery = vouchersQuery.eq('customer_id', customerId); // optional: one customer's vouchers (Customers side panel)

    const [vouchersRes, balancesRes, couponsRes] = await Promise.all([
      vouchersQuery,
      supabase
        .from('voucher_balances')
        .select('voucher_id, total_claimed, remaining_balance, status, last_claim_date'),
      supabase.from('voucher_events').select('voucher_id').eq('kind', 'coupon_used'),
    ]);
    if (vouchersRes.error) throw vouchersRes.error;
    if (balancesRes.error) throw balancesRes.error;
    if (couponsRes.error) throw couponsRes.error;

    const balanceByVoucher = new Map((balancesRes.data || []).map((b) => [b.voucher_id, b]));
    const couponUsed = new Set((couponsRes.data || []).map((e) => e.voucher_id));
    const rows = (vouchersRes.data || []).map((v) => toVoucherRow(v, balanceByVoucher.get(v.id), couponUsed.has(v.id)));

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
  issueKind = 'sold', freeReason = null, freeNote = null, buyerName = null, buyerPhone = null, buyerCustomerId = null,
}) {
  try {
    guestName = toTitleCase(guestName);
    buyerName = buyerName ? toTitleCase(buyerName) : null;
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // Whether an empty tenders array is valid depends on what is paid (value
    // minus discount; nothing for a free voucher). That's the RPC's call to
    // make (issue_voucher, migration-344): it knows the resolved price,
    // this wrapper doesn't (actualPrice can be null here, falling back to
    // the voucher type's standard_price server-side). Don't duplicate/guess
    // that check here — let the RPC be the single source of truth.
    const cleanedTenders = (Array.isArray(tenders) ? tenders : [])
      .filter((t) => Number(t.amount) > 0 && t.paymentMode)
      .map((t) => ({ amount: Number(t.amount), payment_mode: t.paymentMode }));

    const { data, error } = await supabase.rpc('issue_voucher', {
      p_branch_id: branchId,
      p_voucher_type_id: voucherTypeId,
      p_guest_name: guestName,
      p_guest_info: guestInfo,
      p_discount_percent: issueKind === 'free' ? 0 : discountPercent,
      p_actual_price: actualPrice,
      p_issued_date: issuedDate,
      p_expiry_date: expiryDate,
      p_remarks: remarks,
      p_customer_id: customerId,
      p_tenders: issueKind === 'free' ? [] : cleanedTenders,
      // Temporary — manual entry to match pre-printed voucher booklets.
      // See migration-139-voucher-manual-code.sql.
      p_voucher_code: voucherCode,
      p_issue_kind: issueKind,
      p_free_reason: issueKind === 'free' ? freeReason : null,
      p_free_note: issueKind === 'free' ? freeNote : null,
      p_buyer_name: buyerName,
      p_buyer_phone: buyerPhone,
      p_buyer_customer_id: buyerCustomerId,
    });
    if (error) {
      // Cosmetic only — the RPC (issue_voucher, migration-344) is still the
      // sole authority on whether tenders are actually required (depends on
      // the resolved price); this just swaps its raw "issue_voucher: ..."
      // exception text for the friendlier client-facing wording that used to
      // come from this wrapper's own (now-removed) redundant check.
      if (error.message?.includes('at least one payment tender is required')) {
        return { data: null, error: { code: 'TENDERS_REQUIRED', message: 'At least one payment tender is required.' } };
      }
      throw error;
    }
    capture('voucher_issued', { voucher_type_id: voucherTypeId, branch_id: branchId, linked_to_customer: !!customerId, issue_kind: issueKind, gift: !!buyerName });
    return { data, error: null };
  } catch (error) {
    console.error('[API] issueVoucher error:', error.message);
    return { data: null, error };
  }
}

// Admin-only quick-add for voucher types, used inline from the voucher issuance
// flow (NewVoucherModal) — no RPC needed, voucher_types RLS ("Admin can manage
// voucher types") already restricts writes to admin.
export async function createVoucherType({ orgId, name, codePrefix, standardPrice, category, percentOff = null, defaultIssueKind = 'sold', displayOrder = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!orgId)              return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId is required.' } };
    const invalid = voucherTypeInputError({ name, codePrefix, standardPrice, category, percentOff, defaultIssueKind });
    if (invalid) return { data: null, error: invalid };

    const { data, error } = await supabase
      .from('voucher_types')
      .insert({
        org_id: orgId,
        name: name.trim(),
        code_prefix: codePrefix.trim().toUpperCase(),
        standard_price: percentOff ? 0 : Number(standardPrice),
        category,
        percent_off: percentOff ? Number(percentOff) : null,
        default_issue_kind: defaultIssueKind,
        is_active: true,
        ...(displayOrder != null ? { display_order: displayOrder } : {}),
      })
      .select('id, name, code_prefix, standard_price, is_wallet, is_active, display_order, category, default_issue_kind, percent_off')
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
        voucher_type:voucher_types ( id, name, is_wallet ),
        branch:branches ( id, name )
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

// Per-voucher redemption history for the /account voucher detail popup —
// same RLS shape as getCustomerVouchers (customer reads own voucher claims
// via the vouchers.customer_id chain), just the raw claim rows instead of
// the aggregated voucher_balances view.
export async function getCustomerVoucherClaims(voucherIds) {
  try {
    if (!voucherIds || voucherIds.length === 0) return { data: [], error: null };

    const { data, error } = await supabaseCustomer
      .from('voucher_claims')
      .select(`
        id, voucher_id, redeemed_date, service_claimed, amount_claimed, notes,
        branch:branches!branch_claimed_id ( id, name )
      `)
      .in('voucher_id', voucherIds)
      .order('redeemed_date', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] getCustomerVoucherClaims error:', error.message);
    return { data: null, error };
  }
}

// Customer-session counterpart of getActivePackagesForCustomer, but unscoped
// to a single service — this is the full "my packages" list for /account,
// not a booking-flow redemption picker. package_balances is a view, so it
// can't be embedded via FK the way voucher_type is above — query then merge,
// same two-step shape as getCustomerVouchers.
export async function getCustomerPackages(customerId) {
  try {
    if (!customerId) return { data: [], error: null };

    const { data: packages, error } = await supabaseCustomer
      .from('packages')
      .select(`
        id, package_code, issued_date, expiry_date, paid_amount, sessions_total, remarks,
        service_id, package_type:package_type_id ( id, name ), service:service_id ( id, name ),
        branch:branches ( id, name )
      `)
      .eq('customer_id', customerId)
      .order('issued_date', { ascending: false });
    if (error) throw error;
    if (!packages || packages.length === 0) return { data: [], error: null };

    const { data: balances, error: balanceError } = await supabaseCustomer
      .from('package_balances')
      .select('package_id, sessions_used, sessions_remaining, status, last_redeemed_date')
      .in('package_id', packages.map((p) => p.id));
    if (balanceError) throw balanceError;

    const balanceByPackage = new Map((balances || []).map((b) => [b.package_id, b]));
    const merged = packages.map((p) => ({ ...p, ...(balanceByPackage.get(p.id) || {}) }));
    return { data: merged, error: null };
  } catch (error) {
    console.error('[API] getCustomerPackages error:', error.message);
    return { data: null, error };
  }
}

// Per-package redemption history for the /account package detail popup —
// same RLS shape as getCustomerVoucherClaims (customer reads own
// package_redemptions via the packages.customer_id chain, granted in
// migration-175), just raw redemption rows instead of the aggregated
// package_balances view.
export async function getCustomerPackageRedemptions(packageIds) {
  try {
    if (!packageIds || packageIds.length === 0) return { data: [], error: null };

    const { data, error } = await supabaseCustomer
      .from('package_redemptions')
      .select(`
        id, package_id, redeemed_date, notes,
        branch:branches ( id, name )
      `)
      .in('package_id', packageIds)
      .order('redeemed_date', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] getCustomerPackageRedemptions error:', error.message);
    return { data: null, error };
  }
}

export async function getCustomerReferralStats(customerId) {
  try {
    if (!customerId) return { data: null, error: null };

    const { data, error } = await supabaseCustomer
      .from('customer_referrals')
      .select(`
        id, reward_status, reward_amount, reward_type, reward_label, created_at, credited_at,
        booking:bookings!customer_referrals_booking_id_fkey ( id, service_name_snapshot, date )
      `)
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
    guestNameUsedBy = toTitleCase(guestNameUsedBy);
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

    const [voucherRes, balanceRes, couponRes] = await Promise.all([
      supabase
        .from('vouchers')
        .select(`${VOUCHER_ROW_SELECT}, customer_email:customers!vouchers_customer_id_fkey ( email )`)
        .eq('id', voucherId)
        .single(),
      supabase
        .from('voucher_balances')
        .select('total_claimed, remaining_balance, status, last_claim_date')
        .eq('voucher_id', voucherId)
        .maybeSingle(),
      supabase.from('voucher_events').select('id').eq('voucher_id', voucherId).eq('kind', 'coupon_used').limit(1),
    ]);
    if (voucherRes.error) throw voucherRes.error;

    const v = voucherRes.data;
    return {
      data: { ...toVoucherRow(v, balanceRes.data, (couponRes.data || []).length > 0), customerEmail: v.customer_email?.email || null },
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
        id, redeemed_date, guest_name_used_by, service_claimed, amount_claimed, notes, created_at, is_legacy, payment_id,
        branch:branches ( id, name ),
        booking:bookings ( id, booking_number ),
        performer:users!performed_by ( id, full_name )
      `)
      .eq('voucher_id', voucherId)
      .order('redeemed_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchVoucherClaims error:', error.message);
    return { data: null, error };
  }
}

// The rest of one voucher's story for its panel: what was paid (voucher_payments), its events (extended, reminded, linked,
// coupon used, review checks) and admin balance corrections (audit_logs, written by admin_correct_voucher_balance).
export async function fetchVoucherHistory(voucherId) {
  try {
    const [paymentsRes, eventsRes, auditRes] = await Promise.all([
      supabase.from('voucher_payments').select('id, amount, payment_mode, created_at').eq('voucher_id', voucherId).order('created_at'),
      supabase
        .from('voucher_events')
        .select('id, kind, old_expiry, new_expiry, note, created_at, booking:bookings ( id, booking_number ), performer:users!performed_by ( id, full_name )')
        .eq('voucher_id', voucherId)
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_logs')
        .select('id, old_data, new_data, reason, changed_at, changer:users!changed_by ( id, full_name )')
        .eq('table_name', 'vouchers')
        .eq('action_type', 'ADMIN_CORRECTION')
        .eq('record_id', voucherId)
        .order('changed_at', { ascending: false }),
    ]);
    if (paymentsRes.error) throw paymentsRes.error;
    if (eventsRes.error) throw eventsRes.error;
    return {
      data: {
        payments: paymentsRes.data || [],
        events: eventsRes.data || [],
        // A manager can't read every branch's audit rows; corrections are a nice-to-have in the panel, so don't fail on them.
        corrections: auditRes.error ? [] : (auditRes.data || []),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchVoucherHistory error:', error.message);
    return { data: null, error };
  }
}

// Activity tab (V23): everything that happened to vouchers in a Nepal date range, as four raw lists for
// vouchersView.buildActivity(): vouchers handed out (with what was paid and how), claims (legacy ones flagged), events, and
// admin balance corrections. Amounts are voucher value; money taken is only on a sale's `paid`.
export async function fetchVoucherActivity({ from, to }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const fromTs = `${from}T00:00:00+05:45`;
    const toNext = new Date(Date.UTC(...to.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) + 86400000).toISOString().slice(0, 10);
    const toTs = `${toNext}T00:00:00+05:45`;
    const VOUCHER_BITS = 'id, voucher_code, guest_name, branch_id, percent_off, branch:branches ( id, name )';

    const [vouchersRes, claimsRes, eventsRes, auditRes] = await Promise.all([
      supabase
        .from('vouchers')
        .select(`id, voucher_code, guest_name, issued_date, created_at, total_amount_issued, amount_paid, issue_kind, free_reason, free_note, percent_off,
          discount_percent, issued_by, branch:branches ( id, name ), issuer:users!issued_by ( id, full_name ), payments:voucher_payments ( payment_mode )`)
        .gte('issued_date', from)
        .lte('issued_date', to),
      supabase
        .from('voucher_claims')
        .select(`id, voucher_id, redeemed_date, created_at, amount_claimed, service_claimed, is_legacy, booking_id, payment_id,
          branch:branches ( id, name ), booking:bookings ( booking_number ), performer:users!performed_by ( id, full_name ),
          voucher:vouchers ( voucher_code, guest_name )`)
        .gte('redeemed_date', from)
        .lte('redeemed_date', to),
      supabase
        .from('voucher_events')
        .select(`id, voucher_id, kind, old_expiry, new_expiry, note, created_at, booking:bookings ( booking_number ),
          performer:users!performed_by ( id, full_name ), voucher:vouchers ( ${VOUCHER_BITS} )`)
        .in('kind', ['extended', 'coupon_used', 'legacy_checked_used', 'legacy_checked_valid', 'legacy_check_undone'])
        .gte('created_at', fromTs)
        .lt('created_at', toTs),
      supabase
        .from('audit_logs')
        .select('id, record_id, old_data, new_data, reason, changed_at, changer:users!changed_by ( id, full_name )')
        .eq('table_name', 'vouchers')
        .eq('action_type', 'ADMIN_CORRECTION')
        .gte('changed_at', fromTs)
        .lt('changed_at', toTs),
    ]);
    if (vouchersRes.error) throw vouchersRes.error;
    if (claimsRes.error) throw claimsRes.error;
    if (eventsRes.error) throw eventsRes.error;

    // audit_logs has no FK to vouchers, so a correction outlives a deleted voucher: keep only those whose voucher still exists.
    const audits = auditRes.error ? [] : (auditRes.data || []);
    const auditIds = [...new Set(audits.map((a) => a.record_id).filter(Boolean))];
    let liveIds = new Set();
    if (auditIds.length) {
      const { data: live, error: liveError } = await supabase.from('vouchers').select('id').in('id', auditIds);
      if (!liveError) liveIds = new Set((live || []).map((v) => v.id));
    }

    // Corrections carry the voucher as JSON (old_data/new_data); its branch name comes from the branches we already know.
    const branchNames = new Map();
    (vouchersRes.data || []).forEach((v) => v.branch && branchNames.set(v.branch.id, v.branch.name));
    (claimsRes.data || []).forEach((c) => c.branch && branchNames.set(c.branch.id, c.branch.name));
    (eventsRes.data || []).forEach((e) => e.voucher?.branch && branchNames.set(e.voucher.branch.id, e.voucher.branch.name));

    return {
      data: {
        vouchers: (vouchersRes.data || []).map((v) => ({
          id: v.id, voucherCode: v.voucher_code, guestName: v.guest_name, issuedDate: v.issued_date, createdAt: v.created_at,
          totalAmountIssued: Number(v.total_amount_issued || 0), amountPaid: Number(v.amount_paid || 0), issueKind: v.issue_kind,
          freeReason: v.free_reason, freeNote: v.free_note, percentOff: v.percent_off != null ? Number(v.percent_off) : null,
          discountPercent: Number(v.discount_percent || 0), branchId: v.branch?.id || null, branchName: v.branch?.name || '—',
          issuedById: v.issuer?.id || v.issued_by || null, issuedByName: v.issuer?.full_name || '—',
          paymentModes: (v.payments || []).map((p) => p.payment_mode),
        })),
        claims: (claimsRes.data || []).map((c) => ({
          id: c.id, voucherId: c.voucher_id, guestName: c.voucher?.guest_name || '—', code: c.voucher?.voucher_code || '',
          redeemedDate: c.redeemed_date, createdAt: c.created_at, amountClaimed: Number(c.amount_claimed || 0), service: c.service_claimed,
          bookingNumber: c.booking?.booking_number || null, atCheckout: !!(c.payment_id || c.booking_id), isLegacy: !!c.is_legacy,
          branchId: c.branch?.id || null, branchName: c.branch?.name || '—', performerId: c.performer?.id || null, performerName: c.performer?.full_name || '',
        })),
        events: (eventsRes.data || []).map((e) => ({
          id: e.id, voucherId: e.voucher_id, kind: e.kind, oldExpiry: e.old_expiry, newExpiry: e.new_expiry, note: e.note, createdAt: e.created_at,
          bookingNumber: e.booking?.booking_number || null, guestName: e.voucher?.guest_name || '—', code: e.voucher?.voucher_code || '',
          percentOff: e.voucher?.percent_off != null ? Number(e.voucher.percent_off) : null,
          branchId: e.voucher?.branch?.id || null, branchName: e.voucher?.branch?.name || '—',
          performerId: e.performer?.id || null, performerName: e.performer?.full_name || '',
        })),
        // A manager only reads their own branches' audit rows; the feed still loads without the rest.
        corrections: audits.filter((a) => liveIds.has(a.record_id)).map((a) => ({
          id: a.id, voucherId: a.record_id, changedAt: a.changed_at, reason: a.reason,
          oldTotal: Number(a.old_data?.total_amount_issued || 0), newTotal: Number(a.new_data?.total_amount_issued || 0),
          guestName: a.new_data?.guest_name || '—', code: a.new_data?.voucher_code || '',
          branchId: a.new_data?.branch_id || null, branchName: branchNames.get(a.new_data?.branch_id) || '—',
          performerId: a.changer?.id || null, performerName: a.changer?.full_name || '',
        })),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchVoucherActivity error:', error.message);
    return { data: null, error };
  }
}

// Admin edit of a voucher type (V23 Voucher types tab). Direct update: voucher_types RLS ("Admin can manage voucher types")
// already limits writes to admins of the org. Changes only affect vouchers handed out from now on.
export async function updateVoucherType({ id, name, codePrefix, standardPrice, category, percentOff = null, defaultIssueKind = 'sold', isActive }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!id) return { data: null, error: { code: 'INVALID_INPUT', message: 'id is required.' } };
    const invalid = voucherTypeInputError({ name, codePrefix, standardPrice, category, percentOff, defaultIssueKind });
    if (invalid) return { data: null, error: invalid };

    const { data, error } = await supabase
      .from('voucher_types')
      .update({
        name: name.trim(),
        code_prefix: codePrefix.trim().toUpperCase(),
        standard_price: percentOff ? 0 : Number(standardPrice),
        category,
        percent_off: percentOff ? Number(percentOff) : null,
        default_issue_kind: defaultIssueKind,
        ...(isActive != null ? { is_active: !!isActive } : {}),
      })
      .eq('id', id)
      .select('id, name, code_prefix, standard_price, is_wallet, is_active, display_order, category, default_issue_kind, percent_off')
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateVoucherType error:', error.message);
    if (error.code === '23505') return { data: null, error: { code: 'DUPLICATE_NAME', message: `A voucher type named "${name.trim()}" already exists.` } };
    return { data: null, error };
  }
}

export async function setVoucherTypeActive({ id, isActive }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.from('voucher_types').update({ is_active: !!isActive }).eq('id', id).select('id, is_active').single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] setVoucherTypeActive error:', error.message);
    return { data: null, error };
  }
}

// migration-344 RPCs. Each checks the role and org itself; these wrappers only map arguments.
export async function extendVoucher({ voucherId, newExpiry, reason }) {
  return voucherRpc('extend_voucher', { p_voucher_id: voucherId, p_new_expiry: newExpiry, p_reason: reason }, 'voucher_extended');
}

export async function updateVoucherContact({ voucherId, guestName, guestInfo = null, customerId = null, buyerName = null, buyerPhone = null, buyerCustomerId = null }) {
  return voucherRpc('update_voucher_contact', {
    p_voucher_id: voucherId, p_guest_name: toTitleCase(guestName), p_guest_info: guestInfo, p_customer_id: customerId,
    p_buyer_name: buyerName ? toTitleCase(buyerName) : null, p_buyer_phone: buyerPhone, p_buyer_customer_id: buyerCustomerId,
  }, 'voucher_contact_updated');
}

export async function logVoucherReminder({ voucherId, note = null }) {
  return voucherRpc('log_voucher_reminder', { p_voucher_id: voucherId, p_note: note }, 'voucher_reminded');
}

export async function markCouponUsed({ voucherId, bookingId = null, note = null }) {
  return voucherRpc('mark_coupon_used', { p_voucher_id: voucherId, p_booking_id: bookingId, p_note: note }, 'voucher_coupon_used');
}

export async function checkLegacyVoucher({ voucherId, used }) {
  return voucherRpc('check_legacy_voucher', { p_voucher_id: voucherId, p_used: !!used }, 'voucher_legacy_checked');
}

export async function undoLegacyCheck({ voucherId }) {
  return voucherRpc('undo_legacy_check', { p_voucher_id: voucherId }, 'voucher_legacy_check_undone');
}

// Unlinked vouchers whose phone equals exactly one customer's (migration-344): Map voucherId → { customerId, customerName }.
export async function fetchVoucherCustomerMatches() {
  try {
    const { data, error } = await supabase.rpc('voucher_customer_matches');
    if (error) throw error;
    return { data: new Map((data || []).map((r) => [r.voucher_id, { customerId: r.customer_id, customerName: r.customer_name }])), error: null };
  } catch (error) {
    console.error('[API] fetchVoucherCustomerMatches error:', error.message);
    return { data: new Map(), error };
  }
}

// Booking id for a booking number (the coupon "Mark used" field), within what the caller can read.
export async function findBookingIdByNumber(bookingNumber) {
  try {
    const n = String(bookingNumber || '').trim().toUpperCase();
    if (!n) return { data: null, error: null };
    const { data, error } = await supabase.from('bookings').select('id, booking_number').eq('booking_number', n).maybeSingle();
    if (error) throw error;
    return { data: data || null, error: null };
  } catch (error) {
    console.error('[API] findBookingIdByNumber error:', error.message);
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

// Staff-facing "Gift Vouchers" tab on the customer detail page — every
// voucher issued to this specific customer (not just wallet-type, unlike
// fetchVoucherWallets), via the real vouchers.customer_id column.
export async function fetchVouchersForCustomer(customerId) {
  try {
    if (!customerId) return { data: [], error: null };

    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data: vouchers, error: vouchersError } = await supabase
      .from('vouchers')
      .select(`
        id, voucher_code, issued_date, expiry_date, guest_name, guest_info,
        total_amount_issued, remarks,
        branch:branches ( id, name ),
        voucher_type:voucher_types ( id, name, is_wallet ),
        issuer:users!issued_by ( id, full_name )
      `)
      .eq('customer_id', customerId)
      .order('issued_date', { ascending: false });
    if (vouchersError) throw vouchersError;
    if (!vouchers || vouchers.length === 0) return { data: [], error: null };

    const { data: balances, error: balancesError } = await supabase
      .from('voucher_balances')
      .select('voucher_id, total_claimed, remaining_balance, status, last_claim_date')
      .in('voucher_id', vouchers.map((v) => v.id));
    if (balancesError) throw balancesError;

    const balanceByVoucher = new Map((balances || []).map((b) => [b.voucher_id, b]));

    const rows = vouchers.map((v) => {
      const balance = balanceByVoucher.get(v.id) || {};
      return {
        id: v.id,
        voucherCode: v.voucher_code,
        voucherTypeName: v.voucher_type?.name || '—',
        issuedDate: v.issued_date,
        expiryDate: v.expiry_date,
        issuedBranchName: v.branch?.name || '—',
        issuedByName: v.issuer?.full_name || '—',
        totalAmountIssued: Number(v.total_amount_issued || 0),
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
    console.error('[API] fetchVouchersForCustomer error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// SERVICE PACKAGES (migration-141) — manager/admin issue; staff/manager/
// admin can read (redemption is a staff-facing action). Mirrors the
// vouchers pattern above, structurally, but each package is bound to
// exactly one service_id and tracks *sessions*, not a monetary balance.
// ============================================================

// Active types only by default (the Sell package dropdown); the Package types tab passes includeInactive to list hidden ones too.
const PACKAGE_TYPE_SELECT = 'id, name, service_id, default_sessions, standard_price, validity_days, is_active, display_order, service:services ( id, name, duration_minutes, price_npr )';

export async function fetchPackageTypes({ includeInactive = false } = {}) {
  try {
    let query = supabase
      .from('package_types')
      .select(PACKAGE_TYPE_SELECT)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchPackageTypes error:', error.message);
    return { data: null, error };
  }
}

// Empty sessions = open (set when selling); empty price = set at sale. Validity defaults to a year.
const blank = (v) => v == null || String(v).trim() === '';
function checkPackageTypeNumbers({ defaultSessions, standardPrice, validityDays }) {
  const sessions = blank(defaultSessions) ? null : Number(defaultSessions);
  if (sessions != null && (!Number.isInteger(sessions) || sessions <= 0)) {
    return { error: { code: 'INVALID_INPUT', message: 'Sessions must be a whole number greater than zero, or left empty.' } };
  }
  const price = blank(standardPrice) ? null : Number(standardPrice);
  if (price != null && !(price >= 0)) return { error: { code: 'INVALID_INPUT', message: 'Price must be zero or greater, or left empty.' } };
  const validity = blank(validityDays) ? 365 : Number(validityDays);
  if (!Number.isInteger(validity) || validity <= 0) {
    return { error: { code: 'INVALID_INPUT', message: 'Valid for must be a whole number of days greater than zero.' } };
  }
  return { sessions, price, validity };
}

// Admin-only quick-add for package types, used inline from the package
// issuance flow (NewPackageModal) — no RPC needed, package_types RLS
// ("Admin can manage package types") already restricts writes to admin.
// Mirrors createVoucherType.
export async function createPackageType({ orgId, name, serviceId, defaultSessions, standardPrice, validityDays }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!orgId)      return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId is required.' } };
    if (!name?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Package type name is required.' } };
    if (!serviceId)  return { data: null, error: { code: 'INVALID_INPUT', message: 'A service is required.' } };
    const checked = checkPackageTypeNumbers({ defaultSessions, standardPrice, validityDays });
    if (checked.error) return { data: null, error: checked.error };
    const { sessions, price, validity } = checked;

    const { data, error } = await supabase
      .from('package_types')
      .insert({
        org_id: orgId,
        service_id: serviceId,
        name: name.trim(),
        default_sessions: sessions,
        standard_price: price,
        validity_days: validity,
        is_active: true,
      })
      .select(PACKAGE_TYPE_SELECT)
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] createPackageType error:', error.message);
    return { data: null, error };
  }
}

// Admin-only edit of a package type (the Package types tab). Only the fields passed are changed, so the On sale switch can send
// just { id, isActive }. Packages already sold keep their own sessions / price / expiry (they are copied at sale).
export async function updatePackageType({ id, name, serviceId, defaultSessions, standardPrice, validityDays, isActive }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!id) return { data: null, error: { code: 'INVALID_INPUT', message: 'id is required.' } };

    const patch = {};
    if (name !== undefined) {
      if (!name?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Package type name is required.' } };
      patch.name = name.trim();
    }
    if (serviceId !== undefined) {
      if (!serviceId) return { data: null, error: { code: 'INVALID_INPUT', message: 'A service is required.' } };
      patch.service_id = serviceId;
    }
    if (defaultSessions !== undefined || standardPrice !== undefined || validityDays !== undefined) {
      const checked = checkPackageTypeNumbers({ defaultSessions, standardPrice, validityDays });
      if (checked.error) return { data: null, error: checked.error };
      if (defaultSessions !== undefined) patch.default_sessions = checked.sessions;
      if (standardPrice !== undefined) patch.standard_price = checked.price;
      if (validityDays !== undefined) patch.validity_days = checked.validity;
    }
    if (isActive !== undefined) patch.is_active = !!isActive;
    if (!Object.keys(patch).length) return { data: null, error: { code: 'INVALID_INPUT', message: 'Nothing to update.' } };

    const { data, error } = await supabase
      .from('package_types')
      .update(patch)
      .eq('id', id)
      .select(PACKAGE_TYPE_SELECT)
      .maybeSingle();
    if (error) throw error;
    // RLS hides the row from non-admins, so an update that matched nothing comes back empty rather than as an error.
    if (!data) return { data: null, error: { code: 'NOT_ALLOWED', message: 'Only an admin can change package types.' } };
    return { data, error: null };
  } catch (error) {
    console.error('[API] updatePackageType error:', error.message);
    return { data: null, error };
  }
}

export async function issuePackage({
  orgId, branchId, packageTypeId, customerId = null, guestName = null,
  guestInfo = null, issuedDate = null, expiryDate = null, paidAmount = null,
  sessionsTotal = null, remarks = null, discountType = null, discountValue = null,
  dueHolderName = null, paymentMethod = null,
}) {
  try {
    guestName = toTitleCase(guestName);
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // Look up or create a customer record when the guest wasn't picked from
    // CustomerAutocomplete's suggestions — same reasoning/mechanism as
    // createBooking's step 6: a free-typed guest name otherwise never links
    // to a `customers` row, making that person invisible to customer search
    // and every other booking flow even though their phone is on file
    // (guestInfo). Non-blocking: a lookup/create failure never prevents
    // issuing the package, it just proceeds guest-only like before.
    if (!customerId && guestName) {
      try {
        const phone = toE164(guestInfo);
        if (orgId && phone) {
          const { data: existingCustomer } = await supabase
            .rpc('find_customer_for_booking', { p_org_id: orgId, p_phone: phone, p_email: null })
            .maybeSingle();
          if (existingCustomer) {
            customerId = existingCustomer.id;
            await supabase
              .from('customers')
              .update({ full_name: guestName, phone })
              .eq('id', customerId);
          } else {
            const { data: newCustomer, error: insertCustErr } = await supabase
              .from('customers')
              .insert({ org_id: orgId, branch_id: branchId, full_name: guestName, phone })
              .select('id')
              .single();
            if (newCustomer) {
              customerId = newCustomer.id;
            } else if (insertCustErr?.code === '23505') {
              // Lost a race against customers_org_nphone_uniq — re-fetch the winner
              const { data: winner } = await supabase
                .from('customers')
                .select('id')
                .eq('org_id', orgId)
                .eq('phone', phone)
                .limit(1)
                .maybeSingle();
              if (winner) customerId = winner.id;
            }
          }
        }
      } catch (custErr) {
        console.warn('[API] issuePackage customer lookup/create failed:', custErr.message);
      }
    }

    const { data, error } = await supabase.rpc('issue_package', {
      p_org_id: orgId,
      p_branch_id: branchId,
      p_package_type_id: packageTypeId,
      p_customer_id: customerId,
      p_guest_name: guestName,
      p_guest_info: guestInfo,
      p_issued_date: issuedDate,
      p_expiry_date: expiryDate,
      p_paid_amount: paidAmount,
      p_sessions_total: sessionsTotal,
      p_remarks: remarks,
      p_discount_type: discountType,
      p_discount_value: discountValue,
      p_due_holder_name: dueHolderName,
      p_payment_method: paymentMethod,
    });
    if (error) throw error;
    capture('package_issued', { package_type_id: packageTypeId, branch_id: branchId, linked_to_customer: !!customerId });
    return { data, error: null };
  } catch (error) {
    console.error('[API] issuePackage error:', error.message);
    return { data: null, error };
  }
}

// Packages joined with their live balance (from the package_balances view,
// computed from package_redemptions — not stored). Sorted alphabetically by
// guest name, same as fetchVouchers.
export async function fetchPackages(customerId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    let packagesQuery = supabase
      .from('packages')
      .select(`
        id, package_code, issued_date, expiry_date, guest_name, guest_info,
        paid_amount, sessions_total, remarks, created_at,
        base_amount, discount_type, discount_value, discount_amount, final_amount, due_holder_name, payment_method,
        branch:branches ( id, name ),
        package_type:package_types ( id, name ),
        service:services ( id, name, duration_minutes ),
        issuer:users!issued_by ( id, full_name ),
        customer:customers ( id, full_name, phone, email, gender )
      `)
      .order('guest_name', { ascending: true });
    if (customerId) packagesQuery = packagesQuery.eq('customer_id', customerId);

    const [packagesRes, balancesRes] = await Promise.all([
      packagesQuery,
      supabase
        .from('package_balances')
        .select('package_id, sessions_used, sessions_remaining, status, last_redeemed_date'),
    ]);
    if (packagesRes.error) throw packagesRes.error;
    if (balancesRes.error) throw balancesRes.error;

    const balanceByPackage = new Map((balancesRes.data || []).map((b) => [b.package_id, b]));

    const rows = (packagesRes.data || []).map((p) => {
      const balance = balanceByPackage.get(p.id) || {};
      return {
        id: p.id,
        packageCode: p.package_code,
        issuedDate: p.issued_date,
        expiryDate: p.expiry_date,
        guestName: p.guest_name || p.customer?.full_name || '—',
        guestInfo: p.guest_info || p.customer?.phone || '',
        branchId: p.branch?.id || null,
        branchName: p.branch?.name || '—',
        packageTypeId: p.package_type?.id || null,
        packageTypeName: p.package_type?.name || '—',
        customerId: p.customer?.id || null,
        customerPhone: p.customer?.phone || null,
        customerEmail: p.customer?.email || null,
        customerGender: p.customer?.gender || null,
        serviceId: p.service?.id || null,
        serviceName: p.service?.name || '—',
        serviceDurationMinutes: p.service?.duration_minutes || null,
        paidAmount: Number(p.paid_amount || 0),
        sessionsTotal: p.sessions_total,
        remarks: p.remarks,
        createdAt: p.created_at,
        issuedById: p.issuer?.id || null,
        issuedByName: p.issuer?.full_name || '—',
        baseAmount: p.base_amount != null ? Number(p.base_amount) : null,
        discountType: p.discount_type,
        discountValue: p.discount_value != null ? Number(p.discount_value) : null,
        discountAmount: Number(p.discount_amount || 0),
        finalAmount: p.final_amount != null ? Number(p.final_amount) : null,
        dueHolderName: p.due_holder_name || null,
        paymentMethod: p.payment_method || null,
        dueAmount: p.final_amount != null
          ? Math.max(0, Math.round((Number(p.final_amount) - Number(p.paid_amount || 0)) * 100) / 100)
          : 0,
        sessionsUsed: balance.sessions_used || 0,
        sessionsRemaining: balance.sessions_remaining != null ? balance.sessions_remaining : p.sessions_total,
        status: balance.status || 'unused',
        lastRedeemedDate: balance.last_redeemed_date || null,
      };
    });

    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchPackages error:', error.message);
    return { data: null, error };
  }
}

// Staff-facing "Packages" tab on the customer detail page — this specific
// customer's packages, via the real packages.customer_id column.
export async function fetchPackagesForCustomer(customerId) {
  if (!customerId) return { data: [], error: null };
  return fetchPackages(customerId);
}

// Single package + its live balance, for the detail modal.
export async function fetchPackage(packageId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [packageRes, balanceRes] = await Promise.all([
      supabase
        .from('packages')
        .select(`
          id, package_code, issued_date, expiry_date, guest_name, guest_info,
          paid_amount, sessions_total, remarks, created_at,
          base_amount, discount_type, discount_value, discount_amount, final_amount, due_holder_name, payment_method,
          branch:branches ( id, name ),
          package_type:package_types ( id, name ),
          service:services ( id, name, duration_minutes ),
          issuer:users!issued_by ( id, full_name ),
          customer:customers ( id, full_name, phone, email, gender )
        `)
        .eq('id', packageId)
        .single(),
      supabase
        .from('package_balances')
        .select('sessions_used, sessions_remaining, status, last_redeemed_date')
        .eq('package_id', packageId)
        .maybeSingle(),
    ]);
    if (packageRes.error) throw packageRes.error;

    const p = packageRes.data;
    const balance = balanceRes.data || {};
    return {
      data: {
        id: p.id,
        packageCode: p.package_code,
        issuedDate: p.issued_date,
        expiryDate: p.expiry_date,
        guestName: p.guest_name || p.customer?.full_name || '—',
        guestInfo: p.guest_info || p.customer?.phone || '',
        branchId: p.branch?.id || null,
        branchName: p.branch?.name || '—',
        packageTypeId: p.package_type?.id || null,
        packageTypeName: p.package_type?.name || '—',
        customerId: p.customer?.id || null,
        customerPhone: p.customer?.phone || null,
        customerEmail: p.customer?.email || null,
        customerGender: p.customer?.gender || null,
        serviceId: p.service?.id || null,
        serviceName: p.service?.name || '—',
        serviceDurationMinutes: p.service?.duration_minutes || null,
        paidAmount: Number(p.paid_amount || 0),
        sessionsTotal: p.sessions_total,
        remarks: p.remarks,
        issuedByName: p.issuer?.full_name || '—',
        baseAmount: p.base_amount != null ? Number(p.base_amount) : null,
        discountType: p.discount_type,
        discountValue: p.discount_value != null ? Number(p.discount_value) : null,
        discountAmount: Number(p.discount_amount || 0),
        finalAmount: p.final_amount != null ? Number(p.final_amount) : null,
        dueHolderName: p.due_holder_name || null,
        paymentMethod: p.payment_method || null,
        dueAmount: p.final_amount != null
          ? Math.max(0, Math.round((Number(p.final_amount) - Number(p.paid_amount || 0)) * 100) / 100)
          : 0,
        sessionsUsed: balance.sessions_used || 0,
        sessionsRemaining: balance.sessions_remaining != null ? balance.sessions_remaining : p.sessions_total,
        status: balance.status || 'unused',
        lastRedeemedDate: balance.last_redeemed_date || null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchPackage error:', error.message);
    return { data: null, error };
  }
}

export async function fetchPackageRedemptions(packageId) {
  try {
    const { data, error } = await supabase
      .from('package_redemptions')
      .select(`
        id, redeemed_date, guest_name_used_by, notes, created_at, booking_id,
        branch:branches ( id, name ),
        performer:users!performed_by ( id, full_name ),
        booking:bookings ( id, booking_number, therapist:therapists ( id, name ) )
      `)
      .eq('package_id', packageId)
      .order('redeemed_date', { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchPackageRedemptions error:', error.message);
    return { data: null, error };
  }
}

// "All Packages" dashboard: org-wide totals (packages issued, sessions
// issued/used/remaining, amount collected) and a per-branch breakdown —
// the same idea as the old voucher overview (removed in V23), tracking sessions instead of a
// monetary balance.
export async function fetchPackageOverview() {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [packagesRes, balancesRes, branchesRes] = await Promise.all([
      supabase.from('packages').select('id, branch_id, paid_amount, sessions_total'),
      supabase.from('package_balances').select('package_id, sessions_used, sessions_remaining, status'),
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    ]);
    if (packagesRes.error) throw packagesRes.error;
    if (balancesRes.error) throw balancesRes.error;
    if (branchesRes.error) throw branchesRes.error;

    const balanceByPackage = new Map((balancesRes.data || []).map((b) => [b.package_id, b]));
    const packages = (packagesRes.data || []).map((p) => {
      const balance = balanceByPackage.get(p.id) || {};
      return {
        id: p.id,
        branchId: p.branch_id,
        paidAmount: Number(p.paid_amount || 0),
        sessionsTotal: p.sessions_total,
        sessionsUsed: balance.sessions_used || 0,
        sessionsRemaining: balance.sessions_remaining != null ? balance.sessions_remaining : p.sessions_total,
        status: balance.status || 'unused',
      };
    });

    const totals = packages.reduce((acc, p) => ({
      totalPackages: acc.totalPackages + 1,
      totalPaidAmount: acc.totalPaidAmount + p.paidAmount,
      totalSessionsIssued: acc.totalSessionsIssued + p.sessionsTotal,
      totalSessionsUsed: acc.totalSessionsUsed + p.sessionsUsed,
      totalSessionsRemaining: acc.totalSessionsRemaining + p.sessionsRemaining,
    }), { totalPackages: 0, totalPaidAmount: 0, totalSessionsIssued: 0, totalSessionsUsed: 0, totalSessionsRemaining: 0 });

    const statusCounts = packages.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, { unused: 0, partially_used: 0, fully_redeemed: 0, expired: 0 });

    const byBranch = new Map();
    packages.forEach((p) => {
      const row = byBranch.get(p.branchId) || { count: 0, paidAmount: 0, sessionsIssued: 0, sessionsUsed: 0, sessionsRemaining: 0 };
      row.count += 1;
      row.paidAmount += p.paidAmount;
      row.sessionsIssued += p.sessionsTotal;
      row.sessionsUsed += p.sessionsUsed;
      row.sessionsRemaining += p.sessionsRemaining;
      byBranch.set(p.branchId, row);
    });

    const branches = (branchesRes.data || []).map((b) => {
      const row = byBranch.get(b.id) || { count: 0, paidAmount: 0, sessionsIssued: 0, sessionsUsed: 0, sessionsRemaining: 0 };
      return {
        branchId: b.id,
        branchName: b.name,
        issuedCount: row.count,
        paidAmount: row.paidAmount,
        sessionsIssued: row.sessionsIssued,
        sessionsUsed: row.sessionsUsed,
        sessionsRemaining: row.sessionsRemaining,
      };
    });

    return { data: { totals, statusCounts, branches }, error: null };
  } catch (error) {
    console.error('[API] fetchPackageOverview error:', error.message);
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
      .select('id, org_id, branch_id, key, channel, subject, body, layout_id, whatsapp_template_name, whatsapp_template_lang, is_active, created_at, updated_at')
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
      layout_id: payload.layoutId ?? null,
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

// Preview-only, client-side mirror of the server-side combine-then-substitute
// logic in outreach_scan_winback / outreach_enqueue_for_completed
// (migration-187) — not used to generate what actually gets sent, those
// SQL functions render server-side at insert time. layoutHtml is the
// selected layout's html (or null/undefined for "no layout" — a template
// with no layout renders its raw body unwrapped, same as before layouts
// existed). orgName substitutes {{org_name}}, used by the built-in "Branded
// Header" layout's header text — falls back to 'Your Business' so the
// preview never shows a literal unsubstituted token.
export function renderTemplatePreview(template, sampleCustomerName = 'Jane Doe', layoutHtml = null, orgName = 'Your Business') {
  if (!template) return { subject: '', body: '' };
  const name = sampleCustomerName || 'Jane Doe';
  const org = orgName || 'Your Business';
  const wrapper = layoutHtml || '{{content}}';
  const combinedBody = wrapper.split('{{content}}').join(template.body || '');
  return {
    subject: (template.subject || '').split('{{customer_name}}').join(name).split('{{org_name}}').join(org),
    body: combinedBody.split('{{customer_name}}').join(name).split('{{org_name}}').join(org),
  };
}

// ---- Layouts ------------------------------------------------------------------

export async function fetchOutreachLayouts() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('outreach_layouts')
      .select('id, org_id, name, html, is_active')
      .or(`org_id.eq.${profile.org_id},org_id.is.null`)
      .eq('is_active', true)
      .order('org_id', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchOutreachLayouts error:', error.message);
    return { data: null, error };
  }
}

export async function createOutreachLayout({ orgId, name, html }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create outreach layouts.' } };
    }
    if (!orgId) return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId is required.' } };
    if (!name?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Layout name is required.' } };
    if (!html?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Layout HTML is required.' } };
    if (!html.includes('{{content}}')) {
      return { data: null, error: { code: 'INVALID_INPUT', message: 'Layout HTML must contain a {{content}} slot.' } };
    }

    const { data, error } = await supabase
      .from('outreach_layouts')
      .insert({ org_id: orgId, name: name.trim(), html, is_active: true })
      .select('id, name, html')
      .single();
    if (error) throw error;
    capture('outreach_layout_created', { layout_id: data.id });
    return { data, error: null };
  } catch (error) {
    console.error('[API] createOutreachLayout error:', error.message);
    return { data: null, error };
  }
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

// ============================================================
// Products — sellable retail catalog (migrations 188-190)
// ============================================================

/**
 * Upload a product image to Supabase Storage.
 * Reuses the same bucket as service images, under a products/ prefix.
 */
export async function uploadProductImage(file) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { url: null, error: authError };

    if (!['admin', 'manager'].includes(profile.role)) {
      return { url: null, error: { code: 'UNAUTHORIZED', message: 'Only admins and managers can upload product images.' } };
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { url: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 5MB.' } };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    // Org-prefixed so storage RLS (migration-338) only lets this org's admins/managers write it.
    if (!profile.org_id) return { url: null, error: { code: 'NO_ORG', message: 'Your account is not linked to an organization.' } };
    const filePath = `${profile.org_id}/products/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('service-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('service-images')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[API] uploadProductImage error:', error.message);
    return { url: null, error };
  }
}

// ── Products + inventory (V25, migration-345) ───────────────────────────────────────────────────
// Stock is per size (variant) per branch. Every stock change goes through an RPC that also writes one append-only
// product_stock_movements row; nothing here writes quantities directly. Cost lives in product_variant_costs, which only
// managers / admins / viewers can read, so `includeCosts` is only sent for them.

// PostgREST caps a response (1000 rows by default): read big tables page by page.
async function pagedSelect(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

const rpcError = (code, message) => ({ data: null, error: { code, message } });
const CAN_MANAGE = ['manager', 'admin'];
const CAN_SEE_COST = ['manager', 'admin', 'admin_viewer'];

/**
 * Everything the Products page needs in one go: products, sizes, stock for every branch, suppliers and branches, plus the costs for
 * the roles that may see them (`costs` is null otherwise). The page turns it into rows with productsView.buildRows().
 */
export async function fetchProductCatalog() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) return rpcError('NO_ORG', 'User is not associated with an organization.');
    const seesCost = CAN_SEE_COST.includes(profile.role);

    const [products, variants, stock, costs, suppliersRes, branchesRes] = await Promise.all([
      pagedSelect(() => supabase.from('products')
        .select('id, name, description, category, brand, supplier_id, image_url, option_label, pro_use, sell_at_checkout, notify_low, is_active, track_stock, earns_commission, created_at')
        .eq('org_id', profile.org_id).order('name')),
      pagedSelect(() => supabase.from('product_variants')
        .select('id, product_id, name, sku, barcode, retail_price, low_stock_level, reorder_qty, sort_order, is_active, created_at')
        .eq('org_id', profile.org_id).order('id')),
      pagedSelect(() => supabase.from('product_branch_stock').select('variant_id, branch_id, quantity').order('variant_id').order('branch_id')),
      seesCost
        ? pagedSelect(() => supabase.from('product_variant_costs').select('variant_id, cost_price, avg_cost').eq('org_id', profile.org_id).order('variant_id'))
        : Promise.resolve(null),
      seesCost ? supabase.from('suppliers').select('id, name, contact_name, phone, email, notes, is_active, created_at').eq('org_id', profile.org_id).order('name') : Promise.resolve({ data: [], error: null }),
      supabase.from('branches').select('id, name').eq('org_id', profile.org_id).order('name'),
    ]);
    if (suppliersRes.error) throw suppliersRes.error;
    if (branchesRes.error) throw branchesRes.error;
    return { data: { products, variants, stock, costs, suppliers: suppliersRes.data || [], branches: branchesRes.data || [] }, error: null };
  } catch (error) {
    console.error('[API] fetchProductCatalog error:', error.message);
    return { data: null, error };
  }
}

/** This Nepal month at a branch: units sold + amount (not refunded) and, for managers/admins, units used in sessions. */
export async function fetchProductMonthSummary({ branchId, monthStart, nextMonthStart, includeUsed = false }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const from = `${monthStart}T00:00:00+05:45`;
    const to = `${nextMonthStart}T00:00:00+05:45`;
    const sales = await pagedSelect(() => {
      let q = supabase.from('product_sales').select('quantity, total_amount').eq('org_id', profile.org_id).is('refunded_at', null)
        .gte('created_at', from).lt('created_at', to).order('created_at');
      if (branchId) q = q.eq('branch_id', branchId);
      return q;
    });
    let used = 0;
    if (includeUsed) {
      const moves = await pagedSelect(() => {
        let q = supabase.from('product_stock_movements').select('delta').eq('org_id', profile.org_id).eq('reason', 'used_in_session')
          .gte('created_at', from).lt('created_at', to).order('created_at');
        if (branchId) q = q.eq('branch_id', branchId);
        return q;
      });
      used = moves.reduce((n, m) => n - m.delta, 0);
    }
    return {
      data: { sold: sales.reduce((n, r) => n + r.quantity, 0), soldAmount: sales.reduce((n, r) => n + Number(r.total_amount), 0), used },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchProductMonthSummary error:', error.message);
    return { data: null, error };
  }
}

const transformMovement = (m) => ({
  id: m.id, branchId: m.branch_id, branchName: m.branches?.name || '', productId: m.product_id, productName: m.products?.name || '',
  variantId: m.variant_id, variantName: m.product_variants?.name || '', sku: m.product_variants?.sku || '', delta: m.delta, qtyAfter: m.qty_after,
  reason: m.reason, unitCost: m.unit_cost != null ? Number(m.unit_cost) : null, supplierId: m.supplier_id, supplierName: m.suppliers?.name || '',
  saleId: m.sale_id, transferId: m.transfer_id, bookingId: m.booking_id, note: m.note || '', performedBy: m.performed_by,
  byName: m.users?.full_name || '', createdAt: m.created_at,
  customerName: m.product_sales?.customers?.full_name || '', paymentMode: m.product_sales?.payment_mode || '',
  fromBranchId: m.product_stock_transfers?.from_branch_id || null, toBranchId: m.product_stock_transfers?.to_branch_id || null,
});

/**
 * The stock ledger, newest first. `from` / `to` are Nepal dates (inclusive); `branchId` null = every branch. Managers / admins /
 * viewers only (RLS returns nothing for staff).
 */
export async function fetchStockMovements({ branchId, from, to, productId, variantId, reason, limit = 1000 } = {}) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) return rpcError('NO_ORG', 'User is not associated with an organization.');
    let q = supabase
      .from('product_stock_movements')
      .select(`id, branch_id, product_id, variant_id, delta, qty_after, reason, unit_cost, supplier_id, sale_id, transfer_id, booking_id, note, performed_by, created_at,
        products(name), product_variants(name, sku), branches(name), suppliers(name),
        users!product_stock_movements_performed_by_fkey(full_name),
        product_sales(payment_mode, customers(full_name)),
        product_stock_transfers(from_branch_id, to_branch_id)`)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (branchId) q = q.eq('branch_id', branchId);
    if (productId) q = q.eq('product_id', productId);
    if (variantId) q = q.eq('variant_id', variantId);
    if (reason) q = q.eq('reason', reason);
    if (from) q = q.gte('created_at', `${from}T00:00:00+05:45`);
    if (to) q = q.lte('created_at', `${to}T23:59:59.999+05:45`);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data || []).map(transformMovement), error: null };
  } catch (error) {
    console.error('[API] fetchStockMovements error:', error.message);
    return { data: null, error };
  }
}

/** Create (no productId) or edit a product with its sizes in one transaction; `opening` = [{ idx, branchId, qty }] (create only). */
export async function saveProduct({ productId = null, product, variants, opening = [] }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!CAN_MANAGE.includes(profile.role)) return rpcError('UNAUTHORIZED', 'Only managers and admins can save products.');
    const { data, error } = await supabase.rpc('save_product', {
      p_product_id: productId,
      p_product: {
        name: product.name, description: product.description ?? null, brand: product.brand ?? null, category: product.category ?? null,
        supplier_id: product.supplierId || null, image_url: product.imageUrl ?? null, option_label: product.optionLabel || null,
        pro_use: !!product.proUse, sell_at_checkout: !!product.sellAtCheckout, track_stock: !!product.trackStock, notify_low: !!product.notifyLow,
        ...(product.earnsCommission === undefined ? {} : { earns_commission: !!product.earnsCommission }),
        ...(product.isActive === undefined ? {} : { is_active: !!product.isActive }),
      },
      p_variants: variants.map((v) => ({
        id: v.id || null, name: v.name || null, sku: v.sku || null, barcode: v.barcode || null, retail_price: v.price === '' ? 0 : Number(v.price),
        ...(v.cost === undefined ? {} : { cost_price: v.cost === '' || v.cost == null ? null : Number(v.cost) }), low_stock_level: v.low === '' || v.low == null ? null : Number(v.low),
        reorder_qty: v.reorder === '' || v.reorder == null ? null : Number(v.reorder), is_active: v.active !== false,
      })),
      p_opening: opening.map((o) => ({ idx: o.idx, branch_id: o.branchId, qty: Number(o.qty) })),
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] saveProduct error:', error.message);
    return { data: null, error };
  }
}

/** Receive, remove or set the real count of one size at one branch (mode: 'receive' | 'remove' | 'set_count'). Returns the movement, or null when a count was already right. */
export async function adjustProductStock({ variantId, branchId, mode, qty, reason, unitCost, supplierId, note }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!variantId || !branchId) return rpcError('VALIDATION', 'A size and a branch are required.');
    const { data, error } = await supabase.rpc('adjust_product_stock', {
      p_variant_id: variantId, p_branch_id: branchId, p_mode: mode, p_qty: Number(qty), p_reason: reason || null,
      p_unit_cost: unitCost === '' || unitCost == null ? null : Number(unitCost), p_supplier_id: supplierId || null, p_note: note || null,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] adjustProductStock error:', error.message);
    return { data: null, error };
  }
}

/** Move stock of one size between two branches (immediate, recorded on both sides). For stock from outside use adjustProductStock('receive'). */
export async function transferProductStock({ variantId, toBranchId, fromBranchId, quantity, note }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!variantId || !toBranchId || !fromBranchId) return rpcError('VALIDATION', 'A size, a source and a destination branch are required.');
    if (!quantity || quantity <= 0) return rpcError('VALIDATION', 'Quantity must be a positive number.');
    const { data, error } = await supabase.rpc('transfer_product_stock', {
      p_variant_id: variantId, p_to_branch_id: toBranchId, p_quantity: Number(quantity), p_from_branch_id: fromBranchId, p_note: note || null,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] transferProductStock error:', error.message);
    return { data: null, error };
  }
}

/**
 * Sell one size (staff, manager, admin). The stock check is server-side. `soldByTherapistId` (null = no one, no commission) and
 * `bookingId` (attach the sale to that visit) are optional; `payments` = [{ paymentMode, amount }] splits the sale across methods.
 */
export async function sellProduct({ variantId, quantity, paymentMode, branchId, customerId, notes, soldByTherapistId = null, bookingId = null, payments = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!variantId || !quantity || quantity <= 0) return rpcError('VALIDATION', 'A product and a positive quantity are required.');
    if (!paymentMode && !payments) return rpcError('VALIDATION', 'Payment method is required.');
    if (!branchId) return rpcError('VALIDATION', 'Branch is required.');
    const { data, error } = await supabase.rpc('sell_product', {
      p_variant_id: variantId, p_quantity: quantity, p_payment_mode: paymentMode || (payments?.[0]?.paymentMode ?? null), p_branch_id: branchId,
      p_customer_id: customerId || null, p_notes: notes || null, p_sold_by_therapist_id: soldByTherapistId || null, p_booking_id: bookingId || null,
      p_payments: payments ? payments.map((p) => ({ payment_mode: p.paymentMode, amount: Number(p.amount) })) : null,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] sellProduct error:', error.message);
    return { data: null, error };
  }
}

// ── Products at checkout (V26, migration-346) ───────────────────────────────────────────────────

/**
 * What the checkout product picker needs for one branch: items that are for sale (active, sell_at_checkout) with their sizes, price and
 * stock here, and the stock at other branches (for the "3 at Sanepa" hint). Never cost. Rows come from productsView.buildRows.
 */
export async function fetchCheckoutProducts({ branchId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) return rpcError('NO_ORG', 'User is not associated with an organization.');
    const [products, variants, stock, branchesRes] = await Promise.all([
      pagedSelect(() => supabase.from('products')
        .select('id, name, description, category, brand, supplier_id, image_url, option_label, pro_use, sell_at_checkout, notify_low, is_active, track_stock, created_at')
        .eq('org_id', profile.org_id).eq('is_active', true).eq('sell_at_checkout', true).order('name')),
      pagedSelect(() => supabase.from('product_variants')
        .select('id, product_id, name, sku, barcode, retail_price, low_stock_level, reorder_qty, sort_order, is_active, created_at')
        .eq('org_id', profile.org_id).eq('is_active', true).gt('retail_price', 0).order('id')),
      pagedSelect(() => supabase.from('product_branch_stock').select('variant_id, branch_id, quantity').order('variant_id').order('branch_id')),
      supabase.from('branches').select('id, name').eq('org_id', profile.org_id).order('name'),
    ]);
    if (branchesRes.error) throw branchesRes.error;
    return { data: { products, variants, stock, costs: null, suppliers: [], branches: branchesRes.data || [] }, error: null };
  } catch (error) {
    console.error('[API] fetchCheckoutProducts error:', error.message);
    return { data: null, error };
  }
}

/** The products this guest bought before (latest first, distinct sizes): [{ variantId, lastBoughtAt }]. */
export async function fetchGuestProductHistory({ customerId, limit = 5 }) {
  try {
    if (!customerId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('product_sales').select('variant_id, created_at').eq('customer_id', customerId).is('refunded_at', null).not('variant_id', 'is', null)
      .order('created_at', { ascending: false }).limit(40);
    if (error) throw error;
    const seen = new Set();
    const out = [];
    for (const r of (data || [])) {
      if (seen.has(r.variant_id)) continue;
      seen.add(r.variant_id);
      out.push({ variantId: r.variant_id, lastBoughtAt: r.created_at });
      if (out.length >= limit) break;
    }
    return { data: out, error: null };
  } catch (error) {
    console.error('[API] fetchGuestProductHistory error:', error.message);
    return { data: null, error };
  }
}

/** Team members who can be credited for a product sale at a branch (active therapists / service staff): [{ id, name }]. */
export async function fetchProductSellers({ branchId }) {
  try {
    let q = supabase.from('therapists').select('id, name').eq('is_active', true).order('display_order').order('name');
    q = withBranch(q, branchId);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchProductSellers error:', error.message);
    return { data: null, error };
  }
}

/** The product sales added to one booking (the visit), with who sold them and how they were paid: for the booking panel. */
export async function fetchBookingProductSales({ bookingId }) {
  try {
    const { data, error } = await supabase
      .from('product_sales')
      .select('id, product_name, variant_name, quantity, unit_price_npr, total_amount, payment_mode, created_at, refunded_at, sold_by_therapist_id, therapists:sold_by_therapist_id(name), product_sale_payments(payment_mode, amount)')
      .eq('booking_id', bookingId)
      .order('created_at');
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        id: r.id, name: [r.product_name, r.variant_name].filter(Boolean).join(' · '), quantity: r.quantity, unitPrice: Number(r.unit_price_npr), total: Number(r.total_amount),
        paymentMode: r.payment_mode, createdAt: r.created_at, refundedAt: r.refunded_at, soldBy: r.therapists?.name || null,
        payments: (r.product_sale_payments || []).map((p) => ({ paymentMode: p.payment_mode, amount: Number(p.amount) })),
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchBookingProductSales error:', error.message);
    return { data: null, error };
  }
}

/** Visits this guest has today at this branch (not cancelled / no-show), for "Add this sale to that visit": [{ id, serviceName, startTime, paid }]. */
export async function fetchGuestVisitsToday({ customerId, branchId, date }) {
  try {
    if (!customerId || !branchId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('bookings')
      .select('id, booking_number, start_time, payment_status, status, service_name_snapshot, therapist_id')
      .eq('customer_id', customerId).eq('branch_id', branchId).eq('date', date)
      .not('status', 'in', '("Cancelled","No Show")')
      .order('start_time');
    if (error) throw error;
    return { data: (data || []).map((b) => ({ id: b.id, number: b.booking_number, serviceName: b.service_name_snapshot || 'Visit', startTime: b.start_time, paid: b.payment_status === 'paid', status: b.status, therapistId: b.therapist_id || null })), error: null };
  } catch (error) {
    console.error('[API] fetchGuestVisitsToday error:', error.message);
    return { data: null, error };
  }
}

/**
 * The atomic checkout: product sales + the treatment payment in ONE transaction (checkout_booking_with_products). `tenders` are what
 * the guest pays with, in order, for the main booking (money for the products first); `products` = [{ variantId, qty, soldByTherapistId }].
 * Prices and stock are checked by the server. On a stock problem the error has `hint` "STOCK:<variantId>:<left>" (see checkoutAllocation.parseStockError).
 */
export async function checkoutWithProducts({ bookingId, tenders, products, dueHolderName, notes, additional = [] }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const mapTender = (t) => ({
      amount: Number(t.amount),
      payment_mode: t.paymentMode,
      ...(t.paymentMode === 'ReferralVoucher' ? { referral_id: t.referralId } : {}),
      ...(t.paymentMode === 'VoucherWallet' ? { voucher_id: t.voucherId || null } : {}),
      ...(t.paymentMode === 'SessionPackage' ? { package_id: t.packageId } : {}),
    });
    const { data, error } = await supabase.rpc('checkout_booking_with_products', {
      p_booking_id: bookingId,
      p_tenders: (tenders || []).map(mapTender),
      p_products: (products || []).map((l) => ({ variant_id: l.variantId, qty: l.qty, sold_by_therapist_id: l.soldByTherapistId || null })),
      p_notes: notes || null,
      p_due_holder_name: dueHolderName || null,
      p_additional: (additional || []).map((a) => ({ booking_id: a.bookingId, tenders: (a.tenders || []).map(mapTender), due_holder_name: a.dueHolderName || null, notes: notes || null })),
    });
    if (error) throw error;
    capture('staff_checkout_with_products', { products: (products || []).length, total: Number(data?.products_total || 0) });
    return {
      data: {
        payments: (data?.payments || []).map((r) => ({ bookingId: r.booking_id, amountPaid: Number(r.amount_paid || 0), amountDue: Number(r.amount_due || 0), fullyPaid: !!r.fully_paid })),
        sales: (data?.sales || []).map((x) => ({
          id: x.id, variantId: x.variant_id, productName: x.product_name, variantName: x.variant_name, quantity: x.quantity, unitPrice: Number(x.unit_price),
          total: Number(x.total_amount), stockBefore: x.stock_before, stockAfter: x.stock_after, soldByTherapistId: x.sold_by_therapist_id,
        })),
        productsTotal: Number(data?.products_total || 0),
        productPayments: (data?.product_payments || []).map((p) => ({ paymentMode: p.payment_mode, amount: Number(p.amount) })),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] checkoutWithProducts error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

/** Cost-aware numbers per size at a branch (manager / admin): average cost, stock value, margin. */
export async function fetchProductMoney({ productId, branchId }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.rpc('product_money', { p_product_id: productId, p_branch_id: branchId });
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        variantId: r.variant_id, retailPrice: Number(r.retail_price), costPrice: r.cost_price != null ? Number(r.cost_price) : null,
        avgCost: Number(r.avg_cost), stockHere: r.stock_here, stockValue: r.stock_value != null ? Number(r.stock_value) : null, marginPct: r.margin_pct != null ? Number(r.margin_pct) : null,
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchProductMoney error:', error.message);
    return { data: null, error };
  }
}

/** Last 30 Nepal days for one product: { qty, amount, topSeller: { name, qty } | null, repeatBuyers, buyers }. branchId null = every branch. */
export async function fetchProductSalesSummary({ productId, branchId = null }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const { data, error } = await supabase.rpc('product_sales_summary', { p_product_id: productId, p_branch_id: branchId });
    if (error) throw error;
    return {
      data: { qty: data.qty_30d, amount: Number(data.amount_30d), topSeller: data.top_seller ? { name: data.top_seller.name, qty: data.top_seller.qty } : null, repeatBuyers: data.repeat_buyers, buyers: data.buyers },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchProductSalesSummary error:', error.message);
    return { data: null, error };
  }
}

/** Dry-run (default) or run a product import. rows = productsView.parseImportSheet().rows. Returns { dry_run, imported, new, updated, errors: [{ row, message, create? }], … }. */
export async function importProducts({ rows, branchId = null, dryRun = true }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!CAN_MANAGE.includes(profile.role)) return rpcError('UNAUTHORIZED', 'Only managers and admins can import products.');
    const { data, error } = await supabase.rpc('import_products', { p_rows: rows, p_branch_id: branchId, p_dry_run: dryRun });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] importProducts error:', error.message);
    return { data: null, error };
  }
}

// ── Suppliers ──
const transformSupplier = (s) => ({ id: s.id, name: s.name, contactName: s.contact_name || '', phone: s.phone || '', email: s.email || '', notes: s.notes || '', isActive: s.is_active !== false, createdAt: s.created_at });
const supplierPayload = ({ name, contactName, phone, email, notes, isActive }) => ({
  name: (name || '').trim(), contact_name: (contactName || '').trim() || null, phone: (phone || '').trim() || null, email: (email || '').trim() || null,
  notes: (notes || '').trim() || null, ...(isActive === undefined ? {} : { is_active: !!isActive }),
});

/** Latest receive per supplier: { [supplierId]: ISO timestamp }. */
export async function fetchSupplierLastReceived() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const rows = await pagedSelect(() => supabase.from('product_stock_movements').select('supplier_id, created_at').eq('org_id', profile.org_id)
      .not('supplier_id', 'is', null).in('reason', ['received', 'import_opening']).order('created_at', { ascending: false }).order('id'));
    const out = {};
    rows.forEach((r) => { if (!out[r.supplier_id]) out[r.supplier_id] = r.created_at; });
    return { data: out, error: null };
  } catch (error) {
    console.error('[API] fetchSupplierLastReceived error:', error.message);
    return { data: null, error };
  }
}

export async function createSupplier(fields) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!CAN_MANAGE.includes(profile.role)) return rpcError('UNAUTHORIZED', 'Only managers and admins can add suppliers.');
    const payload = supplierPayload(fields);
    if (!payload.name) return rpcError('VALIDATION', 'Supplier name is required.');
    const { data, error } = await supabase.from('suppliers').insert({ ...payload, org_id: profile.org_id }).select('*').single();
    if (error) throw error;
    return { data: transformSupplier(data), error: null };
  } catch (error) {
    console.error('[API] createSupplier error:', error.message);
    return { data: null, error };
  }
}

export async function updateSupplier({ id, ...fields }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!CAN_MANAGE.includes(profile.role)) return rpcError('UNAUTHORIZED', 'Only managers and admins can edit suppliers.');
    const payload = supplierPayload(fields);
    if (!payload.name) return rpcError('VALIDATION', 'Supplier name is required.');
    const { data, error } = await supabase.from('suppliers').update(payload).eq('id', id).eq('org_id', profile.org_id).select('*').single();
    if (error) throw error;
    return { data: transformSupplier(data), error: null };
  } catch (error) {
    console.error('[API] updateSupplier error:', error.message);
    return { data: null, error };
  }
}

export async function deleteSupplier({ id }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!CAN_MANAGE.includes(profile.role)) return rpcError('UNAUTHORIZED', 'Only managers and admins can delete suppliers.');
    const { error } = await supabase.from('suppliers').delete().eq('id', id).eq('org_id', profile.org_id);
    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteSupplier error:', error.message);
    return { data: null, error };
  }
}

export async function toggleProductActive({ productId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage product status.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('products')
      .update({ is_active: isActive })
      .eq('id', productId)
      .eq('org_id', profile.org_id)
      .select('id, name, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleProductActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteProduct({ productId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete products.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('org_id', profile.org_id);

    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteProduct error:', error.message);
    return { data: null, error };
  }
}

export async function fetchProductSales({ limit = 50, productId, branchId, from, to } = {}) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    let query = supabase
      .from('product_sales')
      .select('id, product_id, variant_id, variant_name, branch_id, product_name, quantity, unit_price_npr, total_amount, payment_mode, customer_id, sold_by, created_at, refunded_at, refunded_by, refund_reason, customers(full_name), users!product_sales_sold_by_fkey(full_name)')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (productId) query = query.eq('product_id', productId);
    if (branchId) query = query.eq('branch_id', branchId);
    if (from) query = query.gte('created_at', `${from}T00:00:00`);
    if (to) query = query.lte('created_at', `${to}T23:59:59`);

    const { data, error } = await query;

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchProductSales error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Product Categories (migration 191) — a real place to create/rename/
// deactivate/delete product categories, closing the gap left by the
// Products form's dropdown (starter list + whatever's already in use,
// with no way to add a genuinely new one).
// ============================================================

export async function fetchProductCategoriesForManagement() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data: categories, error } = await supabase
      .from('product_categories')
      .select('id, name, description, is_active, display_order, created_at')
      .eq('org_id', profile.org_id)
      .order('display_order', { ascending: true });

    if (error) throw error;

    const { data: products } = await supabase
      .from('products')
      .select('category')
      .eq('org_id', profile.org_id);

    const productCounts = {};
    (products || []).forEach((p) => {
      if (!p.category) return;
      productCounts[p.category] = (productCounts[p.category] || 0) + 1;
    });

    const data = (categories || []).map((c) => ({ ...c, product_count: productCounts[c.name] || 0 }));

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchProductCategoriesForManagement error:', error.message);
    return { data: null, error };
  }
}

export async function fetchActiveProductCategories() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('product_categories')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchActiveProductCategories error:', error.message);
    return { data: null, error };
  }
}

export async function createProductCategory({ name, description }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create product categories.' } };
    }

    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Category name is required.' } };
    }

    const { data: maxOrder } = await supabase
      .from('product_categories')
      .select('display_order')
      .eq('org_id', profile.org_id)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxOrder?.display_order || 0) + 1;

    const { data, error } = await supabase
      .from('product_categories')
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
    console.error('[API] createProductCategory error:', error.message);
    return { data: null, error };
  }
}

export async function updateProductCategory({ categoryId, name, description }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update product categories.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data: oldCategory, error: catError } = await supabase
      .from('product_categories')
      .select('name')
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)
      .single();

    if (catError || !oldCategory) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Category not found.' } };
    }

    const oldName = oldCategory?.name;

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;

    const { data, error } = await supabase
      .from('product_categories')
      .update(updateData)
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)
      .select('id, name, description, is_active, display_order, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A category with this name already exists.' } };
      }
      throw error;
    }

    // Update products with the old category name to the new name (within this org only)
    if (name && oldName && name.trim() !== oldName) {
      await supabase
        .from('products')
        .update({ category: name.trim() })
        .eq('category', oldName)
        .eq('org_id', profile.org_id);
    }

    return { data, error: null };
  } catch (error) {
    console.error('[API] updateProductCategory error:', error.message);
    return { data: null, error };
  }
}

export async function toggleProductCategoryActive({ categoryId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can toggle product categories.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('product_categories')
      .update({ is_active: isActive })
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)
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
    console.error('[API] toggleProductCategoryActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteProductCategory({ categoryId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete product categories.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data: category } = await supabase
      .from('product_categories')
      .select('name')
      .eq('id', categoryId)
      .eq('org_id', profile.org_id)
      .single();

    if (category) {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('category', category.name)
        .eq('org_id', profile.org_id);

      if (count > 0) {
        return { data: null, error: { code: 'HAS_PRODUCTS', message: `This category has ${count} product(s) and cannot be deleted. Reassign products first or deactivate the category.` } };
      }
    }

    const { error } = await supabase
      .from('product_categories')
      .delete()
      .eq('id', categoryId)
      .eq('org_id', profile.org_id);

    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteProductCategory error:', error.message);
    return { data: null, error };
  }
}

export async function refundProductSale({ saleId, reason }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!saleId) {
      return { data: null, error: { code: 'VALIDATION', message: 'A sale is required.' } };
    }

    const { data, error } = await supabase.rpc('refund_product_sale', {
      p_sale_id: saleId,
      p_reason: reason || null,
    });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] refundProductSale error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ============================================================
// Campaigns — named, dated promotional events (migrations 198-204)
// ============================================================

export async function fetchCampaignsForManagement() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can manage campaigns.' } };
    }

    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id, name, message, banner_image_url, discount_percent, start_date, end_date, is_active, created_at')
      .eq('org_id', profile.org_id)
      .order('start_date', { ascending: false });

    if (error) throw error;

    const campaignIds = (campaigns || []).map((c) => c.id);
    let servicesByCampaign = {};
    let categoriesByCampaign = {};

    if (campaignIds.length > 0) {
      const [{ data: linkedServices }, { data: linkedCategories }] = await Promise.all([
        supabase.from('campaign_services').select('campaign_id, service_id').in('campaign_id', campaignIds),
        supabase.from('campaign_categories').select('campaign_id, category_id').in('campaign_id', campaignIds),
      ]);

      (linkedServices || []).forEach((row) => {
        servicesByCampaign[row.campaign_id] = servicesByCampaign[row.campaign_id] || [];
        servicesByCampaign[row.campaign_id].push(row.service_id);
      });
      (linkedCategories || []).forEach((row) => {
        categoriesByCampaign[row.campaign_id] = categoriesByCampaign[row.campaign_id] || [];
        categoriesByCampaign[row.campaign_id].push(row.category_id);
      });
    }

    const data = (campaigns || []).map((c) => ({
      ...c,
      service_ids: servicesByCampaign[c.id] || [],
      category_ids: categoriesByCampaign[c.id] || [],
    }));

    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchCampaignsForManagement error:', error.message);
    return { data: null, error };
  }
}

/**
 * Upload a campaign banner image to Supabase Storage.
 * Reuses the same bucket as service images, under a campaigns/ prefix.
 */
export async function uploadCampaignBanner(file) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { url: null, error: authError };

    if (!['admin', 'manager'].includes(profile.role)) {
      return { url: null, error: { code: 'UNAUTHORIZED', message: 'Only admins and managers can upload campaign banners.' } };
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { url: null, error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' } };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be less than 5MB.' } };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    // Org-prefixed so storage RLS (migration-338) only lets this org's admins/managers write it.
    if (!profile.org_id) return { url: null, error: { code: 'NO_ORG', message: 'Your account is not linked to an organization.' } };
    const filePath = `${profile.org_id}/campaigns/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('service-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('service-images')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[API] uploadCampaignBanner error:', error.message);
    return { url: null, error };
  }
}

export async function createCampaign({ name, message, bannerImageUrl, discountPercent, startDate, endDate, serviceIds = [], categoryIds = [] }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create campaigns.' } };
    }

    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Campaign name is required.' } };
    }
    if (!discountPercent || discountPercent <= 0 || discountPercent >= 100) {
      return { data: null, error: { code: 'VALIDATION', message: 'Discount percent must be between 1 and 99.' } };
    }
    if (!startDate || !endDate) {
      return { data: null, error: { code: 'VALIDATION', message: 'Start and end dates are required.' } };
    }
    if (endDate < startDate) {
      return { data: null, error: { code: 'VALIDATION', message: 'End date cannot be before the start date.' } };
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        name: name.trim(),
        message: message?.trim() || null,
        banner_image_url: bannerImageUrl || null,
        discount_percent: discountPercent,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        org_id: profile.org_id,
      })
      .select('id, name, message, banner_image_url, discount_percent, start_date, end_date, is_active, created_at')
      .single();

    if (error) throw error;

    await syncCampaignLinks({ campaignId: campaign.id, serviceIds, categoryIds });

    return { data: campaign, error: null };
  } catch (error) {
    console.error('[API] createCampaign error:', error.message);
    return { data: null, error };
  }
}

export async function updateCampaign({ campaignId, name, message, bannerImageUrl, discountPercent, startDate, endDate, serviceIds, categoryIds }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update campaigns.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }
    if (startDate !== undefined && endDate !== undefined && endDate < startDate) {
      return { data: null, error: { code: 'VALIDATION', message: 'End date cannot be before the start date.' } };
    }
    if (discountPercent !== undefined && (!discountPercent || discountPercent <= 0 || discountPercent >= 100)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Discount percent must be between 1 and 99.' } };
    }

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name.trim();
    if (message !== undefined) updatePayload.message = message?.trim() || null;
    if (bannerImageUrl !== undefined) updatePayload.banner_image_url = bannerImageUrl || null;
    if (discountPercent !== undefined) updatePayload.discount_percent = discountPercent;
    if (startDate !== undefined) updatePayload.start_date = startDate;
    if (endDate !== undefined) updatePayload.end_date = endDate;

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await supabase
        .from('campaigns')
        .update(updatePayload)
        .eq('id', campaignId)
        .eq('org_id', profile.org_id);

      if (error) throw error;
    }

    if (serviceIds !== undefined || categoryIds !== undefined) {
      await syncCampaignLinks({ campaignId, serviceIds: serviceIds || [], categoryIds: categoryIds || [] });
    }

    const { data, error: fetchError } = await supabase
      .from('campaigns')
      .select('id, name, message, banner_image_url, discount_percent, start_date, end_date, is_active, created_at')
      .eq('id', campaignId)
      .eq('org_id', profile.org_id)
      .single();

    if (fetchError) throw fetchError;
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateCampaign error:', error.message);
    return { data: null, error };
  }
}

// Replaces a campaign's full set of linked services/categories in one go —
// simplest correct approach for a "pick from a checkbox list" UI (the form
// always submits the complete desired set, not a diff).
async function syncCampaignLinks({ campaignId, serviceIds, categoryIds }) {
  await Promise.all([
    supabase.from('campaign_services').delete().eq('campaign_id', campaignId),
    supabase.from('campaign_categories').delete().eq('campaign_id', campaignId),
  ]);

  const inserts = [];
  if (serviceIds.length > 0) {
    inserts.push(
      supabase.from('campaign_services').insert(serviceIds.map((service_id) => ({ campaign_id: campaignId, service_id })))
    );
  }
  if (categoryIds.length > 0) {
    inserts.push(
      supabase.from('campaign_categories').insert(categoryIds.map((category_id) => ({ campaign_id: campaignId, category_id })))
    );
  }
  if (inserts.length > 0) await Promise.all(inserts);
}

export async function toggleCampaignActive({ campaignId, isActive }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can toggle campaigns.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update({ is_active: isActive })
      .eq('id', campaignId)
      .eq('org_id', profile.org_id)
      .select('id, name, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Campaign not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] toggleCampaignActive error:', error.message);
    return { data: null, error };
  }
}

export async function deleteCampaign({ campaignId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete campaigns.' } };
    }
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', campaignId)
      .eq('org_id', profile.org_id);

    if (error) throw error;
    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deleteCampaign error:', error.message);
    return { data: null, error };
  }
}

// ---------------------------------------------------------------------------
// Admin corrections
// ---------------------------------------------------------------------------
// Bookings on a closed day, or a Completed booking, are frozen by the DB
// trigger enforce_booking_immutability(). These two helpers are the only way
// past it, and both go through SECURITY DEFINER RPCs that re-check the admin
// role server-side, require a reason, and write an audit_logs row. Deliberately
// NOT routed through validateBookingMutation(): that guard stays absolute for
// every ordinary code path, so nothing can bypass a lock by accident.

/** Minimum reason length. Mirrors the CHECK inside the RPCs — keep in sync. */
const CORRECTION_REASON_MIN = 10;

/**
 * Correct a booking that immutability would otherwise block.
 *
 * @param {string} bookingId  booking UUID (booking.bookingId, never booking.id)
 * @param {object} changes    flat { column: value }; server whitelists columns
 * @param {string} reason     >= 10 chars, stored on the audit row
 */
export async function adminCorrectBooking({ bookingId, changes, reason }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    // Checked here purely so the UI can fail fast with a clear message; the
    // RPC re-checks both, and that check is the one that actually protects.
    if (profile?.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can correct a locked or completed booking.' } };
    }
    if (!reason || reason.trim().length < CORRECTION_REASON_MIN) {
      return { data: null, error: { code: 'REASON_REQUIRED', message: `A reason of at least ${CORRECTION_REASON_MIN} characters is required.` } };
    }
    if (!changes || Object.keys(changes).length === 0) {
      return { data: null, error: { code: 'NO_CHANGES', message: 'No changes were supplied.' } };
    }

    const { data, error } = await supabase.rpc('admin_correct_booking', {
      p_booking_id: bookingId,
      p_changes: changes,
      p_reason: reason.trim(),
    });
    if (error) throw error;

    capture('admin_booking_corrected', { booking_id: bookingId, fields: Object.keys(changes) });
    return { data: { bookingId: data }, error: null };
  } catch (error) {
    console.error('[API] adminCorrectBooking error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Admin-only correction of a recorded payment's method (migration-237). The
// RPC re-checks role, reason length, and the same closed-day guard migration-236
// uses for membership backdating — the pre-checks here are purely for a fast,
// clear UI error, not the actual protection.
export async function correctPaymentMode({ paymentId, newMode, reason }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile?.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can correct a payment method.' } };
    }
    if (!reason || reason.trim().length < CORRECTION_REASON_MIN) {
      return { data: null, error: { code: 'REASON_REQUIRED', message: `A reason of at least ${CORRECTION_REASON_MIN} characters is required.` } };
    }
    if (!newMode || !newMode.trim()) {
      return { data: null, error: { code: 'MODE_REQUIRED', message: 'A new payment mode is required.' } };
    }

    const { data, error } = await supabase.rpc('admin_correct_payment_mode', {
      p_payment_id: paymentId,
      p_new_mode: newMode.trim(),
      p_reason: reason.trim(),
    });
    if (error) throw error;

    capture('admin_payment_mode_corrected', { payment_id: paymentId, new_mode: newMode.trim() });
    return { data: { auditLogId: data }, error: null };
  } catch (error) {
    console.error('[API] correctPaymentMode error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Admin-only correction of a recorded payment's amount (migration-283). Same
// shape/guards as correctPaymentMode above — payments has no UPDATE RLS
// policy at all, so this is the only path past that immutability.
export async function correctPaymentAmount({ paymentId, newAmount, reason }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile?.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can correct a payment amount.' } };
    }
    if (!reason || reason.trim().length < CORRECTION_REASON_MIN) {
      return { data: null, error: { code: 'REASON_REQUIRED', message: `A reason of at least ${CORRECTION_REASON_MIN} characters is required.` } };
    }
    const parsed = Number(newAmount);
    if (newAmount === '' || newAmount === null || Number.isNaN(parsed) || parsed < 0) {
      return { data: null, error: { code: 'AMOUNT_REQUIRED', message: 'A valid new amount is required.' } };
    }

    const { data, error } = await supabase.rpc('admin_correct_payment_amount', {
      p_payment_id: paymentId,
      p_new_amount: parsed,
      p_reason: reason.trim(),
    });
    if (error) throw error;

    capture('admin_payment_amount_corrected', { payment_id: paymentId, new_amount: parsed });
    return { data: { auditLogId: data }, error: null };
  } catch (error) {
    console.error('[API] correctPaymentAmount error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

/**
 * Permanently delete a booking that should never have existed.
 *
 * Refuses when payments, refunds, referrals or package redemptions reference
 * the booking — those FKs are RESTRICT/NO ACTION so the database would refuse
 * regardless. The RPC raises BOOKING_HAS_FINANCIAL_RECORDS naming what blocked
 * it; surface that message rather than a generic failure, because the caller's
 * next step (cancel with a reason instead) depends on knowing why.
 */
export async function adminDeleteBooking({ bookingId, reason }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile?.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can delete a booking.' } };
    }
    if (!reason || reason.trim().length < CORRECTION_REASON_MIN) {
      return { data: null, error: { code: 'REASON_REQUIRED', message: `A reason of at least ${CORRECTION_REASON_MIN} characters is required.` } };
    }

    const { data, error } = await supabase.rpc('admin_delete_booking', {
      p_booking_id: bookingId,
      p_reason: reason.trim(),
    });
    if (error) {
      if (typeof error.message === 'string' && error.message.includes('BOOKING_HAS_FINANCIAL_RECORDS')) {
        return {
          data: null,
          error: {
            code: 'BOOKING_HAS_FINANCIAL_RECORDS',
            message: error.message.replace(/^.*BOOKING_HAS_FINANCIAL_RECORDS:\s*/, ''),
          },
        };
      }
      throw error;
    }

    capture('admin_booking_deleted', { booking_id: bookingId });
    return { data: { bookingId: data }, error: null };
  } catch (error) {
    console.error('[API] adminDeleteBooking error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

/**
 * Corrections history for the admin log view. Reads audit_logs rows written by
 * the two functions above (RLS already restricts reads to manager/admin).
 */
export async function getAdminCorrections({ limit = 100 } = {}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, table_name, record_id, action_type, old_data, new_data, reason, changed_by, changed_at')
      .in('action_type', ['ADMIN_CORRECTION', 'ADMIN_DELETE'])
      .order('changed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] getAdminCorrections error:', error.message);
    return { data: null, error };
  }
}

// --- Voucher / package corrections (migration 233) --------------------------
// voucher_balances and package_balances are VIEWS — remaining_balance and
// sessions_remaining are computed, not stored, so there is nothing to UPDATE.
// Each pair below changes one side of that arithmetic: correct the issued
// figure, or void a claim/redemption that never happened.

async function callAdminCorrection(rpc, args, { reason, event, meta }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (profile?.role !== 'admin') {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only an admin can make corrections.' } };
    }
    if (!reason || reason.trim().length < CORRECTION_REASON_MIN) {
      return { data: null, error: { code: 'REASON_REQUIRED', message: `A reason of at least ${CORRECTION_REASON_MIN} characters is required.` } };
    }

    const { data, error } = await supabase.rpc(rpc, { ...args, p_reason: reason.trim() });
    if (error) {
      // These RPCs raise a prefixed code when a correction is refused for a
      // substantive reason (money attached, redeemed sessions). Strip the
      // prefix so the UI shows the explanation, not the machine tag.
      const m = typeof error.message === 'string'
        ? error.message.match(/(CLAIM_HAS_PAYMENT|REDEMPTION_HAS_BOOKING):\s*(.*)/)
        : null;
      if (m) return { data: null, error: { code: m[1], message: m[2] } };
      throw error;
    }

    capture(event, meta);
    return { data, error: null };
  } catch (error) {
    console.error(`[API] ${rpc} error:`, error.message);
    return { data: null, error };
  }
}

/** Set a voucher's remaining balance to `newRemaining`; adjusts the issued total. */
export async function adminCorrectVoucherBalance({ voucherId, newRemaining, reason }) {
  return callAdminCorrection('admin_correct_voucher_balance',
    { p_voucher_id: voucherId, p_new_remaining: Number(newRemaining) },
    { reason, event: 'admin_voucher_balance_corrected', meta: { voucher_id: voucherId } });
}

/** Remove a voucher claim that never happened. Refused if a payment is linked. */
export async function adminVoidVoucherClaim({ claimId, reason }) {
  return callAdminCorrection('admin_void_voucher_claim',
    { p_claim_id: claimId },
    { reason, event: 'admin_voucher_claim_voided', meta: { claim_id: claimId } });
}

/** Correct a package's total session count. Cannot go below sessions already redeemed. */
export async function adminCorrectPackageSessions({ packageId, newSessionsTotal, reason }) {
  return callAdminCorrection('admin_correct_package_sessions',
    { p_package_id: packageId, p_new_sessions_total: Number(newSessionsTotal) },
    { reason, event: 'admin_package_sessions_corrected', meta: { package_id: packageId } });
}

/** Remove a package redemption that never happened. Refused if a booking is linked. */
export async function adminVoidPackageRedemption({ redemptionId, reason }) {
  return callAdminCorrection('admin_void_package_redemption',
    { p_redemption_id: redemptionId },
    { reason, event: 'admin_package_redemption_voided', meta: { redemption_id: redemptionId } });
}

// ============================================================
// Staff access (migration-318): link a therapist to a login account.
// therapists.user_id <-> users.id, both nullable, partial-unique on the
// therapist side. See migration-318-staff-access.sql for the full rationale.
// ============================================================

// Who may grant which role. A manager can hand out staff/manager; only an
// admin can hand out admin or admin_viewer — same ceiling as every other
// privilege-escalation check in this file (DISCOUNT_LIMITS, setStaffCompensation).
// ── Staff data visibility (migration-320) ───────────────────────────────────
// Three admin-set restrictions, resolved once per request and applied by the
// read functions below:
//   calendar_visibility 'own'   — only this person's own bookings
//   can_view_customer_details   — customer phone/email/notes withheld
//   can_view_prices             — every money field withheld
//
// Deliberately NOT applied to manager/admin. A manager who cannot see prices
// cannot do their job, and the Staff access UI only offers these restrictions
// for staff. Checking role here as well means a mis-set flag on a manager
// account degrades to "no restriction" rather than locking them out of the
// product.
const MONEY_FIELDS = [
  'base_amount', 'discount_amount', 'final_amount', 'amount',
  'tip_amount', 'paid_amount', 'due_amount', 'price_npr',
];
const CUSTOMER_DETAIL_FIELDS = ['customer_email', 'notes', 'customer_notes'];

// What this caller may see. Returns the linked therapist id too, since
// "own bookings only" is meaningless without knowing which therapist the
// account belongs to — that link is therapists.user_id from migration-318.
async function resolveVisibility(profile) {
  const privileged = profile.role === 'manager' || profile.role === 'admin';
  const vis = {
    ownBookingsOnly: !privileged && isOwnCalendar(profile.calendar_visibility),
    canViewCustomerDetails: privileged || profile.can_view_customer_details !== false,
    canViewPrices: privileged || profile.can_view_prices !== false,
    therapistId: null,
  };
  if (vis.ownBookingsOnly) {
    const { data: linked } = await supabase
      .from('therapists')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();
    // No linked therapist row means we cannot tell which bookings are
    // "theirs". Fail closed: show nothing rather than everything.
    vis.therapistId = linked?.id ?? null;
  }
  return vis;
}

// Strip withheld fields from rows already fetched. Used where a query's
// column list is shared with callers who ARE allowed the data; where the
// select is ours alone, prefer omitting the columns so they never leave the
// database (see getCalendarBookings).
// "Anisha Thakuri" → "A***** T*******". Keeps the initials and the shape of
// the name so staff can still tell two bookings apart, match a customer to the
// person in front of them, and read a list — without learning who anyone is.
//
// Masked server-side rather than in the component: a restricted account never
// receives the real name, so devtools cannot recover it. Deliberately NOT
// dropping the field entirely, which was the first design — a booking with no
// customer at all is unusable for the staff member actually delivering it.
export { maskCustomerName, maskPhone };

const CUSTOMER_NAME_FIELDS = ['customer_name'];
// Phone is masked rather than dropped — see maskPhone. Email and notes are
// still removed outright: there is no partial form of those that is both
// useful to staff and safe to show.
const CUSTOMER_MASKED_PHONE_FIELDS = ['customer_phone'];

function redactRows(rows, vis) {
  if (vis.canViewPrices && vis.canViewCustomerDetails) return rows;
  const drop = [
    ...(vis.canViewPrices ? [] : MONEY_FIELDS),
    ...(vis.canViewCustomerDetails ? [] : CUSTOMER_DETAIL_FIELDS),
  ];
  return (rows || []).map((row) => {
    const copy = { ...row };
    drop.forEach((f) => { if (f in copy) delete copy[f]; });
    if (!vis.canViewCustomerDetails) {
      CUSTOMER_NAME_FIELDS.forEach((f) => {
        if (f in copy) copy[f] = maskCustomerName(copy[f]);
      });
      CUSTOMER_MASKED_PHONE_FIELDS.forEach((f) => {
        if (f in copy) copy[f] = maskPhone(copy[f]);
      });
      // Nested customer relation, where a join pulled one in.
      if (copy.customer && typeof copy.customer === 'object') {
        copy.customer = {
          ...copy.customer,
          full_name: maskCustomerName(copy.customer.full_name),
          phone: maskPhone(copy.customer.phone),
        };
      }
    }
    return copy;
  });
}

// ZNLY-215 (owner decision): a manager grants the Staff role only; Manager / Admin / Admin viewer are admin only. The database enforces it
// too (migration-386), including "home branch is one the manager manages".
const ROLES_MANAGER_CAN_GRANT = ['staff'];
const ALL_GRANTABLE_ROLES = ['staff', 'manager', 'admin', 'admin_viewer'];

// Which roles `actorRole` is allowed to hand out. Exported so the UI can show
// only grantable options instead of offering one that assertCanGrantRole will
// reject on save — same list, one definition, so the two cannot drift.
export function grantableRolesFor(actorRole) {
  if (actorRole === 'admin') return [...ALL_GRANTABLE_ROLES];
  if (actorRole === 'manager') return [...ROLES_MANAGER_CAN_GRANT];
  return [];
}

function assertCanGrantRole(granterRole, targetRole) {
  if (!ALL_GRANTABLE_ROLES.includes(targetRole)) {
    return { code: 'VALIDATION', message: 'Invalid role.' };
  }
  if (granterRole === 'admin') return null;
  if (granterRole === 'manager' && ROLES_MANAGER_CAN_GRANT.includes(targetRole)) return null;
  return { code: 'UNAUTHORIZED', message: 'Only an admin can give the Manager, Admin or Admin viewer role.' };
}

async function resolveOrgIdForBranch(branchId) {
  if (isOverallBranch(branchId)) {
    const { profile, error } = await getAuthenticatedUser();
    if (error) return { orgId: null, error };
    return { orgId: profile.org_id, error: null };
  }
  const resolvedBranchId = resolveBranchId(branchId);
  const { data: branch, error } = await supabase
    .from('branches')
    .select('org_id')
    .eq('id', resolvedBranchId)
    .single();
  if (error) return { orgId: null, error };
  return { orgId: branch.org_id, error: null };
}

// The list screen's one read: every active therapist in the org (linked or
// not) plus every org user with no therapist (account-only). Org-scoped, not
// branch-scoped — branchId only resolves the org, same reasoning as
// getCustomerIntelligence. Paginated: 63 therapists today, but this is
// exactly the function that lists all of them, and migration-316/postgrest
// truncation already burned two PRs on an unpaginated "list everyone" read.
export async function fetchStaffAccess(branchId) {
  try {
    const { orgId, error: orgErr } = await resolveOrgIdForBranch(branchId);
    if (orgErr) return { data: null, error: orgErr };

    const [therapists, users] = await Promise.all([
      fetchAllPages((opts) =>
        supabase
          .from('therapists')
          .select('id, name, branch_id, position, gender, is_active, is_service_staff, user_id', opts)
          .eq('org_id', orgId)
          .eq('is_active', true)
          .order('name')
          .order('id')
      ),
      fetchAllPages((opts) =>
        supabase
          .from('users')
          .select('id, email, full_name, role, branch_id, is_active, login_access, calendar_visibility, can_view_customer_details, can_view_prices', opts)
          .eq('org_id', orgId)
          .order('full_name')
          .order('id')
      ),
    ]);

    // Manually-ticked extra branches, per user — folded onto each user object
    // so the detail screen's Locations card doesn't need a second round trip
    // (and a second loading state) just to pre-check its boxes.
    const userIds = users.map((u) => u.id);
    // Paginated like every other list read in this file: one row per
    // (user, branch), so a tenant with ~200+ accounts crosses PostgREST's
    // 1000-row cap and would silently lose branch grants — the same silent
    // truncation fixed in #457/#459.
    const grants = userIds.length > 0
      ? await fetchAllPages((opts) =>
          supabase
            .from('user_branches')
            .select('user_id, branch_id', opts)
            .in('user_id', userIds)
            .order('user_id')
            .order('branch_id')
        )
      : [];
    const branchIdsByUser = new Map();
    (grants || []).forEach((g) => {
      if (!branchIdsByUser.has(g.user_id)) branchIdsByUser.set(g.user_id, []);
      branchIdsByUser.get(g.user_id).push(g.branch_id);
    });

    const usersById = new Map(users.map((u) => [u.id, { ...u, branchIds: branchIdsByUser.get(u.id) || [] }]));
    const linkedUserIds = new Set(therapists.filter((t) => t.user_id).map((t) => t.user_id));

    const linked = therapists
      .filter((t) => t.user_id && usersById.has(t.user_id))
      .map((t) => ({ therapist: t, user: usersById.get(t.user_id) }));
    const noLogin = therapists.filter((t) => !t.user_id);
    const accountOnly = Array.from(usersById.values()).filter((u) => !linkedUserIds.has(u.id));

    return { data: { linked, noLogin, accountOnly }, error: null };
  } catch (error) {
    console.error('[API] fetchStaffAccess error:', error.message);
    return { data: null, error };
  }
}

// 4-digit plaintext PIN, same format as the column already holds for every
// existing account (migration-018). Shared by provisionStaffLogin (new
// account), grantStaffAccess (existing account) and updateStaffAccess (edit).
function validatePin(pin) {
  if (pin === undefined || pin === null || pin === '') return null;
  if (!/^\d{4}$/.test(pin)) {
    return { code: 'VALIDATION', message: 'PIN must be exactly 4 digits.' };
  }
  return null;
}

// Create a brand-new staff login and its public.users row.
//
// public.users.id is a hard FK into auth.users, and an auth.users row can only
// be created by the service-role key (which must never reach the browser) or
// by signUp. We use signUp on `supabaseProvision`, an isolated client — signUp
// returns a session for the account it creates, and on the shared client that
// would silently swap the admin's session for the staff member's mid-task.
//
// The admin types the password themselves and hands it to the staff member in
// person — a spa admin does this face to face, so there's no email round trip
// and no reset link nobody can get to. Left blank, a password nobody needs is
// generated instead; that account then relies on its PIN (or a future reset
// flow) to ever sign in. Never surfaced in a return value or a log line — the
// admin typed it, they already know it.
//
// Requires public signup to be enabled on the Supabase project (it is, with
// mailer_autoconfirm on, so the account works immediately). If signup is ever
// disabled for hardening, this is the one place that breaks and the work moves
// to a service-role Edge Function mirroring pin-login.
async function provisionStaffLogin({ email, fullName, orgId, branchId, role, loginAccess, calendarVisibility, password, pin }) {
  const pinError = validatePin(pin);
  if (pinError) return { data: null, error: pinError };

  if (password && password.length > 0 && password.length < 6) {
    return { data: null, error: { code: 'VALIDATION', message: 'Password must be at least 6 characters.' } };
  }
  // crypto.randomUUID is available in every browser this app supports and is
  // CSPRNG-backed — good enough for a password nobody is meant to use.
  const finalPassword = (password && password.length >= 6) ? password : `${crypto.randomUUID()}${crypto.randomUUID()}`;

  const { data: signUpData, error: signUpError } = await supabaseProvision.auth.signUp({
    email,
    password: finalPassword,
  });

  if (signUpError) {
    // An auth account can exist without a public.users row — a half-finished
    // earlier attempt, or an account from another org. Either way the admin
    // cannot fix it from here, so say what happened rather than retrying.
    if (/already registered|already exists/i.test(signUpError.message || '')) {
      return {
        data: null,
        error: {
          code: 'AUTH_ACCOUNT_EXISTS',
          message: `An account for ${email} already exists but isn't set up for this organization. Ask an admin to check it in Supabase, or use a different email.`,
        },
      };
    }
    return { data: null, error: signUpError };
  }

  const authUserId = signUpData?.user?.id;
  if (!authUserId) {
    return { data: null, error: { code: 'PROVISION_FAILED', message: 'The login was not created. Try again.' } };
  }

  // Drop the session signUp just handed us. persistSession:false keeps it out
  // of storage, but it still lives on this client in memory and would be sent
  // on that client's next request.
  await supabaseProvision.auth.signOut().catch(() => {});

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert({
      id: authUserId,
      email,
      full_name: fullName,
      role,
      org_id: orgId,
      branch_id: branchId,
      is_active: true,
      login_access: loginAccess,
      calendar_visibility: calendarVisibility || 'all',
      // No pin here: a PIN is only ever stored hashed, through set_user_pin() (migration-416). grantStaffAccess sets it right after.
    })
    .select('id, org_id')
    .single();

  if (insertError) {
    // The auth.users row now exists with no public.users row behind it. We
    // cannot delete it without the service-role key, so it is an orphan.
    // Surfacing that plainly beats a generic failure: retrying with the same
    // email will hit AUTH_ACCOUNT_EXISTS above and look inexplicable.
    console.error('[API] provisionStaffLogin: auth user created but users insert failed', insertError.message);
    return {
      data: null,
      error: {
        code: 'PROVISION_INCOMPLETE',
        message: `The login for ${email} was created but could not be set up. An admin needs to remove it in Supabase before trying this email again.`,
      },
    };
  }

  return { data: created, error: null };
}

async function grantStaffAccessImpl({ therapistId, email, loginAccess, role, branchIds, calendarVisibility, canViewCustomerDetails, canViewPrices, password, pin }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can grant staff access.' } };
    }

    const roleError = assertCanGrantRole(profile.role, role);
    if (roleError) return { data: null, error: roleError };

    if (!['email', 'none'].includes(loginAccess)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Invalid login access value.' } };
    }
    if (!email || !email.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Email is required to find the account to link.' } };
    }
    const pinError = validatePin(pin);
    if (pinError) return { data: null, error: pinError };

    const { data: therapist, error: therapistErr } = await supabase
      .from('therapists')
      .select('id, org_id, user_id, name, branch_id')
      .eq('id', therapistId)
      .eq('org_id', profile.org_id)
      .single();
    if (therapistErr) {
      if (therapistErr.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found in your organization.' } };
      }
      throw therapistErr;
    }
    if (therapist.user_id) {
      return { data: null, error: { code: 'ALREADY_LINKED', message: `${therapist.name} already has a linked login.` } };
    }

    const cleanEmail = email.trim().toLowerCase();

    let { data: account, error: accountErr } = await supabase
      .from('users')
      .select('id, org_id')
      .eq('org_id', profile.org_id)
      .ilike('email', cleanEmail)
      .maybeSingle();
    if (accountErr) throw accountErr;

    if (!account) {
      // No login exists for this email yet — provision one.
      const provisioned = await provisionStaffLogin({
        email: cleanEmail,
        fullName: therapist.name,
        orgId: profile.org_id,
        branchId: therapist.branch_id,
        role,
        loginAccess,
        calendarVisibility,
        password,
        pin,
      });
      if (provisioned.error) return { data: null, error: provisioned.error };
      account = provisioned.data;
    }
    // `password` only ever applies to the branch above — changing an EXISTING
    // account's password from here would mean changing someone else's auth
    // credential from the admin's own session, which Supabase's client API
    // doesn't allow without the service-role key. Silently dropped rather than
    // pretended to work; the UI doesn't even collect it once an email matches
    // an existing account, so this is a belt-and-suspenders no-op, not a gap
    // the caller can hit by surprise.

    // therapists_user_id_uniq (partial unique on user_id) rejects a second
    // therapist pointing at the same account — catch and return a clean error
    // instead of a raw Postgres constraint message.
    const { data: linkedTherapist, error: linkErr } = await supabase
      .from('therapists')
      .update({ user_id: account.id })
      .eq('id', therapistId)
      .select('id, name, user_id')
      .single();
    if (linkErr) {
      if (linkErr.code === '23505') {
        return { data: null, error: { code: 'ACCOUNT_ALREADY_LINKED', message: 'This account is already linked to another therapist.' } };
      }
      throw linkErr;
    }

    // These two restrictions only make sense for staff — a manager or admin
    // who can't see prices or customer details can't do their job, and the
    // UI only offers the toggles for the staff role. Ignore any attempt to
    // set them on a higher role rather than trust the caller.
    const restrictable = role === 'staff';
    const settingsUpdate = {
      role,
      login_access: loginAccess,
      calendar_visibility: calendarVisibility || 'all',
      can_view_customer_details: restrictable ? canViewCustomerDetails !== false : true,
      can_view_prices: restrictable ? canViewPrices !== false : true,
    };
    // Only touch the PIN when one was actually given — an empty value here
    // must mean "leave it alone", never "clear it", especially on the
    // existing-account path where provisionStaffLogin never ran.
    // (the PIN itself is saved below through set_user_pin(), which hashes it: migration-416)
    const { error: settingsErr } = await supabase
      .from('users')
      .update(settingsUpdate)
      .eq('id', account.id);
    if (settingsErr) {
      // Roll back the link rather than leave a therapist pointing at an
      // account whose settings never landed.
      await supabase.from('therapists').update({ user_id: null }).eq('id', therapistId);
      throw settingsErr;
    }
    if (pin) {
      const { error: pinErr } = await supabase.rpc('set_user_pin', { p_user_id: account.id, p_pin: pin });
      if (pinErr) {
        await supabase.from('therapists').update({ user_id: null }).eq('id', therapistId);
        throw pinErr;
      }
    }

    // Branch access is ticked manually — write exactly what was given, no
    // defaulting to the therapist's home branch and no "all branches" fallback.
    const ids = [...new Set((branchIds || []).filter(Boolean))];
    if (ids.length > 0) {
      const { error: branchErr } = await supabase
        .from('user_branches')
        .upsert(ids.map((branch_id) => ({ user_id: account.id, branch_id })), { onConflict: 'user_id,branch_id', ignoreDuplicates: true });
      if (branchErr) throw branchErr;
    }

    capture('staff_access_granted', { therapist_id: therapistId, role, login_access: loginAccess });
    return { data: linkedTherapist, error: null };
  } catch (error) {
    console.error('[API] grantStaffAccess error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Editing staff access can change the signed-in user's own role/visibility, so drop the cached profile (see getAuthenticatedUser).
export async function grantStaffAccess(...args) {
  try { return await grantStaffAccessImpl(...args); } finally { invalidateAuthenticatedUser(); }
}

// The inverse of grantStaffAccess: attach an existing login to an existing
// therapist without changing the account's settings. Rejects if either side
// is already linked.
async function linkStaffToAccountImpl({ therapistId, userId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can link staff accounts.' } };
    }

    const { data: therapist, error: therapistErr } = await supabase
      .from('therapists')
      .select('id, org_id, user_id, name')
      .eq('id', therapistId)
      .eq('org_id', profile.org_id)
      .single();
    if (therapistErr) throw therapistErr;
    if (therapist.user_id) {
      return { data: null, error: { code: 'ALREADY_LINKED', message: `${therapist.name} already has a linked login.` } };
    }

    const { data: account, error: accountErr } = await supabase
      .from('users')
      .select('id, org_id')
      .eq('id', userId)
      .eq('org_id', profile.org_id)
      .single();
    if (accountErr) throw accountErr;

    const { data, error } = await supabase
      .from('therapists')
      .update({ user_id: account.id })
      .eq('id', therapistId)
      .select('id, name, user_id')
      .single();
    if (error) {
      if (error.code === '23505') {
        return { data: null, error: { code: 'ACCOUNT_ALREADY_LINKED', message: 'This account is already linked to another therapist.' } };
      }
      throw error;
    }

    capture('staff_account_linked', { therapist_id: therapistId });
    return { data, error: null };
  } catch (error) {
    console.error('[API] linkStaffToAccount error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Editing staff access can change the signed-in user's own role/visibility, so drop the cached profile (see getAuthenticatedUser).
export async function linkStaffToAccount(...args) {
  try { return await linkStaffToAccountImpl(...args); } finally { invalidateAuthenticatedUser(); }
}

// Unlinking is not deletion: the users row survives, it just stops being
// anyone's "who am I" link. The therapist goes back to no-login.
async function unlinkStaffAccessImpl({ therapistId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can unlink staff access.' } };
    }

    const { data, error } = await supabase
      .from('therapists')
      .update({ user_id: null })
      .eq('id', therapistId)
      .eq('org_id', profile.org_id)
      .select('id, name, user_id')
      .single();
    if (error) throw error;

    capture('staff_access_unlinked', { therapist_id: therapistId });
    return { data, error: null };
  } catch (error) {
    console.error('[API] unlinkStaffAccess error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Editing staff access can change the signed-in user's own role/visibility, so drop the cached profile (see getAuthenticatedUser).
export async function unlinkStaffAccess(...args) {
  try { return await unlinkStaffAccessImpl(...args); } finally { invalidateAuthenticatedUser(); }
}

// Detail screen's Save: role / login_access / calendar_visibility / branch
// grants for an already-linked (or account-only) user. Branch grants, when
// provided, REPLACE the full set — same manual-ticking rule as grantStaffAccess.
async function updateStaffAccessImpl({ userId, role, loginAccess, calendarVisibility, branchIds, canViewCustomerDetails, canViewPrices, pin }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can update staff access.' } };
    }
    const pinError = validatePin(pin);
    if (pinError) return { data: null, error: pinError };

    const { data: target, error: targetErr } = await supabase
      .from('users')
      .select('id, org_id, role')
      .eq('id', userId)
      .eq('org_id', profile.org_id)
      .single();
    if (targetErr) throw targetErr;

    const updatePayload = {};
    if (role !== undefined && role !== target.role) {
      const roleError = assertCanGrantRole(profile.role, role);
      if (roleError) return { data: null, error: roleError };
      updatePayload.role = role;
    }
    if (loginAccess !== undefined) {
      if (!['email', 'none'].includes(loginAccess)) {
        return { data: null, error: { code: 'VALIDATION', message: 'Invalid login access value.' } };
      }
      updatePayload.login_access = loginAccess;
    }
    if (calendarVisibility !== undefined) {
      if (!['own', 'own_view', 'all', 'all_view'].includes(calendarVisibility)) {
        return { data: null, error: { code: 'VALIDATION', message: 'Invalid calendar visibility value.' } };
      }
      updatePayload.calendar_visibility = calendarVisibility;
    }

    // Same rule as grantStaffAccess: these only mean something for staff.
    // Resolve against the role this account will actually end up with (the
    // incoming one if it's changing, otherwise the one it already has).
    if (canViewCustomerDetails !== undefined || canViewPrices !== undefined) {
      const effectiveRole = role !== undefined ? role : target.role;
      const restrictable = effectiveRole === 'staff';
      if (canViewCustomerDetails !== undefined) {
        updatePayload.can_view_customer_details = restrictable ? canViewCustomerDetails !== false : true;
      }
      if (canViewPrices !== undefined) {
        updatePayload.can_view_prices = restrictable ? canViewPrices !== false : true;
      }
    }

    // A blank PIN here means "leave it alone", never "clear it" — same as
    // grantStaffAccess.
    // The PIN itself is saved below through set_user_pin(), which hashes it (migration-416).

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await supabase
        .from('users')
        .update(updatePayload)
        .eq('id', userId);
      if (updateErr) throw updateErr;
    }

    if (pin) {
      const { error: pinErr } = await supabase.rpc('set_user_pin', { p_user_id: userId, p_pin: pin });
      if (pinErr) throw pinErr;
    }

    if (branchIds !== undefined) {
      const ids = [...new Set((branchIds || []).filter(Boolean))];
      const { error: deleteErr } = await supabase
        .from('user_branches')
        .delete()
        .eq('user_id', userId);
      if (deleteErr) throw deleteErr;
      if (ids.length > 0) {
        const { error: insertErr } = await supabase
          .from('user_branches')
          .insert(ids.map((branch_id) => ({ user_id: userId, branch_id })));
        if (insertErr) throw insertErr;
      }
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, login_access, calendar_visibility, can_view_customer_details, can_view_prices')
      .eq('id', userId)
      .single();
    if (error) throw error;

    capture('staff_access_updated', { user_id: userId });
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateStaffAccess error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Editing staff access can change the signed-in user's own role/visibility, so drop the cached profile (see getAuthenticatedUser).
export async function updateStaffAccess(...args) {
  try { return await updateStaffAccessImpl(...args); } finally { invalidateAuthenticatedUser(); }
}

// ============================================================
// Tiered pricing (migration-319/323/324): named staff tiers, per-service
// per-tier prices, and the two DB functions that resolve what a service
// actually costs. service_price_range/service_price_for_therapist are called
// via rpc() rather than reimplemented here — see their own comments in
// migration-323 for why (so the booking screen, payment screen and reports
// can't drift apart). Neither is gated behind canViewPrices: both are used
// either by the anonymous customer booking flow (no profile to gate on) or
// internally by a write path that must compute the real charge regardless of
// the acting staff member's own visibility — exactly like recordPayment's
// `remaining` is computed unconditionally and only the DISPLAYED message is
// withheld.
// ============================================================

export async function fetchPriceTiers() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const tiers = await fetchAllPages((opts) =>
      supabase
        .from('price_tiers')
        .select('id, name, sort_order', opts)
        .eq('org_id', profile.org_id)
        .order('sort_order')
        .order('id')
    );
    return { data: tiers, error: null };
  } catch (error) {
    console.error('[API] fetchPriceTiers error:', error.message);
    return { data: null, error };
  }
}

export async function createPriceTier({ name }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create price tiers.' } };
    }
    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Tier name is required.' } };
    }

    const { data: existing } = await supabase
      .from('price_tiers')
      .select('id')
      .eq('org_id', profile.org_id)
      .ilike('name', name.trim())
      .maybeSingle();
    if (existing) {
      return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A tier with this name already exists.' } };
    }

    const { data: maxRow } = await supabase
      .from('price_tiers')
      .select('sort_order')
      .eq('org_id', profile.org_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('price_tiers')
      .insert({ org_id: profile.org_id, name: name.trim(), sort_order: nextSortOrder })
      .select('id, name, sort_order')
      .single();
    if (error) {
      if (error.code === '23505') {
        return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A tier with this name already exists.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] createPriceTier error:', error.message);
    return { data: null, error };
  }
}

export async function renamePriceTier({ tierId, name }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can rename price tiers.' } };
    }
    if (!name || !name.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Tier name is required.' } };
    }

    const { data, error } = await supabase
      .from('price_tiers')
      .update({ name: name.trim() })
      .eq('id', tierId)
      .eq('org_id', profile.org_id)
      .select('id, name, sort_order')
      .single();
    if (error) {
      if (error.code === '23505') {
        return { data: null, error: { code: 'DUPLICATE_NAME', message: 'A tier with this name already exists.' } };
      }
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Tier not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] renamePriceTier error:', error.message);
    return { data: null, error };
  }
}

// Reassigns sort_order to match the given order exactly — the drag-to-reorder
// write. Caller passes every tier's id in its new order, not a partial list.
export async function reorderPriceTiers({ orderedIds }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can reorder price tiers.' } };
    }
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return { data: null, error: { code: 'VALIDATION', message: 'No tiers to reorder.' } };
    }

    const results = await Promise.all(
      orderedIds.map((id, index) =>
        supabase
          .from('price_tiers')
          .update({ sort_order: index })
          .eq('id', id)
          .eq('org_id', profile.org_id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] reorderPriceTiers error:', error.message);
    return { data: null, error };
  }
}

// Deleting a tier SET NULLs therapists.price_tier_id (untiers its staff, see
// migration-319) and CASCADEs service_tier_prices (loses its per-service
// prices). The caller surfaces both counts in a confirmation before calling
// this — fetched here so the warning can't drift from what the delete
// actually does.
export async function fetchPriceTierImpact({ tierId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const [{ count: staffCount, error: staffErr }, { count: priceCount, error: priceErr }] = await Promise.all([
      supabase.from('therapists').select('id', { count: 'exact', head: true }).eq('price_tier_id', tierId).eq('org_id', profile.org_id),
      supabase.from('service_tier_prices').select('id', { count: 'exact', head: true }).eq('price_tier_id', tierId),
    ]);
    if (staffErr) throw staffErr;
    if (priceErr) throw priceErr;

    return { data: { staffCount: staffCount || 0, servicePriceCount: priceCount || 0 }, error: null };
  } catch (error) {
    console.error('[API] fetchPriceTierImpact error:', error.message);
    return { data: null, error };
  }
}

export async function deletePriceTier({ tierId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can delete price tiers.' } };
    }

    const { error } = await supabase
      .from('price_tiers')
      .delete()
      .eq('id', tierId)
      .eq('org_id', profile.org_id);
    if (error) throw error;

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] deletePriceTier error:', error.message);
    return { data: null, error };
  }
}

// Every active therapist in the org plus their tier (or none), for the tier
// manager's staff-count pill and assignment popover. Paginated — same reason
// as fetchStaffAccess: this is exactly the function that lists all of them.
export async function fetchTherapistsForTierAssignment() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!profile.org_id) {
      return { data: null, error: { code: 'NO_ORG', message: 'User is not associated with an organization.' } };
    }

    const therapists = await fetchAllPages((opts) =>
      supabase
        .from('therapists')
        .select('id, name, position, price_tier_id', opts)
        .eq('org_id', profile.org_id)
        .eq('is_active', true)
        .order('name')
        .order('id')
    );
    return { data: therapists, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistsForTierAssignment error:', error.message);
    return { data: null, error };
  }
}

// tierId: null un-tiers the therapist (back to charging the Unassigned rate).
export async function assignTherapistTier({ therapistId, tierId }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can assign price tiers.' } };
    }

    const { data, error } = await supabase
      .from('therapists')
      .update({ price_tier_id: tierId || null })
      .eq('id', therapistId)
      .eq('org_id', profile.org_id)
      .select('id, name, price_tier_id')
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Therapist not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] assignTherapistTier error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

/** ZNLY-320: last-90-day booking counts per service for one branch (feeds "MOST BOOKED"). Never throws; a failure just means no group. */
export async function fetchServiceBookingCounts(branchId) {
  try {
    if (!branchId) return { data: [], error: null };
    const { data, error } = await supabase.rpc('service_booking_counts', { p_branch_id: branchId });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.warn('[API] fetchServiceBookingCounts:', error?.message);
    return { data: [], error };
  }
}

/** ZNLY-320: { [serviceId]: [lowest tier price] } for every tiered service in the org; readable by any login that may see prices. */
export async function fetchServiceMinTierPrices() {
  try {
    const { data, error } = await supabase.rpc('service_min_tier_prices');
    if (error) throw error;
    const out = {};
    (data || []).forEach((r) => { out[r.service_id] = [Number(r.min_tier_price)]; });
    return { data: out, error: null };
  } catch (error) {
    console.warn('[API] fetchServiceMinTierPrices:', error?.message);
    return { data: {}, error };
  }
}

/** ZNLY-320: category name -> display_order for the service picker's headers. */
export async function fetchServiceCategoryOrder() {
  try {
    const { data, error } = await supabase.from('service_categories').select('name, display_order').eq('is_active', true).not('display_order', 'is', null);
    if (error) throw error;
    const out = {};
    (data || []).forEach((r) => { if (r.display_order != null) out[r.name] = Number(r.display_order); });
    return { data: out, error: null };
  } catch (error) {
    console.warn('[API] fetchServiceCategoryOrder:', error?.message);
    return { data: {}, error };
  }
}

/** Tier prices of every tiered service at once, for the Services list: { [serviceId]: [price_npr, ...] }. Manager/admin only (RLS scopes it to the org). */
export async function fetchTierPricesByService() {
  try {
    const rows = await fetchAllPages((opts) =>
      supabase.from('service_tier_prices').select('service_id, price_npr', opts).order('id')
    );
    const byService = {};
    rows.forEach((r) => { (byService[r.service_id] ||= []).push(Number(r.price_npr)); });
    return { data: byService, error: null };
  } catch (error) {
    console.error('[API] fetchTierPricesByService error:', error.message);
    return { data: null, error };
  }
}

// Every tier price set for one service (sparse — a tier with no row charges
// the Unassigned rate, services.price_npr, never zero). Manager/admin only,
// same gate as the Service Detail page these feed — a price-restricted
// account can never reach this screen (createService/updateServicePricing
// already require manager/admin, and that restriction only ever applies to
// the staff role), so no separate canViewPrices check is needed here.
export async function fetchServiceTierPrices(serviceId) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can view tier prices.' } };
    }

    const rows = await fetchAllPages((opts) =>
      supabase
        .from('service_tier_prices')
        .select('id, price_tier_id, price_npr', opts)
        .eq('service_id', serviceId)
        .order('id')
    );
    return { data: rows, error: null };
  } catch (error) {
    console.error('[API] fetchServiceTierPrices error:', error.message);
    return { data: null, error };
  }
}

// Replaces the full set of tier prices for a service. `prices` is
// [{ priceTierId, priceNpr }] — a tier left out of the array (not just given
// a falsy price) is the one true way to mean "same as Unassigned"; passing
// price_npr: 0 would make that tier free, which is a different thing.
export async function setServiceTierPrices(serviceId, prices) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can set tier prices.' } };
    }

    const { error: serviceErr } = await supabase
      .from('services')
      .select('id, org_id')
      .eq('id', serviceId)
      .eq('org_id', profile.org_id)
      .single();
    if (serviceErr) {
      if (serviceErr.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Service not found.' } };
      }
      throw serviceErr;
    }

    const entries = (prices || []).filter((p) => p.priceNpr !== null && p.priceNpr !== undefined && p.priceNpr !== '');
    const invalid = entries.find((p) => Number(p.priceNpr) < 0);
    if (invalid) {
      return { data: null, error: { code: 'VALIDATION', message: 'Tier prices cannot be negative.' } };
    }

    const { error: deleteErr } = await supabase
      .from('service_tier_prices')
      .delete()
      .eq('service_id', serviceId);
    if (deleteErr) throw deleteErr;

    if (entries.length > 0) {
      const { error: insertErr } = await supabase
        .from('service_tier_prices')
        .insert(entries.map((p) => ({ service_id: serviceId, price_tier_id: p.priceTierId, price_npr: Number(p.priceNpr) })));
      if (insertErr) throw insertErr;
    }

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('[API] setServiceTierPrices error:', error.message);
    return { data: null, error };
  }
}

// { min_price, max_price } across the Unassigned rate and every tier price
// (migration-323). Drives the "Rs 160 - 380" range shown to customers online.
export async function fetchServicePriceRange(serviceId) {
  try {
    const { data, error } = await supabase.rpc('service_price_range', { p_service_id: serviceId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { data: row ? { minPrice: Number(row.min_price), maxPrice: Number(row.max_price) } : null, error: null };
  } catch (error) {
    console.error('[API] fetchServicePriceRange error:', error.message);
    return { data: null, error };
  }
}

// What this specific therapist charges for this service — their tier price,
// or the Unassigned rate if they have none (migration-323's own COALESCE,
// never reimplemented here).
export async function fetchServicePriceForTherapist(serviceId, therapistId) {
  try {
    const { data, error } = await supabase.rpc('service_price_for_therapist', {
      p_service_id: serviceId,
      p_therapist_id: therapistId,
    });
    if (error) throw error;
    return { data: data != null ? Number(data) : null, error: null };
  } catch (error) {
    console.error('[API] fetchServicePriceForTherapist error:', error.message);
    return { data: null, error };
  }
}

// ============================================================
// Waitlist (migration-327): customers waiting for a slot, modelled on
// Timely's. Deliberately not a booking with a special status — see the
// migration's own comment. Booking someone in reuses the normal booking
// flow entirely (createBooking/createComboBookingItems); this module only
// tracks the queue itself and flips an entry to 'booked' once that other
// flow actually succeeds.
// ============================================================

// Every waiting entry for a branch, oldest-first by default — the point of a
// queue is that waiting longer gets you served sooner. Holds a customer name
// and phone, so it goes through the same canViewCustomerDetails masking as
// bookings (redactRows) rather than inventing a second masking path.
export async function fetchWaitlist(branchId, { sort = 'oldest' } = {}) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const vis = await resolveVisibility(profile);

    // Overall sentinel must not route through resolveBranchId — it would
    // silently coerce to a hardcoded default branch (same trap withBranch's
    // own comment warns about). The write path (addToWaitlist) requires a
    // concrete branch since a waitlist entry outlives the request; a read
    // can safely go org-wide for Overall the same way withBranch already
    // does everywhere else, since RLS is org-scoped regardless.
    const rows = await fetchAllPages((opts) =>
      withBranch(
        supabase
          .from('waitlist_entries')
          .select(`
            id, customer_id, customer_name, customer_phone, service_id,
            preferred_date, preferred_time, preferred_therapist_id, notes,
            status, booking_id, created_at,
            service:services(id, name),
            therapist:therapists(id, name)
          `, opts)
          .eq('status', 'waiting'),
        branchId
      )
        .order('created_at', { ascending: sort !== 'newest' })
        .order('id')
    );

    return { data: redactRows(rows, vis), error: null };
  } catch (error) {
    console.error('[API] fetchWaitlist error:', error.message);
    return { data: null, error };
  }
}

// Everything but who/where is optional — "any time this week" is a real
// request, and forcing a date or service would make staff invent one.
export async function addToWaitlist({ branchId, customerId, customerName, customerPhone, serviceId, preferredDate, preferredTime, preferredTherapistId, notes }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!customerName || !customerName.trim()) {
      return { data: null, error: { code: 'VALIDATION', message: 'Customer name is required.' } };
    }
    // The Overall sentinel has no real branch — resolveBranchId would silently
    // coerce it to a hardcoded default (see its own warning comment), filing
    // a durable row under a branch nobody chose. A read inheriting that
    // (getCalendarBookings does the same) is defensible; a write is not —
    // require an explicit branch for an entry that will outlive this request.
    if (isOverallBranch(branchId)) {
      return { data: null, error: { code: 'BRANCH_REQUIRED', message: 'Select a specific branch before adding to the waitlist.' } };
    }

    const resolvedBranchId = resolveBranchId(branchId);
    const { data, error } = await supabase
      .from('waitlist_entries')
      .insert({
        org_id: profile.org_id,
        branch_id: resolvedBranchId,
        customer_id: customerId || null,
        customer_name: customerName.trim(),
        customer_phone: customerPhone || null,
        service_id: serviceId || null,
        preferred_date: preferredDate || null,
        preferred_time: preferredTime || null,
        preferred_therapist_id: preferredTherapistId || null,
        notes: notes || null,
        created_by: profile.id,
      })
      .select('id, customer_id, customer_name, customer_phone, service_id, preferred_date, preferred_time, preferred_therapist_id, notes, status, created_at')
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] addToWaitlist error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Covers both "Edit" (any field) and the convert-to-booking flip
// (status: 'booked', bookingId) — same narrow update, different fields.
export async function updateWaitlistEntry({ id, customerId, customerName, customerPhone, serviceId, preferredDate, preferredTime, preferredTherapistId, notes, status, bookingId }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!id) return { data: null, error: { code: 'VALIDATION', message: 'Entry id is required.' } };
    // 'removed' only ever goes through removeFromWaitlist, which also sets
    // removed_at/removed_by — allowing it here would let a caller flip the
    // status and silently skip those audit fields.
    if (status === 'removed') {
      return { data: null, error: { code: 'VALIDATION', message: 'Use removeFromWaitlist to remove an entry.' } };
    }

    const updatePayload = {};
    if (customerId !== undefined) updatePayload.customer_id = customerId || null;
    if (customerName !== undefined) {
      if (!customerName.trim()) {
        return { data: null, error: { code: 'VALIDATION', message: 'Customer name is required.' } };
      }
      updatePayload.customer_name = customerName.trim();
    }
    if (customerPhone !== undefined) updatePayload.customer_phone = customerPhone || null;
    if (serviceId !== undefined) updatePayload.service_id = serviceId || null;
    if (preferredDate !== undefined) updatePayload.preferred_date = preferredDate || null;
    if (preferredTime !== undefined) updatePayload.preferred_time = preferredTime || null;
    if (preferredTherapistId !== undefined) updatePayload.preferred_therapist_id = preferredTherapistId || null;
    if (notes !== undefined) updatePayload.notes = notes || null;
    if (status !== undefined) updatePayload.status = status;
    if (bookingId !== undefined) updatePayload.booking_id = bookingId || null;

    if (Object.keys(updatePayload).length === 0) {
      return { data: null, error: { code: 'NO_CHANGES', message: 'No fields to update.' } };
    }

    const { data, error } = await supabase
      .from('waitlist_entries')
      .update(updatePayload)
      .eq('id', id)
      .select('id, customer_name, customer_phone, service_id, preferred_date, preferred_time, preferred_therapist_id, notes, status, booking_id')
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Waitlist entry not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] updateWaitlistEntry error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// Never a hard delete — there is deliberately no DELETE policy on this table
// (migration-327). Removing sets status='removed' so the queue keeps its
// history of who was waiting and why they left.
export async function removeFromWaitlist(id) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('waitlist_entries')
      .update({ status: 'removed', removed_at: new Date().toISOString(), removed_by: profile.id })
      .eq('id', id)
      .select('id, status')
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: { code: 'NOT_FOUND', message: 'Waitlist entry not found.' } };
      }
      throw error;
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] removeFromWaitlist error:', error.message);
    return { data: null, error: plainError(error) };
  }
}

// ============================================================
// Billing / tax invoices (migration-328/329).
// ============================================================

const BILLING_SETTING_KEYS = [
  'billing_legal_name', 'billing_pan', 'billing_address', 'billing_phone',
  'billing_email', 'billing_tax_mode', 'billing_vat_rate',
  'billing_invoice_prefix', 'billing_footer_text', 'billing_enabled',
];

// Every billing_* key read off organizations.settings in one call — the
// Billing settings panel and the "can I issue?" gate both need the full set.
export async function fetchBillingSettings() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data: org, error } = await supabase
      .from('organizations')
      .select('name, settings')
      .eq('id', profile.org_id)
      .single();
    if (error) throw error;

    const settings = org.settings || {};
    return {
      data: {
        orgName: org.name,
        billingEnabled: settings.billing_enabled === true,
        legalName: settings.billing_legal_name || '',
        pan: settings.billing_pan || '',
        address: settings.billing_address || '',
        phone: settings.billing_phone || '',
        email: settings.billing_email || '',
        taxMode: settings.billing_tax_mode || '',
        vatRate: settings.billing_vat_rate != null ? Number(settings.billing_vat_rate) : 13,
        invoicePrefix: settings.billing_invoice_prefix || '',
        footerText: settings.billing_footer_text || '',
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchBillingSettings error:', error.message);
    return { data: null, error };
  }
}

// Thin wrapper over update_org_profile_settings (migration-329 widened its
// allow-list) — same RPC every other org setting in this app already uses.
// Admin-only is enforced server-side inside that function.
export async function updateBillingSetting(key, value) {
  if (!BILLING_SETTING_KEYS.includes(key)) {
    return { data: null, error: { code: 'VALIDATION', message: `Unknown billing setting: ${key}` } };
  }
  const { data, error } = await supabase.rpc('update_org_profile_settings', { p_key: key, p_value: value });
  if (error) {
    return { data: null, error: { code: error.code || 'UPDATE_FAILED', message: error.message || 'Failed to update billing setting.' } };
  }
  return { data, error: null };
}

// Issue (or re-fetch, if already issued) the tax invoice for a paid booking.
// All validation, numbering, and the VAT math live in issue_invoice()
// (SECURITY DEFINER, migration-328) — this is a thin wrapper so the same
// error messages the DB function raises reach the UI unmodified.
export async function issueInvoice(bookingId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!bookingId) return { data: null, error: { code: 'VALIDATION', message: 'Booking id is required.' } };

    const { data, error } = await supabase.rpc('issue_invoice', { p_booking_id: bookingId });
    if (error) {
      return { data: null, error: { code: error.code || 'ISSUE_FAILED', message: error.message || 'Could not issue the invoice.' } };
    }
    return { data, error: null };
  } catch (error) {
    console.error('[API] issueInvoice error:', error.message);
    return { data: null, error };
  }
}

export async function fetchInvoiceByBookingId(bookingId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[API] fetchInvoiceByBookingId error:', error.message);
    return { data: null, error };
  }
}

// Everything the Print invoice dialog shows before anything is issued: the booking's customer, the invoice if one already exists, and how
// many times it has been printed (0 means the next print is the Original). Read-only; issuing and printing stay in the RPCs below.
export async function fetchInvoiceDialogInfo(bookingId) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const [{ data: booking, error: bErr }, { data: invoice, error: iErr }] = await Promise.all([
      supabase.from('bookings').select('booking_number, customer_name, customer_phone').eq('id', bookingId).maybeSingle(),
      supabase.from('invoices').select('id, invoice_number, buyer_name, buyer_phone, buyer_pan').eq('booking_id', bookingId).maybeSingle(),
    ]);
    if (bErr) throw bErr;
    if (iErr) throw iErr;
    let printCount = 0;
    if (invoice) {
      const { count, error: pErr } = await supabase.from('invoice_prints').select('id', { count: 'exact', head: true }).eq('invoice_id', invoice.id);
      if (pErr) throw pErr;
      printCount = count || 0;
    }
    return { data: { booking, invoice, printCount }, error: null };
  } catch (error) {
    console.error('[API] fetchInvoiceDialogInfo error:', error.message);
    return { data: null, error };
  }
}

// Which of these bookings already has an invoice — one query for the whole
// set, not one per row. Lets a list (CustomerPaymentsTab) keep the "Print
// invoice" entry point visible for a booking that was invoiced before billing
// got disabled, without an N+1 lookup across every paid booking in the list.
export async function fetchInvoiceExistenceForBookingIds(bookingIds) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    const ids = [...new Set((bookingIds || []).filter(Boolean))];
    if (ids.length === 0) return { data: new Set(), error: null };

    const { data, error } = await supabase
      .from('invoices')
      .select('booking_id')
      .in('booking_id', ids);
    if (error) throw error;
    return { data: new Set((data || []).map((r) => r.booking_id)), error: null };
  } catch (error) {
    console.error('[API] fetchInvoiceExistenceForBookingIds error:', error.message);
    return { data: null, error };
  }
}

// Logs that an invoice was actually printed, and tells the caller whether to
// render it as ORIGINAL or COPY. The ordinal is allocated atomically inside
// record_invoice_print() (migration-331) — a count-then-insert from the
// client raced: two concurrent prints (e.g. a double-click) could both read
// count=0 and both print ORIGINAL.
export async function recordInvoicePrint({ invoiceId, printType }) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };
    if (!['a4', 'thermal'].includes(printType)) {
      return { data: null, error: { code: 'VALIDATION', message: 'Invalid print type.' } };
    }

    const { data, error } = await supabase.rpc('record_invoice_print', {
      p_invoice_id: invoiceId,
      p_print_type: printType,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { data: { copyLabel: row.copy_label }, error: null };
  } catch (error) {
    console.error('[API] recordInvoicePrint error:', error.message);
    return { data: null, error };
  }
}
