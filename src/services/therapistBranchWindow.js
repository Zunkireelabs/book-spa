/**
 * Reconstructs which branch a therapist is expected to physically be at, at a given
 * Nepal-local date/time, from their full staff_transfers history.
 *
 * Why this exists: `therapists.branch_id` only reflects the CURRENT moment (it's
 * flipped by the apply_due_staff_transfers / apply_due_staff_reverts cron jobs when a
 * transfer's window opens/closes). That makes it the wrong thing to check when
 * assigning or rescheduling a booking to a DIFFERENT date/time — a scheduled future
 * transfer, or a temporary transfer whose window has already opened/closed relative to
 * the booking's date, can disagree with the therapist's *live* branch_id. Every
 * transfer's [start, revert) window is fully known at creation time (migration-145),
 * so this walks the window history directly instead of trusting the live snapshot.
 */

function normalizeTime(timeStr) {
  if (!timeStr) return '00:00:00';
  return timeStr.length === 5 ? `${timeStr}:00` : timeStr.slice(0, 8);
}

/** Nepal (Asia/Kathmandu, fixed +05:45, no DST) wall-clock Date for a date+time pair. */
export function toKathmanduDate(dateStr, timeStr) {
  if (!dateStr) return null;
  return new Date(`${dateStr}T${normalizeTime(timeStr)}+05:45`);
}

/**
 * @param {Array} transfers - raw staff_transfers rows for one therapist, each with
 *   from_branch_id, to_branch_id, is_permanent, effective_date, start_time, revert_at.
 *   Order/applied/reverted flags are irrelevant — the window itself is reconstructed
 *   purely from the timestamps, so completed/reverted transfers are handled the same
 *   as pending ones (this is what keeps legitimate SEQUENTIAL transfers unblocked).
 * @param {string} fallbackBranchId - therapist's current branch_id; used only when
 *   there's no transfer history at all, or `atDate` predates the earliest transfer.
 * @param {Date} atDate - the moment being validated (a booking's date + start_time).
 * @returns {string} the branch_id the therapist is expected to be at, at atDate.
 */
export function computeTherapistBranchAt(transfers, fallbackBranchId, atDate) {
  const windows = (transfers || [])
    .filter((t) => t && t.effective_date)
    .map((t) => ({
      fromBranchId: t.from_branch_id,
      toBranchId: t.to_branch_id,
      isPermanent: !!t.is_permanent,
      startAt: toKathmanduDate(t.effective_date, t.start_time),
      endAt: t.revert_at ? new Date(t.revert_at) : null,
    }))
    .sort((a, b) => a.startAt - b.startAt);

  let branch = windows.length > 0 ? windows[0].fromBranchId : fallbackBranchId;

  for (const w of windows) {
    if (w.startAt > atDate) continue; // not in effect yet at atDate
    if (w.isPermanent || !w.endAt) {
      // No scheduled end means open-ended toward toBranchId. This covers three cases:
      // an explicit permanent transfer; a system-generated "returned" history row
      // (inserted by apply_due_staff_reverts()/revert_staff_transfer_now() with no
      // revert_at); and legacy rows made before migration-145 added start_time/
      // duration/revert_at (is_permanent defaults to false on those, but they have no
      // revert mechanism at all, so they're permanent in effect). All three represent
      // a completed/indefinite move, not a still-open temporary window — treating a
      // missing endAt as "already closed" would send the therapist back to their OLD
      // branch forever, even though their live therapists.branch_id — and reality —
      // has them at the destination branch indefinitely.
      branch = w.toBranchId;
    } else if (atDate < w.endAt) {
      branch = w.toBranchId; // inside the temporary visiting window
    } else {
      branch = w.fromBranchId; // temporary window has closed
    }
  }

  return branch;
}

