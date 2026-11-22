// LOCAL: hammers bookings inserts for ANOTHER org while the importer runs; afterwards proves no writer row slipped through a
// disabled trigger (snapshots + end time must be the trigger-computed menu values). Usage: node concurrent-writer.mjs <db-url> start|check
import pg from 'pg';
const [, , url, mode] = process.argv;
const c = new pg.Client({ connectionString: url }); await c.connect();
const base = (await c.query(`select b.id branch, s.id svc, s.name sname, s.duration_minutes dur, t.id th, (select u.id from users u where u.org_id=o.id limit 1) uid from organizations o join branches b on b.org_id=o.id
  join services s on s.org_id=o.id join therapists t on t.org_id=o.id and t.branch_id=b.id where o.slug='nuad-thai-spa' limit 1`)).rows[0];
if (mode === 'start') {
  let ok = 0, err = 0, i = 0; const lat = [];
  process.on('SIGTERM', async () => { console.log(JSON.stringify({ ok, err, maxWaitMs: Math.max(0, ...lat) })); await c.end(); process.exit(0); });
  for (;;) {
    const d = new Date(Date.UTC(2031, 0, 1 + Math.floor(i / 20))).toISOString().slice(0, 10), h = String(8 + (i % 20) % 12).padStart(2, '0');
    const t0 = Date.now();
    try { await c.query(`insert into bookings (branch_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, discount_amount, final_amount, service_name_snapshot, service_duration_snapshot, service_price_snapshot, client_request_id, created_by)
      values ($1,$2,$3,'CW test','+9779800000000',$4,$5,$5,now(),now(),100,0,100,'x',1,1,gen_random_uuid(),$6)`, [base.branch, base.svc, base.th, d, `${h}:00`, base.uid]); ok++; } catch (e) { err++; if (err === 1) console.error('first error:', e.message); }
    lat.push(Date.now() - t0); i++;
    await new Promise((r) => setTimeout(r, 15));
  }
} else {
  const r = (await c.query(`select count(*)::int n, count(*) filter (where service_name_snapshot <> $1 or service_duration_snapshot <> $2 or end_time <> start_time + ($2 * interval '1 minute'))::int bad
    from bookings where customer_name='CW test'`, [base.sname, base.dur])).rows[0];
  console.log(JSON.stringify(r)); await c.end(); process.exit(r.bad ? 1 : 0);
}
