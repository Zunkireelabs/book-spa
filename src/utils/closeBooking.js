// "Close a past booking" as a walk through the booking state machine (no direct Confirmed → Completed exists), kept pure so the
// partial-failure behaviour can be unit tested with an injected `update(newStatus, reason)`.
const WALK = { Pending: ['Confirmed', 'In-Progress', 'Completed'], Confirmed: ['In-Progress', 'Completed'], 'In-Progress': ['Completed'] };

/** The [newStatus, reason?] steps for closing a booking that is currently `status`, or null when it can't be closed. */
export function planClose(status, outcome, reason) {
  if (outcome === 'no_show') return status === 'Pending' || status === 'Confirmed' ? [['No Show', reason]] : null;
  return WALK[status]?.map((s) => [s]) || null;
}

/**
 * Runs the steps in order. If a LATER step fails the booking is left mid-way, so the error names where it stopped:
 * "Moved to In-Progress, but couldn't complete: <reason>" (code PARTIAL, `reachedStatus`). A failure on the first step changes
 * nothing and returns that step's own error.
 * @param {Array<[string, string?]>} steps
 * @param {(newStatus: string, reason?: string) => Promise<{error?: {message?: string}}>} update
 * @param {(err: object) => string} describe  turns a step error into a friendly sentence
 */
export async function runCloseSteps(steps, update, describe = (e) => e?.message || 'Something went wrong.') {
  let reached = null;
  for (const [newStatus, why] of steps) {
    const res = await update(newStatus, why);
    if (res?.error) {
      if (!reached) return { data: null, error: res.error };
      return { data: null, error: { code: 'PARTIAL', reachedStatus: reached, message: `Moved to ${reached}, but couldn’t complete: ${describe(res.error)}` } };
    }
    reached = newStatus;
  }
  return { data: { status: reached }, error: null };
}
