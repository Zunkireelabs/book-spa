// ZNLY-365: one catalog that turns an error CODE into guidance, so the same ✦ card appears everywhere.
//  - kind 'fix'    : the user can fix it. Card = bold lead, how it works, one-tap fix buttons, "Why?" detail.
//  - kind 'system' : a bug / network / server problem. One calm message, no steps, a short reference id.
// Rule-based (no live AI call): instant, free, always the same right answer. An unknown code is a system error.
// Actions are plain descriptors { id, label, intent, value }. A fix action only FILLS or OPENS something; it never saves.
import { isNetworkError, friendlyError, NETWORK_CHECK_CALENDAR_COPY } from './friendlyError';
import { localizeTerms, wordBranch } from './industryTerms';
import { directDiscountPercent } from '../services/discountLimits';
import { fieldForErrorCode } from './quickCreateErrorField';
import { capture } from '../lib/analytics';

export const SYSTEM_LEAD = "This couldn't be saved.";
export const SYSTEM_HOW = "Nothing was changed. Try again; if it keeps happening, we've been told.";
export const SYSTEM_MESSAGE = `${SYSTEM_LEAD} ${SYSTEM_HOW}`;
export const CONNECTION_LOST_LEAD = 'Connection lost.';

// 'HH:MM' or 'HH:MM:SS' -> '1:30 pm'
export const fmt12 = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return t || '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
};
const range = (c) => (c.startTime && c.endTime ? `${fmt12(c.startTime)}–${fmt12(c.endTime)}` : c.startTime ? `at ${fmt12(c.startTime)}` : 'at this time');
const when = (c) => (c.startTime && c.endTime ? range(c) : 'at that time');
// The org's own word for staff (Therapist, Stylist, Doctor...) from useIndustry; "team member" only when none is given.
const staffOne = (c) => (c.staffLabel ? String(c.staffLabel).toLowerCase() : 'team member');
const staffMany = (c) => (c.staffLabelPlural ? String(c.staffLabelPlural).toLowerCase() : (c.staffLabel ? `${String(c.staffLabel).toLowerCase()}s` : 'team members'));
const who = (c) => c.staffName || `This ${staffOne(c)}`;
const ROOM_INTENTS = new Set(['open-room', 'set-room-any']);
// A server message is shown only after friendlyError (prefix stripped, technical text removed); '' when nothing safe is left.
const safeMsg = (e) => (e?.message ? friendlyError(e.message, '') : '');
const act = (id, label, intent, value) => ({ id, label, intent, ...(value !== undefined ? { value } : {}) });

// "Book at 1:30 pm" style actions from the next free times the calendar already knows.
const timeActions = (c, max = 2) => (c.nextFreeTimes || []).slice(0, max).map((t) => act(`time-${t}`, `Book at ${fmt12(t)}`, 'set-time', t));
const pickStaff = act('pick-staff', 'Pick staff', 'open-staff');
const pickRoom = act('pick-room', 'Pick a room', 'open-room');
const altStaff = (c) => (c.freeStaff && c.freeStaff[0] ? [act(`staff-${c.freeStaff[0].id}`, `Give it to ${c.freeStaff[0].name.split(' ')[0]}`, 'set-staff', c.freeStaff[0].id)] : []);
const freeNames = (c) => (c.freeStaff || []).map((s) => s.name.split(' ')[0]).join(', ');

// code -> { kind, field?, build(ctx, err) -> { lead, how, why?, actions? } }
const fix = (build, field) => ({ kind: 'fix', field, build });
// `noRetry`: the same save can never work (the record is gone), so no Try again.
const system = ({ how, noRetry } = {}) => ({ kind: 'system', noRetry: !!noRetry, build: () => ({ lead: SYSTEM_LEAD, how }) });
const availability = (how) => fix((c, e) => ({ lead: safeMsg(e) || `${who(c)} is not available ${when(c)}.`, how, actions: [...timeActions(c), ...altStaff(c), pickStaff] }), 'staff');

