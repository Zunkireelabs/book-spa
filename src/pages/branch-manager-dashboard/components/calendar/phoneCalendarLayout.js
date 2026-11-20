// Pure layout rules for the phone calendar day view (ZNLY-299). Desktop never calls these.
export const PHONE_TIME_COL = 44;      // gutter width (equals the desktop gutter)
export const PHONE_MIN_COL = 100;      // narrowest readable staff column
export const PHONE_HOUR_BASE = 96;     // px per hour at zoom 100% on a phone (desktop stays 72)
export const PHONE_MIN_ZOOM = 1;       // zoom only goes up on a phone
export const PHONE_MAX_LANES = 2;      // side-by-side bookings; the rest collapse into a "+N" tile
export const ONE_LINE_BELOW = 44;      // card shorter than this: one line, "start · customer"
export const ONE_LINE_ICON_MIN = 130;  // one-line chip shows its single icon only when at least this wide (the name wins below)
export const SERVICE_FROM = 62;        // card at least this tall also shows the service

// How many staff columns fit: (screen - gutter) / 100, never fewer than 2.
export const phoneColumnCount = (viewportW) => Math.max(2, Math.floor((viewportW - PHONE_TIME_COL) / PHONE_MIN_COL));
// Equal width so exactly that many columns fill the screen. Zoom never changes it.
export const phoneColumnWidth = (viewportW) => (viewportW - PHONE_TIME_COL) / phoneColumnCount(viewportW);
// Saved zooms below 100% (from before this rule) read as 100% on a phone.
export const clampPhoneZoom = (z) => Math.max(PHONE_MIN_ZOOM, Number.isFinite(z) ? z : 1);

// 'one' = one-line chip, otherwise the full card. showService only when there is room for the 3rd line.
export const phoneCardPlan = (height) => ({
  mode: height < ONE_LINE_BELOW ? 'one' : 'full',
  showService: height >= SERVICE_FROM,
});

// Start time for a one-line chip: "1:15" (no am/pm), "13:15" in 24h.
export const startNoMeridiem = (formatted) => String(formatted || '').replace(/\s?[ap]m$/i, '');

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

// Lanes for ONE overlap cluster (bookings sorted by start, as clusterOverlapping returns them).
// A booking takes lane 0 if free, else lane 1, else it is hidden. minMinutes = the shortest a card is drawn,
// so two short back-to-back cards that touch on screen are treated as overlapping (same as clusterOverlapping).
// Returns { placed: [{ booking, lane }], hidden: [booking], lanes: 1 | 2 }.
export function assignPhoneLanes(cluster, minMinutes = 0, maxLanes = PHONE_MAX_LANES) {
  const laneEnd = Array(maxLanes).fill(-Infinity);
  const placed = [];
  const hidden = [];
  cluster.forEach((b) => {
    const start = toMin(b.startTime);
    const end = Math.max(toMin(b.endTime), start + minMinutes);
    const lane = laneEnd.findIndex((e) => e <= start);
    if (lane === -1) { hidden.push(b); return; }
    laneEnd[lane] = end;
    placed.push({ booking: b, lane });
  });
  const lanes = placed.some((p) => p.lane > 0) || hidden.length > 0 ? maxLanes : 1;
  return { placed, hidden, lanes };
}

// Customer line: "A & B" when the booking carries a companion (couple), whole words only (truncation is CSS).
export const coupleName = (customer, companion) => (companion && customer ? `${customer} & ${companion}` : customer);

// "Nisha Shrestha" -> "Nisha S."; one word stays as is; spaces trimmed. Used for phone chips, narrow lanes and column headers.
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  const last = parts[parts.length - 1];
  if (!/^\p{L}/u.test(last)) return parts.join(' '); // "Room 2" has no surname to shorten
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

// Stable avatar colour from an id (no per-staff colour exists in the calendar data).
const AVATAR_COLORS = ['#2D5A27', '#3B82F6', '#E11D48', '#0D9488', '#D97706', '#7C3AED', '#0EA5E9', '#BE185D'];
export function avatarColor(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const oneLineShowsIcon = (chipWidth) => chipWidth >= ONE_LINE_ICON_MIN;
