// Phase C: bookings (history + future), payments, tips. One transaction (caller owns it).
// Triggers are disabled with ALTER TABLE ... DISABLE TRIGGER inside the transaction (rolls back on error; the table lock
// blocks other writers until commit), every one re-enabled before COMMIT, and tgenabled='O' is asserted.
import { uuid5, normName } from './parse.js';

// why each is disabled: see the report. HISTORY = past rows; ALWAYS = every row.
export const ALWAYS = [
  ['bookings', 'trg_booking_snapshots', 'overwrites the duration/price snapshots with the MENU values; we store the Fresha appointment values'],
  ['bookings', 'trg_compute_datetimes', 'recomputes end from the menu duration; we need the real Fresha minutes'],
  ['bookings', 'trg_bookings_tier_reprice', 'would reprice; each booking keeps its exact Fresha price'],
  ['bookings', 'trg_notify_big_discount_fyi', 'no notifications for imported discounts'],
  ['bookings', 'trg_notify_new_online_booking', 'no notifications for imported bookings'],
];
export const HISTORY = [
  ['bookings', 'trg_therapist_guards_check', 'past rows: working-hours/leave guards do not apply to history'],
  ['booking_therapists', 'trg_booking_therapists_guards_check', 'same, junction side'],
];

// Triggers known on bookings/payments/booking_tips/booking_therapists (local schema with mig 424/425, plus payments.trg_audit_payments which only prod has:
// it writes an audit row per payment, harmless). Anything else is flagged. A disable-list trigger that is ABSENT on the target is skipped and reported.
export const KNOWN_TRIGGERS = new Set(`booking_therapists.trg_booking_therapist_room_capacity_check booking_therapists.trg_booking_therapists_guards_check booking_therapists.trg_booking_therapists_overlap bookings.bookings_normalize_phone bookings.trg_00_bookings_stamp_allows_overlap bookings.trg_advance_booking_window_check bookings.trg_audit_booking_changes bookings.trg_audit_bookings bookings.trg_booking_number bookings.trg_booking_snapshots bookings.trg_bookings_clear_acknowledgement bookings.trg_bookings_no_future_status bookings.trg_bookings_no_inactive_branch bookings.trg_bookings_require_phone bookings.trg_bookings_tier_reprice bookings.trg_compute_datetimes bookings.trg_compute_final_amount bookings.trg_enforce_booking_immutability bookings.trg_enforce_therapist_required bookings.trg_handle_booking_cancellation_refund bookings.trg_notify_big_discount_fyi bookings.trg_notify_new_online_booking bookings.trg_online_capacity_check bookings.trg_online_closed_date_check bookings.trg_room_capacity_check bookings.trg_sync_booking_therapists bookings.trg_therapist_guards_check bookings.trg_updated_at bookings.trg_zz_bookings_therapist_junction_overlap payments.trg_payment_update_booking_status payments.trg_audit_payments`.split(' '));
const addMin = (time, m) => { const t = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00`; };

async function toggle(c, list, on) {
  for (const [tbl, trg] of list) await c.query(`alter table public.${tbl} ${on ? 'enable' : 'disable'} trigger ${trg}`);
}

export async function historyImport(c, t, plan) {
  const r = { inserted: 0, existing: 0, changed: [], failedFuture: [], payments: { inserted: 0, existing: 0, paisa: 0 }, tips: { inserted: 0, paisa: 0 }, notImported: [], disabled: [], absentTriggers: [], lockMs: null, orphanPayments: [] };
  if (t.flags.phone) throw new Error('organizations.require_customer_phone must be false before phase C');
  if (!t.flags.overlap) throw new Error('organizations.allow_staff_overlap must be true before phase C');

  const staffId = new Map((await c.query('select id, name from therapists where org_id=$1', [t.orgId])).rows.map((x) => [normName(x.name), x.id]));
  const svc = new Map((await c.query('select id, name, category from services where org_id=$1', [t.orgId])).rows.map((x) => [normName(x.name), x]));
  const cust = new Map((await c.query('select id, full_name, phone from customers where org_id=$1', [t.orgId])).rows.map((x) => [x.id, x]));
  // polite refusal: appointments for clients that are not in Zennly yet (a client added in Fresha after phase B)
  const missing = new Map();
  for (const l of plan.lines) if (l.customerFreshaId && !cust.has(uuid5(`${t.orgId}|client:${l.customerFreshaId}`))) missing.set(l.customerFreshaId, l.name);
  if (missing.size) {
    r.missingClients = [...missing].map(([id, name]) => ({ id, name }));
    throw new Error(`${missing.size} client(s) in the appointments are not in Zennly yet (Fresha ids: ${[...missing.keys()].slice(0, 10).join(', ')}${missing.size > 10 ? ', ...' : ''}). Run --phase customers-delta (or --phase delta) first. Nothing written.`);
  }
  const exist = new Map((await c.query('select id, client_request_id, status::text as status, base_amount, discount_amount, date::text as date, start_time::text as start_time from bookings where client_request_id = any($1)', [plan.lines.map((l) => l.requestId)])).rows.map((x) => [x.client_request_id, x]));
  const therapistName = new Map((await c.query('select id, name from therapists where org_id=$1', [t.orgId])).rows.map((x) => [x.id, x.name]));

  // ---- prod-drift guard: print every non-internal trigger on the touched tables; refuse unknown ones unless acknowledged by name
  const inv = (await c.query(`select c.relname||'.'||t.tgname as k from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname = any($1) order by 1`, [['bookings', 'payments', 'booking_tips', 'booking_therapists']])).rows.map((x) => x.k);
  r.triggerInventory = inv; r.unknownTriggers = inv.filter((k) => !KNOWN_TRIGGERS.has(k));
  const ack = new Set(t.ackTriggers || []);
  const unacked = r.unknownTriggers.filter((k) => !ack.has(k));
  if (unacked.length) throw new Error(`Unknown trigger(s) in the target DB (not in the local list): ${unacked.join(', ')}. Review them (they may block or alter imported rows), then re-run with --ack-triggers ${unacked.join(',')}`);
  const modeMap = t.modeMap || {};
  const modeOf = (m) => modeMap[m] ?? m;

  // a listed trigger that does not exist on this database (e.g. trg_booking_snapshots is absent on prod) is skipped and reported
  const present = new Set(inv);
  const has = (l) => l.filter(([tbl, trg]) => present.has(`${tbl}.${trg}`));
  r.absentTriggers = [...ALWAYS, ...HISTORY].filter(([tbl, trg]) => !present.has(`${tbl}.${trg}`)).map(([tbl, trg]) => `${tbl}.${trg}`);
  const ALWAYS_P = has(ALWAYS), HISTORY_P = has(HISTORY);
  r.disabled = [...ALWAYS_P, ...HISTORY_P];

  const t0 = Date.now();
  await toggle(c, ALWAYS_P, false);
  const idByRef = new Map();

  const insert = async (l) => {
    const sv = svc.get(normName(l.service)); const th = staffId.get(normName(l.staff));
    if (!sv) throw new Error(`Service not in org: ${l.service}`);
    if (!th) throw new Error(`Staff not in org: ${l.staff}`);
    const cid = l.customerFreshaId ? uuid5(`${t.orgId}|client:${l.customerFreshaId}`) : null;
    const cu = cid ? cust.get(cid) : null;
    if (cid && !cu) throw new Error(`Customer ${l.customerFreshaId} not in org (run phase B first)`);
    const end = addMin(l.time, l.duration);
    const final = l.price - l.discount;
    const q = await c.query(
      `insert into bookings (branch_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, payment_status,
         base_amount, discount_amount, final_amount, discount_status, discount_approved_by, discount_reason, service_name_snapshot, service_duration_snapshot, service_price_snapshot,
         therapist_name_snapshot, service_category_snapshot, customer_id, client_request_id, booking_group_id, created_by, is_walk_in, walk_in_label, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,($6::date+$7::time) at time zone 'Asia/Kathmandu',($6::date+$8::time) at time zone 'Asia/Kathmandu',$9::booking_status,'unpaid',
         $10,$11,$12,$13::discount_status_enum,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26, coalesce(($27::date+$28::time) at time zone 'Asia/Kathmandu', now())) returning id`,
      [t.branchId, sv.id, th, l.walkIn ? 'Walk-In' : cu ? cu.full_name : l.name, cu?.phone ?? null, l.date, l.time, end, l.status,
        l.price / 100, l.discount / 100, final / 100, l.discount > 0 ? 'approved' : 'none', l.discount > 0 ? t.adminId : null, l.discount > 0 ? 'Discount from Fresha import' : null,
        sv.name, l.duration, l.price / 100, therapistName.get(th), sv.category, cid, l.requestId, l.groupId, t.adminId, l.walkIn, l.walkIn ? 'Walk-In' : null, l.createdOn?.date ?? null, l.createdOn?.time ?? null]);
    return q.rows[0].id;
  };

  const todo = [];
  for (const l of plan.lines) {
    const e = exist.get(l.requestId);
    if (e) {
      r.existing++; idByRef.set(l.refKey, e.id);
      const kinds = [];
      if (e.status !== l.status) kinds.push('status');
      if (Math.round(Number(e.base_amount) * 100) !== l.price) kinds.push('price');
      if (String(e.date).slice(0, 10) !== l.date) kinds.push('date');
      if (String(e.start_time).slice(0, 8) !== l.time) kinds.push('time');
      if (kinds.length) r.changed.push({ ref: l.ref, bookingId: e.id, client: l.name, date: l.date, kinds, was: { status: e.status, price: Number(e.base_amount), date: String(e.date).slice(0, 10), time: String(e.start_time).slice(0, 5) }, now: { status: l.status, price: l.price / 100, date: l.date, time: l.time.slice(0, 5) } });
    } else todo.push(l);
  }
  // future rows FIRST with the availability guards ON, one savepoint per row: a failing row is listed, not dropped silently
  for (const l of todo.filter((x) => x.future)) {
    await c.query('savepoint s');
    try { idByRef.set(l.refKey, await insert(l)); r.inserted++; await c.query('release savepoint s'); } catch (e) {
      await c.query('rollback to savepoint s'); r.failedFuture.push({ ref: l.ref, date: l.date, staff: l.staff, why: e.message.split('\n')[0].slice(0, 120) });
    }
  }
  await toggle(c, HISTORY_P, false);
  for (const l of todo.filter((x) => !x.future)) { idByRef.set(l.refKey, await insert(l)); r.inserted++; }

  // ---- payments + tips, invoice by invoice (fill lines in order; exact to the paisa)
  for (const inv of plan.invoices) {
    const pays = inv.payments.filter((p) => p.type === 'Sale');
    if (!inv.attached) { r.notImported.push({ inv: inv.no, status: inv.status, gross: inv.gross / 100, paid: inv.paid / 100 }); continue; }
    if (inv.status === 'Voided') continue;
    const ids = inv.lines.map((l) => idByRef.get(l.refKey));
    const caps = inv.lines.map((l) => l.price - l.discount);
    let tipsLeft = inv.tips; const total = pays.reduce((a, p) => a + p.amount, 0);
    if (inv.tips > 0 && total < inv.gross + inv.tips) tipsLeft = Math.max(0, total - Math.min(total, inv.gross)); // a tip is only what was paid above gross
    let li = 0, used = 0;
    for (const p of [...pays]) {
      let amt = p.amount;
      const isLast = p === pays[pays.length - 1];
      if (isLast && tipsLeft > 0) amt -= tipsLeft;
      while (amt > 0 && li < ids.length) {
        const take = Math.min(amt, caps[li] - used);
        if (take > 0) {
          const note = `Fresha pay ${p.no} inv ${inv.no} appt ${inv.lines[li].refKey}`;
          const ex = await c.query('select 1 from payments where booking_id=$1 and notes=$2', [ids[li], note]);
          if (ex.rowCount) r.payments.existing++;
          else {
            await c.query(`insert into payments (booking_id, amount, payment_mode, recorded_by, notes, created_at) values ($1,$2,$3,$4,$5, ($6::date+$7::time) at time zone 'Asia/Kathmandu')`,
              [ids[li], take / 100, modeOf(p.mode), t.adminId, note, p.stamp.date, p.stamp.time]);
            r.payments.inserted++; r.payments.paisa += take;
          }
          used += take; amt -= take;
        }
        if (used >= caps[li]) { li++; used = 0; }
        if (take <= 0 && li < ids.length && caps[li] - used > 0) break;
      }
      if (amt > 0) r.orphanPayments.push({ inv: inv.no, payment: p.no, paisa: amt, why: 'payment above the appointment total' });
    }
    if (tipsLeft > 0) {
      const note = `Fresha tip inv ${inv.no}`;
      const ex = await c.query('select 1 from booking_tips where booking_id=$1 and notes=$2', [ids[0], note]);
      if (!ex.rowCount) {
        await c.query(`insert into booking_tips (booking_id, amount, recorded_by, notes, created_at) values ($1,$2,$3,$4, ($5::date+$6::time) at time zone 'Asia/Kathmandu')`,
          [ids[0], tipsLeft / 100, t.adminId, note, pays[0].stamp.date, pays[0].stamp.time]);
        r.tips.inserted++; r.tips.paisa += tipsLeft;
      }
    }
  }

  await toggle(c, [...ALWAYS_P, ...HISTORY_P], true);
  r.lockMs = Date.now() - t0;
  const bad = (await c.query(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname = any($1) and t.tgenabled <> 'O' and c.relname = any($2)`, [[...ALWAYS_P, ...HISTORY_P].map((x) => x[1]), ['bookings', 'payments', 'booking_tips', 'booking_therapists']])).rows;
  if (bad.length) throw new Error(`Trigger(s) not re-enabled: ${JSON.stringify(bad)}`);

  // post-insert asserts: exact price/discount and true duration for EVERY imported row
  const refs = plan.lines.map((l) => l.requestId);
  const chk = (await c.query(
    `select b.client_request_id, b.base_amount, b.discount_amount, b.final_amount, b.service_duration_snapshot, extract(epoch from (b.end_datetime-b.start_datetime))/60 as mins from bookings b where b.client_request_id = any($1)`, [refs])).rows;
  const byReq = new Map(plan.lines.map((l) => [l.requestId, l]));
  const changedRefs = new Set(r.changed.map((x) => x.ref));
  const wrong = chk.filter((b) => { const l = byReq.get(b.client_request_id); if (changedRefs.has(l.ref)) return false; return Math.round(Number(b.base_amount) * 100) !== l.price || Math.round(Number(b.discount_amount) * 100) !== l.discount || Number(b.mins) !== l.duration || Number(b.service_duration_snapshot) !== l.duration; });
  if (wrong.length) throw new Error(`${wrong.length} booking(s) differ from Fresha after insert (price/discount/duration), e.g. ${JSON.stringify(wrong[0])}`);
  r.verified = chk.length;

  // ---- reconciliation against the DB itself (all must balance or the run aborts)
  const failed = new Set(r.failedFuture.map((f) => f.ref));
  // a changed existing booking is REPORTED, not applied: it counts with its stored (old) values
  const chBy = new Map(r.changed.map((x) => [x.ref, x.was]));
  const exp = plan.lines.filter((l) => !failed.has(l.ref)).map((l) => { const w = chBy.get(l.ref); return w ? { ...l, status: w.status, date: w.date, price: Math.round(w.price * 100) } : l; });
  const q1 = async (sql, p) => (await c.query(sql, p)).rows;
  const db = {
    staff: Object.fromEntries((await q1(`select therapist_name_snapshot n, count(*)::int k from bookings where client_request_id = any($1) group by 1`, [refs])).map((x) => [x.n, x.k])),
    day: Object.fromEntries((await q1(`select date::text d, count(*)::int k from bookings where client_request_id = any($1) group by 1`, [refs])).map((x) => [x.d, x.k])),
    status: Object.fromEntries((await q1(`select status::text s, count(*)::int k from bookings where client_request_id = any($1) group by 1`, [refs])).map((x) => [x.s, x.k])),
    pay: Number((await q1(`select coalesce(sum(p.amount),0)::numeric s from payments p join bookings b on b.id=p.booking_id where b.client_request_id = any($1) and p.notes like 'Fresha pay %'`, [refs]))[0].s),
    tips: Number((await q1(`select coalesce(sum(t.amount),0)::numeric s from booking_tips t join bookings b on b.id=t.booking_id where b.client_request_id = any($1) and t.notes like 'Fresha tip %'`, [refs]))[0].s),
    base: Number((await q1(`select coalesce(sum(base_amount),0)::numeric s from bookings where client_request_id = any($1)`, [refs]))[0].s),
    disc: Number((await q1(`select coalesce(sum(discount_amount),0)::numeric s from bookings where client_request_id = any($1)`, [refs]))[0].s),
  };
  const tally = (k) => exp.reduce((m, l) => { m[k(l)] = (m[k(l)] || 0) + 1; return m; }, {});
  const same = (A, B) => JSON.stringify(Object.entries(A).sort()) === JSON.stringify(Object.entries(B).sort());
  const csvPay = plan.invoices.reduce((a, i) => a + i.paid, 0);
  const rec = {
    staffOk: same(tally((l) => l.staff), db.staff), dayOk: same(tally((l) => l.date), db.day),
    statusOk: same(tally((l) => l.status), db.status),
    baseOk: Math.round(db.base * 100) === exp.reduce((a, l) => a + l.price, 0), discOk: Math.round(db.disc * 100) === exp.reduce((a, l) => a + l.discount, 0),
    csvPayments: csvPay / 100, dbPayments: db.pay, dbTips: db.tips,
    notImportedPaid: r.notImported.reduce((a, n) => a + n.paid, 0), orphanAboveAppointments: r.orphanPayments.reduce((a, o) => a + o.paisa, 0) / 100,
  };
  rec.moneyIdentity = Math.round((db.pay + db.tips + rec.notImportedPaid + rec.orphanAboveAppointments) * 100) === csvPay;
  r.reconciliation = rec;
  if (!(rec.staffOk && rec.dayOk && rec.statusOk && rec.baseOk && rec.discOk && (rec.moneyIdentity || r.failedFuture.length))) throw new Error(`Reconciliation failed: ${JSON.stringify(rec)}`);
  return r;
}