export const ERROR_CATALOG = {
  // ---- when ----
  ROOMS_FULL: fix((c) => ({
    lead: `Every room is taken ${range(c)}.`,
    how: `${c.serviceName || 'This service'} needs a free room for its whole length.`,
    why: c.roomsSummary || 'Rooms are counted for the full length of the service. Pick another time, or a room that frees up.',
    actions: [...timeActions(c), pickRoom],
  }), 'time'),
  BRANCH_CLOSED: fix((c) => ({
    lead: `${c.branchName || 'This branch'} is closed on ${c.dateLabel || 'that day'}.${c.nextOpenLabel ? ` Next open: ${c.nextOpenLabel}.` : ''}`,
    how: 'Bookings can only be made on days the branch is open.',
    actions: c.nextOpenDate ? [act('next-open', `Move to ${c.nextOpenLabel || c.nextOpenDate}`, 'set-date', c.nextOpenDate)] : [],
  }), 'time'),
  BRANCH_ONLINE_CAPACITY: fix((c) => ({
    lead: `Nobody is free ${range(c)}.`,
    how: 'Every team member who could do this is already booked then.',
    actions: [...timeActions(c), pickStaff],
  }), 'time'),
  BOOKING_CROSSES_MIDNIGHT: fix(() => ({
    lead: 'This would run past midnight.',
    how: 'A booking has to finish on the same day it starts.',
    actions: [act('earlier', 'Pick an earlier time', 'open-time')],
  }), 'time'),
  DAY_LOCKED: fix((c) => ({
    lead: "This day's close is done, so it can't be changed.",
    how: 'Once a day is closed, its bookings and money are locked.',
    actions: c.creating ? [act('tomorrow', 'Book for tomorrow', 'set-date-tomorrow')] : [],
  }), 'time'),
  INVALID_HOURS: fix((c) => ({
    lead: `${c.branchName || 'The branch'} is closed at that time.`,
    how: 'Pick a time inside opening hours.',
    actions: c.latestStart ? [act('latest', `Book at ${fmt12(c.latestStart)} (latest start)`, 'set-time', c.latestStart)] : [act('pick-time', 'Pick a time', 'open-time')],
  }), 'time'),
  // ---- who ----
  THERAPIST_CONFLICT: fix((c) => ({
    lead: `${who(c)} is already booked ${when(c)}.`,
    how: freeNames(c) ? `Free then: ${freeNames(c)}.` : 'One person can only be in one booking at a time.',
    actions: [...timeActions(c), ...altStaff(c), pickStaff],
  }), 'staff'),
  THERAPIST_ABSENT: fix((c, e) => ({
    lead: /marked as/.test(e?.message || '') ? safeMsg(e) || `${who(c)} is off that day.` : `${who(c)} is off that day.`,
    how: freeNames(c) ? `Free then: ${freeNames(c)}.` : 'Pick someone who is working.',
    actions: [...altStaff(c), pickStaff],
  }), 'staff'),
  THERAPIST_CHECKED_OUT: fix((c) => ({
    lead: `${who(c)} has checked out for the day.`,
    how: 'A team member who has checked out cannot take new bookings that day.',
    actions: [...altStaff(c), pickStaff],
  }), 'staff'),
  THERAPIST_INACTIVE: fix((c) => ({
    lead: `${who(c)} is no longer active.`,
    how: 'Inactive team members cannot take bookings.',
    actions: [...altStaff(c), pickStaff],
  }), 'staff'),
  INVALID_THERAPIST: fix((c, e) => ({
    lead: safeMsg(e) || `${who(c)} is not at this branch at that time.`,
    how: 'Pick someone who is working here then.',
    actions: [...altStaff(c), pickStaff],
  }), 'staff'),
  THERAPIST_NOT_ELIGIBLE: fix((c) => ({
    lead: `${who(c)} doesn't do ${c.serviceName || 'this service'}.`,
    how: c.eligibleCount ? `${c.eligibleCount} team members do.` : 'Pick someone who does this service.',
    actions: [pickStaff],
  }), 'staff'),
  THERAPIST_REQUIRED: fix(() => ({ lead: 'Pick who does this service.', how: 'This booking needs a team member.', actions: [pickStaff] }), 'staff'),
  // ---- where ----
  ROOM_FULL: fix((c) => ({
    lead: `${c.roomName || 'That room'} is full ${range(c)}.`,
    how: c.otherFreeRooms ? `${c.otherFreeRooms} other rooms are free then.` : 'Pick another room or time.',
    actions: [act('any-room', 'Use any free room', 'set-room-any'), pickRoom],
  }), 'room'),
  ROOM_CONFLICT: fix((c) => ({
    lead: `${c.roomName || 'That room'} is full ${range(c)}.`,
    how: 'Change the room or pick a different time.',
    actions: [act('any-room', 'Use any free room', 'set-room-any'), pickRoom, ...timeActions(c, 1)],
  }), 'room'),
  ROOM_AT_CAPACITY: fix((c) => ({
    lead: `${c.roomName || 'That room'} is fully booked at this time.`,
    how: 'Choose another time or room.',
    actions: [pickRoom],
  }), 'room'),
  ROOM_INACTIVE: fix((c) => ({ lead: `${c.roomName || 'That room'} is not in use.`, how: 'Pick another room.', actions: [pickRoom] }), 'room'),
  INVALID_ROOM: fix(() => ({ lead: "That room isn't at this branch.", how: 'Pick a room from the list.', actions: [pickRoom] }), 'room'),
  // ---- customer ----
  PHONE_REQUIRED: fix(() => ({ lead: 'A phone number is needed.', how: 'Add the phone, or mark this as a walk-in if the client gives no details.', actions: [act('walk-in', 'Mark as walk-in', 'set-walk-in')] }), 'customer'),
  NO_CONTACT_INFO: fix((c) => ({
    lead: `${c.customerName || 'This client'} has no phone or email on file.`,
    how: 'Add one to the client profile to book again.',
    actions: [act('open-client', 'Open client profile', 'open-customer')],
  }), 'customer'),
  CUSTOMER_NOT_FOUND: fix(() => ({ lead: "We couldn't find this client.", how: 'Pick the client again from the list.', actions: [act('pick-client', 'Pick a client', 'open-customer-pick')] }), 'customer'),
  CUSTOMER_REQUIRED: fix(() => ({ lead: 'Pick a client first.', how: 'Every booking is for a client or a walk-in.', actions: [act('pick-client', 'Pick a client', 'open-customer-pick')] }), 'customer'),
  // ---- booking state ----
  BOOKING_IMMUTABLE: fix((c) => ({
    // Status unknown (a drag or reschedule passes none): stay neutral rather than guess "completed".
    lead: c.isPaid ? "This booking is paid, so it can't be edited." : c.status ? `This booking is ${c.status.toLowerCase()}, so it can't be edited.` : "This booking can't be changed any more.",
    how: 'An admin can correct it; every change is logged.',
    actions: [act('ask-admin', 'Ask an admin', 'explain-admin')],
  })),
  BOOKING_IN_PROGRESS: fix(() => ({ lead: "This service has already started, so it can't be moved.", how: 'Only bookings that have not started can be rescheduled.', actions: [] })),
  INVALID_STATUS_TRANSITION: fix((c) => ({
    lead: `A ${c.status ? c.status.toLowerCase() : 'booking'} can't go to that step.`,
    how: 'Bookings move Pending → Confirmed → In progress → Completed. Cancel and No show are allowed before it starts.',
    actions: [],
  })),
  FUTURE_BOOKING: fix((c, e) => {
    const m = safeMsg(e);
    // The server's own sentence already says "Move it to today …": don't say it twice.
    return { lead: m || 'This booking is for another day.', how: /move it to today/i.test(m) ? '' : 'Move it to today to start or complete it.', actions: [] };
  }),
  REASON_REQUIRED: fix(() => ({ lead: 'Add a reason first.', how: 'Cancelling or marking a no-show needs a short reason.', actions: [] })),
  SCHEDULING_CONFLICT: fix((c) => ({ lead: `That time clashes with another booking ${when(c)}.`, how: c.hasRooms ? 'Pick another time, person or room.' : 'Pick another time or person.', actions: [...timeActions(c), pickStaff] }), 'time'),
  COUPLE_SERVICE_NOT_ALLOWED_IN_GROUP: fix((c) => ({
    lead: `${c.serviceName || 'This service'} is a couple service, so it can't be part of a group.`,
    how: 'Book it on its own with 2 team members.',
    actions: [],
  })),
  NO_SERVICES: fix(() => ({ lead: 'Pick at least one service.', how: 'A booking needs a service.', actions: [act('pick-service', 'Pick a service', 'open-service')] }), 'service'),
  BOOKING_GROUP_PARTIAL: fix((c) => ({
    lead: `${c.serviceName || 'One service'} could not be booked, and the earlier ones could not be released.`,
    how: 'Check the calendar and cancel any extra bookings before booking again.',
    actions: [act('show-calendar', 'Show on calendar', 'show-calendar')],
  })),
  BOOKING_CONFIRMATION_UNAVAILABLE: fix(() => ({
    lead: 'The booking was placed, but its details could not be loaded.',
    how: 'Check the calendar before booking again.',
    actions: [act('show-calendar', 'Show on calendar', 'show-calendar')],
  })),
  BOOKING_NOT_VISIBLE: fix(() => ({
    lead: 'The booking was saved, but it is not assigned to you.',
    how: 'Ask your manager to check it on the calendar.',
    actions: [],
  })),
  // ---- discount ----
  DISCOUNT_LIMIT_EXCEEDED: fix((c) => ({
    // Every number comes from DISCOUNT_LIMITS (via directDiscountPercent), so the text follows the limit when it changes.
    lead: `Your discount limit is ${c.limitPercent ?? directDiscountPercent('staff')}%.`,
    how: `Managers and admins can give up to ${directDiscountPercent('manager')}%.`,
    why: `Each role has a top discount it can give by itself: staff ${directDiscountPercent('staff')}%, manager ${directDiscountPercent('manager')}%, admin ${directDiscountPercent('admin')}%. "Ask a manager" only shows who can give a bigger discount; it sends nothing and changes nothing.`,
    actions: [act('set-limit', `Set to ${c.limitPercent ?? directDiscountPercent('staff')}%`, 'set-discount-percent', c.limitPercent ?? directDiscountPercent('staff')), act('ask-manager', 'Ask a manager', 'explain-manager')],
  })),
  DISCOUNT_BELOW_PAID: fix((c) => ({
    lead: `This discount would take the bill below what is already paid${c.amountPaidLabel ? ` (${c.amountPaidLabel})` : ''}.`,
    how: c.maxPercent != null ? `The most you can give here is ${c.maxPercent}%.` : 'Lower the discount.',
    actions: c.maxPercent != null ? [act('set-max', `Set to ${c.maxPercent}%`, 'set-discount-percent', c.maxPercent)] : [],
  })),
  INVALID_DISCOUNT_TYPE: fix(() => ({ lead: 'Choose Percent or NPR Fixed.', how: 'The discount needs a type.', actions: [] })),
  INVALID_DISCOUNT_VALUE: fix(() => ({ lead: "That discount can't be negative or more than the bill.", how: 'Enter an amount between 0 and the bill.', actions: [] })),
  DISCOUNT_REASON_REQUIRED: fix(() => ({ lead: 'Add a reason for the discount.', how: 'Every discount needs a short reason.', actions: [] })),
  APPROVER_REQUIRED: fix(() => ({ lead: 'Pick who should approve this.', how: 'A discount above your limit goes to one manager or admin.', actions: [] })),
  // ---- staff availability guard (ZNLY-100) ----
  OFF_SHIFT: availability('Pick a time inside their shift, or someone else.'),
  ON_BREAK: availability('Pick a time after their break, or someone else.'),
  ON_LEAVE: availability('Pick another day, or someone else.'),
  BLOCKED: availability('That time is blocked for them. Pick another time, or someone else.'),
  OTHER_BRANCH: availability('They are at another branch then. Pick another time, or someone else.'),
  OVERLAP: availability('They already have a booking then. Pick another time, or someone else.'),
  OVERRIDE_NOT_ALLOWED: fix(() => ({
    lead: "Only a manager or admin can book outside a team member's availability.",
    how: 'Pick a time they are free, or ask a manager.',
    actions: [pickStaff],
  }), 'staff'),
  // ---- code/system problems: never steps ----
  // 23505 (unique) from the database
  DUPLICATE: fix((c) => ({ lead: 'That already exists.', how: c.what ? `A ${c.what} with the same details is already saved. Open the existing one instead.` : 'Something with the same details is already saved. Open the existing one instead.', actions: [] })),
  BOOKING_NOT_FOUND: system({ how: 'It may have been removed. Close and reopen the calendar.', noRetry: true }),
  SERVICE_NOT_FOUND: system({ how: 'It may have been removed. Close and reopen the calendar.', noRetry: true }),
};

