// Owner review sheet (names allowed: written only under temp_ss/client-data, never committed).
import { toPaisa } from './parse.js';

const md = (rows, cols) => rows.length ? [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? '')).join(' | ')} |`)].join('\n') : '_none_';
const days = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
const money = (p) => (p / 100).toFixed(2);

const DEFAULT_METHODS = ['Cash', 'Mastercard', 'Visa', 'Khalti', 'eSewa', 'IME Pay', 'MobileBanking', 'Cheque'];
export function ownerSheet({ plan, setup, history, x, appMethods, modeMap = {}, customersDelta, productsDelta }) {
  const R = plan.report, o = [];
  const h = (t) => o.push(`\n## ${t}\n`);
  o.push('# Sami\'s Fresha import: owner review sheet (suggestions only, nothing below is applied)');
  if (setup && history) {
    const unattached = plan.invoices.filter((i) => !i.attached), above = R.money.filter((m) => m.kind === 'gross-above-appointments');
    const rec = history.reconciliation;
    o.push('\n## In plain words (read this first)\n');
    o.push(`- Imported from Fresha: ${setup.customers.created} clients, ${setup.staff.created} staff, ${setup.services.created} services, ${setup.products.created} products with their stock, and ${history.inserted + history.existing} bookings (1-22 Nov history plus the bookings up to 22 Dec), with the payments, discounts and tips.`);
    o.push(`- Every booking keeps its Fresha price, its Fresha length and its Fresha staff member. Discounts are recorded as discounts, so November sales match Fresha apart from the money listed below.`);
    o.push(`- Please decide: ${R.pastBooked.length} past appointments are still "Booked" in Fresha (shown as Confirmed until you rule on each: done, cancelled or no-show). Section 1.`);
    o.push(`- Please decide: ${R.ambiguous.length} appointments are for a client name that exists twice. They are kept under the typed name; open each one in the app and pick the right client. Section 3.`);
    o.push(`- Please check: ${history.failedFuture.length} future booking clashes with the same staff member (section 2), and every staff member got 09:00-20:00 every day as a starting schedule: set the real ones.`);
    o.push(`- Not imported, because Zennly has no booking to put them on: ${unattached.length} invoices with money Sami's took (${money(unattached.reduce((a, i) => a + i.paid, 0))}) and ${money(rec.orphanAboveAppointments * 100)} paid above the appointments of ${above.length} other invoices. These are listed in section 5 with a suggestion each; nothing was guessed. Until you rule, Zennly's November payments will be lower than Fresha's by exactly ${money(unattached.reduce((a, i) => a + i.paid, 0) + rec.orphanAboveAppointments * 100)}.`);
    o.push(`- Not in the Fresha export at all, so not imported: product sales lines, vouchers, memberships, packages.`);
    o.push(`- ${setup.lists.noPhone.length} clients have no phone number and ${setup.lists.sharedMobile.length} phone numbers are shared by two people: both kept, nobody merged (section 4).`);
    o.push(`- Invoices not fully paid (part paid, unpaid or voided) are listed in section 6; ${plan.invoices.filter((i) => i.discount && !i.discount.clean).length} discounts are not round percentages and are listed in section 7.`);
  }
  if (history && (history.existing > 0 || customersDelta || productsDelta)) {
    h('Changes since the previous import (delta)');
    o.push(`New appointments added: ${history.inserted}. Already in Zennly: ${history.existing}. Appointments that CHANGED in Fresha since: ${history.changed.length} (listed below, NOT applied).`);
    o.push(md(history.changed.map((c) => ({ ref: c.ref, client: c.client, date: c.date, changed: c.kinds.join('+'), was: `${c.was.status} ${c.was.price} ${c.was.date} ${c.was.time}`, now: `${c.now.status} ${c.now.price} ${c.now.date} ${c.now.time}` })), ['ref', 'client', 'date', 'changed', 'was', 'now']));
    const st = history.changed.filter((c) => c.kinds.includes('status'));
    o.push(`\nStatus-only changes (e.g. Booked to Cancelled/Completed): ${st.filter((c) => c.kinds.length === 1).length} of ${st.length}.`);
    if (customersDelta) o.push(`\nNew clients added: ${customersDelta.created} (already there: ${customersDelta.existing}, never changed).`);
    if (productsDelta) o.push(`\nProducts: ${productsDelta.created} new, ${productsDelta.stockChanged.length} stock figures moved to the Fresha figure (new stock movement each), ${productsDelta.priceDiffers.length} prices differ (reported only):\n` + md(productsDelta.stockChanged, ['name', 'from', 'to']));
  }
  h('1. Past appointments still "Booked" in Fresha (imported as Confirmed; decide each: Completed / Cancelled / No Show)');
  o.push(md(R.pastBooked.map((p) => ({ ref: p.ref, date: p.date, client: p.name })), ['ref', 'date', 'client']));
  h('2. Future bookings that clash with the same staff member (guard refused or overlap)');
  o.push(md(R.overlaps.filter((p) => p.future).map((p) => ({ staff: p.staff, date: p.date, refs: `${p.a} / ${p.b}` })), ['staff', 'date', 'refs']));
  if (history) o.push('\nNot inserted by a guard:\n' + md(history.failedFuture, ['ref', 'date', 'staff', 'why']));
  h('3. Same name for different clients (booking kept under the typed name, NOT linked; link them in the app)');
  o.push(md(R.ambiguous.map((p) => ({ client: p.name, date: p.date, ref: p.ref })), ['client', 'date', 'ref']));
  h('4. Clients with no (usable) phone');
  if (setup) o.push(`${setup.lists.noPhone.length} clients have no phone. Unparsable numbers (kept without phone):\n` + md(setup.lists.badPhone, ['name', 'raw']) + '\n\nShared mobile numbers (first-added keeps it, others store it as additional phone + tag shared-mobile):\n' + md(setup.lists.sharedMobile.map((s) => ({ phone: s.phone, people: s.names.join(' / ') })), ['phone', 'people']));
  h('5. Money not attached to a booking (real money Sami\'s took; applied to nothing)');
  const prodPrices = x.products.rows.map((p) => toPaisa(p['Full price'])).filter(Boolean);
  const svcPrices = x.menu.rows.map((m) => toPaisa(m['Retail Price']));
  const apptsByClient = new Map();
  for (const l of plan.lines) { const k = l.name.toLowerCase(); (apptsByClient.get(k) || apptsByClient.set(k, []).get(k)).push(l); }
  const cases = [];
  for (const inv of plan.invoices.filter((i) => !i.attached)) {
    const near = (apptsByClient.get(inv.name) || []).map((l) => ({ l, d: days(l.date, inv.day) })).filter((e) => e.d <= 3).sort((a, b) => a.d - b.d)[0];
    const looksProduct = prodPrices.some((p) => [1, 2, 3, 4, 5].some((n) => p * n === inv.gross));
    const looksService = svcPrices.includes(inv.gross);
    cases.push({ invoice: inv.no, client: inv.name, date: inv.day, status: inv.status, gross: money(inv.gross), paid: money(inv.paid),
      suggestion: near ? `same-client appointment ${near.l.date} (${near.l.status}, ${money(near.l.price)}) ${near.d} day(s) away` : looksProduct ? 'no appointment: amount equals product price(s), likely a product sale' : looksService ? 'no appointment: equals a service price' : 'no appointment: product / voucher / gift sale? amount matches no product or service price' });
  }
  o.push(md(cases, ['invoice', 'client', 'date', 'status', 'gross', 'paid', 'suggestion']));
  o.push('\nPaid above the day\'s appointment total (extra beyond the appointments, not stored):\n' + md(R.money.filter((m) => m.kind === 'gross-above-appointments').map((m) => ({ invoice: m.inv, status: m.status, gross: m.gross, appointments: m.apptSum, extra: m.diff })), ['invoice', 'status', 'gross', 'appointments', 'extra']));
  o.push('\nClient-days with two invoices:\n' + md(R.money.filter((m) => m.kind === 'two-invoices-one-day').map((m) => ({ client: m.name, day: m.day, invoices: m.invoices.join(' '), appointmentsTotal: m.apptSum })), ['client', 'day', 'invoices', 'appointmentsTotal']));
  h('6. Part Paid / Unpaid / Voided invoices');
  o.push(md(plan.invoices.filter((i) => i.status !== 'Paid').map((i) => ({ invoice: i.no, client: i.name, day: i.day, status: i.status, gross: money(i.gross), paid: money(i.paid), attached: i.attached })), ['invoice', 'client', 'day', 'status', 'gross', 'paid', 'attached']));
  h('7. Discounts written as exact money (not a clean %)');
  o.push(md(plan.invoices.filter((i) => i.discount && !i.discount.clean).map((i) => ({ invoice: i.no, client: i.name, day: i.day, appointments: money(i.sum), invoice_gross: money(i.gross), percent: i.discount.pct })), ['invoice', 'client', 'day', 'appointments', 'invoice_gross', 'percent']));
  o.push(`\nClean-% discounts: ${plan.invoices.filter((i) => i.discount && i.discount.clean).length} invoices.`);
  h('8. Appointments whose Fresha duration differs from the menu (stored with the Fresha minutes)');
  o.push(md(R.durationRows, ['ref', 'date', 'client', 'service', 'menu', 'fresha']));
  o.push('\nA later reschedule inside the app re-derives the end time from the service duration (normal app behaviour).');
  h('9. Defaults the owner confirms');
  o.push('- Every active staff member got the branch hours (09:00-20:00, 7 days) as a DEFAULT weekly schedule: confirm each person\'s real schedule.');
  o.push('- Fresha "Booked" = Confirmed (the app has no "Booked" status).');
  if (setup) o.push('- Roles to set in each team member\'s Access section:\n' + md(setup.lists.roles.map((r) => ({ name: r.name, fresha: r.fresha, zennly: r.zennly })), ['name', 'fresha', 'zennly']));
  h('9b. How the booking came in, and payment method names');
  o.push('Booking channel (NOT stored: Zennly has no field for it that fits):\n' + md(Object.entries(R.channels).map(([channel, count]) => ({ channel, count })), ['channel', 'count']));
  const leaf = (appMethods || DEFAULT_METHODS).flatMap((m) => (typeof m === 'string' ? [m] : m.subMethods?.length ? m.subMethods : [m.name]));
  const used = {}; for (const i of plan.invoices) for (const p of i.payments) used[p.mode] = (used[p.mode] || 0) + 1;
  o.push('\nPayment methods in the Fresha export, how they were stored, and the names this spa\'s checkout offers (pick the right one for QR PAYMENT / Other; a different name later is a quick change):\n' + md(Object.entries(used).map(([m, n]) => ({ fresha: m, payments: n, stored_as: modeMap[m] ?? m })), ['fresha', 'payments', 'stored_as']) + `\n\nCheckout offers: ${leaf.join(', ')}`);
  if (history) {
    const rec = history.reconciliation;
    h('10. Reconciliation (to the rupee)');
    o.push(`CSV payments ${rec.csvPayments} = DB payments ${rec.dbPayments} + tips ${rec.dbTips} + not attached (section 5) ${rec.notImportedPaid} + above appointment totals ${rec.orphanAboveAppointments}: ${rec.moneyIdentity ? 'BALANCES' : 'DOES NOT BALANCE'}`);
  }
  return o.join('\n') + '\n';
}
