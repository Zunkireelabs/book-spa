-- QC snapshot: a READ-ONLY fingerprint of a database's data, for proving that migrations lose no rows and change
-- no money. Run it before and after applying migrations (CP8 prod rehearsal), then diff the two outputs:
--
--   psql -X -A -t -F '|' -f scripts/qc-snapshot.sql > before.txt
--   ... apply migrations ...
--   psql -X -A -t -F '|' -f scripts/qc-snapshot.sql > after.txt
--   diff before.txt after.txt     # expected: only the rows listed under "expected differences" below
--
-- Expected differences after migrations: the schema_migrations count, and row counts of tables that new migrations
-- create or seed (each one must be explained). Every money line must be identical.
-- Prints counts and totals only: no names, phones or emails, so the output is safe to keep in temp_ss/.
-- Ticket: ZNLY-198 (CP8 gate) / ZNLY-245 (import reconciliation).

BEGIN READ ONLY;

-- 1. Row count of every table in public, plus auth.users (sorted, one line per table).
SELECT 'rows', table_schema || '.' || table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND (table_schema = 'public' OR (table_schema = 'auth' AND table_name = 'users'))
ORDER BY 2;

-- 2. Bookings per org and status: count and money fields.
SELECT 'bookings', o.slug || ':' || b.status,
       count(*) || '|' || coalesce(sum(b.base_amount), 0) || '|' || coalesce(sum(b.discount_amount), 0)
       || '|' || coalesce(sum(b.final_amount), 0)
FROM bookings b JOIN branches br ON br.id = b.branch_id JOIN organizations o ON o.id = br.org_id
GROUP BY o.slug, b.status ORDER BY 2;

-- 3. Payments per org and payment mode (payments carry no org: via booking -> branch -> org).
SELECT 'payments', o.slug || ':' || coalesce(p.payment_mode::text, '-'),
       count(*) || '|' || coalesce(sum(p.amount), 0)
FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN branches br ON br.id = b.branch_id
JOIN organizations o ON o.id = br.org_id
GROUP BY o.slug, p.payment_mode ORDER BY 2;

-- 4. Payments per org per Nepal day (catches money moving between days).
SELECT 'payments-day', o.slug || ':' || to_char(p.created_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM-DD'),
       count(*) || '|' || coalesce(sum(p.amount), 0)
FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN branches br ON br.id = b.branch_id
JOIN organizations o ON o.id = br.org_id
GROUP BY 2 ORDER BY 2;

-- 5. Product sales per org (refunded ones counted separately).
SELECT 'product_sales', o.slug || ':' || CASE WHEN ps.refunded_at IS NULL THEN 'sold' ELSE 'refunded' END,
       count(*) || '|' || coalesce(sum(ps.total_amount), 0)
FROM product_sales ps JOIN organizations o ON o.id = ps.org_id
GROUP BY 2 ORDER BY 2;

-- 6. Vouchers per org: value issued and amount paid.
SELECT 'vouchers', o.slug,
       count(*) || '|' || coalesce(sum(v.total_amount_issued), 0) || '|' || coalesce(sum(v.amount_paid), 0)
FROM vouchers v JOIN organizations o ON o.id = v.org_id
GROUP BY o.slug ORDER BY 2;

-- 7. Memberships per org: deposited and balance.
SELECT 'memberships', o.slug,
       count(*) || '|' || coalesce(sum(m.total_deposited), 0) || '|' || coalesce(sum(m.balance), 0)
FROM memberships m JOIN organizations o ON o.id = m.org_id
GROUP BY o.slug ORDER BY 2;

-- 8. People per org.
SELECT 'customers', o.slug, count(c.*)::text
FROM organizations o LEFT JOIN customers c ON c.org_id = o.id GROUP BY o.slug ORDER BY 2;

COMMIT;