export const catalogCodes = () => Object.keys(ERROR_CATALOG);

// Short reference id for support, e.g. "7F3K-2Q". No look-alike characters.
const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const makeRef = (rand = Math.random) => {
  const pick = (n) => Array.from({ length: n }, () => REF_CHARS[Math.floor(rand() * REF_CHARS.length)]).join('');
  return `${pick(4)}-${pick(2)}`;
};

// plainError() strips the "CODE: " prefix from message and keeps the original in rawMessage, so read rawMessage first.
const textsOf = (err) => (typeof err === 'string' ? [err] : [err?.rawMessage, err?.message]).filter(Boolean);
// Errors that carry no catalog `code` but whose text names one ("ROOM_AT_CAPACITY: ..."), e.g. raised by a database trigger (code P0001).
const codeFromText = (err) => {
  for (const t of textsOf(err)) {
    const m = /(?:^|\s)([A-Z][A-Z0-9_]{2,}):/.exec(t);
    if (m && ERROR_CATALOG[m[1]]) return m[1];
  }
  return undefined;
};
// Postgres codes worth guidance: 23P01 exclusion (a therapist or room double booking) and 23505 unique.
const codeFromPostgres = (err) => {
  const pg = err?.code;
  if (pg === '23P01') return textsOf(err).some((t) => /room/i.test(t)) ? 'ROOM_CONFLICT' : 'THERAPIST_CONFLICT';
  if (pg === '23505') return 'DUPLICATE';
  return undefined;
};

