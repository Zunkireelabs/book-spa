-- Migration 004: Backfill customer_id on orphaned bookings
-- Links existing bookings (customer_id IS NULL) to matching customer records by phone/email
-- Safe to run multiple times (idempotent)

-- Step 1: Match by phone number
UPDATE bookings b
SET customer_id = c.id
FROM customers c
WHERE b.customer_id IS NULL
  AND b.customer_phone IS NOT NULL
  AND c.phone = regexp_replace(b.customer_phone, '\D', '', 'g')
  AND c.branch_id = b.branch_id;

-- Step 2: Match remaining by email
UPDATE bookings b
SET customer_id = c.id
FROM customers c
WHERE b.customer_id IS NULL
  AND b.customer_email IS NOT NULL
  AND lower(c.email) = lower(b.customer_email)
  AND c.branch_id = b.branch_id;

-- Step 3: Create customer records for bookings that still have no match
INSERT INTO customers (branch_id, full_name, phone, email)
SELECT DISTINCT ON (b.branch_id, COALESCE(regexp_replace(b.customer_phone, '\D', '', 'g'), b.customer_email))
  b.branch_id,
  b.customer_name,
  CASE WHEN b.customer_phone IS NOT NULL THEN regexp_replace(b.customer_phone, '\D', '', 'g') ELSE NULL END,
  b.customer_email
FROM bookings b
WHERE b.customer_id IS NULL
  AND (b.customer_phone IS NOT NULL OR b.customer_email IS NOT NULL)
ORDER BY b.branch_id, COALESCE(regexp_replace(b.customer_phone, '\D', '', 'g'), b.customer_email), b.created_at DESC;

-- Step 4: Link newly created customers back to their bookings (by phone)
UPDATE bookings b
SET customer_id = c.id
FROM customers c
WHERE b.customer_id IS NULL
  AND b.customer_phone IS NOT NULL
  AND c.phone = regexp_replace(b.customer_phone, '\D', '', 'g')
  AND c.branch_id = b.branch_id;

-- Step 5: Link remaining by email
UPDATE bookings b
SET customer_id = c.id
FROM customers c
WHERE b.customer_id IS NULL
  AND b.customer_email IS NOT NULL
  AND lower(c.email) = lower(b.customer_email)
  AND c.branch_id = b.branch_id;