/**
 * Given a therapist's staff_transfers rows (raw DB shape, any applied/reverted status),
 * finds the one relevant to `branchId` and describes it the way the Calendar's orphan-column
 * fallback (getCalendarBookings, api.js) needs: which direction relative to branchId, and the
 * real [start, end] window — instead of the caller's default "unknown window, block the whole
 * column all day."
 *
 * Only considers non-permanent, non-return-leg rows with a real revert_at (the same "genuinely
 * a temporary window" signal already used by the transferredOut/transferredIn queries in
 * getCalendarBookings) that touch branchId on either side AND overlap [rangeStart, rangeEnd]
 * when that range is supplied. The overlap requirement matters: getCalendarBookings'
 * filteredTherapists ghost-column filter (calendar/index.jsx) drops any transferredIn/
 * transferredOut column whose returnsAt date has already passed as of the day being viewed —
 * so adopting a STALE window (one that closed before the requested range even starts) would
 * make the orphan column vanish from the day being rendered instead of shading it, silently
 * re-opening the exact "booking falls into Unassigned" bug this whole mechanism exists to
 * prevent. When more than one candidate overlaps the range, picks the most recently created
 * (transferred_at) among those. When none overlap, returns null — the caller's conservative
 * block-everything default is correct there, not a stale, irrelevant window.
 *
 * @param {Array} transfers - raw staff_transfers rows for one therapist: each with
 *   from_branch_id, to_branch_id, is_permanent, is_return_leg, revert_at, effective_date,
 *   start_time, transferred_at.
 * @param {string} branchId - the branch whose calendar is being rendered.
 * @param {Date} [rangeStart] - Kathmandu-local instant the requested calendar range starts at
 *   (e.g. toKathmanduDate(startDate, '00:00:00')). Omit to keep every touching window as a
 *   candidate (matches pre-range-aware behavior).
 * @param {Date} [rangeEnd] - Kathmandu-local instant the requested calendar range ends at.
 *   Both rangeStart and rangeEnd must be supplied together to filter by overlap.
 * @returns {{transferredOut: true, returnsAt: string, transferStartAt: string|null}
 *   | {transferredIn: true, returnsAt: string, transferStartAt: string|null, fromBranch: string|null}
 *   | null} null when no matching, range-relevant temporary window exists — caller keeps its
 *   block-everything default, which is correct for a truly permanent/unknown/stale case.
 */
export function resolveOrphanTransferWindow(transfers, branchId, rangeStart, rangeEnd) {
  const overlapsRange = (t) => {
    if (!rangeStart || !rangeEnd) return true;
    const start = t.effective_date && t.start_time
      ? new Date(`${t.effective_date}T${normalizeTime(t.start_time)}+05:45`)
      : null;
    const end = new Date(t.revert_at);
    return (!start || start < rangeEnd) && end > rangeStart;
  };

  const relevant = (transfers || [])
    .filter((t) => t && !t.is_permanent && !t.is_return_leg && t.revert_at
      && (t.from_branch_id === branchId || t.to_branch_id === branchId)
      && overlapsRange(t))
    .sort((a, b) => new Date(b.transferred_at) - new Date(a.transferred_at));

  const t = relevant[0];
  if (!t) return null;

  const transferStartAt = t.effective_date && t.start_time
    ? `${t.effective_date}T${normalizeTime(t.start_time)}+05:45`
    : null;

  if (t.to_branch_id === branchId) {
    return { transferredIn: true, returnsAt: t.revert_at, transferStartAt, fromBranch: t.fromBranch?.name || null };
  }
  return { transferredOut: true, returnsAt: t.revert_at, transferStartAt };
}

/**
 * Whether a booking's date/start_time falls at or after a therapist's already-recorded
 * check-out for that date — i.e. they've clocked out and shouldn't be booked into any
 * slot from that point through the rest of the day.
 *
 * @param {string|null} checkOutTime - raw therapist_attendance.check_out_time
 *   (timestamptz) for that therapist on that date, or null/undefined if not checked out.
 * @param {string} bookingDate - the booking's date (YYYY-MM-DD).
 * @param {string} bookingStartTime - the booking's start_time (HH:MM or HH:MM:SS).
 * @returns {boolean}
 */
export function isAfterCheckout(checkOutTime, bookingDate, bookingStartTime) {
  if (!checkOutTime) return false;
  const atDate = toKathmanduDate(bookingDate, bookingStartTime);
  if (!atDate) return false;
  return atDate >= new Date(checkOutTime);
}