// describeError(err, context) -> card model.
//   { kind: 'fix', code, lead, how, why, field, actions[] }
//   { kind: 'system', code, lead, how: '', field: null, actions[], ref, networkLost, canRetry }
// context fills in names / times / next free data the calendar already knows (all optional).
function buildCard(err, ctx, opts) {
  const network = isNetworkError(err);
  if (network) {
    return {
      kind: 'system', code: 'NETWORK', lead: CONNECTION_LOST_LEAD, how: 'The booking may have saved. Check the calendar before trying again.',
      why: '', field: null, networkLost: true, canRetry: false, ref: (opts.makeRef || makeRef)(),
      actions: [act('show-calendar', 'Show on calendar', 'show-calendar')],
    };
  }
  const code = (err?.code && ERROR_CATALOG[err.code] ? err.code : undefined) || codeFromText(err) || codeFromPostgres(err);
  const entry = code && ERROR_CATALOG[code];
  // A server refusal with its own plain sentence (visit_* functions: "Nothing was changed.", "This day has been closed...") is a fix card, never the generic system card.
  if (!entry && err?.refusal && safeMsg(err)) return { kind: 'fix', code: err.code || 'REFUSED', lead: safeMsg(err), how: '', why: '', field: null, actions: [] };
  if (!entry || entry.kind === 'system') {
    const built = entry ? entry.build(ctx, err) : {};
    const noRetry = !!entry?.noRetry;
    return {
      kind: 'system', code: code || err?.code || 'UNKNOWN', lead: SYSTEM_LEAD, how: built.how || SYSTEM_HOW, why: '', field: null,
      networkLost: false, canRetry: !noRetry, ref: (opts.makeRef || makeRef)(), actions: noRetry ? [] : [act('try-again', 'Try again', 'retry')],
    };
  }
  const built = entry.build(ctx, err) || {};
  // The catalog is written with "team member" / "Pick staff": swap in the org's own staff word. Rooms only for orgs that have them.
  const word = (t) => (t ? t.replace(/team members/g, staffMany(ctx)).replace(/team member/g, staffOne(ctx)) : '');
  const actions = (built.actions || [])
    .filter((a) => ctx.hasRooms || !ROOM_INTENTS.has(a.intent))
    .map((a) => (a.intent === 'open-staff' ? { ...a, label: ctx.staffLabel ? `Pick ${staffOne(ctx)}` : 'Pick staff' } : a));
  return {
    kind: 'fix', code, lead: word(built.lead), how: word(built.how), why: word(built.why),
    field: entry.field || fieldForErrorCode(code), actions,
  };
}

