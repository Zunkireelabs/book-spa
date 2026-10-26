-- Migration 311: products + inventory (variants, one stock ledger, suppliers, import)
-- Idempotent: safe to re-run in either database. (311 is the local number; the lead renumbers it before the PR.)
--
-- WHY
--   Until now a product was name / price / category / track_stock. Stock moved through two tables (product_sales,
--   product_stock_transfers), so damage, use in a session and a recount could not be recorded; there was no cost,
--   supplier, SKU/barcode, low-stock level or size. This migration adds all of that with sizes ("variants") from day one.
--
-- WHAT
--   suppliers                 new. Per org. Read by manager/admin/admin_viewer, written by manager/admin.
--   products                  + brand, supplier_id, option_label, pro_use, sell_at_checkout, notify_low.
--                             price_npr is LEGACY: prices now live on product_variants (kept in sync = cheapest active size).
--                             Its > 0 check becomes >= 0 (a "pro use" product may have no retail price).
--   product_variants          new. Every product has >= 1 (the backfill makes one per existing product, name NULL).
--   product_variant_costs     new. COST KEPT APART so staff cannot read it (RLS: manager/admin/admin_viewer only).
--   product_branch_stock      + variant_id (stock is per size); PK is now (variant_id, branch_id); product_id stays,
--                             kept in sync by a trigger, so old reads do not break.
--   product_sales             + variant_id, variant_name (a snapshot). No cost here: reconciliation reads this table.
--   product_stock_transfers   + variant_id.
--   product_stock_movements   new. THE ONE LEDGER. Append-only: no write policies (only the RPCs below insert) and a
--                             trigger rejects UPDATE/DELETE/TRUNCATE. Read by manager/admin/admin_viewer ONLY (it holds costs).
--   industries                + product_label, default_product_categories, products_sold_by_default (words/defaults per industry).
--
--   RPCs (SECURITY DEFINER, search_path public, EXECUTE for authenticated only; role + org + branch checked inside):
--     adjust_product_stock       manager/admin  receive | remove | set_count   (the only way to change stock by hand)
--     transfer_product_stock     manager/admin  v2, per size; "receive from outside" now goes through adjust_product_stock
--     sell_product               staff+         v2, per size. product_sales row is IDENTICAL to before (+ variant fields)
--     refund_product_sale        manager/admin  v2, writes a 'refund' movement
--     save_product               manager/admin  create/edit a product + its sizes + opening stock in one transaction
--     import_products            manager/admin  CSV/XLSX import, dry run first, all-or-nothing
--     product_money              manager/admin  avg cost, stock value and margin per size for one product at a branch
--     product_sales_summary      any role       last 30 Nepal days: qty, amount, top seller, repeat buyers
--   Private helpers (EXECUTE revoked from everyone; only the RPCs above call them):
--     _inv_branch_ok, _inv_apply, _inv_receive, _inv_notify_low
--
-- UNKNOWN COST (backfilled sizes have avg_cost 0, cost_price NULL and stock > 0)
--   An average of 0 means "unknown", never "free". _inv_unit_cost = the average when > 0, else the supply price, else NULL. The next
--   receive values the old stock at that, or (unknown) takes the new cost as the average, so 14 @ unknown + 6 @ 430 = 430, not 129.
--   save_product / import_products also seed an unknown average from a given cost_price, and never overwrite a known one.
--   product_money returns NULL stock_value / margin_pct for a size with no known cost (the UI shows "—").
--
-- TRANSFERS: stock can only be sent out of a branch the caller manages (admins: any); where it goes is free.
--
-- LOW-STOCK NOTIFICATION
--   Fires when a size crosses from ABOVE its low_stock_level to AT/BELOW it at a branch (once per crossing, not per sale),
--   only when products.track_stock and products.notify_low. Recipients: active managers/admins of the same org with access
--   to that branch. enqueue_notification is deliberately NOT used: it raises unless the caller is a manager/admin, which would
--   make a staff sale fail the moment it crosses the level. _inv_notify_low inserts into public.notifications directly (same
--   columns enqueue_notification writes: user_id, type, title, body, booking_id NULL) inside its own BEGIN..EXCEPTION block,
--   so a notification problem can never fail a sale or a stock change.
--
-- DROPPED (the frontend moves to the new shapes in this same change)
--   sell_product(uuid, int, text, uuid, uuid, text)          -> replaced by sell_product(p_variant_id, ...)
--   transfer_product_stock(uuid, uuid, int, uuid, text)      -> replaced by the variant-based v2 (same types: must be dropped first)
--   products_with_stock (view, migration-219)                -> nothing reads it after the frontend change
--   DEPLOY ORDER: a frontend older than this change cannot call the old sell/transfer RPCs once this runs. Ship together.
--
-- BACKFILL (first run only, guarded by "ledger is empty"; RAISE NOTICE prints the counts)
--   One variant + one cost row (0) per existing product. Stock / sales / transfers get their variant_id.
--   Ledger from product_stock_transfers (receives and both sides of each transfer) and product_sales (sales; refunds at
--   refunded_at), ordered by time, qty_after = running total per size+branch. Where the running total does not end at today's
--   product_branch_stock.quantity, ONE 'recount' row "Opening balance reconciliation" is added, so the ledger always ends equal to
--   stock. The notice reports how many were needed.
--
-- ROLLBACK (loses the ledger, variants and costs)
--   Restore sell_product / transfer_product_stock / products_with_stock from migration-217/216/219 and
--   DROP TABLE product_stock_movements, product_variant_costs, product_variants, suppliers CASCADE;
--   ALTER TABLE product_branch_stock DROP COLUMN variant_id (then re-add the PK on (product_id, branch_id));
--   DELETE FROM public.schema_migrations WHERE version = '311'.

BEGIN;

-- ============================================================
-- 1. Industries: the words and defaults for products
-- ============================================================
ALTER TABLE public.industries
  ADD COLUMN IF NOT EXISTS product_label text NOT NULL DEFAULT 'Products',
  ADD COLUMN IF NOT EXISTS default_product_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS products_sold_by_default boolean NOT NULL DEFAULT true;

-- Seeds only fill a still-empty list, so a re-run never overwrites what someone edited later.
UPDATE public.industries SET default_product_categories = '["Hair care","Skin care","Body & massage oils","Aromatherapy","Tools & accessories","Gift sets"]'::jsonb
 WHERE id = 'spa' AND default_product_categories = '[]'::jsonb;
UPDATE public.industries SET default_product_categories = '["Shampoo & conditioner","Styling","Colour","Treatments","Tools & accessories","Gift sets"]'::jsonb
 WHERE id = 'salon' AND default_product_categories = '[]'::jsonb;
UPDATE public.industries SET default_product_categories = '["Skin care","Nail care","Lashes & brows","Makeup","Tools & accessories","Gift sets"]'::jsonb
 WHERE id = 'beauty' AND default_product_categories = '[]'::jsonb;
-- Cleaning keeps supplies it uses, it does not sell them.
UPDATE public.industries SET product_label = 'Supplies', products_sold_by_default = false,
       default_product_categories = '["Chemicals","Cloths & mops","Machines","Gloves & safety","Bags & liners"]'::jsonb
 WHERE id = 'cleaning' AND product_label = 'Products';

-- ============================================================
-- 2. Suppliers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  contact_name text,
  phone        text,
  email        text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uq ON public.suppliers (org_id, lower(btrim(name)));
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin', 'admin_viewer'));
DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'));
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
  WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'));
DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'));

REVOKE ALL ON public.suppliers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;

-- ============================================================
-- 3. Products: new columns
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS option_label text,                              -- 'Size', 'Shade' ...; NULL = single size
  ADD COLUMN IF NOT EXISTS pro_use boolean NOT NULL DEFAULT false,         -- used in work, never sold
  ADD COLUMN IF NOT EXISTS sell_at_checkout boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_low boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.products.price_npr IS 'LEGACY (migration-311): the real price is product_variants.retail_price. Kept = cheapest active size by save_product.';
CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products (supplier_id) WHERE supplier_id IS NOT NULL;

