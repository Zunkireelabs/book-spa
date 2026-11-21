// ZNLY-276: the ONE way to say "how far along is the day". A no-show is finished, not open.
//   total    = every booking except Cancelled
//   finished = Completed + No Show
//   open     = total - finished (Pending / Confirmed / In-Progress): the same list Close Day shows as unfinished
// Takes the counts the dashboard SQL already returns ({ bookings, completed, no_show }) or, via dayProgressOf, a booking list.
export function dayProgress({ bookings = 0, completed = 0, no_show = 0 } = {}) {
  const total = Math.max(0, Number(bookings) || 0);
  const noShow = Math.max(0, Number(no_show) || 0);
  const finished = Math.max(0, Number(completed) || 0) + noShow;
  return { total, finished, noShow, open: Math.max(0, total - finished) };
}

export function dayProgressOf(list) {
  const rows = (list || []).filter((b) => b.status !== 'Cancelled');
  return dayProgress({
    bookings: rows.length,
    completed: rows.filter((b) => b.status === 'Completed').length,
    no_show: rows.filter((b) => b.status === 'No Show').length,
  });
}

/** "51 of 54 finished · 1 no-show" (the no-show part only when there is one). */
export const dayProgressText = (p) => `${p.finished} of ${p.total} finished${p.noShow > 0 ? ` · ${p.noShow} no-show` : ''}`;