// Part of a group already exists: say so first, never offer a fix or a retry that could book those people twice, only the calendar.
const withPartial = (card, ctx) => {
  const n = ctx.partial?.created;
  if (!n) return card;
  const own = `${card.lead} ${card.how}`.trim();
  return {
    ...card, lead: `${n} of ${ctx.partial.total} bookings were already created.`,
    how: card.kind === 'system' ? 'Check the calendar before booking again.' : own,
    canRetry: false, networkLost: card.networkLost, actions: [act('show-calendar', 'Show on calendar', 'show-calendar')],
  };
};

// The catalog is written in plain words; swap in the org's own terms (branch / room / booking / staff words) once, at the end.
const siteWords = (t) => {
  const w = String(wordBranch() || 'branch').toLowerCase();
  return w === 'branch' ? t : t.replace(/\bbranch\b/g, w).replace(/\bBranch\b/g, w.charAt(0).toUpperCase() + w.slice(1));
};
const localized = (card) => {
  const f = (t) => siteWords(localizeTerms(t || ''));
  return { ...card, lead: f(card.lead), how: f(card.how), why: f(card.why) };
};

export function describeError(err, context = {}, opts = {}) {
  const ctx = context || {};
  return localized(withPartial(buildCard(err, ctx, opts), ctx));
}

// System errors go to the error log with the SAME reference id the user sees. No names, phones or free text: code + area only.
// capture() does nothing without a PostHog key, so staging stays silent.
export function reportSystemError(card, area) {
  if (!card || card.kind !== 'system') return;
  capture('app_error', { ref: card.ref, code: card.code, area: area || 'unknown' });
}

export { NETWORK_CHECK_CALENDAR_COPY };