-- A pro-use product has no retail price, so 0 must be allowed.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_npr_check;
ALTER TABLE public.products ADD CONSTRAINT products_price_npr_check CHECK (price_npr >= 0);

-- ============================================================
-- 4. Variants (sizes) and their costs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name            text,                                  -- NULL / '' for a single-size product, else '500 ml', 'Shade 6.1'
  sku             text,
  barcode         text,
  retail_price    numeric(10,2) NOT NULL DEFAULT 0 CHECK (retail_price >= 0),
  low_stock_level integer CHECK (low_stock_level IS NULL OR low_stock_level >= 0),
  reorder_qty     integer CHECK (reorder_qty IS NULL OR reorder_qty >= 0),
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_org ON public.product_variants (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_org_sku_uq ON public.product_variants (org_id, lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants (org_id, barcode) WHERE barcode IS NOT NULL;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- Every role reads (staff sell), only the org's own rows.
DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()));
DROP POLICY IF EXISTS product_variants_insert ON public.product_variants;
CREATE POLICY product_variants_insert ON public.product_variants FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin')
              AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_variants.product_id AND p.org_id = (SELECT get_user_org_id())));
DROP POLICY IF EXISTS product_variants_update ON public.product_variants;
CREATE POLICY product_variants_update ON public.product_variants FOR UPDATE TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
  WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin')
              AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_variants.product_id AND p.org_id = (SELECT get_user_org_id())));
DROP POLICY IF EXISTS product_variants_delete ON public.product_variants;
CREATE POLICY product_variants_delete ON public.product_variants FOR DELETE TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'));
REVOKE ALL ON public.product_variants FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;

-- Cost lives in its own table: staff have no SELECT policy here, so they cannot read cost even by calling the API directly.
CREATE TABLE IF NOT EXISTS public.product_variant_costs (
  variant_id uuid PRIMARY KEY REFERENCES public.product_variants(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organizations(id),
  cost_price numeric(10,2) CHECK (cost_price IS NULL OR cost_price >= 0),   -- last / standard supply price
  avg_cost   numeric(12,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0)         -- weighted on every receive
);
CREATE INDEX IF NOT EXISTS idx_product_variant_costs_org ON public.product_variant_costs (org_id);
ALTER TABLE public.product_variant_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_variant_costs_select ON public.product_variant_costs;
CREATE POLICY product_variant_costs_select ON public.product_variant_costs FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin', 'admin_viewer'));
DROP POLICY IF EXISTS product_variant_costs_insert ON public.product_variant_costs;
CREATE POLICY product_variant_costs_insert ON public.product_variant_costs FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin')
              AND EXISTS (SELECT 1 FROM public.product_variants v WHERE v.id = product_variant_costs.variant_id AND v.org_id = (SELECT get_user_org_id())));
DROP POLICY IF EXISTS product_variant_costs_update ON public.product_variant_costs;
CREATE POLICY product_variant_costs_update ON public.product_variant_costs FOR UPDATE TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
  WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'));
REVOKE ALL ON public.product_variant_costs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.product_variant_costs TO authenticated;

-- ============================================================
-- 5. Backfill: one variant (name NULL, retail = price_npr) and one cost row per existing product
-- ============================================================
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.product_variants (org_id, product_id, name, retail_price, is_active)
  SELECT p.org_id, p.id, NULL, p.price_npr, true
    FROM public.products p
   WHERE NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '311 backfill: % variants created for existing products', n;

  INSERT INTO public.product_variant_costs (variant_id, org_id, cost_price, avg_cost)
  SELECT v.id, v.org_id, NULL, 0
    FROM public.product_variants v
   WHERE NOT EXISTS (SELECT 1 FROM public.product_variant_costs c WHERE c.variant_id = v.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '311 backfill: % cost rows created', n;
END $$;

-- ============================================================
-- 6. Stock, sales and transfers get a variant
-- ============================================================
ALTER TABLE public.product_branch_stock
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE;
UPDATE public.product_branch_stock s SET variant_id = v.id
  FROM public.product_variants v
 WHERE s.variant_id IS NULL AND v.product_id = s.product_id;   -- only one variant exists at first run
ALTER TABLE public.product_branch_stock ALTER COLUMN variant_id SET NOT NULL;

-- PK (product_id, branch_id) -> (variant_id, branch_id), once.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.product_branch_stock'::regclass AND conname = 'product_branch_stock_pkey'
                AND pg_get_constraintdef(oid) LIKE '%(product_id, branch_id)%') THEN
    ALTER TABLE public.product_branch_stock DROP CONSTRAINT product_branch_stock_pkey;
    ALTER TABLE public.product_branch_stock ADD CONSTRAINT product_branch_stock_pkey PRIMARY KEY (variant_id, branch_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_product_branch_stock_product ON public.product_branch_stock (product_id);

-- product_id is denormalised; it always follows the variant.
CREATE OR REPLACE FUNCTION public.product_branch_stock_sync_product()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT v.product_id INTO NEW.product_id FROM public.product_variants v WHERE v.id = NEW.variant_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_product_branch_stock_sync_product ON public.product_branch_stock;
CREATE TRIGGER trg_product_branch_stock_sync_product
  BEFORE INSERT OR UPDATE OF variant_id ON public.product_branch_stock
  FOR EACH ROW EXECUTE FUNCTION public.product_branch_stock_sync_product();

ALTER TABLE public.product_sales
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id),
  ADD COLUMN IF NOT EXISTS variant_name text;                        -- snapshot, like product_name
UPDATE public.product_sales s SET variant_id = v.id
  FROM public.product_variants v
 WHERE s.variant_id IS NULL AND v.product_id = s.product_id;
CREATE INDEX IF NOT EXISTS idx_product_sales_variant ON public.product_sales (variant_id);

ALTER TABLE public.product_stock_transfers
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE;
UPDATE public.product_stock_transfers t SET variant_id = v.id
  FROM public.product_variants v
 WHERE t.variant_id IS NULL AND v.product_id = t.product_id;
CREATE INDEX IF NOT EXISTS idx_product_stock_transfers_variant ON public.product_stock_transfers (variant_id);

