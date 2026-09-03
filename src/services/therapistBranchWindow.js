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
    if (w.isPermanent) {
      branch = w.toBranchId;
    } else if (w.endAt && atDate < w.endAt) {
      branch = w.toBranchId; // inside the temporary visiting window
    } else {
      branch = w.fromBranchId; // window hasn't started yet or has already closed
    }
  }

  return branch;
}
