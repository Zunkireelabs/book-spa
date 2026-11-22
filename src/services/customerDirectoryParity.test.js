// Parity: the SQL Customers directory (migration 419: customer_directory_rows / _page / _summary) must equal the JS reference
// (utils/customerDirectory.js + utils/bookingMoney.js) for every login, on the same data, through the same RLS.
//
// Needs a local Supabase with data (e.g. scripts/seed-customer-directory-perf.sql). Skipped unless PARITY_DB_URL is set:
//   PARITY_DB_URL=postgresql://postgres:postgres@127.0.0.1:56422/postgres npx vitest run src/services/customerDirectoryParity.test.js
// Re-run it after ANY change to the SQL or to bookingMoney.js / customerDirectory.js (the rules live in both places).
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  buildCustomerDirectory, nepalNow, TABS, SORTS, tabCounts, lifecycleCounts, matchesSearch, sortCustomers, daysBetween, LIFECYCLE,
} from '../utils/customerDirectory';

const URL = process.env.PARITY_DB_URL;
const LOGINS = (process.env.PARITY_LOGINS || 'admin@smoke.test,manager@smoke.test,staff@smoke.test,restricted@smoke.test,viewer@smoke.test,admin@samis.test,manager@samis.test').split(',');

const psql = (sql) => JSON.parse(execFileSync('psql', [URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, maxBuffer: 1024 * 1024 * 512, env: process.env }).toString().trim().split('\n').pop());

// One transaction as the login (role + JWT claim), exactly the context PostgREST gives the app.
const asUser = (email, inner) => `
  begin;
  select id as uid from users where email = '${email}' \\gset
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) as _c \\gset
  ${inner}
  rollback;`;

// What the OLD page fetched, as raw rows (same columns/filters as api.js getCustomerDirectory), under the login's RLS.
const RAW = `
  select jsonb_build_object(
    'customers', (select coalesce(jsonb_agg(c order by c.id), '[]') from (select id, full_name, phone, email, gender, created_at from customers where org_id = get_user_org_id()) c),
    'bookings', (select coalesce(jsonb_agg(b order by b.id), '[]') from (
        select id, customer_id, status, payment_status, final_amount, date, start_time, service_name_snapshot, therapist_id, therapist_name_snapshot, is_locked,
               (select coalesce(jsonb_agg(jsonb_build_object('amount', p.amount)), '[]') from payments p where p.booking_id = bk.id) as payments,
               (select coalesce(jsonb_agg(jsonb_build_object('amount', r.amount)), '[]') from payment_refunds r where r.booking_id = bk.id) as payment_refunds
        from bookings bk where customer_id is not null and branch_id in (select id from branches where org_id = get_user_org_id())) b),
    'members', (select coalesce(jsonb_agg(customer_id), '[]') from list_membership_status_for_org() where status = 'active'));`;

const rpcPages = (email, args, { limit = 500, pages = 40 } = {}) => asUser(email, `
  select coalesce(jsonb_agg(x order by o), '[]') from (select o, customer_directory_page(${args}, p_limit => ${limit}, p_offset => o) as x
    from generate_series(0, ${(pages - 1) * limit}, ${limit}) o) q;`);

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const normJs = (c) => ({
  ...c, spent: round2(c.spent), balance: round2(c.balance), lockedDue: round2(c.lockedDue), upcoming: round2(c.upcoming), deposit: round2(c.deposit),
  credit: round2(c.credit), legacyBalance: round2(c.legacyBalance), createdAt: undefined,
  therapistIds: [...c.therapistIds].sort(), services: [...c.services].sort(),
  usualTherapist: c.usualTherapist ?? null, favouriteService: c.favouriteService ?? null,
  stale: c.stale.map((s) => ({ ...s })), unclosed: c.unclosed.map((s) => ({ ...s, atStake: round2(s.atStake) })),
  lastVisit: c.lastVisit ? { ...c.lastVisit, therapist: c.lastVisit.therapist || '' } : null,
  nextBooking: c.nextBooking ? { ...c.nextBooking, therapist: c.nextBooking.therapist || '' } : null,
});
const normSql = (c) => ({
  ...c, spent: round2(c.spent), balance: round2(c.balance), lockedDue: round2(c.lockedDue), upcoming: round2(c.upcoming), deposit: round2(c.deposit),
  credit: round2(c.credit), legacyBalance: round2(c.legacyBalance), createdAt: undefined,
  therapistIds: [...c.therapistIds].sort(), services: [...c.services].sort(),
  unclosed: c.unclosed.map((s) => ({ ...s, atStake: round2(s.atStake) })),
  lastVisit: c.lastVisit ? { ...c.lastVisit, therapist: c.lastVisit.therapist || '' } : null,
  nextBooking: c.nextBooking ? { ...c.nextBooking, therapist: c.nextBooking.therapist || '' } : null,
});

const COMBOS = [
  {}, { tab: 'in-spa' }, { tab: 'upcoming' }, { tab: 'owes' }, { tab: 'members' }, { tab: 'vip' },
  { segment: 'new' }, { segment: 'regular' }, { segment: 'occasional' }, { segment: 'at-risk' }, { segment: 'lapsed' },
  { segment: 'regular', noMember: true }, { search: 'walk in 4' }, { search: 'PERF customer 12' }, { search: '9810' }, { search: '+977 98100-01' }, { search: 'smoke' },
  { last: '30' }, { last: '90' }, { last: '180' }, { last: 'old' }, { last: 'never' }, { tab: 'owes', segment: 'regular', last: '90' },
];

