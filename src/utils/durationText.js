// One way to write a length of time, so the same minutes read the same on every screen (the report, the inner page, the insights).
// Under an hour "45 min"; under a day "7 h 45 min" (no " 0 min": "3 h"); a day or more is whole hours "251 h". Whole minutes first.
export const durationText = (minutes) => {
  const min = Math.round(Number(minutes));
  if (!(min > 0)) return '0 min';
  if (min < 60) return `${min} min`;
  if (min >= 24 * 60) return `${Math.round(min / 60).toLocaleString('en-IN')} h`;
  const h = Math.floor(min / 60); const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};
