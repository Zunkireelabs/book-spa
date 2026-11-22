// Pure planner: Fresha tables -> what to insert. No I/O, no DB. Money in integer paisa.
import { parseDuration, toPaisa, parseDateTime, parseStamp, normRef, normName, mapStatus, uuid5 } from './parse.js';

const staffKey = (s) => normName(String(s).replace(/\./g, ''));
const WALKIN = 'walk-in';

// Allocate `total` paisa across weights pro-rata; the LAST item takes the rounding rest. Sums exactly.
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = []; let used = 0;
  weights.forEach((w, i) => {
    const v = i === weights.length - 1 ? total - used : Math.round((total * w) / sum);
    out.push(v); used += v;
  });
  return out;
}

// Discount: invoice gross below the day's appointment sum by a clean 10/20/25 % (or any whole %) -> discount.
export function deriveDiscount(sumPaisa, grossPaisa) {
  if (grossPaisa >= sumPaisa || sumPaisa <= 0) return null;
  const diff = sumPaisa - grossPaisa;
  const pct = (diff / sumPaisa) * 100;
  return { discountPaisa: diff, pct: Math.round(pct * 100) / 100, clean: Math.abs(pct - Math.round(pct)) < 0.05 };
}

export function buildPlan({ clients, team, menu, appts, sales, payments, today, ns = '' }) {
  const report = { channels: {}, createdUnparsed: 0, ambiguous: [], noPhone: [], unknownStaff: [], money: [], overlaps: [], durationDiffers: 0, durationRows: [], pastBooked: [] };

  // ---- staff by "First L." key
  const teamByKey = new Map();
  for (const t of team) {
    if (t.Status && t.Status.toLowerCase() !== 'active') continue;
    const full = `${t['First Name']} ${t['Last Name']}`.trim();
    const parts = full.split(/\s+/);
    teamByKey.set(staffKey(`${parts[0]} ${parts.slice(1).join(' ')[0] || ''}`), full);
    teamByKey.set(staffKey(full), full);
  }
  const menuByName = new Map(menu.map((m) => [normName(m['Service Name']), m]));

  // ---- clients by name
  const byName = new Map();
  for (const c of clients) {
    const k = normName(c['Full Name'] || `${c['First Name']} ${c['Last Name']}`);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }
  // payments -> client id by (name, day) and by appointment ref
  const payClientByRef = new Map();
  const payClientByNameDay = new Map();
  for (const p of payments) {
    const day = parseStamp(p['Invoice date']).date;
    payClientByRef.set(normRef(p['Appointment ref']), p['Client ID']);
    const k = `${normName(p['Client name'])}|${day}`;
    if (!payClientByNameDay.has(k)) payClientByNameDay.set(k, new Set());
    payClientByNameDay.get(k).add(p['Client ID']);
  }

  // ---- appointment rows -> lines
  const lines = [];
  for (const a of appts) {
    const when = parseDateTime(a['Scheduled Date'], a.Time);
    const dur = parseDuration(a.Duration);
    const svc = menuByName.get(normName(a.Service));
    if (!svc) throw new Error(`Appointment service not on menu: "${a.Service}" (ref ${a['Ref #']})`);
    if (parseDuration(svc.Duration) !== dur) { report.durationDiffers++; report.durationRows.push({ ref: a['Ref #'], date: when.date, client: a.Client, service: a.Service, menu: parseDuration(svc.Duration), fresha: dur }); }
    const staff = teamByKey.get(staffKey(a.Staff));
    if (!staff) { report.unknownStaff.push(a.Staff); continue; }
    const name = a.Client;
    let walkIn = normName(name) === WALKIN;
    let customerFreshaId = null, ambiguous = false;
    if (!walkIn) {
      const cands = byName.get(normName(name)) || [];
      if (cands.length === 1) customerFreshaId = cands[0]['Client ID'];
      else if (cands.length > 1) {
        const viaRef = payClientByRef.get(normRef(a['Ref #']));
        const ids = viaRef ? new Set([viaRef]) : payClientByNameDay.get(`${normName(name)}|${when.date}`);
        const known = ids && [...ids].filter((id) => cands.some((c) => c['Client ID'] === id));
        if (known && known.length === 1) customerFreshaId = known[0];
        else { ambiguous = true; report.ambiguous.push({ name, date: when.date, ref: a['Ref #'] }); }
      } else { ambiguous = true; report.ambiguous.push({ name, date: when.date, ref: a['Ref #'], reason: 'not in clients file' }); }
    }
    const status = mapStatus(a.Status);
    const ch = a.Channel || '(blank)'; report.channels[ch] = (report.channels[ch] || 0) + 1;
    let createdOn = null;
    try { createdOn = parseStamp(a['Created on']); } catch { report.createdUnparsed++; }
    if (a.Status.trim().toLowerCase() === 'booked' && when.date <= today) report.pastBooked.push({ ref: a['Ref #'], date: when.date, name });
    lines.push({
      ref: a['Ref #'], refKey: normRef(a['Ref #']), key: `fresha-appt:${normRef(a['Ref #'])}`,
      requestId: uuid5(`${ns}|appt:${normRef(a['Ref #'])}`),
      name, walkIn, customerFreshaId, ambiguous, staff, service: svc['Service Name'], duration: dur,
      date: when.date, time: when.time, price: toPaisa(a.Price), status, future: when.date > today, createdOn,
      groupKey: `${walkIn || !customerFreshaId ? 'n:' + normName(name) : 'c:' + customerFreshaId}|${when.date}|${when.time}`,
    });
  }

  // ---- invoices: (name, day) -> completed lines
  const invoices = [];
  const salesByNameDay = new Map();
  for (const s of sales) {
    const day = parseStamp(s['Invoice Date']).date;
    const k = `${normName(s.Client)}|${day}`;
    if (!salesByNameDay.has(k)) salesByNameDay.set(k, []);
    salesByNameDay.get(k).push({ no: s['Invoice #'], status: s.Status, gross: toPaisa(s['Gross total']), tips: toPaisa(s.Tips), day });
  }
  const completedByNameDay = new Map();
  for (const l of lines) if (l.status === 'Completed') {
    const k = `${normName(l.name)}|${l.date}`;
    if (!completedByNameDay.has(k)) completedByNameDay.set(k, []);
    completedByNameDay.get(k).push(l);
  }
  const payByInvoice = new Map();
  for (const p of payments) {
    const no = p['Invoice number'];
    if (!payByInvoice.has(no)) payByInvoice.set(no, []);
    payByInvoice.get(no).push({ no: p['Payment number'], invoice: no, mode: p['Payment method'], amount: toPaisa(p.Amount), stamp: parseStamp(p['Payment date']), type: p['Transaction type'] });
  }

  for (const [k, invs] of salesByNameDay) {
    const ls = completedByNameDay.get(k) || [];
    const sum = ls.reduce((a, l) => a + l.price, 0);
    const [name, day] = k.split('|');
    if (invs.length > 1) report.money.push({ kind: 'two-invoices-one-day', name, day, invoices: invs.map((i) => `${i.no}:${i.gross / 100}`), apptSum: sum / 100 });
    // the invoice that belongs to the appointments = the one whose gross is closest to the sum (others reported)
    const main = invs.length === 1 ? invs[0] : [...invs].sort((a, b) => Math.abs(a.gross - sum) - Math.abs(b.gross - sum))[0];
    for (const inv of invs) {
      const pays = payByInvoice.get(inv.no) || [];
      const paid = pays.reduce((a, p) => a + p.amount, 0);
      const isMain = inv === main && ls.length > 0;
      const rec = { ...inv, name, day, lines: isMain ? ls : [], sum: isMain ? sum : 0, payments: pays, paid, attached: isMain };
      if (isMain) {
        const d = deriveDiscount(sum, inv.gross);
        rec.discount = d;
        if (inv.gross > sum) report.money.push({ kind: 'gross-above-appointments', inv: inv.no, status: inv.status, gross: inv.gross / 100, apptSum: sum / 100, diff: (inv.gross - sum) / 100 });
      } else if (inv.status !== 'Voided' || ls.length === 0) {
        report.money.push({ kind: ls.length ? 'extra-invoice-not-attached' : 'no-completed-appointment', inv: inv.no, status: inv.status, gross: inv.gross / 100, paid: paid / 100, day });
      }
      if (inv.status !== 'Paid') report.money.push({ kind: 'not-fully-paid', inv: inv.no, status: inv.status, gross: inv.gross / 100, paid: paid / 100 });
      invoices.push(rec);
    }
  }

  // ---- booking rows: group + discount allocation
  const discountByRef = new Map();
  for (const inv of invoices) if (inv.attached && inv.discount) {
    const alloc = allocate(inv.discount.discountPaisa, inv.lines.map((l) => l.price));
    inv.lines.forEach((l, i) => discountByRef.set(l.refKey, alloc[i]));
    if (!inv.discount.clean) report.money.push({ kind: 'odd-discount-percent', inv: inv.no, pct: inv.discount.pct });
  }
  const groups = new Map();
  for (const l of lines) {
    l.discount = discountByRef.get(l.refKey) || 0;
    if (!groups.has(l.groupKey)) groups.set(l.groupKey, []);
    groups.get(l.groupKey).push(l);
  }
  const groupList = [...groups.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ key: k, groupId: uuid5(`${ns}|group:${k}`), refs: v.map((l) => l.refKey) }));
  const groupIdByRef = new Map(); for (const g of groupList) for (const r of g.refs) groupIdByRef.set(r, g.groupId);
  for (const l of lines) l.groupId = groupIdByRef.get(l.refKey) || null;

  // ---- overlaps (non-cancelled, same staff, true durations)
  const act = lines.filter((l) => l.status !== 'Cancelled' && l.status !== 'No Show');
  const byStaffDay = new Map();
  for (const l of act) { const k = `${l.staff}|${l.date}`; if (!byStaffDay.has(k)) byStaffDay.set(k, []); byStaffDay.get(k).push(l); }
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (const v of byStaffDay.values()) {
    v.sort((a, b) => mins(a.time) - mins(b.time));
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      if (mins(v[j].time) < mins(v[i].time) + v[i].duration) report.overlaps.push({ a: v[i].refKey, b: v[j].refKey, staff: v[i].staff, date: v[i].date, future: v[i].future });
    }
  }
  return { lines, invoices, groups: groupList, report };
}
