-- ============================================================
-- Migration 024: Branch-level service category exclusion
-- ============================================================
-- Adds a per-branch list of service categories to hide.
-- Consumed by fetchServices() / fetchServicesByOrgId() in
-- src/services/api.js — services whose `category` is in this
-- array are filtered out for that branch. Empty array = show all.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS excluded_service_categories text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN branches.excluded_service_categories IS
  'Service categories to hide for this branch (matched against services.category). Empty array = show all.';