describe.skipIf(!URL)('customer directory: SQL equals the JS reference', () => {
  for (const email of LOGINS) {
    describe(email, () => {
      const { today, hm } = nepalNow(new Date());
      const ovr = `p_today => '${today}', p_now_hm => '${hm}'`;
      let raw; let expectedAll;
      beforeAll(() => {
        raw = psql(asUser(email, RAW));
        expectedAll = buildCustomerDirectory({ customers: raw.customers, bookings: raw.bookings, memberIds: new Set(raw.members), today, nowHM: hm });
      }, 120000);
      it('the login sees customers (guards against a vacuous run)', () => { if (email.startsWith('restricted@')) return; /* a restricted login legitimately sees nothing (RLS); both sides must then be empty */ expect(raw.customers.length).toBeGreaterThan(0); expect(raw.bookings.length).toBeGreaterThan(0); });

      it('every customer row matches field for field', () => {
        const got = psql(rpcPages(email, `${ovr}, p_sort => 'name'`, { pages: 14 })).flatMap((x) => x.rows);
        expect(got.length).toBe(expectedAll.length);
        const byId = new Map(got.map((r) => [r.id, normSql(r)]));
        let bad = 0;
        for (const e of expectedAll) {
          const g = byId.get(e.id);
          try { expect(g).toEqual(normJs(e)); } catch (err) { if (bad++ < 3) throw err; }
        }
      }, 120000);

      it('summary matches (tab counts, lifecycle mix, spotlight, filter options)', () => {
        const s = psql(asUser(email, `select customer_directory_summary(${ovr});`));
        expect(s.tabs).toEqual(tabCounts(expectedAll));
        expect(s.mix).toEqual(lifecycleCounts(expectedAll));
        const risk = expectedAll.filter((c) => c.segment === 'at-risk');
        expect(s.spotlight.atRiskCount).toBe(risk.length);
        if (risk.length) expect(s.spotlight.atRiskTop.spent).toBe(round2([...risk].sort((a, b) => b.spent - a.spent)[0].spent));
        expect(s.spotlight.regularsNoMember).toBe(expectedAll.filter((c) => c.segment === 'regular' && !c.member).length);
        expect(round2(s.spotlight.before)).toBe(round2(expectedAll.reduce((x, c) => x + c.legacyBalance, 0)));
        expect(round2(s.spotlight.now)).toBe(round2(expectedAll.reduce((x, c) => x + c.balance, 0)));
        expect(s.services).toEqual([...new Set(expectedAll.flatMap((c) => c.services))].sort());
        const th = new Map();
        for (const b of raw.bookings) if (b.therapist_id && b.therapist_name_snapshot && !th.has(b.therapist_id)) th.set(b.therapist_id, b.therapist_name_snapshot);
        expect(s.therapists.map((t) => t.id).sort()).toEqual([...th.keys()].sort());
      });

      it('filters, search, sort and paging return the same customers in the same order', () => {
        const therapist = expectedAll.find((c) => c.therapistIds.length)?.therapistIds[0];
        const service = expectedAll.find((c) => c.services.length)?.services[0];
        const combos = [...COMBOS, ...(therapist ? [{ therapist }] : []), ...(service ? [{ service }] : [])];
        for (const combo of combos) {
          for (const sort of Object.keys(SORTS)) {
            for (const dir of (!combo.tab && !combo.segment && !combo.search && !combo.last) || combo.tab === 'owes' ? [SORTS[sort].dir, SORTS[sort].dir === 'asc' ? 'desc' : 'asc'] : [SORTS[sort].dir]) {
              const lastOpt = { 30: (d) => d != null && d <= 30, 90: (d) => d != null && d <= 90, 180: (d) => d != null && d <= 180, old: (d) => d != null && d > 180, never: (d) => d == null }[combo.last];
              const want = sortCustomers(expectedAll.filter((c) => (TABS[combo.tab || 'all'](c))
                && (!combo.segment || c.segment === combo.segment) && (!combo.noMember || !c.member) && matchesSearch(c, combo.search)
                && (!combo.therapist || c.therapistIds.includes(combo.therapist)) && (!combo.service || c.services.includes(combo.service))
                && (!lastOpt || lastOpt(c.lastVisit ? daysBetween(c.lastVisit.date, today) : null))), sort, dir);
              const args = [ovr, `p_sort => '${sort}'`, `p_dir => '${dir}'`, `p_tab => '${combo.tab || 'all'}'`,
                combo.segment && `p_segment => '${combo.segment}'`, combo.noMember && 'p_no_member => true', combo.search && `p_search => '${combo.search}'`,
                combo.therapist && `p_therapist => '${combo.therapist}'`, combo.service && `p_service => '${combo.service.replace(/'/g, "''")}'`, combo.last && `p_last => '${combo.last}'`].filter(Boolean).join(', ');
              // 3 pages of 25 (offset paging must neither repeat nor skip a row)
              const got = psql(rpcPages(email, args, { limit: 25, pages: 3 }));
              expect(got[0].total, JSON.stringify({ combo, sort, dir })).toBe(want.length);
              expect(got.flatMap((x) => x.rows).map((r) => r.id), JSON.stringify({ combo, sort, dir })).toEqual(want.slice(0, 75).map((c) => c.id));
            }
          }
        }
      }, 600000);
    });
  }
});