-- ============================================================
-- 7. The one stock ledger (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_stock_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  branch_id    uuid NOT NULL REFERENCES public.branches(id),
  product_id   uuid NOT NULL REFERENCES public.products(id),          -- NO ACTION: a product with history cannot be deleted
  variant_id   uuid NOT NULL REFERENCES public.product_variants(id),
  delta        integer NOT NULL CHECK (delta <> 0),
  qty_after    integer NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('received', 'sale', 'refund', 'transfer_in', 'transfer_out', 'used_in_session',
                                               'damaged', 'expired', 'lost', 'sample', 'recount', 'other', 'import_opening')),
  unit_cost    numeric(12,4),                                          -- cost per unit at that moment (average cost, or the price paid on a receive)
  supplier_id  uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  sale_id      uuid REFERENCES public.product_sales(id),
  transfer_id  uuid REFERENCES public.product_stock_transfers(id),
  booking_id   uuid REFERENCES public.bookings(id) ON DELETE SET NULL, -- reserved for V26 (products used / sold inside a booking)
  note         text,
  performed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psm_org_branch_created ON public.product_stock_movements (org_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_psm_variant_created ON public.product_stock_movements (variant_id, created_at DESC);
ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;

-- SELECT only, and only for the roles that may see costs. There is NO insert/update/delete policy: the RPCs write it.
DROP POLICY IF EXISTS product_stock_movements_select ON public.product_stock_movements;
CREATE POLICY product_stock_movements_select ON public.product_stock_movements FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin', 'admin_viewer'));
REVOKE ALL ON public.product_stock_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_stock_movements TO authenticated;

-- Belt and braces: nobody (not even a DEFINER function by mistake) edits or removes history.
CREATE OR REPLACE FUNCTION public.product_stock_movements_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'product_stock_movements is append-only (fix a mistake with a recount)' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS trg_psm_append_only ON public.product_stock_movements;
CREATE TRIGGER trg_psm_append_only BEFORE UPDATE OR DELETE ON public.product_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.product_stock_movements_append_only();
DROP TRIGGER IF EXISTS trg_psm_no_truncate ON public.product_stock_movements;
CREATE TRIGGER trg_psm_no_truncate BEFORE TRUNCATE ON public.product_stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION public.product_stock_movements_append_only();

-- ============================================================
-- 8. Ledger backfill (first run only: the ledger is still empty)
-- ============================================================
DO $$
DECLARE n_events integer; n_recount integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_stock_movements) THEN
    RAISE NOTICE '311 ledger backfill: skipped (ledger already has rows)';
    RETURN;
  END IF;

  CREATE TEMP TABLE m292_events ON COMMIT DROP AS
  SELECT * FROM (
    -- received from outside (no source branch)
    SELECT t.org_id, t.to_branch_id AS branch_id, t.product_id, t.variant_id, t.quantity AS delta, 'received'::text AS reason,
           NULL::uuid AS sale_id, NULL::uuid AS transfer_id, t.note, t.transferred_by AS by, t.created_at AS at, 1 AS ord
      FROM public.product_stock_transfers t WHERE t.from_branch_id IS NULL
    UNION ALL
    -- both sides of a branch-to-branch transfer
    SELECT t.org_id, t.from_branch_id, t.product_id, t.variant_id, -t.quantity, 'transfer_out', NULL, t.id, t.note, t.transferred_by, t.created_at, 2
      FROM public.product_stock_transfers t WHERE t.from_branch_id IS NOT NULL
    UNION ALL
    SELECT t.org_id, t.to_branch_id, t.product_id, t.variant_id, t.quantity, 'transfer_in', NULL, t.id, t.note, t.transferred_by, t.created_at, 3
      FROM public.product_stock_transfers t WHERE t.from_branch_id IS NOT NULL
    UNION ALL
    -- sales and refunds of products that count stock
    SELECT s.org_id, s.branch_id, s.product_id, s.variant_id, -s.quantity, 'sale', s.id, NULL, s.notes, s.sold_by, s.created_at, 4
      FROM public.product_sales s JOIN public.products p ON p.id = s.product_id AND p.track_stock
    UNION ALL
    SELECT s.org_id, s.branch_id, s.product_id, s.variant_id, s.quantity, 'refund', s.id, NULL, s.refund_reason, s.refunded_by, s.refunded_at, 5
      FROM public.product_sales s JOIN public.products p ON p.id = s.product_id AND p.track_stock
     WHERE s.refunded_at IS NOT NULL
  ) e WHERE e.variant_id IS NOT NULL;

  INSERT INTO public.product_stock_movements
    (org_id, branch_id, product_id, variant_id, delta, qty_after, reason, sale_id, transfer_id, note, performed_by, created_at)
  SELECT e.org_id, e.branch_id, e.product_id, e.variant_id, e.delta,
         SUM(e.delta) OVER (PARTITION BY e.variant_id, e.branch_id ORDER BY e.at, e.ord, e.sale_id, e.transfer_id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer,
         e.reason, e.sale_id, e.transfer_id, e.note, e.by, e.at
    FROM m292_events e
   WHERE e.delta <> 0
   ORDER BY e.at, e.ord;
  GET DIAGNOSTICS n_events = ROW_COUNT;

  -- Where the sum of the history does not equal the real stock, one recount closes the gap (the sum of the deltas IS the
  -- final running total, so no need to look up the "last" row, which can tie on created_at).
  INSERT INTO public.product_stock_movements
    (org_id, branch_id, product_id, variant_id, delta, qty_after, reason, note, created_at)
  SELECT p.org_id, s.branch_id, s.product_id, s.variant_id, s.quantity - COALESCE(h.total, 0), s.quantity,
         'recount', 'Opening balance reconciliation', now()
    FROM public.product_branch_stock s
    JOIN public.products p ON p.id = s.product_id
    LEFT JOIN (SELECT variant_id, branch_id, SUM(delta) AS total FROM m292_events WHERE delta <> 0 GROUP BY 1, 2) h
           ON h.variant_id = s.variant_id AND h.branch_id = s.branch_id
   WHERE s.quantity <> COALESCE(h.total, 0);
  GET DIAGNOSTICS n_recount = ROW_COUNT;
  RAISE NOTICE '311 ledger backfill: % movements from history, % reconciliation recounts added', n_events, n_recount;
END $$;

-- ============================================================
-- 9. Private helpers (no one can call these directly; the RPCs below run as owner)
-- ============================================================

-- Can the caller (manager/admin) change stock at this branch? Same org, and either admin or a branch they are assigned to.
CREATE OR REPLACE FUNCTION public._inv_branch_ok(p_branch_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.org_id = v_org) THEN RETURN false; END IF;
  RETURN v_role = 'admin' OR p_branch_id = ANY (get_user_branch_ids());
END $$;

-- Low-stock notification (see the header: enqueue_notification is bypassed on purpose). Never raises.
CREATE OR REPLACE FUNCTION public._inv_notify_low(p_variant_id uuid, p_branch_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x record; v_branch text;
BEGIN
  BEGIN
    SELECT p.org_id, p.name AS product, pv.name AS variant, pv.low_stock_level INTO x
      FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id WHERE pv.id = p_variant_id;
    SELECT name INTO v_branch FROM public.branches WHERE id = p_branch_id AND org_id = x.org_id;
    IF v_branch IS NULL THEN RETURN; END IF;
    INSERT INTO public.notifications (user_id, type, title, body, booking_id)
    SELECT u.id, 'low_stock',
           btrim(x.product || ' ' || COALESCE(x.variant, '')) || ' is running low at ' || v_branch,
           p_qty || ' left (running low at ' || x.low_stock_level || ' or fewer)',
           NULL
      FROM public.users u
     WHERE u.org_id = x.org_id AND u.is_active IS NOT FALSE AND u.role IN ('manager', 'admin')
       AND (u.role = 'admin' OR u.branch_id = p_branch_id
            OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = p_branch_id));
  EXCEPTION WHEN others THEN
    RAISE NOTICE '_inv_notify_low skipped: %', SQLERRM;
  END;
END $$;

-- The single place stock changes: locks the size+branch row, refuses to go below 0, writes the new quantity AND the movement.
-- Callers have already checked who may do this. qty_after comes from the locked row, never from the client.
CREATE OR REPLACE FUNCTION public._inv_apply(
  p_variant_id uuid, p_branch_id uuid, p_delta integer, p_reason text,
  p_unit_cost numeric DEFAULT NULL, p_supplier_id uuid DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL, p_transfer_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS public.product_stock_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  x record; v_old integer; v_new integer; v_row public.product_stock_movements;
BEGIN
  SELECT p.id AS product_id, p.org_id, p.track_stock, p.notify_low, pv.low_stock_level INTO x
    FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id WHERE pv.id = p_variant_id;
  IF x.product_id IS NULL THEN RAISE EXCEPTION 'stock: size not found'; END IF;

  -- Make sure a row exists, then lock it.
  INSERT INTO public.product_branch_stock (product_id, variant_id, branch_id, quantity)
  VALUES (x.product_id, p_variant_id, p_branch_id, 0) ON CONFLICT (variant_id, branch_id) DO NOTHING;
  SELECT quantity INTO v_old FROM public.product_branch_stock WHERE variant_id = p_variant_id AND branch_id = p_branch_id FOR UPDATE;

  v_new := v_old + p_delta;
  IF v_new < 0 THEN RAISE EXCEPTION 'stock: not enough stock (% available)', v_old; END IF;

  UPDATE public.product_branch_stock SET quantity = v_new, updated_at = now() WHERE variant_id = p_variant_id AND branch_id = p_branch_id;

  INSERT INTO public.product_stock_movements
    (org_id, branch_id, product_id, variant_id, delta, qty_after, reason, unit_cost, supplier_id, sale_id, transfer_id, note, performed_by)
  VALUES (x.org_id, p_branch_id, x.product_id, p_variant_id, p_delta, v_new, p_reason, p_unit_cost, p_supplier_id, p_sale_id, p_transfer_id,
          NULLIF(btrim(p_note), ''), auth.uid())
  RETURNING * INTO v_row;

  -- Once per crossing: it was above the level and now it is at or below it.
  IF p_delta < 0 AND x.track_stock AND x.notify_low AND x.low_stock_level IS NOT NULL
     AND v_old > x.low_stock_level AND v_new <= x.low_stock_level THEN
    PERFORM public._inv_notify_low(p_variant_id, p_branch_id, v_new);
  END IF;
  RETURN v_row;
END $$;

-- What one unit of this size is worth today: the average cost when it is known (> 0), else the last/standard supply price, else
-- NULL (unknown). An unknown cost is NOT 0: valuing old stock at 0 would drag the average down on the next receive.
CREATE OR REPLACE FUNCTION public._inv_unit_cost(p_variant_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(c.avg_cost, 0), c.cost_price) FROM public.product_variant_costs c WHERE c.variant_id = p_variant_id;
$$;

-- Stock in. Updates the weighted average cost: (old_qty * old_avg + qty * cost) / (old_qty + qty); an empty shelf takes the new
-- cost as is. old_qty is the size's stock across ALL branches, because avg_cost is one number per size. When the old unit cost is
-- unknown (average 0 and no supply price, as on backfilled sizes), the new cost becomes the average; if only the supply price is
-- known, the old stock is valued at that.
CREATE OR REPLACE FUNCTION public._inv_receive(
  p_variant_id uuid, p_branch_id uuid, p_qty integer, p_unit_cost numeric, p_supplier_id uuid, p_note text, p_reason text DEFAULT 'received')
RETURNS public.product_stock_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total integer; v_old_unit numeric; v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.product_variants WHERE id = p_variant_id;
  IF p_unit_cost IS NOT NULL THEN
    INSERT INTO public.product_variant_costs (variant_id, org_id, avg_cost) VALUES (p_variant_id, v_org, 0) ON CONFLICT (variant_id) DO NOTHING;
    PERFORM 1 FROM public.product_variant_costs WHERE variant_id = p_variant_id FOR UPDATE;
    v_old_unit := public._inv_unit_cost(p_variant_id);
    SELECT COALESCE(SUM(quantity), 0) INTO v_total FROM public.product_branch_stock WHERE variant_id = p_variant_id;
    UPDATE public.product_variant_costs
       SET cost_price = round(p_unit_cost, 2),
           avg_cost = CASE WHEN v_total <= 0 OR v_old_unit IS NULL THEN p_unit_cost
                           ELSE round((v_total * v_old_unit + p_qty * p_unit_cost) / (v_total + p_qty), 4) END
     WHERE variant_id = p_variant_id;
  END IF;
  RETURN public._inv_apply(p_variant_id, p_branch_id, p_qty, p_reason, p_unit_cost, p_supplier_id, NULL, NULL, p_note);
END $$;

REVOKE ALL ON FUNCTION public._inv_branch_ok(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inv_notify_low(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inv_apply(uuid, uuid, integer, text, numeric, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inv_unit_cost(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inv_receive(uuid, uuid, integer, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 10. adjust_product_stock: receive | remove | set_count
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_variant_id uuid, p_branch_id uuid, p_mode text, p_qty integer,
  p_reason text DEFAULT NULL, p_unit_cost numeric DEFAULT NULL, p_supplier_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS public.product_stock_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_track boolean; v_cur integer;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'adjust_product_stock: manager or admin role required';
  END IF;
  IF NOT public._inv_branch_ok(p_branch_id) THEN
    RAISE EXCEPTION 'adjust_product_stock: you do not have access to that branch';
  END IF;
  SELECT p.track_stock INTO v_track FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
   WHERE v.id = p_variant_id AND v.org_id = v_org;
  IF v_track IS NULL THEN RAISE EXCEPTION 'adjust_product_stock: product not found in your organization'; END IF;
  IF NOT v_track THEN RAISE EXCEPTION 'adjust_product_stock: this product does not count stock'; END IF;
  IF p_qty IS NULL THEN RAISE EXCEPTION 'adjust_product_stock: quantity is required'; END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id AND s.org_id = v_org) THEN
    RAISE EXCEPTION 'adjust_product_stock: supplier not found in your organization';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN RAISE EXCEPTION 'adjust_product_stock: cost cannot be negative'; END IF;

  IF p_mode = 'receive' THEN
    IF p_qty <= 0 THEN RAISE EXCEPTION 'adjust_product_stock: quantity must be greater than zero'; END IF;
    RETURN public._inv_receive(p_variant_id, p_branch_id, p_qty, p_unit_cost, p_supplier_id, p_note, 'received');

  ELSIF p_mode = 'remove' THEN
    IF p_qty <= 0 THEN RAISE EXCEPTION 'adjust_product_stock: quantity must be greater than zero'; END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('used_in_session', 'damaged', 'expired', 'lost', 'sample', 'other') THEN
      RAISE EXCEPTION 'adjust_product_stock: choose a reason (used_in_session, damaged, expired, lost, sample, other)';
    END IF;
    IF p_reason = 'other' AND COALESCE(btrim(p_note), '') = '' THEN
      RAISE EXCEPTION 'adjust_product_stock: add a note when the reason is "other"';
    END IF;
    -- Written off at the average cost of that moment.
    RETURN public._inv_apply(p_variant_id, p_branch_id, -p_qty, p_reason,
      public._inv_unit_cost(p_variant_id), NULL, NULL, NULL, p_note);

  ELSIF p_mode = 'set_count' THEN
    IF p_qty < 0 THEN RAISE EXCEPTION 'adjust_product_stock: the count cannot be negative'; END IF;
    INSERT INTO public.product_branch_stock (product_id, variant_id, branch_id, quantity)
    SELECT v.product_id, v.id, p_branch_id, 0 FROM public.product_variants v WHERE v.id = p_variant_id
    ON CONFLICT (variant_id, branch_id) DO NOTHING;
    SELECT quantity INTO v_cur FROM public.product_branch_stock WHERE variant_id = p_variant_id AND branch_id = p_branch_id FOR UPDATE;
    IF p_qty = v_cur THEN RETURN NULL; END IF;     -- already right: nothing to record
    RETURN public._inv_apply(p_variant_id, p_branch_id, p_qty - v_cur, 'recount',
      public._inv_unit_cost(p_variant_id), NULL, NULL, NULL, p_note);
  END IF;
  RAISE EXCEPTION 'adjust_product_stock: mode must be receive, remove or set_count';
END $$;

-- ============================================================
-- 11. transfer_product_stock v2 (per size). The old signature has the same argument types, so it is dropped first.
-- ============================================================
DROP FUNCTION IF EXISTS public.transfer_product_stock(uuid, uuid, integer, uuid, text);
CREATE OR REPLACE FUNCTION public.transfer_product_stock(
  p_variant_id uuid, p_to_branch_id uuid, p_quantity integer, p_from_branch_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS public.product_stock_transfers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_product uuid; v_track boolean; v_cost numeric;
  v_from_qty integer; v_row public.product_stock_transfers;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'transfer_product_stock: manager or admin role required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'transfer_product_stock: quantity must be greater than zero'; END IF;
  IF p_from_branch_id IS NULL THEN
    RAISE EXCEPTION 'transfer_product_stock: choose the branch the stock comes from (use Receive for stock from outside)';
  END IF;
  IF p_from_branch_id = p_to_branch_id THEN RAISE EXCEPTION 'transfer_product_stock: source and destination branch must be different'; END IF;

  SELECT p.id, p.track_stock INTO v_product, v_track FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
   WHERE v.id = p_variant_id AND v.org_id = v_org;
  IF v_product IS NULL THEN RAISE EXCEPTION 'transfer_product_stock: product not found in your organization'; END IF;
  IF NOT v_track THEN RAISE EXCEPTION 'transfer_product_stock: this product does not have stock tracking enabled'; END IF;

  -- Both branches must be in the org. Stock can only be sent out of a branch the caller manages (admins: any); where it goes is free.
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_to_branch_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'transfer_product_stock: destination branch is not in your organization';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_from_branch_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'transfer_product_stock: source branch is not in your organization';
  END IF;
  IF NOT public._inv_branch_ok(p_from_branch_id) THEN
    RAISE EXCEPTION 'transfer_product_stock: you do not have access to the branch the stock comes from';
  END IF;

  -- Lock both rows in a stable order so two opposite transfers cannot deadlock.
  INSERT INTO public.product_branch_stock (product_id, variant_id, branch_id, quantity)
  SELECT v_product, p_variant_id, b, 0 FROM unnest(ARRAY[p_from_branch_id, p_to_branch_id]) b
  ON CONFLICT (variant_id, branch_id) DO NOTHING;
  PERFORM 1 FROM public.product_branch_stock WHERE variant_id = p_variant_id AND branch_id IN (p_from_branch_id, p_to_branch_id)
   ORDER BY branch_id FOR UPDATE;

  SELECT quantity INTO v_from_qty FROM public.product_branch_stock WHERE variant_id = p_variant_id AND branch_id = p_from_branch_id;
  IF v_from_qty < p_quantity THEN
    RAISE EXCEPTION 'transfer_product_stock: insufficient stock at source branch (% available)', v_from_qty;
  END IF;

  INSERT INTO public.product_stock_transfers (org_id, product_id, variant_id, from_branch_id, to_branch_id, quantity, note, transferred_by)
  VALUES (v_org, v_product, p_variant_id, p_from_branch_id, p_to_branch_id, p_quantity, p_note, auth.uid())
  RETURNING * INTO v_row;

  v_cost := public._inv_unit_cost(p_variant_id);
  PERFORM public._inv_apply(p_variant_id, p_from_branch_id, -p_quantity, 'transfer_out', v_cost, NULL, NULL, v_row.id, p_note);
  PERFORM public._inv_apply(p_variant_id, p_to_branch_id, p_quantity, 'transfer_in', v_cost, NULL, NULL, v_row.id, p_note);
  RETURN v_row;
END $$;

-- ============================================================
-- 12. sell_product v2 + refund_product_sale v2 (per size). The product_sales row is what it was; reconciliation reads it.
-- ============================================================
DROP FUNCTION IF EXISTS public.sell_product(uuid, integer, text, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.sell_product(
  p_variant_id uuid, p_quantity integer, p_payment_mode text, p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS public.product_sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
  v_branch_org uuid; v_customer_org uuid; v_product record; v_var record; v_branch_qty integer; v_cost numeric;
  v_row public.product_sales;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN RAISE EXCEPTION 'sell_product: staff, manager, or admin role required'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'sell_product: quantity must be greater than zero'; END IF;
  IF p_payment_mode IS NULL OR length(trim(p_payment_mode)) = 0 OR length(p_payment_mode) > 40 THEN
    RAISE EXCEPTION 'sell_product: payment_mode is required and must be 40 characters or fewer';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'sell_product: branch is not in your organization'; END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'sell_product: customer is not in your organization'; END IF;
  END IF;

  SELECT * INTO v_var FROM public.product_variants WHERE id = p_variant_id AND org_id = v_org;
  IF v_var.id IS NULL THEN RAISE EXCEPTION 'sell_product: product not found in your organization'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = v_var.product_id FOR UPDATE;
  IF NOT v_product.is_active OR NOT v_var.is_active THEN RAISE EXCEPTION 'sell_product: product is not active'; END IF;
  IF NOT v_product.sell_at_checkout THEN RAISE EXCEPTION 'sell_product: this product is not for sale'; END IF;

  IF v_product.track_stock THEN
    INSERT INTO public.product_branch_stock (product_id, variant_id, branch_id, quantity)
    VALUES (v_product.id, p_variant_id, p_branch_id, 0) ON CONFLICT (variant_id, branch_id) DO NOTHING;
    SELECT quantity INTO v_branch_qty FROM public.product_branch_stock WHERE variant_id = p_variant_id AND branch_id = p_branch_id FOR UPDATE;
    IF COALESCE(v_branch_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'sell_product: insufficient stock (% available)', COALESCE(v_branch_qty, 0);
    END IF;
  END IF;

  INSERT INTO public.product_sales (org_id, branch_id, product_id, variant_id, variant_name, product_name, quantity,
                                    unit_price_npr, total_amount, payment_mode, customer_id, sold_by, notes)
  VALUES (v_org, p_branch_id, v_product.id, p_variant_id, NULLIF(btrim(v_var.name), ''), v_product.name, p_quantity,
          v_var.retail_price, v_var.retail_price * p_quantity, p_payment_mode, p_customer_id, auth.uid(), p_notes)
  RETURNING * INTO v_row;

  IF v_product.track_stock THEN
    v_cost := public._inv_unit_cost(p_variant_id);
    PERFORM public._inv_apply(p_variant_id, p_branch_id, -p_quantity, 'sale', v_cost, NULL, v_row.id, NULL, NULL);
  END IF;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.refund_product_sale(p_sale_id uuid, p_reason text DEFAULT NULL)
RETURNS public.product_sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
  v_sale public.product_sales; v_row public.product_sales; v_track boolean; v_cost numeric;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin') THEN RAISE EXCEPTION 'refund_product_sale: manager or admin role required'; END IF;

  SELECT * INTO v_sale FROM public.product_sales WHERE id = p_sale_id AND org_id = v_org FOR UPDATE;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'refund_product_sale: sale not found in your organization'; END IF;
  IF v_sale.refunded_at IS NOT NULL THEN RAISE EXCEPTION 'refund_product_sale: this sale has already been refunded'; END IF;

  UPDATE public.product_sales SET refunded_at = now(), refunded_by = auth.uid(), refund_reason = p_reason
   WHERE id = p_sale_id RETURNING * INTO v_row;

  SELECT track_stock INTO v_track FROM public.products WHERE id = v_sale.product_id;
  IF v_track AND v_sale.variant_id IS NOT NULL THEN
    v_cost := public._inv_unit_cost(v_sale.variant_id);
    PERFORM public._inv_apply(v_sale.variant_id, v_sale.branch_id, v_sale.quantity, 'refund', v_cost, NULL, v_sale.id, NULL, p_reason);
  END IF;
  RETURN v_row;
END $$;

-- ============================================================
-- 13. save_product: product + sizes + opening stock in one transaction
-- ============================================================
-- p_product : { name, description, brand, category, supplier_id, image_url, option_label, pro_use, sell_at_checkout,
--               track_stock, notify_low, is_active }          (keys that are absent keep their value on edit)
-- p_variants: [{ id?, name, sku, barcode, retail_price, cost_price, low_stock_level, reorder_qty, is_active }]  (order = sort_order)
--             A size that is left out is deleted when nothing refers to it, otherwise switched off.
-- p_opening : [{ idx, branch_id, qty }]  idx = 1-based position in p_variants. Create only: after that, use adjust_product_stock.
CREATE OR REPLACE FUNCTION public.save_product(
  p_product_id uuid, p_product jsonb, p_variants jsonb, p_opening jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_id uuid := p_product_id; v_track boolean; v_i integer := 0; v_el jsonb; v_vid uuid;
  v_ids uuid[] := '{}'; v_has_cost boolean; v_min numeric; v_name text; v_sku text; v_cost numeric; v_o jsonb; v_names text[] := '{}';
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('manager', 'admin') THEN RAISE EXCEPTION 'save_product: manager or admin role required'; END IF;
  IF jsonb_typeof(p_variants) IS DISTINCT FROM 'array' OR jsonb_array_length(p_variants) = 0 THEN
    RAISE EXCEPTION 'save_product: a product needs at least one size';
  END IF;
  IF NULLIF(btrim(p_product->>'name'), '') IS NULL AND p_product_id IS NULL THEN RAISE EXCEPTION 'save_product: name is required'; END IF;
  IF p_product ? 'supplier_id' AND NULLIF(p_product->>'supplier_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = (p_product->>'supplier_id')::uuid AND s.org_id = v_org) THEN
    RAISE EXCEPTION 'save_product: supplier not found in your organization';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.products (org_id, name, description, brand, category, supplier_id, image_url, option_label, pro_use,
                                 sell_at_checkout, track_stock, notify_low, is_active, price_npr)
    VALUES (v_org, btrim(p_product->>'name'), NULLIF(p_product->>'description', ''), NULLIF(btrim(p_product->>'brand'), ''),
            NULLIF(btrim(p_product->>'category'), ''), NULLIF(p_product->>'supplier_id', '')::uuid, NULLIF(p_product->>'image_url', ''),
            NULLIF(btrim(p_product->>'option_label'), ''), COALESCE((p_product->>'pro_use')::boolean, false),
            COALESCE((p_product->>'sell_at_checkout')::boolean, true), COALESCE((p_product->>'track_stock')::boolean, false),
            COALESCE((p_product->>'notify_low')::boolean, true), COALESCE((p_product->>'is_active')::boolean, true), 0)
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_id AND org_id = v_org) THEN
      RAISE EXCEPTION 'save_product: product not found in your organization';
    END IF;
    UPDATE public.products p SET
      name = COALESCE(NULLIF(btrim(p_product->>'name'), ''), p.name),
      description = CASE WHEN p_product ? 'description' THEN NULLIF(p_product->>'description', '') ELSE p.description END,
      brand = CASE WHEN p_product ? 'brand' THEN NULLIF(btrim(p_product->>'brand'), '') ELSE p.brand END,
      category = CASE WHEN p_product ? 'category' THEN NULLIF(btrim(p_product->>'category'), '') ELSE p.category END,
      supplier_id = CASE WHEN p_product ? 'supplier_id' THEN NULLIF(p_product->>'supplier_id', '')::uuid ELSE p.supplier_id END,
      image_url = CASE WHEN p_product ? 'image_url' THEN NULLIF(p_product->>'image_url', '') ELSE p.image_url END,
      option_label = CASE WHEN p_product ? 'option_label' THEN NULLIF(btrim(p_product->>'option_label'), '') ELSE p.option_label END,
      pro_use = COALESCE((p_product->>'pro_use')::boolean, p.pro_use),
      sell_at_checkout = COALESCE((p_product->>'sell_at_checkout')::boolean, p.sell_at_checkout),
      track_stock = COALESCE((p_product->>'track_stock')::boolean, p.track_stock),
      notify_low = COALESCE((p_product->>'notify_low')::boolean, p.notify_low),
      is_active = COALESCE((p_product->>'is_active')::boolean, p.is_active)
    WHERE p.id = v_id;
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    v_i := v_i + 1;
    v_name := NULLIF(btrim(v_el->>'name'), '');
    v_sku  := NULLIF(btrim(v_el->>'sku'), '');
    IF jsonb_array_length(p_variants) > 1 AND v_name IS NULL THEN RAISE EXCEPTION 'save_product: every size needs a name'; END IF;
    IF lower(COALESCE(v_name, '')) = ANY (v_names) THEN RAISE EXCEPTION 'save_product: two sizes are both called "%"', v_name; END IF;
    v_names := v_names || lower(COALESCE(v_name, ''));
    v_cost := NULLIF(v_el->>'cost_price', '')::numeric;
    v_has_cost := (v_el ? 'cost_price');   -- an absent key keeps the stored supply price; a present key (even null) sets it
    v_vid := NULLIF(v_el->>'id', '')::uuid;

    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants SET name = v_name, sku = v_sku, barcode = NULLIF(btrim(v_el->>'barcode'), ''),
             retail_price = COALESCE(NULLIF(v_el->>'retail_price', '')::numeric, 0),
             low_stock_level = NULLIF(v_el->>'low_stock_level', '')::integer, reorder_qty = NULLIF(v_el->>'reorder_qty', '')::integer,
             sort_order = v_i, is_active = COALESCE((v_el->>'is_active')::boolean, true)
       WHERE id = v_vid AND product_id = v_id AND org_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'save_product: size not found on this product'; END IF;
    ELSE
      INSERT INTO public.product_variants (org_id, product_id, name, sku, barcode, retail_price, low_stock_level, reorder_qty, sort_order, is_active)
      VALUES (v_org, v_id, v_name, v_sku, NULLIF(btrim(v_el->>'barcode'), ''), COALESCE(NULLIF(v_el->>'retail_price', '')::numeric, 0),
              NULLIF(v_el->>'low_stock_level', '')::integer, NULLIF(v_el->>'reorder_qty', '')::integer, v_i,
              COALESCE((v_el->>'is_active')::boolean, true))
      RETURNING id INTO v_vid;
    END IF;
    v_ids := v_ids || v_vid;

    -- cost_price is the last/standard supply price. A brand-new size starts its average at that price, and a size whose average is
    -- still unknown (0) takes it as its average too. A known average is never overwritten here (only receives move it).
    INSERT INTO public.product_variant_costs (variant_id, org_id, cost_price, avg_cost)
    VALUES (v_vid, v_org, v_cost, COALESCE(v_cost, 0))
    ON CONFLICT (variant_id) DO UPDATE SET
      cost_price = CASE WHEN v_has_cost THEN EXCLUDED.cost_price ELSE product_variant_costs.cost_price END,
      avg_cost = CASE WHEN product_variant_costs.avg_cost = 0 AND v_has_cost AND EXCLUDED.cost_price IS NOT NULL
                      THEN EXCLUDED.cost_price ELSE product_variant_costs.avg_cost END;
  END LOOP;

  -- Sizes that were left out.
  DELETE FROM public.product_variants v
   WHERE v.product_id = v_id AND v.id <> ALL (v_ids)
     AND NOT EXISTS (SELECT 1 FROM public.product_sales s WHERE s.variant_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.product_stock_movements m WHERE m.variant_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.product_stock_transfers t WHERE t.variant_id = v.id);
  UPDATE public.product_variants SET is_active = false WHERE product_id = v_id AND id <> ALL (v_ids);

  SELECT MIN(retail_price) FILTER (WHERE is_active), MIN(retail_price) INTO v_min, v_cost FROM public.product_variants WHERE product_id = v_id;
  UPDATE public.products SET price_npr = COALESCE(v_min, v_cost, 0) WHERE id = v_id;

  -- Opening stock (create only): goes through the same receive path, so the ledger and the average cost agree.
  IF p_product_id IS NULL AND jsonb_typeof(p_opening) = 'array' THEN
    SELECT track_stock INTO v_track FROM public.products WHERE id = v_id;
    FOR v_o IN SELECT * FROM jsonb_array_elements(p_opening) LOOP
      CONTINUE WHEN COALESCE((v_o->>'qty')::integer, 0) <= 0;
      IF NOT v_track THEN RAISE EXCEPTION 'save_product: turn on "Count stock" to set opening stock'; END IF;
      IF NOT public._inv_branch_ok((v_o->>'branch_id')::uuid) THEN RAISE EXCEPTION 'save_product: you do not have access to that branch'; END IF;
      v_vid := v_ids[(v_o->>'idx')::integer];
      IF v_vid IS NULL THEN RAISE EXCEPTION 'save_product: opening stock refers to a size that does not exist'; END IF;
      PERFORM public._inv_receive(v_vid, (v_o->>'branch_id')::uuid, (v_o->>'qty')::integer,
        (SELECT cost_price FROM public.product_variant_costs WHERE variant_id = v_vid), NULLIF(p_product->>'supplier_id', '')::uuid,
        'Opening stock', 'received');
    END LOOP;
  END IF;
  RETURN v_id;
END $$;

-- ============================================================
-- 14. import_products: dry run first, all-or-nothing
-- ============================================================
-- p_rows: [{ name, brand, variant, category, barcode, sku, supplier, cost, retail, low_at, reorder, stock }]  (all text/number, blanks allowed)
-- Matching: an existing size by SKU, else by product name + size name (both case-insensitive) is UPDATED; otherwise created.
-- Suppliers and categories are matched by name and never auto-created: a miss is a row error with a `create` hint.
-- Opening stock is written ('import_opening') only for NEW sizes and only to p_branch_id; an update never changes stock.
-- Returns { dry_run, imported, new, updated, new_products, opening_stock_rows, stock_ignored, errors: [{row, message, create?}] }
-- (`row` is the 1-based position in p_rows). Nothing is written when there is any error, or on a dry run.
CREATE OR REPLACE FUNCTION public.import_products(p_rows jsonb, p_branch_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_pass integer; v_i integer; r jsonb;
  v_name text; v_brand text; v_vname text; v_cat text; v_bar text; v_sku text; v_sup text; v_sup_id uuid; v_cat_ok boolean;
  v_cost numeric; v_retail numeric; v_low integer; v_reorder integer; v_stock integer; v_stock_txt text;
  v_vid uuid; v_pid uuid; v_errors jsonb := '[]'::jsonb; v_new integer := 0; v_upd integer := 0; v_new_products integer := 0;
  v_open integer := 0; v_ignored integer := 0; v_ign_names text[] := '{}'; v_ptrack boolean; v_seen_sku text[] := '{}'; v_seen_key text[] := '{}'; v_new_names text[] := '{}';
  v_stock_names text[] := '{}'; v_key text; v_err text; v_sold boolean; v_n integer; v_track boolean;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('manager', 'admin') THEN RAISE EXCEPTION 'import_products: manager or admin role required'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'import_products: rows must be a list'; END IF;
  IF jsonb_array_length(p_rows) > 2000 THEN RAISE EXCEPTION 'import_products: at most 2000 rows at a time'; END IF;
  IF p_branch_id IS NOT NULL AND NOT public._inv_branch_ok(p_branch_id) THEN RAISE EXCEPTION 'import_products: you do not have access to that branch'; END IF;
  SELECT COALESCE(i.products_sold_by_default, true) INTO v_sold FROM public.organizations o LEFT JOIN public.industries i ON i.id = o.industry_type WHERE o.id = v_org;

  -- Product names that have opening stock somewhere in the file: those products count stock.
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e->>'name'))), '{}') INTO v_stock_names
    FROM jsonb_array_elements(p_rows) e WHERE NULLIF(btrim(e->>'stock'), '') IS NOT NULL;

  -- Pass 1 validates and counts without writing. Pass 2 (real run, no errors) applies the same logic.
  FOR v_pass IN 1..2 LOOP
    IF v_pass = 2 THEN
      EXIT WHEN p_dry_run OR jsonb_array_length(v_errors) > 0;
      v_new := 0; v_upd := 0; v_new_products := 0; v_open := 0; v_ignored := 0; v_ign_names := '{}'; v_seen_sku := '{}'; v_seen_key := '{}'; v_new_names := '{}';
    END IF;
    v_i := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_i := v_i + 1; v_err := NULL; v_sup_id := NULL; v_vid := NULL; v_pid := NULL;
      v_name := NULLIF(btrim(r->>'name'), ''); v_brand := NULLIF(btrim(r->>'brand'), ''); v_vname := NULLIF(btrim(r->>'variant'), '');
      v_cat := NULLIF(btrim(r->>'category'), ''); v_bar := NULLIF(btrim(r->>'barcode'), ''); v_sku := NULLIF(btrim(r->>'sku'), '');
      v_sup := NULLIF(btrim(r->>'supplier'), ''); v_stock_txt := NULLIF(btrim(r->>'stock'), '');
      BEGIN
        v_cost := NULLIF(btrim(r->>'cost'), '')::numeric; v_retail := NULLIF(btrim(r->>'retail'), '')::numeric;
        v_low := NULLIF(btrim(r->>'low_at'), '')::integer; v_reorder := NULLIF(btrim(r->>'reorder'), '')::integer;
        v_stock := v_stock_txt::integer;
      EXCEPTION WHEN others THEN v_err := 'A number is not a valid number (cost, retail, low_at, reorder and stock must be numbers)'; END;

      IF v_err IS NULL THEN
        IF v_name IS NULL THEN v_err := 'Name is required';
        ELSIF v_retail IS NULL THEN v_err := 'Retail price is required';
        ELSIF v_retail < 0 OR COALESCE(v_cost, 0) < 0 OR COALESCE(v_low, 0) < 0 OR COALESCE(v_reorder, 0) < 0 OR COALESCE(v_stock, 0) < 0 THEN
          v_err := 'Numbers cannot be negative';
        ELSIF v_stock IS NOT NULL AND p_branch_id IS NULL THEN v_err := 'Choose the branch that receives the opening stock';
        END IF;
      END IF;

      IF v_err IS NULL AND v_sup IS NOT NULL THEN
        SELECT id INTO v_sup_id FROM public.suppliers WHERE org_id = v_org AND lower(btrim(name)) = lower(v_sup) AND is_active;
        IF v_sup_id IS NULL THEN
          v_errors := v_errors || jsonb_build_object('row', v_i, 'message', format('Supplier "%s" does not exist', v_sup), 'create', jsonb_build_object('type', 'supplier', 'name', v_sup));
          CONTINUE;
        END IF;
      END IF;
      IF v_err IS NULL AND v_cat IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM public.product_categories WHERE org_id = v_org AND is_active AND lower(btrim(name)) = lower(v_cat)) INTO v_cat_ok;
        IF NOT v_cat_ok THEN
          v_errors := v_errors || jsonb_build_object('row', v_i, 'message', format('Category "%s" does not exist', v_cat), 'create', jsonb_build_object('type', 'category', 'name', v_cat));
          CONTINUE;
        END IF;
        SELECT name INTO v_cat FROM public.product_categories WHERE org_id = v_org AND lower(btrim(name)) = lower(v_cat);   -- use the stored spelling
      END IF;

      -- Duplicates inside the file.
      v_key := lower(v_name) || '|' || lower(COALESCE(v_vname, ''));
      IF v_err IS NULL THEN
        IF v_sku IS NOT NULL AND lower(v_sku) = ANY (v_seen_sku) THEN v_err := format('SKU "%s" appears twice in the file', v_sku);
        ELSIF v_key = ANY (v_seen_key) THEN v_err := 'Same product and size as an earlier row';
        END IF;
      END IF;
      IF v_err IS NOT NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_i, 'message', v_err);
        CONTINUE;
      END IF;
      v_seen_key := v_seen_key || v_key;
      IF v_sku IS NOT NULL THEN v_seen_sku := v_seen_sku || lower(v_sku); END IF;

      -- Match: SKU first, then product + size name.
      IF v_sku IS NOT NULL THEN
        SELECT id, product_id INTO v_vid, v_pid FROM public.product_variants WHERE org_id = v_org AND lower(sku) = lower(v_sku);
      END IF;
      IF v_vid IS NULL THEN
        SELECT v.id, v.product_id INTO v_vid, v_pid FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
         WHERE p.org_id = v_org AND lower(btrim(p.name)) = lower(v_name) AND lower(COALESCE(btrim(v.name), '')) = lower(COALESCE(v_vname, ''))
         ORDER BY v.created_at LIMIT 1;
      END IF;

      IF v_vid IS NOT NULL THEN
        -- Update: product details and this size; never stock.
        v_upd := v_upd + 1;
        IF v_stock IS NOT NULL THEN v_ignored := v_ignored + 1; END IF;
        IF v_pass = 2 THEN
          UPDATE public.products SET brand = COALESCE(v_brand, brand), category = COALESCE(v_cat, category), supplier_id = COALESCE(v_sup_id, supplier_id) WHERE id = v_pid;
          UPDATE public.product_variants SET sku = COALESCE(v_sku, sku), barcode = COALESCE(v_bar, barcode), retail_price = v_retail,
                 low_stock_level = COALESCE(v_low, low_stock_level), reorder_qty = COALESCE(v_reorder, reorder_qty) WHERE id = v_vid;
          IF v_cost IS NOT NULL THEN
            INSERT INTO public.product_variant_costs (variant_id, org_id, cost_price, avg_cost) VALUES (v_vid, v_org, v_cost, v_cost)
            ON CONFLICT (variant_id) DO UPDATE SET cost_price = EXCLUDED.cost_price,
              avg_cost = CASE WHEN product_variant_costs.avg_cost = 0 THEN EXCLUDED.cost_price ELSE product_variant_costs.avg_cost END;
          END IF;
          UPDATE public.products SET price_npr = COALESCE((SELECT MIN(retail_price) FROM public.product_variants WHERE product_id = v_pid AND is_active), 0) WHERE id = v_pid;
        END IF;
      ELSE
        -- A SKU that belongs to another org's row cannot clash (the unique index is per org); in this org a hit above was an update.
        v_new := v_new + 1;
        SELECT id, track_stock INTO v_pid, v_ptrack FROM public.products WHERE org_id = v_org AND lower(btrim(name)) = lower(v_name) ORDER BY created_at LIMIT 1;
        IF v_pid IS NULL THEN v_ptrack := true; END IF;   -- a product created by this file counts stock when any of its rows has some
        IF v_pid IS NULL AND NOT (lower(v_name) = ANY (v_new_names)) THEN
          v_new_products := v_new_products + 1; v_new_names := v_new_names || lower(v_name);
        END IF;
        -- Opening stock for a size of a product that does not count stock is dropped: say so (stock_ignored), do not count it as written.
        IF v_stock IS NOT NULL AND v_stock > 0 THEN
          IF v_ptrack THEN v_open := v_open + 1;
          ELSE v_ignored := v_ignored + 1; IF NOT (v_name = ANY (v_ign_names)) THEN v_ign_names := v_ign_names || v_name; END IF; END IF;
        END IF;
        IF v_pass = 2 THEN
          IF v_pid IS NULL THEN
            INSERT INTO public.products (org_id, name, brand, category, supplier_id, option_label, pro_use, sell_at_checkout, track_stock, price_npr)
            VALUES (v_org, v_name, v_brand, v_cat, v_sup_id, CASE WHEN v_vname IS NOT NULL THEN 'Size' END, NOT v_sold, v_sold,
                    lower(v_name) = ANY (v_stock_names), v_retail)
            RETURNING id INTO v_pid;
          ELSIF v_vname IS NOT NULL THEN
            UPDATE public.products SET option_label = COALESCE(option_label, 'Size') WHERE id = v_pid;
          END IF;
          INSERT INTO public.product_variants (org_id, product_id, name, sku, barcode, retail_price, low_stock_level, reorder_qty, sort_order)
          VALUES (v_org, v_pid, v_vname, v_sku, v_bar, v_retail, v_low, v_reorder,
                  COALESCE((SELECT MAX(sort_order) FROM public.product_variants WHERE product_id = v_pid), 0) + 1)
          RETURNING id INTO v_vid;
          INSERT INTO public.product_variant_costs (variant_id, org_id, cost_price, avg_cost) VALUES (v_vid, v_org, v_cost, COALESCE(v_cost, 0));
          UPDATE public.products SET price_npr = COALESCE((SELECT MIN(retail_price) FROM public.product_variants WHERE product_id = v_pid AND is_active), 0) WHERE id = v_pid;
          SELECT track_stock INTO v_track FROM public.products WHERE id = v_pid;
          IF v_stock IS NOT NULL AND v_stock > 0 AND v_track THEN
            PERFORM public._inv_receive(v_vid, p_branch_id, v_stock, v_cost, v_sup_id, 'Opening stock (import)', 'import_opening');
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'imported', (NOT p_dry_run AND jsonb_array_length(v_errors) = 0),
    'new', v_new, 'updated', v_upd, 'new_products', v_new_products, 'opening_stock_rows', v_open, 'stock_ignored', v_ignored, 'stock_ignored_untracked', to_jsonb(v_ign_names), 'errors', v_errors);
END $$;

-- ============================================================
-- 15. Read helpers
-- ============================================================
-- Cost-aware numbers for one product at one branch. Manager/admin only (staff and viewers get an error, not an empty set).
CREATE OR REPLACE FUNCTION public.product_money(p_product_id uuid, p_branch_id uuid)
RETURNS TABLE (variant_id uuid, retail_price numeric, cost_price numeric, avg_cost numeric, stock_here integer, stock_value numeric, margin_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := get_user_org_id();
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('manager', 'admin') THEN RAISE EXCEPTION 'product_money: manager or admin role required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND org_id = v_org) THEN RAISE EXCEPTION 'product_money: product not found in your organization'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND org_id = v_org) THEN RAISE EXCEPTION 'product_money: branch is not in your organization'; END IF;
  RETURN QUERY
  SELECT v.id, v.retail_price, c.cost_price, COALESCE(c.avg_cost, 0), COALESCE(s.quantity, 0),
         round(COALESCE(s.quantity, 0) * COALESCE(NULLIF(c.avg_cost, 0), c.cost_price), 2),   -- NULL when the cost is unknown
         CASE WHEN v.retail_price > 0 AND COALESCE(NULLIF(c.avg_cost, 0), c.cost_price, 0) > 0
              THEN round((v.retail_price - COALESCE(NULLIF(c.avg_cost, 0), c.cost_price)) / v.retail_price * 100, 1) END
    FROM public.product_variants v
    LEFT JOIN public.product_variant_costs c ON c.variant_id = v.id
    LEFT JOIN public.product_branch_stock s ON s.variant_id = v.id AND s.branch_id = p_branch_id
   WHERE v.product_id = p_product_id AND v.org_id = v_org
   ORDER BY v.sort_order, v.created_at;
END $$;

-- Last 30 Nepal days of sales for one product (all sizes). p_branch_id NULL = every branch. Any role of the org (staff already read product_sales).
CREATE OR REPLACE FUNCTION public.product_sales_summary(p_product_id uuid, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_from timestamptz; v_qty integer; v_amt numeric; v_top jsonb; v_repeat integer; v_buyers integer;
BEGIN
  IF get_user_role() IS NULL THEN RAISE EXCEPTION 'product_sales_summary: sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND org_id = v_org) THEN RAISE EXCEPTION 'product_sales_summary: product not found in your organization'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'product_sales_summary: branch is not in your organization';
  END IF;
  v_from := (((now() AT TIME ZONE 'Asia/Kathmandu')::date - 29)::timestamp) AT TIME ZONE 'Asia/Kathmandu';

  SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(total_amount), 0) INTO v_qty, v_amt
    FROM public.product_sales WHERE org_id = v_org AND product_id = p_product_id AND refunded_at IS NULL AND created_at >= v_from
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);

  SELECT jsonb_build_object('user_id', t.sold_by, 'name', u.full_name, 'qty', t.q) INTO v_top
    FROM (SELECT sold_by, SUM(quantity) q FROM public.product_sales
           WHERE org_id = v_org AND product_id = p_product_id AND refunded_at IS NULL AND created_at >= v_from AND (p_branch_id IS NULL OR branch_id = p_branch_id)
           GROUP BY sold_by ORDER BY SUM(quantity) DESC, sold_by LIMIT 1) t
    JOIN public.users u ON u.id = t.sold_by;

  -- Repeat buyers: customers with 2+ purchases of this product (all time, same branch scope).
  SELECT COUNT(*) FILTER (WHERE n >= 2), COUNT(*) INTO v_repeat, v_buyers
    FROM (SELECT customer_id, COUNT(*) n FROM public.product_sales
           WHERE org_id = v_org AND product_id = p_product_id AND refunded_at IS NULL AND customer_id IS NOT NULL AND (p_branch_id IS NULL OR branch_id = p_branch_id)
           GROUP BY customer_id) b;

  RETURN jsonb_build_object('qty_30d', v_qty, 'amount_30d', v_amt, 'top_seller', v_top, 'repeat_buyers', COALESCE(v_repeat, 0), 'buyers', COALESCE(v_buyers, 0));
END $$;

-- ============================================================
-- 16. Grants: authenticated only
-- ============================================================
REVOKE ALL ON FUNCTION public.adjust_product_stock(uuid, uuid, text, integer, text, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_product_stock(uuid, uuid, integer, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_product_sale(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_product(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_products(jsonb, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_money(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_sales_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid, uuid, text, integer, text, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_product_stock(uuid, uuid, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_product_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_product(uuid, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_products(jsonb, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_money(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_sales_summary(uuid, uuid) TO authenticated;

-- ============================================================
-- 17. products_with_stock (migration-219) is no longer read: stock is per size now.
-- ============================================================
DROP VIEW IF EXISTS public.products_with_stock;

INSERT INTO public.schema_migrations (version, name)
VALUES ('311', 'products-inventory')
ON CONFLICT (version) DO NOTHING;

COMMIT;
