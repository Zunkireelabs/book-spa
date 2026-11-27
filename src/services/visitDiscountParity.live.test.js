import { describe, it, expect, afterAll } from 'vitest';

// ZNLY-402 piece 5, PARITY: the same discount cases through applyDiscount (JS, api.js) and visit_apply_discount (SQL, migration 430) on a ONE-row
// booking must give the same verdict, status and amounts, so the two rules cannot drift. LIVE test against the LOCAL Supabase: skipped unless
//   PARITY_LIVE=1 PARITY_ADMIN_EMAIL=.. PARITY_ADMIN_PW=.. PARITY_STAFF_EMAIL=.. PARITY_STAFF_PW=.. PARITY_BRANCH_ID=.. PARITY_SERVICE_ID=.. npx vitest run <this file>
// Creates throw-away bookings (name "Test Parity ...") and deletes them again with the admin delete. Never point it at staging/prod.
const LIVE = process.env.PARITY_LIVE === '1';
const d = LIVE ? describe : describe.skip;

d('discount parity: applyDiscount (JS) vs visit_apply_discount (SQL), one-row booking', () => {
  const env = process.env;
  let supabase; let api;
  const created = [];
  const login = async (who) => {
    const { error } = await supabase.auth.signInWithPassword({ email: env[`PARITY_${who}_EMAIL`], password: env[`PARITY_${who}_PW`] });
    if (error) throw new Error(`login ${who}: ${error.message}`);
  };
  let n = 0;
  const makeBooking = async () => {
    n += 1;
    const { data, error } = await supabase.rpc('visit_create', {
      p_branch_id: env.PARITY_BRANCH_ID, p_customer: { name: `Test Parity ${n}`, phone: `+97798000770${String(n).padStart(2, '0')}` },
      p_services: [{ service_id: env.PARITY_SERVICE_ID, date: '2027-07-01', start_time: `${String(8 + (n % 12)).padStart(2, '0')}:00`, room_id: 'none' }], p_override_reason: null, p_dry_run: false });
    if (error || !data?.ok) throw new Error(`fixture: ${error?.message || data?.message}`);
    const id = data.rows[0].booking_id; created.push(id); return id;
  };
  const read = async (id) => {
    const { data } = await supabase.from('bookings').select('discount_amount, final_amount, discount_status, payment_status').eq('id', id).single();
    return { discount: Number(data.discount_amount), final: Number(data.final_amount), status: data.discount_status, pay: data.payment_status };
  };
  const cases = [
    { who: 'STAFF', name: 'staff 10% within limit', type: 'percentage', value: 10, reason: 'loyal' },
    { who: 'STAFF', name: 'staff 50% = the limit', type: 'percentage', value: 50, reason: 'loyal' },
    { who: 'STAFF', name: 'staff 60% over the ceiling', type: 'percentage', value: 60, reason: 'loyal' },
    { who: 'STAFF', name: 'staff NPR 300', type: 'fixed', value: 300, reason: 'loyal' },
    { who: 'STAFF', name: 'staff no reason', type: 'percentage', value: 10, reason: '' },
    { who: 'ADMIN', name: 'admin 20%', type: 'percentage', value: 20, reason: 'vip' },
    { who: 'ADMIN', name: 'admin 100% settles at once', type: 'percentage', value: 100, reason: 'gift' },
    { who: 'ADMIN', name: 'admin NPR above the price', type: 'fixed', value: 99999, reason: 'oops' },
  ];

  afterAll(async () => {
    if (!supabase) return;
    await login('ADMIN');
    for (const id of created) await supabase.rpc('admin_delete_booking', { p_booking_id: id, p_reason: 'parity test cleanup' });
  });

  for (const c of cases) {
    it(c.name, async () => {
      ({ supabase } = await import('../lib/supabase')); api = await import('./api');
      await login(c.who);
      const a = await makeBooking(); const b = await makeBooking();
      const js = await api.applyDiscount({ bookingId: a, discountType: c.type, discountValue: c.value, discountReason: c.reason });
      const sql = await api.visitApplyDiscount({ visitKey: b, lines: [{ booking_id: b, type: c.type === 'percentage' ? '%' : 'NPR', value: c.value }], reason: c.reason });
      const jsRow = await read(a); const sqlRow = await read(b);
      // same refusal code (SQL says INVALID_DISCOUNT_VALUE where JS does) or the same stored result
      expect(!!sql.error).toBe(!!js.error);
      if (js.error) {
        expect(sql.error.code).toBe(js.error.code);
        expect(sqlRow).toEqual(jsRow);
      } else {
        expect(sqlRow).toEqual(jsRow);
      }
    });
  }
});
