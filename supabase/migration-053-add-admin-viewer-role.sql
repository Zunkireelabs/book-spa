-- Migration 053: add 'admin_viewer' role — read-only admin variant
--
-- New user_role enum value for accounts that need the same org-wide visibility as
-- 'admin' but must never write. Every existing write-granting RLS policy checks role
-- equality against the literal 'admin' (or IN ('manager','admin')) — never a negated
-- check — so 'admin_viewer' is automatically excluded from all INSERT/UPDATE/DELETE
-- policies without touching a single one of them. Migration 054 adds the additive
-- SELECT-only policies that grant this role the same read visibility as admin.
--
-- IMPORTANT: run this file ALONE and let it commit before running migration 054.
-- Postgres forbids using a freshly-added enum value in the same transaction it was
-- added in (ERROR: unsafe use of new value of enum type "user_role").
--
-- Idempotent: ADD VALUE IF NOT EXISTS. Portable: no hardcoded UUIDs.
--
-- Reversible: enum values cannot be dropped in Postgres. To roll back, reassign any
-- 'admin_viewer' users to another role first, then this value becomes inert (RLS
-- policies from migration-054 would need to be dropped separately).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin_viewer';

-- Record migration
INSERT INTO public.schema_migrations (version, name)
VALUES ('053', 'add-admin-viewer-role')
ON CONFLICT (version) DO NOTHING;
